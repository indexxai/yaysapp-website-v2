import { Body, Controller, Delete, Get, Headers, HttpCode, Inject, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { callLinkUpdateSchema, callAdmitSchema, callInviteSchema, callLinkSchema, objectIdSchema, startCallSchema } from '@yays/shared';
import { parse } from '../common/zod';
import { Auth, AuthGuard, type AuthCtx } from '../auth/auth.guard';
import { RATE_LIMITER } from '../infra/tokens';
import type { RateLimiter } from '../infra/rate-limit';
import { CALLS, type CallsService } from './calls.service';

const historyQuery = z.object({ before: z.string().max(40).optional(), filter: z.enum(['all', 'missed', 'video']).default('all'), conversationId: objectIdSchema.optional(), limit: z.coerce.number().int().min(1).max(100).optional() });

@Controller('v1')
@UseGuards(AuthGuard)
export class CallsController {
  constructor(@Inject(CALLS) private s: CallsService, @Inject(RATE_LIMITER) private limiter: RateLimiter) {}

  @Post('calls') @HttpCode(200)
  async start(@Auth() a: AuthCtx, @Body() b: unknown) {
    const v = parse(startCallSchema, b);
    await this.limiter.hit(`call:start:${a.userId}`, 20, 600, 'You are starting calls too often. Wait a few minutes.');
    return this.s.start(a.userId, v.conversationId, v.media);
  }
  @Get('calls') history(@Auth() a: AuthCtx, @Query() q: unknown) { return this.s.history(a.userId, parse(historyQuery, q)); }
  @Get('calls/live') live(@Auth() a: AuthCtx) { return this.s.live(a.userId); }
  @Post('calls/seen') @HttpCode(204) async seen(@Auth() a: AuthCtx) { await this.s.seen(a.userId); }
  @Post('calls/forget') @HttpCode(204) async forget(@Auth() a: AuthCtx, @Body() b: unknown) { await this.s.forget(a.userId, parse(z.object({ ids: z.array(objectIdSchema).min(1).max(100) }), b).ids); }
  @Get('calls/:id') get(@Auth() a: AuthCtx, @Param('id') id: string) { return this.s.get(a.userId, id); }
  @Post('calls/:id/accept') @HttpCode(200) accept(@Auth() a: AuthCtx, @Param('id') id: string) { return this.s.accept(a.userId, id); }
  @Post('calls/:id/decline') @HttpCode(200) decline(@Auth() a: AuthCtx, @Param('id') id: string) { return this.s.decline(a.userId, id); }
  @Post('calls/:id/leave') @HttpCode(200) leave(@Auth() a: AuthCtx, @Param('id') id: string) { return this.s.leave(a.userId, id); }
  @Post('calls/:id/invite') @HttpCode(200) invite(@Auth() a: AuthCtx, @Param('id') id: string, @Body() b: unknown) { return this.s.invite(a.userId, id, parse(callInviteSchema, b).userIds); }
  @Post('calls/:id/admit') @HttpCode(200) admit(@Auth() a: AuthCtx, @Param('id') id: string, @Body() b: unknown) { const v = parse(callAdmitSchema, b); return this.s.admit(a.userId, id, v.userId, v.allow); }

  @Post('call-links') @HttpCode(200)
  async createLink(@Auth() a: AuthCtx, @Body() b: unknown) {
    await this.limiter.hit(`call:link:${a.userId}`, 30, 3600, 'You have made many call links. Try again later.');
    return this.s.createLink(a.userId, parse(callLinkSchema, b ?? {}));
  }
  @Get('call-links') links(@Auth() a: AuthCtx) { return this.s.myLinks(a.userId); }
  @Get('call-links/:code') preview(@Auth() a: AuthCtx, @Param('code') code: string) { return this.s.linkPreview(a.userId, code); }
  @Post('call-links/:code/join') @HttpCode(200)
  async join(@Auth() a: AuthCtx, @Param('code') code: string) {
    await this.limiter.hit(`call:linkjoin:${a.userId}`, 60, 600, 'Too many tries. Wait a moment.');
    return this.s.joinLink(a.userId, code);
  }
  @Patch('call-links/:code') updateLink(@Auth() a: AuthCtx, @Param('code') code: string, @Body() b: unknown) { return this.s.updateLink(a.userId, code, parse(callLinkUpdateSchema, b)); }
  @Delete('call-links/:code') @HttpCode(204) async revoke(@Auth() a: AuthCtx, @Param('code') code: string) { await this.s.revokeLink(a.userId, code); }
}

/** LiveKit tells us when someone drops off a call (closed tab, lost connection). Signed with the API secret. */
@Controller('v1/livekit')
export class LiveKitWebhookController {
  constructor(@Inject(CALLS) private s: CallsService) {}
  @Post('webhook') @HttpCode(200)
  async hook(@Req() req: Request, @Headers('authorization') auth?: string) {
    const body = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {});
    await this.s.webhook(body, auth);
    return { ok: true };
  }
}

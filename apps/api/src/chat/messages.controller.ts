import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import { editMessageSchema, forwardSchema, reactSchema } from '@yays/shared';
import { parse } from '../common/zod';
import { AppError } from '../common/app-error';
import { Auth, AuthGuard, type AuthCtx } from '../auth/auth.guard';
import { RATE_LIMITER } from '../infra/tokens';
import type { RateLimiter } from '../infra/rate-limit';
import { SEND_LIMIT } from './chat.controller';
import { MESSAGES, type MessagesService } from './messages.service';

@Controller('v1/conversations/:id/messages/:msgId')
@UseGuards(AuthGuard)
export class MessageActionsController {
  constructor(@Inject(MESSAGES) private m: MessagesService, @Inject(RATE_LIMITER) private limiter: RateLimiter) {}

  @Patch() edit(@Auth() a: AuthCtx, @Param('id') id: string, @Param('msgId') msgId: string, @Body() b: unknown) { return this.m.edit(a.userId, id, msgId, parse(editMessageSchema, b).text); }

  /** ?for=everyone or ?for=me */
  @Delete()
  async remove(@Auth() a: AuthCtx, @Param('id') id: string, @Param('msgId') msgId: string, @Query('for') who = '') {
    if (who === 'everyone') return this.m.deleteForEveryone(a.userId, id, msgId);
    if (who === 'me') { await this.m.deleteForMe(a.userId, id, msgId); return { hidden: true }; }
    throw AppError.validation('Say who to delete it for: for=me or for=everyone.');
  }

  @Put('reaction') async react(@Auth() a: AuthCtx, @Param('id') id: string, @Param('msgId') msgId: string, @Body() b: unknown) {
    const v = parse(reactSchema, b);
    await this.limiter.hit(`react:${a.userId}`, 120, 60, 'You are reacting too fast. Wait a moment.');
    return this.m.react(a.userId, id, msgId, v.emoji);
  }
  @Delete('reaction') unreact(@Auth() a: AuthCtx, @Param('id') id: string, @Param('msgId') msgId: string) { return this.m.react(a.userId, id, msgId, null); }
  @Post('pin') @HttpCode(200) pin(@Auth() a: AuthCtx, @Param('id') id: string, @Param('msgId') msgId: string) { return this.m.pin(a.userId, id, msgId, true); }
  @Delete('pin') unpin(@Auth() a: AuthCtx, @Param('id') id: string, @Param('msgId') msgId: string) { return this.m.pin(a.userId, id, msgId, false); }
  @Put('star') star(@Auth() a: AuthCtx, @Param('id') id: string, @Param('msgId') msgId: string) { return this.m.star(a.userId, id, msgId, true); }
  @Delete('star') unstar(@Auth() a: AuthCtx, @Param('id') id: string, @Param('msgId') msgId: string) { return this.m.star(a.userId, id, msgId, false); }
  @Get('info') info(@Auth() a: AuthCtx, @Param('id') id: string, @Param('msgId') msgId: string) { return this.m.info(a.userId, id, msgId); }

  @Post('forward') @HttpCode(200)
  async forward(@Auth() a: AuthCtx, @Param('id') id: string, @Param('msgId') msgId: string, @Body() b: unknown) {
    const v = parse(forwardSchema, b);
    await this.limiter.hit(`send:${a.userId}`, SEND_LIMIT.count, SEND_LIMIT.windowSeconds, 'You are sending messages too fast. Wait a moment.');
    return this.m.forward(a.userId, id, msgId, v);
  }
}

@Controller('v1/starred')
@UseGuards(AuthGuard)
export class StarredController {
  constructor(@Inject(MESSAGES) private m: MessagesService) {}
  @Get() list(@Auth() a: AuthCtx, @Query('before') before?: string) { return this.m.starred(a.userId, before); }
}

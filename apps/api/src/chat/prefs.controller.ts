import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { chatPrefsSchema, objectIdSchema, reportSchema } from '@yays/shared';
import { parse } from '../common/zod';
import { Auth, AuthGuard, type AuthCtx } from '../auth/auth.guard';
import { RATE_LIMITER } from '../infra/tokens';
import type { RateLimiter } from '../infra/rate-limit';
import { CHAT_PREFS, type ChatPrefsService } from './prefs.service';
import { SAFETY, type SafetyService } from './safety.service';

const sharedQuery = z.object({ tab: z.enum(['media', 'docs', 'links']).default('media'), before: z.coerce.number().int().min(1).optional() });
const blockBody = z.object({ userId: objectIdSchema });

@Controller('v1')
@UseGuards(AuthGuard)
export class ChatPrefsController {
  constructor(@Inject(CHAT_PREFS) private prefs: ChatPrefsService, @Inject(SAFETY) private safety: SafetyService, @Inject(RATE_LIMITER) private limiter: RateLimiter) {}

  @Put('conversations/:id/prefs')
  set(@Auth() a: AuthCtx, @Param('id') id: string, @Body() b: unknown) { return this.prefs.set(a.userId, id, parse(chatPrefsSchema, b)); }

  @Post('conversations/:id/clear') @HttpCode(200)
  clear(@Auth() a: AuthCtx, @Param('id') id: string) { return this.prefs.clear(a.userId, id); }

  @Get('conversations/:id/overview')
  overview(@Auth() a: AuthCtx, @Param('id') id: string) { return this.prefs.overview(a.userId, id); }

  @Get('conversations/:id/shared')
  shared(@Auth() a: AuthCtx, @Param('id') id: string, @Query() q: unknown) { const v = parse(sharedQuery, q); return this.prefs.shared(a.userId, id, v.tab, v.before); }

  @Get('blocks')
  blocks(@Auth() a: AuthCtx) { return this.safety.list(a.userId); }

  @Post('blocks') @HttpCode(204)
  async block(@Auth() a: AuthCtx, @Body() b: unknown) {
    await this.limiter.hit(`block:${a.userId}`, 60, 3600, 'Too many changes. Try again later.');
    await this.safety.block(a.userId, parse(blockBody, b).userId);
  }

  @Delete('blocks/:userId') @HttpCode(204)
  async unblock(@Auth() a: AuthCtx, @Param('userId') userId: string) { await this.safety.unblock(a.userId, parse(objectIdSchema, userId)); }

  @Post('reports') @HttpCode(204)
  async report(@Auth() a: AuthCtx, @Body() b: unknown) {
    await this.limiter.hit(`report:${a.userId}`, 20, 3600, 'You have sent a lot of reports. Try again later.');
    await this.safety.report(a.userId, parse(reportSchema, b));
  }
}

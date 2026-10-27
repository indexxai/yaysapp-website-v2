import { Body, Controller, Get, HttpCode, Inject, Post, UseGuards } from '@nestjs/common';
import { problemReportSchema } from '@yays/shared';
import { parse } from '../common/zod';
import { Auth, AuthGuard, type AuthCtx } from '../auth/auth.guard';
import { RATE_LIMITER } from '../infra/tokens';
import type { RateLimiter } from '../infra/rate-limit';
import { SUPPORT, type SupportService } from './support.service';

@Controller('v1')
@UseGuards(AuthGuard)
export class SupportController {
  constructor(@Inject(SUPPORT) private s: SupportService, @Inject(RATE_LIMITER) private limiter: RateLimiter) {}

  @Post('support/chat') @HttpCode(200)
  chat(@Auth() a: AuthCtx) { return this.s.openChat(a.userId); }

  @Post('support/problems') @HttpCode(204)
  async problem(@Auth() a: AuthCtx, @Body() b: unknown) {
    await this.limiter.hit(`problem:${a.userId}`, 10, 3600, 'You have sent several reports. Try again later.');
    await this.s.problem(a.userId, parse(problemReportSchema, b));
  }

  @Get('me/storage')
  async storage(@Auth() a: AuthCtx) {
    await this.limiter.hit(`storage:${a.userId}`, 30, 60);
    return this.s.storage(a.userId);
  }
}

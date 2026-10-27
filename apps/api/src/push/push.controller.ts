import { Body, Controller, Delete, Get, HttpCode, Inject, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { pushSubscriptionSchema } from '@yays/shared';
import { parse } from '../common/zod';
import { Auth, AuthGuard, type AuthCtx } from '../auth/auth.guard';
import { RATE_LIMITER } from '../infra/tokens';
import type { RateLimiter } from '../infra/rate-limit';
import { PUSH, type PushService } from './push.service';

@Controller('v1/push')
export class PushController {
  constructor(@Inject(PUSH) private push: PushService, @Inject(RATE_LIMITER) private limiter: RateLimiter) {}

  /** The public key browsers need to subscribe. */
  @Get('config') config() { return { vapidPublicKey: this.push.publicKey }; }

  @Post('subscriptions') @HttpCode(204) @UseGuards(AuthGuard)
  async subscribe(@Auth() a: AuthCtx, @Body() b: unknown, @Req() r: Request) {
    const v = parse(pushSubscriptionSchema, b);
    await this.limiter.hit(`pushsub:${a.userId}`, 30, 3600);
    await this.push.subscribe(a.userId, a.sid, v, r.headers['user-agent']);
  }

  @Delete('subscriptions') @HttpCode(204) @UseGuards(AuthGuard)
  async unsubscribe(@Auth() a: AuthCtx, @Body() b: unknown) { await this.push.unsubscribe(a.userId, parse(z.object({ endpoint: z.string().max(2000) }), b).endpoint); }
}

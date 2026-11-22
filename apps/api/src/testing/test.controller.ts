import { Body, Controller, Get, HttpCode, Inject, Post, Query } from '@nestjs/common';
import { AppError } from '../common/app-error';
import type Redis from 'ioredis';
import { OUTBOX, type Outbox } from '../auth/senders';
import { REDIS } from '../infra/redis';
import { REWARDS, type RewardsService } from '../rewards/rewards.service';

/** Registered only when TEST_OUTBOX=1 (never in production): lets tests read the codes the dev drivers "sent". */
@Controller('v1/_test')
export class TestController {
  constructor(@Inject(OUTBOX) private outbox: Outbox, @Inject(REDIS) private redis: Redis, @Inject(REWARDS) private rewards: RewardsService) {}
  /** Runs the Chat to Earn settling job as if it were `hours` from now (default 2 days), and sets the typing check. */
  @Post('chat-earn/settle')
  @HttpCode(200)
  async settle(@Body() b: { hours?: number; typingCheck?: boolean }) {
    const ce = this.rewards.chat!;
    if (typeof b?.typingCheck === 'boolean') ce.typingCheck = b.typingCheck;
    return { settled: await ce.settleDue(new Date(Date.now() + (b?.hours ?? 48) * 3600_000)) };
  }
  /** Pushes the dev driver would have sent to this user, newest first. */
  @Get('pushes')
  async pushes(@Query('userId') userId = '') { return (await this.redis.lrange(`push:dev:${userId}`, 0, 199)).map((x) => JSON.parse(x)); }
  @Get('outbox')
  async last(@Query('to') to = '') {
    const m = await this.outbox.last(to);
    if (!m) throw AppError.notFound('Nothing sent to that address.');
    return m;
  }
}

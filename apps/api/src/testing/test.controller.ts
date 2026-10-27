import { Controller, Get, Inject, Query } from '@nestjs/common';
import { AppError } from '../common/app-error';
import type Redis from 'ioredis';
import { OUTBOX, type Outbox } from '../auth/senders';
import { REDIS } from '../infra/redis';

/** Registered only when TEST_OUTBOX=1 (never in production): lets tests read the codes the dev drivers "sent". */
@Controller('v1/_test')
export class TestController {
  constructor(@Inject(OUTBOX) private outbox: Outbox, @Inject(REDIS) private redis: Redis) {}
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

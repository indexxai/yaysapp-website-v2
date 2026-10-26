import { Controller, Get, Inject, Query } from '@nestjs/common';
import { AppError } from '../common/app-error';
import { OUTBOX, type Outbox } from '../auth/senders';

/** Registered only when TEST_OUTBOX=1 (never in production): lets tests read the codes the dev drivers "sent". */
@Controller('v1/_test')
export class TestController {
  constructor(@Inject(OUTBOX) private outbox: Outbox) {}
  @Get('outbox')
  async last(@Query('to') to = '') {
    const m = await this.outbox.last(to);
    if (!m) throw AppError.notFound('Nothing sent to that address.');
    return m;
  }
}

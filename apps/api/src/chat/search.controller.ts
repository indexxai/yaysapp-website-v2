import { Controller, Get, Inject, Param, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { parse } from '../common/zod';
import { Auth, AuthGuard, type AuthCtx } from '../auth/auth.guard';
import { RATE_LIMITER } from '../infra/tokens';
import type { RateLimiter } from '../infra/rate-limit';
import { SEARCH, type SearchService } from './search.service';

const q = z.object({ q: z.string().max(200).default(''), type: z.enum(['all', 'chats', 'people', 'messages', 'files']).default('all'), before: z.string().max(40).optional() });

@Controller('v1')
@UseGuards(AuthGuard)
export class SearchController {
  constructor(@Inject(SEARCH) private s: SearchService, @Inject(RATE_LIMITER) private limiter: RateLimiter) {}

  @Get('search')
  async search(@Auth() a: AuthCtx, @Query() query: unknown) {
    const v = parse(q, query);
    await this.limiter.hit(`search:${a.userId}`, 120, 60, 'Too many searches. Wait a moment.');
    return this.s.search(a.userId, v.q, v.type, v.before);
  }

  @Get('conversations/:id/search')
  async inChat(@Auth() a: AuthCtx, @Param('id') id: string, @Query('q') text = '') {
    await this.limiter.hit(`search:${a.userId}`, 120, 60, 'Too many searches. Wait a moment.');
    return this.s.inChat(a.userId, id, String(text));
  }
}

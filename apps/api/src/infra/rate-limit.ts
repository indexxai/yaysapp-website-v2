import type Redis from 'ioredis';
import { AppError } from '../common/app-error';

// INCR the window counter and set its expiry on first hit, atomically.
const SCRIPT = `local n = redis.call('INCR', KEYS[1]) if n == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end local t = redis.call('TTL', KEYS[1]) return {n, t}`;

export class RateLimiter {
  constructor(private readonly redis: Redis) {}
  /** Throws RATE_LIMITED once `limit` hits land inside `windowSeconds`. */
  async hit(key: string, limit: number, windowSeconds: number, message?: string): Promise<void> {
    const [n, ttl] = (await this.redis.eval(SCRIPT, 1, `rl:${key}`, windowSeconds)) as [number, number];
    if (n > limit) throw AppError.rateLimited(Math.max(ttl, 1), message);
  }
  async reset(key: string) { await this.redis.del(`rl:${key}`); }
}

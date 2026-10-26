import { Controller, Get, Inject, Res } from '@nestjs/common';
import type { Response } from 'express';
import type Redis from 'ioredis';
import type { Db } from 'mongodb';
import type { CheckResult, HealthReport } from '@yays/shared';
import { CONFIG, type Config } from '../config';
import { DB } from '../infra/mongo';
import { REDIS } from '../infra/redis';
import { STORAGE, type Storage } from '../infra/storage';

const started = Date.now();
async function timed(fn: () => Promise<unknown>, timeoutMs = 2000): Promise<CheckResult> {
  const t0 = Date.now();
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([fn(), new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`timed out after ${timeoutMs} ms`)), timeoutMs); })]);
    return { ok: true, latencyMs: Date.now() - t0 };
  } catch (e) { return { ok: false, latencyMs: Date.now() - t0, error: (e as Error).message }; }
  finally { clearTimeout(timer); }
}

@Controller('v1/health')
export class HealthController {
  constructor(@Inject(DB) private db: Db, @Inject(REDIS) private redis: Redis, @Inject(STORAGE) private storage: Storage, @Inject(CONFIG) private c: Config) {}
  @Get()
  async get(@Res() res: Response) {
    const [mongo, redis, storage] = await Promise.all([timed(() => this.db.command({ ping: 1 })), timed(() => this.redis.ping()), timed(() => this.storage.check())]);
    const ok = mongo.ok && redis.ok && storage.ok;
    const body: HealthReport = { status: ok ? 'ok' : 'degraded', version: this.c.version, uptimeSeconds: Math.round((Date.now() - started) / 1000), checks: { mongo, redis, storage } };
    res.status(ok ? 200 : 503).json(body);
  }
}

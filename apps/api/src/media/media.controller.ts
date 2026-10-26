import { Body, Controller, Get, HttpCode, Inject, Param, Post, Put, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { AppError } from '../common/app-error';
import { parse } from '../common/zod';
import { Auth, AuthGuard, type AuthCtx } from '../auth/auth.guard';
import { RATE_LIMITER } from '../infra/tokens';
import type { RateLimiter } from '../infra/rate-limit';
import { LocalStorage, newKey, STORAGE, type Storage } from '../infra/storage';

const PURPOSES = {
  avatar: { prefix: 'avatars', types: { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' } as Record<string, string>, max: 5 * 1024 * 1024 },
} as const;
const uploadSchema = z.object({ purpose: z.enum(['avatar']), contentType: z.string().max(100), size: z.number().int().positive() });

@Controller('v1/media')
export class MediaController {
  constructor(@Inject(STORAGE) private storage: Storage, @Inject(RATE_LIMITER) private limiter: RateLimiter) {}

  @Post('upload-url') @HttpCode(200) @UseGuards(AuthGuard)
  async uploadUrl(@Auth() a: AuthCtx, @Body() b: unknown) {
    const v = parse(uploadSchema, b);
    const p = PURPOSES[v.purpose];
    const ext = p.types[v.contentType];
    if (!ext) throw AppError.validation('Photos must be JPG, PNG or WebP.');
    if (v.size > p.max) throw AppError.validation(`That file is larger than ${p.max / 1024 / 1024} MB.`);
    await this.limiter.hit(`upload:${a.userId}`, 60, 3600);
    return this.storage.createUpload(newKey(p.prefix, a.userId.toHexString(), ext), v.contentType, p.max);
  }

  /** Local storage only: the upload and download targets that stand in for S3. */
  @Put('local/:token') @HttpCode(204)
  async localPut(@Param('token') token: string, @Req() req: Request) {
    const s = this.local();
    const t = s.verify<{ op: string; key: string; ct: string; max: number }>(token);
    if (!t || t.op !== 'put') throw AppError.forbidden('This upload link expired. Try again.');
    if ((req.headers['content-type'] ?? '').split(';')[0] !== t.ct) throw AppError.validation('The file type does not match the upload.');
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const c of req) { size += (c as Buffer).length; if (size > t.max) throw new AppError(413, 'validation_failed', 'That file is too large.'); chunks.push(c as Buffer); }
    if (!size) throw AppError.validation('The file is empty.');
    await s.write(t.key, Buffer.concat(chunks), t.ct);
  }

  @Get('local/:token')
  async localGet(@Param('token') token: string, @Res() res: Response) {
    const s = this.local();
    const t = s.verify<{ op: string; key: string }>(token);
    if (!t || t.op !== 'get') throw AppError.forbidden('This link expired.');
    try { const f = await s.read(t.key); res.setHeader('content-type', f.contentType); res.setHeader('cache-control', 'private, max-age=3600'); res.send(f.data); }
    catch { throw AppError.notFound(); }
  }

  private local() { if (!(this.storage instanceof LocalStorage)) throw AppError.notFound(); return this.storage; }
}

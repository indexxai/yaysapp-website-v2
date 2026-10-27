import { Body, Controller, Get, HttpCode, Inject, Param, Post, Put, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { AppError } from '../common/app-error';
import { parse } from '../common/zod';
import { Auth, AuthGuard, type AuthCtx } from '../auth/auth.guard';
import { RATE_LIMITER } from '../infra/tokens';
import type { RateLimiter } from '../infra/rate-limit';
import { MEDIA_LIMITS, MEDIA_TYPES, baseMime, formatBytes } from '@yays/shared';
import { contentDisposition, LocalStorage, newKey, STORAGE, type Storage } from '../infra/storage';

const AVATAR = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' } as Record<string, string>;
const EXT: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov',
  'audio/webm': 'weba', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a', 'audio/mpeg': 'mp3', 'audio/aac': 'aac', 'audio/wav': 'wav', 'application/pdf': 'pdf',
};
const uploadSchema = z.object({
  purpose: z.enum(['avatar', 'media', 'thumb']),
  kind: z.enum(['image', 'video', 'voice', 'file']).optional(),
  contentType: z.string().max(150),
  size: z.number().int().positive('The file is empty.'),
  name: z.string().max(255).optional(),
});
/** A file extension for the storage key: from the type, else from the file name, else "bin". */
const extFor = (mime: string, name?: string) => EXT[mime] ?? (/\.([a-z0-9]{1,5})$/i.exec(name ?? '')?.[1]?.toLowerCase() ?? 'bin');

@Controller('v1/media')
export class MediaController {
  constructor(@Inject(STORAGE) private storage: Storage, @Inject(RATE_LIMITER) private limiter: RateLimiter) {}

  @Post('upload-url') @HttpCode(200) @UseGuards(AuthGuard)
  async uploadUrl(@Auth() a: AuthCtx, @Body() b: unknown) {
    const v = parse(uploadSchema, b);
    const ct = baseMime(v.contentType) || 'application/octet-stream';
    const me = a.userId.toHexString();
    let key: string, max: number;
    if (v.purpose === 'avatar') {
      if (!AVATAR[ct]) throw AppError.validation('Photos must be JPG, PNG or WebP.');
      max = 5 * 1024 * 1024; key = newKey('avatars', me, AVATAR[ct]);
    } else if (v.purpose === 'thumb') {
      if (!['image/jpeg', 'image/webp', 'image/png'].includes(ct)) throw AppError.validation('Previews must be JPG, PNG or WebP.');
      max = MEDIA_LIMITS.thumb; key = newKey('thumbs', me, AVATAR[ct]);
    } else {
      if (!v.kind) throw AppError.validation('Say what kind of file this is.');
      if (v.kind !== 'file' && !MEDIA_TYPES[v.kind].includes(ct)) throw AppError.validation(v.kind === 'voice' ? 'That recording format isn’t supported.' : `That ${v.kind} format isn’t supported. Send it as a file instead.`);
      max = MEDIA_LIMITS[v.kind]; key = newKey('media', me, extFor(ct, v.name));
    }
    if (v.size > max) throw AppError.validation(`That file is ${formatBytes(v.size)}. The limit is ${formatBytes(max)}.`);
    await this.limiter.hit(`upload:${a.userId}`, 300, 3600, 'Too many uploads in the last hour. Try again later.');
    return this.storage.createUpload(key, ct, max);
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

  /** Serves a stored file, with byte ranges so audio and video can seek. */
  @Get('local/:token')
  async localGet(@Param('token') token: string, @Req() req: Request, @Res() res: Response) {
    const s = this.local();
    const t = s.verify<{ op: string; key: string; fn?: string }>(token);
    if (!t || t.op !== 'get') throw AppError.forbidden('This link expired.');
    let f: { data: Buffer; contentType: string };
    try { f = await s.read(t.key); } catch { throw AppError.notFound(); }
    res.setHeader('content-type', f.contentType);
    res.setHeader('cache-control', 'private, max-age=3600');
    res.setHeader('accept-ranges', 'bytes');
    if (t.fn) res.setHeader('content-disposition', contentDisposition(t.fn));
    const total = f.data.length;
    const m = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? ''));
    if (m && (m[1] || m[2])) {
      let start = m[1] ? Number(m[1]) : total - Number(m[2]);
      let end = m[1] && m[2] ? Number(m[2]) : total - 1;
      start = Math.max(0, start); end = Math.min(end, total - 1);
      if (start > end || start >= total) { res.status(416).setHeader('content-range', `bytes */${total}`); res.end(); return; }
      res.status(206).setHeader('content-range', `bytes ${start}-${end}/${total}`);
      res.setHeader('content-length', String(end - start + 1));
      res.end(f.data.subarray(start, end + 1));
      return;
    }
    res.setHeader('content-length', String(total));
    res.end(f.data);
  }

  private local() { if (!(this.storage instanceof LocalStorage)) throw AppError.notFound(); return this.storage; }
}

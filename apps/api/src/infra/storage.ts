import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { promises as fs } from 'fs';
import * as path from 'path';
import { DeleteObjectCommand, HeadBucketCommand, HeadObjectCommand, PutObjectCommand, GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Config } from '../config';

export const STORAGE = Symbol('STORAGE');

export interface UploadTicket { key: string; uploadUrl: string; method: 'PUT'; headers: Record<string, string>; expiresAt: string }
export interface StoredObject { size: number; contentType: string }

export interface Storage {
  check(): Promise<void>;
  createUpload(key: string, contentType: string, maxBytes: number): Promise<UploadTicket>;
  head(key: string): Promise<StoredObject | null>;
  /** A link valid for at least an hour. The same key gives the same link within the hour, so browsers can cache it. */
  downloadUrl(key: string, opts?: DownloadOpts): Promise<string>;
  /** Removes a stored file; quietly does nothing if it isn't there. */
  remove(key: string): Promise<void>;
}
export interface DownloadOpts { /** Save with this file name instead of showing inline. */ filename?: string }

const HOUR = 3600_000;
/** Links are signed for the current hour plus one, so they stay identical for a whole hour. */
const hourStart = () => Math.floor(Date.now() / HOUR) * HOUR;
const safeName = (n: string) => n.replace(/[\r\n"\\]/g, '_').slice(0, 200);
export const contentDisposition = (filename: string) => `attachment; filename="${safeName(filename).replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(safeName(filename))}`;

/** Keys are made by the server only: a fixed prefix, an owner id and a random name. */
export function newKey(prefix: string, ownerId: string, ext: string) {
  if (!/^[a-z]+$/.test(prefix) || !/^[a-f0-9]{24}$/.test(ownerId) || !/^[a-z0-9]{1,5}$/.test(ext)) throw new Error('bad key parts');
  return `${prefix}/${ownerId}/${Date.now().toString(36)}-${randomBytes(9).toString('base64url')}.${ext}`;
}
export const KEY_RE = /^[a-z]+\/[a-f0-9]{24}\/[a-z0-9]+-[A-Za-z0-9_-]{12}\.[a-z0-9]{1,5}$/;

export class S3Storage implements Storage {
  private s3: S3Client;
  constructor(private readonly bucket: string, region: string) { this.s3 = new S3Client({ region }); }
  async check() { await this.s3.send(new HeadBucketCommand({ Bucket: this.bucket })); }
  async createUpload(key: string, contentType: string, _maxBytes: number) {
    const ttl = 600;
    const url = await getSignedUrl(this.s3, new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: contentType }), { expiresIn: ttl });
    return { key, uploadUrl: url, method: 'PUT' as const, headers: { 'content-type': contentType }, expiresAt: new Date(Date.now() + ttl * 1000).toISOString() };
  }
  async head(key: string) {
    try {
      const r = await this.s3.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return { size: r.ContentLength ?? 0, contentType: r.ContentType ?? 'application/octet-stream' };
    } catch (e) { if ((e as { name?: string }).name === 'NotFound') return null; throw e; }
  }
  downloadUrl(key: string, opts: DownloadOpts = {}) {
    const cmd = new GetObjectCommand({ Bucket: this.bucket, Key: key, ...(opts.filename ? { ResponseContentDisposition: contentDisposition(opts.filename) } : {}) });
    return getSignedUrl(this.s3, cmd, { expiresIn: 7200, signingDate: new Date(hourStart()) });
  }
  async remove(key: string) { await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key })); }
}

/**
 * Filesystem storage for development and tests. Uploads go to the API itself
 * (PUT /v1/media/local/:token) with the same signed-ticket flow as S3, so apps
 * use one code path everywhere.
 */
export class LocalStorage implements Storage {
  constructor(private readonly dir: string, private readonly publicUrl: string, private readonly secret: string) {}
  private file(key: string) {
    if (!KEY_RE.test(key)) throw new Error('bad key');
    return path.join(this.dir, key);
  }
  sign(payload: Record<string, unknown>) {
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const sig = createHmac('sha256', this.secret).update(body).digest('base64url');
    return `${body}.${sig}`;
  }
  verify<T>(token: string): T | null {
    const [body, sig] = token.split('.');
    if (!body || !sig) return null;
    const want = createHmac('sha256', this.secret).update(body).digest();
    const got = Buffer.from(sig, 'base64url');
    if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
    const p = JSON.parse(Buffer.from(body, 'base64url').toString()) as T & { exp: number };
    return p.exp > Date.now() ? p : null;
  }
  async check() { await fs.mkdir(this.dir, { recursive: true }); await fs.access(this.dir, (await import('fs')).constants.W_OK); }
  async createUpload(key: string, contentType: string, maxBytes: number) {
    const exp = Date.now() + 600_000;
    const token = this.sign({ op: 'put', key, ct: contentType, max: maxBytes, exp });
    return { key, uploadUrl: `${this.publicUrl}/v1/media/local/${token}`, method: 'PUT' as const, headers: { 'content-type': contentType }, expiresAt: new Date(exp).toISOString() };
  }
  async write(key: string, data: Buffer, contentType: string) {
    const f = this.file(key);
    await fs.mkdir(path.dirname(f), { recursive: true });
    await fs.writeFile(f, data);
    await fs.writeFile(f + '.meta', JSON.stringify({ contentType }));
  }
  async read(key: string) {
    const f = this.file(key);
    const [data, meta] = await Promise.all([fs.readFile(f), fs.readFile(f + '.meta', 'utf8')]);
    return { data, contentType: (JSON.parse(meta) as { contentType: string }).contentType };
  }
  async head(key: string) {
    try {
      const f = this.file(key);
      const [st, meta] = await Promise.all([fs.stat(f), fs.readFile(f + '.meta', 'utf8')]);
      return { size: st.size, contentType: (JSON.parse(meta) as { contentType: string }).contentType };
    } catch { return null; }
  }
  async downloadUrl(key: string, opts: DownloadOpts = {}) {
    return `${this.publicUrl}/v1/media/local/${this.sign({ op: 'get', key, exp: hourStart() + 2 * HOUR, ...(opts.filename ? { fn: opts.filename } : {}) })}`;
  }  async remove(key: string) {
    const f = this.file(key);
    await Promise.all([fs.rm(f, { force: true }), fs.rm(f + '.meta', { force: true })]);
  }

}

export function createStorage(c: Config): Storage {
  return c.STORAGE_DRIVER === 's3' ? new S3Storage(c.S3_BUCKET!, c.S3_REGION!) : new LocalStorage(path.resolve(c.LOCAL_STORAGE_DIR), c.PUBLIC_URL, c.JWT_SECRET + ':storage');
}

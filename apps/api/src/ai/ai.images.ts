import { createHash } from 'crypto';
import { deflateSync } from 'zlib';
import { AppError } from '../common/app-error';
import type { Config } from '../config';
import type { Logger } from '../common/logger';

/** A finished picture: PNG bytes and its size. */
export interface MadeImage { png: Buffer; width: number; height: number }
export interface ImageProvider {
  readonly name: 'dev' | 'openai';
  readonly model: string;
  generate(o: { prompt: string; n: number }): Promise<MadeImage[]>;
  /** A changed copy of one picture. */
  edit(o: { prompt: string; image: Buffer; mime: string }): Promise<MadeImage>;
}

const SIZE = 1024;
/** What people see when the image model says no (it checks prompts and pictures for things it won't draw). */
export const IMAGE_REFUSED = 'Jack can’t make that picture. Try describing it another way, without real brands, real people or anything unsafe.';

/** OpenAI's image model (gpt-image-1 by default): new pictures and edits of an earlier one. */
export class OpenAiImages implements ImageProvider {
  readonly name = 'openai' as const;
  constructor(private readonly o: { baseUrl: string; key: string; model: string }, private readonly log: Logger, private readonly f: typeof fetch = fetch) {}
  get model() { return this.o.model; }

  private async call(path: string, init: { json?: unknown; form?: FormData }) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 150_000);
    let res: Response;
    try {
      res = await this.f(`${this.o.baseUrl.replace(/\/$/, '')}${path}`, {
        method: 'POST', signal: ctrl.signal,
        headers: { authorization: `Bearer ${this.o.key}`, ...(init.json ? { 'content-type': 'application/json' } : {}) },
        body: init.json ? JSON.stringify(init.json) : init.form,
      });
    } catch { throw AppError.conflict('Making the picture took too long. Try again.'); }
    finally { clearTimeout(timer); }
    if (!res.ok) {
      const text = (await res.text().catch(() => '')).slice(0, 400);
      this.log.warn({ status: res.status, body: text, path }, 'image request failed');
      if (res.status === 400 && /moderation|safety|content_policy|policy/i.test(text)) throw AppError.validation(IMAGE_REFUSED, { refused: true });
      if (res.status === 429) throw AppError.conflict('Jack’s AI is busy making pictures. Try again in a minute.');
      if (res.status === 401 || res.status === 403) throw AppError.conflict('Pictures aren’t set up correctly. The team has been told.');
      throw AppError.conflict('The picture didn’t come out. Try again.');
    }
    const j = await res.json() as { data?: Array<{ b64_json?: string }> };
    const out = (j.data ?? []).filter((d) => d.b64_json).map((d) => ({ png: Buffer.from(d.b64_json!, 'base64'), width: SIZE, height: SIZE }));
    if (!out.length) throw AppError.conflict('The picture didn’t come out. Try again.');
    return out;
  }

  generate(o: { prompt: string; n: number }) {
    return this.call('/images/generations', { json: { model: this.o.model, prompt: o.prompt, n: o.n, size: `${SIZE}x${SIZE}` } });
  }

  async edit(o: { prompt: string; image: Buffer; mime: string }) {
    const form = new FormData();
    form.set('model', this.o.model);
    form.set('prompt', o.prompt);
    form.set('size', `${SIZE}x${SIZE}`);
    form.set('image', new Blob([new Uint8Array(o.image)], { type: o.mime }), o.mime === 'image/png' ? 'image.png' : 'image.jpg');
    return (await this.call('/images/edits', { form }))[0]!;
  }
}

/** Development and tests: a plain coloured square (its colour comes from the words), so no image model is needed. */
export class DevImages implements ImageProvider {
  readonly name = 'dev' as const;
  readonly model = 'demo';
  async generate(o: { prompt: string; n: number }) {
    if (/\b(refuse-me|nsfw)\b/i.test(o.prompt)) throw AppError.validation(IMAGE_REFUSED, { refused: true });
    return Array.from({ length: o.n }, (_, i) => this.square(`${o.prompt}#${i}`));
  }
  async edit(o: { prompt: string; image: Buffer }) { return this.square(`${o.prompt}#edit#${o.image.length}`); }
  private square(seed: string): MadeImage {
    const h = createHash('sha256').update(seed).digest();
    const side = 64;
    return { png: png(side, [h[0]!, h[1]!, h[2]!]), width: side, height: side };
  }
}

/** A solid-colour PNG. */
export function png(side: number, rgb: [number, number, number]): Buffer {
  const crcTable = [...Array(256)].map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type: string, data: Buffer) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(side, 0); ihdr.writeUInt32BE(side, 4); ihdr[8] = 8; ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: side }, () => rgb).flat())]);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.concat(Array.from({ length: side }, () => row)))), chunk('IEND', Buffer.alloc(0))]);
}

export function createImageProvider(c: Config, log: Logger): ImageProvider | null {
  if (c.aiImageDriver === 'off') return null;
  if (c.aiImageDriver === 'openai') return new OpenAiImages({ baseUrl: c.OPENAI_BASE_URL, key: c.OPENAI_API_KEY!, model: c.AI_IMAGE_MODEL }, log);
  return new DevImages();
}
export const IMAGE_PROVIDER = Symbol('IMAGE_PROVIDER');

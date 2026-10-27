'use client';
import { MAX_VOICE_MS, kindFor, type FileToSend, type Uploader } from '@yays/shared';

/** PUT with progress events (fetch can't report upload progress). */
export const xhrUploader: Uploader = (t, file, onProgress, signal) => new Promise((resolve, reject) => {
  const x = new XMLHttpRequest();
  x.open('PUT', t.uploadUrl);
  for (const [k, v] of Object.entries(t.headers)) x.setRequestHeader(k, v);
  x.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded); };
  x.onload = () => (x.status >= 200 && x.status < 300 ? (onProgress(file.size), resolve()) : reject(new Error(`upload failed (${x.status})`)));
  x.onerror = () => reject(new Error('network'));
  x.onabort = () => reject(new DOMException('aborted', 'AbortError'));
  signal.addEventListener('abort', () => x.abort());
  x.send(file);
});

const THUMB_MAX = 480;
function canvasThumb(src: CanvasImageSource, w: number, h: number): Promise<Blob | undefined> {
  const scale = Math.min(1, THUMB_MAX / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * scale)); c.height = Math.max(1, Math.round(h * scale));
  const ctx = c.getContext('2d');
  if (!ctx) return Promise.resolve(undefined);
  ctx.drawImage(src, 0, 0, c.width, c.height);
  return new Promise((r) => c.toBlob((b) => r(b && b.size <= 512 * 1024 ? b : undefined), 'image/jpeg', 0.72));
}

async function imageInfo(file: Blob) {
  try {
    const bmp = await createImageBitmap(file);
    const thumb = await canvasThumb(bmp, bmp.width, bmp.height);
    const out = { width: bmp.width, height: bmp.height, thumb };
    bmp.close();
    return out;
  } catch { return {}; }
}

function videoInfo(url: string): Promise<{ width?: number; height?: number; durationMs?: number; thumb?: Blob }> {
  return new Promise((resolve) => {
    const v = document.createElement('video');
    v.muted = true; v.preload = 'metadata'; v.src = url;
    const done = (x: { width?: number; height?: number; durationMs?: number; thumb?: Blob }) => { clearTimeout(timer); resolve(x); };
    const timer = setTimeout(() => done({}), 8000);
    v.onerror = () => done({});
    v.onloadedmetadata = () => { v.currentTime = Math.min(0.5, (v.duration || 1) / 4); };
    v.onseeked = async () => {
      const width = v.videoWidth || undefined, height = v.videoHeight || undefined;
      const durationMs = Number.isFinite(v.duration) ? Math.round(v.duration * 1000) : undefined;
      done({ width, height, durationMs, thumb: width && height ? await canvasThumb(v, width, height) : undefined });
    };
  });
}

/** Works out how a picked file is sent: its kind, size, preview picture and a local link to show at once. */
export async function prepareFile(file: File, asFile = false, caption = ''): Promise<FileToSend> {
  const kind = kindFor(file.type, asFile);
  const localUrl = URL.createObjectURL(file);
  const base: FileToSend = { file, kind, name: file.name || (kind === 'image' ? 'Photo' : kind === 'video' ? 'Video' : 'File'), caption, localUrl };
  if (kind === 'image') { const i = await imageInfo(file); return { ...base, ...i, localThumbUrl: localUrl }; }
  if (kind === 'video') { const i = await videoInfo(localUrl); return { ...base, ...i, localThumbUrl: i.thumb ? URL.createObjectURL(i.thumb) : undefined }; }
  return base;
}

/** The best recording format this browser has. */
function recordingType() {
  for (const t of ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4']) if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t)) return t;
  return '';
}

export interface Recording { blob: Blob; durationMs: number; waveform: number[]; url: string }

/**
 * Records a voice note. Samples the loudness ten times a second for the waveform.
 * Stops by itself at 15 minutes.
 */
export class VoiceRecorder {
  private rec?: MediaRecorder;
  private stream?: MediaStream;
  private ctx?: AudioContext;
  private chunks: Blob[] = [];
  private levels: number[] = [];
  private timer?: ReturnType<typeof setInterval>;
  private started = 0;
  onLevel?: (levels: number[], ms: number) => void;
  onLimit?: () => void;

  async start() {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const type = recordingType();
    this.rec = new MediaRecorder(this.stream, type ? { mimeType: type } : undefined);
    this.rec.ondataavailable = (e) => { if (e.data.size) this.chunks.push(e.data); };
    this.ctx = new AudioContext();
    const an = this.ctx.createAnalyser();
    an.fftSize = 512;
    this.ctx.createMediaStreamSource(this.stream).connect(an);
    const buf = new Uint8Array(an.fftSize);
    this.started = Date.now();
    this.rec.start(250);
    this.timer = setInterval(() => {
      an.getByteTimeDomainData(buf);
      let sum = 0;
      for (const v of buf) { const d = (v - 128) / 128; sum += d * d; }
      this.levels.push(Math.min(100, Math.round(Math.sqrt(sum / buf.length) * 300)));
      const ms = Date.now() - this.started;
      this.onLevel?.(this.levels, ms);
      if (ms >= MAX_VOICE_MS) this.onLimit?.();
    }, 100);
  }

  /** Stops and returns the recording, or null if it was too short to keep. */
  async stop(): Promise<Recording | null> {
    const rec = this.rec;
    if (!rec) return null;
    const durationMs = Date.now() - this.started;
    const stopped = new Promise<void>((r) => { rec.onstop = () => r(); });
    if (rec.state !== 'inactive') rec.stop();
    await stopped;
    this.cleanup();
    if (durationMs < 500 || !this.chunks.length) return null;
    const blob = new Blob(this.chunks, { type: (rec.mimeType || 'audio/webm').split(';')[0] });
    return { blob, durationMs, waveform: bars(this.levels, 48), url: URL.createObjectURL(blob) };
  }

  cancel() { if (this.rec && this.rec.state !== 'inactive') this.rec.stop(); this.cleanup(); }
  private cleanup() {
    clearInterval(this.timer);
    this.stream?.getTracks().forEach((t) => t.stop());
    void this.ctx?.close().catch(() => undefined);
    this.rec = undefined;
  }
}

/** Squeezes loudness samples into n bars, scaled so the loudest is 100. */
export function bars(levels: number[], n: number): number[] {
  if (!levels.length) return Array(n).fill(4);
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = Math.floor((i * levels.length) / n), b = Math.max(a + 1, Math.floor(((i + 1) * levels.length) / n));
    const slice = levels.slice(a, b);
    out.push(slice.length ? Math.max(...slice) : 0);
  }
  const peak = Math.max(...out, 1);
  return out.map((v) => Math.max(4, Math.round((v / peak) * 100)));
}

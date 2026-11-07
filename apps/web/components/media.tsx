'use client';
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, MEDIA_LIMITS, clock, dayLabel, formatBytes, formatDuration, kindFor, type ThreadItem } from '@yays/shared';
import { Icon } from '@/lib/icons';
import { useEngine } from '@/lib/chat';
import { prepareFile, VoiceRecorder } from '@/lib/media';
import { Avatar, OvalButton } from './ui';
import { ActionsCtx } from './message-actions';

/**
 * A photo, video or voice note that didn't load: its link may have run out (they last 1–2 hours), so the
 * message is fetched again with a new one. At most once a minute per message.
 */
function useLinkRetry() {
  const engine = useEngine();
  return useCallback((m: ThreadItem) => {
    const id = engine.getState().active;
    if (id && m.seq && !m.upload) void engine.refreshLinks(id, m.seq).catch(() => undefined);
  }, [engine]);
}

/** Fits a picture into the bubble without stretching it. */
function boxSize(w?: number, h?: number) {
  if (!w || !h) return { width: 240, height: 180 };
  const scale = Math.min(260 / w, 260 / h, 1);
  return { width: Math.max(140, Math.round(w * scale)), height: Math.max(100, Math.round(h * scale)) };
}

function UploadOverlay({ m }: { m: ThreadItem }) {
  const engine = useEngine();
  const u = m.upload!;
  const pct = u.total ? Math.round((u.sent / u.total) * 100) : 0;
  return (
    <span className="upload-overlay" role="status" aria-label={u.status === 'failed' ? 'Upload failed' : `Uploading ${pct}%`}>
      {u.status === 'failed' ? (
        <>
          <button type="button" className="upload-btn" aria-label="Retry upload" onClick={() => engine.retryUpload(m.clientId)}><Icon name="refresh" size={20} /></button>
          <span className="upload-text">{u.error ?? 'Upload failed'}</span>
        </>
      ) : (
        <>
          <span className="ring" style={{ ['--p' as string]: `${pct}` }}><button type="button" className="upload-btn" aria-label="Cancel upload" onClick={() => engine.cancelUpload(m.clientId)}><Icon name="close" size={18} /></button></span>
          <span className="upload-text">{formatBytes(u.sent)} of {formatBytes(u.total)} · {pct}%</span>
        </>
      )}
    </span>
  );
}

/** The photo, video, voice note or file inside a bubble. */
export function MediaContent({ m, onOpen }: { m: ThreadItem; onOpen: () => void }) {
  const a = m.attachment!;
  const retry = useLinkRetry();
  if (a.kind === 'image' || a.kind === 'video') {
    const size = boxSize(a.width, a.height);
    const src = a.thumbUrl || (a.kind === 'image' ? a.url : '');
    return (
      <span className="media-box" style={size}>
        <button type="button" className="media-thumb" onClick={onOpen} disabled={!!m.upload} aria-label={a.kind === 'image' ? `Photo${m.text ? `: ${m.text}` : ''}` : `Video, ${formatDuration(a.durationMs ?? 0)}`}>
          {src ? <img src={src} alt="" loading="lazy" draggable={false} onError={() => retry(m)} /> : <span className="media-ph"><Icon name={a.kind === 'video' ? 'video' : 'image'} size={32} /></span>}
          {a.kind === 'video' && !m.upload && <span className="media-play"><Icon name="play" size={26} /></span>}
          {a.kind === 'video' && a.durationMs !== undefined && <span className="media-badge">{formatDuration(a.durationMs)}</span>}
        </button>
        {m.upload && <UploadOverlay m={m} />}
      </span>
    );
  }
  if (a.kind === 'voice') return <span className="voice-wrap"><AudioPlayer m={m} />{m.upload && <UploadOverlay m={m} />}</span>;
  const ext = (/\.([a-z0-9]{1,5})$/i.exec(a.name)?.[1] ?? '').toUpperCase();
  return (
    <span className="file-card">
      <span className="file-icon"><Icon name={a.mime === 'application/pdf' ? 'document' : 'file'} size={22} /></span>
      <span className="file-meta"><strong>{a.name}</strong><span>{formatBytes(a.size)}{ext ? ` · ${ext}` : ''}</span></span>
      {a.url && !m.upload ? <a className="icon-btn" href={a.url} download={a.name} aria-label={`Download ${a.name}`}><Icon name="download" size={18} /></a> : null}
      {m.upload && <UploadOverlay m={m} />}
    </span>
  );
}

const SPEEDS = [1, 1.5, 2];
/** Play/pause, a waveform that fills as it plays (click to seek), time and speed. */
export function AudioPlayer({ m }: { m: ThreadItem }) {
  const a = m.attachment!;
  const retry = useLinkRetry();
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [pos, setPos] = useState(0);
  const [speed, setSpeed] = useState(1);
  const total = a.durationMs ?? 0;
  const wave = a.waveform?.length ? a.waveform : Array(48).fill(30);
  useEffect(() => { if (audio.current) audio.current.playbackRate = speed; }, [speed]);
  const toggle = () => {
    const el = audio.current; if (!el) return;
    if (el.paused) { void el.play().catch(() => setPlaying(false)); } else el.pause();
  };
  const seek = (e: React.MouseEvent<HTMLSpanElement>) => {
    const el = audio.current; if (!el || !total) return;
    const r = e.currentTarget.getBoundingClientRect();
    el.currentTime = ((e.clientX - r.left) / r.width) * (total / 1000);
  };
  const done = total ? Math.min(1, pos / total) : 0;
  return (
    <span className="voice" data-testid="voice">
      <audio ref={audio} src={a.url || undefined} preload="none" onError={() => retry(m)}
        onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => { setPlaying(false); setPos(0); }}
        onTimeUpdate={(e) => setPos(e.currentTarget.currentTime * 1000)} />
      <button type="button" className="voice-play" onClick={toggle} disabled={!a.url} aria-label={playing ? 'Pause' : 'Play voice message'}><Icon name={playing ? 'pause' : 'play'} size={20} /></button>
      <span className="voice-wave" onClick={seek} role="slider" aria-label="Position" aria-valuemin={0} aria-valuemax={Math.round(total / 1000)} aria-valuenow={Math.round(pos / 1000)} tabIndex={-1}>
        {wave.map((h, i) => <span key={i} style={{ height: `${Math.max(8, h)}%`, opacity: i / wave.length < done ? 1 : 0.45 }} />)}
      </span>
      <span className="voice-time">{formatDuration(playing || pos ? pos : total)}</span>
      <button type="button" className="voice-speed" onClick={() => setSpeed(SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length])} aria-label={`Speed ${speed}×`}>{speed}×</button>
    </span>
  );
}

// ---------------- attach sheet (w16) ----------------
interface Picked { file: File; url: string; error?: string }

export function AttachDialog({ files, name, replyToId, onClose, onAdded }: { files: File[]; name: string; replyToId?: string; onClose: () => void; onAdded?: () => void }) {
  const engine = useEngine();
  const s = engine.getState();
  const convId = s.active!;
  const [list, setList] = useState<Picked[]>(() => files.map((f) => ({ file: f, url: URL.createObjectURL(f) })));
  const [asFiles, setAsFiles] = useState(false);
  const [caption, setCaption] = useState('');
  const [busy, setBusy] = useState(false);
  const more = useRef<HTMLInputElement>(null);
  const limitError = (f: File) => { const max = MEDIA_LIMITS[kindFor(f.type, asFiles)]; return f.size > max ? `${formatBytes(f.size)} — over the ${formatBytes(max)} limit` : !f.size ? 'Empty file' : undefined; };
  const rows = list.map((p) => ({ ...p, error: limitError(p.file) }));
  const ok = rows.filter((r) => !r.error);
  const [sel, setSel] = useState(0);
  const selIdx = Math.min(sel, rows.length - 1);
  const cur = rows[selIdx];
  const total = ok.reduce((n, r) => n + r.file.size, 0);
  useEffect(() => { const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; document.addEventListener('keydown', esc); return () => document.removeEventListener('keydown', esc); }, [onClose]);
  const send = async () => {
    setBusy(true);
    try {
      for (const [i, r] of ok.entries()) {
        const f = await prepareFile(r.file, asFiles, i === 0 ? caption : '');
        engine.sendFile(convId, { ...f, replyToId: i === 0 ? replyToId : undefined });
      }
      onAdded?.();
      onClose();
    } catch (e) { setBusy(false); alertErr(e); }
  };
  const alertErr = (e: unknown) => setList((l) => l.map((p, i) => (i === 0 ? { ...p, error: e instanceof ApiError ? e.message : 'Could not send.' } : p)));
  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal modal--wide attach-sheet" role="dialog" aria-modal="true" aria-label={`Send ${list.length} file${list.length === 1 ? '' : 's'} to ${name}`}>
        <div className="modal__head"><h2>Send {list.length} file{list.length === 1 ? '' : 's'} to {name}</h2><span className="modal__close"><OvalButton icon="close" label="Cancel" size="sm" variant="soft" onClick={onClose} /></span></div>
        {cur && (
          <div className="attach-preview">
            {kindFor(cur.file.type, false) === 'image' ? <img src={cur.url} alt={cur.file.name} />
              : kindFor(cur.file.type, false) === 'video' ? <video src={cur.url} muted controls />
              : <span className="attach-preview__file"><Icon name="document" size={40} /><strong>{cur.file.name}</strong><span>{formatBytes(cur.file.size)}</span></span>}
          </div>
        )}
        <div className="attach-grid">
          {rows.map((r, i) => {
            const k = kindFor(r.file.type, asFiles);
            return (
              <span key={r.url} className={`attach-item${r.error ? ' attach-item--bad' : ''}${i === selIdx ? ' attach-item--on' : ''}`} data-testid="attach-item" onClick={() => setSel(i)}>
                {k === 'image' ? <img src={r.url} alt="" /> : <span className="attach-icon"><Icon name={k === 'video' ? 'video' : 'document'} size={22} /></span>}
                <span className="attach-name">{r.file.name}</span>
                <span className="attach-size">{r.error ?? formatBytes(r.file.size)}</span>
                <button type="button" className="icon-btn attach-x" aria-label={`Remove ${r.file.name}`} onClick={(e) => { e.stopPropagation(); setList(list.filter((_, j) => j !== i)); }}><Icon name="close" size={12} /></button>
              </span>
            );
          })}
          <button type="button" className="attach-add" onClick={() => more.current?.click()} aria-label="Add more files"><Icon name="plus" size={20} />Add</button>
          <input ref={more} type="file" multiple hidden onChange={(e) => { const fs = [...(e.target.files ?? [])]; setList([...list, ...fs.map((f) => ({ file: f, url: URL.createObjectURL(f) }))]); e.target.value = ''; }} />
        </div>
        <div className="attach-opts">
          <label className="check-row"><input type="checkbox" checked={asFiles} onChange={(e) => setAsFiles(e.target.checked)} /> Send photos as files (full quality)</label>
          <span className="muted">{ok.length} file{ok.length === 1 ? '' : 's'} · {formatBytes(total)}{rows.length > ok.length ? ` · ${rows.length - ok.length} can’t be sent` : ''}</span>
        </div>
        <div className="attach-send">
          <div className="ys-field ys-field--pill" style={{ flex: 1 }}><label className="ys-field__label sr-only" htmlFor="cap">Caption</label>
            <div className="ys-field__box"><input id="cap" className="ys-input" value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="Add a caption" onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void send(); } }} /></div></div>
          <OvalButton icon="send" label={ok.length > 1 ? `Send ${ok.length}` : 'Send'} size="sm" loading={busy} disabled={!ok.length} onClick={() => void send()} />
        </div>
      </div>
    </div>
  );
}

// ---------------- viewer (w11) ----------------
export function MediaViewer({ items, start, onClose }: { items: ThreadItem[]; start: string; onClose: () => void }) {
  const engine = useEngine();
  const retry = useLinkRetry();
  const media = useMemo(() => items.filter((x) => x.attachment && (x.attachment.kind === 'image' || x.attachment.kind === 'video') && !x.deleted && !x.upload), [items]);
  const [i, setI] = useState(() => Math.max(0, media.findIndex((x) => x.key === start)));
  const [zoom, setZoom] = useState(1);
  const cur = media[Math.min(i, media.length - 1)];
  const act = useContext(ActionsCtx);
  const convId = engine.getState().active;
  const go = useCallback((d: number) => { setZoom(1); setI((x) => Math.min(media.length - 1, Math.max(0, x + d))); }, [media.length]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose(); else if (e.key === 'ArrowRight') go(1); else if (e.key === 'ArrowLeft') go(-1);
      else if (e.key === '+' || e.key === '=') setZoom((z) => Math.min(4, z * 1.25)); else if (e.key === '-') setZoom((z) => Math.max(1, z / 1.25));
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [go, onClose]);
  if (!cur) return null;
  const a = cur.attachment!;
  return (
    <div className="viewer" role="dialog" aria-modal="true" aria-label="Media viewer">
      <div className="viewer__bar">
        <Avatar name={engine.nameOf(cur.senderId)} size={40} />
        <span className="viewer__who"><strong>{engine.nameOf(cur.senderId)}</strong><span>{dayLabel(cur.createdAt)} at {clock(cur.createdAt)} · {i + 1} of {media.length}</span></span>
        <div className="viewer__tools">
          {act && cur.id && <OvalButton icon="reply" label="Reply" size="sm" variant="soft" onClick={() => { onClose(); act.reply(cur); }} />}
          {act && cur.id && <OvalButton icon="forward" label="Forward" size="sm" variant="soft" onClick={() => { onClose(); act.forward(cur); }} />}
          {convId && cur.id && <OvalButton icon="star" label={cur.starred ? 'Unstar' : 'Star'} size="sm" variant="soft" onClick={() => void engine.star(convId, cur.id!, !cur.starred).catch(() => undefined)} />}
          <OvalButton icon="download" label="Download" size="sm" variant="soft" onClick={() => { const l = document.createElement('a'); l.href = a.url; l.download = a.name; l.click(); }} />
          <OvalButton icon="close" label="Close" size="sm" variant="soft" onClick={onClose} />
        </div>
      </div>
      <div className="viewer__stage">
        <span className="viewer__nav">{i > 0 && <OvalButton icon="chevron-left" label="Previous" size="md" variant="soft" onClick={() => go(-1)} />}</span>
        <div className="viewer__media" style={{ transform: `scale(${zoom})` }}>
          {a.kind === 'image' ? <img src={a.url} alt={cur.text || 'Photo'} onError={() => retry(cur)} /> : <video key={a.url} src={a.url} controls autoPlay poster={a.thumbUrl ?? undefined} onError={() => retry(cur)} />}
        </div>
        <span className="viewer__nav">{i < media.length - 1 && <OvalButton icon="chevron-right" label="Next" size="md" variant="soft" onClick={() => go(1)} />}</span>
      </div>
      {cur.text && <p className="viewer__caption">{cur.text}</p>}
      <div className="viewer__strip">
        {media.map((x, j) => (
          <button key={x.key} type="button" aria-label={`Item ${j + 1}`} aria-current={j === i} onClick={() => { setZoom(1); setI(j); }}>
            {x.attachment!.thumbUrl || x.attachment!.kind === 'image' ? <img src={x.attachment!.thumbUrl || x.attachment!.url} alt="" onError={() => retry(x)} /> : <Icon name="video" size={18} />}
          </button>
        ))}
      </div>
      <div className="viewer__keys">
        <span><kbd>←</kbd><kbd>→</kbd> Browse</span>
        <span><button type="button" onClick={() => setZoom((z) => Math.min(4, z * 1.25))} aria-label="Zoom in"><kbd>+</kbd></button><button type="button" onClick={() => setZoom((z) => Math.max(1, z / 1.25))} aria-label="Zoom out"><kbd>−</kbd></button> Zoom</span>
        <span><kbd>Esc</kbd> Close</span>
      </div>
    </div>
  );
}

// ---------------- voice recording ----------------
export function RecorderBar({ convId, replyToId, onDone }: { convId: string; replyToId?: string; onDone: () => void }) {
  const engine = useEngine();
  const rec = useRef<VoiceRecorder | null>(null);
  const [levels, setLevels] = useState<number[]>([]);
  const [ms, setMs] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const finish = useCallback(async (send: boolean) => {
    const r = rec.current; rec.current = null;
    if (!r) return;
    if (!send) { r.cancel(); onDone(); return; }
    const out = await r.stop();
    if (out) engine.sendFile(convId, { file: out.blob, kind: 'voice', name: 'Voice message', durationMs: out.durationMs, waveform: out.waveform, localUrl: out.url, replyToId });
    onDone();
  }, [engine, convId, replyToId, onDone]);
  useEffect(() => {
    const r = new VoiceRecorder();
    rec.current = r;
    r.onLevel = (l, t) => { setLevels(l.slice(-60)); setMs(t); };
    r.onLimit = () => void finish(true);
    r.start().catch((e) => { rec.current = null; setError(e?.name === 'NotAllowedError' ? 'Allow the microphone in your browser to record voice messages.' : 'No microphone was found.'); });
    return () => { rec.current?.cancel(); };
  }, [finish]);
  if (error) return <div className="recorder" role="alert"><span className="composer__error">{error}</span><button type="button" className="link-btn" onClick={onDone}>OK</button></div>;
  return (
    <div className="recorder" role="group" aria-label="Recording voice message">
      <OvalButton icon="trash" label="Cancel" size="sm" variant="ghost" onClick={() => void finish(false)} />
      <span className="rec-dot" aria-hidden />
      <span className="rec-time" data-testid="rec-time">{formatDuration(ms)}</span>
      <span className="rec-wave" aria-hidden>{levels.map((l, i) => <span key={i} style={{ height: `${Math.max(8, l)}%` }} />)}</span>
      <OvalButton icon="send" label="Send" size="md" onClick={() => void finish(true)} />
    </div>
  );
}

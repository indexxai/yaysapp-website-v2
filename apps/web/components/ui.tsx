'use client';
import Link from 'next/link';
import { useRef, type ButtonHTMLAttributes, type CSSProperties, type ReactNode } from 'react';
import { Icon, type IconName } from '@/lib/icons';

const ICON_SIZE = { sm: 16, md: 20, lg: 24, xl: 28 } as const;
type Size = keyof typeof ICON_SIZE;
type Variant = 'primary' | 'soft' | 'secondary' | 'ghost' | 'danger';

/** The only button in YaysApp: an icon inside the brand oval, the label underneath. */
export function OvalButton({ icon, label, size = 'md', variant = 'primary', loading, href, ...rest }:
  { icon: IconName; label: string; size?: Size; variant?: Variant; loading?: boolean; href?: string } & ButtonHTMLAttributes<HTMLButtonElement>) {
  const cls = `ys-ovalbtn ys-ovalbtn--${size} ys-ovalbtn--${variant}`;
  const inner = (
    <>
      <span className="ys-oval">{loading ? <span className="ys-spin" aria-hidden /> : <Icon name={icon} size={ICON_SIZE[size]} />}</span>
      <span className="ys-ovalbtn__label">{label}</span>
    </>
  );
  if (href) return <Link href={href} className={cls} style={{ textDecoration: 'none' }}>{inner}</Link>;
  return <button type="button" className={cls} aria-busy={loading || undefined} disabled={rest.disabled || loading} {...rest}>{inner}</button>;
}

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join('') || '?';
/**
 * A person is their initials on the ember oval (or their photo); a group is the people icon on a sunken oval.
 * `fill` paints the oval in another brand tone (community marks).
 */
export function Avatar({ name, photoUrl, size = 44, online, group, fill }: { name: string; photoUrl?: string | null; size?: number; online?: boolean; group?: boolean; fill?: string }) {
  const style = { width: size, fontSize: Math.round(size * 0.36), ...(fill ? { ['--ys-oval-fill' as string]: fill, ['--ys-oval-ink' as string]: '#ffffff' } : {}) };
  return (
    <span className="ys-avatar" style={{ width: size }}>
      <span className={`ys-oval ${group ? 'ys-oval--sunken' : 'ys-oval--ember'}`} style={style}>
        {photoUrl ? <img src={photoUrl} alt="" /> : group ? <Icon name="people" size={Math.round(size * 0.46)} /> : <span>{initials(name)}</span>}
      </span>
      {online && <span className="ys-avatar__presence" data-testid="online-dot" aria-hidden />}
    </span>
  );
}

export type ArtName = 'chat' | 'gear' | 'hype' | 'reader' | 'selfie' | 'snap' | 'explorer';
const ART_RATIO: Record<ArtName, string> = { chat: '792 / 1200', gear: '1200 / 1016', hype: '1005 / 785', reader: '826 / 1200', selfie: '971 / 1200', snap: '1200 / 1072', explorer: '612 / 1200' };
/** A hand-drawn line drawing painted in one colour (ember by default), always decoration. */
export function LineArt({ name, width, ink, opacity, className, style }: { name: ArtName; width: number; ink?: string; opacity?: number; className?: string; style?: CSSProperties }) {
  return <span aria-hidden className={`ys-lineart${className ? ` ${className}` : ''}`} style={{ ['--ys-art-src' as string]: `url("/lineart/${name}.webp")`, ['--ys-art-ink' as string]: ink ?? 'var(--ember)', width, aspectRatio: ART_RATIO[name], ...(opacity !== undefined ? { opacity } : {}), ...style }} />;
}

/** The brand palette for things that need telling apart (community marks, sender names). No new hues. */
const MARKS = ['var(--ember)', '#7fcc1b', '#b24a7a', '#4f5fa8'];
export const markFill = (id: string) => MARKS[[...id].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7) % MARKS.length]!;

export function Field({ label, hint, error, children, id }: { label: string; hint?: ReactNode; error?: string | null; children: ReactNode; id: string }) {
  return (
    <div className={`ys-field${error ? ' ys-field--error' : ''}`}>
      <label className="ys-field__label" htmlFor={id}>{label}</label>
      <div className="ys-field__box">{children}</div>
      {(error || hint) && <span className="ys-field__hint" id={`${id}-hint`} role={error ? 'alert' : undefined}>{error || hint}</span>}
    </div>
  );
}

export function Banner({ tone = 'danger', children }: { tone?: 'danger' | 'warning' | 'success' | 'info'; children: ReactNode }) {
  const bg = { danger: 'var(--danger-wash)', warning: 'var(--warning-wash)', success: 'var(--success-wash)', info: 'var(--info-wash)' }[tone];
  const fg = { danger: 'var(--danger-ink)', warning: 'var(--warning-ink)', success: 'var(--success-ink)', info: 'var(--info)' }[tone];
  return <div role={tone === 'danger' ? 'alert' : 'status'} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '10px 14px', borderRadius: 16, background: bg, color: fg, fontSize: 14, lineHeight: '20px' }}>
    <Icon name={tone === 'success' ? 'check' : tone === 'info' ? 'info' : 'alert-triangle'} size={18} />
    <span style={{ flex: 1 }}>{children}</span>
  </div>;
}

/** The camera oval for picking a picture (new group, new community). Shows the picked photo once chosen. */
export function PhotoPick({ url, onFile, size = 88, label = 'Add a photo', busy }: { url: string | null; onFile: (f: File) => void; size?: number; label?: string; busy?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <button type="button" className="photo-pick" style={{ width: size }} aria-label={label} onClick={() => input.current?.click()} disabled={busy}>
      <span className="ys-oval ys-oval--wash" style={{ width: size, overflow: 'hidden' }}>
        {busy ? <span className="ys-spin" aria-hidden /> : url ? <img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <Icon name="camera" size={Math.round(size * 0.24)} />}
      </span>
      <input ref={input} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ''; }} />
    </button>
  );
}

/** Shares a link to YaysApp, or copies it when the browser can't share. True when it was copied. */
export async function shareInvite(): Promise<boolean> {
  const url = `${location.origin}/sign-in`, text = 'Chat with me on YaysApp';
  try { if (navigator.share) { await navigator.share({ title: 'YaysApp', text, url }); return false; } } catch { return false; }
  try { await navigator.clipboard.writeText(`${text}: ${url}`); return true; } catch { return false; }
}

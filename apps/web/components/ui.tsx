'use client';
import Link from 'next/link';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
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
export function Avatar({ name, photoUrl, size = 44, online }: { name: string; photoUrl?: string | null; size?: number; online?: boolean }) {
  return (
    <span className="ys-avatar" style={{ width: size }}>
      <span className="ys-oval ys-oval--wash" style={{ width: size, fontSize: size * 0.36 }}>
        {photoUrl ? <img src={photoUrl} alt="" /> : <span>{initials(name)}</span>}
      </span>
      {online && <span className="ys-avatar__presence" data-testid="online-dot" aria-hidden />}
    </span>
  );
}

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

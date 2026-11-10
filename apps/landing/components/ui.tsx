'use client';
import Link from 'next/link';
import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from 'react';
import { Icon, type IconName } from '@/lib/icons';

/* The same buttons, fields and art as the YaysApp web app (apps/web/components/ui.tsx). */

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

export type ArtName = 'chat' | 'gear' | 'hype' | 'reader' | 'selfie' | 'snap' | 'explorer' | 'coins' | 'pay' | 'wallet' | 'lantern' | 'skater' | 'trader' | 'morning';
const ART_RATIO: Record<ArtName, string> = {
  chat: '792 / 1200', gear: '1200 / 1016', hype: '1005 / 785', reader: '826 / 1200', selfie: '971 / 1200', snap: '1200 / 1072', explorer: '612 / 1200',
  coins: '1012 / 1200', pay: '663 / 1200', wallet: '663 / 1200', lantern: '506 / 835', skater: '555 / 1200', trader: '837 / 1200', morning: '717 / 1200',
};
/** Every drawing is shown half as big again as the size asked for, like the web app. */
const ART_SCALE = 1.5;
/** One of the brand drawings, in a single ink (ember by default). Always decoration. */
export function LineArt({ name, width, height, ink, opacity, className, style }: { name: ArtName; width?: number; height?: number; ink?: string; opacity?: number; className?: string; style?: CSSProperties }) {
  if (width !== undefined) width = Math.round(width * ART_SCALE);
  if (height !== undefined) height = Math.round(height * ART_SCALE);
  return <span aria-hidden className={`ys-lineart${className ? ` ${className}` : ''}`} style={{ ['--ys-art-src' as string]: `url("/lineart/${name}.webp")`, ['--ys-art-ink' as string]: ink ?? 'var(--ember)', ...(height !== undefined && width === undefined ? { height } : { width: width ?? 240 }), aspectRatio: ART_RATIO[name], ...(opacity !== undefined ? { opacity } : {}), ...style }} />;
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

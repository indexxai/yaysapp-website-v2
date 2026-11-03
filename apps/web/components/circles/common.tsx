'use client';
import type { CSSProperties, ReactNode } from 'react';
import { ApiError, CIRCLE_CATEGORY_LABEL, type CircleAuthor, type CircleCard, type CircleEventMini, type CircleView, type SchemeMatch } from '@yays/shared';
import { Icon, type IconName } from '@/lib/icons';
import { OvalButton } from '../ui';

export const errText = (e: unknown, f = 'That did not work. Try again.') => (e instanceof ApiError ? e.message : f);
export const offline = (e: unknown) => e instanceof ApiError && e.status === 0;
export const plural = (n: number, w: string) => `${n.toLocaleString()} ${w}${n === 1 ? '' : 's'}`;
export const compact = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1).replace(/\.0$/, '')}k` : String(n));

const FILLS = ['var(--ember)', '#4f5fa8', '#b24a7a', '#7fcc1b', '#2f8f83', '#c7772a'];
const fillFor = (id: string) => FILLS[[...id].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7) % FILLS.length]!;

/** The circle's picture, or its first letter on its own colour. Official BTCY circles get the coin. */
export function CircleMark({ c, size, onBanner }: { c: { id: string; name: string; photoUrl: string | null; official?: boolean }; size: number; onBanner?: boolean }) {
  if (c.photoUrl) return <span className="ys-oval circle-mark" style={{ width: size, overflow: 'hidden' }}><img src={c.photoUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /></span>;
  if (c.official && /bitcoin|btcy/i.test(c.name)) return <span className="ys-oval circle-mark" style={{ width: size, '--ys-oval-fill': onBanner ? '#ffffff' : 'var(--surface)' } as CSSProperties}><img src="/brand/btcy-coin.png" alt="" style={{ width: '62%', height: '62%', objectFit: 'contain' }} /></span>;
  return (
    <span className="ys-oval circle-mark" aria-hidden style={{ width: size, '--ys-oval-fill': fillFor(c.id), '--ys-oval-ink': '#fff', font: `800 ${Math.round(size * 0.38)}px var(--font-display)` } as CSSProperties}>
      {c.name.trim().charAt(0).toUpperCase() || 'C'}
    </span>
  );
}

export function Tag({ kind, children, icon }: { kind: 'official' | 'public' | 'private' | 'warn' | 'danger' | 'muted' | 'ok'; children: ReactNode; icon?: IconName }) {
  return <span className={`ctag ctag--${kind}`}>{icon && <Icon name={icon} size={12} />}{children}</span>;
}
export function CircleTags({ c, count = true }: { c: Pick<CircleCard, 'official' | 'visibility' | 'memberCount' | 'lookalike'>; count?: boolean }) {
  return (
    <span className="ctags">
      {c.official && <Tag kind="official" icon="shield-check">Official</Tag>}
      {c.lookalike && <Tag kind="danger" icon="alert-triangle">Not official</Tag>}
      {c.visibility === 'public' ? <Tag kind="public" icon="globe">Public</Tag> : <Tag kind="private" icon="lock">Private</Tag>}
      {count && <span>{plural(c.memberCount, 'member')}</span>}
    </span>
  );
}
export function AuthorTags({ a }: { a: CircleAuthor }) {
  if (a.official) return <Tag kind="official" icon="shield-check">Official</Tag>;
  if (a.role === 'owner') return <Tag kind="official">Owner</Tag>;
  if (a.role === 'admin') return <Tag kind="official">Admin</Tag>;
  return null;
}
export const categoryLabel = (c: CircleView | CircleCard) => CIRCLE_CATEGORY_LABEL[c.category];

/** A block with an icon: notices, warnings, explanations. */
export function Note({ icon = 'info', tone = 'warning', children }: { icon?: IconName; tone?: 'warning' | 'danger' | 'success' | 'info' | 'plain'; children: ReactNode }) {
  return <div className={`cnote cnote--${tone}`}><span className="cnote__icon"><Icon name={icon} size={16} /></span><div>{children}</div></div>;
}

/** Big centred empty or error state. */
export function State({ icon, title, children, actions, tone = 'ember' }: { icon: IconName; title: string; children?: ReactNode; actions?: ReactNode; tone?: 'ember' | 'plain' | 'danger' | 'success' }) {
  return (
    <div className="cstate">
      <span className={`ys-oval cstate__oval cstate__oval--${tone}`}><Icon name={icon} size={34} /></span>
      <strong>{title}</strong>
      {children && <span className="cstate__text">{children}</span>}
      {actions && <div className="cstate__actions">{actions}</div>}
    </div>
  );
}

/* ---- dates: events show in their own time zone ---- */
const fmt = (iso: string, tz: string, o: Intl.DateTimeFormatOptions) => { try { return new Intl.DateTimeFormat('en-GB', { timeZone: tz, ...o }).format(new Date(iso)); } catch { return new Intl.DateTimeFormat('en-GB', o).format(new Date(iso)); } };
export const monthOf = (iso: string, tz: string) => fmt(iso, tz, { month: 'short' });
export const dayOf = (iso: string, tz: string) => fmt(iso, tz, { day: 'numeric' });
export const timeOf = (iso: string, tz: string) => fmt(iso, tz, { hour: 'numeric', minute: '2-digit', hour12: true }).replace(' ', ' ').toLowerCase();
export const tzName = (iso: string, tz: string) => { try { return new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'short' }).formatToParts(new Date(iso)).find((p) => p.type === 'timeZoneName')?.value ?? tz; } catch { return tz; } };
export const longDay = (iso: string, tz: string) => fmt(iso, tz, { weekday: 'long', day: 'numeric', month: 'long' });
export const shortDay = (iso: string, tz: string) => fmt(iso, tz, { weekday: 'short', day: 'numeric', month: 'short' });
export const span = (a: string, b: string, tz: string) => `${timeOf(a, tz)}–${timeOf(b, tz)}`;

export function DateBlock({ iso, tz, big }: { iso: string; tz: string; big?: boolean }) {
  return <span className={`cdate${big ? ' cdate--big' : ''}`} aria-hidden><small>{monthOf(iso, tz)}</small>{dayOf(iso, tz)}</span>;
}

export function EventMiniRow({ e, href }: { e: CircleEventMini; href: string }) {
  const going = e.myRsvp === 'going' ? `You’re going · ${e.going} going` : e.myRsvp === 'waitlist' ? 'You’re on the waitlist' : e.myRsvp === 'offered' ? 'A seat is waiting for you' : `${e.going} going`;
  return (
    <a href={href} className="cevent-mini" data-testid="event-mini">
      <DateBlock iso={e.startsAt} tz={e.timeZone} />
      <span className="cevent-mini__text">
        <strong>{e.title}</strong>
        <span>{e.mode === 'online' ? 'Online' : e.place.split(',').slice(-1)[0]?.trim() || e.place} · {timeOf(e.startsAt, e.timeZone)} {tzName(e.startsAt, e.timeZone)}</span>
        <span className={e.cancelled ? 'cevent-mini__x' : 'cevent-mini__going'}>{e.cancelled ? 'Cancelled' : going}</span>
      </span>
      <Icon name="chevron-right" size={16} />
    </a>
  );
}

/** Text with the money-scheme parts marked. */
export function Marked({ text, marks }: { text: string; marks: SchemeMatch[] }) {
  const out: ReactNode[] = [];
  let at = 0;
  marks.forEach((m, i) => { if (m.start > at) out.push(text.slice(at, m.start)); out.push(<mark key={i} className="cmark">{text.slice(m.start, m.end)}</mark>); at = m.end; });
  out.push(text.slice(at));
  return <>{out}</>;
}

export function Section({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="ccard">
      <div className="ccard__head"><h3>{title}</h3>{action}</div>
      {children}
    </section>
  );
}

export const BackTo = ({ href, label }: { href: string; label: string }) => <OvalButton icon="arrow-left" label={label} size="sm" variant="secondary" href={href} />;
export const ago = (iso: string) => {
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return 'Just now';
  if (s < 3600) return `${Math.floor(s / 60)} min`;
  if (s < 86400) return `${Math.floor(s / 3600)} h`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)} d`;
  return new Date(iso).toLocaleDateString([], { day: 'numeric', month: 'short' });
};
export const dateShort = (iso: string) => new Date(iso).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });

'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import type { MeProfile } from '@yays/shared';
import { Icon, type IconName } from '@/lib/icons';
import { Avatar } from './ui';
import { useOptionalChatState } from '@/lib/chat';
import { setPrefs, usePrefs } from '@/lib/prefs';
import { fmtPoints, useBalance } from '@/lib/phase2';
import { PopupHost } from './popups';

/** Unread chats and missed calls, as the ember count on the rail. */
function RailBadge({ kind }: { kind: 'chats' | 'calls' }) {
  const s = useOptionalChatState();
  if (!s) return null;
  const n = kind === 'calls' ? s.missedCalls
    : s.order.filter((id) => { const c = s.conversations[id]; return c && (c.unread > 0 || c.markedUnread) && !c.archived && !(c.mutedUntil && Date.parse(c.mutedUntil) > Date.now()); }).length;
  if (!n) return null;
  const label = kind === 'calls' ? `${n} missed call${n === 1 ? '' : 's'}` : `${n} unread chat${n === 1 ? '' : 's'}`;
  return <span className="rail__badge" aria-label={label}>{n > 99 ? '99+' : n}</span>;
}

const NAV: Array<{ href: string; icon: IconName | 'jack'; label: string; badge?: 'chats' | 'calls'; also?: string[] }> = [
  { href: '/chats', icon: 'chats', label: 'Chats', badge: 'chats' },
  { href: '/calls', icon: 'phone', label: 'Calls', badge: 'calls' },
  { href: '/circles', icon: 'people', label: 'Circles', also: ['/communities'] },
  { href: '/explore', icon: 'compass', label: 'Explore', also: ['/earn', '/btcy', '/products'] },
  { href: '/ai', icon: 'jack', label: 'Jack’s AI' },
  { href: '/wallet', icon: 'wallet', label: 'Wallet' },
];

/** IndexxPoints, always in view; opens Earn. */
function PointsChip() {
  const n = useBalance();
  if (n === null) return null;
  return (
    <Link href="/earn" className="rail__points" aria-label={`${fmtPoints(n)} IndexxPoints`}>
      <span className="ys-oval ys-oval--wash" style={{ width: 36 }}><Icon name="star" size={16} /></span>{n >= 100_000 ? `${Math.floor(n / 1000)}k` : fmtPoints(n)}
    </Link>
  );
}

/** Light or dark in one click (Settings › Appearance also has "follow system"). */
function ThemeButton() {
  const prefs = usePrefs();
  const dark = prefs.theme === 'dark' || (prefs.theme === 'system' && typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  return (
    <button type="button" className="ys-ovalbtn rail__tab rail__theme" onClick={() => setPrefs({ theme: dark ? 'light' : 'dark' })} aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}>
      <span className="ys-oval"><Icon name={dark ? 'sun' : 'moon'} size={16} /></span>
      <span className="ys-ovalbtn__label">Theme</span>
    </button>
  );
}

export function AppShell({ me, children, bare }: { me: MeProfile | null; children: ReactNode; bare?: boolean }) {
  const path = usePathname();
  return (
    <div className="app-shell">
      <nav className="rail" aria-label="Main">
        <Link href="/chats" className="rail__logo" aria-label="YaysApp"><img src="/brand/mark.png" alt="" width={40} height={41} /></Link>
        {NAV.map((n) => {
          const on = [n.href, ...(n.also ?? [])].some((h) => path === h || path.startsWith(`${h}/`));
          return (
            <span key={n.href} className="rail__slot">
              <Link href={n.href} aria-current={on ? 'page' : undefined} className={`ys-ovalbtn rail__tab${on ? ' rail__tab--on' : ''}`} style={{ textDecoration: 'none' }}>
                <span className="ys-oval">{n.icon === 'jack' ? <img src="/brand/jack.png" alt="" className="rail__jack" /> : <Icon name={n.icon} size={20} strokeWidth={2} />}</span><span className="ys-ovalbtn__label">{n.label}</span>
              </Link>
              {n.badge && !on && <RailBadge kind={n.badge} />}
            </span>
          );
        })}
        <span style={{ flex: 1 }} />
        <ThemeButton />
        {me && <PointsChip />}
        {me && <Link href="/settings" className="rail__me" aria-label={`Settings and profile: ${me.displayName}`} aria-current={path.startsWith('/settings') ? 'page' : undefined}><Avatar name={me.displayName} photoUrl={me.photoUrl} size={40} /></Link>}
      </nav>
      {me && <PopupHost me={me} />}
      {bare ? <div className="page page--bare">{children}</div> : <main className="page">{children}</main>}
    </div>
  );
}

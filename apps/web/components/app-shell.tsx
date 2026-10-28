'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import type { MeProfile } from '@yays/shared';
import { Icon, type IconName } from '@/lib/icons';
import { Avatar } from './ui';
import { useOptionalChatState } from '@/lib/chat';
import { setPrefs, usePrefs } from '@/lib/prefs';

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

const NAV: Array<{ href: string; icon: IconName; label: string; badge?: 'chats' | 'calls' }> = [
  { href: '/chats', icon: 'chats', label: 'Chats', badge: 'chats' },
  { href: '/calls', icon: 'phone', label: 'Calls', badge: 'calls' },
  { href: '/communities', icon: 'people', label: 'Communities' },
  { href: '/settings', icon: 'settings', label: 'Settings' },
];

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
          const on = path.startsWith(n.href.split('/').slice(0, 2).join('/'));
          return (
            <span key={n.href} className="rail__slot">
              <Link href={n.href} aria-current={on ? 'page' : undefined} className={`ys-ovalbtn rail__tab${on ? ' rail__tab--on' : ''}`} style={{ textDecoration: 'none' }}>
                <span className="ys-oval"><Icon name={n.icon} size={20} strokeWidth={2} /></span><span className="ys-ovalbtn__label">{n.label}</span>
              </Link>
              {n.badge && !on && <RailBadge kind={n.badge} />}
            </span>
          );
        })}
        <span style={{ flex: 1 }} />
        <ThemeButton />
        {me && <Link href="/settings/profile" aria-label={`Me: ${me.displayName}`}><Avatar name={me.displayName} photoUrl={me.photoUrl} size={40} /></Link>}
      </nav>
      {bare ? <div className="page page--bare">{children}</div> : <main className="page">{children}</main>}
    </div>
  );
}

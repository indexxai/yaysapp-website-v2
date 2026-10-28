'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import type { MeProfile } from '@yays/shared';
import { Icon, type IconName } from '@/lib/icons';
import { Avatar } from './ui';

const NAV: Array<{ href: string; icon: IconName; label: string }> = [
  { href: '/chats', icon: 'chats', label: 'Chats' },
  { href: '/communities', icon: 'people', label: 'Communities' },
  { href: '/settings', icon: 'settings', label: 'Settings' },
];

export function AppShell({ me, children, bare }: { me: MeProfile | null; children: ReactNode; bare?: boolean }) {
  const path = usePathname();
  return (
    <div className="app-shell">
      <nav className="rail" aria-label="Main">
        <span className="ys-oval ys-oval--ember" style={{ width: 44, font: '800 18px var(--font-display)' }}>Y</span>
        {NAV.map((n) => {
          const on = path.startsWith(n.href.split('/').slice(0, 2).join('/'));
          return (
            <Link key={n.href} href={n.href} aria-current={on ? 'page' : undefined} className={`ys-ovalbtn ys-ovalbtn--md ys-ovalbtn--${on ? 'primary' : 'ghost'}`} style={{ textDecoration: 'none' }}>
              <span className="ys-oval"><Icon name={n.icon} size={20} /></span><span className="ys-ovalbtn__label">{n.label}</span>
            </Link>
          );
        })}
        <span style={{ flex: 1 }} />
        {me && <Link href="/settings/profile" aria-label="Your profile"><Avatar name={me.displayName} photoUrl={me.photoUrl} size={40} /></Link>}
      </nav>
      {bare ? <div className="page page--bare">{children}</div> : <main className="page">{children}</main>}
    </div>
  );
}

'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import type { MeProfile } from '@yays/shared';
import { api } from '@/lib/api';
import { Icon, type IconName } from '@/lib/icons';
import { disablePush } from '@/lib/push';
import { AppShell } from './app-shell';
import { useMe } from './use-me';
import { Avatar, Banner, OvalButton } from './ui';

export const SECTIONS: Array<{ key: string; href: string; label: string; sub: string; icon: IconName }> = [
  { key: 'profile', href: '/settings/profile', label: 'Profile and account', sub: 'Name, photo, number, two-step', icon: 'key' },
  { key: 'privacy', href: '/settings/privacy', label: 'Privacy', sub: 'Last seen, read receipts, blocked', icon: 'lock' },
  { key: 'notifications', href: '/settings/notifications', label: 'Notifications', sub: 'Desktop alerts, sounds, quiet hours', icon: 'bell' },
  { key: 'appearance', href: '/settings/appearance', label: 'Appearance and chats', sub: 'Theme, text size, export a chat', icon: 'palette' },
  { key: 'starred', href: '/settings/starred', label: 'Starred messages', sub: 'Messages you saved', icon: 'star' },
  { key: 'storage', href: '/settings/storage', label: 'Storage and data', sub: 'What chats take up, this browser’s copy', icon: 'database' },
  { key: 'devices', href: '/settings/devices', label: 'Linked devices', sub: 'Browsers and phones signed in', icon: 'devices' },
  { key: 'help', href: '/settings/help', label: 'Help and support', sub: 'Questions, contact us', icon: 'help' },
];

/**
 * Settings pages (w08, w25–w29): sections on the left, the open one on the right. On a phone the
 * list and a section each take the whole screen, like the chat list and a chat.
 */
export function SettingsFrame({ title, children }: { title?: string; children: (me: MeProfile, setMe: (m: MeProfile) => void) => ReactNode }) {
  const { me, setMe, error } = useMe();
  const path = usePathname();
  const router = useRouter();
  const [leaving, setLeaving] = useState(false);
  const open = SECTIONS.find((s) => path.startsWith(s.href));
  const logOut = async () => { setLeaving(true); await disablePush().catch(() => undefined); await api().logout().catch(() => undefined); router.replace('/sign-in'); };
  return (
    <AppShell me={me} bare>
      <div className={`settings${open ? ' settings--open' : ''}`}>
        <aside className="settings__list" aria-label="Settings sections">
          <div className="chats__head"><h1>Settings</h1></div>
          {me && (
            <Link href="/settings/profile" className="settings__me">
              <Avatar name={me.displayName} photoUrl={me.photoUrl} size={52} />
              <span><strong>{me.displayName}</strong><span>{me.username ? `@${me.username}` : me.phone ?? me.email}</span></span>
            </Link>
          )}
          <nav aria-label="Sections">
            {SECTIONS.map((s) => (
              <Link key={s.key} href={s.href} className="ys-row-item settings__row" aria-current={open?.key === s.key ? 'page' : undefined}>
                <span className="ys-oval ys-oval--wash" style={{ width: 32 }}><Icon name={s.icon} size={16} /></span>
                <span className="ys-row-item__text"><span className="ys-row-item__title">{s.label}</span><span className="ys-row-item__sub">{s.sub}</span></span>
              </Link>
            ))}
          </nav>
          <span style={{ flex: 1 }} />
          <div className="row center" style={{ padding: 14 }}><OvalButton icon="logout" label="Log out of this browser" size="sm" variant="danger" loading={leaving} onClick={() => void logOut()} /></div>
        </aside>
        <main className="settings__pane">
          {open ? (
            <div className="settings__content">
              <div className="settings__title">
                <span className="settings__back"><OvalButton icon="arrow-left" label="Settings" size="sm" variant="ghost" href="/settings" /></span>
                <h2>{title ?? open.label}</h2>
              </div>
              {error && <Banner>{error}</Banner>}
              {me ? children(me, setMe) : !error && <span className="ys-spin" aria-label="Loading" />}
            </div>
          ) : (
            <div className="pane-center pane-welcome">
              <span className="ys-oval ys-oval--wash" style={{ width: 96 }}><Icon name="settings" size={40} /></span>
              <strong>Settings</strong><span>Pick a section on the left.</span>
            </div>
          )}
        </main>
      </div>
    </AppShell>
  );
}

/** A rounded group of settings rows with an optional heading. */
export function Card({ title, children, label }: { title?: string; children: ReactNode; label?: string }) {
  return <section className="set-card" aria-label={label ?? title}>{title && <h3>{title}</h3>}{children}</section>;
}

/** A label, an optional explanation, and a control on the right. */
export function SetRow({ label, hint, children, htmlFor }: { label: string; hint?: ReactNode; children?: ReactNode; htmlFor?: string }) {
  return (
    <div className="set-row">
      <span className="set-row__text">{htmlFor ? <label htmlFor={htmlFor}>{label}</label> : <span>{label}</span>}{hint && <small>{hint}</small>}</span>
      {children}
    </div>
  );
}

/** A small "Saved." line that settles after a moment. */
export function useSaved() {
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const banner = msg ? <Banner tone={msg.tone}>{msg.text}</Banner> : null;
  return {
    banner,
    ok: (text = 'Saved. Changes reach your other devices too.') => { setMsg({ tone: 'success', text }); },
    fail: (text: string) => setMsg({ tone: 'danger', text }),
    clear: () => setMsg(null),
  };
}

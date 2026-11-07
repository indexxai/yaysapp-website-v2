'use client';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState, type ReactNode } from 'react';
import type { MeProfile } from '@yays/shared';
import { api } from '@/lib/api';
import { Icon, type IconName } from '@/lib/icons';
import { disablePush } from '@/lib/push';
import { AppShell } from './app-shell';
import { useMe } from './use-me';
import { Avatar, Banner, LineArt, OvalButton, type ArtName } from './ui';

/** The brand art in the corner of each settings section. */
const SECTION_ART: Record<string, ArtName> = { profile: 'selfie', privacy: 'lantern', notifications: 'morning', appearance: 'gear', starred: 'trader', storage: 'wallet', devices: 'pay', help: 'explorer', indexx: 'coins', socials: 'hype' };

export const SECTIONS: Array<{ key: string; href: string; label: string; sub: string; icon: IconName }> = [
  { key: 'profile', href: '/settings/profile', label: 'Profile and account', sub: 'Name, photo, number, two-step', icon: 'key' },
  { key: 'privacy', href: '/settings/privacy', label: 'Privacy', sub: 'Last seen, read receipts, blocked', icon: 'lock' },
  { key: 'notifications', href: '/settings/notifications', label: 'Notifications', sub: 'Desktop alerts, sounds, quiet hours', icon: 'bell' },
  { key: 'appearance', href: '/settings/appearance', label: 'Appearance and chats', sub: 'Theme, text size, export a chat', icon: 'palette' },
  { key: 'starred', href: '/settings/starred', label: 'Starred messages', sub: 'Messages you saved', icon: 'star' },
  { key: 'storage', href: '/settings/storage', label: 'Storage and data', sub: 'What chats take up, this browser’s copy', icon: 'database' },
  { key: 'devices', href: '/settings/devices', label: 'Linked devices', sub: 'Browsers and phones signed in', icon: 'devices' },
  { key: 'indexx', href: '/settings/indexx', label: 'Indexx account', sub: 'BTCY, products, wallet and withdrawals', icon: 'link' },
  { key: 'socials', href: '/settings/socials', label: 'Social accounts', sub: 'Show your socials on your profile', icon: 'globe' },
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
              <LineArt name="selfie" width={110} opacity={0.14} className="settings__me-art" />
              <Avatar name={me.displayName} photoUrl={me.photoUrl} size={56} />
              <span className="settings__me-text"><strong>{me.displayName}</strong><span>{[me.username ? `@${me.username}` : null, me.phone ?? me.email].filter(Boolean).join(' · ')}</span></span>
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
          {open && SECTION_ART[open.key] && <LineArt key={open.key} name={SECTION_ART[open.key]!} height={220} opacity={0.1} className="settings__art" />}
          {open ? (
            <div className="settings__content">
              <div className="settings__title">
                <ExploreBack />
                <span className="settings__back"><OvalButton icon="arrow-left" label="Settings" size="sm" variant="ghost" href="/settings" /></span>
                <h2>{title ?? open.label}</h2>
              </div>
              {error && <Banner>{error}</Banner>}
              {me ? children(me, setMe) : !error && <span className="ys-spin" aria-label="Loading" />}
            </div>
          ) : (
            <div className="pane-center pane-welcome">
              <div className="pane-welcome__body">
                <LineArt name="gear" width={190} />
                <h2 className="pane-welcome__title" style={{ fontSize: 26 }}>Settings</h2>
                <p>Pick a section on the left.</p>
              </div>
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

/** Opened from Explore (Help, Indexx account): a way back to Explore, on every screen size. */
function ExploreBack() { return <Suspense fallback={null}><ExploreBackInner /></Suspense>; }
function ExploreBackInner() {
  return useSearchParams().get('from') === 'explore' ? <OvalButton icon="arrow-left" label="Explore" size="sm" variant="ghost" href="/explore" /> : null;
}

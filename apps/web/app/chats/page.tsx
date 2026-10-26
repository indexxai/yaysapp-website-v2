'use client';
import { AppShell } from '@/components/app-shell';
import { Banner } from '@/components/ui';
import { useMe } from '@/components/use-me';

export default function Chats() {
  const { me, error } = useMe();
  return (
    <AppShell me={me}>
      <div style={{ maxWidth: 720, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <h1 style={{ margin: 0, font: '800 28px var(--font-display)' }}>Chats</h1>
        {error && <Banner>{error}</Banner>}
        {me && (
          <div className="card" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 6 }} data-testid="chats-ready">
            <strong style={{ fontSize: 17 }}>Welcome, {me.displayName}</strong>
            <span style={{ color: 'var(--ink-soft)', fontSize: 14 }}>
              {me.migrated ? 'Your account from the old YaysApp is connected.' : 'Your account is ready.'} Messaging arrives in the next build.
            </span>
          </div>
        )}
      </div>
    </AppShell>
  );
}

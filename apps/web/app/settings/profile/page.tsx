'use client';
import { useState } from 'react';
import { AppShell } from '@/components/app-shell';
import { ProfileForm } from '@/components/profile-form';
import { SettingsNav } from '@/components/settings-nav';
import { Banner } from '@/components/ui';
import { useMe } from '@/components/use-me';

export default function ProfileSettings() {
  const { me, setMe } = useMe();
  const [saved, setSaved] = useState(false);
  return (
    <AppShell me={me}>
      <div style={{ maxWidth: 640, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <h1 style={{ margin: 0, font: '800 28px var(--font-display)' }}>Settings</h1>
        <SettingsNav />
        {saved && <Banner tone="success">Saved. Changes show on your other devices too.</Banner>}
        {me && (
          <div className="card" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ fontSize: 14, color: 'var(--ink-soft)' }}>
              {me.phone ? <>Phone <strong style={{ color: 'var(--ink)' }}>{me.phone}</strong></> : 'No phone number yet'}
              {' · '}{me.email ? <>Email <strong style={{ color: 'var(--ink)' }}>{me.email}</strong></> : 'No email yet'}
            </div>
            <ProfileForm key={me.username ?? '' + me.photoUrl} me={me} submitLabel="Save" onSaved={(m) => { setMe(m); setSaved(true); }} />
          </div>
        )}
      </div>
    </AppShell>
  );
}

'use client';
import { useEffect, useState } from 'react';
import { ApiError, type MeProfile, type NotificationSettings } from '@yays/shared';
import { api } from '@/lib/api';
import { setPrefs, usePrefs } from '@/lib/prefs';
import { disablePush, enablePush, pushState, type PushState } from '@/lib/push';
import { Switch } from '@/components/group';
import { Card, SetRow, SettingsFrame, useSaved } from '@/components/settings';
import { Banner } from '@/components/ui';

export default function NotificationSettingsPage() {
  return <SettingsFrame>{(me, setMe) => <Notifications me={me} setMe={setMe} />}</SettingsFrame>;
}

function Notifications({ me, setMe }: { me: MeProfile; setMe: (m: MeProfile) => void }) {
  const saved = useSaved();
  const local = usePrefs();
  const [push, setPush] = useState<PushState>('off');
  const n = me.notifications;
  useEffect(() => { setPush(pushState()); }, []);
  // Quiet hours use this browser's time zone.
  const tz = typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'UTC';
  const set = async (v: Partial<NotificationSettings>) => {
    const before = me;
    setMe({ ...me, notifications: { ...n, ...v, quietHours: { ...n.quietHours, ...(v.quietHours ?? {}) } } });
    try { setMe(await api().setNotifications(v)); saved.ok(); } catch (e) { setMe(before); saved.fail(e instanceof ApiError ? e.message : 'Could not save. Try again.'); }
  };
  const toggleDesktop = async (on: boolean) => {
    try {
      if (on) setPush(await enablePush());
      else { await disablePush(true); setPush('off'); }
    } catch { saved.fail('Your browser didn’t allow that. Try again.'); }
  };
  return (
    <>
      {saved.banner}
      {push === 'blocked' && <Banner tone="warning"><strong>Your browser is blocking notifications.</strong> Allow them for this site in the browser’s settings so you don’t miss messages.</Banner>}
      {push === 'unsupported' && <Banner tone="info">This browser can’t show notifications.</Banner>}
      <Card title="Messages">
        <Switch on={push === 'on'} onChange={(v) => void toggleDesktop(v)} disabled={push === 'blocked' || push === 'unsupported'} label="Desktop notifications" hint="Show a notification for new messages when this tab isn’t in front." />
        <Switch on={n.preview} onChange={(v) => void set({ preview: v })} label="Show message preview" hint="Off: notifications only say who it’s from." />
        <Switch on={local.sound} onChange={(v) => setPrefs({ sound: v })} label="Sound" hint="A soft sound for new messages while YaysApp is open in this browser." />
        <Switch on={n.groups} onChange={(v) => void set({ groups: v })} label="Group messages" hint="Off: no notifications for groups. Chats with one person still notify." />
      </Card>
      <Card title="Quiet hours">
        <Switch on={n.quietHours.on} onChange={(v) => void set({ quietHours: { ...n.quietHours, on: v }, timeZone: tz })} label="Mute everything at night" hint="Messages still arrive. You just won’t get notifications." />
        {n.quietHours.on && (
          <SetRow label="From" hint={`Times are in ${n.timeZone === tz ? 'your time zone' : n.timeZone}.`}>
            <input type="time" aria-label="Quiet hours start" className="mini-select" value={n.quietHours.from} onChange={(e) => e.target.value && void set({ quietHours: { ...n.quietHours, from: e.target.value }, timeZone: tz })} />
            <span>to</span>
            <input type="time" aria-label="Quiet hours end" className="mini-select" value={n.quietHours.to} onChange={(e) => e.target.value && void set({ quietHours: { ...n.quietHours, to: e.target.value }, timeZone: tz })} />
          </SetRow>
        )}
      </Card>
      <p className="muted" style={{ fontSize: 13, margin: '0 6px' }}>To mute one chat, open its menu in the chat list or its info.</p>
    </>
  );
}

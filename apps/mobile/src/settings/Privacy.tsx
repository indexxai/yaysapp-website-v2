import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Linking, View } from 'react-native';
import { DEFAULT_NOTIFICATIONS, type Audience, type MeProfile, type NotificationSettings, type PrivacySettings, type PublicProfile } from '@yays/shared';
import { api } from '../lib/api';
import { useEngine } from '../lib/chat';
import { setLocalPrefs } from '../lib/prefs';
import { notificationsAllowed } from '../lib/push';
import { useSession } from '../lib/session';
import { useTheme } from '../lib/theme';
import { Avatar, OvalButton, TextLink } from '../ui/kit';
import { Text } from '../ui/Text';
import { Choice, errText, Group, SettingsPage, SwitchRow, useSaved, ValueRow } from './ui';

const AUDIENCE: Array<[Audience, string]> = [['everyone', 'Everyone'], ['contacts', 'People I chat with'], ['nobody', 'Nobody']];

/** Last seen, profile photo, about, who can add me to groups, read receipts, unknown callers, blocked people. */
export function PrivacyScreen({ me, onBack }: { me: MeProfile; onBack: () => void }) {
  const t = useTheme();
  const s = useSession();
  const engine = useEngine();
  const saved = useSaved();
  const [blocked, setBlocked] = useState<PublicProfile[] | null>(null);
  const p = me.privacy;
  useEffect(() => { void api().then((a) => a.blocked()).then(setBlocked, () => setBlocked([])); }, []);
  const set = async (v: Partial<PrivacySettings>) => {
    const before = me;
    s.setMe({ ...me, privacy: { ...p, ...v } }); // show it right away
    try { s.setMe(await (await api()).setPrivacy(v)); saved.ok(); } catch (e) { s.setMe(before); saved.fail(errText(e)); }
  };
  const unblock = async (u: PublicProfile) => {
    try { await engine.unblock(u.id); setBlocked((b) => b?.filter((x) => x.id !== u.id) ?? null); saved.ok(`${u.displayName} is unblocked.`); }
    catch (e) { saved.fail(errText(e, 'Could not unblock.')); }
  };
  return (
    <SettingsPage title="Privacy" onBack={onBack} art="lantern" testID="privacy-screen">
      {saved.banner}
      <Group title="Last seen and online">
        <Choice value={p.lastSeen} options={AUDIENCE} onChange={(v) => void set({ lastSeen: v })} label="Who can see it" hint="If you don’t share your last seen, you won’t see other people’s." />
      </Group>
      <Group title="Profile and groups">
        <Choice label="Profile photo" value={p.photo} options={AUDIENCE} onChange={(v) => void set({ photo: v })} />
        <Choice label="About" value={p.about} options={AUDIENCE} onChange={(v) => void set({ about: v })} />
        <Choice label="Who can add me to groups" hint="Others can still send you an invite link." value={p.groups} options={[['everyone', 'Everyone'], ['contacts', 'People I chat with']]} onChange={(v) => void set({ groups: v })} />
        <SwitchRow label="Read receipts" hint="Turning off also hides others’ receipts from you. Groups always show them." on={p.readReceipts} onChange={(v) => void set({ readReceipts: v })} />
      </Group>
      <Group title="Calls">
        <SwitchRow label="Silence unknown callers" hint="Calls from people you haven’t chatted with won’t ring. They still show in your call history." on={p.silenceUnknown} onChange={(v) => void set({ silenceUnknown: v })} />
      </Group>
      <Group title={`Blocked${blocked?.length ? ` · ${blocked.length}` : ''}`} testID="blocked-list">
        {blocked === null ? <ActivityIndicator color={t.ember} style={{ margin: 16 }} />
          : !blocked.length ? <Text style={{ fontSize: 14, color: t['ink-soft'], paddingHorizontal: 16, paddingVertical: 12 }}>You haven’t blocked anyone. Block someone from their contact info in a chat.</Text>
            : blocked.map((u) => (
              <View key={u.id} testID="blocked-row" style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 10 }}>
                <Avatar name={u.displayName} photoUrl={u.photoUrl} size={40} />
                <View style={{ flex: 1 }}>
                  <Text style={{ fontWeight: '700', color: t.ink }}>{u.displayName}</Text>
                  {u.username ? <Text style={{ fontSize: 13, color: t['ink-soft'] }}>@{u.username}</Text> : null}
                </View>
                <OvalButton icon="lock" label="Unblock" accessibilityLabel={`Unblock ${u.displayName}`} size="sm" variant="soft" onPress={() => void unblock(u)} />
              </View>
            ))}
      </Group>
    </SettingsPage>
  );
}

const TIMES = Array.from({ length: 48 }, (_, i) => `${String(Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`);
const nice = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number) as [number, number]; return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`; };
/** Half-hour steps back and forth, like the event times. */
function TimeStep({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const t = useTheme();
  const i = Math.max(0, TIMES.indexOf(value));
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      <Text style={{ width: 44, fontWeight: '700', color: t['ink-soft'] }}>{label}</Text>
      <OvalButton icon="minus" label={`${label} earlier`} size="sm" variant="ghost" onPress={() => onChange(TIMES[(i + 47) % 48]!)} />
      <Text accessibilityLabel={`${label} ${nice(value)}`} style={{ minWidth: 80, textAlign: 'center', fontWeight: '800', fontSize: 16, color: t.ink }}>{nice(value)}</Text>
      <OvalButton icon="plus" label={`${label} later`} size="sm" variant="ghost" onPress={() => onChange(TIMES[(i + 1) % 48]!)} />
    </View>
  );
}

/** Previews, groups, sound and quiet hours; the phone's own permission is shown, with a way to its settings. */
export function NotificationsScreen({ me, onBack }: { me: MeProfile; onBack: () => void }) {
  const t = useTheme();
  const s = useSession();
  const saved = useSaved();
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const n = me.notifications ?? DEFAULT_NOTIFICATIONS;
  useEffect(() => { void notificationsAllowed().then(setAllowed); }, []);
  const tz = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return 'UTC'; } })();
  const set = async (v: Partial<NotificationSettings>) => {
    const before = me;
    s.setMe({ ...me, notifications: { ...n, ...v, quietHours: { ...n.quietHours, ...(v.quietHours ?? {}) } } });
    try { s.setMe(await (await api()).setNotifications(v)); saved.ok(); } catch (e) { s.setMe(before); saved.fail(errText(e)); }
  };
  const setSound = async (on: boolean) => {
    const before = me;
    setLocalPrefs({ sound: on });
    try { s.setMe(await (await api()).setPreferences({ sound: on })); saved.ok(); } catch (e) { s.setMe(before); saved.fail(errText(e)); }
  };
  return (
    <SettingsPage title="Notifications" onBack={onBack} art="morning" testID="notifications-screen">
      {saved.banner}
      {allowed === false ? (
        <Group>
          <ValueRow label="Notifications are off for YaysApp" hint="Turn them on in your phone’s settings so you don’t miss messages and calls.">
            <OvalButton icon="settings" label="Phone settings" size="sm" variant="soft" onPress={() => void Linking.openSettings().catch(() => undefined)} />
          </ValueRow>
        </Group>
      ) : null}
      <Group title="Messages">
        <SwitchRow label="Show message preview" hint="Off: notifications only say who it’s from." on={n.preview} onChange={(v) => void set({ preview: v })} />
        <SwitchRow label="Group messages" hint="Off: no notifications for groups. Chats with one person still notify." on={n.groups} onChange={(v) => void set({ groups: v })} />
        <SwitchRow label="Sound" hint="A sound with new message notifications." on={me.preferences.sound} onChange={(v) => void setSound(v)} />
      </Group>
      <Group title="Quiet hours">
        <SwitchRow label="Mute everything at night" hint="Messages still arrive. You just won’t get notifications." on={n.quietHours.on} onChange={(v) => void set({ quietHours: { ...n.quietHours, on: v }, timeZone: tz })} />
        {n.quietHours.on ? (
          <View style={{ paddingHorizontal: 16, paddingBottom: 12, gap: 8 }} testID="quiet-hours">
            <TimeStep label="From" value={n.quietHours.from} onChange={(v) => void set({ quietHours: { ...n.quietHours, from: v }, timeZone: tz })} />
            <TimeStep label="To" value={n.quietHours.to} onChange={(v) => void set({ quietHours: { ...n.quietHours, to: v }, timeZone: tz })} />
            <Text style={{ fontSize: 13, color: t['ink-soft'] }}>Times are in {n.timeZone === tz ? 'your time zone' : n.timeZone}.</Text>
          </View>
        ) : null}
      </Group>
      <Text style={{ fontSize: 13, color: t['ink-soft'], marginHorizontal: 8 }}>To mute one chat, long-press it in the chat list or open its info.</Text>
      {allowed === true ? <View style={{ alignItems: 'center' }}><TextLink label="Open the phone’s notification settings" onPress={() => void Linking.openSettings().catch(() => undefined)} /></View> : null}
    </SettingsPage>
  );
}

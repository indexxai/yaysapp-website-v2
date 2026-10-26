import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { ApiError, type DeviceSession } from '@yays/shared';
import { api } from '../lib/api';
import { useSession } from '../lib/session';
import { font, useTheme } from '../lib/theme';
import { Avatar, Banner, OvalButton } from '../ui/kit';
import { Icon } from '../ui/Icon';
import { Oval } from '../ui/Oval';
import { ProfileForm } from './ProfileForm';
import { Screen } from './Screen';

export function ProfileSetupScreen() {
  const s = useSession();
  if (s.state.status !== 'signedIn') return null;
  return <Screen title="Set up your profile" lead="This is how friends will see you in chats."><ProfileForm me={s.state.me} submitLabel="Continue" onSaved={s.setMe} /></Screen>;
}

export function ChatsScreen({ openSettings }: { openSettings: () => void }) {
  const s = useSession();
  const t = useTheme();
  if (s.state.status !== 'signedIn') return null;
  const me = s.state.me;
  return (
    <Screen background="surface" header={
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' }}>
        <Text accessibilityRole="header" style={{ fontFamily: font.display, fontSize: 30, fontWeight: '800', color: t.ink }}>Chats</Text>
        <OvalButton icon="settings" label="Settings" size="sm" variant="secondary" onPress={openSettings} />
      </View>}>
      {s.state.offline ? <Banner tone="warning">You're offline. We'll reconnect when you're back online.</Banner> : null}
      <View testID="chats-ready" style={{ backgroundColor: t.raised, borderRadius: 24, padding: 20, gap: 6, flexDirection: 'row', alignItems: 'center' }}>
        <Avatar name={me.displayName} photoUrl={me.photoUrl} size={48} />
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={{ fontSize: 17, fontWeight: '700', color: t.ink }}>Welcome, {me.displayName}</Text>
          <Text style={{ fontSize: 14, color: t['ink-soft'] }}>{me.migrated ? 'Your account from the old YaysApp is connected.' : 'Your account is ready.'} Messaging arrives in the next build.</Text>
        </View>
      </View>
    </Screen>
  );
}

export function SettingsScreen({ openDevices }: { openDevices: () => void }) {
  const s = useSession();
  const [saved, setSaved] = useState(false);
  if (s.state.status !== 'signedIn') return null;
  const me = s.state.me;
  return (
    <Screen title="Settings">
      {saved ? <Banner tone="success">Saved. Changes show on your other devices too.</Banner> : null}
      <ProfileForm key={me.username ?? ''} me={me} submitLabel="Save" onSaved={(m) => { s.setMe(m); setSaved(true); }} />
      <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 32 }}>
        <OvalButton icon="devices" label="Linked devices" variant="secondary" onPress={openDevices} />
        <OvalButton icon="logout" label="Log out" variant="danger" onPress={() => Alert.alert('Log out of YaysApp?', 'You can sign in again any time with your phone or email.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Log out', style: 'destructive', onPress: () => void s.signOut() }])} />
      </View>
    </Screen>
  );
}

export function DevicesScreen() {
  const t = useTheme();
  const [list, setList] = useState<DeviceSession[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: 'danger' | 'success'; text: string } | null>(null);
  const load = useCallback(async () => { try { setList(await (await api()).devices()); } catch (e) { setMsg({ tone: 'danger', text: e instanceof ApiError ? e.message : 'Could not load devices.' }); } }, []);
  useEffect(() => { void load(); }, [load]);
  const act = async (id: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(id); setMsg(null);
    try { await fn(); setMsg({ tone: 'success', text: ok }); await load(); } catch (e) { setMsg({ tone: 'danger', text: e instanceof ApiError ? e.message : 'That did not work. Try again.' }); } finally { setBusy(null); }
  };
  return (
    <Screen title="Linked devices" lead="Use YaysApp on your phone, the web and other devices. Log out any you don't recognise.">
      {msg ? <Banner tone={msg.tone}>{msg.text}</Banner> : null}
      <View style={{ backgroundColor: t.raised, borderRadius: 24, overflow: 'hidden' }}>
        {list?.map((d, i) => (
          <View key={d.id} testID="device-row" style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderTopWidth: i ? 1 : 0, borderTopColor: t.line, backgroundColor: d.current ? t['ember-wash'] : undefined }}>
            <Oval width={40} fill={t['ember-wash']}><Icon name={d.platform === 'web' ? 'globe' : 'phone'} size={18} color={t['ember-ink']} /></Oval>
            <View style={{ flex: 1 }}>
              <Text style={{ fontWeight: '700', fontSize: 15, color: t.ink }}>{d.name}</Text>
              <Text style={{ fontSize: 13, color: d.current ? t['success-ink'] : t['ink-soft'], fontWeight: d.current ? '700' : '400' }}>{d.current ? 'This phone · active now' : `Last active ${new Date(d.lastActiveAt).toLocaleString()}`}</Text>
            </View>
            {!d.current ? <OvalButton icon="logout" label="Log out" size="sm" variant="danger" loading={busy === d.id} onPress={() => act(d.id, async () => (await api()).revokeDevice(d.id), `${d.name} was logged out.`)} /> : null}
          </View>
        ))}
      </View>
      {list && list.length > 1 ? <View style={{ alignItems: 'center' }}><OvalButton icon="logout" label="Log out all other devices" variant="danger" loading={busy === 'others'} onPress={() => act('others', async () => (await api()).revokeOtherDevices(), 'All other devices were logged out.')} /></View> : null}
    </Screen>
  );
}

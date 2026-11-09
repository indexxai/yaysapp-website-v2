import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Image, Pressable, ScrollView, Share, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MAX_GROUP_ABOUT, MAX_GROUP_NAME, type ChatOverview, type ConversationSummary, type GroupInfo, type PublicProfile, type ReportReason } from '@yays/shared';
import { api } from '../lib/api';
import { useChatState, useEngine } from '../lib/chat';
import { config } from '../lib/config';
import { useTheme } from '../lib/theme';
import { Icon, type IconName } from '../ui/Icon';
import { Avatar, Banner, Field, OvalButton } from '../ui/kit';
import { Oval } from '../ui/Oval';
import { Text } from '../ui/Text';
import { errText } from './messages';

const H1 = { fontFamily: 'Outfit', fontSize: 30, lineHeight: 36, fontWeight: '800' as const };

/** People you already chat with one-to-one: who you can put in a group. */
function useContacts(exclude: string[] = []) {
  const s = useChatState();
  return s.order.map((id) => s.conversations[id]).filter((c): c is ConversationSummary => !!c && c.kind === 'direct' && !!c.peer && !c.blocked && !exclude.includes(c.peer.id)).map((c) => c.peer!);
}

function PeoplePicker({ people, picked, toggle }: { people: PublicProfile[]; picked: string[]; toggle: (id: string) => void }) {
  const t = useTheme();
  return (
    <FlatList data={people} keyExtractor={(p) => p.id} style={{ flex: 1 }}
      ListEmptyComponent={<Text style={{ padding: 20, color: t['ink-soft'], textAlign: 'center' }}>Start a chat with someone first, then you can add them here.</Text>}
      renderItem={({ item }) => {
        const on = picked.includes(item.id);
        return (
          <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: on }} accessibilityLabel={item.displayName} onPress={() => toggle(item.id)} style={styles.row}>
            <Avatar name={item.displayName} photoUrl={item.photoUrl} size={44} />
            <View style={{ flex: 1 }}>
              <Text style={{ fontWeight: '700', fontSize: 16, color: t.ink }}>{item.displayName}</Text>
              {item.username ? <Text style={{ fontSize: 13, color: t['ink-soft'] }}>@{item.username}</Text> : null}
            </View>
            <Oval width={28} fill={on ? t.ember : t.sunken}>{on ? <Icon name="check" size={16} color={t['on-ember']} /> : null}</Oval>
          </Pressable>
        );
      }} />
  );
}

/** Name the group, pick who's in it. */
export function NewGroupScreen({ onCreated }: { onCreated: (id: string) => void }) {
  const t = useTheme();
  const engine = useEngine();
  const people = useContacts();
  const [name, setName] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const create = async () => {
    setBusy(true); setError(null);
    try { onCreated((await engine.createGroup({ name: name.trim(), memberIds: picked })).id); }
    catch (e) { setError(errText(e, 'Could not create the group.')); setBusy(false); }
  };
  return (
    <SafeAreaView edges={['bottom', 'left', 'right']} style={{ flex: 1, backgroundColor: t.ground }}>
      <View style={{ paddingHorizontal: 20, gap: 12 }}>
        <Text accessibilityRole="header" style={[H1, { color: t.ink }]}>New group</Text>
        {error ? <Banner>{error}</Banner> : null}
        <Field label="Group name" value={name} onChangeText={setName} maxLength={MAX_GROUP_NAME} placeholder="Weekend trip" />
        <Text style={{ fontFamily: 'Outfit', fontWeight: '800', fontSize: 15, color: t.ink }}>Add people{picked.length ? ` · ${picked.length}` : ''}</Text>
      </View>
      <PeoplePicker people={people} picked={picked} toggle={(id) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))} />
      <View style={{ padding: 16, alignItems: 'center', borderTopWidth: 1, borderTopColor: t.line }}>
        <OvalButton icon="check" label="Create group" loading={busy} disabled={!name.trim() || !picked.length} onPress={() => void create()} />
      </View>
    </SafeAreaView>
  );
}

/** Add people to a group you can add to. */
export function AddMembersScreen({ id, onDone }: { id: string; onDone: () => void }) {
  const t = useTheme();
  const engine = useEngine();
  const s = useChatState();
  const people = useContacts(s.groups[id]?.members.map((m) => m.id) ?? []);
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const add = async () => {
    setBusy(true); setError(null);
    try { await engine.addMembers(id, picked); onDone(); } catch (e) { setError(errText(e, 'Could not add them.')); setBusy(false); }
  };
  return (
    <SafeAreaView edges={['bottom', 'left', 'right']} style={{ flex: 1, backgroundColor: t.ground }}>
      <View style={{ paddingHorizontal: 20, gap: 12 }}>
        <Text accessibilityRole="header" style={[H1, { color: t.ink }]}>Add members</Text>
        {error ? <Banner>{error}</Banner> : null}
      </View>
      <PeoplePicker people={people} picked={picked} toggle={(x) => setPicked((p) => (p.includes(x) ? p.filter((y) => y !== x) : [...p, x]))} />
      <View style={{ padding: 16, alignItems: 'center', borderTopWidth: 1, borderTopColor: t.line }}>
        <OvalButton icon="person-add" label="Add" loading={busy} disabled={!picked.length} onPress={() => void add()} />
      </View>
    </SafeAreaView>
  );
}

function Row({ icon, label, sub, onPress, danger, testID }: { icon: IconName; label: string; sub?: string; onPress: () => void; danger?: boolean; testID?: string }) {
  const t = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} testID={testID} style={({ pressed }) => [styles.row, { backgroundColor: pressed ? t.sunken : 'transparent' }]}>
      <Icon name={icon} size={20} color={danger ? t['danger-ink'] : t['ink-soft']} />
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 15, fontWeight: '600', color: danger ? t['danger-ink'] : t.ink }}>{label}</Text>
        {sub ? <Text style={{ fontSize: 13, color: t['ink-soft'] }}>{sub}</Text> : null}
      </View>
    </Pressable>
  );
}
function Card({ children, title }: { children: React.ReactNode; title?: string }) {
  const t = useTheme();
  return (
    <View style={{ gap: 6 }}>
      {title ? <Text style={{ fontFamily: 'Outfit', fontWeight: '800', fontSize: 15, color: t.ink, paddingHorizontal: 4 }}>{title}</Text> : null}
      <View style={{ backgroundColor: t.raised, borderRadius: 22, overflow: 'hidden' }}>{children}</View>
    </View>
  );
}

const muteSub = (c: ConversationSummary) => {
  if (!c.mutedUntil || Date.parse(c.mutedUntil) <= Date.now()) return 'Off';
  return new Date(c.mutedUntil).getFullYear() > new Date().getFullYear() + 50 ? 'Always' : `Until ${new Date(c.mutedUntil).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })}`;
};

/** Tap the chat's header: who it is (or the group), shared media, and what you can do with the chat. */
export function ChatInfoScreen({ id, openChat, openAddMembers, onLeft }: { id: string; openChat: (id: string) => void; openAddMembers: () => void; onLeft: () => void }) {
  const t = useTheme();
  const engine = useEngine();
  const s = useChatState();
  const c = s.conversations[id];
  const g: GroupInfo | undefined = s.groups[id];
  const [o, setO] = useState<ChatOverview | null>(null);
  const [notice, setNotice] = useState<{ text: string; tone: 'danger' | 'success' } | null>(null);
  const [name, setName] = useState('');
  const [about, setAbout] = useState('');
  const load = useCallback(async () => {
    try { setO(await (await api()).chatOverview(id)); } catch { /* the rest still works */ }
    if (engine.getState().conversations[id]?.kind === 'group') { const info = await engine.loadGroup(id).catch(() => null); if (info) { setName(info.name); setAbout(info.about); } }
  }, [engine, id]);
  useEffect(() => { void load(); }, [load]);
  if (!c) return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: t.ground }}><ActivityIndicator color={t.ember} /></View>;
  const group = c.kind === 'group';
  const run = async (fn: () => Promise<unknown>, ok?: string, after?: () => void) => {
    setNotice(null);
    try { await fn(); if (ok) setNotice({ text: ok, tone: 'success' }); after?.(); } catch (e) { setNotice({ text: errText(e, 'That did not work. Try again.'), tone: 'danger' }); }
  };
  const confirm = (title: string, message: string, label: string, fn: () => void) => Alert.alert(title, message, [{ text: 'Cancel', style: 'cancel' }, { text: label, style: 'destructive', onPress: fn }]);
  const mute = () => Alert.alert('Mute notifications', 'You won’t be notified of new messages in this chat.', [
    { text: '8 hours', onPress: () => void run(() => engine.setChatPrefs(id, { mute: '8h' }), 'Muted for 8 hours.') },
    { text: '1 week', onPress: () => void run(() => engine.setChatPrefs(id, { mute: '1w' }), 'Muted for a week.') },
    { text: 'Always', onPress: () => void run(() => engine.setChatPrefs(id, { mute: 'always' }), 'Muted.') },
    ...(c.mutedUntil && Date.parse(c.mutedUntil) > Date.now() ? [{ text: 'Unmute', onPress: () => void run(() => engine.setChatPrefs(id, { mute: 'off' }), 'Unmuted.') }] : []),
    { text: 'Cancel', style: 'cancel' as const },
  ]);
  const report = () => {
    const send = (reason: ReportReason) => void run(() => engine.report(group ? { conversationId: id, reason } : { userId: c.peer!.id, conversationId: id, reason }), 'Thanks. Our team will look at it.');
    Alert.alert(group ? 'Report this group?' : `Report ${c.peer?.displayName}?`, 'YaysApp’s team will see the latest messages in this chat.', [
      { text: 'Spam', onPress: () => send('spam') }, { text: 'Scam or harassment', onPress: () => send('harassment') }, { text: 'Cancel', style: 'cancel' },
    ]);
  };
  const shared = (
    <Card title="Media, links and docs">
      <View style={{ flexDirection: 'row', justifyContent: 'space-around', paddingVertical: 12 }}>
        {(['media', 'docs', 'links'] as const).map((k) => (
          <View key={k} style={{ alignItems: 'center' }}>
            <Text style={{ fontFamily: 'Outfit', fontWeight: '800', fontSize: 20, color: t.ink }}>{o ? o.counts[k] : '…'}</Text>
            <Text style={{ fontSize: 12, color: t['ink-soft'] }}>{k === 'media' ? 'Photos and videos' : k === 'docs' ? 'Documents' : 'Links'}</Text>
          </View>
        ))}
      </View>
      {o?.recentMedia.length ? (
        <View style={{ flexDirection: 'row', gap: 6, paddingHorizontal: 12, paddingBottom: 12 }}>
          {o.recentMedia.slice(0, 4).map((m) => (
            <Image key={m.id} source={{ uri: m.attachment?.thumbUrl || m.attachment?.url }} style={{ flex: 1, aspectRatio: 1, borderRadius: 12, backgroundColor: t.sunken }} accessibilityLabel={m.attachment?.kind === 'video' ? 'Video' : 'Photo'} />
          ))}
        </View>
      ) : null}
    </Card>
  );
  const chatRows = (
    <Card>
      <Row icon="bell-off" label="Mute notifications" sub={muteSub(c)} onPress={mute} />
      <Row icon="pin" label={c.pinnedAt ? 'Unpin chat' : 'Pin chat'} onPress={() => void run(() => engine.setChatPrefs(id, { pinned: !c.pinnedAt }), c.pinnedAt ? 'Unpinned.' : 'Pinned to the top of your chats.')} />
      <Row icon="archive" label={c.archived ? 'Unarchive chat' : 'Archive chat'} onPress={() => void run(() => engine.setChatPrefs(id, { archived: !c.archived }), c.archived ? 'Back in your chats.' : 'Archived.')} />
    </Card>
  );

  if (!group) {
    const p = c.peer!;
    return (
      <SafeAreaView edges={['bottom', 'left', 'right']} style={{ flex: 1, backgroundColor: t.ground }} testID="contact-info">
        <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }}>
          <View style={{ alignItems: 'center', gap: 6, paddingVertical: 8 }}>
            <Avatar name={p.displayName} photoUrl={p.photoUrl} size={96} />
            <Text accessibilityRole="header" style={{ fontFamily: 'Outfit', fontWeight: '800', fontSize: 24, color: t.ink }}>{p.displayName}</Text>
            {p.username ? <Text style={{ color: t['ink-soft'], fontSize: 15 }}>@{p.username}</Text> : null}
            {p.about ? <Text style={{ color: t.ink, fontSize: 15, textAlign: 'center' }}>{p.about}</Text> : null}
          </View>
          {notice ? <Banner tone={notice.tone}>{notice.text}</Banner> : null}
          {shared}
          {chatRows}
          {o?.commonGroups.length ? (
            <Card title={`${o.commonGroups.length} group${o.commonGroups.length === 1 ? '' : 's'} in common`}>
              {o.commonGroups.map((x) => (
                <Pressable key={x.id} accessibilityRole="button" accessibilityLabel={`Open ${x.name}`} onPress={() => openChat(x.id)} style={styles.row}>
                  <Avatar name={x.name} photoUrl={x.photoUrl} size={36} />
                  <Text style={{ flex: 1, fontWeight: '700', color: t.ink }}>{x.name}</Text>
                  <Text style={{ fontSize: 12, color: t['ink-soft'] }}>{x.memberCount} members</Text>
                </Pressable>
              ))}
            </Card>
          ) : null}
          <Card>
            {c.blocked
              ? <Row icon="block" label={`Unblock ${p.displayName}`} onPress={() => void run(() => engine.unblock(p.id), `${p.displayName} is unblocked.`)} />
              : <Row icon="block" label={`Block ${p.displayName}`} danger onPress={() => confirm(`Block ${p.displayName}?`, 'They won’t be able to message or call you, or see when you’re online.', 'Block', () => void run(() => engine.block(p.id), `${p.displayName} is blocked.`))} />}
            <Row icon="flag" label={`Report ${p.displayName}`} danger onPress={report} />
            <Row icon="trash" label="Clear chat" danger onPress={() => confirm('Clear this chat?', 'All messages will be removed for you.', 'Clear', () => void run(() => engine.clearChat(id), 'Chat cleared.'))} />
            <Row icon="trash" label="Delete chat" danger onPress={() => confirm('Delete this chat?', 'It will be removed from your chats on all your devices.', 'Delete', () => void run(() => engine.deleteChat(id), undefined, onLeft))} />
          </Card>
        </ScrollView>
      </SafeAreaView>
    );
  }

  const me = engine.me;
  const role = g?.role ?? c.group?.role;
  const admin = role === 'admin';
  const member = role !== 'former';
  const settings = g?.settings ?? c.group?.settings;
  const canEdit = member && (admin || settings?.editInfo === 'all');
  const canAdd = member && !g?.announcements && (admin || settings?.addMembers === 'all');
  const link = g?.inviteCode ? `${config.webUrl}/join/${g.inviteCode}` : null;
  const memberActions = (m: GroupInfo['members'][number]) => {
    if (m.id === me) return;
    Alert.alert(m.displayName, undefined, [
      { text: 'Message', onPress: () => void engine.startDirect(m.id).then((d) => openChat(d.id)).catch((e) => setNotice({ text: errText(e, 'Could not open the chat.'), tone: 'danger' })) },
      ...(admin && !m.owner ? [{ text: m.admin ? 'Dismiss as admin' : 'Make admin', onPress: () => void run(() => engine.setAdmin(id, m.id, !m.admin), m.admin ? `${m.displayName} is no longer an admin.` : `${m.displayName} is now an admin.`) }] : []),
      ...(admin && !m.owner ? [{ text: 'Remove from group', style: 'destructive' as const, onPress: () => void run(() => engine.removeMember(id, m.id), `${m.displayName} was removed.`) }] : []),
      { text: 'Cancel', style: 'cancel' as const },
    ]);
  };
  return (
    <SafeAreaView edges={['bottom', 'left', 'right']} style={{ flex: 1, backgroundColor: t.ground }} testID="group-info">
      <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }} keyboardShouldPersistTaps="handled">
        <View style={{ alignItems: 'center', gap: 6, paddingVertical: 8 }}>
          <Avatar name={c.group?.name ?? 'Group'} photoUrl={c.group?.photoUrl} size={96} />
          <Text accessibilityRole="header" style={{ fontFamily: 'Outfit', fontWeight: '800', fontSize: 24, color: t.ink, textAlign: 'center' }}>{c.group?.name}</Text>
          <Text style={{ color: t['ink-soft'], fontSize: 14 }}>Group · {c.group?.memberCount ?? 0} members</Text>
        </View>
        {notice ? <Banner tone={notice.tone}>{notice.text}</Banner> : null}
        {canEdit && g ? (
          <Card title="Name and description">
            <View style={{ padding: 12, gap: 12 }}>
              <Field label="Group name" value={name} onChangeText={setName} maxLength={MAX_GROUP_NAME} />
              <Field label="Description" value={about} onChangeText={setAbout} maxLength={MAX_GROUP_ABOUT} multiline placeholder="What's this group for?" />
              <View style={{ alignItems: 'center' }}>
                <OvalButton icon="check" label="Save" size="sm" disabled={!name.trim() || (name.trim() === g.name && about.trim() === g.about)} onPress={() => void run(() => engine.updateGroup(id, { name: name.trim(), about: about.trim() }), 'Saved.')} />
              </View>
            </View>
          </Card>
        ) : g?.about ? <Text style={{ color: t.ink, fontSize: 15, textAlign: 'center' }}>{g.about}</Text> : null}
        {shared}
        {member ? chatRows : null}
        <Card title={`${g?.members.length ?? c.group?.memberCount ?? 0} members`}>
          {canAdd ? <Row icon="person-add" label="Add members" onPress={openAddMembers} /> : null}
          {link ? <Row icon="link" label="Invite with a link" sub={link} onPress={() => void Share.share({ message: `Join “${c.group?.name}” on YaysApp: ${link}` })} /> : null}
          {!g ? <ActivityIndicator color={t.ember} style={{ margin: 16 }} /> : g.members.map((m) => (
            <Pressable key={m.id} accessibilityRole="button" accessibilityLabel={`${m.displayName}${m.admin ? ', admin' : ''}`} testID="member-row" onPress={() => memberActions(m)} style={styles.row}>
              <Avatar name={m.displayName} photoUrl={m.photoUrl} size={40} />
              <View style={{ flex: 1 }}>
                <Text style={{ fontWeight: '700', fontSize: 15, color: t.ink }}>{m.id === me ? 'You' : m.displayName}</Text>
                {m.about ? <Text numberOfLines={1} style={{ fontSize: 13, color: t['ink-soft'] }}>{m.about}</Text> : null}
              </View>
              {m.admin ? <View style={[styles.tag, { backgroundColor: t['ember-wash'] }]}><Icon name="crown" size={12} color={t['ember-ink']} /><Text style={{ fontSize: 11, fontWeight: '800', color: t['ember-ink'] }}>{m.owner ? 'Owner' : 'Admin'}</Text></View> : null}
            </Pressable>
          ))}
        </Card>
        <Card>
          <Row icon="flag" label="Report group" danger onPress={report} />
          <Row icon="trash" label="Clear chat" danger onPress={() => confirm('Clear this chat?', 'All messages in this group will be removed for you.', 'Clear', () => void run(() => engine.clearChat(id), 'Chat cleared.'))} />
          {g?.announcements && member ? null : member
            ? <Row icon="logout" label="Exit group" danger onPress={() => confirm(`Exit ${c.group?.name}?`, 'You won’t get its messages any more. Its history stays in your chats.', 'Exit', () => void run(() => engine.leaveGroup(id), 'You left the group.'))} />
            : <Row icon="trash" label="Delete group" danger onPress={() => confirm('Delete this group?', 'It and its messages will be removed from your chats.', 'Delete', () => void run(() => engine.deleteGroup(id), undefined, onLeft))} />}
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 12 },
  tag: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
});

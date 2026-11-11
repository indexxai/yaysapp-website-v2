import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text, TextInput } from '../ui/Text';
import { CallButtons } from '../calls/Calls';
import { clearChat } from '../lib/push';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiError, DELETE_FOR_EVERYONE_MINUTES, MAX_FORWARD_TARGETS, MAX_TEXT, attachmentLabel, messagePreview, systemText, textLength, tickFor, type ConversationSummary, type MeProfile, type MessageInfo, type PublicProfile, type ReportReason, type ThreadItem } from '@yays/shared';
import { AttachSheet, MediaBody, MediaViewer, RecordingBar, useVoiceRecorder } from '../chat/MediaParts';
import { fromCamera, pickFiles, pickMedia, type Picked } from '../chat/media';
import { MentionList, PollCard } from '../chat/PollParts';
import { ChatActionsSheet, FilterTabs, hasUnread, type ListFilter } from '../chat/ListParts';
import { LineArt } from '../ui/LineArt';
import { ActionsCtx, Bubble, CallLine, ComposeBar, MessageSheet, SystemLine, TickMark, canDeleteForEveryone, errText, type Actions } from '../chat/messages';
import { dayLabel, lastSeen, listTime, useChatState, useEngine } from '../lib/chat';
import { font, useTheme, type Theme } from '../lib/theme';
import { Avatar, Banner, Field, OvalButton } from '../ui/kit';
import { Icon } from '../ui/Icon';
import { Oval } from '../ui/Oval';

function ConnectionNotice() {
  const s = useChatState();
  const t = useTheme();
  if (s.connection === 'online') return null;
  const waiting = s.outbox.filter((p) => p.status === 'pending').length;
  return (
    <View accessibilityRole="alert" style={[styles.notice, { backgroundColor: t['warning-wash'] }]}>
      <ActivityIndicator size="small" color={t['warning-ink']} />
      <Text style={{ flex: 1, color: t['warning-ink'], fontWeight: '600', fontSize: 13, lineHeight: 18 }}>
        {s.connection === 'connecting' ? 'Connecting…' : 'Waiting for network.'}{waiting ? ` ${waiting} message${waiting > 1 ? 's' : ''} will send when you're back online.` : ''}
      </Text>
    </View>
  );
}

// ---------------- chat list ----------------
export function ChatListScreen({ me, openChat, openNewChat, openNewGroup, openSearch, openArchived }: { me: MeProfile; openChat: (id: string) => void; openNewChat: () => void; openNewGroup: () => void; openSearch: () => void; openArchived: () => void }) {
  const t = useTheme();
  const s = useChatState();
  const engine = useEngine();
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<ListFilter>('all');
  const [actions, setActions] = useState<ConversationSummary | null>(null);
  const [notice, setNotice] = useState<{ text: string; tone: 'danger' | 'success' } | null>(null);
  useEffect(() => { if (!notice) return; const tm = setTimeout(() => setNotice(null), 3000); return () => clearTimeout(tm); }, [notice]);
  const all = s.order.map((id) => s.conversations[id]).filter((c): c is ConversationSummary => !!c);
  const main = all.filter((c) => !c.archived);
  const archived = all.filter((c) => c.archived);
  const unread = main.filter(hasUnread).length;
  const rows = main.filter((c) => filter === 'all' || (filter === 'unread' ? hasUnread(c) : c.kind === 'group'));
  const archivedUnread = archived.filter(hasUnread).length;
  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={{ flex: 1, backgroundColor: t.ground }}>
      <View style={styles.listHead}>
        <Text accessibilityRole="header" style={[styles.h1, { color: t.ink }]}>Chats</Text>
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <OvalButton icon="search" label="Search" size="sm" variant="secondary" onPress={openSearch} />
          <OvalButton icon="users" label="New group" size="sm" variant="soft" onPress={openNewGroup} />
          <OvalButton icon="edit" label="New chat" size="sm" onPress={openNewChat} />
        </View>
      </View>
      {main.length || archived.length ? <FilterTabs value={filter} onChange={setFilter} unread={unread} /> : null}
      <ConnectionNotice />
      {notice ? <View style={{ paddingHorizontal: 12, paddingBottom: 6 }}><Banner tone={notice.tone}>{notice.text}</Banner></View> : null}
      {!s.listLoaded && !all.length ? (s.connection === 'offline'
        ? <Text style={{ textAlign: 'center', margin: 32, color: t['ink-soft'], fontSize: 15 }}>Your chats will load when you're back online.</Text>
        : <ActivityIndicator style={{ marginTop: 40 }} color={t.ember} />) : (
        <FlatList
          testID="chat-list"
          data={rows}
          keyExtractor={(c) => c.id}
          refreshing={refreshing}
          onRefresh={() => { setRefreshing(true); void engine.loadList().finally(() => setRefreshing(false)); }}
          onEndReached={() => { if (s.listNext && filter === 'all') void engine.loadList(true); }}
          ListHeaderComponent={filter === 'all' && archived.length ? (
            <Pressable accessibilityRole="button" accessibilityLabel={`Archived, ${archived.length} chat${archived.length === 1 ? '' : 's'}`} onPress={openArchived} style={[styles.row, { paddingVertical: 10 }]}>
              <Oval width={48} fill={t.sunken}><Icon name="archive" size={20} color={t['ink-soft']} /></Oval>
              <Text style={{ flex: 1, fontWeight: '700', fontSize: 16, color: t.ink }}>Archived</Text>
              <Text style={{ fontWeight: '700', fontSize: 13, color: archivedUnread ? t['ember-ink'] : t['ink-soft'] }}>{archivedUnread || archived.length}</Text>
            </Pressable>
          ) : null}
          renderItem={({ item }) => <ChatRow c={item} me={me.id} typing={engine.typingIn(item.id).length > 0} onPress={() => openChat(item.id)} onLongPress={() => setActions(item)} />}
          ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: t.line, marginLeft: 76 }} />}
          ListEmptyComponent={main.length ? (
            <Text style={{ textAlign: 'center', margin: 32, color: t['ink-soft'], fontSize: 15 }}>{filter === 'unread' ? 'No unread chats.' : 'No groups yet.'}</Text>
          ) : (
            <View testID="chats-ready" style={styles.empty}>
              <LineArt name="chat" height={170} opacity={0.6} style={{ position: 'relative', right: 0, bottom: 0 }} />
              <Text style={[styles.emptyTitle, { color: t.ink }]}>Welcome, {me.displayName}</Text>
              <Text style={{ textAlign: 'center', color: t['ink-soft'], fontSize: 14, lineHeight: 20 }}>
                {me.migrated ? 'Your account from the old YaysApp is connected.' : 'Your account is ready.'} No chats yet: start one with anyone on YaysApp by their username, phone number or email.
              </Text>
              <OvalButton icon="edit" label="Start a chat" onPress={openNewChat} />
            </View>
          )}
          contentContainerStyle={rows.length ? undefined : { flexGrow: 1 }}
        />
      )}
      <ChatActionsSheet c={actions} onClose={() => setActions(null)} onNotice={(text, tone = 'danger') => setNotice({ text, tone })} />
    </SafeAreaView>
  );
}

/** Archived chats. New messages don't bring them back to the list. */
export function ArchivedScreen({ me, openChat }: { me: MeProfile; openChat: (id: string) => void }) {
  const t = useTheme();
  const s = useChatState();
  const engine = useEngine();
  const [actions, setActions] = useState<ConversationSummary | null>(null);
  const [notice, setNotice] = useState<{ text: string; tone: 'danger' | 'success' } | null>(null);
  useEffect(() => { void engine.loadArchived().catch(() => undefined); }, [engine]);
  const rows = s.order.map((id) => s.conversations[id]).filter((c): c is ConversationSummary => !!c && c.archived);
  return (
    <SafeAreaView edges={['bottom', 'left', 'right']} style={{ flex: 1, backgroundColor: t.ground }}>
      <Text accessibilityRole="header" style={[styles.h1, { color: t.ink, paddingHorizontal: 20, paddingBottom: 8 }]}>Archived</Text>
      {notice ? <View style={{ paddingHorizontal: 12, paddingBottom: 6 }}><Banner tone={notice.tone}>{notice.text}</Banner></View> : null}
      <FlatList data={rows} keyExtractor={(c) => c.id}
        renderItem={({ item }) => <ChatRow c={item} me={me.id} typing={false} onPress={() => openChat(item.id)} onLongPress={() => setActions(item)} />}
        ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: t.line, marginLeft: 76 }} />}
        ListEmptyComponent={<Text style={{ textAlign: 'center', margin: 32, color: t['ink-soft'] }}>No archived chats. Long-press a chat to archive it.</Text>} />
      <ChatActionsSheet c={actions} onClose={() => setActions(null)} onNotice={(text, tone = 'danger') => setNotice({ text, tone })} />
    </SafeAreaView>
  );
}

/** What the chat list says about the last message: "📷 Photo", "Sara: see you", "You added Ali". */
function rowPreview(c: ConversationSummary, me: string, nameOf: (id: string) => string) {
  const last = c.lastMessage;
  if (!last) return '';
  if (last.type === 'system' && last.system) return systemText(last.system, last.senderId, (u) => (u === last.senderId && c.lastSenderName ? c.lastSenderName : nameOf(u)));
  const text = last.deleted ? (last.senderId === me ? 'You deleted this message' : 'This message was deleted') : messagePreview(last);
  return c.kind === 'group' && last.senderId !== me && c.lastSenderName ? `${c.lastSenderName.split(' ')[0]}: ${text}` : text;
}

function ChatRow({ c, me, typing, onPress, onLongPress }: { c: ConversationSummary; me: string; typing: boolean; onPress: () => void; onLongPress?: () => void }) {
  const t = useTheme();
  const engine = useEngine();
  const name = c.kind === 'group' ? c.group?.name ?? 'Group' : c.peer?.displayName ?? 'Chat';
  const photo = c.kind === 'group' ? c.group?.photoUrl : c.peer?.photoUrl;
  const last = c.lastMessage;
  const unread = c.unread > 0 || c.markedUnread;
  const muted = !!c.mutedUntil && Date.parse(c.mutedUntil) > Date.now();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`Chat with ${name}${c.unread > 0 ? `, ${c.unread >= 100 ? '99+' : c.unread} unread` : c.markedUnread ? ', marked unread' : ''}`} testID="chat-row" onPress={onPress} onLongPress={onLongPress} delayLongPress={350}
      accessibilityHint={onLongPress ? 'Long press to pin, mute, archive or delete' : undefined}
      style={({ pressed }) => [styles.row, { backgroundColor: pressed ? t.surface : t.ground }]}>
      <Avatar name={name} photoUrl={photo} size={48} />
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text numberOfLines={1} style={{ fontWeight: '700', fontSize: 16, color: t.ink }}>{name}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          {!typing && last && last.senderId === me && last.type !== 'system' && !last.deleted ? <TickMark tick={tickFor(last, c)} color={t['ink-soft']} /> : null}
          <Text numberOfLines={1} style={{ flex: 1, fontSize: 14, color: typing ? t['ember-ink'] : t['ink-soft'], fontWeight: typing ? '700' : '400' }}>{typing ? 'typing…' : rowPreview(c, me, (u) => engine.nameOf(u))}</Text>
        </View>
      </View>
      <View style={{ alignItems: 'flex-end', gap: 6 }}>
        <Text style={{ fontSize: 12, color: unread && !muted ? t['ember-ink'] : t['ink-soft'], fontWeight: unread ? '800' : '600' }}>{listTime(c.lastActivityAt)}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, height: 20 }}>
          {muted ? <Icon name="bell-off" size={14} color={t['ink-faint']} /> : null}
          {c.pinnedAt ? <Icon name="pin" size={14} color={t['ink-faint']} /> : null}
          {c.unread > 0 ? <View style={[styles.badge, { backgroundColor: muted ? t['ink-faint'] : t.ember }]}><Text style={{ color: t['on-ember'], fontSize: 11, fontWeight: '800' }}>{c.unread >= 100 ? '99+' : c.unread}</Text></View>
            : c.markedUnread ? <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: t.ember }} /> : null}
        </View>
      </View>
    </Pressable>
  );
}

// ---------------- forward ----------------
/** Pick up to 5 chats to send a copy to, with an optional note. */
export function ForwardScreen({ conversationId, messageId, onDone }: { conversationId: string; messageId: string; onDone: (sentTo: string | null) => void }) {
  const t = useTheme();
  const engine = useEngine();
  const s = useChatState();
  const [picked, setPicked] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const chats = s.order.map((x) => s.conversations[x]!).filter((c) => c && c.canSend && !c.archived);
  const nameOf = (c: ConversationSummary) => (c.kind === 'group' ? c.group?.name ?? 'Group' : c.peer?.displayName ?? 'Chat');
  const send = async () => {
    setBusy(true); setError(null);
    try { await engine.forward(conversationId, messageId, picked, note); onDone(picked.length === 1 ? picked[0]! : null); }
    catch (e) { setError(errText(e, 'Could not forward.')); setBusy(false); }
  };
  return (
    <SafeAreaView edges={['bottom', 'left', 'right']} style={{ flex: 1, backgroundColor: t.ground }}>
      <View style={{ paddingHorizontal: 20, paddingBottom: 8, gap: 4 }}>
        <Text accessibilityRole="header" style={[styles.h1, { color: t.ink }]}>Forward to</Text>
        <Text style={{ color: t['ink-soft'], fontSize: 14 }}>Pick up to {MAX_FORWARD_TARGETS} chats{picked.length ? ` · ${picked.length} picked` : ''}.</Text>
      </View>
      {error ? <View style={{ paddingHorizontal: 16 }}><Banner>{error}</Banner></View> : null}
      <FlatList data={chats} keyExtractor={(c) => c.id} style={{ flex: 1 }}
        renderItem={({ item }) => {
          const on = picked.includes(item.id);
          const full = !on && picked.length >= MAX_FORWARD_TARGETS;
          return (
            <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: on, disabled: full }} accessibilityLabel={nameOf(item)} disabled={full} testID="forward-row"
              onPress={() => setPicked((p) => (on ? p.filter((x) => x !== item.id) : [...p, item.id]))} style={[styles.row, { opacity: full ? 0.45 : 1 }]}>
              <Avatar name={nameOf(item)} photoUrl={item.kind === 'group' ? item.group?.photoUrl : item.peer?.photoUrl} size={44} />
              <Text numberOfLines={1} style={{ flex: 1, fontWeight: '700', fontSize: 16, color: t.ink }}>{nameOf(item)}</Text>
              <Oval width={28} fill={on ? t.ember : t.sunken}>{on ? <Icon name="check" size={16} color={t['on-ember']} /> : null}</Oval>
            </Pressable>
          );
        }} />
      <View style={{ padding: 16, gap: 12, borderTopWidth: 1, borderTopColor: t.line }}>
        <Field label="Add a note (optional)" value={note} onChangeText={setNote} placeholder="Say something about it" />
        <View style={{ alignItems: 'center' }}><OvalButton icon="send" label="Forward" loading={busy} disabled={!picked.length} onPress={() => void send()} /></View>
      </View>
    </SafeAreaView>
  );
}

// ---------------- message info ----------------
/** Your message: who has read it, who has it, who doesn't yet. */
export function MessageInfoScreen({ conversationId, messageId }: { conversationId: string; messageId: string }) {
  const t = useTheme();
  const engine = useEngine();
  const [info, setInfo] = useState<MessageInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { engine.messageInfo(conversationId, messageId).then(setInfo).catch((e) => setError(errText(e, 'Could not load message info.'))); }, [engine, conversationId, messageId]);
  const when = (iso: string) => `${dayLabel(iso)} at ${new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  const section = (title: string, rows: Array<{ user: PublicProfile; at?: string }>) => (
    <View style={{ gap: 6 }} key={title}>
      <Text style={{ fontFamily: font.display, fontWeight: '800', fontSize: 15, color: t.ink }}>{title}</Text>
      <View style={{ backgroundColor: t.raised, borderRadius: 20, overflow: 'hidden' }}>
        {rows.length ? rows.map((r) => (
          <View key={r.user.id} style={[styles.row, { paddingVertical: 10 }]}>
            <Avatar name={r.user.displayName} photoUrl={r.user.photoUrl} size={36} />
            <Text style={{ flex: 1, fontWeight: '700', color: t.ink }}>{r.user.displayName}</Text>
            {r.at ? <Text style={{ fontSize: 12, color: t['ink-soft'] }}>{when(r.at)}</Text> : null}
          </View>
        )) : <Text style={{ padding: 14, color: t['ink-soft'] }}>Nobody yet</Text>}
      </View>
    </View>
  );
  return (
    <SafeAreaView edges={['bottom', 'left', 'right']} style={{ flex: 1, backgroundColor: t.ground }}>
      <ScrollView contentContainerStyle={{ padding: 20, gap: 18 }}>
        <Text accessibilityRole="header" style={[styles.h1, { color: t.ink }]}>Message info</Text>
        {error ? <Banner>{error}</Banner> : null}
        {!info && !error ? <ActivityIndicator color={t.ember} /> : null}
        {info ? [section('Read by', info.readBy), section('Delivered to', info.deliveredTo), ...(info.waiting.length ? [section('Not delivered yet', info.waiting.map((user) => ({ user })))] : [])] : null}
      </ScrollView>
    </SafeAreaView>
  );
}

// ---------------- new chat ----------------
export function NewChatScreen({ onOpened }: { onOpened: (id: string) => void }) {
  const t = useTheme();
  const engine = useEngine();
  const [q, setQ] = useState('');
  const [found, setFound] = useState<PublicProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const search = async () => {
    if (!q.trim()) { setError('Type a username, phone number or email.'); return; }
    setBusy(true); setError(null); setFound(null);
    try { setFound(await engine.lookup(q.trim())); } catch (e) { setError(e instanceof ApiError ? e.message : 'Search failed. Try again.'); } finally { setBusy(false); }
  };
  const start = async (p: PublicProfile) => {
    setBusy(true);
    try { onOpened((await engine.startDirect(p.id)).id); } catch (e) { setError(e instanceof ApiError ? e.message : 'Could not start the chat.'); setBusy(false); }
  };
  return (
    <SafeAreaView edges={['bottom', 'left', 'right']} style={{ flex: 1, backgroundColor: t.ground, padding: 20, gap: 16 }}>
      <Text accessibilityRole="header" style={[styles.h1, { color: t.ink }]}>New chat</Text>
      <Field label="Find someone" value={q} onChangeText={(v) => { setQ(v); setError(null); }} placeholder="@username, phone or email" autoCapitalize="none" autoCorrect={false}
        returnKeyType="search" onSubmitEditing={() => void search()} error={error} hint="Exact matches only. Their phone and email stay private." />
      <View style={{ alignItems: 'center' }}><OvalButton icon="search" label="Search" variant="soft" loading={busy && !found} onPress={() => void search()} /></View>
      {found ? (
        <Pressable accessibilityRole="button" accessibilityLabel={`Message ${found.displayName}`} testID="lookup-result" onPress={() => void start(found)} disabled={busy}
          style={[styles.row, { backgroundColor: t.raised, borderRadius: 20 }]}>
          <Avatar name={found.displayName} photoUrl={found.photoUrl} size={48} />
          <View style={{ flex: 1 }}>
            <Text style={{ fontWeight: '700', fontSize: 16, color: t.ink }}>{found.displayName}</Text>
            <Text style={{ fontSize: 14, color: t['ink-soft'] }}>{found.username ? `@${found.username}` : 'On YaysApp'}</Text>
          </View>
          <Icon name="chat" size={22} color={t['ember-ink']} />
        </Pressable>
      ) : null}
    </SafeAreaView>
  );
}

// ---------------- conversation ----------------
type Row = { kind: 'msg'; m: ThreadItem; showName: boolean } | { kind: 'day'; key: string; label: string };

/** Who is typing, in words: "Sara is typing…", "Sara and Ali are typing…". */
function typingWords(names: string[], group: boolean) {
  if (!names.length) return null;
  if (!group) return 'typing…';
  return names.length === 1 ? `${names[0]} is typing…` : names.length === 2 ? `${names[0]} and ${names[1]} are typing…` : `${names.length} people are typing…`;
}

export function ChatScreen({ id, onBack, openForward, openInfo, openChatInfo, openNewPoll }: { id: string; onBack: () => void; openForward: (conversationId: string, messageId: string) => void; openInfo: (conversationId: string, messageId: string) => void; openChatInfo: () => void; openNewPoll: () => void }) {
  const t = useTheme();
  const engine = useEngine();
  const s = useChatState();
  const c = s.conversations[id];
  const thread = s.threads[id];
  const [error, setError] = useState<string | null>(null);
  const [sheet, setSheet] = useState<ThreadItem | null>(null);
  const [replying, setReplying] = useState<ThreadItem | null>(null);
  const [editing, setEditing] = useState<ThreadItem | null>(null);
  const [notice, setNotice] = useState<{ text: string; tone: 'danger' | 'success' } | null>(null);
  const [viewing, setViewing] = useState<ThreadItem | null>(null);
  useEffect(() => { clearChat(id); }, [id]); // its notifications, on iPhone
  useEffect(() => {
    engine.open(id).catch((e) => setError(e instanceof ApiError && e.status === 404 ? 'This chat does not exist or you are not in it.' : 'Could not load this chat. Check your connection.'));
    return () => { if (engine.getState().active === id) void engine.open(null); };
  }, [engine, id]);
  useEffect(() => { if (!notice) return; const tm = setTimeout(() => setNotice(null), 3500); return () => clearTimeout(tm); }, [notice]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const items = useMemo(() => engine.thread(id), [engine, id, thread, s.outbox, s.uploads, c]);
  const group = c?.kind === 'group';
  // Newest first, for an inverted list that starts at the bottom; a day label follows the last message of each day.
  const rows = useMemo(() => {
    const out: Row[] = [];
    for (let i = items.length - 1; i >= 0; i--) {
      const m = items[i];
      const prev = items[i - 1];
      const day = dayLabel(m.createdAt);
      const newDay = i === 0 || dayLabel(prev.createdAt) !== day;
      // In a group, the sender's name heads each run of their messages.
      const showName = group && (newDay || !prev || prev.type === 'system' || prev.senderId !== m.senderId);
      out.push({ kind: 'msg', m, showName });
      if (newDay) out.push({ kind: 'day', key: `day-${m.key}`, label: day });
    }
    return out;
  }, [items, group]);
  const actions = useMemo<Actions>(() => ({
    reply: (m) => { setEditing(null); setReplying(m); },
    edit: (m) => { setReplying(null); setEditing(m); },
    forward: (m) => openForward(id, m.id!),
    info: (m) => openInfo(id, m.id!),
    remove: (m) => {
      const cur = engine.getState().conversations[id];
      const everyone = !!cur && canDeleteForEveryone(m, cur);
      const go = (fn: () => Promise<unknown>) => void fn().catch((e) => setNotice({ text: errText(e, 'Could not delete.'), tone: 'danger' }));
      Alert.alert('Delete message?', everyone ? (m.mine ? `You can delete it for everyone for ${DELETE_FOR_EVERYONE_MINUTES} minutes after sending.` : 'As an admin you can delete it for everyone in the group.') : 'It will be removed from this phone and your other devices.', [
        ...(everyone ? [{ text: 'Delete for everyone', style: 'destructive' as const, onPress: () => go(() => engine.deleteForEveryone(id, m.id!)) }] : []),
        { text: 'Delete for me', style: everyone ? 'default' : 'destructive', onPress: () => go(() => engine.deleteForMe(id, m.id!)) },
        { text: 'Cancel', style: 'cancel' },
      ]);
    },
    report: (m) => {
      const send = (reason: ReportReason) => void engine.report({ conversationId: id, messageId: m.id!, reason })
        .then(() => setNotice({ text: 'Thanks. Our team will look at it.', tone: 'success' }))
        .catch((e) => setNotice({ text: errText(e, 'Could not report.'), tone: 'danger' }));
      Alert.alert('Report this message?', 'YaysApp’s team will see this message and who sent it.', [
        { text: 'Spam', onPress: () => send('spam') }, { text: 'Scam or harassment', onPress: () => send('harassment') }, { text: 'Cancel', style: 'cancel' },
      ]);
    },
    notice: (text, tone = 'danger') => setNotice({ text, tone }),
  }), [engine, id, openForward, openInfo]);

  if (error) return <SafeAreaView style={{ flex: 1, padding: 24, gap: 16, backgroundColor: t.ground }}><Banner>{error}</Banner><OvalButton icon="arrow-left" label="Back to chats" variant="ghost" onPress={onBack} /></SafeAreaView>;
  if (!c) return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: t.surface }}><ActivityIndicator color={t.ember} /></View>;
  const name = group ? c.group?.name ?? 'Group' : c.peer?.displayName ?? 'Chat';
  const photo = group ? c.group?.photoUrl : c.peer?.photoUrl;
  const typingNames = engine.typingIn(id).map((u) => engine.nameOf(u).split(' ')[0]!);
  const typing = typingWords(typingNames, group);
  const p = c.peer ? s.presence[c.peer.id] : undefined;
  const status = typing ?? (group ? `${c.group?.memberCount ?? 0} members` : p?.online ? 'online' : p?.lastSeenAt ? lastSeen(p.lastSeenAt) : c.peer?.username ? `@${c.peer.username}` : '');
  const pin = c.pins[0];
  return (
    <ActionsCtx.Provider value={actions}>
      <SafeAreaView edges={['top', 'left', 'right', 'bottom']} style={{ flex: 1, backgroundColor: t.ground }}>
        <View style={[styles.head, { borderBottomColor: t.line }]}>
          <Pressable accessibilityRole="button" accessibilityLabel="Back to chats" onPress={onBack} hitSlop={12}><Icon name="arrow-left" size={24} color={t.ink} /></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={group ? 'Group info' : 'Contact info'} onPress={openChatInfo} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, minWidth: 0 }}>
          <View>
            <Avatar name={name} photoUrl={photo} size={40} />
            {p?.online ? <View testID="online-dot" style={[styles.dot, { backgroundColor: t.success, borderColor: t.ground }]} /> : null}
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text accessibilityRole="header" numberOfLines={1} style={{ fontWeight: '800', fontSize: 17, color: t.ink, fontFamily: font.display }}>{name}</Text>
            <Text testID="peer-status" numberOfLines={1} style={{ fontSize: 13, color: typing ? t['ember-ink'] : t['ink-soft'], fontWeight: typing ? '700' : '400' }}>{status}</Text>
          </View>
          </Pressable>
          <CallButtons conversationId={id} canCall={c.canSend && !(group && c.group?.announcements)} live={c.call} />
        </View>
        {pin ? (
          <View testID="pinned" style={[styles.pinBar, { backgroundColor: t.ground, borderBottomColor: t.line }]}>
            <Icon name="pin" size={16} color={t['ember-ink']} />
            <Text numberOfLines={1} style={{ flex: 1, fontSize: 13, color: t.ink }}><Text style={{ fontWeight: '700' }}>Pinned{c.pins.length > 1 ? ` (${c.pins.length})` : ''}: </Text>{pin.text || 'Message'}</Text>
          </View>
        ) : null}
        <ConnectionNotice />
        {notice ? <View style={{ paddingHorizontal: 12, paddingBottom: 6 }}><Banner tone={notice.tone}>{notice.text}</Banner></View> : null}
        <KeyboardAvoidingView style={{ flex: 1, backgroundColor: t.surface }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <FlatList
            testID="thread"
            inverted
            data={rows}
            keyExtractor={(r) => (r.kind === 'msg' ? r.m.key : r.key)}
            renderItem={({ item }) => item.kind === 'day' ? <DayLabel label={item.label} t={t} />
              : item.m.type === 'system' && item.m.system?.kind === 'call' ? <CallLine m={item.m} conversationId={id} canCall={c.canSend && !(group && c.group?.announcements)} />
              : item.m.type === 'system' ? <SystemLine m={item.m} />
              : <Bubble m={item.m} c={c} showName={item.showName} onLongPress={() => setSheet(item.m)}><MessageBody m={item.m} onOpen={() => setViewing(item.m)} /></Bubble>}
            onEndReached={() => void engine.loadOlder(id)}
            onEndReachedThreshold={0.3}
            contentContainerStyle={{ padding: 12, gap: 6, flexGrow: 1 }}
            ListHeaderComponent={typing ? <View accessibilityLabel="Typing" style={[styles.typing, { backgroundColor: t['bubble-them'] }]}><Text style={{ color: t['ink-soft'] }}>•••</Text></View> : null}
            ListFooterComponent={thread?.loading ? <ActivityIndicator color={t.ember} style={{ margin: 12 }} /> : null}
            ListEmptyComponent={thread?.loaded ? <View style={{ transform: [{ scaleY: -1 }] }}><DayLabel label="Say hello 👋" t={t} /></View> : null}
          />
          {c.canSend ? (
            <Composer id={id} group={group} replying={replying} editing={editing} onDone={() => { setReplying(null); setEditing(null); }} onError={(text) => setNotice({ text, tone: 'danger' })} openNewPoll={openNewPoll} />
          ) : (
            <View style={[styles.cannot, { backgroundColor: t.ground, borderTopColor: t.line }]}>
              <Text style={{ textAlign: 'center', color: t['ink-soft'], fontSize: 14 }}>{c.group?.role === 'former' ? 'You’re no longer in this group.' : group ? 'Only admins can send messages.' : 'You can’t send messages to this chat.'}</Text>
            </View>
          )}
        </KeyboardAvoidingView>
        <MessageSheet m={sheet} c={c} onClose={() => setSheet(null)} />
        <MediaViewer m={viewing} onClose={() => setViewing(null)} />
      </SafeAreaView>
    </ActionsCtx.Provider>
  );
}

/** What a message shows besides its text: a photo, video, voice note, file or poll. */
function MessageBody({ m, onOpen }: { m: ThreadItem; onOpen: () => void }) {
  const t = useTheme();
  const engine = useEngine();
  const mine = m.senderId === engine.me;
  if (m.type === 'media' && m.attachment) return <MediaBody m={m} onOpen={onOpen} />;
  if (m.type === 'poll') { const c = engine.getState().conversations[engine.getState().active ?? '']; return c ? <PollCard m={m} c={c} /> : <Text style={{ color: mine ? t['on-ember'] : t.ink }}>{m.text}</Text>; }
  return null;
}

function DayLabel({ label, t }: { label: string; t: Theme }) {
  return <View style={{ alignSelf: 'center', marginVertical: 8, paddingHorizontal: 12, paddingVertical: 4, borderRadius: 999, backgroundColor: t.ground }}><Text style={{ fontSize: 12, fontWeight: '700', color: t['ink-soft'] }}>{label}</Text></View>;
}

function Composer({ id, group, replying, editing, onDone, onError, openNewPoll }: { id: string; group: boolean; replying: ThreadItem | null; editing: ThreadItem | null; onDone: () => void; onError: (text: string) => void; openNewPoll: () => void }) {
  const t = useTheme();
  const engine = useEngine();
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [attach, setAttach] = useState(false);
  const voice = useVoiceRecorder();
  const s = useChatState();
  // @mentions in groups: "@" opens the member list; names picked stay mentioned while they're in the text.
  const [mention, setMention] = useState<{ start: number; query: string } | null>(null);
  const [caret, setCaret] = useState(0);
  const picked = useRef(new Map<string, string>());
  useEffect(() => { if (group && !s.groups[id]) void engine.loadGroup(id).catch(() => undefined); }, [group, id, engine, s.groups]);
  const members = (s.groups[id]?.members ?? []).filter((m) => m.id !== engine.me).map((m) => ({ id: m.id, name: m.displayName, photoUrl: m.photoUrl }));
  const matches = mention ? members.filter((m) => !mention.query || m.name.toLowerCase().split(/\s+/).some((w) => w.startsWith(mention.query.toLowerCase())) || m.name.toLowerCase().startsWith(mention.query.toLowerCase())).slice(0, 6) : [];
  const track = (value: string, at: number) => {
    if (!group) return;
    const hit = /(^|\s)@([^\s@]{0,30})$/.exec(value.slice(0, at));
    setMention(hit ? { start: at - hit[2]!.length - 1, query: hit[2]! } : null);
  };
  const pickMention = (m: { id: string; name: string }) => {
    if (!mention) return;
    const end = mention.start + 1 + mention.query.length;
    setText(`${text.slice(0, mention.start)}@${m.name} ${text.slice(end)}`);
    picked.current.set(m.id, m.name);
    setMention(null);
  };
  const mentionsIn = (v: string) => [...picked.current].filter(([, name]) => v.includes(`@${name}`)).map(([u]) => u);
  const input = useRef<React.ElementRef<typeof TextInput>>(null);
  // Editing puts the message's text in the box; replying focuses it.
  useEffect(() => { if (editing) { picked.current = new Map((editing.mentions ?? []).map((u) => [u, engine.nameOf(u)])); setText(editing.text); input.current?.focus(); } }, [editing, engine]);
  useEffect(() => { if (replying) input.current?.focus(); }, [replying]);
  const len = textLength(text.trim());
  const tooLong = len > MAX_TEXT;
  const send = async () => {
    if (!text.trim() || tooLong) return;
    const v = text;
    setText('');
    try {
      if (editing) { if (v.trim() !== editing.text.trim()) await engine.editMessage(id, editing.id!, v, group ? mentionsIn(v) : undefined); }
      else await engine.send(id, v, { ...(replying?.id ? { replyToId: replying.id } : {}), ...(group ? { mentions: mentionsIn(v) } : {}) });
      picked.current.clear();
      onDone();
    } catch (e) { setText(v); setError(e instanceof ApiError ? e.message : 'Could not send.'); }
  };
  /** Each picked file goes as its own message; the typed text becomes the first one's caption. */
  const sendFiles = (files: Picked[]) => {
    files.forEach((f, i) => {
      try { engine.sendFile(id, { ...f, ...(i === 0 && text.trim() ? { caption: text.trim() } : {}), ...(i === 0 && replying?.id ? { replyToId: replying.id } : {}) }); }
      catch (e) { onError(errText(e, `Could not send ${f.name}.`)); }
    });
    if (files.length && text.trim()) setText('');
    if (files.length) onDone();
  };
  const pickAnd = async (what: 'media' | 'camera' | 'video' | 'file' | 'poll') => {
    if (what === 'poll') { openNewPoll(); return; }
    try { sendFiles(what === 'media' ? await pickMedia() : what === 'file' ? await pickFiles() : await fromCamera(what === 'video')); }
    catch (e) { onError(errText(e, what === 'camera' || what === 'video' ? 'Could not open the camera. Allow it in Settings.' : 'Could not open your files.')); }
  };
  const record = async () => { const problem = await voice.start(); if (problem) onError(problem); };
  const sendVoice = async () => {
    const note = await voice.stop(true);
    if (!note) { onError('Hold on a little longer: voice messages need at least a second.'); return; }
    try { engine.sendFile(id, { file: note.file, kind: 'voice', name: 'Voice message.m4a', durationMs: note.durationMs, waveform: note.waveform, localUrl: note.localUrl, ...(replying?.id ? { replyToId: replying.id } : {}) }); onDone(); }
    catch (e) { onError(errText(e, 'Could not send the voice message.')); }
  };
  return (
    <View style={{ backgroundColor: t.ground, borderTopWidth: 1, borderTopColor: t.line, paddingHorizontal: 12, paddingTop: 8, paddingBottom: 6, gap: 6 }}>
      {replying ? <ComposeBar kind="reply" m={replying} onCancel={onDone} /> : null}
      {editing ? <ComposeBar kind="edit" m={editing} onCancel={() => { setText(''); onDone(); }} /> : null}
      {error || tooLong ? <Text accessibilityRole="alert" style={{ color: t['danger-ink'], fontWeight: '600', fontSize: 13 }}>{tooLong ? `Messages can be up to ${MAX_TEXT} characters (${len} now).` : error}</Text> : null}
      {mention && matches.length ? <MentionList people={matches} onPick={pickMention} /> : null}
      {voice.recording ? <RecordingBar ms={voice.ms} levels={voice.levels} onCancel={() => void voice.stop(false)} onSend={() => void sendVoice()} /> : (
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8 }}>
          {!editing ? (
            <Pressable accessibilityRole="button" accessibilityLabel="Attach" onPress={() => setAttach(true)} hitSlop={8} style={{ marginBottom: 32 }}>
              <Icon name="plus" size={26} color={t['ember-ink']} />
            </Pressable>
          ) : null}
          <TextInput ref={input} accessibilityLabel="Message" placeholder="Message" placeholderTextColor={t['ink-faint']} multiline value={text}
            onChangeText={(v) => { setText(v); setError(null); track(v, Math.min(v.length, caret + Math.max(0, v.length - text.length))); if (!editing) engine.typing(id, v.trim().length > 0); }} onBlur={() => engine.typing(id, false)}
          onSelectionChange={(e) => setCaret(e.nativeEvent.selection.end)}
            style={{ flex: 1, minHeight: 44, maxHeight: 140, marginBottom: 22, paddingHorizontal: 16, paddingTop: 11, paddingBottom: 11, borderRadius: 22, backgroundColor: t.surface, color: t.ink, fontSize: 16 }} />
          {text.trim() || editing
            ? <OvalButton icon={editing ? 'check' : 'send'} label={editing ? 'Save' : 'Send'} disabled={!text.trim() || tooLong} onPress={() => void send()} />
            : <OvalButton icon="mic" label="Voice" variant="soft" onPress={() => void record()} />}
        </View>
      )}
      <AttachSheet open={attach} poll={group} onClose={() => setAttach(false)} onPick={(w) => void pickAnd(w)} />
    </View>
  );
}

const styles = StyleSheet.create({
  listHead: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 12, paddingBottom: 12 },
  h1: { fontFamily: font.display, fontSize: 30, lineHeight: 36, fontWeight: '800', letterSpacing: -0.5 },
  notice: { flexDirection: 'row', alignItems: 'center', gap: 10, marginHorizontal: 12, marginBottom: 8, padding: 12, borderRadius: 16 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12 },
  badge: { minWidth: 22, height: 22, paddingHorizontal: 6, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14, padding: 32 },
  emptyTitle: { fontFamily: font.display, fontSize: 22, fontWeight: '800', textAlign: 'center' },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1 },
  dot: { position: 'absolute', right: 0, bottom: 0, width: 12, height: 12, borderRadius: 6, borderWidth: 2 },
  pinBar: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 8, borderBottomWidth: 1 },
  typing: { alignSelf: 'flex-start', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderBottomLeftRadius: 6 },
  cannot: { padding: 16, borderTopWidth: 1 },
});

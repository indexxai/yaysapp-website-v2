import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Platform, Pressable, StyleSheet, View } from 'react-native';
import { Text, TextInput } from '../ui/Text';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiError, MAX_TEXT, textLength, tickFor, type ConversationSummary, type MeProfile, type PublicProfile, type ThreadItem, type Tick } from '@yays/shared';
import { clock, dayLabel, lastSeen, listTime, useChatState, useEngine } from '../lib/chat';
import { font, useTheme, type Theme } from '../lib/theme';
import { Avatar, Banner, Field, OvalButton } from '../ui/kit';
import { Icon } from '../ui/Icon';
import { Oval } from '../ui/Oval';

const TICK_LABEL: Record<Tick, string> = { pending: 'Sending', failed: 'Not sent', sent: 'Sent', delivered: 'Delivered', read: 'Read' };
function TickMark({ tick, color }: { tick: Tick; color: string }) {
  const name = tick === 'pending' ? 'clock' : tick === 'failed' ? 'alert' : tick === 'sent' ? 'check' : 'check-double';
  return (
    <View accessible accessibilityLabel={TICK_LABEL[tick]} testID={`tick-${tick}`} style={{ opacity: tick === 'sent' || tick === 'delivered' ? 0.6 : 1 }}>
      <Icon name={name} size={14} color={color} strokeWidth={tick === 'read' ? 2.6 : 1.8} />
    </View>
  );
}

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
export function ChatListScreen({ me, openChat, openNewChat }: { me: MeProfile; openChat: (id: string) => void; openNewChat: () => void }) {
  const t = useTheme();
  const s = useChatState();
  const engine = useEngine();
  const [refreshing, setRefreshing] = useState(false);
  const rows = s.order.map((id) => s.conversations[id]);
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.ground }}>
      <View style={styles.listHead}>
        <Text accessibilityRole="header" style={[styles.h1, { color: t.ink }]}>Chats</Text>
        <OvalButton icon="edit" label="New chat" size="sm" onPress={openNewChat} />
      </View>
      <ConnectionNotice />
      {!s.listLoaded ? (s.connection === 'offline'
        ? <Text style={{ textAlign: 'center', margin: 32, color: t['ink-soft'], fontSize: 15 }}>Your chats will load when you're back online.</Text>
        : <ActivityIndicator style={{ marginTop: 40 }} color={t.ember} />) : (
        <FlatList
          testID="chat-list"
          data={rows}
          keyExtractor={(c) => c.id}
          refreshing={refreshing}
          onRefresh={() => { setRefreshing(true); void engine.loadList().finally(() => setRefreshing(false)); }}
          onEndReached={() => { if (s.listNext) void engine.loadList(true); }}
          renderItem={({ item }) => <ChatRow c={item} me={me.id} typing={engine.typingIn(item.id).length > 0} onPress={() => openChat(item.id)} />}
          ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: t.line, marginLeft: 76 }} />}
          ListEmptyComponent={
            <View testID="chats-ready" style={styles.empty}>
              <Oval width={72} fill={t['ember-wash']}><Icon name="chats" size={30} color={t['ember-ink']} /></Oval>
              <Text style={[styles.emptyTitle, { color: t.ink }]}>Welcome, {me.displayName}</Text>
              <Text style={{ textAlign: 'center', color: t['ink-soft'], fontSize: 14, lineHeight: 20 }}>
                {me.migrated ? 'Your account from the old YaysApp is connected.' : 'Your account is ready.'} No chats yet: start one with anyone on YaysApp by their username, phone number or email.
              </Text>
              <OvalButton icon="edit" label="Start a chat" onPress={openNewChat} />
            </View>
          }
          contentContainerStyle={rows.length ? undefined : { flexGrow: 1 }}
        />
      )}
    </SafeAreaView>
  );
}

function ChatRow({ c, me, typing, onPress }: { c: ConversationSummary; me: string; typing: boolean; onPress: () => void }) {
  const t = useTheme();
  const name = c.peer?.displayName ?? 'Chat';
  const last = c.lastMessage;
  const unread = c.unread > 0;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`Chat with ${name}${unread ? `, ${c.unread >= 100 ? '99+' : c.unread} unread` : ''}`} testID="chat-row" onPress={onPress}
      style={({ pressed }) => [styles.row, { backgroundColor: pressed ? t.surface : t.ground }]}>
      <Avatar name={name} photoUrl={c.peer?.photoUrl} size={48} />
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text numberOfLines={1} style={{ fontWeight: '700', fontSize: 16, color: t.ink }}>{name}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          {!typing && last && last.senderId === me ? <TickMark tick={tickFor(last, c)} color={t['ink-soft']} /> : null}
          <Text numberOfLines={1} style={{ flex: 1, fontSize: 14, color: typing ? t['ember-ink'] : t['ink-soft'], fontWeight: typing ? '700' : '400' }}>{typing ? 'typing…' : last?.text ?? ''}</Text>
        </View>
      </View>
      <View style={{ alignItems: 'flex-end', gap: 6 }}>
        <Text style={{ fontSize: 12, color: unread ? t['ember-ink'] : t['ink-soft'], fontWeight: unread ? '800' : '600' }}>{listTime(c.lastActivityAt)}</Text>
        {unread ? <View style={[styles.badge, { backgroundColor: t.ember }]}><Text style={{ color: t['on-ember'], fontSize: 11, fontWeight: '800' }}>{c.unread >= 100 ? '99+' : c.unread}</Text></View> : <View style={{ height: 20 }} />}
      </View>
    </Pressable>
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
type Row = { kind: 'msg'; m: ThreadItem } | { kind: 'day'; key: string; label: string };

export function ChatScreen({ id, onBack }: { id: string; onBack: () => void }) {
  const t = useTheme();
  const engine = useEngine();
  const s = useChatState();
  const c = s.conversations[id];
  const thread = s.threads[id];
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    engine.open(id).catch((e) => setError(e instanceof ApiError && e.status === 404 ? 'This chat does not exist or you are not in it.' : 'Could not load this chat. Check your connection.'));
    return () => { if (engine.getState().active === id) void engine.open(null); };
  }, [engine, id]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const items = useMemo(() => engine.thread(id), [engine, id, thread, s.outbox, c]);
  // Newest first, for an inverted list that starts at the bottom; a day label follows the last message of each day.
  const rows = useMemo(() => {
    const out: Row[] = [];
    for (let i = items.length - 1; i >= 0; i--) {
      const m = items[i];
      out.push({ kind: 'msg', m });
      const day = dayLabel(m.createdAt);
      if (i === 0 || dayLabel(items[i - 1].createdAt) !== day) out.push({ kind: 'day', key: `day-${m.key}`, label: day });
    }
    return out;
  }, [items]);

  if (error) return <SafeAreaView style={{ flex: 1, padding: 24, gap: 16, backgroundColor: t.ground }}><Banner>{error}</Banner><OvalButton icon="arrow-left" label="Back to chats" variant="ghost" onPress={onBack} /></SafeAreaView>;
  if (!c) return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: t.surface }}><ActivityIndicator color={t.ember} /></View>;
  const name = c.peer?.displayName ?? 'Chat';
  const typing = engine.typingIn(id).length > 0;
  const p = c.peer ? s.presence[c.peer.id] : undefined;
  const status = typing ? 'typing…' : p?.online ? 'online' : p?.lastSeenAt ? lastSeen(p.lastSeenAt) : c.peer?.username ? `@${c.peer.username}` : '';
  return (
    <SafeAreaView edges={['top', 'left', 'right', 'bottom']} style={{ flex: 1, backgroundColor: t.ground }}>
      <View style={[styles.head, { borderBottomColor: t.line }]}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back to chats" onPress={onBack} hitSlop={12}><Icon name="arrow-left" size={24} color={t.ink} /></Pressable>
        <View>
          <Avatar name={name} photoUrl={c.peer?.photoUrl} size={40} />
          {p?.online ? <View testID="online-dot" style={[styles.dot, { backgroundColor: t.success, borderColor: t.ground }]} /> : null}
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text accessibilityRole="header" numberOfLines={1} style={{ fontWeight: '800', fontSize: 17, color: t.ink, fontFamily: font.display }}>{name}</Text>
          <Text testID="peer-status" numberOfLines={1} style={{ fontSize: 13, color: typing ? t['ember-ink'] : t['ink-soft'], fontWeight: typing ? '700' : '400' }}>{status}</Text>
        </View>
      </View>
      <ConnectionNotice />
      <KeyboardAvoidingView style={{ flex: 1, backgroundColor: t.surface }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <FlatList
          testID="thread"
          inverted
          data={rows}
          keyExtractor={(r) => (r.kind === 'msg' ? r.m.key : r.key)}
          renderItem={({ item }) => item.kind === 'day' ? <DayLabel label={item.label} t={t} /> : <Bubble m={item.m} t={t} />}
          onEndReached={() => void engine.loadOlder(id)}
          onEndReachedThreshold={0.3}
          contentContainerStyle={{ padding: 12, gap: 6, flexGrow: 1 }}
          ListHeaderComponent={typing ? <View accessibilityLabel="Typing" style={[styles.bubble, styles.them, { backgroundColor: t['bubble-them'], flexDirection: 'row', gap: 4 }]}><Text style={{ color: t['ink-soft'] }}>•••</Text></View> : null}
          ListFooterComponent={thread?.loading ? <ActivityIndicator color={t.ember} style={{ margin: 12 }} /> : null}
          ListEmptyComponent={thread?.loaded ? <View style={{ transform: [{ scaleY: -1 }] }}><DayLabel label="Say hello 👋" t={t} /></View> : null}
        />
        <Composer id={id} />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function DayLabel({ label, t }: { label: string; t: Theme }) {
  return <View style={{ alignSelf: 'center', marginVertical: 8, paddingHorizontal: 12, paddingVertical: 4, borderRadius: 999, backgroundColor: t.ground }}><Text style={{ fontSize: 12, fontWeight: '700', color: t['ink-soft'] }}>{label}</Text></View>;
}

function Bubble({ m, t }: { m: ThreadItem; t: Theme }) {
  const engine = useEngine();
  const mine = m.senderId === engine.me;
  const failed = m.tick === 'failed';
  return (
    <View testID={mine ? 'msg-mine' : 'msg-theirs'} style={{ alignSelf: mine ? 'flex-end' : 'flex-start', maxWidth: '82%', alignItems: mine ? 'flex-end' : 'flex-start' }}>
      <View style={[styles.bubble, mine ? styles.me : styles.them, { backgroundColor: mine ? t['bubble-me'] : t['bubble-them'], opacity: m.tick === 'pending' || failed ? 0.75 : 1 }]}>
        <Text style={{ fontSize: 16, lineHeight: 22, color: mine ? t['on-ember'] : t.ink }}>{m.text}</Text>
        <View style={{ flexDirection: 'row', alignSelf: 'flex-end', alignItems: 'center', gap: 4, marginTop: 2 }}>
          <Text style={{ fontSize: 11, fontWeight: '600', color: mine ? t['on-ember'] : t['ink-soft'], opacity: 0.85 }}>{clock(m.createdAt)}</Text>
          {mine && m.tick ? <TickMark tick={m.tick} color={t['on-ember']} /> : null}
        </View>
      </View>
      {failed ? (
        <View style={{ flexDirection: 'row', gap: 16, marginTop: 4 }}>
          <Pressable accessibilityRole="button" accessibilityLabel="Retry sending" onPress={() => void engine.retry(m.clientId)} hitSlop={8}><Text style={{ color: t['danger-ink'], fontWeight: '700', fontSize: 13 }}>Not sent. Retry</Text></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Delete unsent message" onPress={() => void engine.discard(m.clientId)} hitSlop={8}><Text style={{ color: t['ink-soft'], fontWeight: '700', fontSize: 13 }}>Delete</Text></Pressable>
        </View>
      ) : null}
    </View>
  );
}

function Composer({ id }: { id: string }) {
  const t = useTheme();
  const engine = useEngine();
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const input = useRef<React.ElementRef<typeof TextInput>>(null);
  const len = textLength(text.trim());
  const tooLong = len > MAX_TEXT;
  const send = async () => {
    if (!text.trim() || tooLong) return;
    const v = text;
    setText('');
    try { await engine.send(id, v); } catch (e) { setText(v); setError(e instanceof ApiError ? e.message : 'Could not send.'); }
  };
  return (
    <View style={{ backgroundColor: t.ground, borderTopWidth: 1, borderTopColor: t.line, paddingHorizontal: 12, paddingTop: 8, paddingBottom: 6, gap: 4 }}>
      {error || tooLong ? <Text accessibilityRole="alert" style={{ color: t['danger-ink'], fontWeight: '600', fontSize: 13 }}>{tooLong ? `Messages can be up to ${MAX_TEXT} characters (${len} now).` : error}</Text> : null}
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 10 }}>
        <TextInput ref={input} accessibilityLabel="Message" placeholder="Message" placeholderTextColor={t['ink-faint']} multiline value={text}
          onChangeText={(v) => { setText(v); setError(null); engine.typing(id, v.trim().length > 0); }} onBlur={() => engine.typing(id, false)}
          style={{ flex: 1, minHeight: 44, maxHeight: 140, marginBottom: 22, paddingHorizontal: 16, paddingTop: 11, paddingBottom: 11, borderRadius: 22, backgroundColor: t.surface, color: t.ink, fontSize: 16 }} />
        <OvalButton icon="send" label="Send" disabled={!text.trim() || tooLong} onPress={() => void send()} />
      </View>
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
  bubble: { paddingHorizontal: 14, paddingTop: 9, paddingBottom: 7, borderRadius: 20 },
  me: { borderBottomRightRadius: 6 },
  them: { borderBottomLeftRadius: 6, alignSelf: 'flex-start' },
});

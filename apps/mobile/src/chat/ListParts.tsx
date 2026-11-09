import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, SectionList, StyleSheet, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { messagePreview, type ConversationSummary, type SearchResults } from '@yays/shared';
import { api } from '../lib/api';
import { listTime, useEngine } from '../lib/chat';
import { useTheme } from '../lib/theme';
import { Icon, type IconName } from '../ui/Icon';
import { Avatar, Banner } from '../ui/kit';
import { Text, TextInput } from '../ui/Text';
import { errText } from './messages';

export type ListFilter = 'all' | 'unread' | 'groups';
export const hasUnread = (c: ConversationSummary) => c.unread > 0 || c.markedUnread;
export const chatName = (c: ConversationSummary) => (c.kind === 'group' ? c.group?.name ?? 'Group' : c.peer?.displayName ?? 'Chat');
const isMuted = (c: ConversationSummary) => !!c.mutedUntil && Date.parse(c.mutedUntil) > Date.now();

/** All · Unread (with a count) · Groups, under the Chats title. */
export function FilterTabs({ value, onChange, unread }: { value: ListFilter; onChange: (f: ListFilter) => void; unread: number }) {
  const t = useTheme();
  const tabs: Array<[ListFilter, string]> = [['all', 'All'], ['unread', 'Unread'], ['groups', 'Groups']];
  return (
    <View accessibilityRole="tablist" style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingBottom: 8 }}>
      {tabs.map(([f, label]) => {
        const on = value === f;
        return (
          <Pressable key={f} accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={f === 'unread' && unread ? `${label}, ${unread}` : label} onPress={() => onChange(f)}
            style={[styles.tab, { backgroundColor: on ? t['ember-wash'] : t.surface, borderColor: on ? t.ember : t.line }]}>
            <Text style={{ fontFamily: 'Outfit', fontWeight: '700', fontSize: 13, color: on ? t['ember-ink'] : t.ink }}>{label}{f === 'unread' && unread ? ` ${unread}` : ''}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Long-press a chat in the list: pin, mute, archive, mark read or unread, delete. */
export function ChatActionsSheet({ c, onClose, onNotice }: { c: ConversationSummary | null; onClose: () => void; onNotice: (text: string, tone?: 'danger' | 'success') => void }) {
  const t = useTheme();
  const engine = useEngine();
  const insets = useSafeAreaInsets();
  if (!c) return null;
  const run = (fn: () => Promise<unknown>, ok?: string) => { onClose(); void fn().then(() => ok && onNotice(ok, 'success')).catch((e) => onNotice(errText(e, 'That did not work. Try again.'))); };
  const mute = () => {
    onClose();
    Alert.alert('Mute notifications', undefined, [
      { text: '8 hours', onPress: () => run(() => engine.setChatPrefs(c.id, { mute: '8h' }), 'Muted for 8 hours.') },
      { text: '1 week', onPress: () => run(() => engine.setChatPrefs(c.id, { mute: '1w' }), 'Muted for a week.') },
      { text: 'Always', onPress: () => run(() => engine.setChatPrefs(c.id, { mute: 'always' }), 'Muted.') },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };
  const remove = () => {
    onClose();
    Alert.alert(`Delete chat with ${chatName(c)}?`, 'It will be removed from your chats on all your devices.', [
      { text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: () => run(() => engine.deleteChat(c.id), 'Chat deleted.') },
    ]);
  };
  const items: Array<[IconName, string, () => void, boolean?]> = [
    ['pin', c.pinnedAt ? 'Unpin chat' : 'Pin chat', () => run(() => engine.setChatPrefs(c.id, { pinned: !c.pinnedAt }), c.pinnedAt ? 'Unpinned.' : 'Pinned to the top.')],
    isMuted(c) ? ['bell', 'Unmute', () => run(() => engine.setChatPrefs(c.id, { mute: 'off' }), 'Unmuted.')] : ['bell-off', 'Mute', mute],
    ['archive', c.archived ? 'Unarchive chat' : 'Archive chat', () => run(() => engine.setChatPrefs(c.id, { archived: !c.archived }), c.archived ? 'Back in your chats.' : 'Archived.')],
    hasUnread(c) ? ['check-double', 'Mark as read', () => run(() => engine.setChatPrefs(c.id, { unread: false }))] : ['chat', 'Mark as unread', () => run(() => engine.setChatPrefs(c.id, { unread: true }))],
    ...(c.kind === 'direct' ? [['trash', 'Delete chat', remove, true] as [IconName, string, () => void, boolean]] : []),
  ];
  return (
    <Modal transparent animationType="slide" visible onRequestClose={onClose} statusBarTranslucent>
      <Pressable accessibilityLabel="Close menu" style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' }} onPress={onClose} />
      <View testID="chat-actions" style={{ backgroundColor: t.ground, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingTop: 14, paddingHorizontal: 8, paddingBottom: Math.max(insets.bottom, 16) }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 12, paddingBottom: 10 }}>
          <Avatar name={chatName(c)} photoUrl={c.kind === 'group' ? c.group?.photoUrl : c.peer?.photoUrl} size={40} />
          <Text style={{ fontFamily: 'Outfit', fontWeight: '800', fontSize: 17, color: t.ink, flex: 1 }} numberOfLines={1}>{chatName(c)}</Text>
        </View>
        {items.map(([icon, label, fn, danger]) => (
          <Pressable key={label} accessibilityRole="button" accessibilityLabel={label} onPress={fn} style={({ pressed }) => [styles.item, { backgroundColor: pressed ? t.sunken : 'transparent' }]}>
            <Icon name={icon} size={20} color={danger ? t['danger-ink'] : t.ink} />
            <Text style={{ fontSize: 16, fontWeight: '600', color: danger ? t['danger-ink'] : t.ink }}>{label}</Text>
          </Pressable>
        ))}
      </View>
    </Modal>
  );
}

type Hit = { key: string; title: string; sub?: string; when?: string; photo?: string | null; onPress: () => void; testID: string };

/** Search chats, people and messages (the same search as the web). */
export function SearchScreen({ openChat }: { openChat: (id: string) => void }) {
  const t = useTheme();
  const engine = useEngine();
  const [q, setQ] = useState('');
  const [r, setR] = useState<SearchResults | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const asked = useRef(0);
  useEffect(() => {
    const query = q.trim();
    if (query.length < 2) { setR(null); setBusy(false); return; }
    const ticket = ++asked.current;
    setBusy(true);
    const tm = setTimeout(() => {
      void api().then((c) => c.search(query)).then((res) => { if (ticket === asked.current) { setR(res); setError(null); } })
        .catch((e) => { if (ticket === asked.current) setError(errText(e, 'Search failed. Try again.')); })
        .finally(() => { if (ticket === asked.current) setBusy(false); });
    }, 300);
    return () => clearTimeout(tm);
  }, [q]);
  const message = (id: string) => void engine.startDirect(id).then((c) => openChat(c.id)).catch((e) => setError(errText(e, 'Could not open the chat.')));
  const sections: Array<{ title: string; data: Hit[] }> = r ? [
    { title: 'Chats', data: r.chats.map((c) => ({ key: `c${c.id}`, title: c.name, sub: c.kind === 'group' ? `${c.memberCount} members` : undefined, photo: c.photoUrl, onPress: () => openChat(c.id), testID: 'search-chat' })) },
    { title: 'People', data: r.people.map((p) => ({ key: `p${p.id}`, title: p.displayName, sub: p.username ? `@${p.username}` : undefined, photo: p.photoUrl, onPress: () => message(p.id), testID: 'search-person' })) },
    { title: 'Messages', data: [...r.messages, ...r.files].map((h) => ({ key: `m${h.message.id}`, title: h.chat.name, sub: `${h.senderName}: ${messagePreview(h.message)}`, when: listTime(h.message.createdAt), photo: h.chat.photoUrl, onPress: () => openChat(h.chat.id), testID: 'search-message' })) },
  ].filter((x) => x.data.length) : [];
  return (
    <SafeAreaView edges={['bottom', 'left', 'right']} style={{ flex: 1, backgroundColor: t.ground }}>
      <View style={{ paddingHorizontal: 16, paddingBottom: 8 }}>
        <View style={[styles.search, { backgroundColor: t.surface }]}>
          <Icon name="search" size={18} color={t['ink-soft']} />
          <TextInput autoFocus accessibilityLabel="Search" placeholder="Search chats, people and messages" placeholderTextColor={t['ink-faint']} value={q} onChangeText={setQ}
            autoCapitalize="none" autoCorrect={false} returnKeyType="search" style={{ flex: 1, fontSize: 16, color: t.ink, paddingVertical: 10 }} />
          {busy ? <ActivityIndicator size="small" color={t.ember} /> : q ? <Pressable accessibilityRole="button" accessibilityLabel="Clear search" onPress={() => setQ('')} hitSlop={8}><Icon name="close" size={18} color={t['ink-soft']} /></Pressable> : null}
        </View>
      </View>
      {error ? <View style={{ paddingHorizontal: 16 }}><Banner>{error}</Banner></View> : null}
      <SectionList sections={sections} keyExtractor={(h) => h.key} keyboardShouldPersistTaps="handled"
        renderSectionHeader={({ section }) => <Text style={{ fontFamily: 'Outfit', fontWeight: '800', fontSize: 13, color: t['ink-soft'], paddingHorizontal: 16, paddingTop: 14, paddingBottom: 4, backgroundColor: t.ground }}>{section.title.toUpperCase()}</Text>}
        renderItem={({ item }) => (
          <Pressable accessibilityRole="button" accessibilityLabel={`${item.title}${item.sub ? `, ${item.sub}` : ''}`} testID={item.testID} onPress={item.onPress} style={styles.row}>
            <Avatar name={item.title} photoUrl={item.photo} size={44} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={1} style={{ fontWeight: '700', fontSize: 16, color: t.ink }}>{item.title}</Text>
              {item.sub ? <Text numberOfLines={2} style={{ fontSize: 14, color: t['ink-soft'] }}>{item.sub}</Text> : null}
            </View>
            {item.when ? <Text style={{ fontSize: 12, color: t['ink-soft'] }}>{item.when}</Text> : null}
          </Pressable>
        )}
        ListEmptyComponent={q.trim().length >= 2 && r && !busy ? <Text style={{ textAlign: 'center', margin: 32, color: t['ink-soft'] }}>Nothing found for “{q.trim()}”.</Text>
          : q.trim().length < 2 ? <Text style={{ textAlign: 'center', margin: 32, color: t['ink-soft'] }}>Type at least 2 letters.</Text> : null} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  tab: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 999, borderWidth: 1 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingHorizontal: 18, paddingVertical: 14, borderRadius: 16 },
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 22, paddingHorizontal: 14 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 10 },
});

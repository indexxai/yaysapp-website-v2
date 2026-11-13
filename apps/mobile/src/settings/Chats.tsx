import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Share, View } from 'react-native';
import { attachmentLabel, formatBytes, systemText, type AppPreferences, type ChatMessage, type ConversationSummary, type MeProfile, type StarredItem, type StorageReport } from '@yays/shared';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from '../lib/api';
import { setLocalPrefs, TEXT_SCALE } from '../lib/prefs';
import { useSession } from '../lib/session';
import { font, useTheme } from '../lib/theme';
import { Icon } from '../ui/Icon';
import { Avatar, Banner, OvalButton } from '../ui/kit';
import { LineArt } from '../ui/LineArt';
import { Text } from '../ui/Text';
import { Sheet } from '../circles/common';
import { Choice, errText, Group, NavRow, SettingsPage, useSaved, ValueRow } from './ui';

const SIZES = ['Smallest', 'Small', 'Default', 'Large', 'Largest'];
const nameOf = (c: ConversationSummary) => c.group?.name ?? c.peer?.displayName ?? 'Chat';

/** Theme and text size (saved to the account, so the web matches), exporting a chat, and where chats are kept. */
export function AppearanceScreen({ me, onBack }: { me: MeProfile; onBack: () => void }) {
  const t = useTheme();
  const s = useSession();
  const saved = useSaved();
  const [exporting, setExporting] = useState(false);
  const p = me.preferences;
  const set = async (v: Partial<AppPreferences>) => {
    const before = me;
    setLocalPrefs(v); // repaint now
    s.setMe({ ...me, preferences: { ...p, ...v } });
    try { s.setMe(await (await api()).setPreferences(v)); saved.ok('Saved. Your other devices use this too.'); } catch (e) { s.setMe(before); saved.fail(errText(e)); }
  };
  const k = TEXT_SCALE[p.textSize - 1] ?? 1;
  return (
    <SettingsPage title="Appearance and chats" onBack={onBack} art="gear" testID="appearance-screen">
      {saved.banner}
      <Group title="Theme">
        <Choice value={p.theme} options={[['light', 'Light'], ['dark', 'Dark'], ['system', 'Follow phone']]} onChange={(v) => void set({ theme: v })} />
      </Group>
      <Group title="Text size">
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 8 }}>
          <OvalButton icon="minus" label="Smaller text" size="sm" variant="ghost" disabled={p.textSize <= 1} onPress={() => void set({ textSize: (p.textSize - 1) as AppPreferences['textSize'] })} />
          <View style={{ flex: 1, alignItems: 'center', gap: 6 }}>
            <Text accessibilityLabel={`Text size ${SIZES[p.textSize - 1]}`} style={{ fontWeight: '800', color: t.ink }}>{SIZES[p.textSize - 1]}</Text>
            <View style={{ flexDirection: 'row', gap: 6 }}>{SIZES.map((_, i) => <View key={i} style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: i < p.textSize ? t.ember : t.sunken }} />)}</View>
          </View>
          <OvalButton icon="plus" label="Larger text" size="sm" variant="ghost" disabled={p.textSize >= 5} onPress={() => void set({ textSize: (p.textSize + 1) as AppPreferences['textSize'] })} />
        </View>
        <View style={{ paddingHorizontal: 16, paddingBottom: 12 }}>
          <View style={{ alignSelf: 'flex-start', backgroundColor: t['bubble-them'], borderRadius: 18, borderBottomLeftRadius: 6, paddingHorizontal: 12, paddingVertical: 8 }}>
            <Text style={{ fontSize: 16 * k, lineHeight: 22 * k, color: t.ink }}>This is how messages look.</Text>
          </View>
        </View>
      </Group>
      <Group title="Export a chat">
        <ValueRow label="Save a chat as text" hint="Messages oldest first, then share it to Files, email or another app. Photos and files are listed by name.">
          <OvalButton icon="download" label="Export" size="sm" variant="soft" onPress={() => setExporting(true)} />
        </ValueRow>
      </Group>
      <Group title="Chat backup">
        <Text style={{ fontSize: 14, lineHeight: 20, color: t['ink-soft'], paddingHorizontal: 16, paddingBottom: 12 }}>Your chats are kept safely on YaysApp’s servers, so they’re here whenever you sign in on a new phone or the web. Your theme, text size and sound are saved to your account too.</Text>
      </Group>
      {exporting ? <ExportSheet onClose={() => setExporting(false)} onDone={(n) => { setExporting(false); saved.ok(`Saved ${n} message${n === 1 ? '' : 's'}.`); }} /> : null}
    </SettingsPage>
  );
}

/** Pick a chat; its messages become one text file for the phone's share sheet. */
function ExportSheet({ onClose, onDone }: { onClose: () => void; onDone: (count: number) => void }) {
  const t = useTheme();
  const [chats, setChats] = useState<ConversationSummary[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { void api().then((a) => a.conversations({ limit: 100 })).then((r) => setChats(r.items), (e) => setError(errText(e, 'Could not load your chats.'))); }, []);
  const go = async (c: ConversationSummary) => {
    setBusy(c.id); setError(null);
    try {
      const a = await api();
      const all: ChatMessage[] = [];
      let before: number | undefined;
      for (let i = 0; i < 200; i++) {
        const page = await a.messages(c.id, { before, limit: 100 });
        all.unshift(...page.items);
        if (!page.hasMore || !page.items.length) break;
        before = page.items[0]!.seq;
      }
      const people = new Map<string, string>();
      const ids = [...new Set(all.map((m) => m.senderId))];
      for (let i = 0; i < ids.length; i += 100) for (const p of await a.profiles(ids.slice(i, i + 100))) people.set(p.id, p.displayName);
      const me = (await a.me()).id;
      const who = (id: string) => (id === me ? 'You' : people.get(id) ?? 'Deleted account');
      const lines = all.map((m) => {
        const at = new Date(m.createdAt).toLocaleString();
        if (m.type === 'system' && m.system) return `[${at}] ${systemText(m.system, m.senderId, who)}`;
        const body = m.deleted ? 'This message was deleted' : [m.attachment ? `<${attachmentLabel(m.attachment)}: ${m.attachment.name}>` : '', m.text].filter(Boolean).join(' ');
        return `[${at}] ${who(m.senderId)}: ${body}`;
      });
      const name = nameOf(c);
      const r = await Share.share({ title: `YaysApp chat with ${name}`, message: `YaysApp chat with ${name}\nSaved ${new Date().toLocaleString()}\n\n${lines.join('\n')}\n` });
      if (r.action === Share.dismissedAction) { setBusy(null); return; }
      onDone(all.length);
    } catch (e) { setError(errText(e, 'Could not export the chat.')); setBusy(null); }
  };
  return (
    <Sheet title="Export a chat" lead="Choose the chat to save." onClose={onClose} testID="export-sheet">
      {error ? <Banner>{error}</Banner> : null}
      {!chats && !error ? <ActivityIndicator color={t.ember} /> : null}
      {chats && !chats.length ? <Text style={{ color: t['ink-soft'] }}>No chats yet.</Text> : null}
      {chats?.map((c) => (
        <NavRow key={c.id} icon={c.kind === 'group' ? 'people' : 'chat'} label={nameOf(c)} onPress={() => { if (!busy) void go(c); }} right={busy === c.id ? <ActivityIndicator color={t.ember} /> : <Icon name="download" size={18} color={t['ink-soft']} />} />
      ))}
    </Sheet>
  );
}

const dayLabel = (iso: string) => {
  const d = new Date(iso), now = new Date();
  const days = Math.round((new Date(now.toDateString()).getTime() - new Date(d.toDateString()).getTime()) / 86_400_000);
  return days === 0 ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : days === 1 ? 'Yesterday' : d.toLocaleDateString([], { day: 'numeric', month: 'short', ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) });
};

/** Every starred message, newest first (m40). Tap one to open its chat. */
export function StarredScreen({ me, onBack, openChat }: { me: MeProfile; onBack: () => void; openChat: (id: string) => void }) {
  const t = useTheme();
  const [items, setItems] = useState<StarredItem[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const load = async (before?: string) => {
    try {
      const a = await api();
      const r = await a.starred(before);
      setItems((x) => [...(before ? x ?? [] : []), ...r.items]); setNext(r.next);
      const ids = [...new Set(r.items.map((i) => i.message.senderId))].filter((id) => id !== me.id && !names[id]);
      if (ids.length) { const ps = await a.profiles(ids.slice(0, 100)); setNames((n) => ({ ...n, ...Object.fromEntries(ps.map((p) => [p.id, p.displayName])) })); }
    } catch (e) { setError(errText(e, 'Could not load starred messages.')); }
  };
  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const who = (id: string) => (id === me.id ? 'You' : names[id] ?? '…');
  return (
    <SettingsPage title="Starred messages" onBack={onBack} art="trader" testID="starred-screen">
      {error ? <Banner>{error}</Banner> : null}
      {items === null && !error ? <ActivityIndicator color={t.ember} style={{ marginTop: 30 }} /> : null}
      {items && !items.length ? (
        <View style={{ alignItems: 'center', gap: 8, paddingVertical: 40 }}>
          <LineArt name="lantern" height={90} opacity={0.5} style={{ position: 'relative' }} />
          <Text style={{ fontFamily: font.display, fontWeight: '800', fontSize: 18, color: t.ink }}>No starred messages</Text>
          <Text style={{ color: t['ink-soft'], textAlign: 'center' }}>Long-press a message and tap Star to find it here later.</Text>
        </View>
      ) : null}
      {items?.map((s) => {
        const m = s.message, mine = m.senderId === me.id;
        return (
          <Pressable key={m.id} testID="starred-item" accessibilityRole="button" accessibilityLabel={`${who(m.senderId)} in ${s.conversationName}: ${m.text || (m.attachment ? attachmentLabel(m.attachment) : '')}`} onPress={() => openChat(s.conversationId)}
            style={({ pressed }) => ({ gap: 8, padding: 12, borderRadius: 22, backgroundColor: pressed ? t.sunken : t.raised })}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Avatar name={who(m.senderId)} size={26} />
              <Text style={{ fontWeight: '800', color: t.ink }}>{who(m.senderId)}</Text>
              <Text style={{ flex: 1, color: t['ink-soft'] }} numberOfLines={1}>{s.conversationName !== who(m.senderId) ? `› ${s.conversationName}` : ''}</Text>
              <Text style={{ fontSize: 12, color: t['ink-soft'] }}>{dayLabel(m.createdAt)}</Text>
            </View>
            <View style={{ alignSelf: mine ? 'flex-end' : 'flex-start', maxWidth: '90%', backgroundColor: mine ? t['bubble-me'] : t['bubble-them'], borderRadius: 18, paddingHorizontal: 12, paddingVertical: 8, gap: 2 }}>
              {m.attachment ? <Text style={{ fontWeight: '700', color: mine ? t['on-ember'] : t.ink }}>{attachmentLabel(m.attachment)}{m.attachment.kind === 'file' ? `: ${m.attachment.name}` : ''}</Text> : null}
              {m.text ? <Text style={{ fontSize: 15, color: mine ? t['on-ember'] : t.ink }}>{m.text}</Text> : null}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-end' }}><Icon name="star" size={11} color={mine ? t['on-ember'] : t['ink-soft']} /></View>
            </View>
          </Pressable>
        );
      })}
      {next ? <View style={{ alignItems: 'center' }}><OvalButton icon="chevron-down" label="More" size="sm" variant="ghost" onPress={() => void load(next)} /></View> : null}
      {items && items.length > 0 ? <Text style={{ fontSize: 12, color: t['ink-soft'], marginHorizontal: 8 }}>Starred messages stay here even if you clear the chat. They go if the sender deletes them for everyone.</Text> : null}
    </SettingsPage>
  );
}

const KINDS: Array<['image' | 'video' | 'file' | 'voice', string, string]> = [['image', 'Photos', '#e8692c'], ['video', 'Videos', '#b4471a'], ['file', 'Documents', '#4f5fa8'], ['voice', 'Voice', '#5f9e1b']];
const SINGULAR = { image: 'photo', video: 'video', file: 'document', voice: 'voice message' } as const;
/** The phone's own copy: the saved chat list, recent messages and the profile. Unsent messages are never cleared. */
const CACHE_PREFIX = 'yays.cache';
async function phoneCache() {
  const keys = (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith(CACHE_PREFIX));
  let bytes = 0;
  for (const [, v] of await AsyncStorage.multiGet(keys)) bytes += (v?.length ?? 0) * 2;
  return { keys, bytes };
}

/** What chats take up (shared photos, videos, documents, voice), the biggest chats, and this phone's copy. */
export function StorageScreen({ onBack, openChat }: { onBack: () => void; openChat: (id: string) => void }) {
  const t = useTheme();
  const saved = useSaved();
  const [r, setR] = useState<StorageReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cache, setCache] = useState<number | null>(null);
  useEffect(() => {
    void phoneCache().then((c) => setCache(c.bytes), () => setCache(0));
    void api().then((a) => a.storageReport()).then(setR, (e) => setError(errText(e, 'Could not load.')));
  }, []);
  const clear = async () => {
    try { await AsyncStorage.multiRemove((await phoneCache()).keys); } catch { /* fine */ }
    setCache((await phoneCache().catch(() => ({ bytes: 0 }))).bytes);
    saved.ok('Cleared. Your chats stay; they load again from YaysApp.');
  };
  return (
    <SettingsPage title="Storage and data" onBack={onBack} art="wallet" testID="storage-screen">
      {saved.banner}
      {error ? <Banner>{error}</Banner> : null}
      <Group>
        <View style={{ paddingHorizontal: 16, paddingVertical: 10, gap: 10 }}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' }}>
            <Text testID="storage-total" style={{ fontFamily: font.display, fontWeight: '800', fontSize: 26, color: t.ink }}>{r ? formatBytes(r.total) : '…'}</Text>
            <Text style={{ fontSize: 13, color: t['ink-soft'] }}>shared in your chats</Text>
          </View>
          {r && r.total > 0 ? (
            <View accessibilityLabel={KINDS.map(([k, l]) => `${l} ${formatBytes(r.byKind[k])}`).join(', ')} style={{ flexDirection: 'row', height: 12, borderRadius: 6, overflow: 'hidden', backgroundColor: t.sunken }}>
              {KINDS.map(([k, , c]) => (r.byKind[k] ? <View key={k} style={{ flex: r.byKind[k], backgroundColor: c }} /> : null))}
            </View>
          ) : null}
          {r ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>{KINDS.map(([k, l, c]) => <View key={k} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}><View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: c }} /><Text style={{ fontSize: 13, color: t.ink }}>{l} {formatBytes(r.byKind[k])}</Text></View>)}</View> : null}
          <Text style={{ fontSize: 12, color: t['ink-soft'] }}>Photos show as small previews in chats; the full file loads when you open it.</Text>
        </View>
      </Group>
      <Group title="This phone">
        <ValueRow label="Saved chats and recent messages" hint="Kept so your chats open instantly and offline. Clearing only removes this phone’s copy; your chats stay." value={cache === null ? '…' : formatBytes(cache)} testID="cache-size">
          <OvalButton icon="trash" label="Clear" size="sm" variant="soft" onPress={() => void clear()} />
        </ValueRow>
      </Group>
      {r && r.chats.length ? (
        <Group title="Largest chats">
          {r.chats.map((c) => (
            <Pressable key={c.conversationId} accessibilityRole="button" accessibilityLabel={`${c.name}, ${formatBytes(c.bytes)}`} onPress={() => openChat(c.conversationId)}
              style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 10, backgroundColor: pressed ? t.sunken : 'transparent' })}>
              <Avatar name={c.name} size={40} />
              <View style={{ flex: 1 }}>
                <Text style={{ fontWeight: '700', color: t.ink }} numberOfLines={1}>{c.name}</Text>
                <Text style={{ fontSize: 13, color: t['ink-soft'] }} numberOfLines={1}>{KINDS.filter(([k]) => c.counts[k]).map(([k, l]) => `${c.counts[k]} ${c.counts[k] === 1 ? SINGULAR[k] : l.toLowerCase()}`).join(' · ')}</Text>
              </View>
              <Text style={{ fontFamily: font.display, fontWeight: '800', color: t.ink }}>{formatBytes(c.bytes)}</Text>
            </Pressable>
          ))}
        </Group>
      ) : null}
    </SettingsPage>
  );
}

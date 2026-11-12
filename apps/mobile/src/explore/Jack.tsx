import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Image, KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, Share, View, type TextInput as RNTextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Clipboard from '@react-native-clipboard/clipboard';
import { ApiError, AI_MAX_INPUT, type AiChat, type AiChatSummary, type AiDocument, type AiImage, type AiMessage, type AiMode, type AiQuota, type ConversationSummary, type MeProfile } from '@yays/shared';
import { api } from '../lib/api';
import { font, useTheme } from '../lib/theme';
import { Icon, type IconName } from '../ui/Icon';
import { Avatar, Banner as ErrorBanner, OvalButton } from '../ui/kit';
import { LineArt } from '../ui/LineArt';
import { Oval } from '../ui/Oval';
import { Text, TextInput } from '../ui/Text';
import { Chip, MenuRow, Sheet } from '../circles/common';
import { Markdown } from './Markdown';
import { BRAND, Bar, errText, timeLeft } from './common';

const MODES: Array<{ id: AiMode; label: string; icon: IconName; hint: string }> = [
  { id: 'chat', label: 'Chat', icon: 'chat', hint: 'Ask Jack anything…' },
  { id: 'search', label: 'Web search', icon: 'globe', hint: 'Ask about something current…' },
  { id: 'document', label: 'Document', icon: 'document', hint: 'Describe a document, or a change to it…' },
  { id: 'image', label: 'Image', icon: 'image', hint: 'Describe a picture…' },
];
const SUGGEST = ['Give me 3 post ideas for my community', 'Translate “See you at 7” into Urdu', 'How do INEX rewards work?', 'Write a one-page event proposal'];
const groupOf = (c: AiChatSummary) => (c.saved ? 'Saved' : new Date(c.updatedAt).toDateString() === new Date().toDateString() ? 'Today' : 'Earlier');
const working = (mode: AiMode, editing: boolean, hasDoc: boolean) => (editing ? 'Changing the picture… about 15 seconds' : mode === 'image' ? 'Making the picture… about 15 seconds' : mode === 'document' ? (hasDoc ? 'Updating the document…' : 'Writing the document…') : mode === 'search' ? 'Searching the web…' : 'Thinking…');

/** Jack's AI: conversations, web answers with sources, documents and pictures. */
export function JackScreen({ me, onBack, openChat }: { me: MeProfile; onBack: () => void; openChat: (conversationId: string) => void }) {
  const t = useTheme();
  const [chat, setChat] = useState<AiChat | null>(null);
  const [list, setList] = useState<AiChatSummary[] | null>(null);
  const [quota, setQuota] = useState<AiQuota | null>(null);
  const [text, setText] = useState('');
  const [mode, setMode] = useState<AiMode>('chat');
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [buying, setBuying] = useState(false);
  const [sheet, setSheet] = useState<null | 'history' | 'sources' | { doc: AiDocument; messageId: string } | { share: { messageId: string; n?: number; label: string } }>(null);
  const [editing, setEditing] = useState<{ messageId: string; n: number; url: string } | null>(null);
  const scroll = useRef<ScrollView>(null);
  const input = useRef<RNTextInput>(null);
  useEffect(() => { void api().then((a) => Promise.all([a.aiChats().then(setList), a.aiQuota().then(setQuota)])).catch((e) => setError(errText(e))); }, []);
  const open = async (id: string | null) => {
    setSheet(null); setError(null); setEditing(null);
    if (!id) { setChat(null); setMode('chat'); return; }
    try { const c = await (await api()).aiChat(id); setChat(c); setQuota(c.quota); setMode(c.mode); } catch (e) { setError(errText(e)); }
  };
  const imageMode = mode === 'image' || !!editing;
  const picsLeft = quota ? Math.max(0, quota.images.limit - quota.images.used) : null;
  const out = !!quota && (imageMode ? picsLeft === 0 : quota.used >= quota.limit);
  const send = async (v0 = text, m0 = mode) => {
    const v = v0.trim();
    if (!v || pending) return;
    setPending(v); setText(''); setError(null);
    const edit = editing;
    try {
      const r = await (await api()).aiAsk(chat?.id ?? null, v, edit ? 'image' : m0, edit ? { messageId: edit.messageId, n: edit.n } : undefined);
      setEditing(null); setQuota(r.quota);
      setList((l) => [r.chat, ...(l ?? []).filter((x) => x.id !== r.chat.id)]);
      setChat((c) => (c && c.id === r.chat.id
        ? { ...c, messages: [...c.messages, r.user, r.assistant], document: r.assistant.document ?? c.document, mode: r.chat.mode }
        : { ...r.chat, messages: [r.user, r.assistant], quota: r.quota, document: r.assistant.document ?? null }));
    } catch (e) {
      setText(v);
      const d = e instanceof ApiError ? (e.details as { quota?: boolean; imageQuota?: boolean } | undefined) : undefined;
      if (d?.quota || d?.imageQuota) setQuota(await (await api()).aiQuota().catch(() => quota));
      else setError(errText(e));
    } finally { setPending(null); }
  };
  const buy = async () => { setBuying(true); setError(null); try { setQuota(await (await api()).aiBuyMessages()); } catch (e) { setError(errText(e)); } finally { setBuying(false); } };
  const toggleSave = async () => {
    if (!chat) return;
    setSheet(null);
    const s = await (await api()).aiUpdateChat(chat.id, { saved: !chat.saved }).catch(() => null);
    if (s) { setChat({ ...chat, saved: s.saved }); setList((l) => l?.map((x) => (x.id === s.id ? s : x)) ?? null); }
  };
  const remove = async () => {
    if (!chat) return;
    await (await api()).aiDeleteChat(chat.id).catch(() => undefined);
    setList((l) => l?.filter((x) => x.id !== chat.id) ?? null);
    void open(null);
  };
  const lastSources = [...(chat?.messages ?? [])].reverse().find((m) => m.role === 'assistant')?.sources ?? [];
  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={{ flex: 1, backgroundColor: t.surface }} testID="jack-screen">
      <LineArt name="reader" height={280} style={{ top: 150, bottom: undefined }} />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingTop: 6, paddingBottom: 4, backgroundColor: t.ground, borderBottomWidth: 1, borderBottomColor: t.line }}>
        <OvalButton icon="arrow-left" label="Explore" size="sm" variant="secondary" onPress={onBack} />
        <Image source={BRAND.jack} style={{ width: 40, height: 40, marginBottom: 20 }} resizeMode="contain" />
        <View style={{ flex: 1, marginBottom: 20 }}>
          <Text style={{ fontSize: 16, fontWeight: '800', color: t.ink }} numberOfLines={1}>{chat?.title ?? 'Jack’s AI'}</Text>
          <Text style={{ fontSize: 12, color: t['ink-soft'] }} numberOfLines={1}>{chat ? 'Jack’s AI · can make mistakes' : 'AI assistant · can make mistakes'}</Text>
        </View>
        <OvalButton icon="clock" label="History" size="sm" variant="ghost" onPress={() => setSheet('history')} />
      </View>
      {quota ? (
        <View testID="ai-quota" style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 8, backgroundColor: t.ground, borderBottomWidth: 1, borderBottomColor: t.line }}>
          {imageMode ? <><Icon name="image" size={14} color={t['ink-soft']} /><Text style={{ flex: 1, fontSize: 12, color: t['ink-soft'] }}><Text style={{ fontWeight: '800', color: t.ink }}>{picsLeft} of {quota.images.limit}</Text> pictures left today</Text></>
            : <><Bar done={quota.used} of={quota.limit} width="40%" /><Text style={{ flex: 1, fontSize: 12, color: t['ink-soft'], textAlign: 'right' }}><Text style={{ fontWeight: '800', color: t.ink }}>{quota.used} of {quota.limit}</Text> free messages today</Text></>}
        </View>
      ) : null}
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView ref={scroll} contentContainerStyle={{ padding: 12, gap: 10, flexGrow: 1 }} onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: false })} keyboardShouldPersistTaps="handled" testID="ai-thread">
          {!chat && !pending ? (
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14, paddingVertical: 20 }} testID="ai-hello">
              <Image source={BRAND.jackBunny} style={{ width: 150, height: 150 }} resizeMode="contain" />
              <Text accessibilityRole="header" style={{ fontFamily: font.display, fontWeight: '800', fontSize: 22, color: t.ink, textAlign: 'center' }}>Hi, {me.displayName.split(/\s+/)[0]}. What can I help with?</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8 }}>
                {SUGGEST.map((s) => <Pressable key={s} accessibilityRole="button" accessibilityLabel={s} onPress={() => { const m = /proposal/i.test(s) ? 'document' : 'chat'; setMode(m); void send(s, m); }} style={{ paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999, backgroundColor: t.raised }}><Text style={{ fontSize: 13, color: t.ink }}>{s}</Text></Pressable>)}
              </View>
            </View>
          ) : null}
          {chat?.messages.map((m) => (
            <Bubble key={m.id} m={m} onSources={() => setSheet('sources')} onDoc={() => m.document && setSheet({ doc: m.document, messageId: m.id })}
              onEdit={(img) => { setEditing({ messageId: m.id, n: img.n, url: img.url }); setTimeout(() => input.current?.focus(), 100); }}
              onShare={(n) => setSheet({ share: n === undefined ? { messageId: m.id, label: m.document?.title ?? 'Document' } : { messageId: m.id, n, label: `Picture ${n}` } })} />
          ))}
          {pending ? (
            <>
              <View style={{ alignSelf: 'flex-end', maxWidth: '82%', padding: 12, borderRadius: 18, borderBottomRightRadius: 6, backgroundColor: t['bubble-me'] }}><Text style={{ color: t.ink, fontSize: 15, lineHeight: 21 }}>{pending}</Text></View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }} testID="ai-working">
                <Image source={BRAND.jack} style={{ width: 28, height: 28 }} resizeMode="contain" />
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 18, backgroundColor: t.raised }}><ActivityIndicator size="small" color={t.ember} /><Text style={{ fontSize: 13, color: t['ink-soft'] }}>{working(mode, !!editing, !!chat?.document)}</Text></View>
              </View>
            </>
          ) : null}
        </ScrollView>
        <View style={{ backgroundColor: t.ground, borderTopWidth: 1, borderTopColor: t.line, paddingBottom: Platform.OS === 'ios' ? 18 : 8 }}>
          {error ? <View style={{ padding: 10, paddingBottom: 0 }}><ErrorBanner>{error}</ErrorBanner></View> : null}
          {out && quota ? (
            <View accessibilityRole="alert" testID="ai-out" style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 }}>
              <Oval width={44} fill={t.ember}><Icon name="clock" size={20} color={t['on-ember']} /></Oval>
              <View style={{ flex: 1 }}>
                <Text style={{ fontWeight: '800', color: t.ink }}>{imageMode ? `You’ve made today’s ${quota.images.limit} pictures.` : `You’ve used today’s ${quota.limit} messages.`}</Text>
                <Text style={{ fontSize: 12, color: t['ink-soft'] }}>They reset at midnight (in {timeLeft(quota.resetsAt)}). {imageMode ? 'You can still chat and write documents.' : 'You can still read and copy past answers.'}</Text>
              </View>
              {imageMode ? <OvalButton icon="chat" label="Back to chat" size="sm" variant="soft" onPress={() => { setMode('chat'); setEditing(null); }} />
                : <OvalButton icon="star" label={`Use ${quota.extraCost} INEX`} size="sm" loading={buying} onPress={() => void buy()} />}
            </View>
          ) : (
            <>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingHorizontal: 12, paddingTop: 8 }} accessibilityRole="radiogroup" accessibilityLabel="Kind of answer">
                {MODES.map((x) => <Chip key={x.id} icon={x.icon} label={x.label} on={mode === x.id && !editing} onPress={() => { setMode(x.id); setEditing(null); }} />)}
              </ScrollView>
              {editing ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginHorizontal: 12, marginTop: 8, padding: 8, borderRadius: 14, backgroundColor: t['ember-wash'] }} testID="ai-editing">
                  <Image source={{ uri: editing.url }} style={{ width: 36, height: 36, borderRadius: 8 }} />
                  <Text style={{ flex: 1, fontSize: 13, color: t.ink }}>Changing picture {editing.n}. Say what to change.</Text>
                  <Pressable accessibilityRole="button" accessibilityLabel="Stop changing this picture" onPress={() => setEditing(null)} hitSlop={8}><Icon name="close" size={16} color={t['ink-soft']} /></Pressable>
                </View>
              ) : null}
              <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8, paddingHorizontal: 10, paddingTop: 8 }}>
                <TextInput ref={input} accessibilityLabel="Message Jack" multiline value={text} maxLength={AI_MAX_INPUT} onChangeText={setText}
                  placeholder={editing ? 'Describe the change, like “more orange”…' : MODES.find((x) => x.id === mode)!.hint} placeholderTextColor={t['ink-faint']}
                  style={{ flex: 1, minHeight: 44, maxHeight: 140, marginBottom: 22, paddingHorizontal: 14, paddingTop: 11, paddingBottom: 11, borderRadius: 22, backgroundColor: t.surface, color: t.ink, fontSize: 15 }} />
                <OvalButton icon="send" label="Send" size="sm" disabled={!text.trim() || !!pending} onPress={() => void send()} />
              </View>
            </>
          )}
        </View>
      </KeyboardAvoidingView>

      {sheet === 'history' ? (
        <HistorySheet list={list} current={chat?.id ?? null} onClose={() => setSheet(null)} onOpen={(id) => void open(id)}
          actions={chat ? <><MenuRow icon="star" label={chat.saved ? 'Unsave this conversation' : 'Save this conversation'} onPress={() => void toggleSave()} /><MenuRow icon="trash" label="Delete this conversation" danger onPress={() => void remove()} /></> : null} />
      ) : null}
      {sheet === 'sources' ? (
        <Sheet title="Sources" onClose={() => setSheet(null)} testID="ai-sources">
          {lastSources.map((s) => (
            <Pressable key={s.n} accessibilityRole="link" accessibilityLabel={s.title} onPress={() => void Linking.openURL(s.url).catch(() => undefined)} style={{ gap: 4, padding: 12, borderRadius: 16, backgroundColor: t.raised }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><Oval width={24} fill={t['ember-wash']}><Text style={{ fontSize: 11, fontWeight: '800', color: t['ember-ink'] }}>{s.n}</Text></Oval><Text style={{ flex: 1, fontSize: 12, color: t['ink-soft'] }}>{s.domain}</Text><Icon name="external" size={14} color={t['ink-soft']} /></View>
              <Text style={{ fontWeight: '700', color: t.ink }}>{s.title}</Text>
              {s.quote ? <Text style={{ fontSize: 13, color: t['ink-soft'] }}>“{s.quote}”</Text> : null}
            </Pressable>
          ))}
        </Sheet>
      ) : null}
      {sheet && typeof sheet === 'object' && 'doc' in sheet ? <DocSheet doc={sheet.doc} onClose={() => setSheet(null)} onShare={() => setSheet({ share: { messageId: sheet.messageId, label: sheet.doc.title } })} /> : null}
      {sheet && typeof sheet === 'object' && 'share' in sheet ? <ShareSheet what={sheet.share} onClose={() => setSheet(null)} onSent={(c) => { setSheet(null); openChat(c); }} /> : null}
    </SafeAreaView>
  );
}

function Bubble({ m, onSources, onDoc, onEdit, onShare }: { m: AiMessage; onSources: () => void; onDoc: () => void; onEdit: (img: AiImage) => void; onShare: (n?: number) => void }) {
  const t = useTheme();
  const [copied, setCopied] = useState(false);
  if (m.role === 'user') {
    return (
      <View testID="ai-me" style={{ alignSelf: 'flex-end', maxWidth: '82%', padding: 12, borderRadius: 18, borderBottomRightRadius: 6, backgroundColor: t['bubble-me'], gap: 4 }}>
        {m.editOf ? <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}><Icon name="edit" size={12} color={t['ember-ink']} /><Text style={{ fontSize: 12, fontWeight: '700', color: t['ember-ink'] }}>Change to picture {m.editOf.n}</Text></View> : null}
        <Text style={{ color: t.ink, fontSize: 15, lineHeight: 21 }}>{m.text}</Text>
      </View>
    );
  }
  const copy = () => { Clipboard.setString(m.document ? m.document.markdown : m.text); setCopied(true); setTimeout(() => setCopied(false), 1500); };
  return (
    <View testID="ai-answer" style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start', maxWidth: '94%' }}>
      <Image source={BRAND.jack} style={{ width: 28, height: 28 }} resizeMode="contain" accessibilityLabel="Jack’s AI" />
      <View style={{ flex: 1, padding: 12, borderRadius: 18, borderTopLeftRadius: 6, backgroundColor: t.raised, gap: 10 }}>
        {m.mode === 'search' && m.sources?.length ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Show the sources" onPress={onSources} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, backgroundColor: t['ember-wash'] }}>
            <Icon name="globe" size={14} color={t['ember-ink']} /><Text style={{ fontSize: 12, fontWeight: '700', color: t['ember-ink'] }}>Searched the web · used {m.sources.length} source{m.sources.length === 1 ? '' : 's'}</Text>
          </Pressable>
        ) : null}
        {m.text ? <Markdown md={m.text} sources={m.sources} /> : null}
        {m.images?.length ? (
          <View style={{ gap: 8 }} testID="ai-pictures">
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {m.images.map((img) => (
                <View key={img.n} style={{ width: m.images!.length === 1 ? '100%' : '48.5%', gap: 6 }}>
                  <Pressable accessibilityRole="imagebutton" accessibilityLabel={`Open picture ${img.n} full size`} onPress={() => void Linking.openURL(img.url).catch(() => undefined)}>
                    <Image source={{ uri: img.url }} style={{ width: '100%', aspectRatio: img.width && img.height ? img.width / img.height : 1, borderRadius: 14, backgroundColor: t.sunken }} />
                  </Pressable>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-around' }}>
                    <OvalButton icon="edit" label="Change" size="sm" variant="soft" onPress={() => onEdit(img)} />
                    <OvalButton icon="send" label="Send" size="sm" onPress={() => onShare(img.n)} />
                  </View>
                </View>
              ))}
            </View>
            <Text style={{ fontSize: 11, color: t['ink-soft'] }}>Made by AI. Shared pictures are labelled “Made with Jack’s AI”.</Text>
          </View>
        ) : null}
        {m.handoff ? (
          <Pressable accessibilityRole="link" accessibilityLabel={m.handoff.label} onPress={() => void Linking.openURL(m.handoff!.url).catch(() => undefined)} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderRadius: 14, backgroundColor: t['ember-wash'] }}>
            <Image source={BRAND.jack} style={{ width: 28, height: 28 }} resizeMode="contain" />
            <View style={{ flex: 1 }}><Text style={{ fontWeight: '700', color: t.ink }}>{m.handoff.label}</Text><Text style={{ fontSize: 11, color: t['ink-soft'] }}>Websites, bookings, files, spreadsheets, video and more</Text></View>
            <Icon name="external" size={16} color={t['ember-ink']} />
          </Pressable>
        ) : null}
        {m.document ? (
          <Pressable accessibilityRole="button" accessibilityLabel={`Open ${m.document.title}`} testID="ai-doc" onPress={onDoc} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderRadius: 14, borderWidth: 1, borderColor: t.line, backgroundColor: t.surface }}>
            <View style={{ paddingHorizontal: 6, paddingVertical: 10, borderRadius: 8, backgroundColor: '#2b579a' }}><Text style={{ color: '#fff', fontSize: 10, fontWeight: '800' }}>DOC</Text></View>
            <View style={{ flex: 1 }}><Text style={{ fontWeight: '700', color: t.ink }} numberOfLines={2}>{m.document.title}</Text><Text style={{ fontSize: 11, color: t['ink-soft'] }}>Version {m.document.version} · tap to read, copy or send</Text></View>
            <Icon name="chevron-right" size={16} color={t['ink-faint']} />
          </Pressable>
        ) : null}
        {m.mode === 'search' ? <View style={{ flexDirection: 'row', gap: 6 }}><Icon name="info" size={14} color={t['ink-soft']} /><Text style={{ flex: 1, fontSize: 12, color: t['ink-soft'] }}>Answers about current events can change. Check the sources.</Text></View> : null}
        <View style={{ flexDirection: 'row', gap: 14 }}>
          <Pressable accessibilityRole="button" accessibilityLabel={copied ? 'Copied' : 'Copy'} onPress={copy} hitSlop={8}><Icon name={copied ? 'check' : 'copy'} size={16} color={t['ink-soft']} /></Pressable>
          {!m.images?.length ? <Pressable accessibilityRole="button" accessibilityLabel="Share answer" onPress={() => void Share.share({ message: m.document ? m.document.markdown : m.text }).catch(() => undefined)} hitSlop={8}><Icon name="share" size={16} color={t['ink-soft']} /></Pressable> : null}
        </View>
      </View>
    </View>
  );
}

function HistorySheet({ list, current, onClose, onOpen, actions }: { list: AiChatSummary[] | null; current: string | null; onClose: () => void; onOpen: (id: string | null) => void; actions?: React.ReactNode }) {
  const t = useTheme();
  const [q, setQ] = useState('');
  const shown = useMemo(() => (list ?? []).filter((c) => !q.trim() || c.title.toLowerCase().includes(q.trim().toLowerCase())), [list, q]);
  const groups = (['Today', 'Saved', 'Earlier'] as const).map((g) => [g, shown.filter((c) => groupOf(c) === g)] as const).filter(([, l]) => l.length);
  return (
    <Sheet title="Your conversations" onClose={onClose} testID="ai-history">
      <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
        <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44, paddingHorizontal: 14, borderRadius: 999, backgroundColor: t.raised }}>
          <Icon name="search" size={16} color={t['ink-soft']} />
          <TextInput accessibilityLabel="Search conversations" placeholder="Search conversations" placeholderTextColor={t['ink-faint']} value={q} onChangeText={setQ} style={{ flex: 1, color: t.ink, fontSize: 15, paddingVertical: 8 }} />
        </View>
        <OvalButton icon="plus" label="New chat" size="sm" onPress={() => onOpen(null)} />
      </View>
      {actions}
      {list && !list.length ? <Text style={{ color: t['ink-soft'], fontSize: 14 }}>Your conversations with Jack show here.</Text> : null}
      {groups.map(([g, l]) => (
        <View key={g} style={{ gap: 2 }}>
          <Text style={{ fontFamily: font.display, fontWeight: '700', fontSize: 12, letterSpacing: 0.6, textTransform: 'uppercase', color: t['ink-soft'] }}>{g}</Text>
          {l.map((c) => (
            <Pressable key={c.id} accessibilityRole="button" accessibilityLabel={c.title} onPress={() => onOpen(c.id)} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 8, borderRadius: 12, backgroundColor: c.id === current ? t['ember-wash'] : 'transparent' }}>
              <Icon name={c.saved ? 'star' : c.mode === 'document' ? 'document' : c.mode === 'search' ? 'globe' : c.mode === 'image' ? 'image' : 'chat'} size={16} color={t['ink-soft']} />
              <Text style={{ flex: 1, color: t.ink, fontSize: 15 }} numberOfLines={1}>{c.title}</Text>
            </Pressable>
          ))}
        </View>
      ))}
    </Sheet>
  );
}

/** A document Jack wrote: read it, copy it, share it, or send it to a chat (it goes in as a Word file). */
function DocSheet({ doc, onClose, onShare }: { doc: AiDocument; onClose: () => void; onShare: () => void }) {
  const t = useTheme();
  const [copied, setCopied] = useState(false);
  return (
    <Sheet title={doc.title} lead={`Version ${doc.version}`} onClose={onClose} testID="ai-doc-sheet">
      <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 22 }}>
        <OvalButton icon={copied ? 'check' : 'copy'} label={copied ? 'Copied' : 'Copy'} size="sm" variant="soft" onPress={() => { Clipboard.setString(doc.markdown); setCopied(true); }} />
        <OvalButton icon="share" label="Share" size="sm" variant="soft" onPress={() => void Share.share({ title: doc.title, message: doc.markdown }).catch(() => undefined)} />
        <OvalButton icon="send" label="Send to chat" size="sm" onPress={onShare} />
      </View>
      <View style={{ padding: 18, borderRadius: 16, backgroundColor: t.surface, borderWidth: 1, borderColor: t.line }}>
        <Markdown md={doc.markdown} />
      </View>
      <Text style={{ fontSize: 12, color: t['ink-soft'], textAlign: 'center' }}>Sent to a chat, it arrives as a Word file anyone can open.</Text>
    </Sheet>
  );
}

/** Pick a chat, add a few words if you like; the picture or document goes in as a normal photo or file. */
function ShareSheet({ what, onClose, onSent }: { what: { messageId: string; n?: number; label: string }; onClose: () => void; onSent: (conversationId: string) => void }) {
  const t = useTheme();
  const [chats, setChats] = useState<ConversationSummary[] | null>(null);
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<string | null>(null);
  const [caption, setCaption] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { void api().then((a) => a.conversations({ limit: 50 })).then((p) => setChats(p.items), (e) => setError(errText(e))); }, []);
  const name = (c: ConversationSummary) => c.group?.name ?? c.peer?.displayName ?? 'Chat';
  const shown = (chats ?? []).filter((c) => c.group?.role !== 'former' && name(c).toLowerCase().includes(q.trim().toLowerCase()));
  const send = async () => {
    if (!picked) return;
    setBusy(true); setError(null);
    try { onSent((await (await api()).aiShare(what.messageId, picked, { ...(what.n !== undefined ? { n: what.n } : {}), caption })).conversationId); }
    catch (e) { setError(errText(e)); setBusy(false); }
  };
  return (
    <Sheet title="Send to a chat" lead={what.label} onClose={onClose} testID="ai-share">
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44, paddingHorizontal: 14, borderRadius: 999, backgroundColor: t.raised }}>
        <Icon name="search" size={16} color={t['ink-soft']} />
        <TextInput accessibilityLabel="Search chats" placeholder="Search chats" placeholderTextColor={t['ink-faint']} value={q} onChangeText={setQ} style={{ flex: 1, color: t.ink, fontSize: 15, paddingVertical: 8 }} />
      </View>
      {!chats && !error ? <ActivityIndicator color={t.ember} /> : null}
      {chats && !shown.length ? <Text style={{ color: t['ink-soft'] }}>No chats found.</Text> : null}
      {shown.slice(0, 30).map((c) => (
        <Pressable key={c.id} accessibilityRole="radio" accessibilityState={{ checked: picked === c.id, disabled: !c.canSend }} accessibilityLabel={name(c)} disabled={!c.canSend} onPress={() => setPicked(c.id)}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 8, borderRadius: 14, opacity: c.canSend ? 1 : 0.5, backgroundColor: picked === c.id ? t['ember-wash'] : 'transparent' }}>
          <Avatar name={name(c)} photoUrl={c.group?.photoUrl ?? c.peer?.photoUrl} size={40} />
          <View style={{ flex: 1 }}><Text style={{ fontWeight: '700', color: t.ink }}>{name(c)}</Text><Text style={{ fontSize: 12, color: t['ink-soft'] }}>{!c.canSend ? 'Only admins can send messages' : c.group ? `${c.group.memberCount} members` : c.peer?.username ? `@${c.peer.username}` : ''}</Text></View>
          <Oval width={22} fill={picked === c.id ? t.ember : t.sunken}>{picked === c.id ? <Icon name="check" size={13} color="#fff" /> : null}</Oval>
        </Pressable>
      ))}
      {error ? <ErrorBanner>{error}</ErrorBanner> : null}
      <TextInput accessibilityLabel="Add a message" placeholder="Add a message (optional)" placeholderTextColor={t['ink-faint']} value={caption} maxLength={1000} onChangeText={setCaption} style={{ minHeight: 44, paddingHorizontal: 14, borderRadius: 16, backgroundColor: t.raised, color: t.ink, fontSize: 15 }} />
      <View style={{ alignItems: 'center' }}><OvalButton icon="send" label="Send" loading={busy} disabled={!picked} onPress={() => void send()} /></View>
    </Sheet>
  );
}

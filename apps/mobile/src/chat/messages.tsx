import React, { createContext, useContext } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Clipboard from '@react-native-clipboard/clipboard';
import {
  ApiError, DELETE_FOR_EVERYONE_MINUTES, EDIT_WINDOW_MINUTES, QUICK_REACTIONS, callText, clock, messagePreview, systemText,
  type ConversationSummary, type SystemEvent, type ThreadItem, type Tick,
} from '@yays/shared';
import { useEngine } from '../lib/chat';
import { useTheme, type Theme } from '../lib/theme';
import { Icon, type IconName } from '../ui/Icon';
import { Oval } from '../ui/Oval';
import { Text } from '../ui/Text';

const minutesSince = (iso: string) => (Date.now() - Date.parse(iso)) / 60000;
/** The same rules as the web: edit your own text for 15 minutes; delete for everyone for 15 minutes (admins: any message). */
export const canEdit = (m: ThreadItem) => m.mine && !!m.id && m.type === 'text' && !m.deleted && !m.forwarded && minutesSince(m.createdAt) <= EDIT_WINDOW_MINUTES;
export const canDeleteForEveryone = (m: ThreadItem, c: ConversationSummary) => !!m.id && !m.deleted && m.type !== 'system' &&
  ((m.mine && minutesSince(m.createdAt) <= DELETE_FOR_EVERYONE_MINUTES) || (!m.mine && c.group?.role === 'admin'));
export const errText = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);

/** What the chat screen does with a message: reply, edit, forward, delete, info, report. */
export interface Actions {
  reply(m: ThreadItem): void;
  edit(m: ThreadItem): void;
  forward(m: ThreadItem): void;
  remove(m: ThreadItem): void;
  info(m: ThreadItem): void;
  report(m: ThreadItem): void;
  notice(text: string, tone?: 'danger' | 'success'): void;
}
export const ActionsCtx = createContext<Actions | null>(null);
const useActions = () => useContext(ActionsCtx)!;

/** Sender names in groups: the brand palette, the same colour for a person every time. */
const MARKS = ['#e8762c', '#5f9a12', '#b24a7a', '#4f5fa8'];
export const markFill = (id: string) => MARKS[[...id].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) >>> 0, 7) % MARKS.length]!;

const TICK_LABEL: Record<Tick, string> = { pending: 'Sending', failed: 'Not sent', sent: 'Sent', delivered: 'Delivered', read: 'Read' };
export function TickMark({ tick, color }: { tick: Tick; color: string }) {
  const name = tick === 'pending' ? 'clock' : tick === 'failed' ? 'alert' : tick === 'sent' ? 'check' : 'check-double';
  return (
    <View accessible accessibilityLabel={TICK_LABEL[tick]} testID={`tick-${tick}`} style={{ opacity: tick === 'sent' || tick === 'delivered' ? 0.6 : 1 }}>
      <Icon name={name} size={14} color={color} strokeWidth={tick === 'read' ? 2.6 : 1.8} />
    </View>
  );
}

/** "Sara added Ali", "You changed the group name"… */
export function SystemLine({ m }: { m: ThreadItem }) {
  const t = useTheme();
  const engine = useEngine();
  if (!m.system) return null;
  return (
    <View testID="system-line" style={[styles.pill, { backgroundColor: t.ground }]}>
      <Text style={{ fontSize: 12, lineHeight: 17, color: t['ink-soft'], textAlign: 'center', fontWeight: '600' }}>{systemText(m.system, m.senderId, (u) => engine.nameOf(u))}</Text>
    </View>
  );
}

/** A finished call: "Missed voice call · 12:30". */
export function CallLine({ m }: { m: ThreadItem }) {
  const t = useTheme();
  const engine = useEngine();
  const e = m.system as Extract<SystemEvent, { kind: 'call' }>;
  const mine = m.senderId === engine.me;
  const missed = !mine && e.outcome !== 'completed' && e.outcome !== 'declined';
  return (
    <View testID="call-line" style={[styles.callLine, { backgroundColor: t.ground }]}>
      <Oval width={32} fill={missed ? t['danger-wash'] : t['ember-wash']}><Icon name={missed ? 'call-missed' : mine ? 'call-outgoing' : 'call-incoming'} size={16} color={missed ? t['danger-ink'] : t['ember-ink']} /></Oval>
      <View>
        <Text style={{ fontWeight: '700', fontSize: 14, color: missed ? t['danger-ink'] : t.ink }}>{callText(e, mine)}</Text>
        <Text style={{ fontSize: 12, color: t['ink-soft'] }}>{clock(m.createdAt)}</Text>
      </View>
    </View>
  );
}

function ReplyQuote({ r, mine, t }: { r: NonNullable<ThreadItem['replyTo']>; mine: boolean; t: Theme }) {
  const engine = useEngine();
  const who = r.senderId === engine.me ? 'You' : engine.nameOf(r.senderId);
  return (
    <View testID="reply-quote" style={[styles.quote, { backgroundColor: mine ? 'rgba(255,255,255,0.18)' : t.surface, borderLeftColor: mine ? t['on-ember'] : markFill(r.senderId) }]}>
      <Text numberOfLines={1} style={{ fontWeight: '800', fontSize: 13, color: mine ? t['on-ember'] : markFill(r.senderId) }}>{who}</Text>
      <Text numberOfLines={2} style={{ fontSize: 13, color: mine ? t['on-ember'] : t['ink-soft'] }}>{r.deleted ? 'This message was deleted' : messagePreview(r) || ' '}</Text>
    </View>
  );
}

/** One message. Long-press for the menu; a failed one offers Retry. */
export function Bubble({ m, c, showName, onLongPress, children }: { m: ThreadItem; c: ConversationSummary; showName: boolean; onLongPress: () => void; children?: React.ReactNode }) {
  const t = useTheme();
  const engine = useEngine();
  const mine = m.senderId === engine.me;
  const failed = m.tick === 'failed';
  const ink = mine ? t['on-ember'] : t.ink;
  const reactions = Object.entries(m.reactions ?? {}).filter(([, us]) => us.length);
  const myReaction = reactions.find(([, us]) => us.includes(engine.me))?.[0];
  const act = useActions();
  const toggle = (emoji: string) => { if (m.id) void engine.react(c.id, m.id, myReaction === emoji ? null : emoji).catch((e) => act.notice(errText(e, 'Could not react.'))); };
  return (
    <View testID={mine ? 'msg-mine' : 'msg-theirs'} style={{ alignSelf: mine ? 'flex-end' : 'flex-start', maxWidth: '84%', alignItems: mine ? 'flex-end' : 'flex-start' }}>
      <Pressable onLongPress={m.id && !m.deleted ? onLongPress : undefined} delayLongPress={300} accessibilityHint={m.id && !m.deleted ? 'Long press for reply, react and more' : undefined}
        style={({ pressed }) => [styles.bubble, mine ? styles.me : styles.them, { backgroundColor: mine ? t['bubble-me'] : t['bubble-them'], opacity: m.tick === 'pending' || failed ? 0.75 : pressed ? 0.85 : 1 }]}>
        {showName && !mine ? <Text style={{ fontWeight: '800', fontSize: 13, color: markFill(m.senderId), marginBottom: 2 }}>{engine.nameOf(m.senderId)}</Text> : null}
        {m.forwarded && !m.deleted ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 2 }}>
            <Icon name="forward" size={12} color={mine ? ink : t['ink-soft']} /><Text style={{ fontSize: 12, fontStyle: 'italic', color: mine ? ink : t['ink-soft'] }}>Forwarded</Text>
          </View>
        ) : null}
        {m.replyTo && !m.deleted ? <ReplyQuote r={m.replyTo} mine={mine} t={t} /> : null}
        {m.deleted ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Icon name="slash" size={14} color={mine ? ink : t['ink-soft']} />
            <Text style={{ fontStyle: 'italic', fontSize: 15, color: mine ? ink : t['ink-soft'] }}>{mine ? 'You deleted this message' : 'This message was deleted'}</Text>
          </View>
        ) : (
          <>
            {children}
            {m.text ? <Text style={{ fontSize: 16, lineHeight: 22, color: ink }} selectable={false}>{m.text}</Text> : null}
          </>
        )}
        <View style={styles.meta}>
          {m.starred ? <Icon name="star" size={12} color={mine ? ink : t['ink-soft']} /> : null}
          {m.editedAt && !m.deleted ? <Text style={[styles.metaText, { color: mine ? ink : t['ink-soft'] }]}>Edited</Text> : null}
          <Text style={[styles.metaText, { color: mine ? ink : t['ink-soft'] }]}>{clock(m.createdAt)}</Text>
          {mine && m.tick ? <TickMark tick={m.tick} color={ink} /> : null}
        </View>
      </Pressable>
      {reactions.length && !m.deleted ? (
        <View style={[styles.reactions, { justifyContent: mine ? 'flex-end' : 'flex-start' }]}>
          {reactions.map(([emoji, us]) => (
            <Pressable key={emoji} accessibilityRole="button" accessibilityLabel={`${emoji} ${us.length}${us.includes(engine.me) ? ', yours: tap to remove' : ''}`} onPress={() => toggle(emoji)}
              style={[styles.chip, { backgroundColor: us.includes(engine.me) ? t['ember-wash'] : t.ground, borderColor: us.includes(engine.me) ? t.ember : t.line }]}>
              <Text style={{ fontSize: 14 }}>{emoji}</Text>
              {us.length > 1 ? <Text style={{ fontSize: 12, fontWeight: '700', color: t.ink }}>{us.length}</Text> : null}
            </Pressable>
          ))}
        </View>
      ) : null}
      {failed ? (
        <View style={{ flexDirection: 'row', gap: 16, marginTop: 4 }}>
          <Pressable accessibilityRole="button" accessibilityLabel="Retry sending" onPress={() => void engine.retry(m.clientId)} hitSlop={8}><Text style={{ color: t['danger-ink'], fontWeight: '700', fontSize: 13 }}>Not sent. Retry</Text></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Delete unsent message" onPress={() => void engine.discard(m.clientId)} hitSlop={8}><Text style={{ color: t['ink-soft'], fontWeight: '700', fontSize: 13 }}>Delete</Text></Pressable>
        </View>
      ) : null}
    </View>
  );
}

/** Long-press menu: quick reactions on top, then what you can do with this message. */
export function MessageSheet({ m, c, onClose }: { m: ThreadItem | null; c: ConversationSummary; onClose: () => void }) {
  const t = useTheme();
  const engine = useEngine();
  const act = useActions();
  const insets = useSafeAreaInsets();
  if (!m || !m.id) return null;
  const member = c.canSend || c.group?.role !== 'former';
  const myReaction = Object.entries(m.reactions ?? {}).find(([, us]) => us.includes(engine.me))?.[0];
  const pinned = c.pins.some((p) => p.messageId === m.id);
  const canPin = member && (c.kind === 'direct' || c.group?.role === 'admin' || c.group?.settings.pin === 'all');
  const run = (fn: () => Promise<unknown>, fail: string, ok?: string) => { onClose(); void fn().then(() => ok && act.notice(ok, 'success')).catch((e) => act.notice(errText(e, fail))); };
  const items: Array<[IconName, string, () => void, boolean?]> = [
    ...(member && c.canSend ? [['reply', 'Reply', () => { onClose(); act.reply(m); }] as [IconName, string, () => void]] : []),
    ...(m.type !== 'poll' ? [['forward', 'Forward', () => { onClose(); act.forward(m); }] as [IconName, string, () => void]] : []),
    ...(m.text ? [['copy', 'Copy', () => { Clipboard.setString(m.text); onClose(); act.notice('Copied.', 'success'); }] as [IconName, string, () => void]] : []),
    ...(canEdit(m) ? [['edit', 'Edit', () => { onClose(); act.edit(m); }] as [IconName, string, () => void]] : []),
    ...(canPin ? [['pin', pinned ? 'Unpin' : 'Pin', () => run(() => engine.pin(c.id, m.id!, !pinned), 'Could not pin.')] as [IconName, string, () => void]] : []),
    ['star', m.starred ? 'Unstar' : 'Star', () => run(() => engine.star(c.id, m.id!, !m.starred), 'Could not star.')],
    ...(m.mine ? [['info', 'Message info', () => { onClose(); act.info(m); }] as [IconName, string, () => void]] : []),
    ...(!m.mine ? [['flag', 'Report', () => { onClose(); act.report(m); }] as [IconName, string, () => void]] : []),
    ['trash', 'Delete', () => { onClose(); act.remove(m); }, true],
  ];
  return (
    <Modal transparent animationType="slide" visible onRequestClose={onClose} statusBarTranslucent>
      <Pressable accessibilityLabel="Close menu" style={styles.scrim} onPress={onClose} />
      <View testID="message-sheet" style={[styles.sheet, { backgroundColor: t.ground, paddingBottom: Math.max(insets.bottom, 16) }]}>
        <View style={[styles.grab, { backgroundColor: t['line-strong'] }]} />
        {member ? (
          <View accessibilityRole="menu" accessibilityLabel="Reactions" style={styles.reactRow}>
            {QUICK_REACTIONS.map((e) => (
              <Pressable key={e} accessibilityRole="button" accessibilityLabel={myReaction === e ? `Remove ${e}` : `React ${e}`} accessibilityState={{ selected: myReaction === e }}
                onPress={() => run(() => engine.react(c.id, m.id!, myReaction === e ? null : e), 'Could not react.')}
                style={[styles.reactBtn, { backgroundColor: myReaction === e ? t['ember-wash'] : t.surface }]}>
                <Text style={{ fontSize: 26 }}>{e}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}
        <ScrollView style={{ maxHeight: 420 }}>
          {items.map(([icon, label, fn, danger]) => (
            <Pressable key={label} accessibilityRole="button" accessibilityLabel={label} onPress={fn} style={({ pressed }) => [styles.item, { backgroundColor: pressed ? t.sunken : 'transparent' }]}>
              <Icon name={icon} size={20} color={danger ? t['danger-ink'] : t.ink} />
              <Text style={{ fontSize: 16, fontWeight: '600', color: danger ? t['danger-ink'] : t.ink }}>{label}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>
    </Modal>
  );
}

/** Above the message box: what you're replying to, or that you're editing. */
export function ComposeBar({ kind, m, onCancel }: { kind: 'reply' | 'edit'; m: ThreadItem; onCancel: () => void }) {
  const t = useTheme();
  const engine = useEngine();
  const who = m.senderId === engine.me ? 'yourself' : engine.nameOf(m.senderId);
  return (
    <View testID={`${kind}-bar`} style={[styles.composeBar, { backgroundColor: t.surface, borderLeftColor: kind === 'edit' ? t.ember : markFill(m.senderId) }]}>
      <Icon name={kind === 'edit' ? 'edit' : 'reply'} size={18} color={t['ember-ink']} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ fontWeight: '800', fontSize: 13, color: t['ember-ink'] }}>{kind === 'edit' ? 'Editing message' : `Replying to ${who}`}</Text>
        <Text numberOfLines={1} style={{ fontSize: 13, color: t['ink-soft'] }}>{messagePreview(m) || ' '}</Text>
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel={kind === 'edit' ? 'Cancel editing' : 'Cancel reply'} onPress={onCancel} hitSlop={10}><Icon name="close" size={20} color={t['ink-soft']} /></Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: { alignSelf: 'center', marginVertical: 6, paddingHorizontal: 12, paddingVertical: 5, borderRadius: 14, maxWidth: '86%' },
  callLine: { alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 10, marginVertical: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 18 },
  bubble: { paddingHorizontal: 12, paddingTop: 8, paddingBottom: 6, borderRadius: 20, gap: 4 },
  me: { borderBottomRightRadius: 6 },
  them: { borderBottomLeftRadius: 6 },
  quote: { borderLeftWidth: 3, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 5, marginBottom: 2 },
  meta: { flexDirection: 'row', alignSelf: 'flex-end', alignItems: 'center', gap: 4 },
  metaText: { fontSize: 11, fontWeight: '600', opacity: 0.85 },
  reactions: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: -4, paddingHorizontal: 6 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 12, borderWidth: 1 },
  scrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet: { borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingTop: 8, paddingHorizontal: 8 },
  grab: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, marginBottom: 10 },
  reactRow: { flexDirection: 'row', justifyContent: 'space-around', paddingHorizontal: 8, paddingBottom: 8 },
  reactBtn: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  item: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingHorizontal: 18, paddingVertical: 14, borderRadius: 16 },
  composeBar: { flexDirection: 'row', alignItems: 'center', gap: 10, borderLeftWidth: 3, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 6 },
});

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { ApiError, callDuration, clock, dayLabel, type CallHistoryItem } from '@yays/shared';
import { api } from '../lib/api';
import { useChatState, useEngine } from '../lib/chat';
import { font, useTheme } from '../lib/theme';
import { TabPage } from '../screens/TabScreens';
import { Icon, type IconName } from '../ui/Icon';
import { Oval } from '../ui/Oval';
import { Avatar, Banner, OvalButton } from '../ui/kit';
import { Text } from '../ui/Text';
import { useCalls } from './Calls';

type Filter = 'all' | 'missed' | 'video';
type Row = { key: string; first: CallHistoryItem; count: number };

/** Calls to the same chat in a row, with the same result, on the same day, show as one row with a count (not answered ones). */
function group(items: CallHistoryItem[]): Row[] {
  const out: Row[] = [];
  for (const i of items) {
    const prev = out[out.length - 1];
    const same = prev && (prev.first.conversationId ?? prev.first.id) === (i.conversationId ?? i.id) && prev.first.result === i.result && prev.first.direction === i.direction && prev.first.media === i.media && dayLabel(prev.first.at) === dayLabel(i.at) && i.result !== 'answered';
    if (same) prev.count++; else out.push({ key: i.id, first: i, count: 1 });
  }
  return out;
}
export function resultText(i: CallHistoryItem, count = 1) {
  const n = count > 1 ? ` (${count})` : '';
  switch (i.result) {
    case 'answered': return `${i.direction === 'out' ? 'Outgoing' : 'Incoming'} · ${callDuration(i.durationSec, true)}`;
    case 'missed': return `Missed${n}`;
    case 'silenced': return `Silenced · unknown caller${n}`;
    case 'declined': return `Declined${n}`;
    case 'no_answer': return `No answer${n}`;
    case 'busy': return `Busy${n}`;
    case 'cancelled': return `Cancelled${n}`;
    case 'live': return 'On a call now';
  }
}
const dirIcon = (i: CallHistoryItem): IconName => (i.result === 'missed' || i.result === 'silenced' ? 'call-missed' : i.direction === 'out' ? 'call-outgoing' : 'call-incoming');

/** The Calls tab: every call, newest first, with missed ones in red and a button to call back. */
export function CallsScreen({ openChat }: { openChat: (conversationId: string) => void }) {
  const t = useTheme();
  const engine = useEngine();
  const s = useChatState();
  const calls = useCalls();
  const [filter, setFilter] = useState<Filter>('all');
  const [items, setItems] = useState<CallHistoryItem[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async (more?: string) => {
    try {
      const p = await (await api()).callHistory({ filter, before: more });
      setItems((x) => (more && x ? [...x, ...p.items] : p.items)); setNext(p.next); setError(null);
    } catch (e) { setError(e instanceof ApiError ? e.message : 'Could not load your calls. Check your connection.'); }
  }, [filter]);
  useEffect(() => { setItems(null); void load(); }, [load]);
  // Looking at the list counts as seeing the missed calls.
  useEffect(() => { void engine.callsSeen(); }, [engine]);
  // A call starting or ending shows up here straight away.
  const callsKey = Object.values(s.calls).map((c) => `${c.id}:${c.status}`).join(',');
  useEffect(() => { if (callsKey) void load(); }, [callsKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const rows = useMemo(() => group(items ?? []), [items]);
  const missed = (items ?? []).filter((i) => i.result === 'missed').length;
  let lastDay = '';
  return (
    <TabPage title="Calls" art="selfie" testID="calls-tab">
      <View accessibilityRole="tablist" style={{ flexDirection: 'row', gap: 8, marginBottom: 4 }}>
        {([['all', 'All'], ['missed', 'Missed'], ['video', 'Video']] as Array<[Filter, string]>).map(([f, label]) => {
          const on = filter === f;
          const count = f === 'missed' && filter === 'all' && missed > 0 ? ` ${missed}` : '';
          return (
            <Pressable key={f} accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={`${label}${count ? `, ${missed}` : ''}`} onPress={() => setFilter(f)}
              style={[styles.tab, { backgroundColor: on ? t['ember-wash'] : t.ground, borderColor: on ? t.ember : t.line }]}>
              <Text style={{ fontFamily: font.display, fontWeight: '700', fontSize: 13, color: on ? t['ember-ink'] : t.ink }}>{label}{count}</Text>
            </Pressable>
          );
        })}
      </View>
      {error ? <Banner>{error}</Banner> : null}
      {items === null && !error ? <ActivityIndicator color={t.ember} style={{ margin: 24 }} accessibilityLabel="Loading calls" /> : null}
      {items && !items.length ? (
        <View style={[styles.empty, { backgroundColor: t.raised }]}>
          <Oval width={64} fill={t['ember-wash']}><Icon name="phone" size={26} color={t['ember-ink']} /></Oval>
          <Text style={{ fontFamily: font.display, fontWeight: '800', fontSize: 17, color: t.ink }}>{filter === 'missed' ? 'No missed calls' : filter === 'video' ? 'No video calls yet' : 'No calls yet'}</Text>
          <Text style={{ color: t['ink-soft'], textAlign: 'center' }}>Start one from a chat: tap the phone or the camera at the top.</Text>
        </View>
      ) : null}
      {rows.length ? (
        <View style={[styles.card, { backgroundColor: t.raised }]}>
          {rows.map((r) => {
            const i = r.first, day = dayLabel(i.at);
            const sep = day !== lastDay; lastDay = day;
            const red = i.result === 'missed' || i.result === 'silenced';
            return (
              <View key={r.key}>
                {sep ? <Text style={[styles.day, { color: t['ink-soft'] }]}>{day.toUpperCase()}</Text> : null}
                <View testID="call-row" style={styles.row}>
                  <Pressable accessibilityRole="button" accessibilityLabel={`${i.title}, ${resultText(i, r.count)}, ${clock(i.at)}`} onPress={() => i.conversationId && openChat(i.conversationId)}
                    style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, minWidth: 0 }}>
                    <Avatar name={i.title} photoUrl={i.photoUrl} size={44} />
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text numberOfLines={1} style={{ fontWeight: '700', fontSize: 16, color: red ? t['danger-ink'] : t.ink }}>{i.title}</Text>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                        <Icon name={dirIcon(i)} size={14} color={red ? t['danger-ink'] : t['ink-soft']} />
                        <Text numberOfLines={1} style={{ fontSize: 13, color: red ? t['danger-ink'] : t['ink-soft'] }}>{resultText(i, r.count)}{i.media === 'video' ? ' · video' : ''}</Text>
                      </View>
                    </View>
                  </Pressable>
                  <Text style={{ fontSize: 12, color: t['ink-soft'] }}>{clock(i.at)}</Text>
                  {i.conversationId && i.result !== 'live' ? (
                    <Pressable accessibilityRole="button" accessibilityLabel={`Call ${i.title} (${i.media})`} disabled={!!calls.session} hitSlop={8}
                      onPress={() => void calls.start(i.conversationId!, i.media).catch(() => undefined)} style={{ padding: 6, opacity: calls.session ? 0.4 : 1 }}>
                      <Icon name={i.media === 'video' ? 'video' : 'phone'} size={20} color={t['ember-ink']} />
                    </Pressable>
                  ) : null}
                </View>
              </View>
            );
          })}
        </View>
      ) : null}
      {next ? <View style={{ alignItems: 'center' }}><OvalButton icon="clock" label="Show older calls" size="sm" variant="soft" onPress={() => void load(next)} /></View> : null}
    </TabPage>
  );
}

const styles = StyleSheet.create({
  tab: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 999, borderWidth: 1 },
  card: { borderRadius: 24, paddingVertical: 6 },
  empty: { borderRadius: 24, alignItems: 'center', gap: 10, padding: 28 },
  day: { fontFamily: font.display, fontWeight: '800', fontSize: 12, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 10 },
});

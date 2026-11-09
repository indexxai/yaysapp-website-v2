import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { POLL_LIMITS, type ConversationSummary, type ThreadItem } from '@yays/shared';
import { useEngine } from '../lib/chat';
import { useTheme } from '../lib/theme';
import { Icon } from '../ui/Icon';
import { Banner, Field, OvalButton } from '../ui/kit';
import { Oval } from '../ui/Oval';
import { Text } from '../ui/Text';
import { errText } from './messages';

/** A poll in the chat: tap an answer to vote (again to take it back); bars show how people voted. */
export function PollCard({ m, c }: { m: ThreadItem; c: ConversationSummary }) {
  const t = useTheme();
  const engine = useEngine();
  const p = m.poll;
  const [error, setError] = useState<string | null>(null);
  if (!p) return null;
  const mine = m.senderId === engine.me;
  const ink = mine ? t['on-ember'] : t.ink;
  const soft = mine ? t['on-ember'] : t['ink-soft'];
  const my = p.myVotes ?? [];
  const canVote = !!m.id && (c.canSend || c.group?.role !== 'former');
  const most = Math.max(1, ...p.options.map((o) => o.votes));
  const vote = (id: string) => {
    if (!canVote) return;
    const next = p.multi ? (my.includes(id) ? my.filter((x) => x !== id) : [...my, id]) : my.includes(id) ? [] : [id];
    setError(null);
    void engine.vote(c.id, m.id!, next).catch((e) => setError(errText(e, 'Could not vote.')));
  };
  return (
    <View testID="poll" style={{ width: 250, gap: 8 }}>
      <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
        <Icon name="list" size={16} color={soft} />
        <Text style={{ fontSize: 12, fontWeight: '700', color: soft }}>{p.anonymous ? 'Anonymous poll' : 'Poll'} · {p.multi ? 'Pick one or more' : 'Pick one'}</Text>
      </View>
      <Text style={{ fontFamily: 'Outfit', fontWeight: '800', fontSize: 16, color: ink }}>{p.question}</Text>
      {p.options.map((o) => {
        const on = my.includes(o.id);
        return (
          <Pressable key={o.id} accessibilityRole={p.multi ? 'checkbox' : 'radio'} accessibilityState={{ checked: on, disabled: !canVote }} accessibilityLabel={`${o.text}, ${o.votes} vote${o.votes === 1 ? '' : 's'}`}
            onPress={() => vote(o.id)} style={{ gap: 4 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Oval width={22} fill={on ? (mine ? '#ffffff' : t.ember) : mine ? 'rgba(255,255,255,0.25)' : t.sunken}>{on ? <Icon name="check" size={13} color={mine ? t.ember : t['on-ember']} /> : null}</Oval>
              <Text style={{ flex: 1, fontSize: 15, color: ink }}>{o.text}</Text>
              <Text style={{ fontSize: 13, fontWeight: '700', color: soft }}>{o.votes}</Text>
            </View>
            <View style={{ height: 6, borderRadius: 3, marginLeft: 30, backgroundColor: mine ? 'rgba(255,255,255,0.25)' : t.sunken, overflow: 'hidden' }}>
              <View style={{ width: `${(o.votes / most) * 100}%`, height: '100%', borderRadius: 3, backgroundColor: mine ? '#ffffff' : t.ember }} />
            </View>
          </Pressable>
        );
      })}
      <Text style={{ fontSize: 12, color: soft }}>{p.voterCount} {p.voterCount === 1 ? 'person' : 'people'} voted</Text>
      {error ? <Text accessibilityRole="alert" style={{ fontSize: 12, fontWeight: '700', color: mine ? '#ffffff' : t['danger-ink'] }}>{error}</Text> : null}
    </View>
  );
}

/** Ask a question with 2–12 answers; one answer or several; voters shown or not. */
export function NewPollScreen({ conversationId, onDone }: { conversationId: string; onDone: () => void }) {
  const t = useTheme();
  const engine = useEngine();
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '']);
  const [multi, setMulti] = useState(false);
  const [anonymous, setAnonymous] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const filled = options.map((o) => o.trim()).filter(Boolean);
  const ready = question.trim() && filled.length >= POLL_LIMITS.minOptions;
  const create = async () => {
    setBusy(true); setError(null);
    try { await engine.createPoll(conversationId, { question: question.trim(), options: filled, multi, anonymous }); onDone(); }
    catch (e) { setError(errText(e, 'Could not create the poll.')); setBusy(false); }
  };
  const row = (label: string, value: boolean, set: (v: boolean) => void) => (
    <View style={styles.switchRow}>
      <Text style={{ flex: 1, fontSize: 15, color: t.ink }}>{label}</Text>
      <Switch accessibilityLabel={label} value={value} onValueChange={set} trackColor={{ true: t.ember, false: t['line-strong'] }} thumbColor="#ffffff" />
    </View>
  );
  return (
    <SafeAreaView edges={['bottom', 'left', 'right']} style={{ flex: 1, backgroundColor: t.ground }}>
      <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }} keyboardShouldPersistTaps="handled">
        <Text accessibilityRole="header" style={styles.h1(t.ink)}>New poll</Text>
        {error ? <Banner>{error}</Banner> : null}
        <Field label="Question" value={question} onChangeText={setQuestion} maxLength={POLL_LIMITS.question} placeholder="Where shall we eat?" />
        <View style={{ gap: 10 }}>
          {options.map((o, i) => (
            <View key={i} style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8 }}>
              <View style={{ flex: 1 }}><Field label={`Option ${i + 1}`} value={o} maxLength={POLL_LIMITS.option} onChangeText={(v) => setOptions((x) => x.map((y, j) => (j === i ? v : y)))} /></View>
              {options.length > POLL_LIMITS.minOptions ? (
                <Pressable accessibilityRole="button" accessibilityLabel={`Remove option ${i + 1}`} onPress={() => setOptions((x) => x.filter((_, j) => j !== i))} hitSlop={8} style={{ paddingBottom: 14 }}>
                  <Icon name="close" size={20} color={t['ink-soft']} />
                </Pressable>
              ) : null}
            </View>
          ))}
          {options.length < POLL_LIMITS.maxOptions ? <View style={{ alignItems: 'flex-start' }}><OvalButton icon="plus" label="Add option" size="sm" variant="soft" onPress={() => setOptions((x) => [...x, ''])} /></View> : null}
        </View>
        <View style={{ backgroundColor: t.raised, borderRadius: 20, paddingHorizontal: 14 }}>
          {row('Allow more than one answer', multi, setMulti)}
          {row('Hide who voted for what', anonymous, setAnonymous)}
        </View>
        <View style={{ alignItems: 'center' }}><OvalButton icon="send" label="Send poll" loading={busy} disabled={!ready} onPress={() => void create()} /></View>
      </ScrollView>
    </SafeAreaView>
  );
}

/** "@" in a group opens this list above the message box; it follows what's typed after the "@". */
export function MentionList({ people, onPick }: { people: Array<{ id: string; name: string; photoUrl: string | null }>; onPick: (p: { id: string; name: string }) => void }) {
  const t = useTheme();
  if (!people.length) return null;
  return (
    <View testID="mention-list" accessibilityRole="menu" style={{ backgroundColor: t.raised, borderRadius: 16, overflow: 'hidden' }}>
      {people.map((p) => (
        <Pressable key={p.id} accessibilityRole="menuitem" accessibilityLabel={`Mention ${p.name}`} onPress={() => onPick(p)} style={({ pressed }) => [styles.mention, { backgroundColor: pressed ? t.sunken : 'transparent' }]}>
          <Oval width={28} fill={t['ember-wash']}><Text style={{ fontWeight: '800', fontSize: 11, color: t['ember-ink'] }}>{p.name.slice(0, 1).toUpperCase()}</Text></Oval>
          <Text style={{ fontWeight: '700', color: t.ink }}>{p.name}</Text>
        </Pressable>
      ))}
    </View>
  );
}

/** Splits a message so the names it mentions ("@Sara Ahmed") can be shown in bold. */
export function withMentions(text: string, names: string[]): Array<{ text: string; mention: boolean }> {
  const wanted = names.filter(Boolean).map((n) => `@${n}`).sort((a, b) => b.length - a.length);
  if (!wanted.length) return [{ text, mention: false }];
  const out: Array<{ text: string; mention: boolean }> = [];
  let rest = text;
  while (rest) {
    let at = -1, hit = '';
    for (const w of wanted) { const i = rest.indexOf(w); if (i >= 0 && (at < 0 || i < at)) { at = i; hit = w; } }
    if (at < 0) { out.push({ text: rest, mention: false }); break; }
    if (at > 0) out.push({ text: rest.slice(0, at), mention: false });
    out.push({ text: hit, mention: true });
    rest = rest.slice(at + hit.length);
  }
  return out;
}

const styles = {
  h1: (ink: string) => ({ fontFamily: 'Outfit', fontSize: 30, lineHeight: 36, fontWeight: '800' as const, color: ink }),
  ...StyleSheet.create({
    switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
    mention: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 8 },
  }),
};

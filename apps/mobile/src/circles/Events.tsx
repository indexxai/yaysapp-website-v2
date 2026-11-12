import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, Switch, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CIRCLE_LIMITS, CIRCLE_TIMES, type CircleComment, type CircleEvent, type CircleView, type CreateEventInput, type EventMode, type MeProfile } from '@yays/shared';
import { api } from '../lib/api';
import { font, useTheme } from '../lib/theme';
import { Icon, type IconName } from '../ui/Icon';
import { Avatar, Banner as ErrorBanner, Field, OvalButton, TextLink } from '../ui/kit';
import { LineArt } from '../ui/LineArt';
import { Oval } from '../ui/Oval';
import { Text } from '../ui/Text';
import { CommentBox, Thread } from './Posts';
import { Banner, Card, Chip, DateBlock, Header, Note, Sheet, State, Tag, errText, isMember, longDay, shortDay, span, timeOf, tzName } from './common';

const where = (e: CircleEvent) => (e.mode === 'online' ? 'Online' : e.place);
const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;

/** A row in a circle's Events tab. */
export function EventRow({ e, onPress }: { e: CircleEvent; onPress: () => void }) {
  const t = useTheme();
  const mine = e.myRsvp === 'going' ? 'You’re going' : e.myRsvp === 'waitlist' ? `Waitlist #${e.waitlistPos}` : e.myRsvp === 'offered' ? 'A seat is waiting for you' : e.myRsvp === 'interested' ? 'Interested' : null;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={e.title} testID="event-row" onPress={onPress} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 12, backgroundColor: pressed ? t.sunken : 'transparent' })}>
      <DateBlock iso={e.startsAt} tz={e.timeZone} />
      <View style={{ flex: 1, gap: 3 }}>
        <Text style={{ fontSize: 14, fontWeight: '700', color: t.ink, textDecorationLine: e.status === 'cancelled' ? 'line-through' : 'none' }} numberOfLines={2}>{e.title}</Text>
        <Text style={{ fontSize: 12, color: t['ink-soft'] }} numberOfLines={1}>{shortDay(e.startsAt, e.timeZone)} · {timeOf(e.startsAt, e.timeZone)} {tzName(e.startsAt, e.timeZone)} · {where(e)}</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
          {e.status === 'cancelled' ? <Tag kind="danger" icon="close">Cancelled</Tag> : null}
          {e.status === 'ended' ? <Tag kind="muted" icon="check">Ended</Tag> : null}
          {e.status === 'scheduled' && e.seats !== null && e.going >= e.seats ? <Tag kind="danger" icon="users">Full</Tag> : null}
          {e.needsAck ? <Tag kind="warn" icon="alert">Changed</Tag> : null}
          {mine ? <Tag kind="official">{mine}</Tag> : null}
          <Text style={{ fontSize: 12, color: t['ink-soft'] }}>{e.going} going</Text>
        </View>
      </View>
      <Icon name="chevron-right" size={16} color={t['ink-faint']} />
    </Pressable>
  );
}

/** The circle's events, coming up first; past ones on request. */
export function EventsTab({ c, onNew, openEvent }: { c: CircleView; onNew: () => void; openEvent: (id: string) => void }) {
  const t = useTheme();
  const [list, setList] = useState<CircleEvent[] | null>(null);
  const [past, setPast] = useState<CircleEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { void api().then((a) => a.circleEvents(c.id)).then(setList, (e) => setError(errText(e))); }, [c.id]);
  const member = isMember(c);
  return (
    <View style={{ gap: 12 }}>
      {error ? <ErrorBanner>{error}</ErrorBanner> : null}
      {member && !c.muted ? <View style={{ alignItems: 'flex-end' }}><OvalButton icon="plus" label="New event" size="sm" onPress={onNew} /></View> : null}
      {!list && !error ? <ActivityIndicator color={t.ember} /> : null}
      {list && !list.length ? <State icon="calendar" tone="plain" title="No events coming up">{member ? 'Plan a meetup, a seminar or an online Q&A.' : 'Check back later.'}</State> : null}
      {list?.length ? <Card pad={false}>{list.map((e) => <EventRow key={e.id} e={e} onPress={() => openEvent(e.id)} />)}</Card> : null}
      {past === null ? <View style={{ alignItems: 'center' }}><TextLink label="Show past events" onPress={() => void api().then((a) => a.circleEvents(c.id, true)).then(setPast, () => setPast([]))} /></View>
        : past.length ? <Card title="Past events" pad={false}>{past.map((e) => <EventRow key={e.id} e={e} onPress={() => openEvent(e.id)} />)}</Card>
        : <Text style={{ textAlign: 'center', fontSize: 13, color: t['ink-soft'] }}>No past events.</Text>}
    </View>
  );
}

/* ------------------------------------------------------------------ the event page (p39, p55–p58) */

export function EventScreen({ id, me, onBack, openCircle, openEdit }: { id: string; me: MeProfile; onBack: () => void; openCircle: (id: string) => void; openEdit: (circleId: string, eventId: string) => void }) {
  const t = useTheme();
  const [e, setE] = useState<CircleEvent | null>(null);
  const [c, setC] = useState<CircleView | null>(null);
  const [qs, setQs] = useState<CircleComment[]>([]);
  const [replyTo, setReplyTo] = useState<CircleComment | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try {
      const a = await api();
      const ev = await a.circleEvent(id);
      const [circle, q] = await Promise.all([a.circle(ev.circle.id), a.eventQuestions(id)]);
      setE(ev); setC(circle); setQs(q);
    } catch (x) { setNotFound(errText(x, 'This event isn’t available.')); }
  }, [id]);
  useEffect(() => { void load(); }, [load]);
  const act = async (fn: (a: Awaited<ReturnType<typeof api>>) => Promise<CircleEvent>) => { setBusy(true); setError(null); try { setE(await fn(await api())); } catch (x) { setError(errText(x)); } finally { setBusy(false); } };
  if (notFound) return <SafeAreaView style={{ flex: 1, backgroundColor: t.surface }}><Header back="Back" onBack={onBack} /><State icon="calendar" tone="plain" title="This event isn’t available">{notFound}</State></SafeAreaView>;
  if (!e || !c) return <SafeAreaView style={{ flex: 1, backgroundColor: t.surface, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color={t.ember} /></SafeAreaView>;
  const member = isMember(c);
  const full = e.seats !== null && e.going >= e.seats;
  const tz = e.timeZone;
  const cancelled = e.status === 'cancelled';
  const money = c.category === 'crypto' || c.category === 'ai';
  return (
    <View style={{ flex: 1, backgroundColor: t.surface }} testID="event-screen">
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ paddingBottom: 16 }} keyboardShouldPersistTaps="handled">
          <Banner height={150}>
            <LineArt name="lantern" height={140} ink="#ffffff" opacity={0.6} style={{ right: 24, bottom: -10 }} />
            <SafeAreaView edges={['top']} style={{ paddingHorizontal: 14, paddingTop: 6 }}><View style={{ alignSelf: 'flex-start' }}><OvalButton icon="arrow-left" label="Events" size="sm" variant="secondary" onPress={onBack} /></View></SafeAreaView>
          </Banner>
          <View style={{ padding: 12, gap: 12 }}>
            <View style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start', paddingHorizontal: 4 }}>
              <DateBlock iso={e.startsAt} tz={tz} />
              <View style={{ flex: 1, gap: 4 }}>
                <Text accessibilityRole="header" style={{ fontFamily: font.display, fontWeight: '800', fontSize: 22, lineHeight: 28, color: t.ink, textDecorationLine: cancelled ? 'line-through' : 'none' }}>{e.title}</Text>
                <Text style={{ fontSize: 13, color: t['ink-soft'] }}><Text style={{ color: t['ember-ink'], fontWeight: '700' }} onPress={() => openCircle(c.id)}>{c.name}</Text> · hosted by {e.host.displayName}</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                  {e.host.official ? <Tag kind="official" icon="shield-check">Official</Tag> : null}
                  {cancelled ? <Tag kind="danger" icon="close">Cancelled</Tag> : null}
                  {e.status === 'ended' ? <Tag kind="muted" icon="check">Ended · {e.going} went</Tag> : null}
                  {e.status === 'scheduled' && full ? <Tag kind="danger" icon="users">Full · {e.going} of {e.seats} seats</Tag> : null}
                  {e.status === 'scheduled' && e.seats !== null && !full ? <Tag kind="muted" icon="users">{e.seats - e.going} of {e.seats} seats left</Tag> : null}
                </View>
              </View>
            </View>
            {error ? <ErrorBanner>{error}</ErrorBanner> : null}
            {cancelled ? (
              <Card testID="event-cancelled"><View style={{ flexDirection: 'row', gap: 10 }}><Avatar name={e.host.displayName} photoUrl={e.host.photoUrl} size={36} /><View style={{ flex: 1 }}><Text style={{ fontWeight: '700', color: t.ink }}>Message from {e.host.displayName}</Text><Text style={{ color: t.ink, fontSize: 14, lineHeight: 20 }}>{e.cancelNote || 'This event was cancelled.'}</Text></View></View></Card>
            ) : null}
            {e.change && e.status === 'scheduled' ? (
              <View testID="event-changed" style={{ gap: 10, padding: 14, borderRadius: 18, backgroundColor: t['warning-wash'] }}>
                <View style={{ flexDirection: 'row', gap: 10 }}><Icon name="alert" size={18} color={t['warning-ink']} /><Text style={{ flex: 1, fontWeight: '700', color: t.ink }}>The host changed this event</Text></View>
                <Text style={{ fontSize: 13, lineHeight: 19, color: t.ink }}>
                  {e.change.was.startsAt ? `Now ${shortDay(e.startsAt, tz)}, ${timeOf(e.startsAt, tz)} (was ${shortDay(e.change.was.startsAt, tz)}, ${timeOf(e.change.was.startsAt, tz)}). ` : ''}
                  {e.change.was.place !== undefined ? `Now at ${e.place || 'online'} (was ${e.change.was.place || 'online'}).` : ''}
                </Text>
                {e.needsAck ? (
                  <View style={{ gap: 8 }}>
                    <Text style={{ fontWeight: '700', color: t.ink }}>Still going?</Text>
                    <View style={{ flexDirection: 'row', gap: 26 }}>
                      <OvalButton icon="check" label="Yes, still going" size="sm" loading={busy} onPress={() => void act((a) => a.ackEventChange(e.id))} />
                      <OvalButton icon="close" label="Can’t go now" size="sm" variant="ghost" onPress={() => void act((a) => a.rsvp(e.id, 'not_going'))} />
                    </View>
                  </View>
                ) : null}
              </View>
            ) : null}
            <Card pad={false} style={{ paddingVertical: 4 }}>
              <Info icon="calendar" title={`${longDay(e.startsAt, tz)}, ${span(e.startsAt, e.endsAt, tz)}`} sub={cancelled ? 'Cancelled' : `${tzName(e.startsAt, tz)} · ${tz.replace(/_/g, ' ')}`} strike={cancelled} />
              {e.mode !== 'online' ? <Info icon="location" title={e.place} sub="Directions" onSub={() => void Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(e.place)}`).catch(() => undefined)} /> : null}
              {e.mode !== 'in_person' ? <Info icon="video" title={e.mode === 'both' ? 'Also online' : 'Online'} sub={e.onlineUrl ? 'Join online' : cancelled ? 'The link no longer works' : 'The link shows here once you tap Going'} onSub={e.onlineUrl ? () => void Linking.openURL(e.onlineUrl!).catch(() => undefined) : undefined} testID="online-link" /> : null}
            </Card>
            {e.goingPreview.length ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 4 }}>
                <View style={{ flexDirection: 'row', paddingLeft: 8 }}>{e.goingPreview.slice(0, 5).map((p) => <View key={p.id} style={{ marginLeft: -8 }}><Avatar name={p.displayName} photoUrl={p.photoUrl} size={32} /></View>)}</View>
                <Text style={{ fontSize: 13, color: t['ink-soft'] }}><Text style={{ fontWeight: '700', color: t.ink }}>{e.going} going</Text>{e.interested ? ` · ${e.interested} interested` : ''}</Text>
              </View>
            ) : null}
            {e.status === 'scheduled' ? <Rsvp e={e} c={c} member={member} busy={busy} act={act} openCircle={() => openCircle(c.id)} /> : null}
            {e.status === 'ended' && (e.recordingUrl || e.slidesUrl) ? (
              <Card pad={false}>
                {e.recordingUrl ? <Info icon="play" title="Recording" sub="Opens in your browser" onPress={() => void Linking.openURL(e.recordingUrl!)} /> : null}
                {e.slidesUrl ? <Info icon="file" title="Slides" sub="Opens in your browser" onPress={() => void Linking.openURL(e.slidesUrl!)} /> : null}
              </Card>
            ) : null}
            {e.status === 'ended' && e.rating ? <Rating e={e} onRate={(n) => void act((a) => a.rateEvent(e.id, n))} /> : null}
            {e.about ? <Card title="About this event"><Text style={{ fontSize: 14, lineHeight: 21, color: t.ink }}>{e.about}</Text></Card> : null}
            {money && !cancelled ? <Note icon="info">Educational event. Nothing here is investment advice, and no one may sell investments at it or in this circle.</Note> : null}
            <Card title={`Questions · ${e.questions}`}>
              {qs.length ? <Thread comments={qs} c={c} canAnswer={e.canManage || c.access === 'admin'} readOnly={!member || !!c.muted || cancelled} onReply={setReplyTo} onChanged={() => void load()} /> : <Text style={{ color: t['ink-soft'], fontSize: 14 }}>No questions yet.</Text>}
            </Card>
            {e.canManage && !cancelled ? (
              <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 32 }}>
                <OvalButton icon="edit" label={e.status === 'ended' ? 'Add recording' : 'Edit'} size="sm" variant="soft" onPress={() => openEdit(c.id, e.id)} />
                {e.status === 'scheduled' ? <OvalButton icon="close" label="Cancel event" size="sm" variant="ghost" onPress={() => setCancelling(true)} /> : null}
              </View>
            ) : null}
            {cancelled ? <View style={{ alignItems: 'center' }}><OvalButton icon="calendar" label="Other events" variant="soft" onPress={() => openCircle(c.id)} /></View> : null}
          </View>
        </ScrollView>
        {member && !cancelled ? <CommentBox me={me} placeholder="Ask a question…" replyTo={replyTo} onCancelReply={() => setReplyTo(null)} disabled={c.muted ? 'You’re muted in this circle for now.' : null}
          onSend={async (text) => { await (await api()).askEventQuestion(e.id, text, replyTo?.id); setReplyTo(null); await load(); }} /> : null}
      </KeyboardAvoidingView>
      {cancelling ? <CancelSheet e={e} onClose={() => setCancelling(false)} onDone={(x) => { setCancelling(false); setE(x); }} /> : null}
    </View>
  );
}

function Info({ icon, title, sub, onSub, onPress, strike, testID }: { icon: IconName; title: string; sub: string; onSub?: () => void; onPress?: () => void; strike?: boolean; testID?: string }) {
  const t = useTheme();
  const body = (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 10 }} testID={testID}>
      <Oval width={36} fill={t['ember-wash']}><Icon name={icon} size={16} color={t['ember-ink']} /></Oval>
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 14, fontWeight: '700', color: t.ink, textDecorationLine: strike ? 'line-through' : 'none' }}>{title}</Text>
        {onSub ? <TextLink label={sub} onPress={onSub} /> : <Text style={{ fontSize: 12, color: t['ink-soft'] }}>{sub}</Text>}
      </View>
      {onPress ? <Icon name="chevron-right" size={16} color={t['ink-faint']} /> : null}
    </View>
  );
  return onPress ? <Pressable accessibilityRole="button" accessibilityLabel={title} onPress={onPress}>{body}</Pressable> : body;
}

function Rating({ e, onRate }: { e: CircleEvent; onRate: (n: number) => void }) {
  const t = useTheme();
  const r = e.rating!;
  const can = e.myRsvp === 'going';
  return (
    <Card style={{ alignItems: 'center' }}>
      <Text style={{ fontWeight: '700', color: t.ink }}>{can ? 'How was it?' : 'Rating'}</Text>
      <View style={{ flexDirection: 'row', gap: 6 }} accessibilityRole={can ? 'radiogroup' : undefined}>
        {[1, 2, 3, 4, 5].map((n) => {
          const on = n <= (r.mine ?? Math.round(r.average));
          return <Pressable key={n} disabled={!can} accessibilityRole="radio" accessibilityState={{ checked: r.mine === n }} accessibilityLabel={`${n} star${n > 1 ? 's' : ''}`} onPress={() => onRate(n)} hitSlop={4}>
            <Icon name="star" size={can ? 30 : 22} color={on ? t.gold : t['ink-faint']} strokeWidth={on ? 2.6 : 1.6} />
          </Pressable>;
        })}
      </View>
      {r.count > 0 ? <Text style={{ fontSize: 12, color: t['ink-soft'] }}>{r.average} from {r.count} {r.count === 1 ? 'person' : 'people'}</Text> : null}
    </Card>
  );
}

function Rsvp({ e, c, member, busy, act, openCircle }: { e: CircleEvent; c: CircleView; member: boolean; busy: boolean; act: (fn: (a: Awaited<ReturnType<typeof api>>) => Promise<CircleEvent>) => Promise<void>; openCircle: () => void }) {
  const t = useTheme();
  if (!member) return <Card style={{ alignItems: 'center' }}><Text style={{ color: t['ink-soft'] }}>Join {c.name} to say you’re going.</Text><OvalButton icon="people" label="Open the circle" size="sm" variant="soft" onPress={openCircle} /></Card>;
  if (e.myRsvp === 'waitlist') {
    return (
      <Card testID="waitlist" style={{ alignItems: 'center' }}>
        <Text style={{ fontFamily: font.display, fontWeight: '800', fontSize: 34, color: t['ember-ink'] }}>#{e.waitlistPos}</Text>
        <Text style={{ fontWeight: '700', color: t.ink, fontSize: 16 }}>You’re {ordinal(e.waitlistPos ?? 1)} on the waitlist</Text>
        <Text style={{ fontSize: 13, lineHeight: 19, color: t['ink-soft'], textAlign: 'center' }}>If someone can’t go, the next person gets their seat. We’ll notify you, and you have {CIRCLE_TIMES.offerHours} hours to confirm it here.</Text>
        <OvalButton icon="close" label="Leave waitlist" size="sm" variant="ghost" loading={busy} onPress={() => void act((a) => a.leaveWaitlist(e.id))} />
      </Card>
    );
  }
  if (e.myRsvp === 'offered') {
    return (
      <Card testID="seat-offer" style={{ alignItems: 'center' }}>
        <Oval width={56} fill={t['success-wash']}><Icon name="check" size={24} color={t['success-ink']} /></Oval>
        <Text style={{ fontWeight: '700', color: t.ink, fontSize: 16 }}>A seat opened up for you</Text>
        <Text style={{ fontSize: 13, color: t['ink-soft'], textAlign: 'center' }}>Confirm by {e.offerUntil ? new Date(e.offerUntil).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' }) : 'soon'}, or it goes to the next person.</Text>
        <View style={{ flexDirection: 'row', gap: 32 }}>
          <OvalButton icon="check" label="Confirm seat" loading={busy} onPress={() => void act((a) => a.confirmSeat(e.id))} />
          <OvalButton icon="close" label="No thanks" variant="ghost" onPress={() => void act((a) => a.leaveWaitlist(e.id))} />
        </View>
      </Card>
    );
  }
  const fullForMe = e.seats !== null && e.going >= e.seats && e.myRsvp !== 'going';
  return (
    <View style={{ gap: 8, alignItems: 'center' }} testID="rsvp">
      <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 22 }}>
        <OvalButton icon={fullForMe ? 'clock' : 'check'} label={e.myRsvp === 'going' ? 'Going' : fullForMe ? 'Join waitlist' : 'Going'} size="lg" variant={e.myRsvp === 'going' ? 'primary' : 'soft'} loading={busy} onPress={() => void act((a) => a.rsvp(e.id, 'going'))} testID="rsvp-going" />
        <OvalButton icon="star" label="Interested" size="lg" variant={e.myRsvp === 'interested' ? 'primary' : 'soft'} onPress={() => void act((a) => a.rsvp(e.id, 'interested'))} testID="rsvp-interested" />
        <OvalButton icon="close" label="Can’t go" size="lg" variant={e.myRsvp === 'not_going' ? 'secondary' : 'ghost'} onPress={() => void act((a) => a.rsvp(e.id, 'not_going'))} testID="rsvp-no" />
      </View>
      {e.myRsvp ? <Text style={{ fontSize: 12, fontWeight: '700', color: t['ember-ink'] }}>{{ going: 'You’re going', interested: 'You’re interested', not_going: 'You said you can’t go', waitlist: '', offered: '' }[e.myRsvp]}</Text> : null}
      {fullForMe ? <Text style={{ fontSize: 12, color: t['ink-soft'], textAlign: 'center' }}>All {e.seats} seats are taken{e.waitlist ? ` and ${e.waitlist} ${e.waitlist === 1 ? 'person is' : 'people are'} waiting` : ''}.</Text> : null}
    </View>
  );
}

function CancelSheet({ e, onClose, onDone }: { e: CircleEvent; onClose: () => void; onDone: (e: CircleEvent) => void }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Sheet title="Cancel this event?" lead={`${e.going} going and ${e.interested} interested will see your message.`} onClose={onClose}>
      {error ? <ErrorBanner>{error}</ErrorBanner> : null}
      <Field label="Message to people going" value={note} onChangeText={setNote} maxLength={CIRCLE_LIMITS.cancelNote} multiline placeholder="Sorry, we need to move this. We’ll post a new date soon." />
      <View style={{ alignItems: 'center' }}><OvalButton icon="close" label="Cancel event" variant="danger" loading={busy} onPress={() => void (async () => { setBusy(true); try { onDone(await (await api()).cancelCircleEvent(e.id, note)); } catch (x) { setError(errText(x)); setBusy(false); } })()} /></View>
    </Sheet>
  );
}

/* ------------------------------------------------------------------ new / edit event (p41) */

const pad = (n: number) => String(n).padStart(2, '0');
const parts = (iso: string, tz: string) => {
  try {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
    return { date: `${p.year}-${p.month}-${p.day}`, mins: (Number(p.hour) % 24) * 60 + Number(p.minute) };
  } catch { const d = new Date(iso); return { date: iso.slice(0, 10), mins: d.getUTCHours() * 60 + d.getUTCMinutes() }; }
};
/** A wall-clock time in a time zone → an instant (the same sum as the web). */
export const fromLocal = (date: string, mins: number, tz: string) => {
  const guess = new Date(`${date}T${pad(Math.floor(mins / 60))}:${pad(mins % 60)}:00Z`);
  const back = parts(guess.toISOString(), tz);
  const shown = new Date(`${back.date}T${pad(Math.floor(back.mins / 60))}:${pad(back.mins % 60)}:00Z`);
  return new Date(guess.getTime() - (shown.getTime() - guess.getTime())).toISOString();
};
const clockText = (mins: number) => { const h = Math.floor(mins / 60) % 24, m = mins % 60; return `${h % 12 || 12}:${pad(m)} ${h < 12 ? 'am' : 'pm'}`; };
const myTz = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; } };
const addDays = (date: string, n: number) => { const d = new Date(`${date}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const dayChip = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

/** Hours and minutes, in 15-minute steps. */
function TimeStep({ label, mins, onChange }: { label: string; mins: number; onChange: (m: number) => void }) {
  const t = useTheme();
  const step = (d: number) => onChange((mins + d + 1440) % 1440);
  return (
    <View style={{ flex: 1, gap: 6 }}>
      <Text style={{ fontFamily: font.display, fontSize: 14, fontWeight: '700', color: t.ink }}>{label}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 48, paddingHorizontal: 6, borderRadius: 16, borderWidth: 1, borderColor: t['line-strong'], backgroundColor: t.raised }}>
        <Pressable accessibilityRole="button" accessibilityLabel={`${label} earlier`} onPress={() => step(-15)} hitSlop={8} style={{ padding: 6 }}><Icon name="minus" size={18} color={t['ember-ink']} /></Pressable>
        <Text accessibilityLabel={`${label} ${clockText(mins)}`} style={{ fontSize: 16, fontWeight: '700', color: t.ink }}>{clockText(mins)}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel={`${label} later`} onPress={() => step(15)} hitSlop={8} style={{ padding: 6 }}><Icon name="plus" size={18} color={t['ember-ink']} /></Pressable>
      </View>
    </View>
  );
}

/** Details, where, seats. Editing the time or place tells people going (p56). After it ends: recording and slides. */
export function EventFormScreen({ circleId, eventId, onBack, onSaved }: { circleId: string; eventId?: string; onBack: () => void; onSaved: (e: CircleEvent) => void }) {
  const t = useTheme();
  const [c, setC] = useState<CircleView | null>(null);
  const [e, setE] = useState<CircleEvent | null | undefined>(eventId ? undefined : null);
  const tz = e?.timeZone ?? myTz();
  const today = useMemo(() => parts(new Date().toISOString(), tz).date, [tz]);
  const [title, setTitle] = useState('');
  const [about, setAbout] = useState('');
  const [date, setDate] = useState(() => addDays(parts(new Date().toISOString(), myTz()).date, 7));
  const [from, setFrom] = useState(18 * 60);
  const [to, setTo] = useState(20 * 60);
  const [mode, setMode] = useState<EventMode>('in_person');
  const [place, setPlace] = useState('');
  const [link, setLink] = useState('');
  const [limit, setLimit] = useState(false);
  const [seats, setSeats] = useState('40');
  const [recording, setRecording] = useState('');
  const [slides, setSlides] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void (async () => {
      try {
        const a = await api();
        setC(await a.circle(circleId));
        if (!eventId) return;
        const ev = await a.circleEvent(eventId);
        const s = parts(ev.startsAt, ev.timeZone), en = parts(ev.endsAt, ev.timeZone);
        setE(ev); setTitle(ev.title); setAbout(ev.about); setDate(s.date); setFrom(s.mins); setTo(en.mins); setMode(ev.mode); setPlace(ev.place);
        setLink(ev.onlineUrl ?? ''); setLimit(ev.seats != null); setSeats(String(ev.seats ?? 40)); setRecording(ev.recordingUrl ?? ''); setSlides(ev.slidesUrl ?? '');
      } catch (x) { setError(errText(x)); }
    })();
  }, [circleId, eventId]);
  const ended = e?.status === 'ended';
  const days = useMemo(() => { const out: string[] = []; for (let i = 0; i < 90; i++) out.push(addDays(today, i)); if (!out.includes(date)) out.unshift(date); return out; }, [today, date]);
  const save = async () => {
    setBusy(true); setError(null);
    try {
      const a = await api();
      const startsAt = fromLocal(date, from, tz);
      let endsAt = fromLocal(date, to, tz);
      if (Date.parse(endsAt) <= Date.parse(startsAt)) endsAt = new Date(Date.parse(endsAt) + 86400_000).toISOString(); // ends after midnight
      const body: CreateEventInput = { title, about, startsAt, endsAt, timeZone: tz, mode, place: mode === 'online' ? '' : place, onlineUrl: mode === 'in_person' ? null : link.trim() || null, seats: limit ? Number(seats) || null : null };
      if (!e) onSaved(await a.createCircleEvent(circleId, body));
      else if (ended) onSaved(await a.updateCircleEvent(e.id, { recordingUrl: recording.trim() || null, slidesUrl: slides.trim() || null }));
      else onSaved(await a.updateCircleEvent(e.id, { ...body, ...(e.hasOnlineLink && mode !== 'in_person' && !link.trim() ? { onlineUrl: undefined } : {}) }));
    } catch (x) { setError(errText(x)); setBusy(false); }
  };
  if (e === undefined && !error) return <SafeAreaView style={{ flex: 1, backgroundColor: t.surface, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color={t.ember} /></SafeAreaView>;
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.surface }} testID="event-form">
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Header back="Cancel" onBack={onBack} title={e ? (ended ? 'Recording and slides' : 'Edit event') : 'New event'} />
        <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }} keyboardShouldPersistTaps="handled">
          {!e && c ? <Text style={{ color: t['ink-soft'], fontSize: 14 }}>In {c.name}. You’ll be the host.</Text> : null}
          {error ? <ErrorBanner>{error}</ErrorBanner> : null}
          {ended ? (
            <>
              <Field label="Recording link" value={recording} onChangeText={setRecording} autoCapitalize="none" keyboardType="url" placeholder="https://…" />
              <Field label="Slides link" value={slides} onChangeText={setSlides} autoCapitalize="none" keyboardType="url" placeholder="https://…" />
            </>
          ) : (
            <>
              <Field label="Event name" value={title} onChangeText={setTitle} maxLength={CIRCLE_LIMITS.eventTitle} placeholder="AI & Blockchain Seminar" />
              <View style={{ gap: 6 }}>
                <Text style={{ fontFamily: font.display, fontSize: 14, fontWeight: '700', color: t.ink }}>Date</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }} accessibilityRole="radiogroup" accessibilityLabel="Date">
                  {days.map((d) => <Chip key={d} label={dayChip(d)} on={d === date} onPress={() => setDate(d)} />)}
                </ScrollView>
              </View>
              <View style={{ flexDirection: 'row', gap: 12 }}>
                <TimeStep label="Starts" mins={from} onChange={(m) => { const len = (to - from + 1440) % 1440 || 120; setFrom(m); setTo((m + len) % 1440); }} />
                <TimeStep label="Ends" mins={to} onChange={setTo} />
              </View>
              <Text style={{ fontSize: 12, color: t['ink-soft'], marginTop: -8 }}>Times are in {tz.replace(/_/g, ' ')}.</Text>
              <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }} accessibilityRole="radiogroup" accessibilityLabel="Where">
                {([['in_person', 'location', 'In person'], ['online', 'video', 'Online'], ['both', 'users', 'Both']] as const).map(([m, ic, l]) => <Chip key={m} icon={ic} label={l} on={mode === m} onPress={() => setMode(m)} />)}
              </View>
              {mode !== 'online' ? <Field label="Place" value={place} onChangeText={setPlace} maxLength={CIRCLE_LIMITS.place} placeholder="Downtown Library, Room 2, Salt Lake City" /> : null}
              {mode !== 'in_person' ? <Field label="Online link" hint="Only people going see the link." value={link} onChangeText={setLink} autoCapitalize="none" keyboardType="url" placeholder={e?.hasOnlineLink ? 'Leave empty to keep the current link' : 'https://meet.example.com/…'} /> : null}
              <Field label="About (optional)" value={about} onChangeText={setAbout} maxLength={CIRCLE_LIMITS.eventAbout} multiline />
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <View style={{ flex: 1 }}><Text style={{ fontWeight: '700', color: t.ink }}>Limit seats</Text><Text style={{ fontSize: 13, color: t['ink-soft'] }}>{limit ? 'When it’s full, people join a waitlist.' : 'Off · anyone can tap Going'}</Text></View>
                <Switch accessibilityLabel="Limit seats" value={limit} onValueChange={setLimit} trackColor={{ true: t.ember, false: t.sunken }} thumbColor="#ffffff" />
              </View>
              {limit ? <Field label="Seats" value={seats} onChangeText={(v) => setSeats(v.replace(/\D/g, '').slice(0, 4))} keyboardType="number-pad" /> : null}
              {e ? <Note icon="info" tone="plain">Changing the time or place shows people going what changed and asks if they’re still coming.</Note> : null}
            </>
          )}
          <View style={{ alignItems: 'center', paddingTop: 4 }}><OvalButton icon="check" label={e ? 'Save' : 'Create event'} size="lg" loading={busy} disabled={!ended && !title.trim()} onPress={() => void save()} /></View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

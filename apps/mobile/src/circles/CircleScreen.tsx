import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { CIRCLE_CATEGORY_LABEL, CIRCLE_LIMITS, CIRCLE_TIMES, type CircleEvent, type CircleMemberRow, type CirclePost, type CircleReview, type CircleView, type CommunityGroup, type MeProfile } from '@yays/shared';
import { api } from '../lib/api';
import { font, useTheme } from '../lib/theme';
import { Icon } from '../ui/Icon';
import { Avatar, Banner as ErrorBanner, Field, OvalButton } from '../ui/kit';
import { LineArt, type ArtName } from '../ui/LineArt';
import { Oval } from '../ui/Oval';
import { Text } from '../ui/Text';
import { EventRow, EventsTab } from './Events';
import { PostCard } from './Posts';
import { Banner, Card, Chip, CircleMark, CircleTags, Note, Sheet, State, Tag, dateShort, errText, isMember, plural } from './common';

type TabKey = 'feed' | 'events' | 'chats' | 'members' | 'review' | 'about';
export interface OneCircleNav {
  back: () => void;
  compose: () => void;
  newEvent: () => void;
  openPost: (id: string) => void;
  openEvent: (id: string) => void;
  openChat: (id: string) => void;
  editCircle: () => void;
  discover: () => void;
}

/** One circle: banner, name, then Feed · Events · Chats · About (and Members · Review for its owners). */
export function CircleScreen({ id, me, tab: tab0, nav }: { id: string; me: MeProfile; tab?: TabKey; nav: OneCircleNav }) {
  const t = useTheme();
  const [c, setC] = useState<CircleView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [gone, setGone] = useState(false);
  const [tab, setTab] = useState<TabKey>(tab0 ?? 'feed');
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  // Bumped when the screen comes back into view (after writing a post or making an event): the tabs reload.
  const [fresh, setFresh] = useState(0);
  const load = useCallback(async () => {
    try { setC(await (await api()).circle(id)); setError(null); }
    catch (e) { if (!c) setGone(true); else setError(errText(e)); }
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  useFocusEffect(useCallback(() => { void load(); setFresh((n) => n + 1); }, [load]));
  if (gone) return <Unavailable onBack={nav.back} discover={nav.discover} />;
  if (!c) return <SafeAreaView style={{ flex: 1, backgroundColor: t.surface, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color={t.ember} /></SafeAreaView>;
  if (c.access === 'removed') return <Removed c={c} onBack={nav.back} />;
  const member = isMember(c);
  const admin = c.access === 'admin';
  const join = async () => { setBusy(true); setError(null); try { setC(await (await api()).joinCircle(c.id)); setFresh((n) => n + 1); } catch (e) { setError(errText(e)); } finally { setBusy(false); } };
  const tabs: Array<[TabKey, string]> = [
    ['feed', 'Feed'], ['events', c.upcomingEvents ? `Events · ${c.upcomingEvents}` : 'Events'],
    ...(member ? [['chats', c.chatCount ? `Chats · ${c.chatCount}` : 'Chats'] as [TabKey, string]] : []),
    ...(admin ? [['members', 'Members'] as [TabKey, string], ['review', c.pendingReview ? `Review · ${c.pendingReview}` : 'Review'] as [TabKey, string]] : []),
    ['about', 'About'],
  ];
  const art: [ArtName, 'left' | 'right'] = !c.canRead ? ['morning', 'right'] : ({ feed: ['chat', 'right'], events: ['selfie', 'left'], chats: ['chat', 'right'], members: ['skater', 'left'], review: ['gear', 'right'], about: ['reader', 'left'] } as const)[tab] as [ArtName, 'left' | 'right'];
  return (
    <View style={{ flex: 1, backgroundColor: t.surface }} testID="circle-screen">
      <LineArt name={art[0]} height={240} style={art[1] === 'left' ? { left: -36, right: undefined, bottom: 40 } : { bottom: 40 }} />
      <ScrollView stickyHeaderIndices={c.canRead ? [1] : undefined} contentContainerStyle={{ paddingBottom: 30 }}
        refreshControl={<RefreshControl refreshing={refreshing} tintColor={t.ember} onRefresh={() => { setRefreshing(true); void load().finally(() => { setRefreshing(false); setFresh((n) => n + 1); }); }} />}>
        <View>
          <Banner>
            <SafeAreaView edges={['top']} style={{ paddingHorizontal: 14, paddingTop: 6 }}><View style={{ alignSelf: 'flex-start' }}><OvalButton icon="arrow-left" label="Circles" size="sm" variant="secondary" onPress={nav.back} /></View></SafeAreaView>
          </Banner>
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingHorizontal: 16, marginTop: -30 }}>
            <CircleMark c={c} size={72} onBanner />
            <View style={{ flex: 1, paddingTop: 36, gap: 4 }}>
              <Text accessibilityRole="header" style={{ fontFamily: font.display, fontWeight: '800', fontSize: 20, lineHeight: 25, color: t.ink }}>{c.name}</Text>
              <CircleTags c={c} />
            </View>
            {c.access === 'visitor' && c.visibility === 'public' ? <View style={{ paddingTop: 34 }}><OvalButton icon="plus" label="Join" loading={busy} onPress={() => void join()} testID="join-circle" /></View> : null}
          </View>
          {c.lookalike ? <View style={{ paddingHorizontal: 12, paddingTop: 10 }}><Note icon="alert-triangle" tone="danger" testID="lookalike">This circle isn’t run by the team its name suggests. Only circles YaysApp has checked get the Official badge. Staff never ask you to send money.</Note></View> : null}
          {error ? <View style={{ paddingHorizontal: 12, paddingTop: 10 }}><ErrorBanner>{error}</ErrorBanner></View> : null}
        </View>
        {c.canRead ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ backgroundColor: t.surface, borderBottomWidth: 1, borderBottomColor: t.line, marginTop: 10 }} contentContainerStyle={{ gap: 22, paddingHorizontal: 16 }} accessibilityRole="tablist">
            {tabs.map(([k, l]) => (
              <Pressable key={k} accessibilityRole="tab" accessibilityState={{ selected: tab === k }} accessibilityLabel={l} onPress={() => setTab(k)} style={{ paddingVertical: 10, borderBottomWidth: 3, borderBottomColor: tab === k ? t.ember : 'transparent' }}>
                <Text style={{ fontFamily: font.display, fontWeight: '700', fontSize: 14, color: tab === k ? t['ember-ink'] : t['ink-soft'] }}>{l}</Text>
              </Pressable>
            ))}
          </ScrollView>
        ) : null}
        <View style={{ padding: 12, gap: 10 }}>
          {!c.canRead ? <PrivateGate c={c} onChange={setC} /> : (
            <>
              {tab === 'feed' ? <FeedTab key={fresh} c={c} me={me} nav={nav} onReload={() => void load()} /> : null}
              {tab === 'events' ? <EventsTab key={fresh} c={c} onNew={nav.newEvent} openEvent={nav.openEvent} /> : null}
              {tab === 'chats' && member ? <ChatsTab key={fresh} c={c} openChat={nav.openChat} /> : null}
              {tab === 'members' && admin ? <MembersTab c={c} me={me} /> : null}
              {tab === 'review' && admin ? <ReviewTab c={c} onChanged={() => void load()} /> : null}
              {tab === 'about' ? <AboutTab c={c} me={me} edit={nav.editCircle} onLeft={nav.back} onChanged={() => void load()} /> : null}
            </>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

/* ------------------------------------------------------------------ edges: unavailable, removed, private */

/** p60: wrong link, deleted, or hidden. */
function Unavailable({ onBack, discover }: { onBack: () => void; discover: () => void }) {
  const t = useTheme();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.surface, padding: 16 }} testID="circle-unavailable">
      <LineArt name="explorer" height={240} />
      <View style={{ alignSelf: 'flex-start' }}><OvalButton icon="arrow-left" label="Back" size="sm" variant="secondary" onPress={onBack} /></View>
      <State icon="link" tone="plain" title="This circle isn’t available" actions={<OvalButton icon="compass" label="Discover circles" size="lg" onPress={discover} />}>The link may be wrong, or the circle was deleted or made hidden by its owners.</State>
    </SafeAreaView>
  );
}

/** p54. */
function Removed({ c, onBack }: { c: CircleView; onBack: () => void }) {
  const t = useTheme();
  const r = c.removed!;
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.surface, padding: 16, gap: 12 }} testID="removed">
      <LineArt name="explorer" height={240} style={{ left: -30, right: undefined }} />
      <View style={{ alignSelf: 'flex-start' }}><OvalButton icon="arrow-left" label="Circles" size="sm" variant="secondary" onPress={onBack} /></View>
      <State icon="logout" tone="plain" title="You were removed from this circle">
        An owner of {c.name} removed you on {dateShort(r.at)}{r.reason ? ` for breaking ${r.reason.replace(/^Rule/, 'rule')}` : ''}. You can’t see its posts, and you can ask to join again from {dateShort(r.until)}.
      </State>
      <Note icon="info" tone="plain">Think it’s a mistake? Contact YaysApp support. Your own past posts stay visible to members unless you delete them.</Note>
    </SafeAreaView>
  );
}

/** p45 / p46: a private circle seen from outside. */
function PrivateGate({ c, onChange }: { c: CircleView; onChange: (v: CircleView) => void }) {
  const t = useTheme();
  const [answer, setAnswer] = useState(c.request?.answer ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const act = async (fn: (a: Awaited<ReturnType<typeof api>>) => Promise<CircleView>) => { setBusy(true); setError(null); try { onChange(await fn(await api())); } catch (e) { setError(errText(e)); } finally { setBusy(false); } };
  return (
    <View style={{ gap: 12 }}>
      {error ? <ErrorBanner>{error}</ErrorBanner> : null}
      {c.access === 'requested' && c.request ? (
        <Card testID="request-sent">
          <Text style={{ fontFamily: font.display, fontWeight: '800', fontSize: 20, color: t.ink }}>Request sent</Text>
          <Step done title="You asked to join" sub={dateShort(c.request.at)} />
          <Step title="Owners review it" sub="You’ll see the circle here once they say yes" />
          <Note icon="info">If the owners don’t answer by {dateShort(c.request.expiresAt)}, the request ends and you can ask again.</Note>
          <View style={{ alignItems: 'center' }}><OvalButton icon="close" label="Cancel request" size="sm" variant="ghost" loading={busy} onPress={() => void act((a) => a.cancelCircleRequest(c.id))} /></View>
          <Text style={{ fontSize: 12, color: t['ink-soft'], lineHeight: 17 }}>If they say no, you’ll see “Request not accepted”. You can ask again after {CIRCLE_TIMES.rejoinDays} days.</Text>
        </Card>
      ) : c.access === 'declined' ? (
        <Card testID="request-declined"><State icon="lock" tone="plain" title="Request not accepted">The owners said no this time. You can ask again from {dateShort(c.declinedUntil!)}.</State></Card>
      ) : (
        <Card testID="private-gate">
          <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
            <Oval width={48} fill={t['ember-wash']}><Icon name="lock" size={22} color={t['ember-ink']} /></Oval>
            <View style={{ flex: 1 }}><Text style={{ fontWeight: '700', color: t.ink, fontSize: 16 }}>This circle is private</Text><Text style={{ fontSize: 13, color: t['ink-soft'] }}>Only members see posts, events and chats.</Text></View>
          </View>
          {c.joinQuestion ? <Field label={`The owners ask: ${c.joinQuestion}`} hint={`Owners usually answer within a few days. If they don’t answer in ${CIRCLE_TIMES.requestDays} days, you can ask again.`} value={answer} onChangeText={setAnswer} maxLength={CIRCLE_LIMITS.answer} multiline /> : null}
          <View style={{ alignItems: 'center' }}><OvalButton icon="person-add" label="Ask to join" size="lg" loading={busy} disabled={!!c.joinQuestion && !answer.trim()} onPress={() => void act((a) => a.joinCircle(c.id, answer.trim() || undefined))} /></View>
        </Card>
      )}
      <AboutCard c={c} />
    </View>
  );
}

function Step({ done, title, sub }: { done?: boolean; title: string; sub: string }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
      <Oval width={30} fill={done ? t.ember : t.sunken}><Icon name={done ? 'check' : 'clock'} size={14} color={done ? '#fff' : t['ink-soft']} /></Oval>
      <View style={{ flex: 1 }}><Text style={{ fontWeight: '700', color: t.ink }}>{title}</Text><Text style={{ fontSize: 12, color: t['ink-soft'] }}>{sub}</Text></View>
    </View>
  );
}

function AboutCard({ c }: { c: CircleView }) {
  const t = useTheme();
  return (
    <>
      <Card title="About">
        <Text style={{ fontSize: 14, lineHeight: 21, color: t.ink }}>{c.about || 'No description yet.'}</Text>
        <Text style={{ fontSize: 12, color: t['ink-soft'] }}>Owners: {c.owners.map((o) => o.displayName).join(' · ')}</Text>
      </Card>
      {c.rules.length ? <Card title="Circle rules">{c.rules.map((r, i) => <Text key={i} style={{ fontSize: 14, lineHeight: 20, color: t.ink }}>{i + 1}. {r}</Text>)}</Card> : null}
    </>
  );
}

/* ------------------------------------------------------------------ feed */

function FeedTab({ c, me, nav, onReload }: { c: CircleView; me: MeProfile; nav: OneCircleNav; onReload: () => void }) {
  const t = useTheme();
  const [items, setItems] = useState<CirclePost[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [upcoming, setUpcoming] = useState<CircleEvent[]>([]);
  useEffect(() => {
    void (async () => {
      try { const a = await api(); const f = await a.circleFeed(c.id); setItems(f.items); setNext(f.next); void a.circleEvents(c.id).then((x) => setUpcoming(x.filter((e) => e.status === 'scheduled').slice(0, 1)), () => undefined); }
      catch (e) { setError(errText(e, 'Couldn’t load the posts.')); }
    })();
  }, [c.id]);
  const member = isMember(c);
  const setPost = (p: CirclePost) => setItems((xs) => {
    if (!xs) return null;
    const out = xs.map((x) => (x.id === p.id ? p : x));
    const was = xs.find((x) => x.id === p.id);
    if (!was || was.pinned === p.pinned) return out;
    return [...out.filter((x) => x.pinned), ...out.filter((x) => !x.pinned).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))];
  });
  const empty = items && !items.length;
  return (
    <View style={{ gap: 10 }} testID="feed">
      {error ? <ErrorBanner>{error}</ErrorBanner> : null}
      {c.muted ? (
        <View testID="muted" style={{ flexDirection: 'row', gap: 10, padding: 14, borderRadius: 18, backgroundColor: t['warning-wash'] }}>
          <Icon name="volume-off" size={18} color={t['warning-ink']} />
          <Text style={{ flex: 1, fontSize: 13, lineHeight: 19, color: t.ink }}><Text style={{ fontWeight: '700' }}>You can’t post or comment until {dateShort(c.muted.until)}.</Text> {c.muted.reason ? `An owner muted you: ${c.muted.reason}. ` : 'An owner muted you. '}You can still read everything.</Text>
        </View>
      ) : null}
      {member && !c.muted ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Write a post" testID="composer" onPress={nav.compose} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 18, backgroundColor: t.raised }}>
          <Avatar name={me.displayName} photoUrl={me.photoUrl} size={32} />
          <Text style={{ flex: 1, color: t['ink-faint'], fontSize: 15 }}>Share an update or ask a question…</Text>
          <Icon name="image" size={18} color={t['ember-ink']} />
        </Pressable>
      ) : null}
      {upcoming[0] ? <Card pad={false}><EventRow e={upcoming[0]} onPress={() => nav.openEvent(upcoming[0]!.id)} /></Card> : null}
      {!items && !error ? <ActivityIndicator color={t.ember} /> : null}
      {empty ? (c.access === 'admin' ? <OwnerStart c={c} /> : <State icon="chat" tone="plain" title="No posts yet">{member ? 'Be the first to share something.' : 'Join to share something.'}</State>) : null}
      {items?.map((p) => <PostCard key={p.id} p={p} c={c} onChange={(x) => { setPost(x); if (x.status !== p.status) onReload(); }} onGone={() => setItems((xs) => xs?.filter((x) => x.id !== p.id) ?? null)} onOpen={() => nav.openPost(p.id)} />)}
      {next ? <View style={{ alignItems: 'center' }}><OvalButton icon="chevron-down" label="Older posts" size="sm" variant="soft" onPress={() => void api().then((a) => a.circleFeed(c.id, next)).then((f) => { setItems((xs) => [...(xs ?? []), ...f.items]); setNext(f.next); }, () => undefined)} /></View> : null}
    </View>
  );
}

/** p47: a brand-new circle. */
function OwnerStart({ c }: { c: CircleView }) {
  const steps: Array<[boolean, string]> = [[!!c.about, 'Add a description'], [c.memberCount > 1, 'Invite people'], [false, 'Write the first post'], [c.rules.length > 0, 'Set circle rules']];
  const done = steps.filter((s) => s[0]).length;
  return (
    <View style={{ gap: 10 }}>
      <State icon="sparkles" title="Your circle is ready">Nothing here yet. Invite people and write the first post so they have something to read.</State>
      <Card title={`Get started · ${done} of ${steps.length}`}>{steps.map(([ok, label]) => <Step key={label} done={ok} title={label} sub={ok ? 'Done' : 'To do'} />)}</Card>
    </View>
  );
}

/* ------------------------------------------------------------------ chats: the circle's groups */

function ChatsTab({ c, openChat }: { c: CircleView; openChat: (id: string) => void }) {
  const t = useTheme();
  const [groups, setGroups] = useState<CommunityGroup[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { void api().then((a) => a.community(c.id)).then((x) => setGroups(x.groups), (e) => setError(errText(e))); }, [c.id]);
  const join = async (g: CommunityGroup) => {
    setBusy(g.id); setError(null);
    try {
      const r = await (await api()).joinCommunityGroup(c.id, g.id);
      if (r.status === 'joined') openChat(r.conversation.id);
      setGroups((gs) => gs?.map((x) => (x.id === g.id ? { ...x, joined: r.status === 'joined', requested: r.status === 'requested' } : x)) ?? null);
    } catch (e) { setError(errText(e)); } finally { setBusy(null); }
  };
  return (
    <View style={{ gap: 10 }} testID="circle-chats">
      {error ? <ErrorBanner>{error}</ErrorBanner> : null}
      {!groups && !error ? <ActivityIndicator color={t.ember} /> : null}
      {groups && !groups.length ? <State icon="chats" tone="plain" title="No chats yet">The owners can add group chats to this circle on YaysApp Web.</State> : null}
      {groups?.length ? (
        <Card pad={false}>
          {groups.map((g) => (
            <Pressable key={g.id} accessibilityRole="button" accessibilityLabel={g.joined ? `Open ${g.name}` : g.name} testID="circle-group" disabled={!g.joined} onPress={() => openChat(g.id)}
              style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 12, backgroundColor: pressed ? t.sunken : 'transparent' })}>
              <Avatar name={g.name} photoUrl={g.photoUrl} size={44} />
              <View style={{ flex: 1 }}>
                <Text style={{ fontWeight: '700', color: t.ink, fontSize: 15 }} numberOfLines={1}>{g.announcements ? 'Announcements' : g.name}</Text>
                <Text style={{ fontSize: 12, color: t['ink-soft'] }}>{plural(g.memberCount, 'member')}{g.announcements ? ' · only owners post' : g.needsApproval && !g.joined ? ' · admins approve' : ''}</Text>
              </View>
              {g.joined ? <Icon name="chevron-right" size={16} color={t['ink-faint']} />
                : g.requested ? <Tag kind="muted" icon="clock">Requested</Tag>
                : g.full ? <Tag kind="muted">Full</Tag>
                : <OvalButton icon="plus" label={g.needsApproval ? 'Ask' : 'Join'} size="sm" variant="soft" loading={busy === g.id} onPress={() => void join(g)} />}
            </Pressable>
          ))}
        </Card>
      ) : null}
    </View>
  );
}

/* ------------------------------------------------------------------ about, leaving */

function AboutTab({ c, me, edit, onLeft, onChanged }: { c: CircleView; me: MeProfile; edit: () => void; onLeft: () => void; onChanged: () => void }) {
  const t = useTheme();
  const admin = c.access === 'admin';
  const [error, setError] = useState<string | null>(null);
  const [handover, setHandover] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const leave = async () => {
    setConfirm(false);
    // The only owner picks someone first (p59).
    if (c.isOwner && c.memberCount > 1 && c.owners.filter((o) => o.role !== 'owner').length === 0) { setHandover(true); return; }
    try { await (await api()).leaveCircle(c.id); onLeft(); } catch (e) { setError(errText(e)); }
  };
  return (
    <View style={{ gap: 10 }} testID="circle-about">
      {error ? <ErrorBanner>{error}</ErrorBanner> : null}
      <Card title="About" right={admin ? <OvalButton icon="edit" label="Edit" size="sm" variant="soft" onPress={edit} /> : undefined}>
        <Text style={{ fontSize: 14, lineHeight: 21, color: t.ink }}>{c.about || 'No description yet.'}</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}><CircleTags c={c} /><Tag kind="muted">{CIRCLE_CATEGORY_LABEL[c.category]}</Tag></View>
        {admin ? <Text style={{ fontSize: 12, lineHeight: 17, color: t['ink-soft'] }}>{c.listed ? 'Shown in Discover.' : 'Hidden from Discover.'} {c.postApproval ? 'Owners approve posts before they appear.' : 'Members’ posts appear straight away.'}{c.joinQuestion ? ` People asking to join answer: “${c.joinQuestion}”` : ''}</Text> : null}
      </Card>
      {c.rules.length ? <Card title="Circle rules">{c.rules.map((r, i) => <Text key={i} style={{ fontSize: 14, lineHeight: 20, color: t.ink }}>{i + 1}. {r}</Text>)}</Card> : null}
      <Card title="Owners" pad={false}>
        {c.owners.map((o) => (
          <View key={o.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 10 }}>
            <Avatar name={o.displayName} photoUrl={o.photoUrl} size={40} />
            <View style={{ flex: 1 }}><Text style={{ fontWeight: '700', color: t.ink }}>{o.displayName}{o.id === me.id ? ' (you)' : ''}</Text><Text style={{ fontSize: 12, color: t['ink-soft'] }}>{o.role === 'owner' ? 'Owner' : 'Admin'}</Text></View>
          </View>
        ))}
      </Card>
      <Note icon="shield-check" tone="plain">Your phone number and email are never shown to members. Report posts that ask for money or promise profits.</Note>
      {isMember(c) ? <View style={{ alignItems: 'center' }}><OvalButton icon="logout" label="Leave circle" variant="ghost" onPress={() => setConfirm(true)} /></View> : null}
      {confirm ? (
        <Sheet title={`Leave ${c.name}?`} lead="You’ll stop seeing its posts and events. Its chats you’re in stay in your chat list." onClose={() => setConfirm(false)}>
          <View style={{ alignItems: 'center' }}><OvalButton icon="logout" label="Leave circle" variant="danger" onPress={() => void leave()} /></View>
        </Sheet>
      ) : null}
      {handover ? <HandoverSheet c={c} me={me} onClose={() => setHandover(false)} onLeft={() => { setHandover(false); onChanged(); onLeft(); }} /> : null}
    </View>
  );
}

/** p59: the only owner hands over before leaving, or deletes the circle. */
function HandoverSheet({ c, me, onClose, onLeft }: { c: CircleView; me: MeProfile; onClose: () => void; onLeft: () => void }) {
  const t = useTheme();
  const [people, setPeople] = useState<CircleMemberRow[] | null>(null);
  const [pick, setPick] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sure, setSure] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { void api().then((a) => a.circleMembers(c.id)).then((m) => { const others = m.filter((x) => x.id !== me.id); setPeople(others); setPick(others[0]?.id ?? null); }, (e) => setError(errText(e))); }, [c.id, me.id]);
  const run = async (fn: (a: Awaited<ReturnType<typeof api>>) => Promise<unknown>) => { setBusy(true); setError(null); try { await fn(await api()); onLeft(); } catch (e) { setError(errText(e)); setBusy(false); } };
  return (
    <Sheet title="Pick a new owner first" lead="A circle always needs an owner. Choose who takes over, then you’ll leave." onClose={onClose} testID="handover">
      {error ? <ErrorBanner>{error}</ErrorBanner> : null}
      {!people ? <ActivityIndicator color={t.ember} /> : people.slice(0, 20).map((p) => (
        <Pressable key={p.id} accessibilityRole="radio" accessibilityState={{ checked: pick === p.id }} accessibilityLabel={p.displayName} onPress={() => setPick(p.id)}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 8, borderRadius: 14, backgroundColor: pick === p.id ? t['ember-wash'] : 'transparent' }}>
          <Avatar name={p.displayName} photoUrl={p.photoUrl} size={40} />
          <View style={{ flex: 1 }}><Text style={{ fontWeight: '700', color: t.ink }}>{p.displayName}</Text><Text style={{ fontSize: 12, color: t['ink-soft'] }}>{p.role === 'admin' ? 'Admin' : 'Member'} · joined {dateShort(p.joinedAt)}</Text></View>
          <Oval width={22} fill={pick === p.id ? t.ember : t.sunken}>{pick === p.id ? <Icon name="check" size={13} color="#fff" /> : null}</Oval>
        </Pressable>
      ))}
      {sure ? <Note icon="alert-triangle" tone="danger">Delete {c.name} for everyone? Posts and events go; its chats stay as ordinary groups.</Note> : null}
      <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 28 }}>
        <OvalButton icon="trash" label={sure ? 'Yes, delete it' : 'Delete circle'} variant={sure ? 'danger' : 'ghost'} onPress={() => (sure ? void run((a) => a.deleteCircle(c.id)) : setSure(true))} />
        <OvalButton icon="logout" label="Make owner and leave" variant="danger" loading={busy} disabled={!pick} onPress={() => void run(async (a) => { await a.setCircleOwner(c.id, pick!); await a.leaveCircle(c.id); })} />
      </View>
    </Sheet>
  );
}

/* ------------------------------------------------------------------ owners: members and review */

function MembersTab({ c, me }: { c: CircleView; me: MeProfile }) {
  const t = useTheme();
  const [rows, setRows] = useState<CircleMemberRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [act, setAct] = useState<{ kind: 'mute' | 'remove'; p: CircleMemberRow } | null>(null);
  const load = useCallback(() => api().then((a) => a.circleMembers(c.id)).then(setRows, (e) => setError(errText(e))), [c.id]);
  useEffect(() => { void load(); }, [load]);
  return (
    <View style={{ gap: 10 }}>
      {error ? <ErrorBanner>{error}</ErrorBanner> : null}
      <Card title={plural(c.memberCount, 'member')} pad={false}>
        {!rows ? <ActivityIndicator color={t.ember} style={{ margin: 16 }} /> : rows.map((p) => (
          <View key={p.id} testID="member-row" style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 10 }}>
            <Avatar name={p.displayName} photoUrl={p.photoUrl} size={40} />
            <View style={{ flex: 1 }}>
              <Text style={{ fontWeight: '700', color: t.ink }} numberOfLines={1}>{p.displayName}{p.id === me.id ? ' (you)' : ''}</Text>
              <Text style={{ fontSize: 12, color: t['ink-soft'] }}>{p.role === 'owner' ? 'Owner' : p.role === 'admin' ? 'Admin' : `Joined ${dateShort(p.joinedAt)}`}{p.mutedUntil ? ` · Muted until ${dateShort(p.mutedUntil)}` : ''}</Text>
            </View>
            {p.role === 'member' ? (
              <View style={{ flexDirection: 'row', gap: 12 }}>
                {p.mutedUntil ? <OvalButton icon="bell" label="Unmute" size="sm" variant="soft" onPress={() => void api().then((a) => a.unmuteCircleMember(c.id, p.id)).then(load)} />
                  : <OvalButton icon="volume-off" label="Mute" size="sm" variant="soft" onPress={() => setAct({ kind: 'mute', p })} />}
                <OvalButton icon="logout" label="Remove" size="sm" variant="ghost" onPress={() => setAct({ kind: 'remove', p })} />
              </View>
            ) : null}
          </View>
        ))}
      </Card>
      {act ? <ModerateSheet c={c} kind={act.kind} p={act.p} onClose={() => setAct(null)} onDone={() => { setAct(null); void load(); }} /> : null}
    </View>
  );
}

function ModerateSheet({ c, kind, p, onClose, onDone }: { c: CircleView; kind: 'mute' | 'remove'; p: CircleMemberRow; onClose: () => void; onDone: () => void }) {
  const [days, setDays] = useState(7);
  const [reason, setReason] = useState(c.rules[0] ? `Rule 1: ${c.rules[0]}` : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const go = async () => { setBusy(true); setError(null); try { const a = await api(); if (kind === 'mute') await a.muteCircleMember(c.id, p.id, days, reason); else await a.removeCircleMember(c.id, p.id, reason); onDone(); } catch (e) { setError(errText(e)); setBusy(false); } };
  return (
    <Sheet title={kind === 'mute' ? `Mute ${p.displayName}` : `Remove ${p.displayName}`} onClose={onClose}
      lead={kind === 'mute' ? 'They can still read, but can’t post or comment until then.' : `They can’t see the circle or ask to join again for ${CIRCLE_TIMES.rejoinDays} days. They’re told the reason.`}>
      {error ? <ErrorBanner>{error}</ErrorBanner> : null}
      {kind === 'mute' ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }} accessibilityRole="radiogroup" accessibilityLabel="For">{[1, 3, 7, 14, 30].map((d) => <Chip key={d} label={plural(d, 'day')} on={days === d} onPress={() => setDays(d)} />)}</View> : null}
      <Field label="Reason they see" value={reason} onChangeText={setReason} maxLength={300} placeholder="Repeated off-topic posts" />
      <View style={{ alignItems: 'center' }}><OvalButton icon={kind === 'mute' ? 'volume-off' : 'logout'} label={kind === 'mute' ? 'Mute' : 'Remove'} variant="danger" loading={busy} onPress={() => void go()} /></View>
    </Sheet>
  );
}

function ReviewTab({ c, onChanged }: { c: CircleView; onChanged: () => void }) {
  const t = useTheme();
  const [r, setR] = useState<CircleReview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => api().then((a) => a.circleReview(c.id)).then(setR, (e) => setError(errText(e))), [c.id]);
  useEffect(() => { void load(); }, [load]);
  const run = async (fn: (a: Awaited<ReturnType<typeof api>>) => Promise<unknown>) => { setError(null); try { await fn(await api()); await load(); onChanged(); } catch (e) { setError(errText(e)); } };
  const reason = c.rules[1] ? `Rule 2: ${c.rules[1]}` : '';
  if (!r) return error ? <ErrorBanner>{error}</ErrorBanner> : <ActivityIndicator color={t.ember} />;
  return (
    <View style={{ gap: 10 }} testID="review">
      {error ? <ErrorBanner>{error}</ErrorBanner> : null}
      {!r.pending.length && !r.reports.length ? <State icon="check" tone="success" title="Nothing to review">Posts waiting for approval and reported posts show up here.</State> : null}
      {r.pending.length ? <Text style={{ fontFamily: font.display, fontWeight: '700', fontSize: 14, color: t.ink }}>Waiting for approval · {r.pending.length}</Text> : null}
      {r.pending.map((p) => (
        <View key={p.id} style={{ gap: 8 }}>
          <PostCard p={p} c={c} onChange={() => void load()} onGone={() => void load()} />
          <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 24 }}>
            <OvalButton icon="close" label="Remove" size="sm" variant="ghost" onPress={() => void run((a) => a.removeCirclePost(p.id, reason))} />
            <OvalButton icon="check" label="Approve" size="sm" onPress={() => void run((a) => a.approveCirclePost(p.id))} />
          </View>
        </View>
      ))}
      {r.reports.length ? <Text style={{ fontFamily: font.display, fontWeight: '700', fontSize: 14, color: t.ink }}>Reported · {r.reports.length}</Text> : null}
      {r.reports.map((x) => (
        <View key={x.id} style={{ gap: 8 }}>
          <Note icon="flag" tone="danger">{plural(x.reports, 'report')} · mostly “{x.reason === 'scam' ? 'misleading promotion' : x.reason}”</Note>
          <PostCard p={x.post} c={c} onChange={() => void load()} onGone={() => void load()} />
          <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 24 }}>
            <OvalButton icon="check" label="Keep" size="sm" variant="soft" onPress={() => void run((a) => a.settleCircleReport(c.id, x.id, 'keep'))} />
            <OvalButton icon="close" label="Remove post" size="sm" variant="danger" onPress={() => void run((a) => a.settleCircleReport(c.id, x.id, 'remove', reason))} />
          </View>
        </View>
      ))}
    </View>
  );
}

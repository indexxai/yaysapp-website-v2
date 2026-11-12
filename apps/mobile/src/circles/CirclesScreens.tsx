import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, RefreshControl, ScrollView, Switch, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { CIRCLE_CATEGORIES, CIRCLE_CATEGORY_LABEL, CIRCLE_LIMITS, type CircleCard, type CircleCategory, type CircleDiscover, type CircleView, type MyCircles } from '@yays/shared';
import { api } from '../lib/api';
import { font, useTheme } from '../lib/theme';
import { Icon } from '../ui/Icon';
import { Banner as ErrorBanner, Field, OvalButton } from '../ui/kit';
import { LineArt } from '../ui/LineArt';
import { Oval } from '../ui/Oval';
import { Text, TextInput } from '../ui/Text';
import { Card, Chip, CircleMark, CircleTags, DateBlock, EventMiniRow, Header, Note, State, errText, plural } from './common';

export interface CircleNav {
  openCircle: (id: string) => void;
  openDiscover: () => void;
  openNew: () => void;
  openEvent: (id: string) => void;
}

/* ------------------------------------------------------------------ the tab (p35, p43) */

export function CirclesTab({ nav }: { nav: CircleNav }) {
  const t = useTheme();
  const [mine, setMine] = useState<MyCircles | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const load = useCallback(() => api().then((a) => a.myCircles()).then((m) => { setMine(m); setError(null); }, (e) => setError(errText(e, 'Couldn’t load your circles.'))), []);
  // Back from a circle (joined, left, read new posts): the list is fresh.
  useFocusEffect(useCallback(() => { void load(); }, [load]));
  const empty = mine && !mine.circles.length;
  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: t.surface }} testID="circles-screen">
      <LineArt name="explorer" height={260} />
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 8, paddingBottom: 8 }}>
        <Text accessibilityRole="header" style={{ fontFamily: font.display, fontWeight: '800', fontSize: 30, lineHeight: 36, color: t.ink }}>Circles</Text>
        <View style={{ flexDirection: 'row', gap: 18 }}>
          {!empty ? <OvalButton icon="compass" label="Discover" size="sm" variant="soft" onPress={nav.openDiscover} /> : null}
          <OvalButton icon="plus" label="New" size="sm" onPress={nav.openNew} />
        </View>
      </View>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 24, gap: 12 }} refreshControl={<RefreshControl refreshing={refreshing} tintColor={t.ember} onRefresh={() => { setRefreshing(true); void load().finally(() => setRefreshing(false)); }} />}>
        {error ? <ErrorBanner>{error}</ErrorBanner> : null}
        {!mine && !error ? <ActivityIndicator color={t.ember} style={{ marginTop: 30 }} /> : null}
        {empty ? <NoCircles nav={nav} /> : null}
        {mine && mine.upcoming.length ? <Card title="Coming up" pad={false}>{mine.upcoming.slice(0, 2).map((e) => <EventMiniRow key={e.id} e={e} onPress={() => nav.openEvent(e.id)} />)}</Card> : null}
        {mine && mine.circles.length ? (
          <Card title="Your circles" pad={false}>
            {mine.circles.map((c) => <CircleRow key={c.id} c={c} onPress={() => nav.openCircle(c.id)} />)}
          </Card>
        ) : null}
        {mine && mine.circles.length ? <Text style={{ marginHorizontal: 8, fontSize: 12, lineHeight: 17, color: t['ink-soft'] }}>Communities are now Circles: your groups, a feed of posts and events, all in one place.</Text> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function CircleRow({ c, onPress }: { c: CircleCard; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${c.name}${c.newPosts ? `, ${c.newPosts} new posts` : ''}`} testID="circle-row" onPress={onPress}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 68, paddingHorizontal: 14, paddingVertical: 10, backgroundColor: pressed ? t.sunken : 'transparent' })}>
      <CircleMark c={c} size={48} />
      <View style={{ flex: 1, gap: 3 }}>
        <Text style={{ fontSize: 15, fontWeight: '700', color: t.ink }} numberOfLines={1}>{c.name}</Text>
        <CircleTags c={c} extra={c.newPosts ? `${c.newPosts} new post${c.newPosts === 1 ? '' : 's'}` : undefined} />
      </View>
      {c.newPosts > 0 ? <Oval width={26} fill={t.ember}><Text style={{ color: t['on-ember'], fontSize: 12, fontWeight: '800' }}>{c.newPosts > 99 ? '99+' : c.newPosts}</Text></Oval> : null}
    </Pressable>
  );
}

/** Join or ask to join from a list. Private circles open first, to answer the owners' question. */
function JoinButton({ c, onJoined, open, variant }: { c: CircleCard; onJoined: (c: CircleCard) => void; open: () => void; variant?: 'secondary' }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (c.role) return <OvalButton icon="chevron-right" label="Open" size="sm" variant="soft" onPress={open} />;
  if (c.requested) return <OvalButton icon="clock" label="Requested" size="sm" variant="ghost" onPress={open} />;
  if (c.visibility === 'private') return <OvalButton icon="person-add" label="Request" size="sm" variant="soft" onPress={open} />;
  return (
    <OvalButton icon="plus" label={error ? 'Try again' : 'Join'} size="sm" variant={variant ?? 'primary'} loading={busy} testID={`join-${c.id}`} onPress={() => void (async () => {
      setBusy(true); setError(null);
      try { await (await api()).joinCircle(c.id); onJoined({ ...c, role: 'member', memberCount: c.memberCount + 1 }); open(); } catch (e) { setError(errText(e)); } finally { setBusy(false); }
    })()} />
  );
}

function SuggestRow({ c, onJoined, open }: { c: CircleCard; onJoined: (c: CircleCard) => void; open: () => void }) {
  const t = useTheme();
  return (
    <View testID="circle-tile" style={{ gap: 8, paddingHorizontal: 14, paddingVertical: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Pressable accessibilityRole="button" accessibilityLabel={`Open ${c.name}`} onPress={open} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <CircleMark c={c} size={48} />
          <View style={{ flex: 1, gap: 3 }}>
            <Text style={{ fontSize: 15, fontWeight: '700', color: t.ink }} numberOfLines={2}>{c.name}</Text>
            <CircleTags c={c} extra={c.visibility === 'private' && !c.role ? 'approval needed' : undefined} />
          </View>
        </Pressable>
        <JoinButton c={c} onJoined={onJoined} open={open} />
      </View>
      {c.about ? <Text style={{ fontSize: 13, lineHeight: 18, color: t['ink-soft'] }} numberOfLines={2}>{c.about}</Text> : null}
      {c.lookalike ? <Note icon="alert-triangle" tone="danger" testID="lookalike">This circle isn’t run by the team it names. Only circles YaysApp has checked get the Official badge, and staff never ask you to send money.</Note> : null}
    </View>
  );
}

/** p43: no circles yet. */
function NoCircles({ nav }: { nav: CircleNav }) {
  const [d, setD] = useState<CircleDiscover | null>(null);
  useEffect(() => { void api().then((a) => a.discoverCircles()).then(setD, () => undefined); }, []);
  const picks = d ? [...(d.featured ? [d.featured] : []), ...d.items.filter((x) => x.id !== d.featured?.id)].slice(0, 3) : [];
  return (
    <View style={{ gap: 12 }} testID="no-circles">
      <State icon="people" title="You’re not in any circles yet" actions={<><OvalButton icon="compass" label="Discover" size="lg" onPress={nav.openDiscover} /><OvalButton icon="plus" label="Start a circle" size="lg" variant="soft" onPress={nav.openNew} /></>}>
        Circles are groups with a feed, events and chats. Join one you like, or start your own for friends, a club or your team.
      </State>
      {picks.length ? <Card title="Suggested for you" pad={false}>{picks.map((c) => <SuggestRow key={c.id} c={c} onJoined={() => undefined} open={() => nav.openCircle(c.id)} />)}</Card> : null}
    </View>
  );
}

/* ------------------------------------------------------------------ Discover (p36, p44, p61) */

export function DiscoverScreen({ nav, onBack }: { nav: CircleNav; onBack: () => void }) {
  const t = useTheme();
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<CircleCategory | ''>('');
  const [d, setD] = useState<CircleDiscover | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback((query: string, category: string) => api().then((a) => a.discoverCircles(query.trim(), category)).then((x) => { setD(x); setError(null); }, (e) => setError(errText(e))), []);
  useEffect(() => { const id = setTimeout(() => void run(q, cat), q ? 300 : 0); return () => clearTimeout(id); }, [q, cat, run]);
  const set = (c: CircleCard) => setD((x) => x && { ...x, items: x.items.map((y) => (y.id === c.id ? c : y)), featured: x.featured?.id === c.id ? c : x.featured });
  const empty = d && !d.items.length && !d.featured;
  const f = d?.featured;
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.surface }} testID="discover-screen">
      <LineArt name="morning" height={220} style={{ right: -40, bottom: 30 }} />
      <Header back="Circles" onBack={onBack} title="Discover" />
      <ScrollView contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 24, gap: 12 }} keyboardShouldPersistTaps="handled">
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 48, paddingHorizontal: 14, borderRadius: 999, backgroundColor: t.raised }}>
          <Icon name="search" size={18} color={t['ink-soft']} />
          <TextInput accessibilityLabel="Search circles" placeholder="Search circles and events" placeholderTextColor={t['ink-faint']} value={q} onChangeText={setQ} autoCorrect={false} returnKeyType="search" style={{ flex: 1, fontSize: 15, color: t.ink, paddingVertical: 10 }} />
          {q ? <Pressable accessibilityRole="button" accessibilityLabel="Clear search" onPress={() => setQ('')} hitSlop={8}><Icon name="close" size={16} color={t['ink-soft']} /></Pressable> : null}
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }} accessibilityRole="radiogroup" accessibilityLabel="Category">
          {(['', ...CIRCLE_CATEGORIES] as const).filter((x) => x !== 'other').map((x) => <Chip key={x || 'all'} label={x ? CIRCLE_CATEGORY_LABEL[x] : 'All'} on={cat === x} onPress={() => setCat(x)} />)}
        </ScrollView>
        {error ? <ErrorBanner>{error}</ErrorBanner> : null}
        {!d && !error ? <ActivityIndicator color={t.ember} /> : null}
        {d?.featuredEvent ? (
          <Pressable accessibilityRole="button" accessibilityLabel={`Featured event: ${d.featuredEvent.title}`} onPress={() => nav.openEvent(d.featuredEvent!.id)} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 22, backgroundColor: t.raised }}>
            <DateBlock iso={d.featuredEvent.startsAt} tz={d.featuredEvent.timeZone} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={{ fontFamily: font.display, fontWeight: '700', fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: t['ember-ink'] }}>Featured event</Text>
              <Text style={{ fontWeight: '700', color: t.ink }} numberOfLines={1}>{d.featuredEvent.title}</Text>
              <Text style={{ fontSize: 12, color: t['ink-soft'] }} numberOfLines={1}>{d.featuredEvent.mode === 'online' ? 'Online' : d.featuredEvent.place} · {d.featuredEvent.going} going · {d.featuredEvent.circle.name}</Text>
            </View>
            <Icon name="chevron-right" size={18} color={t['ink-faint']} />
          </Pressable>
        ) : null}
        {f ? (
          <View testID="featured" style={{ borderRadius: 22, padding: 16, gap: 12, backgroundColor: t.ember, overflow: 'hidden' }}>
            <View style={{ position: 'absolute', width: 220, height: 200, borderRadius: 200, top: -100, right: -60, backgroundColor: t['ember-light'], opacity: 0.5 }} />
            <Text style={{ fontFamily: font.display, fontWeight: '700', fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: '#fff' }}>Featured</Text>
            <Pressable accessibilityRole="button" accessibilityLabel={`Open ${f.name}`} onPress={() => nav.openCircle(f.id)} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <CircleMark c={f} size={56} onBanner />
              <View style={{ flex: 1 }}><Text style={{ fontFamily: font.display, fontWeight: '800', fontSize: 18, color: '#fff' }}>{f.name}</Text>{f.about ? <Text style={{ fontSize: 13, color: '#fff' }} numberOfLines={2}>{f.about}</Text> : null}</View>
            </Pressable>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={{ fontSize: 13, color: '#fff' }}>{plural(f.memberCount, 'member')}</Text>
              <JoinButton c={f} onJoined={set} open={() => nav.openCircle(f.id)} variant="secondary" />
            </View>
          </View>
        ) : null}
        {empty ? (
          <View testID="no-results" style={{ gap: 12 }}>
            <State icon="search" tone="plain" title="No circles found">{q ? `Nothing matches “${q}”. Check the spelling, or try fewer words.` : 'No circles here yet.'}</State>
            {d?.didYouMean ? <View style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8 }}><Text style={{ color: t['ink-soft'] }}>Did you mean</Text><Chip label={d.didYouMean} on={false} onPress={() => setQ(d.didYouMean!)} /></View> : null}
            <Card style={{ flexDirection: 'row', alignItems: 'center' }}>
              <View style={{ flex: 1 }}><Text style={{ fontWeight: '700', color: t.ink }}>Can’t find it?</Text><Text style={{ fontSize: 13, color: t['ink-soft'] }}>Start the circle yourself and invite people.</Text></View>
              <OvalButton icon="plus" label="Start" size="sm" onPress={nav.openNew} />
            </Card>
          </View>
        ) : null}
        {d?.items.length ? <Card pad={false}>{d.items.map((c) => <SuggestRow key={c.id} c={c} onJoined={set} open={() => nav.openCircle(c.id)} />)}</Card> : null}
        {d && d.items.some((c) => c.official || c.lookalike) ? <Text style={{ fontSize: 12, lineHeight: 17, color: t['ink-soft'], marginHorizontal: 8 }}>Only circles YaysApp has checked get the orange Official badge. Staff never ask you to send money.</Text> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

/* ------------------------------------------------------------------ start a circle / its settings */

/** New circle (you'll be the owner), or an owner's settings for one. */
export function CircleFormScreen({ id, onBack, onSaved }: { id?: string; onBack: () => void; onSaved: (c: CircleView) => void }) {
  const t = useTheme();
  const [loaded, setLoaded] = useState(!id);
  const [name, setName] = useState('');
  const [about, setAbout] = useState('');
  const [visibility, setVisibility] = useState<'public' | 'private'>('public');
  const [category, setCategory] = useState<CircleCategory>('other');
  const [question, setQuestion] = useState('');
  const [rules, setRules] = useState('Be kind and on topic\nNo selling or asking for money');
  const [listed, setListed] = useState(true);
  const [postApproval, setPostApproval] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!id) return;
    void api().then((a) => a.circle(id)).then((c) => {
      setName(c.name); setAbout(c.about); setVisibility(c.visibility); setCategory(c.category); setQuestion(c.joinQuestion ?? ''); setRules(c.rules.join('\n')); setListed(c.listed); setPostApproval(c.postApproval); setLoaded(true);
    }, (e) => { setError(errText(e)); setLoaded(true); });
  }, [id]);
  const save = async () => {
    setBusy(true); setError(null);
    const common = { name, about, visibility, category, joinQuestion: visibility === 'private' ? question.trim() || null : null, rules: rules.split('\n').map((r) => r.trim()).filter(Boolean) };
    try { const a = await api(); onSaved(id ? await a.updateCircle(id, { ...common, listed, postApproval }) : await a.createCircle(common)); }
    catch (e) { setError(errText(e)); setBusy(false); }
  };
  if (!loaded) return <SafeAreaView style={{ flex: 1, backgroundColor: t.surface, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color={t.ember} /></SafeAreaView>;
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.surface }} testID="circle-form">
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Header back="Cancel" onBack={onBack} title={id ? 'Circle settings' : 'Start a circle'} />
        <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }} keyboardShouldPersistTaps="handled">
          {!id ? <Text style={{ color: t['ink-soft'], fontSize: 14, lineHeight: 20 }}>A feed, events and chats for your group. You’ll be the owner.</Text> : null}
          {error ? <ErrorBanner>{error}</ErrorBanner> : null}
          <Field label="Name" value={name} onChangeText={setName} maxLength={100} placeholder="Lahore Runners" />
          <Field label="Description" value={about} onChangeText={setAbout} maxLength={2048} multiline placeholder="What is this circle for?" />
          <View style={{ gap: 6 }}>
            <Text style={{ fontFamily: font.display, fontSize: 14, fontWeight: '700', color: t.ink }}>Who can join</Text>
            <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }} accessibilityRole="radiogroup" accessibilityLabel="Who can join">
              <Chip icon="globe" label="Public: anyone can join" on={visibility === 'public'} onPress={() => setVisibility('public')} />
              <Chip icon="lock" label="Private: owners approve" on={visibility === 'private'} onPress={() => setVisibility('private')} />
            </View>
          </View>
          {visibility === 'private' ? <Field label="Question for people asking to join (optional)" value={question} onChangeText={setQuestion} maxLength={CIRCLE_LIMITS.question} placeholder="Why do you want to join?" /> : null}
          <View style={{ gap: 6 }}>
            <Text style={{ fontFamily: font.display, fontSize: 14, fontWeight: '700', color: t.ink }}>Category</Text>
            <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }} accessibilityRole="radiogroup" accessibilityLabel="Category">
              {CIRCLE_CATEGORIES.map((x) => <Chip key={x} label={CIRCLE_CATEGORY_LABEL[x]} on={category === x} onPress={() => setCategory(x)} />)}
            </View>
          </View>
          <Field label="Rules (one per line)" hint={`Up to ${CIRCLE_LIMITS.rules}. Owners can point to a rule when they remove a post.`} value={rules} onChangeText={setRules} multiline />
          {id ? (
            <>
              <Toggle label="Show in Discover" hint={listed ? 'Anyone can find it.' : visibility === 'private' ? 'Hidden: only people with an invite link can find it.' : 'Only people with the link can find it.'} on={listed} onChange={setListed} />
              <Toggle label="Owners approve posts" hint="Members’ posts wait for an owner before everyone sees them." on={postApproval} onChange={setPostApproval} />
            </>
          ) : null}
          <View style={{ alignItems: 'center' }}><OvalButton icon="check" label={id ? 'Save' : 'Create circle'} size="lg" loading={busy} disabled={!name.trim()} onPress={() => void save()} /></View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

export function Toggle({ label, hint, on, onChange }: { label: string; hint?: string; on: boolean; onChange: (v: boolean) => void }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <View style={{ flex: 1 }}><Text style={{ fontWeight: '700', color: t.ink }}>{label}</Text>{hint ? <Text style={{ fontSize: 13, color: t['ink-soft'] }}>{hint}</Text> : null}</View>
      <Switch accessibilityLabel={label} value={on} onValueChange={onChange} trackColor={{ true: t.ember, false: t.sunken }} thumbColor="#ffffff" />
    </View>
  );
}

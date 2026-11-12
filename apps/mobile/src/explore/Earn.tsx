import React, { useState } from 'react';
import { ActivityIndicator, Image, Linking, RefreshControl, ScrollView, Share, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Clipboard from '@react-native-clipboard/clipboard';
import { REFERRAL_POINTS, type MeProfile, type PointsEntry } from '@yays/shared';
import { api } from '../lib/api';
import { config } from '../lib/config';
import { font, useTheme } from '../lib/theme';
import { Avatar, Banner as ErrorBanner, OvalButton } from '../ui/kit';
import { LineArt } from '../ui/LineArt';
import { Text } from '../ui/Text';
import { Card, Chip, Header, State, Tag } from '../circles/common';
import { CheckinPopup } from './Popups';
import { BRAND, Bar, CheckinWeek, IconOval, Stat, TaskList, errText, fmtPoints, useLoad } from './common';
import type { IconName } from '../ui/Icon';

export const inviteLink = (code: string) => `${config.webUrl}/?ref=${encodeURIComponent(code)}`;

/** p06: INEX balance, the daily check-in, ways to earn today, bonuses and invites. */
export function EarnScreen({ me, onBack, nav }: { me: MeProfile; onBack: () => void; nav: { history: () => void; invite: () => void; wallet: () => void; ai: () => void; btcy: () => void; indexx: () => void } }) {
  const t = useTheme();
  const points = useLoad(() => api().then((a) => a.points()));
  const checkin = useLoad(() => api().then((a) => a.checkin()));
  const today = useLoad(() => api().then((a) => a.earnToday()));
  const bonuses = useLoad(() => api().then((a) => a.bonuses()));
  const refs = useLoad(() => api().then((a) => a.referrals()));
  const [popup, setPopup] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const all = () => Promise.all([points.reload(), checkin.reload(), today.reload(), bonuses.reload(), refs.reload()]);
  const p = points.data, c = checkin.data, d = today.data, r = refs.data;
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.surface }} testID="earn-screen">
      <LineArt name="coins" height={280} style={{ right: -40, bottom: -20 }} />
      <Header back="Explore" onBack={onBack} title="Earn" right={<OvalButton icon="clock" label="History" size="sm" variant="ghost" onPress={nav.history} />} />
      <ScrollView contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 30, gap: 12 }} refreshControl={<RefreshControl refreshing={refreshing} tintColor={t.ember} onRefresh={() => { setRefreshing(true); void all().finally(() => setRefreshing(false)); }} />}>
        {points.error || checkin.error ? <ErrorBanner>{points.error ?? checkin.error}</ErrorBanner> : null}
        <View style={{ borderRadius: 26, padding: 20, gap: 2, backgroundColor: t.ember, overflow: 'hidden' }}>
          <View style={{ position: 'absolute', width: 220, height: 200, borderRadius: 200, top: -100, right: -60, backgroundColor: t['ember-light'], opacity: 0.5 }} />
          <Image source={BRAND.coin} style={{ position: 'absolute', right: 16, top: 16, width: 84, height: 84 }} resizeMode="contain" />
          <Text style={{ fontFamily: font.display, fontWeight: '700', fontSize: 12, letterSpacing: 1.4, color: '#fff' }}>INEX</Text>
          <Text testID="points-balance" style={{ fontFamily: font.display, fontWeight: '800', fontSize: 40, lineHeight: 48, color: '#fff' }}>{p ? fmtPoints(p.balance) : '—'}</Text>
          <Text style={{ fontSize: 13, color: '#fff' }}>{p ? `+${fmtPoints(p.earnedThisWeek)} this week${p.pending ? ` · ${fmtPoints(p.pending)} pending` : ''}` : ' '}</Text>
          <View style={{ flexDirection: 'row', gap: 24, marginTop: 14 }}>
            <OvalButton icon="upload" label="Withdraw" size="sm" variant="secondary" onPress={nav.wallet} />
            <OvalButton icon="person-add" label="Invite" size="sm" variant="secondary" onPress={nav.invite} />
          </View>
        </View>

        <Card testID="earn-checkin">
          <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' }}>
            <Text accessibilityRole="header" style={{ fontFamily: font.display, fontWeight: '800', fontSize: 16, color: t.ink }}>Daily check-in</Text>
            {c ? <Text style={{ fontSize: 13, fontWeight: '700', color: t['ember-ink'] }}>{c.streak ? `${c.streak}-day streak` : 'No streak yet'}</Text> : null}
          </View>
          {c ? <CheckinWeek status={c} /> : <ActivityIndicator color={t.ember} />}
          {c ? <View style={{ alignItems: 'center' }}>{c.claimedToday ? <Text style={{ color: t['ink-soft'], fontSize: 13 }}>Claimed today. Tomorrow: +{c.tomorrowPoints}</Text> : <OvalButton icon="gift" label={`Claim +${c.todayPoints} today`} onPress={() => setPopup(true)} />}</View> : null}
        </Card>

        <Card title="Ways to earn today" pad={false}>
          {d ? <TaskList tasks={d.tasks} /> : <ActivityIndicator color={t.ember} style={{ margin: 16 }} />}
          {d ? <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingBottom: 14 }}><Text style={{ flex: 1, fontSize: 13, color: t['ink-soft'] }}>Daily cap</Text><Bar done={d.capUsed} of={d.cap} width={120} /><Text style={{ fontWeight: '800', color: t.ink, fontSize: 13 }}>{d.capUsed} / {d.cap}</Text></View> : null}
        </Card>

        {bonuses.data?.map((b) => (
          <Card key={b.id} pad={false} testID={`bonus-${b.id}`}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 }}>
              <Image source={b.product === 'jack' ? BRAND.jackBunny : BRAND.btcyCoin} style={{ width: 48, height: 48 }} resizeMode="contain" />
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: font.display, fontWeight: '700', fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: t['ember-ink'] }}>{b.eyebrow}</Text>
                <Text style={{ fontFamily: font.display, fontWeight: '800', fontSize: 17, color: t.ink }}>{b.complete ? `+${b.paid} earned` : `Up to +${b.points}`}</Text>
              </View>
              <OvalButton icon={b.product === 'jack' ? 'sparkles' : 'bitcoin'} label={b.product === 'jack' ? 'Ask Jack' : b.needsLink ? 'Link Indexx' : 'Open BTCY'} size="sm" variant="soft" onPress={b.product === 'jack' ? nav.ai : b.needsLink ? nav.indexx : nav.btcy} />
            </View>
            <TaskList tasks={b.tasks} />
          </Card>
        ))}

        <Card>
          <Text accessibilityRole="header" style={{ fontFamily: font.display, fontWeight: '800', fontSize: 16, color: t.ink }}>Invite friends</Text>
          <Text style={{ fontSize: 13, lineHeight: 19, color: t['ink-soft'] }}>Get {REFERRAL_POINTS} INEX when a friend joins with your code, verifies their number and sends a first message.</Text>
          <View style={{ flexDirection: 'row', gap: 8 }}><Stat value={String(r?.invited ?? '–')} label="Invited" /><Stat value={String(r?.joined ?? '–')} label="Joined" /><Stat value={String(r?.pending ?? '–')} label="Pending" /></View>
          <View style={{ alignItems: 'center' }}><OvalButton icon="people" label="Your invites" size="sm" variant="soft" onPress={nav.invite} /></View>
        </Card>
      </ScrollView>
      {popup && c ? <CheckinPopup first={me.displayName.split(/\s+/)[0] ?? ''} status={c} onClose={() => { setPopup(false); void all(); }} /> : null}
    </SafeAreaView>
  );
}

/* ------------------------------------------------------------------ history (p07) */

const FILTERS = [['all', 'All'], ['earned', 'Earned'], ['spent', 'Spent'], ['pending', 'Pending']] as const;
type Filter = (typeof FILTERS)[number][0];
const KIND_ICON: Record<PointsEntry['kind'], IconName> = { checkin: 'gift', activity: 'chats', referral: 'person-add', bonus: 'sparkles', convert: 'swap', ai_extra: 'sparkles', reversal: 'flag' };
const dayGroup = (iso: string) => {
  const d = new Date(iso), now = new Date(), y = new Date(now); y.setDate(now.getDate() - 1);
  return d.toDateString() === now.toDateString() ? 'Today' : d.toDateString() === y.toDateString() ? 'Yesterday' : d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'short' });
};

export function HistoryScreen({ onBack }: { onBack: () => void }) {
  const t = useTheme();
  const [filter, setFilter] = useState<Filter>('all');
  const page = useLoad(() => api().then((a) => a.pointsHistory(filter)), [filter]);
  const [more, setMore] = useState<PointsEntry[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const items = [...(page.data?.items ?? []), ...more];
  const cursor = more.length ? next : page.data?.next ?? null;
  const loadMore = async () => { if (!cursor) return; try { const x = await (await api()).pointsHistory(filter, cursor); setMore((m) => [...m, ...x.items]); setNext(x.next); } catch (e) { setError(errText(e)); } };
  const groups: Array<[string, PointsEntry[]]> = [];
  for (const i of items) { const g = dayGroup(i.at); const last = groups[groups.length - 1]; if (last && last[0] === g) last[1].push(i); else groups.push([g, [i]]); }
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.surface }} testID="history-screen">
      <LineArt name="trader" height={300} style={{ right: -40, bottom: 10 }} />
      <Header back="Earn" onBack={onBack} title="INEX history" />
      <ScrollView contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 30, gap: 10 }}>
        <View style={{ flexDirection: 'row', gap: 8 }} accessibilityRole="radiogroup" accessibilityLabel="Filter INEX history">
          {FILTERS.map(([f, label]) => <Chip key={f} label={label} on={filter === f} onPress={() => { setFilter(f); setMore([]); setNext(null); }} />)}
        </View>
        {page.error || error ? <ErrorBanner>{page.error ?? error}</ErrorBanner> : null}
        {!page.data && !page.error ? <ActivityIndicator color={t.ember} /> : null}
        {page.data && !items.length ? <State icon="star" tone="plain" title="Nothing here yet">Check in daily, chat and invite friends to earn INEX.</State> : null}
        {groups.map(([g, rows]) => (
          <Card key={g} title={g} pad={false}>
            {rows.map((i) => {
              const out = i.amount < 0, rev = i.kind === 'reversal', pending = i.status === 'pending';
              return (
                <View key={i.id} testID="ledger-row" style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, paddingHorizontal: 14, paddingVertical: 8 }}>
                  <IconOval icon={KIND_ICON[i.kind]} size={36} tone={out || rev ? 'muted' : pending ? 'muted' : 'wash'} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 14, fontWeight: '700', color: t.ink }}>{i.title}</Text>
                    <Text style={{ fontSize: 12, color: rev ? t['danger-ink'] : pending ? t['ember-ink'] : t['ink-soft'], fontWeight: pending ? '700' : '400' }}>{pending ? `Pending · ${i.sub}` : i.sub}</Text>
                  </View>
                  <Text style={{ fontFamily: font.display, fontWeight: '800', fontSize: 15, color: out ? t.ink : pending ? t['ink-soft'] : t['success-ink'], textDecorationLine: i.status === 'reversed' ? 'line-through' : 'none' }}>{i.amount > 0 ? '+' : '−'}{fmtPoints(Math.abs(i.amount))}</Text>
                </View>
              );
            })}
          </Card>
        ))}
        {cursor ? <View style={{ alignItems: 'center' }}><OvalButton icon="chevron-down" label="Show more" size="sm" variant="soft" onPress={() => void loadMore()} /></View> : null}
        <Text style={{ marginHorizontal: 8, fontSize: 12, lineHeight: 17, color: t['ink-soft'] }}>INEX from invites shows as pending until your friend verifies their number and sends a first message.</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

/* ------------------------------------------------------------------ invites (p08) */

const TONE = { pending: ['warn', 'Pending'], rewarded: ['ok', 'Rewarded'], not_eligible: ['muted', 'Not eligible'] } as const;

export function InviteScreen({ onBack }: { onBack: () => void }) {
  const t = useTheme();
  const r = useLoad(() => api().then((a) => a.referrals()));
  const [copied, setCopied] = useState(false);
  const d = r.data;
  const message = d ? `Join me on YaysApp with my code ${d.code}: ${inviteLink(d.code)}` : '';
  const copy = () => { if (!d) return; Clipboard.setString(d.code); setCopied(true); setTimeout(() => setCopied(false), 2000); };
  const share = () => void Share.share({ message }).catch(() => undefined);
  const whatsapp = () => void Linking.openURL(`whatsapp://send?text=${encodeURIComponent(message)}`).catch(share);
  const sms = () => void Linking.openURL(`sms:?&body=${encodeURIComponent(message)}`).catch(share);
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.surface }} testID="invite-screen">
      <LineArt name="hype" height={200} style={{ left: -40, right: undefined, bottom: 10 }} />
      <Header back="Earn" onBack={onBack} title="Invite friends" />
      <ScrollView contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 30, gap: 12 }}>
        {r.error ? <ErrorBanner>{r.error}</ErrorBanner> : null}
        <Card style={{ alignItems: 'center', padding: 18, gap: 12 }}>
          <Text accessibilityRole="header" style={{ fontFamily: font.display, fontWeight: '800', fontSize: 20, color: t.ink, textAlign: 'center' }}>Get {REFERRAL_POINTS} INEX for each friend</Text>
          <Text style={{ fontSize: 13, lineHeight: 19, color: t['ink-soft'], textAlign: 'center' }}>Your friend joins with your code, verifies their number and sends a first message. Your code also works across Indexx products.</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, alignSelf: 'stretch', paddingVertical: 8, paddingLeft: 16, paddingRight: 8, borderRadius: 999, borderWidth: 1.5, borderStyle: 'dashed', borderColor: t['ember-light'], backgroundColor: t['ember-wash'] }}>
            <View style={{ flex: 1 }}><Text style={{ fontSize: 11, fontWeight: '700', color: t['ember-ink'] }}>YOUR CODE</Text><Text testID="invite-code" style={{ fontFamily: font.display, fontWeight: '800', fontSize: 18, letterSpacing: 1.4, color: t.ink }}>{d?.code ?? '…'}</Text></View>
            <OvalButton icon={copied ? 'check' : 'copy'} label={copied ? 'Copied' : 'Copy'} size="sm" disabled={!d} onPress={copy} />
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 18 }}>
            <OvalButton icon="whatsapp" label="WhatsApp" variant="soft" disabled={!d} onPress={whatsapp} />
            <OvalButton icon="mail" label="SMS" variant="soft" disabled={!d} onPress={sms} />
            <OvalButton icon="share" label="More" variant="soft" disabled={!d} onPress={share} />
          </View>
        </Card>
        <View style={{ flexDirection: 'row', gap: 8 }}><Stat value={String(d?.invited ?? '–')} label="Invited" /><Stat value={String(d?.joined ?? '–')} label="Joined" /><Stat value={String(d?.pointsEarned ?? '–')} label="INEX earned" /></View>
        <Card title="Your invites" pad={false}>
          {d && !d.friends.length ? <Text style={{ padding: 16, paddingTop: 6, color: t['ink-soft'], fontSize: 14 }}>Nobody has used your code yet. Share your link to get started.</Text> : null}
          {d?.friends.map((f, i) => (
            <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 54, paddingHorizontal: 14, paddingVertical: 8 }}>
              <Avatar name={f.name} photoUrl={f.photoUrl} size={36} />
              <View style={{ flex: 1 }}><Text style={{ fontSize: 14, fontWeight: '700', color: t.ink }}>{f.name}</Text><Text style={{ fontSize: 12, color: t['ink-soft'] }}>{f.sub}</Text></View>
              <Tag kind={TONE[f.status][0]}>{TONE[f.status][1]}</Tag>
            </View>
          ))}
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}

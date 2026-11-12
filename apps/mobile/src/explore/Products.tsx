import React, { useState } from 'react';
import { ActivityIndicator, Image, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { INDEXX_LINKS, type IndexxBtcy, type IndexxEmmm, type IndexxShoperPal, type IndexxWallStreet, type MeProfile } from '@yays/shared';
import { api } from '../lib/api';
import { font, useTheme } from '../lib/theme';
import { Icon, type IconName } from '../ui/Icon';
import { Banner as ErrorBanner, OvalButton } from '../ui/kit';
import { LineArt } from '../ui/LineArt';
import { Text } from '../ui/Text';
import { Card, Chip, Header, Note, Tag } from '../circles/common';
import { BRAND, IconOval, IndexxSignIn, Logo, PRODUCTS, Stat, money, num, openSite, shortDate, timeLeft, useLoad } from './common';

/** "5h 12m" from seconds. */
const left = (s: number) => { const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return h ? `${h}h ${m}m` : `${m}m`; };

/** p13: mining, Nuggets mined in the last 7 days, team and boost, from the Indexx account. */
export function BtcyScreen({ me, onBack, invite }: { me: MeProfile; onBack: () => void; invite: () => void }) {
  const t = useTheme();
  const v = useLoad(() => api().then((a) => a.exploreProduct('btcy')));
  const ix = useLoad(() => api().then((a) => a.indexx()));
  const b = (v.data?.data ?? null) as IndexxBtcy | null;
  const site = v.data?.links.btcy ?? INDEXX_LINKS.btcy;
  const days = b?.last7Days.days ?? [];
  const max = Math.max(0.0001, ...days.map((d) => d.nuggets ?? 0));
  const stats: Array<{ label: string; value: string; sub: string; icon: IconName }> = b ? [
    { label: 'BTCY tokens', value: num(b.portfolio.tokens), sub: 'Read-only', icon: 'bitcoin' },
    { label: 'Mining streak', value: b.mining.streakDays == null ? '—' : `${b.mining.streakDays} day${b.mining.streakDays === 1 ? '' : 's'}`, sub: b.mining.bestStreakDays != null ? `Best ${b.mining.bestStreakDays} days` : 'Days in a row', icon: 'flash' },
    { label: 'Team', value: `${num(b.team.miningNow)} of ${num(b.team.members)}`, sub: 'mining now', icon: 'people' },
    { label: 'Boost', value: b.boost.percent == null ? '—' : `+${b.boost.percent}%`, sub: '+5% per teammate mining, up to +50%', icon: 'trending-up' },
  ] : [];
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.surface }} testID="btcy-screen">
      <LineArt name="trader" height={300} style={{ right: -40, bottom: 10 }} />
      <Header back="Explore" onBack={onBack} title="BTCY" right={<OvalButton icon="external" label="Open app" size="sm" variant="soft" onPress={() => openSite(site)} />} />
      <ScrollView contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 30, gap: 12 }} keyboardShouldPersistTaps="handled">
        {v.error ? <ErrorBanner>{v.error}</ErrorBanner> : null}
        {!v.data && !v.error ? <ActivityIndicator color={t.ember} /> : null}
        {v.data && !v.data.linked && ix.data ? <IndexxSignIn email={ix.data.email ?? me.email ?? null} ended={!!ix.data.email} sub="See your mining, Nuggets, team and boost here. BTCY bonus tasks count toward INEX." onDone={(s) => { ix.setData(s); void v.reload(); }} /> : null}
        {v.data?.linked && !b ? <ErrorBanner tone="warning">BTCY didn’t answer. Try again in a minute.</ErrorBanner> : null}
        {b ? (
          <>
            <View style={{ borderRadius: 26, padding: 20, gap: 6, backgroundColor: t.ember, overflow: 'hidden' }}>
              <View style={{ position: 'absolute', width: 220, height: 200, borderRadius: 200, top: -100, right: -60, backgroundColor: t['ember-light'], opacity: 0.5 }} />
              <Image source={BRAND.coin} style={{ position: 'absolute', right: 16, top: 16, width: 76, height: 76 }} resizeMode="contain" />
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.22)' }}>
                <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: b.mining.active ? '#7fff7a' : '#ffffff99' }} />
                <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>{b.mining.active ? (b.mining.endsInSeconds != null ? `Mining active · ${left(b.mining.endsInSeconds)} left` : 'Mining active') : 'Not mining'}</Text>
              </View>
              <Text testID="btcy-nuggets" style={{ fontFamily: font.display, fontWeight: '800', fontSize: 38, lineHeight: 46, color: '#fff' }}>{num(b.portfolio.nuggets, 2)}</Text>
              <Text style={{ color: '#fff', fontSize: 13 }}>BTCY Nuggets{b.mining.plan ? ` · ${b.mining.plan} plan` : ''}{b.mining.speed != null ? ` · ${b.mining.speed}× speed` : ''}</Text>
              <View style={{ marginTop: 10, alignSelf: 'flex-start' }}><OvalButton icon="flash" label={b.mining.active ? 'Open in BTCY' : 'Keep mining'} size="sm" variant="secondary" onPress={() => openSite(site)} /></View>
            </View>
            <Card>
              <Text accessibilityRole="header" style={{ fontFamily: font.display, fontWeight: '800', fontSize: 16, color: t.ink }}>Nuggets mined, last 7 days</Text>
              <Text style={{ fontSize: 12, color: t['ink-soft'] }}>Total {num(b.last7Days.total, 2)} · today’s bar fills in when the running session ends</Text>
              <View accessibilityLabel={`Nuggets mined each day, ${num(b.last7Days.total, 2)} in total`} style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', height: 140, paddingTop: 8 }}>
                {days.map((d, i) => (
                  <View key={d.date} style={{ alignItems: 'center', gap: 6, flex: 1 }}>
                    <View style={{ width: 22, height: Math.max(4, Math.round(((d.nuggets ?? 0) / max) * 110)), borderRadius: 8, backgroundColor: i === days.length - 1 ? t.ember : t['ember-light'] }} />
                    <Text style={{ fontSize: 11, color: t['ink-soft'] }}>{d.label}</Text>
                  </View>
                ))}
              </View>
            </Card>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {stats.map((s) => (
                <View key={s.label} style={{ width: '48.8%', padding: 14, borderRadius: 20, backgroundColor: t.raised, gap: 4 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}><Icon name={s.icon} size={14} color={t['ink-soft']} /><Text style={{ fontSize: 12, color: t['ink-soft'] }}>{s.label}</Text></View>
                  <Text style={{ fontFamily: font.display, fontWeight: '800', fontSize: 20, color: t.ink }}>{s.value}</Text>
                  <Text style={{ fontSize: 11, color: t['ink-soft'] }}>{s.sub}</Text>
                </View>
              ))}
            </View>
            <Card>
              <Text accessibilityRole="header" style={{ fontFamily: font.display, fontWeight: '800', fontSize: 16, color: t.ink }}>Your team</Text>
              <View style={{ flexDirection: 'row', gap: 8 }}><Stat value={num(b.team.members)} label="Friends on your team" /><Stat value={num(b.team.miningNow)} label="Mining now" /></View>
              {b.referrals ? <Text style={{ fontSize: 13, color: t['ink-soft'] }}>{num(b.referrals.active)} of {num(b.referrals.target)} active friends unlock the mining station{b.station?.unlocked ? ' (unlocked)' : ''}.</Text> : null}
              <View style={{ alignItems: 'center' }}><OvalButton icon="person-add" label="Invite friends" size="sm" variant="soft" onPress={invite} /></View>
            </Card>
            <Note icon="info" tone="plain">Balances come from BTCY and update every few minutes. To withdraw or trade, open the BTCY app.</Note>
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

/* ------------------------------------------------------------------ the other products (p14) */

const ABOUT: Record<Tab, string> = {
  emmm: 'Prediction markets on sports, crypto and world events.',
  shoperpal: 'Shop and sell, and earn BTCY on what you buy.',
  rehuman: 'Supplements and wellness from ReHuman.',
  wallstreet: 'Buy into companies, or list your own, on Wall Street Indexx.',
};
export type Tab = 'emmm' | 'shoperpal' | 'rehuman' | 'wallstreet';
const TABS = PRODUCTS.filter((p) => p.id in ABOUT) as Array<(typeof PRODUCTS)[number] & { id: Tab }>;

export function ProductsScreen({ me, tab: tab0, onBack }: { me: MeProfile; tab?: Tab; onBack: () => void }) {
  const t = useTheme();
  const [tab, setTab] = useState<Tab>(tab0 ?? 'emmm');
  const p = TABS.find((x) => x.id === tab)!;
  const loaded = useLoad(async () => (tab === 'rehuman' ? null : { tab, ...(await (await api()).exploreProduct(tab)) }), [tab]);
  const v = loaded.data?.tab === tab ? loaded.data : null;
  const ix = useLoad(() => api().then((a) => a.indexx()));
  const url = (v?.links ?? INDEXX_LINKS)[tab];
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.surface }} testID="products-screen">
      <LineArt name="explorer" height={300} />
      <Header back="Explore" onBack={onBack} title="Products" />
      <ScrollView contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 30, gap: 12 }} keyboardShouldPersistTaps="handled">
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }} accessibilityRole="radiogroup" accessibilityLabel="Products">
          {TABS.map((x) => <Chip key={x.id} label={x.name} on={x.id === tab} onPress={() => setTab(x.id)} />)}
        </ScrollView>
        <Card>
          <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
            <Logo src={BRAND[tab]} size={56} />
            <View style={{ flex: 1 }}><Text style={{ fontFamily: font.display, fontWeight: '800', fontSize: 18, color: t.ink }}>{p.name}</Text><Text style={{ fontSize: 13, color: t['ink-soft'] }}>{p.sub}</Text></View>
            <OvalButton icon="external" label="Open" size="sm" onPress={() => openSite(url)} />
          </View>
          <Text style={{ fontSize: 14, color: t['ink-soft'] }}>{ABOUT[tab]}</Text>
        </Card>
        {loaded.error ? <ErrorBanner>{loaded.error}</ErrorBanner> : null}
        {tab !== 'rehuman' && !v && !loaded.error ? <ActivityIndicator color={t.ember} /> : null}
        {tab !== 'rehuman' && v && !v.linked && ix.data ? <IndexxSignIn email={ix.data.email ?? me.email ?? null} ended={!!ix.data.email} onDone={(s) => { ix.setData(s); void loaded.reload(); }} /> : null}
        {tab !== 'rehuman' && v?.linked && !v.data ? <ErrorBanner tone="warning">{p.name} didn’t answer. Try again in a minute.</ErrorBanner> : null}
        {tab === 'emmm' && v?.data ? <Emmm e={v.data as IndexxEmmm} /> : null}
        {tab === 'shoperpal' && v?.linked && v.data ? <ShoperPal s={v.data as IndexxShoperPal} url={url} /> : null}
        {tab === 'wallstreet' && v?.data ? <WallStreet w={v.data as IndexxWallStreet} /> : null}
        <Text style={{ marginHorizontal: 8, fontSize: 12, lineHeight: 17, color: t['ink-soft'] }}>Shown for information. Trades and purchases happen in each product, not in YaysApp.</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function ListRow({ title, sub, right, left: l }: { title: string; sub: string; right?: React.ReactNode; left?: React.ReactNode }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 10 }}>
      {l}
      <View style={{ flex: 1, gap: 2 }}><Text style={{ fontSize: 14, fontWeight: '700', color: t.ink }}>{title}</Text><Text style={{ fontSize: 12, color: t['ink-soft'] }}>{sub}</Text></View>
      {right}
    </View>
  );
}
const Empty = ({ children }: { children: React.ReactNode }) => { const t = useTheme(); return <Text style={{ paddingHorizontal: 16, paddingBottom: 14, paddingTop: 4, fontSize: 14, color: t['ink-soft'] }}>{children}</Text>; };

function Emmm({ e }: { e: IndexxEmmm }) {
  return (
    <>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Stat testID="emmm-open" value={num(e.openPositions)} label="Open positions" />
        <Stat value={num(e.settledThisMonth?.count)} label={`Settled this month${e.settledThisMonth?.payoutUsd ? ` · ${money(e.settledThisMonth.payoutUsd)} paid` : ''}`} />
      </View>
      <Card title="Your markets" pad={false}>
        {!e.markets.length ? <Empty>No markets yet. Trades happen in EMMM.</Empty> : null}
        {e.markets.map((m) => (
          <ListRow key={m.marketSlug} title={m.title}
            sub={`${m.outcome ? `${m.outcome} · ` : ''}${num(m.shares)} shares · staked ${money(m.stakeUsd)}${m.status === 'open' ? ` · now ${money(m.currentValue)}` : m.status === 'won' ? ` · paid ${money(m.payoutUsd)}` : ''}${m.settledAt ? ` · ${shortDate(m.settledAt)}` : ''}`}
            right={<Tag kind={m.status === 'open' ? 'warn' : m.status === 'won' ? 'ok' : 'danger'}>{m.status === 'open' ? 'Open' : m.status === 'won' ? 'Won' : 'Lost'}</Tag>} />
        ))}
      </Card>
    </>
  );
}

const ORDER: Record<string, string> = { PENDING: 'Waiting for payment', PAYMENT_CONFIRMED: 'Paid', PROCESSING: 'Being prepared', SHIPPED: 'Shipped', DELIVERED: 'Delivered', CANCELLED: 'Cancelled', REFUNDED: 'Refunded' };
const orderWord = (s: string) => ORDER[s] ?? s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, ' ');

function ShoperPal({ s, url }: { s: IndexxShoperPal; url: string }) {
  const t = useTheme();
  if (s.role === 'seller' && s.supplier) {
    const x = s.supplier;
    return (
      <>
        <View style={{ flexDirection: 'row', gap: 8 }} testID="shoperpal-seller"><Stat value={`${num(x.productsListed)}${x.productsLimit != null ? ` / ${num(x.productsLimit)}` : ''}`} label="Products in your store" /><Stat value={num(x.ordersToday)} label="Orders today" /></View>
        <View style={{ flexDirection: 'row', gap: 8 }}><Stat value={num(x.pendingOrders)} label="Paid, not shipped yet" /><Stat value={money(x.earnings?.available)} label={`Available${x.earnings?.pendingAmount ? ` · ${money(x.earnings.pendingAmount)} pending` : ''}`} /></View>
        <Card>
          {([['Plan', x.plan ?? '—'], ['Commission', x.commission ?? '—'], ...(x.aiCredits ? [['AI credits', `${num(x.aiCredits.used)} of ${num(x.aiCredits.total)} used`]] : []), ...(x.earnings ? [['Earned in total', money(x.earnings.totalEarned)]] : [])] as Array<[string, string]>).map(([k, val]) => (
            <View key={k} style={{ flexDirection: 'row', justifyContent: 'space-between' }}><Text style={{ color: t['ink-soft'] }}>{k}</Text><Text style={{ fontWeight: '700', color: t.ink }}>{val}</Text></View>
          ))}
        </Card>
      </>
    );
  }
  const b = s.buyer;
  if (!b) {
    return (
      <Card style={{ flexDirection: 'row', alignItems: 'center' }}>
        <View style={{ flex: 1 }}><Text style={{ fontWeight: '700', color: t.ink }}>No ShoperPal account yet</Text><Text style={{ fontSize: 13, color: t['ink-soft'] }}>Shop on ShoperPal with your Indexx email to earn BTCY on what you buy.</Text></View>
        <OvalButton icon="external" label="Open" size="sm" variant="soft" onPress={() => openSite(url)} />
      </Card>
    );
  }
  return (
    <>
      <View style={{ flexDirection: 'row', gap: 8 }} testID="shoperpal-buyer"><Stat value={money(b.monthSpend)} label={`Spent this month · ${num(b.orderCount)} orders`} /><Stat value={num(b.nuggets?.released, 2)} label={`Nuggets earned${b.nuggets?.pending ? ` · ${num(b.nuggets.pending, 2)} on the way` : ''}`} /></View>
      {b.flash ? <Note icon="flash">Flash deal: {b.flash.title} · ends in {timeLeft(b.flash.endsAt)}</Note> : null}
      <Card title="Recent purchases" pad={false}>
        {!b.recentPurchases.length ? <Empty>No purchases yet.{b.earnRate ? ` You earn ${b.earnRate}.` : ''}</Empty> : null}
        {b.recentPurchases.map((o) => (
          <ListRow key={o.id} title={o.items.map((i) => (i.quantity > 1 ? `${i.name} ×${i.quantity}` : i.name)).join(', ') || 'Order'} sub={`${shortDate(o.createdAt)} · ${money(o.total)}`}
            right={<Tag kind={/SHIPPED|DELIVERED/.test(o.status) ? 'ok' : /CANCEL|REFUND/.test(o.status) ? 'danger' : 'warn'}>{orderWord(o.status)}</Tag>} />
        ))}
      </Card>
    </>
  );
}

function WallStreet({ w }: { w: IndexxWallStreet }) {
  const t = useTheme();
  return (
    <>
      <View style={{ flexDirection: 'row', gap: 8 }}><Stat testID="ws-stocks" value={num(w.holdings.count)} label={`Stocks bought · ${money(w.holdings.totalInvested)} invested`} /><Stat value={num(w.listings.count)} label="Companies you listed" /></View>
      <Card title="Stocks you bought" pad={false}>
        {!w.holdings.items.length ? <Empty>None yet. Buy into companies on Wall Street Indexx.</Empty> : null}
        {w.holdings.items.map((h) => (
          <ListRow key={h.campaignId} left={<IconOval icon="briefcase" size={40} />} title={h.tokenName} sub={`${num(h.tokensReceived)} ${h.tokenSymbol} · last bought ${shortDate(h.lastPurchasedAt)}`}
            right={<Text style={{ fontFamily: font.display, fontWeight: '800', color: t.ink }}>{money(h.amountInvested)}</Text>} />
        ))}
      </Card>
      <Card title="Companies you listed" pad={false}>
        {!w.listings.items.length ? <Empty>None. You can list your company on Wall Street Indexx.</Empty> : null}
        {w.listings.items.map((l) => {
          const pct = l.fundingGoal ? Math.min(100, Math.round(((l.raised ?? 0) / l.fundingGoal) * 100)) : 0;
          return (
            <View key={l.campaignId} style={{ paddingHorizontal: 14, paddingVertical: 10, gap: 6 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={{ flex: 1, fontWeight: '700', color: t.ink }}>{l.companyName} · {l.tokenSymbol}</Text>
                <Tag kind="muted">{l.status.charAt(0).toUpperCase() + l.status.slice(1)}</Tag>
                {l.verificationStatus === 'verified' ? <Tag kind="ok">Verified</Tag> : null}
              </View>
              <Text style={{ fontSize: 12, color: t['ink-soft'] }}>{money(l.raised)} of {money(l.fundingGoal)} · {num(l.investors)} investors{l.deadline ? ` · ends ${shortDate(l.deadline)}` : ''}</Text>
              <View accessibilityLabel={`${pct}% raised`} style={{ height: 6, borderRadius: 3, backgroundColor: t.sunken }}><View style={{ width: `${pct}%`, height: '100%', borderRadius: 3, backgroundColor: t.ember }} /></View>
            </View>
          );
        })}
      </Card>
    </>
  );
}

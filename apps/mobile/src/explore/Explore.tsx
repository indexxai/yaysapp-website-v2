import React, { useCallback, useMemo, useState } from 'react';
import { Image, Platform, Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { ApiError, INDEXX_LINKS, type ExploreView, type MeProfile } from '@yays/shared';
import { api } from '../lib/api';
import { config } from '../lib/config';
import { font, useTheme } from '../lib/theme';
import { Icon } from '../ui/Icon';
import { Banner as ErrorBanner, Field, OvalButton } from '../ui/kit';
import { LineArt } from '../ui/LineArt';
import { Text, TextInput } from '../ui/Text';
import { Card, Header, Sheet } from '../circles/common';
import { CheckinPopup } from './Popups';
import { BRAND, IconOval, IndexxSignIn, LinkRow, Logo, PRODUCTS, errText, money, num, openSite, useLoad, type ProductId } from './common';

export interface ExploreNav { ai: () => void; earn: () => void; wallet: () => void; invite: () => void; help: () => void; btcy: () => void; product: (p: 'emmm' | 'shoperpal' | 'rehuman' | 'wallstreet') => void; indexx: () => void }

/** The live line under each product, from the person's Indexx account. */
function liveLine(id: ProductId, x: ExploreView): string | null {
  if (id === 'btcy') { const b = x.btcy; return b ? `${num(b.portfolio.nuggets, 2)} Nuggets · ${b.mining.active ? 'mining' : 'not mining'}` : 'Couldn’t load right now'; }
  if (id === 'emmm') { const e = x.emmm; return e ? `${num(e.openPositions)} open · ${num(e.settledThisMonth?.count)} settled this month` : 'Couldn’t load right now'; }
  if (id === 'shoperpal') {
    const s = x.shoperpal;
    if (!s) return 'Couldn’t load right now';
    if (s.role === 'seller' && s.supplier) return `${num(s.supplier.ordersToday)} orders today · ${num(s.supplier.pendingOrders)} to ship`;
    return s.buyer ? `${money(s.buyer.monthSpend)} this month · ${num(s.buyer.orderCount)} orders` : 'No ShoperPal account yet';
  }
  if (id === 'wallstreet') { const w = x.wallstreet; return w ? `${num(w.holdings.count)} ${w.holdings.count === 1 ? 'stock' : 'stocks'} · ${money(w.holdings.totalInvested)} invested` : 'Couldn’t load right now'; }
  return null;
}

/** p01: Jack's AI, today's check-in, the Indexx products and shortcuts. */
export function ExploreScreen({ me, nav }: { me: MeProfile; nav: ExploreNav }) {
  const t = useTheme();
  const [q, setQ] = useState('');
  const [claiming, setClaiming] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const checkin = useLoad(() => api().then((a) => a.checkin()));
  const x = useLoad(() => api().then((a) => a.explore()));
  const ix = useLoad(() => api().then((a) => a.indexx()));
  const points = useLoad(() => api().then((a) => a.points()));
  // Back from Earn, the wallet or a product: the numbers are fresh.
  useFocusEffect(useCallback(() => { void checkin.reload(); void points.reload(); }, [])); // eslint-disable-line react-hooks/exhaustive-deps
  const shown = useMemo(() => { const s = q.trim().toLowerCase(); return s ? PRODUCTS.filter((p) => `${p.name} ${p.sub}`.toLowerCase().includes(s)) : PRODUCTS; }, [q]);
  const c = checkin.data;
  const openProduct = (id: ProductId) => (id === 'btcy' ? nav.btcy() : id === 'academy' ? undefined : nav.product(id));
  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: t.surface }} testID="explore-screen">
      <LineArt name="skater" height={300} />
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 8, paddingBottom: 8 }}>
        <Text accessibilityRole="header" style={{ fontFamily: font.display, fontWeight: '800', fontSize: 30, lineHeight: 36, color: t.ink }}>Explore</Text>
        <Pressable accessibilityRole="button" accessibilityLabel={`INEX balance ${points.data ? points.data.balance.toLocaleString('en-US') : ''}`} onPress={nav.earn}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: 6, paddingRight: 12, paddingVertical: 5, borderRadius: 999, backgroundColor: t['ember-wash'] }}>
          <Image source={BRAND.coin} style={{ width: 24, height: 24 }} resizeMode="contain" />
          <Text testID="explore-balance" style={{ fontFamily: font.display, fontWeight: '800', fontSize: 14, color: t['ember-ink'] }}>{points.data ? points.data.balance.toLocaleString('en-US') : '—'}</Text>
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 30, gap: 12 }} keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} tintColor={t.ember} onRefresh={() => { setRefreshing(true); void Promise.all([checkin.reload(), x.reload(), ix.reload(), points.reload()]).finally(() => setRefreshing(false)); }} />}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 48, paddingHorizontal: 14, borderRadius: 999, backgroundColor: t.raised }}>
          <Icon name="search" size={18} color={t['ink-soft']} />
          <TextInput accessibilityLabel="Search products and features" placeholder="Search products and features" placeholderTextColor={t['ink-faint']} value={q} onChangeText={setQ} style={{ flex: 1, fontSize: 15, color: t.ink, paddingVertical: 10 }} />
          {q ? <Pressable accessibilityRole="button" accessibilityLabel="Clear search" onPress={() => setQ('')} hitSlop={8}><Icon name="close" size={16} color={t['ink-soft']} /></Pressable> : null}
        </View>

        <Pressable accessibilityRole="button" accessibilityLabel="Ask Jack’s AI" testID="jack-card" onPress={nav.ai} style={{ flexDirection: 'row', alignItems: 'center', gap: 14, padding: 18, borderRadius: 26, backgroundColor: t.ember, overflow: 'hidden' }}>
          <View style={{ position: 'absolute', width: 240, height: 220, borderRadius: 200, top: -110, right: -60, backgroundColor: t['ember-light'], opacity: 0.5 }} />
          <LineArt name="gear" height={130} ink="#ffffff" opacity={0.35} style={{ right: -20, bottom: -30 }} />
          <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: '#ffffff', alignItems: 'center', justifyContent: 'center' }}><Image source={BRAND.jack} style={{ width: 44, height: 44 }} resizeMode="contain" /></View>
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={{ fontFamily: font.display, fontWeight: '800', fontSize: 20, color: '#fff' }}>Ask Jack’s AI</Text>
            <Text style={{ fontSize: 13, lineHeight: 18, color: '#fff' }}>Questions, writing, pictures, web answers and help with any Indexx product.</Text>
          </View>
          <Icon name="chevron-right" size={20} color="#fff" />
        </Pressable>

        <Card testID="checkin-tile" style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <IconOval icon="gift" size={48} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={{ fontWeight: '800', color: t.ink, fontSize: 15 }}>Daily check-in</Text>
            <Text style={{ fontSize: 13, color: t['ink-soft'] }}>{c ? (c.claimedToday ? `Claimed · day ${c.streak} streak · tomorrow +${c.tomorrowPoints}` : c.streak ? `Day ${c.streak + 1} streak · +${c.todayPoints} INEX` : `Start a streak · +${c.todayPoints} INEX`) : '…'}</Text>
          </View>
          {c && !c.claimedToday ? <OvalButton icon="check" label="Claim" size="sm" onPress={() => setClaiming(true)} /> : <OvalButton icon="star" label="Earn" size="sm" variant="soft" onPress={nav.earn} />}
        </Card>

        {x.data && !x.data.linked && ix.data?.available ? <IndexxSignIn email={ix.data.email ?? me.email ?? null} ended={!!ix.data.email} onDone={(st) => { ix.setData(st); void x.reload(); }} /> : null}

        <Card testID="products">
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <Text accessibilityRole="header" style={{ fontFamily: font.display, fontWeight: '800', fontSize: 16, color: t.ink }}>Indexx products</Text>
            {x.data?.linked && ix.data?.email ? <Text testID="indexx-as" onPress={nav.indexx} style={{ flexShrink: 1, fontSize: 12, color: t['ink-soft'] }} numberOfLines={1}>as {ix.data.email}</Text> : null}
          </View>
          {x.error ? <ErrorBanner tone="warning">{x.error}</ErrorBanner> : null}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap: 14 }}>
            {shown.map((p) => {
              const live = x.data?.linked ? liveLine(p.id, x.data) : null;
              const sub = live ?? (x.data || x.error ? p.sub : '…');
              return (
                <Pressable key={p.id} accessibilityRole="button" accessibilityLabel={`${p.name}, ${sub}`} accessibilityState={{ disabled: !!p.soon }} disabled={p.soon}
                  onPress={() => (p.id === 'rehuman' ? openSite((x.data?.links ?? INDEXX_LINKS).rehuman) : openProduct(p.id))}
                  style={{ width: '33.33%', alignItems: 'center', gap: 6, paddingHorizontal: 4, opacity: p.soon ? 0.55 : 1 }}>
                  <Logo src={BRAND[p.id]} size={60} />
                  <Text style={{ fontWeight: '700', fontSize: 13, color: t.ink, textAlign: 'center' }} numberOfLines={1}>{p.name}</Text>
                  <Text testID={`live-${p.id}`} style={{ fontSize: 11, lineHeight: 15, color: t['ink-soft'], textAlign: 'center' }} numberOfLines={2}>{sub}</Text>
                </Pressable>
              );
            })}
            {!shown.length ? <Text style={{ color: t['ink-soft'] }}>Nothing matches “{q}”.</Text> : null}
          </View>
        </Card>

        <Card pad={false}>
          <LinkRow left={<IconOval icon="wallet" />} title="Wallet" sub="INEX, Nuggets, USDXX and the exchange" onPress={nav.wallet} />
          <LinkRow left={<IconOval icon="star" />} title="Earn" sub="Check-ins, tasks and bonuses" onPress={nav.earn} />
          <LinkRow left={<IconOval icon="person-add" />} title="Invite friends" sub="+100 INEX each" onPress={nav.invite} />
          <LinkRow left={<IconOval icon="help" />} title="Help and support" sub="AI answers, then a person" onPress={nav.help} />
        </Card>
      </ScrollView>
      {claiming && c ? <CheckinPopup first={me.displayName.split(/\s+/)[0] ?? ''} status={c} onClose={() => { setClaiming(false); void checkin.reload(); void points.reload(); }} onEarn={nav.earn} /> : null}
    </SafeAreaView>
  );
}

/* ------------------------------------------------------------------ help and support (p05) */

const FAQ: Array<[string, string]> = [
  ['I’m not getting notifications', 'Check that notifications are on for YaysApp in your phone’s Settings. Muted chats don’t notify. On Android, also check the app isn’t restricted in battery settings.'],
  ['Why does a message show one tick?', 'One tick means it reached YaysApp but not the other person’s phone yet, usually because they are offline. Two ticks: delivered. Two orange ticks: read. If they turned read receipts off, you’ll only see delivered.'],
  ['My check-in didn’t add INEX', 'Check-ins reset at midnight in your time zone, and each day counts once on any device. Look in Earn › History. If it’s missing, ask below and a person will check.'],
  ['How do I use YaysApp on a computer?', 'Sign in on yaysapp.com with your phone number or email. Your chats are kept on YaysApp, so they appear on every device. See and log out devices in Me › Linked devices.'],
  ['What happens when I block someone?', 'They can’t message or call you, and they won’t see when you’re online or your photo. They are not told.'],
  ['How do I edit or delete a message?', 'Long-press a message and open its menu. You can edit your messages for 15 minutes and delete them for everyone for 15 minutes; after that you can still delete them for yourself.'],
];

export function HelpScreen({ onBack, openChat }: { onBack: () => void; openChat: (id: string) => void }) {
  const t = useTheme();
  const [q, setQ] = useState('');
  const [answer, setAnswer] = useState<string | null>(null);
  const [busy, setBusy] = useState<'ask' | 'ticket' | 'chat' | null>(null);
  const [solved, setSolved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [openQ, setOpenQ] = useState<string | null>(null);
  const [reporting, setReporting] = useState(false);
  const run = async (which: 'ask' | 'ticket' | 'chat', fn: () => Promise<void>) => { setBusy(which); setError(null); try { await fn(); } catch (e) { setError(e instanceof ApiError ? e.message : 'That didn’t work. Try again.'); } finally { setBusy(null); } };
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.surface }} testID="help-screen">
      <LineArt name="lantern" height={230} style={{ right: -10, top: 150, bottom: undefined }} />
      <Header back="Explore" onBack={onBack} title="Help" />
      <ScrollView contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 30, gap: 12 }} keyboardShouldPersistTaps="handled">
        {notice ? <ErrorBanner tone="success">{notice}</ErrorBanner> : null}
        <Card testID="ask-support">
          <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}><Image source={BRAND.jack} style={{ width: 28, height: 28 }} resizeMode="contain" /><Text accessibilityRole="header" style={{ fontFamily: font.display, fontWeight: '800', fontSize: 17, color: t.ink }}>What’s going wrong?</Text></View>
          <TextInput accessibilityLabel="Describe the problem" multiline value={q} maxLength={1000} onChangeText={(v) => { setQ(v); setAnswer(null); setSolved(false); }} placeholder="For example: my check-in didn’t add INEX" placeholderTextColor={t['ink-faint']}
            style={{ minHeight: 70, padding: 12, borderRadius: 16, borderWidth: 1, borderColor: t['line-strong'], backgroundColor: t.surface, color: t.ink, fontSize: 15, textAlignVertical: 'top' }} />
          {error ? <ErrorBanner>{error}</ErrorBanner> : null}
          {answer === null ? (
            <View style={{ alignItems: 'center' }}><OvalButton icon="sparkles" label="Get an answer" loading={busy === 'ask'} disabled={q.trim().length < 3} onPress={() => void run('ask', async () => setAnswer((await (await api()).supportAsk(q)).answer))} /></View>
          ) : (
            <>
              <View testID="support-answer" style={{ gap: 4, padding: 12, borderRadius: 16, backgroundColor: t.surface }}><Text style={{ fontSize: 11, color: t['ink-soft'] }}>Jack’s AI</Text><Text style={{ fontSize: 14, lineHeight: 20, color: t.ink }}>{answer}</Text></View>
              {solved ? <ErrorBanner tone="success">Glad that helped.</ErrorBanner> : (
                <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 26 }}>
                  <OvalButton icon="check" label="That solved it" size="sm" variant="soft" onPress={() => setSolved(true)} />
                  <OvalButton icon="person-circle" label="Talk to a person" size="sm" loading={busy === 'ticket'} onPress={() => void run('ticket', async () => openChat((await (await api()).supportTicket(q, answer)).conversationId))} />
                </View>
              )}
              <Text style={{ fontSize: 12, color: t['ink-soft'], textAlign: 'center' }}>Our team sees the whole question and answer, so you won’t need to repeat yourself.</Text>
            </>
          )}
        </Card>
        <Card title="Popular questions" pad={false}>
          {FAQ.map(([qq, a]) => (
            <Pressable key={qq} accessibilityRole="button" accessibilityState={{ expanded: openQ === qq }} accessibilityLabel={qq} onPress={() => setOpenQ(openQ === qq ? null : qq)} style={{ paddingHorizontal: 16, paddingVertical: 12, gap: 6 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><Text style={{ flex: 1, fontWeight: '700', color: t.ink, fontSize: 14 }}>{qq}</Text><Icon name={openQ === qq ? 'chevron-up' : 'chevron-down'} size={16} color={t['ink-soft']} /></View>
              {openQ === qq ? <Text style={{ fontSize: 13, lineHeight: 19, color: t['ink-soft'] }}>{a}</Text> : null}
            </Pressable>
          ))}
        </Card>
        <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <IconOval icon="chat" tone="ember" size={48} />
          <View style={{ flex: 1 }}><Text style={{ fontWeight: '800', color: t.ink }}>Contact us</Text><Text style={{ fontSize: 13, color: t['ink-soft'] }}>Opens a chat with YaysApp Support. We reply in the same chat.</Text></View>
          <OvalButton icon="chat" label="Start chat" size="sm" loading={busy === 'chat'} onPress={() => void run('chat', async () => openChat((await (await api()).supportChat()).id))} />
        </Card>
        <Card pad={false}>
          <LinkRow left={<IconOval icon="flag" size={36} />} title="Report a problem" sub="Tell us what went wrong; we add your phone’s details" onPress={() => setReporting(true)} />
          <LinkRow left={<IconOval icon="document" size={36} />} title="Terms and Privacy Policy" onPress={() => openSite(`${config.siteUrl}/terms`)} right={<Icon name="external" size={16} color={t['ink-faint']} />} />
        </Card>
        <Text style={{ textAlign: 'center', fontSize: 12, color: t['ink-soft'] }}>YaysApp for {Platform.OS === 'ios' ? 'iPhone' : 'Android'} · version {config.appVersion}</Text>
      </ScrollView>
      {reporting ? <ProblemSheet onClose={() => setReporting(false)} onSent={() => { setReporting(false); setNotice('Thanks. We got your report and will look into it.'); }} /> : null}
    </SafeAreaView>
  );
}

function ProblemSheet({ onClose, onSent }: { onClose: () => void; onSent: () => void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const send = async () => {
    if (text.trim().length < 10) { setError('Tell us a bit more (at least 10 characters).'); return; }
    setBusy(true); setError(null);
    try { await (await api()).reportProblem({ text: text.trim(), userAgent: `${Platform.OS} ${String(Platform.Version)}`, appVersion: `${Platform.OS} ${config.appVersion}` }); onSent(); }
    catch (e) { setError(errText(e, 'Could not send. Try again.')); setBusy(false); }
  };
  return (
    <Sheet title="Report a problem" onClose={onClose} testID="problem-sheet">
      {error ? <ErrorBanner>{error}</ErrorBanner> : null}
      <Field label="What happened?" hint="What you did, what you expected, and what happened instead." value={text} onChangeText={setText} maxLength={2000} multiline autoFocus />
      <View style={{ alignItems: 'center' }}><OvalButton icon="send" label="Send report" loading={busy} onPress={() => void send()} /></View>
    </Sheet>
  );
}

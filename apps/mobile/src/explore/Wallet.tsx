import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiError, ErrorCode, type MeProfile, type Withdrawal, type WithdrawalsPage, type WithdrawQuote } from '@yays/shared';
import { api } from '../lib/api';
import { font, useTheme } from '../lib/theme';
import { Icon } from '../ui/Icon';
import { Banner as ErrorBanner, OvalButton } from '../ui/kit';
import { LineArt } from '../ui/LineArt';
import { Text, TextInput } from '../ui/Text';
import { Card, Header, Note, Sheet, Tag } from '../circles/common';
import { BRAND, IconOval, IndexxSignIn, Logo, errText, money, num, useLoad, when } from './common';

const STATUS: Record<Withdrawal['status'], { label: string; tone: 'ok' | 'danger' | 'warn' }> = {
  completed: { label: 'Completed', tone: 'ok' }, failed: { label: 'Failed · INEX returned', tone: 'danger' }, processing: { label: 'Processing', tone: 'warn' },
};
const newKey = () => 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, () => Math.floor(Math.random() * 16).toString(16));

/** p09: INEX, BTCY Nuggets, USDXX and Indexx Exchange from the Indexx account, and withdrawing INEX to the exchange. */
export function WalletScreen({ me, onBack }: { me: MeProfile; onBack: () => void }) {
  const t = useTheme();
  const wallet = useLoad(() => api().then((a) => a.wallet()));
  const ix = useLoad(() => api().then((a) => a.indexx()));
  const [history, setHistory] = useState<WithdrawalsPage | null>(null);
  const [hidden, setHidden] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const w = wallet.data;
  const linked = !!w?.linked;
  const loadHistory = async (skip = 0) => { try { const p = await (await api()).withdrawals(skip); setHistory((h) => (skip && h ? { items: [...h.items, ...p.items], hasMore: p.hasMore } : p)); } catch { /* shown as empty */ } };
  useEffect(() => { if (linked) void loadHistory(); }, [linked]);
  const refresh = async () => { await wallet.reload(); await loadHistory(); };
  const show = (s: string) => (hidden ? '•••' : s);
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.surface }} testID="wallet-screen">
      <LineArt name="wallet" height={300} style={{ right: -40, bottom: 30 }} />
      <Header back="Explore" onBack={onBack} title="Wallet" right={linked ? <OvalButton icon={hidden ? 'eye' : 'eye-off'} label={hidden ? 'Show' : 'Hide'} size="sm" variant="ghost" onPress={() => setHidden(!hidden)} /> : undefined} />
      <ScrollView contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 30, gap: 12 }} keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} tintColor={t.ember} onRefresh={() => { setRefreshing(true); void refresh().finally(() => setRefreshing(false)); }} />}>
        {wallet.error ? <ErrorBanner>{wallet.error}</ErrorBanner> : null}
        {done ? <ErrorBanner tone="success">{done}</ErrorBanner> : null}
        {!w && !wallet.error ? <ActivityIndicator color={t.ember} /> : null}
        {w && !linked && ix.data ? (
          <IndexxSignIn email={ix.data.email ?? me.email ?? null} ended={!!ix.data.email} sub="Your INEX, BTCY Nuggets, USDXX and Indexx Exchange balances show here once you sign in, and you can withdraw INEX to Indexx Exchange." onDone={(s) => { ix.setData(s); void wallet.reload(); }} />
        ) : null}
        {w ? (
          <View style={{ borderRadius: 26, padding: 20, gap: 4, backgroundColor: '#211b16', overflow: 'hidden' }} testID="card-inex">
            <View style={{ position: 'absolute', width: 220, height: 200, borderRadius: 200, top: -110, right: -70, backgroundColor: '#ffffff', opacity: 0.06 }} />
            <Text style={{ fontSize: 13, color: '#ffffffcc' }}>INEX balance · earned in YaysApp</Text>
            <Text style={{ fontFamily: font.display, fontWeight: '800', fontSize: 38, lineHeight: 46, color: '#fff' }}>{w.inex ? show(num(w.inex.balance)) : '—'}</Text>
            <Text style={{ fontSize: 12, color: '#ffffffcc' }}>{linked ? 'Withdraw to your Indexx Exchange INEX wallet' : 'Sign in to Indexx to withdraw'}</Text>
            <View style={{ flexDirection: 'row', gap: 22, marginTop: 12 }}>
              <OvalButton icon="upload" label="Withdraw" size="sm" disabled={!linked} onPress={() => { setDone(null); setWithdrawing(true); }} />
              {linked ? <OvalButton icon="refresh" label="Refresh" size="sm" variant="secondary" onPress={() => void refresh()} /> : null}
            </View>
          </View>
        ) : null}
        {w ? (
          <Card title="Balances" pad={false}>
            <Row left={<IconOval icon="star" tone="ember" />} name="INEX" sub={w.inex?.source ?? 'Earned in YaysApp'} amount={w.inex ? show(num(w.inex.balance)) : '—'} note="INEX" />
            <Row left={<Logo src={BRAND.btcy} size={40} />} name="BTCY Nuggets" sub={w.nuggets?.source ?? 'From BTCY mining'} amount={w.nuggets ? show(num(w.nuggets.balance, 2)) : '—'} note="nuggets" />
            <Row left={<Logo src={BRAND.usdxx} size={40} />} name="USDXX" sub={w.usdxx?.source ?? 'Indexx Pay'} amount={w.usdxx ? show(money(w.usdxx.usd ?? w.usdxx.balance)) : '—'} note="available" />
            <Row left={<Logo src={BRAND.exchange} size={40} />} name="Indexx Exchange" sub={linked && !w.exchange ? 'Couldn’t read it right now' : 'Read-only · open the app to trade'} amount={w.exchange ? show(money(w.exchange.totalUsd)) : '—'} note="est. value" testID="card-exchange" />
          </Card>
        ) : null}
        {w?.exchange && w.exchange.assets.length ? (
          <Card title="On Indexx Exchange" pad={false}>
            {w.exchange.assets.map((a) => (
              <View key={`${a.symbol}-${a.network}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 10 }}>
                <View style={{ flex: 1 }}><Text style={{ fontWeight: '700', color: t.ink }}>{a.symbol}</Text><Text style={{ fontSize: 12, color: t['ink-soft'] }}>{num(a.balance, 2)}{a.network ? ` · ${a.network}` : ''} · {money(a.price)}</Text></View>
                <Text style={{ fontFamily: font.display, fontWeight: '800', color: t.ink }}>{show(money(a.usd))}</Text>
              </View>
            ))}
            {w.exchange.partial ? <Text style={{ fontSize: 12, color: t['ink-soft'], paddingHorizontal: 16, paddingBottom: 12 }}>Some coins have no price yet, so they aren’t in the total.</Text> : null}
          </Card>
        ) : null}
        {linked ? (
          <Card title="Withdrawals" pad={false} testID="withdrawals">
            {history && !history.items.length ? <Text style={{ paddingHorizontal: 16, paddingBottom: 14, paddingTop: 4, color: t['ink-soft'], fontSize: 14 }}>Nothing yet. INEX you withdraw to Indexx Exchange shows here.</Text> : null}
            {history?.items.map((x) => (
              <View key={x.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 10 }}>
                <IconOval icon="upload" size={36} tone="muted" />
                <View style={{ flex: 1, gap: 3 }}><Text style={{ fontWeight: '700', color: t.ink, fontSize: 14 }}>To Indexx Exchange</Text><View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}><Tag kind={STATUS[x.status]?.tone ?? 'muted'}>{STATUS[x.status]?.label ?? x.status}</Tag><Text style={{ fontSize: 12, color: t['ink-soft'] }}>{when(x.createdAt)}</Text></View></View>
                <Text style={{ fontFamily: font.display, fontWeight: '800', fontSize: 14, color: x.status === 'failed' ? t['ink-soft'] : t.ink, textDecorationLine: x.status === 'failed' ? 'line-through' : 'none' }}>{num(x.amount)} INEX</Text>
              </View>
            ))}
            {history?.hasMore ? <View style={{ alignItems: 'center', paddingBottom: 12 }}><OvalButton icon="chevron-down" label="Show more" size="sm" variant="ghost" onPress={() => void loadHistory(history.items.length)} /></View> : null}
          </Card>
        ) : null}
      </ScrollView>
      {withdrawing && w ? (
        <WithdrawSheet onClose={() => setWithdrawing(false)} onDone={(r) => { setWithdrawing(false); setDone(`${num(r.amount)} INEX is on its way to your Indexx Exchange INEX wallet.`); void refresh(); }}
          onSignedOut={() => { setWithdrawing(false); void ix.reload(); void wallet.reload(); }} />
      ) : null}
    </SafeAreaView>
  );
}

function Row({ left, name, sub, amount, note, testID }: { left: React.ReactNode; name: string; sub: string; amount: string; note: string; testID?: string }) {
  const t = useTheme();
  return (
    <View testID={testID} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 58, paddingHorizontal: 14, paddingVertical: 8 }}>
      {left}
      <View style={{ flex: 1 }}><Text style={{ fontSize: 14, fontWeight: '700', color: t.ink }}>{name}</Text><Text style={{ fontSize: 12, color: t['ink-soft'] }}>{sub}</Text></View>
      <View style={{ alignItems: 'flex-end' }}><Text style={{ fontFamily: font.display, fontWeight: '800', fontSize: 15, color: t.ink }}>{amount}</Text><Text style={{ fontSize: 11, color: t['ink-soft'] }}>{note}</Text></View>
    </View>
  );
}

/** How much, a fresh check from Indexx as it's typed, then a confirmation. The same key is reused on retry so it can't pay twice. */
function WithdrawSheet({ onClose, onDone, onSignedOut }: { onClose: () => void; onDone: (r: Withdrawal) => void; onSignedOut: () => void }) {
  const t = useTheme();
  const [raw, setRaw] = useState('');
  const [quote, setQuote] = useState<WithdrawQuote | null>(null);
  const [confirm, setConfirm] = useState<{ amount: number; key: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const asked = useRef(0);
  const n = Number(raw.replace(/[,\s]/g, ''));
  const typed = raw.trim() !== '';
  const whole = typed && Number.isInteger(n) && n > 0;
  useEffect(() => {
    const amount = whole ? n : 0, ticket = ++asked.current;
    const id = setTimeout(() => {
      void api().then((a) => a.withdrawQuote(amount)).then((q) => { if (ticket === asked.current) setQuote(q); }, (e) => {
        if (ticket !== asked.current) return;
        if (e instanceof ApiError && e.code === ErrorCode.INDEXX_SIGN_IN) onSignedOut(); else setError(errText(e));
      });
    }, amount ? 300 : 0);
    return () => clearTimeout(id);
  }, [raw]); // eslint-disable-line react-hooks/exhaustive-deps
  const current = quote && whole && quote.amount === n ? quote : null;
  const problem = !typed ? null : !whole ? 'Enter a whole number of INEX.' : current && !current.eligible ? current.reason : null;
  const max = quote ? Math.max(0, Math.min(quote.balance, quote.remainingToday ?? quote.balance)) : 0;
  const go = async () => {
    if (!confirm) return;
    setBusy(true); setError(null);
    try { onDone(await (await api()).withdraw(confirm.amount, confirm.key)); }
    catch (e) { if (e instanceof ApiError && e.code === ErrorCode.INDEXX_SIGN_IN) { onSignedOut(); return; } setError(errText(e)); }
    finally { setBusy(false); }
  };
  if (confirm) {
    return (
      <Sheet title="Withdraw INEX?" onClose={() => { if (!busy) setConfirm(null); }} testID="withdraw-confirm">
        <View style={{ alignItems: 'center', gap: 6, padding: 14, borderRadius: 18, backgroundColor: t.raised }}>
          <Text style={{ color: t['ink-soft'] }}>You send</Text>
          <Text style={{ fontFamily: font.display, fontWeight: '800', fontSize: 26, color: t.ink }}>{num(confirm.amount)} INEX</Text>
          <Icon name="arrow-down" size={18} color={t['ink-soft']} />
          <Text style={{ color: t['ink-soft'] }}>It arrives in</Text>
          <Text style={{ fontWeight: '700', color: t.ink }}>{quote?.destination ?? 'Indexx Exchange INEX wallet'}</Text>
        </View>
        <Facts rows={[['Fee', 'None'], ['Left in YaysApp', quote ? `${num(quote.balance - confirm.amount)} INEX` : '—']]} />
        <Text style={{ fontSize: 12, lineHeight: 17, color: t['ink-soft'] }}>Withdrawals can’t be undone. If the exchange can’t take it, your INEX comes back.</Text>
        {error ? <ErrorBanner>{error}</ErrorBanner> : null}
        <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 32 }}>
          <OvalButton icon="close" label="Cancel" variant="ghost" disabled={busy} onPress={() => setConfirm(null)} />
          <OvalButton icon="check" label={error ? 'Try again' : 'Withdraw'} size="lg" loading={busy} onPress={() => void go()} />
        </View>
      </Sheet>
    );
  }
  return (
    <Sheet title="Withdraw" lead="To your Indexx Exchange INEX wallet." onClose={onClose} testID="withdraw-sheet">
      {error ? <ErrorBanner>{error}</ErrorBanner> : null}
      <View style={{ padding: 16, borderRadius: 22, backgroundColor: t.raised, gap: 8 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Text style={{ fontSize: 13, color: t['ink-soft'] }}>INEX to withdraw</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Max" disabled={!quote || max < quote.minimum} onPress={() => setRaw(String(max))}><Text style={{ fontSize: 13, color: t['ink-soft'] }}>{quote ? `Balance ${num(quote.balance)} · ` : ''}<Text style={{ color: t['ember-ink'], fontWeight: '700' }}>Max</Text></Text></Pressable>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <IconOval icon="star" tone="ember" />
          <Text style={{ flex: 1, fontSize: 16, fontWeight: '700', color: t.ink }}>INEX</Text>
          <TextInput accessibilityLabel="INEX to withdraw" value={raw} onChangeText={(v) => { setRaw(v); setError(null); }} keyboardType="number-pad" placeholder="0" placeholderTextColor={t['ink-faint']} style={{ minWidth: 120, textAlign: 'right', fontFamily: font.display, fontWeight: '800', fontSize: 30, color: t.ink }} />
        </View>
        {problem ? <Text accessibilityRole="alert" style={{ fontSize: 13, fontWeight: '600', color: t['danger-ink'] }}>{problem}</Text> : null}
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 22, backgroundColor: t.raised }}>
        <Logo src={BRAND.exchange} size={40} />
        <Text style={{ flex: 1, fontWeight: '700', color: t.ink }}>{quote?.destination ?? 'Indexx Exchange INEX wallet'}</Text>
        <Text style={{ fontFamily: font.display, fontWeight: '800', fontSize: 20, color: t['ember-ink'] }}>{current?.eligible ? num(n) : '—'}</Text>
      </View>
      <Facts rows={[['Rate', '1 INEX = 1 INEX on the exchange'], ['Minimum', quote ? `${num(quote.minimum)} INEX` : '—'], ...(quote?.dailyMax != null ? [['Daily limit', `${num(quote.dailyMax)} INEX`], ['Left today', `${num(quote.remainingToday)} INEX`]] as Array<[string, string]> : [])]} />
      <View style={{ alignItems: 'center' }}><OvalButton icon="upload" label={current?.eligible ? `Withdraw ${num(n)} INEX` : 'Withdraw'} size="xl" disabled={!current?.eligible} onPress={() => { setError(null); setConfirm({ amount: n, key: newKey() }); }} /></View>
    </Sheet>
  );
}

function Facts({ rows }: { rows: Array<[string, string]> }) {
  const t = useTheme();
  return (
    <View style={{ padding: 14, borderRadius: 20, backgroundColor: t.raised, gap: 8 }}>
      {rows.map(([k, v]) => <View key={k} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}><Text style={{ color: t['ink-soft'], fontSize: 14 }}>{k}</Text><Text style={{ fontWeight: '700', color: t.ink, fontSize: 14, flexShrink: 1, textAlign: 'right' }}>{v}</Text></View>)}
    </View>
  );
}

/* ------------------------------------------------------------------ the Indexx account (p15) */

export function IndexxScreen({ me, onBack }: { me: MeProfile; onBack: () => void }) {
  const t = useTheme();
  const s = useLoad(() => api().then((a) => a.indexx()));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const signOut = async () => { setBusy(true); try { s.setData(await (await api()).unlinkIndexx()); setMsg({ tone: 'success', text: 'Signed out of Indexx.' }); } catch (e) { setMsg({ tone: 'danger', text: errText(e) }); } finally { setBusy(false); } };
  const d = s.data;
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.surface }} testID="indexx-screen">
      <Header back="Back" onBack={onBack} title="Indexx account" />
      <ScrollView contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 30, gap: 12 }} keyboardShouldPersistTaps="handled">
        {msg ? <ErrorBanner tone={msg.tone}>{msg.text}</ErrorBanner> : null}
        {s.error ? <ErrorBanner>{s.error}</ErrorBanner> : null}
        {!d && !s.error ? <ActivityIndicator color={t.ember} /> : null}
        {d && !d.available ? <Note icon="info" tone="plain">Signing in to Indexx isn’t available yet.</Note> : null}
        {d?.linked ? (
          <Card testID="indexx-linked">
            <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
              <Logo src={BRAND.indexx} size={56} />
              <View style={{ flex: 1 }}><Text style={{ fontFamily: font.display, fontWeight: '800', fontSize: 17, color: t.ink }}>One account for every Indexx product</Text><Text style={{ fontSize: 13, color: t['ink-soft'] }}>YaysApp reads your BTCY, EMMM, ShoperPal, Wall Street and wallet with your Indexx sign-in.</Text></View>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 18, backgroundColor: t['success-wash'] }}>
              <IconOval icon="check" tone="success" />
              <View style={{ flex: 1 }}><Text style={{ fontWeight: '700', color: t.ink }}>Signed in</Text><Text style={{ fontSize: 12, color: t['ink-soft'] }}>{d.email}{d.linkedAt ? ` · since ${new Date(d.linkedAt).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })}` : ''}</Text></View>
            </View>
            <View style={{ alignItems: 'center' }}><OvalButton icon="logout" label="Sign out of Indexx" variant="ghost" loading={busy} onPress={() => void signOut()} /></View>
          </Card>
        ) : d?.available ? (
          <IndexxSignIn email={d.email ?? me.email ?? null} ended={!!d.email} onDone={(n) => { s.setData(n); setMsg({ tone: 'success', text: 'Signed in to Indexx.' }); }} />
        ) : null}
        <Card title="What the Indexx sign-in shows" pad={false}>
          {([['Explore', 'BTCY mining, EMMM positions, ShoperPal orders and Wall Street stocks'], ['Wallet', 'INEX, BTCY Nuggets, USDXX and Indexx Exchange; withdraw INEX to the exchange'], ['BTCY bonus', 'Your mining streak and friends who join your team count toward INEX'], ['Your password', 'Sent to Indexx once to sign in, never kept by YaysApp']] as const).map(([a, b]) => (
            <View key={a} style={{ paddingHorizontal: 16, paddingVertical: 10 }}><Text style={{ fontWeight: '700', color: t.ink, fontSize: 14 }}>{a}</Text><Text style={{ fontSize: 13, color: t['ink-soft'] }}>{b}</Text></View>
          ))}
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}

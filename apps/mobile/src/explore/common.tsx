import React, { useCallback, useEffect, useState } from 'react';
import { Image, Linking, Pressable, View, type ImageSourcePropType } from 'react-native';
import { ApiError, type CheckinStatus, type IndexxLink } from '@yays/shared';
import { api } from '../lib/api';
import { font, useTheme } from '../lib/theme';
import { Icon, type IconName } from '../ui/Icon';
import { Banner as ErrorBanner, Field, OvalButton } from '../ui/kit';
import { Oval } from '../ui/Oval';
import { Text } from '../ui/Text';
import { Card } from '../circles/common';

// ---------------------------------------------------------------------------------------------------------------
// Shared by the Explore screens (same wording and numbers as the web: apps/web/lib/phase2.tsx).
// ---------------------------------------------------------------------------------------------------------------
export const errText = (e: unknown, f = 'Something went wrong. Try again.') => (e instanceof ApiError ? e.message : f);

/** Loading one thing from the API, with reload. */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const reload = useCallback(async () => { try { setData(await fn()); setError(null); } catch (e) { setError(errText(e)); } }, deps);
  useEffect(() => { void reload(); }, [reload]);
  return { data, setData, error, reload };
}

export const fmtPoints = (n: number) => n.toLocaleString('en-US');
export const money = (n: number | null | undefined) => (n == null ? '—' : `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
export const num = (n: number | null | undefined, dp = 0) => (n == null ? '—' : n.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: Math.max(dp, 4) }));
export const shortDate = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString([], { day: 'numeric', month: 'short', year: new Date(iso).getFullYear() === new Date().getFullYear() ? undefined : 'numeric' }) : '—');
/** "7h 12m", "4d 6h" or "12m" until a moment. */
export function timeLeft(iso: string, now = Date.now()) {
  const m = Math.max(0, Math.round((Date.parse(iso) - now) / 60000));
  const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mm = m % 60;
  return d ? `${d}d ${h}h` : h ? `${h}h ${mm}m` : `${mm}m`;
}
export function when(iso: string) {
  const d = new Date(iso), now = new Date();
  const y = new Date(now); y.setDate(now.getDate() - 1);
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === now.toDateString()) return `Today, ${time}`;
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { day: 'numeric', month: 'short' });
}

/* ---- pictures ---- */
export const BRAND = {
  coin: require('../../assets/brand/coin.png'),
  jack: require('../../assets/brand/jack.png'),
  jackBunny: require('../../assets/brand/jack-bunny.png'),
  btcyCoin: require('../../assets/brand/btcy-coin.png'),
  btcy: require('../../assets/brand/products/btcy.png'),
  emmm: require('../../assets/brand/products/emmm.png'),
  shoperpal: require('../../assets/brand/products/shoperpal.png'),
  rehuman: require('../../assets/brand/products/rehuman.png'),
  wallstreet: require('../../assets/brand/products/wallstreet.png'),
  academy: require('../../assets/brand/products/academy.png'),
  indexx: require('../../assets/brand/products/indexx.png'),
  usdxx: require('../../assets/brand/products/usdxx.png'),
  exchange: require('../../assets/brand/products/exchange.png'),
} satisfies Record<string, ImageSourcePropType>;

export type ProductId = 'btcy' | 'emmm' | 'shoperpal' | 'rehuman' | 'wallstreet' | 'academy';
export const PRODUCTS: Array<{ id: ProductId; name: string; sub: string; soon?: boolean }> = [
  { id: 'btcy', name: 'BTCY', sub: 'Mining and Nuggets' },
  { id: 'emmm', name: 'EMMM', sub: 'Prediction markets' },
  { id: 'shoperpal', name: 'ShoperPal', sub: 'Shopping deals' },
  { id: 'rehuman', name: 'ReHuman', sub: 'Wellness' },
  { id: 'wallstreet', name: 'Wall Street Indexx', sub: 'Markets' },
  { id: 'academy', name: 'Academy', sub: 'Coming soon', soon: true },
];

/** A logo on a white oval (product marks are drawn for a light background, in both themes). */
export function Logo({ src, size = 44 }: { src: ImageSourcePropType; size?: number }) {
  return <Oval width={size} fill="#ffffff"><Image source={src} style={{ width: size * 0.62, height: size * 0.62 }} resizeMode="contain" /></Oval>;
}
/** An icon on the brand wash. */
export function IconOval({ icon, size = 40, tone = 'wash' }: { icon: IconName; size?: number; tone?: 'wash' | 'ember' | 'success' | 'muted' }) {
  const t = useTheme();
  const [fill, ink] = { wash: [t['ember-wash'], t['ember-ink']], ember: [t.ember, t['on-ember']], success: [t['success-wash'], t['success-ink']], muted: [t.sunken, t['ink-soft']] }[tone];
  return <Oval width={size} fill={fill!}><Icon name={icon} size={Math.round(size * 0.45)} color={ink!} /></Oval>;
}

/** A short progress bar (tasks, limits, quota). */
export function Bar({ done, of, width = 90 }: { done: number; of: number; width?: number | `${number}%` }) {
  const t = useTheme();
  const pct = Math.round((Math.min(done, of) / Math.max(of, 1)) * 100);
  return (
    <View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: of, now: Math.min(done, of) }} style={{ width, height: 5, borderRadius: 3, backgroundColor: t.sunken, overflow: 'hidden' }}>
      <View style={{ width: `${pct}%`, height: '100%', borderRadius: 3, backgroundColor: t.ember }} />
    </View>
  );
}

/** Tasks with progress and what they pay: ways to earn today, bonus campaigns. */
export function TaskList({ tasks }: { tasks: Array<{ id: string; title: string; icon: string; done: number; of: number; points: number; completed: boolean }> }) {
  const t = useTheme();
  return (
    <View>
      {tasks.map((x) => (
        <View key={x.id} testID={`task-${x.id}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 58, paddingHorizontal: 14, paddingVertical: 8 }}>
          <IconOval icon={(x.completed ? 'check' : x.icon) as IconName} size={36} tone={x.completed ? 'ember' : 'wash'} />
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={{ fontSize: 14, fontWeight: '700', color: t.ink }}>{x.title}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><Bar done={x.done} of={x.of} /><Text style={{ fontSize: 12, color: t['ink-soft'] }}>{x.done} of {x.of}</Text></View>
          </View>
          <Text style={{ fontFamily: font.display, fontWeight: '800', fontSize: 13, color: x.completed ? t['success-ink'] : t['ember-ink'] }}>{x.completed ? 'Done' : `+${x.points}`}</Text>
        </View>
      ))}
    </View>
  );
}

/** The week of check-ins: done, today, still to come. */
export function CheckinWeek({ status }: { status: CheckinStatus }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }} accessibilityRole="list" accessibilityLabel="This week’s check-ins">
      {status.days.map((d) => {
        const done = d.state === 'done' || d.state === 'claimed';
        const today = d.state === 'today' || d.state === 'claimed';
        const [fill, ink] = d.state === 'today' ? [t.ember, '#ffffff'] : done ? [t['ember-wash'], t['ember-ink']] : [t.sunken, t['ink-soft']];
        return (
          <View key={d.day} style={{ alignItems: 'center', gap: 4 }} accessibilityLabel={`Day ${d.day}: +${d.points}${done ? ', claimed' : d.state === 'today' ? ', today' : ''}`}>
            <Oval width={40} fill={fill}>{done ? <Icon name="check" size={16} color={ink} /> : <Text style={{ fontFamily: font.display, fontWeight: '800', fontSize: 12, color: ink }}>+{d.points}</Text>}</Oval>
            <Text style={{ fontSize: 11, color: today ? t['ember-ink'] : t['ink-soft'], fontWeight: today ? '800' : '400' }}>{today ? 'Today' : `Day ${d.day}`}</Text>
          </View>
        );
      })}
    </View>
  );
}

/** A number with a label underneath (stats rows). */
export function Stat({ value, label, testID }: { value: string; label: string; testID?: string }) {
  const t = useTheme();
  return (
    <View style={{ flex: 1, padding: 12, borderRadius: 18, backgroundColor: t.raised, alignItems: 'center', gap: 2 }}>
      <Text testID={testID} style={{ fontFamily: font.display, fontWeight: '800', fontSize: 22, color: t.ink }}>{value}</Text>
      <Text style={{ fontSize: 12, color: t['ink-soft'], textAlign: 'center' }}>{label}</Text>
    </View>
  );
}

/** A tappable row: icon or logo, title and line, chevron. */
export function LinkRow({ left, title, sub, onPress, testID, right }: { left: React.ReactNode; title: string; sub?: string; onPress?: () => void; testID?: string; right?: React.ReactNode }) {
  const t = useTheme();
  return (
    <Pressable accessibilityRole={onPress ? 'button' : undefined} accessibilityLabel={title} disabled={!onPress} onPress={onPress} testID={testID}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 58, paddingHorizontal: 14, paddingVertical: 10, backgroundColor: pressed ? t.sunken : 'transparent' })}>
      {left}
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ fontSize: 14, fontWeight: '700', color: t.ink }}>{title}</Text>
        {sub ? <Text style={{ fontSize: 12, color: t['ink-soft'] }}>{sub}</Text> : null}
      </View>
      {right ?? (onPress ? <Icon name="chevron-right" size={16} color={t['ink-faint']} /> : null)}
    </Pressable>
  );
}

/** Opens an Indexx product's own site or app. */
export const openSite = (url: string) => void Linking.openURL(url).catch(() => undefined);

/**
 * Sign in to Indexx with the Indexx account's email and password. YaysApp's server keeps the Indexx login token
 * (not the password) and reads BTCY, EMMM, ShoperPal, Wall Street and the wallet with it.
 */
export function IndexxSignIn({ email, onDone, sub, ended, title = 'Sign in to Indexx' }: { email: string | null; onDone: (s: IndexxLink) => void; sub?: string; ended?: boolean; title?: string }) {
  const t = useTheme();
  const [e, setE] = useState(email ?? '');
  const [p, setP] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const go = async () => {
    setBusy(true); setError(null);
    try { const s = await (await api()).signInIndexx(e.trim(), p); setP(''); onDone(s); }
    catch (x) { setError(errText(x)); } finally { setBusy(false); }
  };
  return (
    <Card testID="indexx-sign-in">
      <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
        <Logo src={BRAND.indexx} size={52} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text accessibilityRole="header" style={{ fontFamily: font.display, fontWeight: '800', fontSize: 17, color: t.ink }}>{title}</Text>
          <Text style={{ fontSize: 13, lineHeight: 18, color: t['ink-soft'] }}>{sub ?? 'See your BTCY mining, EMMM positions, ShoperPal orders, Wall Street stocks and wallet here, and withdraw INEX to Indexx Exchange.'}</Text>
        </View>
      </View>
      {ended ? <ErrorBanner tone="warning">Your Indexx sign-in ended. Sign in again to see your products.</ErrorBanner> : null}
      <Field label="Indexx email" value={e} onChangeText={setE} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} autoComplete="email" textContentType="username" />
      <Field label="Indexx password" value={p} onChangeText={setP} secureTextEntry autoComplete="password" textContentType="password" error={error} onSubmitEditing={() => { if (e.trim() && p) void go(); }} />
      <View style={{ alignItems: 'center' }}><OvalButton icon="arrow-right" label="Sign in to Indexx" loading={busy} disabled={!e.trim() || !p} onPress={() => void go()} /></View>
      <Text style={{ fontSize: 12, lineHeight: 17, color: t['ink-soft'] }}>Use the account you use for BTCY and Indexx Exchange. YaysApp doesn’t keep your password. <Text style={{ color: t['ember-ink'], fontWeight: '700' }} onPress={() => openSite('https://indexx.ai')}>No Indexx account yet?</Text></Text>
    </Card>
  );
}

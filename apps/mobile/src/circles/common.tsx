import React, { type ReactNode } from 'react';
import { Image, Modal, Pressable, ScrollView, StyleSheet, View, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiError, CIRCLE_CATEGORY_LABEL, type CircleAuthor, type CircleCard, type CircleEventMini, type CircleView, type SchemeMatch } from '@yays/shared';
import { font, useTheme, type Theme } from '../lib/theme';
import { Icon, type IconName } from '../ui/Icon';
import { OvalButton } from '../ui/kit';
import { Oval } from '../ui/Oval';
import { Text } from '../ui/Text';

// ---------------------------------------------------------------------------------------------------------------
// Pieces shared by the Circles screens: the circle's mark, tags, notes, empty states, event dates, sheets.
// Same wording and rules as the web (apps/web/components/circles/common.tsx).
// ---------------------------------------------------------------------------------------------------------------
export const errText = (e: unknown, f = 'That did not work. Try again.') => (e instanceof ApiError ? e.message : f);
export const offline = (e: unknown) => e instanceof ApiError && e.status === 0;
export const plural = (n: number, w: string) => `${n.toLocaleString()} ${w}${n === 1 ? '' : 's'}`;
export const compact = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1).replace(/\.0$/, '')}k` : String(n));
export const isMember = (c: Pick<CircleView, 'access'>) => c.access === 'admin' || c.access === 'member';
export const categoryLabel = (c: CircleView | CircleCard) => CIRCLE_CATEGORY_LABEL[c.category];

const FILLS = ['#ff6a00', '#4f5fa8', '#b24a7a', '#7fcc1b', '#2f8f83', '#c7772a'];
const fillFor = (id: string) => FILLS[[...id].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7) % FILLS.length]!;
const COIN = require('../../assets/brand/btcy-coin.png');

/** The circle's picture, or its first letter on its own colour. Official BTCY circles get the coin. */
export function CircleMark({ c, size, onBanner }: { c: { id: string; name: string; photoUrl: string | null; official?: boolean }; size: number; onBanner?: boolean }) {
  const t = useTheme();
  if (c.photoUrl) return <Oval width={size} fill={t.sunken}><Image source={{ uri: c.photoUrl }} style={{ width: size * 0.82, height: size * 0.82, borderRadius: size }} /></Oval>;
  if (c.official && /bitcoin|btcy/i.test(c.name)) return <Oval width={size} fill={onBanner ? '#ffffff' : t.surface}><Image source={COIN} style={{ width: size * 0.62, height: size * 0.62 }} resizeMode="contain" /></Oval>;
  return <Oval width={size} fill={fillFor(c.id)}><Text style={{ fontFamily: font.display, fontWeight: '800', fontSize: Math.round(size * 0.38), color: '#ffffff' }}>{c.name.trim().charAt(0).toUpperCase() || 'C'}</Text></Oval>;
}

type TagKind = 'official' | 'public' | 'private' | 'warn' | 'danger' | 'muted' | 'ok';
const tagColors = (t: Theme, k: TagKind): [string, string] => (({
  official: [t['ember-wash'], t['ember-ink']], public: [t['success-wash'], t['success-ink']], ok: [t['success-wash'], t['success-ink']],
  private: [t.sunken, t['ink-soft']], muted: [t.sunken, t['ink-soft']], warn: [t['warning-wash'], t['warning-ink']], danger: [t['danger-wash'], t['danger-ink']],
}) as Record<TagKind, [string, string]>)[k];
export function Tag({ kind, icon, children }: { kind: TagKind; icon?: IconName; children: ReactNode }) {
  const t = useTheme();
  const [bg, ink] = tagColors(t, kind);
  return (
    <View style={[styles.tag, { backgroundColor: bg }]}>
      {icon ? <Icon name={icon} size={12} color={ink} /> : null}
      <Text style={{ fontFamily: font.display, fontWeight: '700', fontSize: 11, color: ink }}>{children}</Text>
    </View>
  );
}
export function CircleTags({ c, count = true, extra }: { c: Pick<CircleCard, 'official' | 'visibility' | 'memberCount' | 'lookalike'>; count?: boolean; extra?: string }) {
  const t = useTheme();
  return (
    <View style={styles.tags}>
      {c.official ? <Tag kind="official" icon="shield-check">Official</Tag> : null}
      {c.lookalike ? <Tag kind="danger" icon="alert-triangle">Not official</Tag> : null}
      {c.visibility === 'public' ? <Tag kind="public" icon="globe">Public</Tag> : <Tag kind="private" icon="lock">Private</Tag>}
      {count || extra ? <Text style={{ fontSize: 12, color: t['ink-soft'] }}>{[count ? `${compact(c.memberCount)} member${c.memberCount === 1 ? '' : 's'}` : '', extra ?? ''].filter(Boolean).join(' · ')}</Text> : null}
    </View>
  );
}
export function AuthorTag({ a }: { a: CircleAuthor }) {
  if (a.official) return <Tag kind="official" icon="shield-check">Official</Tag>;
  if (a.role === 'owner') return <Tag kind="official">Owner</Tag>;
  if (a.role === 'admin') return <Tag kind="official">Admin</Tag>;
  return null;
}

/** A block with an icon: notices, warnings, explanations. */
export function Note({ icon = 'info', tone = 'warning', children, testID }: { icon?: IconName; tone?: 'warning' | 'danger' | 'success' | 'plain'; children: ReactNode; testID?: string }) {
  const t = useTheme();
  const [bg, ink] = { warning: [t['warning-wash'], t['warning-ink']], danger: [t['danger-wash'], t['danger-ink']], success: [t['success-wash'], t['success-ink']], plain: [t.sunken, t['ink-soft']] }[tone];
  return (
    <View style={[styles.note, { backgroundColor: bg }]} testID={testID}>
      <Icon name={icon} size={16} color={ink!} />
      <Text style={{ flex: 1, fontSize: 13, lineHeight: 18, color: tone === 'plain' ? t['ink-soft'] : t.ink }}>{children}</Text>
    </View>
  );
}

/** Big centred empty or error state. */
export function State({ icon, title, children, actions, tone = 'ember', testID }: { icon: IconName; title: string; children?: ReactNode; actions?: ReactNode; tone?: 'ember' | 'plain' | 'danger' | 'success'; testID?: string }) {
  const t = useTheme();
  const [fill, ink] = { ember: [t['ember-wash'], t['ember-ink']], plain: [t.sunken, t['ink-soft']], danger: [t['danger-wash'], t['danger-ink']], success: [t['success-wash'], t['success-ink']] }[tone];
  return (
    <View style={styles.state} testID={testID}>
      <Oval width={84} fill={fill!}><Icon name={icon} size={34} color={ink!} /></Oval>
      <Text accessibilityRole="header" style={{ fontFamily: font.display, fontWeight: '800', fontSize: 20, lineHeight: 26, color: t.ink, textAlign: 'center' }}>{title}</Text>
      {children ? <Text style={{ fontSize: 14, lineHeight: 21, color: t['ink-soft'], textAlign: 'center' }}>{children}</Text> : null}
      {actions ? <View style={{ flexDirection: 'row', gap: 26, marginTop: 6, justifyContent: 'center' }}>{actions}</View> : null}
    </View>
  );
}

/** A raised card, with an optional small heading. */
export function Card({ title, children, pad = true, style, testID, right }: { title?: string; children: ReactNode; pad?: boolean; style?: ViewStyle; testID?: string; right?: ReactNode }) {
  const t = useTheme();
  return (
    <View style={[styles.card, { backgroundColor: t.raised }, pad && { padding: 14, gap: 10 }, style]} testID={testID}>
      {title ? <View style={[styles.cardHead, !pad && { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 2 }]}><Text accessibilityRole="header" style={[styles.cardTitle, { color: t['ink-soft'] }]}>{title}</Text>{right}</View> : null}
      {children}
    </View>
  );
}

/** A choice chip (categories, who can join, where an event is). */
export function Chip({ label, on, onPress, icon }: { label: string; on: boolean; onPress: () => void; icon?: IconName }) {
  const t = useTheme();
  return (
    <Pressable accessibilityRole="radio" accessibilityState={{ checked: on }} accessibilityLabel={label} onPress={onPress} style={[styles.chip, { backgroundColor: on ? t.ember : t.raised }]}>
      {icon ? <Icon name={icon} size={14} color={on ? '#ffffff' : t['ink-soft']} /> : null}
      <Text style={{ fontFamily: font.display, fontWeight: '700', fontSize: 13, color: on ? '#ffffff' : t['ink-soft'] }}>{label}</Text>
    </Pressable>
  );
}

/** A screen's top: back on the left, the title, things on the right. */
export function Header({ back, onBack, title, right }: { back: string; onBack: () => void; title?: string; right?: ReactNode }) {
  const t = useTheme();
  return (
    <View style={styles.header}>
      <OvalButton icon="arrow-left" label={back} size="sm" variant="secondary" onPress={onBack} />
      <Text accessibilityRole="header" style={{ flex: 1, fontFamily: font.display, fontWeight: '800', fontSize: 22, color: t.ink, marginBottom: 20 }} numberOfLines={1}>{title ?? ''}</Text>
      {right}
    </View>
  );
}

/** The ember banner at the top of a circle and an event. */
export function Banner({ height = 120, children }: { height?: number; children?: ReactNode }) {
  const t = useTheme();
  return (
    <View style={{ height, backgroundColor: t.ember, overflow: 'hidden' }}>
      <View style={{ position: 'absolute', width: 260, height: 240, borderRadius: 200, top: -110, right: -60, backgroundColor: t['ember-light'], opacity: 0.45 }} />
      <View style={{ position: 'absolute', width: 300, height: 300, borderRadius: 300, bottom: -200, left: -80, backgroundColor: t['ember-deep'], opacity: 0.55 }} />
      {children}
    </View>
  );
}

/** A sheet from the bottom of the screen: menus, reports, confirmations. */
export function Sheet({ title, lead, onClose, children, testID }: { title: string; lead?: string; onClose: () => void; children: ReactNode; testID?: string }) {
  const t = useTheme();
  return (
    <Modal transparent visible animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <Pressable accessibilityLabel="Close" style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' }} onPress={onClose} />
      <SafeAreaView edges={['bottom']} style={{ backgroundColor: t.ground, borderTopLeftRadius: 28, borderTopRightRadius: 28, maxHeight: '88%' }} testID={testID}>
        <ScrollView contentContainerStyle={{ padding: 20, gap: 14 }} keyboardShouldPersistTaps="handled">
          <Text accessibilityRole="header" style={{ fontFamily: font.display, fontWeight: '800', fontSize: 20, color: t.ink }}>{title}</Text>
          {lead ? <Text style={{ color: t['ink-soft'], fontSize: 14, lineHeight: 20 }}>{lead}</Text> : null}
          {children}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}
/** One row in a sheet's menu. */
export function MenuRow({ icon, label, onPress, danger }: { icon: IconName; label: string; onPress: () => void; danger?: boolean }) {
  const t = useTheme();
  return (
    <Pressable accessibilityRole="menuitem" accessibilityLabel={label} onPress={onPress} style={({ pressed }) => [styles.menuRow, { backgroundColor: pressed ? t.sunken : 'transparent' }]}>
      <Oval width={36} fill={danger ? t['danger-wash'] : t['ember-wash']}><Icon name={icon} size={16} color={danger ? t['danger-ink'] : t['ember-ink']} /></Oval>
      <Text style={{ fontSize: 15, fontWeight: '700', color: danger ? t['danger-ink'] : t.ink }}>{label}</Text>
    </Pressable>
  );
}

/* ---- dates: events show in their own time zone ---- */
const fmt = (iso: string, tz: string, o: Intl.DateTimeFormatOptions) => { try { return new Intl.DateTimeFormat('en-GB', { timeZone: tz, ...o }).format(new Date(iso)); } catch { return new Intl.DateTimeFormat('en-GB', o).format(new Date(iso)); } };
export const monthOf = (iso: string, tz: string) => fmt(iso, tz, { month: 'short' });
export const dayOf = (iso: string, tz: string) => fmt(iso, tz, { day: 'numeric' });
export const timeOf = (iso: string, tz: string) => fmt(iso, tz, { hour: 'numeric', minute: '2-digit', hour12: true }).replace(/\s/g, ' ').toLowerCase();
export const tzName = (iso: string, tz: string) => { try { return new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'short' }).formatToParts(new Date(iso)).find((p) => p.type === 'timeZoneName')?.value ?? tz; } catch { return tz; } };
export const longDay = (iso: string, tz: string) => fmt(iso, tz, { weekday: 'long', day: 'numeric', month: 'long' });
export const shortDay = (iso: string, tz: string) => fmt(iso, tz, { weekday: 'short', day: 'numeric', month: 'short' });
export const span = (a: string, b: string, tz: string) => `${timeOf(a, tz)}–${timeOf(b, tz)}`;
export const ago = (iso: string) => {
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return 'Just now';
  if (s < 3600) return `${Math.floor(s / 60)} min`;
  if (s < 86400) return `${Math.floor(s / 3600)} h`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)} d`;
  return new Date(iso).toLocaleDateString([], { day: 'numeric', month: 'short' });
};
export const dateShort = (iso: string) => new Date(iso).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });

export function DateBlock({ iso, tz, big }: { iso: string; tz: string; big?: boolean }) {
  const t = useTheme();
  return (
    <View style={[styles.date, { backgroundColor: t['ember-wash'] }, big && { width: 60, height: 64 }]} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      <Text style={{ fontFamily: font.display, fontWeight: '700', fontSize: 11, color: t['ember-ink'], textTransform: 'uppercase', letterSpacing: 0.6 }}>{monthOf(iso, tz)}</Text>
      <Text style={{ fontFamily: font.display, fontWeight: '800', fontSize: big ? 24 : 20, color: t['ember-ink'] }}>{dayOf(iso, tz)}</Text>
    </View>
  );
}

/** An upcoming event in a list ("Coming up"). */
export function EventMiniRow({ e, onPress }: { e: CircleEventMini; onPress: () => void }) {
  const t = useTheme();
  const going = e.myRsvp === 'going' ? `You’re going · ${e.going} going` : e.myRsvp === 'waitlist' ? 'You’re on the waitlist' : e.myRsvp === 'offered' ? 'A seat is waiting for you' : `${e.going} going`;
  const where = e.mode === 'online' ? 'Online' : e.place.split(',').slice(-1)[0]?.trim() || e.place;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${e.title}, ${shortDay(e.startsAt, e.timeZone)}`} testID="event-mini" onPress={onPress} style={({ pressed }) => [styles.row, { backgroundColor: pressed ? t.sunken : 'transparent' }]}>
      <DateBlock iso={e.startsAt} tz={e.timeZone} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ fontSize: 14, fontWeight: '700', color: t.ink }} numberOfLines={1}>{e.title}</Text>
        <Text style={{ fontSize: 12, color: t['ink-soft'] }} numberOfLines={1}>{where} · {timeOf(e.startsAt, e.timeZone)} {tzName(e.startsAt, e.timeZone)}</Text>
        <Text style={{ fontSize: 12, fontWeight: '700', color: e.cancelled ? t['danger-ink'] : t['ember-ink'] }}>{e.cancelled ? 'Cancelled' : going}</Text>
      </View>
      <Icon name="chevron-right" size={16} color={t['ink-faint']} />
    </Pressable>
  );
}

/** Text with the money-scheme parts marked. */
export function Marked({ text, marks }: { text: string; marks: SchemeMatch[] }) {
  const t = useTheme();
  const out: ReactNode[] = [];
  let at = 0;
  marks.forEach((m, i) => { if (m.start > at) out.push(text.slice(at, m.start)); out.push(<Text key={i} style={{ backgroundColor: t['danger-wash'], color: t['danger-ink'], fontWeight: '700' }}>{text.slice(m.start, m.end)}</Text>); at = m.end; });
  out.push(text.slice(at));
  return <Text style={{ fontSize: 15, lineHeight: 22, color: t.ink }}>{out}</Text>;
}

export const styles = StyleSheet.create({
  tag: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  note: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', paddingHorizontal: 12, paddingVertical: 10, borderRadius: 16 },
  state: { alignItems: 'center', gap: 12, paddingVertical: 28, paddingHorizontal: 16 },
  card: { borderRadius: 22, overflow: 'hidden' },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardTitle: { fontFamily: font.display, fontWeight: '700', fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.6 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 34, paddingHorizontal: 13, borderRadius: 999 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4 },
  menuRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, paddingHorizontal: 6, borderRadius: 14 },
  date: { width: 52, height: 56, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 12 },
  body: { fontSize: 14, lineHeight: 21 },
});

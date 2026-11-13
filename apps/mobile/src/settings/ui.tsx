import React, { useEffect, useRef, useState, type ReactNode } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiError, type SocialLink } from '@yays/shared';
import { font, useTheme } from '../lib/theme';
import { Icon, type IconName } from '../ui/Icon';
import { LineArt, type ArtName } from '../ui/LineArt';
import { Oval } from '../ui/Oval';
import { Banner } from '../ui/kit';
import { Text } from '../ui/Text';
import { Header } from '../circles/common';

export const errText = (e: unknown, f = 'Could not save. Try again.') => (e instanceof ApiError ? e.message : f);

/** A settings section: back to Me, the title, its line art, and the content. */
export function SettingsPage({ title, back = 'Me', onBack, art, testID, children }: { title: string; back?: string; onBack: () => void; art: ArtName; testID?: string; children: ReactNode }) {
  const t = useTheme();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.surface }} testID={testID} edges={['top', 'left', 'right']}>
      <LineArt name={art} height={260} style={{ right: -30, top: 40 }} />
      <Header back={back} onBack={onBack} title={title} />
      <ScrollView contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 40, gap: 12 }} keyboardShouldPersistTaps="handled">{children}</ScrollView>
    </SafeAreaView>
  );
}

/** A card of rows with a small heading. */
export function Group({ title, children, testID }: { title?: string; children: ReactNode; testID?: string }) {
  const t = useTheme();
  return (
    <View style={[s.card, { backgroundColor: t.raised }]} testID={testID}>
      {title ? <Text accessibilityRole="header" style={[s.cardTitle, { color: t['ink-soft'] }]}>{title}</Text> : null}
      {children}
    </View>
  );
}

export function SwitchRow({ label, hint, on, onChange, disabled }: { label: string; hint?: string; on: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  const t = useTheme();
  return (
    <View style={[s.row, { opacity: disabled ? 0.5 : 1 }]}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ fontWeight: '700', fontSize: 15, color: t.ink }}>{label}</Text>
        {hint ? <Text style={{ fontSize: 13, lineHeight: 18, color: t['ink-soft'] }}>{hint}</Text> : null}
      </View>
      <Switch accessibilityLabel={label} value={on} disabled={disabled} onValueChange={onChange} trackColor={{ true: t.ember, false: t.sunken }} thumbColor="#ffffff" />
    </View>
  );
}

/** One of a few choices, as pills (who can see, theme…). */
export function Choice<T extends string>({ label, hint, value, options, onChange }: { label?: string; hint?: string; value: T; options: Array<[T, string]>; onChange: (v: T) => void }) {
  const t = useTheme();
  return (
    <View style={[s.row, { flexDirection: 'column', alignItems: 'stretch', gap: 8 }]}>
      {label ? <Text style={{ fontWeight: '700', fontSize: 15, color: t.ink }}>{label}</Text> : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }} accessibilityRole="radiogroup" accessibilityLabel={label}>
        {options.map(([v, l]) => {
          const on = v === value;
          return (
            <Pressable key={v} accessibilityRole="radio" accessibilityState={{ checked: on }} accessibilityLabel={l} onPress={() => onChange(v)}
              style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: on ? t.ember : t.sunken }}>
              <Text style={{ fontFamily: font.display, fontWeight: '700', fontSize: 13, color: on ? '#ffffff' : t['ink-soft'] }}>{l}</Text>
            </Pressable>
          );
        })}
      </View>
      {hint ? <Text style={{ fontSize: 13, lineHeight: 18, color: t['ink-soft'] }}>{hint}</Text> : null}
    </View>
  );
}

/** A row with a label, a value and buttons on the right. */
export function ValueRow({ label, hint, value, children, testID }: { label: string; hint?: string; value?: string; children?: ReactNode; testID?: string }) {
  const t = useTheme();
  return (
    <View style={s.row} testID={testID}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ fontWeight: '700', fontSize: 15, color: t.ink }}>{label}</Text>
        {value ? <Text style={{ fontSize: 14, color: t.ink }} numberOfLines={1}>{value}</Text> : null}
        {hint ? <Text style={{ fontSize: 13, lineHeight: 18, color: t['ink-soft'] }}>{hint}</Text> : null}
      </View>
      {children ? <View style={{ flexDirection: 'row', gap: 14 }}>{children}</View> : null}
    </View>
  );
}

/** A row that opens something (the Me list, a chat). */
export function NavRow({ icon, label, sub, onPress, danger, testID, right }: { icon: IconName; label: string; sub?: string; onPress: () => void; danger?: boolean; testID?: string; right?: ReactNode }) {
  const t = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} testID={testID}
      style={({ pressed }) => [s.navRow, { backgroundColor: pressed ? t.sunken : 'transparent' }]}>
      <Oval width={40} fill={danger ? t['danger-wash'] : t['ember-wash']}><Icon name={icon} size={18} color={danger ? t['danger-ink'] : t['ember-ink']} /></Oval>
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 15, fontWeight: '700', color: danger ? t['danger-ink'] : t.ink }} numberOfLines={1}>{label}</Text>
        {sub ? <Text style={{ fontSize: 13, color: t['ink-soft'] }} numberOfLines={1}>{sub}</Text> : null}
      </View>
      {right ?? (!danger ? <Icon name="chevron-right" size={18} color={t['ink-faint']} /> : null)}
    </Pressable>
  );
}

/** "Saved" / an error at the top of a section; a success fades after a few seconds. */
export function useSaved() {
  const [m, setM] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const show = (tone: 'success' | 'danger', text: string) => {
    if (timer.current) clearTimeout(timer.current);
    setM({ tone, text });
    if (tone === 'success') timer.current = setTimeout(() => setM(null), 4000);
  };
  return {
    banner: m ? <Banner tone={m.tone}>{m.text}</Banner> : null,
    ok: (text = 'Saved.') => show('success', text),
    fail: (text: string) => show('danger', text),
    clear: () => setM(null),
  };
}

/* ---- socials ---- */
/** X and TikTok are near-black: on the dark theme they get a lifted fill so the mark still reads. */
export const socialFill = (fill: string, scheme: 'light' | 'dark') => (scheme === 'dark' && fill === '#1f1a16' ? '#4a423b' : fill);
export const SOCIAL: Record<SocialLink['network'], { name: string; icon: IconName; fill: string }> = {
  facebook: { name: 'Facebook', icon: 'facebook', fill: '#1877f2' },
  x: { name: 'X', icon: 'x', fill: '#1f1a16' }, instagram: { name: 'Instagram', icon: 'instagram', fill: '#b24a7a' }, tiktok: { name: 'TikTok', icon: 'tiktok', fill: '#1f1a16' },
  youtube: { name: 'YouTube', icon: 'youtube', fill: '#c85a45' }, linkedin: { name: 'LinkedIn', icon: 'linkedin', fill: '#2f5f9e' }, telegram: { name: 'Telegram', icon: 'telegram', fill: '#2f7fb8' },
};

/** Someone's socials (p33, p34): network, username, a tick when it was confirmed through that network. Tap to open. */
export function SocialChips({ links }: { links: SocialLink[] }) {
  const t = useTheme();
  return (
    <View style={{ gap: 8 }} testID="social-chips">
      {links.map((l) => {
        const n = SOCIAL[l.network];
        const label = `${n.name}: ${l.handle}${l.verified ? ', verified' : ''}`;
        return (
          <Pressable key={l.network} accessibilityRole={l.url ? 'link' : undefined} accessibilityLabel={label} disabled={!l.url} onPress={() => { if (l.url) void Linking.openURL(l.url).catch(() => undefined); }}
            style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10, borderRadius: 18, backgroundColor: pressed ? t.sunken : t.surface }]}>
            <View>
              <Oval width={36} fill={socialFill(n.fill, t.scheme)}><Icon name={n.icon} size={16} color="#ffffff" /></Oval>
              {l.verified ? <View style={{ position: 'absolute', right: -3, bottom: -3, width: 16, height: 16, borderRadius: 8, backgroundColor: t.success, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: t.surface }}><Icon name="check" size={9} color="#ffffff" strokeWidth={3} /></View> : null}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontWeight: '800', color: t.ink }}>{n.name}</Text>
              <Text style={{ fontSize: 13, color: t['ink-soft'] }} numberOfLines={1}>{l.handle}{l.verified ? ' · verified' : ''}</Text>
            </View>
            {l.url ? <Icon name="external" size={14} color={t['ink-soft']} /> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  card: { borderRadius: 24, paddingVertical: 6, overflow: 'hidden' },
  cardTitle: { fontFamily: font.display, fontWeight: '800', fontSize: 13, letterSpacing: 0.4, textTransform: 'uppercase', paddingHorizontal: 16, paddingTop: 10, paddingBottom: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12 },
  navRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 12 },
});

import React, { type ReactNode } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';
import { font, useTheme, type Theme } from '../lib/theme';
import { Icon, type IconName } from './Icon';
import { Oval } from './Oval';

const SIZES = { sm: { w: 32, icon: 16 }, md: { w: 40, icon: 20 }, lg: { w: 54, icon: 24 }, xl: { w: 64, icon: 28 } } as const;
type Variant = 'primary' | 'soft' | 'secondary' | 'ghost' | 'danger';
const look = (t: Theme, v: Variant) => ({
  primary: { fill: t.ember, ink: t['on-ember'], label: t['ember-ink'] },
  soft: { fill: t['ember-wash'], ink: t['ember-ink'], label: t.ink },
  secondary: { fill: t.surface, ink: t.ink, label: t.ink },
  ghost: { fill: t.sunken, ink: t['ink-soft'], label: t.ink },
  danger: { fill: t.danger, ink: t['on-status'], label: t['danger-ink'] },
})[v];

/** The only button in YaysApp: icon in the brand oval, label underneath. */
export function OvalButton({ icon, label, onPress, size = 'md', variant = 'primary', loading, disabled, testID }:
  { icon: IconName; label: string; onPress?: () => void; size?: keyof typeof SIZES; variant?: Variant; loading?: boolean; disabled?: boolean; testID?: string }) {
  const t = useTheme();
  const s = SIZES[size], c = look(t, variant);
  const off = disabled || loading;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: !!off, busy: !!loading }} onPress={off ? undefined : onPress} testID={testID}
      style={({ pressed }) => [styles.btn, { opacity: off ? 0.45 : 1, transform: [{ scale: pressed ? 0.94 : 1 }] }]} hitSlop={8}>
      <Oval width={s.w} fill={c.fill}>{loading ? <ActivityIndicator color={c.ink} size="small" /> : <Icon name={icon} size={s.icon} color={c.ink} />}</Oval>
      <Text style={[styles.btnLabel, { color: c.label, fontSize: size === 'lg' || size === 'xl' ? 14 : 13 }]} numberOfLines={2}>{label}</Text>
    </Pressable>
  );
}

const initials = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join('') || '?';
export function Avatar({ name, photoUrl, size = 44 }: { name: string; photoUrl?: string | null; size?: number }) {
  const t = useTheme();
  return (
    <Oval width={size} fill={t['ember-wash']}>
      {photoUrl ? <Image source={{ uri: photoUrl }} style={{ width: size * 0.8, height: size * 0.8, borderRadius: size }} accessibilityIgnoresInvertColors />
        : <Text style={{ fontFamily: font.display, fontWeight: '800', fontSize: size * 0.36, color: t['ember-ink'] }}>{initials(name)}</Text>}
    </Oval>
  );
}

export function Field({ label, hint, error, prefix, ...input }: { label: string; hint?: string | null; error?: string | null; prefix?: string } & TextInputProps) {
  const t = useTheme();
  return (
    <View style={{ gap: 6 }}>
      <Text style={[styles.fieldLabel, { color: t.ink }]}>{label}</Text>
      <View style={[styles.box, { backgroundColor: t.raised, borderColor: error ? t['danger-ink'] : t['line-strong'] }]}>
        {prefix ? <Text style={{ color: t['ink-soft'], fontWeight: '700', fontSize: 15 }}>{prefix}</Text> : null}
        <TextInput accessibilityLabel={label} placeholderTextColor={t['ink-faint']} style={[styles.input, { color: t.ink }]} {...input} />
      </View>
      {error || hint ? <Text accessibilityRole={error ? 'alert' : undefined} style={{ fontSize: 13, lineHeight: 18, color: error ? t['danger-ink'] : t['ink-soft'], fontWeight: error ? '600' : '400' }}>{error || hint}</Text> : null}
    </View>
  );
}

export function Banner({ tone = 'danger', children }: { tone?: 'danger' | 'success' | 'warning'; children: ReactNode }) {
  const t = useTheme();
  const c = { danger: [t['danger-wash'], t['danger-ink']], success: [t['success-wash'], t['success-ink']], warning: [t['warning-wash'], t['warning-ink']] }[tone];
  return (
    <View accessibilityRole="alert" style={[styles.banner, { backgroundColor: c[0] }]}>
      <Icon name={tone === 'success' ? 'check' : 'alert-triangle'} size={18} color={c[1]!} />
      <Text style={{ flex: 1, color: c[1], fontSize: 14, lineHeight: 20 }}>{children}</Text>
    </View>
  );
}

export function TextLink({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  const t = useTheme();
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: !!disabled }} onPress={disabled ? undefined : onPress} hitSlop={10}>
    <Text style={{ fontFamily: font.display, fontWeight: '700', fontSize: 14, color: disabled ? t['ink-faint'] : t['ember-ink'] }}>{label}</Text>
  </Pressable>;
}

const styles = StyleSheet.create({
  btn: { alignItems: 'center', gap: 8, minWidth: 64 },
  btnLabel: { fontFamily: font.display, fontWeight: '700', textAlign: 'center', maxWidth: 110 },
  fieldLabel: { fontFamily: font.display, fontSize: 14, fontWeight: '700' },
  box: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 48, paddingHorizontal: 14, borderWidth: 1, borderRadius: 16 },
  input: { flex: 1, fontSize: 16, paddingVertical: 10 },
  banner: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', padding: 12, borderRadius: 16 },
});

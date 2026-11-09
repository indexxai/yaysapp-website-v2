import React, { type ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '../ui/Text';
import { SafeAreaView } from 'react-native-safe-area-context';
import { font, useTheme } from '../lib/theme';

export function Screen({ title, lead, children, background = 'ground', header }: { title?: string; lead?: ReactNode; children: ReactNode; background?: 'ground' | 'surface'; header?: ReactNode }) {
  const t = useTheme();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t[background] }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          {header}
          {title ? <Text accessibilityRole="header" style={[styles.title, { color: t.ink }]}>{title}</Text> : null}
          {lead ? <Text style={[styles.lead, { color: t['ink-soft'] }]}>{lead}</Text> : null}
          <View style={{ gap: 20 }}>{children}</View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  body: { padding: 24, gap: 12, flexGrow: 1 },
  title: { fontFamily: font.display, fontSize: 30, lineHeight: 36, fontWeight: '800', letterSpacing: -0.5 },
  lead: { fontSize: 15, lineHeight: 22, marginBottom: 8 },
});

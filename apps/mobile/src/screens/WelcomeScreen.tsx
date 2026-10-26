import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { font, useTheme } from '../lib/theme';
import { OvalButton } from '../ui/kit';
import { Oval } from '../ui/Oval';

export function WelcomeScreen({ onStart }: { onStart: () => void }) {
  const t = useTheme();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.ember }}>
      <View style={styles.art} accessible={false}>
        <Oval width={300} fill="rgba(255,255,255,0.18)" style={{ position: 'absolute', top: -80, right: -90 }} />
        <Oval width={180} fill="rgba(255,255,255,0.14)" style={{ position: 'absolute', bottom: 40, left: -60 }} />
        <Oval width={96} fill="#ffffff"><Text style={{ fontFamily: font.display, fontWeight: '800', fontSize: 34, color: t['ember-ink'] }}>Y</Text></Oval>
      </View>
      <View style={[styles.card, { backgroundColor: t.ground }]}>
        <Text accessibilityRole="header" style={[styles.h1, { color: t.ink }]}>Chat. Earn. Together.</Text>
        <Text style={[styles.lead, { color: t['ink-soft'] }]}>Messages, calls and communities. Used YaysApp before? Your chats come with you.</Text>
        <View style={{ alignItems: 'center', marginTop: 8 }}><OvalButton icon="arrow-right" label="Get started" size="xl" onPress={onStart} testID="get-started" /></View>
      </View>
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  art: { flex: 1, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  card: { padding: 28, gap: 12, borderTopLeftRadius: 32, borderTopRightRadius: 32 },
  h1: { fontFamily: font.display, fontSize: 32, lineHeight: 38, fontWeight: '800' },
  lead: { fontSize: 16, lineHeight: 24 },
});

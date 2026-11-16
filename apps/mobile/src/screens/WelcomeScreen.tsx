import React from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { Text } from '../ui/Text';
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
        {/* The same art as the web home page's hero. */}
        <Image source={require('../../assets/brand/hero-cards.png')} style={styles.hero} resizeMode="contain"
          accessibilityLabel="Three YaysApp phone screens fanned out, with a character playing bass jumping out of the front one" testID="welcome-art" />
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
  art: { flex: 1, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', padding: 16 },
  hero: { width: '100%', height: '100%', maxWidth: 440, aspectRatio: 900 / 881 },
  card: { padding: 28, gap: 12, borderTopLeftRadius: 32, borderTopRightRadius: 32 },
  h1: { fontFamily: font.display, fontSize: 32, lineHeight: 38, fontWeight: '800' },
  lead: { fontSize: 16, lineHeight: 24 },
});

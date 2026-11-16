import React from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { Text } from '../ui/Text';
import { SafeAreaView } from 'react-native-safe-area-context';
import { font, useTheme } from '../lib/theme';
import { OvalButton } from '../ui/kit';
import { Oval } from '../ui/Oval';

const ART = require('../../assets/brand/hero-cards.png');
const DOODLES = require('../../assets/brand/hero-doodles.png');
const WORDMARK = { light: require('../../assets/brand/wordmark.png'), dark: require('../../assets/brand/wordmark-dark.png') };

/**
 * The first screen, laid out like the web home page's hero: the logo, the phone-cards art standing on a soft oval
 * with the faded doodles behind it, then the promise and Get started.
 */
export function WelcomeScreen({ onStart }: { onStart: () => void }) {
  const t = useTheme();
  return (
    <SafeAreaView style={[styles.page, { backgroundColor: t.ground }]}>
      <View style={styles.top}>
        <Image source={WORDMARK[t.scheme]} style={styles.wordmark} resizeMode="contain" accessibilityLabel="YaysApp" />
      </View>

      <View style={styles.stage} accessible={false}>
        <Image source={DOODLES} style={[styles.doodles, { tintColor: t.ember, opacity: t.scheme === 'dark' ? 0.22 : 0.16 }]} resizeMode="contain" />
        {/* A soft oval behind the cards, so the art sits on the page instead of floating. */}
        <Oval width={320} fill={t.scheme === 'dark' ? 'rgba(232,105,44,0.14)' : t['ember-wash']} style={styles.oval} />
        <Image source={ART} style={styles.art} resizeMode="contain" testID="welcome-art"
          accessibilityLabel="Three YaysApp phone screens fanned out, with a character playing bass jumping out of the front one" />
      </View>

      <View style={styles.copy}>
        <Text accessibilityRole="header" style={[styles.h1, { color: t.ink }]}>Chat. Earn. Together.</Text>
        <Text style={[styles.lead, { color: t['ink-soft'] }]}>Messages, calls and communities. Used YaysApp before? Your chats come with you.</Text>
        <View style={styles.cta}><OvalButton icon="arrow-right" label="Get started" size="xl" onPress={onStart} testID="get-started" /></View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  top: { alignItems: 'center', paddingTop: 8, paddingBottom: 4 },
  wordmark: { width: 132, height: 36 },
  stage: { flex: 1, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  doodles: { position: 'absolute', width: '115%', height: '115%' },
  oval: { position: 'absolute', marginTop: 36 },
  art: { width: '92%', height: '92%', maxWidth: 420, aspectRatio: 900 / 881 },
  copy: { paddingHorizontal: 28, paddingTop: 4, paddingBottom: 20, gap: 10 },
  h1: { fontFamily: font.display, fontSize: 32, lineHeight: 38, fontWeight: '800' },
  lead: { fontSize: 16, lineHeight: 24 },
  cta: { alignItems: 'center', marginTop: 10 },
});

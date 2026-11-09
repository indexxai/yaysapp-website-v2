import React from 'react';
import { Image, StyleSheet, View, type ImageStyle, type StyleProp } from 'react-native';
import { useTheme } from '../lib/theme';

/** The hand-drawn background art, the same pictures as the web (assets/lineart), tinted in the brand colour. */
const ART = {
  chat: { src: require('../../assets/lineart/chat.webp'), ratio: 792 / 1200 },
  gear: { src: require('../../assets/lineart/gear.webp'), ratio: 1200 / 1016 },
  hype: { src: require('../../assets/lineart/hype.webp'), ratio: 1005 / 785 },
  reader: { src: require('../../assets/lineart/reader.webp'), ratio: 826 / 1200 },
  selfie: { src: require('../../assets/lineart/selfie.webp'), ratio: 971 / 1200 },
  snap: { src: require('../../assets/lineart/snap.webp'), ratio: 1200 / 1072 },
  explorer: { src: require('../../assets/lineart/explorer.webp'), ratio: 612 / 1200 },
  coins: { src: require('../../assets/lineart/coins.webp'), ratio: 1012 / 1200 },
  wallet: { src: require('../../assets/lineart/wallet.webp'), ratio: 663 / 1200 },
  lantern: { src: require('../../assets/lineart/lantern.webp'), ratio: 506 / 835 },
  skater: { src: require('../../assets/lineart/skater.webp'), ratio: 555 / 1200 },
  trader: { src: require('../../assets/lineart/trader.webp'), ratio: 837 / 1200 },
  morning: { src: require('../../assets/lineart/morning.webp'), ratio: 717 / 1200 },
} as const;
export type ArtName = keyof typeof ART;
export const ART_NAMES = Object.keys(ART) as ArtName[];

/**
 * Behind the content, never in front: put it first in its container. Same opacity as the web (about 0.2).
 * Defaults to the bottom right corner, partly off screen, like the designs.
 */
export function LineArt({ name, height = 300, opacity = 0.2, ink, style }: { name: ArtName; height?: number; opacity?: number; ink?: string; style?: StyleProp<ImageStyle> }) {
  const t = useTheme();
  const a = ART[name];
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill} accessible={false} importantForAccessibility="no-hide-descendants">
      <Image source={a.src} resizeMode="contain"
        style={[{ position: 'absolute', right: -30, bottom: 90, height, width: height * a.ratio, opacity, tintColor: ink ?? t.ember }, style]} />
    </View>
  );
}

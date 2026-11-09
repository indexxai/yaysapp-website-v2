import React, { forwardRef } from 'react';
import { StyleSheet, Text as RNText, TextInput as RNTextInput, type TextInputProps, type TextProps, type TextStyle } from 'react-native';

/**
 * Outfit (headings) and Nunito Sans (everything else), one font file per weight: assets/fonts, added to the iOS and
 * Android projects by `npx react-native-asset`. iOS and Android choose weights of added fonts differently, so a style's
 * fontWeight is turned into the exact file here (fontFamily 'Outfit' + fontWeight '800' → 'Outfit-ExtraBold').
 */
const WEIGHT: Record<string, string> = { '100': 'Regular', '200': 'Regular', '300': 'Regular', '400': 'Regular', normal: 'Regular', '500': 'Medium', '600': 'SemiBold', '700': 'Bold', bold: 'Bold', '800': 'ExtraBold', '900': 'ExtraBold' };
export const DISPLAY = 'Outfit';
export const BODY = 'NunitoSans';

export function fontStyle(style: TextStyle | undefined): TextStyle {
  const family = style?.fontFamily;
  if (family && family !== DISPLAY && family !== BODY) return {}; // a font set on purpose (e.g. monospace)
  return { fontFamily: `${family ?? BODY}-${WEIGHT[String(style?.fontWeight ?? '400')] ?? 'Regular'}`, fontWeight: 'normal' };
}

/** Use instead of react-native's Text: the YaysApp fonts at the right weight. */
export const Text = forwardRef<RNText, TextProps>(function Text({ style, ...p }, ref) {
  const flat = StyleSheet.flatten(style) as TextStyle | undefined;
  return <RNText ref={ref} {...p} style={[flat, fontStyle(flat)]} />;
});

/** Use instead of react-native's TextInput. */
export const TextInput = forwardRef<RNTextInput, TextInputProps>(function TextInput({ style, ...p }, ref) {
  const flat = StyleSheet.flatten(style) as TextStyle | undefined;
  return <RNTextInput ref={ref} {...p} style={[flat, fontStyle(flat)]} />;
});

import React, { type ReactNode } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import Svg, { Ellipse } from 'react-native-svg';
import { OVAL_ASPECT } from '../lib/theme';

/** The brand oval: one ellipse tilted -38.3°, scaled to `width`, never stretched. */
export function Oval({ width, fill, children, style, testID }: { width: number; fill: string; children?: ReactNode; style?: ViewStyle; testID?: string }) {
  const height = width / OVAL_ASPECT;
  return (
    <View style={[{ width, height, alignItems: 'center', justifyContent: 'center' }, style]} testID={testID}>
      <Svg width={width} height={height} viewBox="0 0 1133 1052" style={StyleSheet.absoluteFill}>
        <Ellipse cx={566.5} cy={526} rx={627} ry={450} transform="rotate(-38.3 566.5 526)" fill={fill} />
      </Svg>
      {children}
    </View>
  );
}

import React, { useId, type ReactNode } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import Svg, { ClipPath, Defs, Ellipse, Image as SvgImage } from 'react-native-svg';
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

/** A photo cut to the oval itself (filling it edge to edge), for profile pictures. */
export function OvalPhoto({ width, uri, fill }: { width: number; uri: string; fill: string }) {
  const height = width / OVAL_ASPECT;
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  return (
    <View style={{ width, height }} accessible accessibilityRole="image" accessibilityIgnoresInvertColors>
      <Svg width={width} height={height} viewBox="0 0 1133 1052">
        <Defs><ClipPath id={`o${id}`}><Ellipse cx={566.5} cy={526} rx={627} ry={450} transform="rotate(-38.3 566.5 526)" /></ClipPath></Defs>
        <Ellipse cx={566.5} cy={526} rx={627} ry={450} transform="rotate(-38.3 566.5 526)" fill={fill} />
        <SvgImage href={{ uri }} x={0} y={0} width={1133} height={1052} preserveAspectRatio="xMidYMid slice" clipPath={`url(#o${id})`} />
      </Svg>
    </View>
  );
}


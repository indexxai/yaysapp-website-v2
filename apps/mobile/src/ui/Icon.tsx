import React from 'react';
import Svg, { Path } from 'react-native-svg';
import icons from '@yays/tokens/icons.json';

const ICONS = icons as { stroke: Record<string, string[]>; solid: Record<string, string> };
export type IconName = keyof typeof icons.stroke | keyof typeof icons.solid;

export function Icon({ name, size = 20, color, strokeWidth = 1.8 }: { name: IconName; size?: number; color: string; strokeWidth?: number }) {
  const solid = ICONS.solid[name as string];
  if (solid) return <Svg width={size} height={size} viewBox="0 0 24 24"><Path d={solid} fill={color} /></Svg>;
  const paths = ICONS.stroke[name as string] ?? ICONS.stroke.help;
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      {paths.map((d, i) => <Path key={i} d={d} />)}
    </Svg>
  );
}

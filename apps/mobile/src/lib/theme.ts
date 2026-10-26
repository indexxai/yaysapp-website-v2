import { useColorScheme } from 'react-native';
import tokens from '@yays/tokens';

export type Theme = typeof tokens.color.light & { scheme: 'light' | 'dark' };
export function useTheme(): Theme {
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  return { ...tokens.color[scheme], scheme };
}
export const space = tokens.space;
export const radius = tokens.radius;
export const OVAL_ASPECT = tokens.ovalAspect; // width / height
export const font = { display: 'Outfit', body: 'NunitoSans' };

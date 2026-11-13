import { useColorScheme } from 'react-native';
import tokens from '@yays/tokens';
import { usePrefs } from './prefs';

export type Theme = typeof tokens.color.light & { scheme: 'light' | 'dark' };
/** Light or dark: the account's choice (Me › Appearance), or the phone's own setting when it's "Follow system". */
export function useTheme(): Theme {
  const system = useColorScheme();
  const { theme } = usePrefs();
  const scheme = theme === 'system' ? (system === 'dark' ? 'dark' : 'light') : theme;
  return { ...tokens.color[scheme], scheme };
}
export const space = tokens.space;
export const radius = tokens.radius;
export const OVAL_ASPECT = tokens.ovalAspect; // width / height
export const font = { display: 'Outfit', body: 'NunitoSans' };

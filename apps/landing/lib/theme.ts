'use client';
import { useSyncExternalStore } from 'react';

/** Light, dark, or the device's setting: the same key the web app uses, so it carries over on the same site. */
type Theme = 'system' | 'light' | 'dark';
const KEY = 'yays.prefs';
const listeners = new Set<() => void>();
const read = (): Theme => { try { const t = (JSON.parse(localStorage.getItem(KEY) ?? '{}') as { theme?: Theme }).theme; return t === 'light' || t === 'dark' ? t : 'system'; } catch { return 'system'; } };
export function setTheme(theme: Theme) {
  try { const p = JSON.parse(localStorage.getItem(KEY) ?? '{}') as object; localStorage.setItem(KEY, JSON.stringify({ ...p, theme })); } catch { /* private window: this visit only */ }
  const h = document.documentElement;
  if (theme === 'system') h.removeAttribute('data-theme'); else h.setAttribute('data-theme', theme);
  listeners.forEach((l) => l());
}
export const useTheme = () => useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, read, () => 'system' as Theme);
/** Runs before the page paints, so a dark theme never flashes light. */
export const THEME_BOOT = `try{var t=JSON.parse(localStorage.getItem('${KEY}')||'{}').theme;if(t==='light'||t==='dark')document.documentElement.setAttribute('data-theme',t);}catch(e){}`;

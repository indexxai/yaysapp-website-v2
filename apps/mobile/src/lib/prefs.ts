import { useSyncExternalStore } from 'react';
import { DEFAULT_APP_PREFS, type AppPreferences } from '@yays/shared';

/**
 * Theme, text size and sound, from the account (so the phone matches the web). The session copies the account's
 * settings in whenever it loads or changes the profile; Appearance changes them here first so the app repaints at once.
 */
let current: AppPreferences = DEFAULT_APP_PREFS;
const listeners = new Set<() => void>();
export function setLocalPrefs(p: Partial<AppPreferences> | undefined) {
  if (!p) return;
  const next = { ...current, ...p };
  if ((Object.keys(next) as Array<keyof AppPreferences>).every((k) => next[k] === current[k])) return;
  current = next;
  listeners.forEach((l) => l());
}
export const getPrefs = () => current;
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
export function usePrefs(): AppPreferences { return useSyncExternalStore(subscribe, getPrefs, getPrefs); }

/** Message text size steps, like the web's (smallest … largest). */
export const TEXT_SCALE = [0.85, 0.93, 1, 1.1, 1.22];
export const useTextScale = () => TEXT_SCALE[usePrefs().textSize - 1] ?? 1;

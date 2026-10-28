'use client';
import { useSyncExternalStore } from 'react';

/** Settings that belong to this browser, not the account (like WhatsApp Web). */
export interface LocalPrefs {
  theme: 'system' | 'light' | 'dark';
  /** 1 (small) to 5 (largest); 3 is the default. */
  textSize: 1 | 2 | 3 | 4 | 5;
  enterToSend: boolean;
  sound: boolean;
}
export const PREFS_KEY = 'yays.prefs';
const DEFAULTS: LocalPrefs = { theme: 'system', textSize: 3, enterToSend: true, sound: true };
export const TEXT_SCALE = [0.85, 0.93, 1, 1.1, 1.22];

let cache: LocalPrefs | null = null;
const listeners = new Set<() => void>();

export function getPrefs(): LocalPrefs {
  if (cache) return cache;
  try { cache = { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as Partial<LocalPrefs>) }; } catch { cache = DEFAULTS; }
  return cache;
}
export function setPrefs(p: Partial<LocalPrefs>) {
  cache = { ...getPrefs(), ...p };
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(cache)); } catch { /* private window: lasts for this visit */ }
  applyPrefs(cache);
  listeners.forEach((l) => l());
}
/** Theme and text size go on <html>, so every page follows them. */
export function applyPrefs(p = getPrefs()) {
  const h = document.documentElement;
  if (p.theme === 'system') h.removeAttribute('data-theme'); else h.setAttribute('data-theme', p.theme);
  h.style.setProperty('--chat-scale', String(TEXT_SCALE[p.textSize - 1] ?? 1));
}
export function usePrefs(): LocalPrefs {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, getPrefs, () => DEFAULTS);
}

/** Runs before the page paints, so a dark theme never flashes light. Kept tiny and self-contained. */
export const PREFS_BOOT = `try{var p=JSON.parse(localStorage.getItem('${PREFS_KEY}')||'{}');var h=document.documentElement;if(p.theme==='light'||p.theme==='dark')h.setAttribute('data-theme',p.theme);var s=[0.85,0.93,1,1.1,1.22][(p.textSize||3)-1];if(s)h.style.setProperty('--chat-scale',String(s));}catch(e){}`;

/** A short, soft two-note chime for new messages (no audio file needed). */
export function chime() {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const now = ctx.currentTime;
    [660, 880].forEach((f, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = f; o.type = 'sine';
      g.gain.setValueAtTime(0.0001, now + i * 0.12);
      g.gain.exponentialRampToValueAtTime(0.12, now + i * 0.12 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.12 + 0.25);
      o.connect(g).connect(ctx.destination);
      o.start(now + i * 0.12); o.stop(now + i * 0.12 + 0.3);
    });
    setTimeout(() => void ctx.close(), 800);
  } catch { /* no audio */ }
}

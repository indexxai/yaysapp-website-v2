'use client';
import { useSyncExternalStore } from 'react';
import type { AppPreferences } from '@yays/shared';
import { api } from './api';

/** Theme, text size, Enter to send and sound. Kept on the account (so every device matches) and copied in this browser, so the page paints right before anything loads. */
export type LocalPrefs = AppPreferences;
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
/** Changes a setting here and saves it to the account. Quick repeats (dragging the text size) are sent once.
 *  Until the account has it, the change is also noted in this browser, so leaving the page straight away doesn't lose it. */
const UNSENT_KEY = 'yays.prefs.unsent';
const readUnsent = (): Partial<LocalPrefs> | null => { try { const v = localStorage.getItem(UNSENT_KEY); return v ? JSON.parse(v) as Partial<LocalPrefs> : null; } catch { return null; } };
const writeUnsent = (p: Partial<LocalPrefs> | null) => { try { if (p) localStorage.setItem(UNSENT_KEY, JSON.stringify(p)); else localStorage.removeItem(UNSENT_KEY); } catch { /* private window */ } };
let pending: Partial<LocalPrefs> = {};
let timer: ReturnType<typeof setTimeout> | null = null;
let waiting: Array<{ ok: () => void; fail: (e: unknown) => void }> = [];
function send(p: Partial<LocalPrefs>) {
  return api().setPreferences(p).then(() => { if (!timer) writeUnsent(null); });
}
export function savePrefs(p: Partial<LocalPrefs>): Promise<void> {
  setPrefs(p);
  pending = { ...pending, ...p };
  writeUnsent({ ...(readUnsent() ?? {}), ...p });
  if (timer) clearTimeout(timer);
  return new Promise((ok, fail) => {
    waiting.push({ ok, fail });
    timer = setTimeout(() => {
      const body = pending, wait = waiting;
      pending = {}; waiting = []; timer = null;
      send(body).then(() => wait.forEach((w) => w.ok()), (e) => wait.forEach((w) => w.fail(e)));
    }, 300);
  });
}
/** When the app loads, the account's settings win (they may have been changed on another device),
 *  unless this browser still has a change the account never got: that one is sent now. */
export function adoptPrefs(server: LocalPrefs | undefined) {
  if (!server || timer) return;
  const unsent = readUnsent();
  if (unsent && Object.keys(unsent).length) { setPrefs(unsent); void send(unsent).catch(() => undefined); return; }
  const cur = getPrefs();
  if ((Object.keys(server) as Array<keyof LocalPrefs>).some((k) => cur[k] !== server[k])) setPrefs(server);
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

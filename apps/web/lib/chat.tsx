'use client';
import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { ChatEngine, type ChatState, type OutboxStore, type PendingMessage } from '@yays/shared';
import { api } from './api';

const EngineCtx = createContext<ChatEngine | null>(null);

/** Unsent messages are kept per account in this browser, so a closed tab doesn't lose them. */
function localOutbox(me: string): OutboxStore {
  const key = `yays.outbox.${me}`;
  return {
    load: () => { try { return JSON.parse(localStorage.getItem(key) ?? '[]') as PendingMessage[]; } catch { return []; } },
    save: (items) => { try { if (items.length) localStorage.setItem(key, JSON.stringify(items)); else localStorage.removeItem(key); } catch { /* private mode: memory only */ } },
  };
}

/** One live chat engine per signed-in tab. */
export function ChatProvider({ me, onSignedOut, children }: { me: string; onSignedOut: () => void; children: ReactNode }) {
  const [engine, setEngine] = useState<ChatEngine | null>(null);
  useEffect(() => {
    const e = new ChatEngine({ client: api(), me, outbox: localOutbox(me), onSignedOut });
    setEngine(e);
    void e.start();
    // A chat counts as read only while its tab is showing.
    const vis = () => e.setVisible(document.visibilityState === 'visible');
    vis();
    document.addEventListener('visibilitychange', vis);
    return () => { document.removeEventListener('visibilitychange', vis); e.stop(); };
  }, [me, onSignedOut]);
  if (!engine) return null;
  return <EngineCtx.Provider value={engine}>{children}</EngineCtx.Provider>;
}

export function useEngine() {
  const e = useContext(EngineCtx);
  if (!e) throw new Error('useEngine outside ChatProvider');
  return e;
}

/** The engine's state; components re-render when it changes. */
export function useChatState(): ChatState {
  const e = useEngine();
  return useSyncExternalStore(e.subscribe, e.getState, e.getState);
}

// ---- formatting ----
const pad = (n: number) => String(n).padStart(2, '0');
export const clock = (iso: string) => { const d = new Date(iso); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
const daysAgo = (iso: string) => Math.round((startOfDay(new Date()) - startOfDay(new Date(iso))) / 86400000);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const shortDate = (d: Date) => `${d.getDate()} ${MONTHS[d.getMonth()]}${d.getFullYear() !== new Date().getFullYear() ? ` ${d.getFullYear()}` : ''}`;

/** Time shown in the chat list: 14:05, Yesterday, Monday, 3 Oct. */
export function listTime(iso: string) {
  const n = daysAgo(iso);
  if (n <= 0) return clock(iso);
  if (n === 1) return 'Yesterday';
  if (n < 7) return DAYS[new Date(iso).getDay()];
  return shortDate(new Date(iso));
}
/** Separator between days in a chat. */
export function dayLabel(iso: string) {
  const n = daysAgo(iso);
  if (n <= 0) return 'Today';
  if (n === 1) return 'Yesterday';
  if (n < 7) return DAYS[new Date(iso).getDay()];
  return shortDate(new Date(iso));
}
export function lastSeen(iso: string) {
  const n = daysAgo(iso);
  if (n <= 0) return `last seen today at ${clock(iso)}`;
  if (n === 1) return `last seen yesterday at ${clock(iso)}`;
  return `last seen ${shortDate(new Date(iso))}`;
}

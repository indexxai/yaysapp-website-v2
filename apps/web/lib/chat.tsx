'use client';
import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { ChatEngine, type ChatCache, type ChatSnapshot, type ChatState, type OutboxStore, type PendingMessage } from '@yays/shared';
import { api } from './api';
import { xhrUploader } from './media';

/** Chat list and recent messages kept in this browser, so chats show at once and offline. */
function localCache(me: string): ChatCache {
  const key = `yays.cache.${me}`;
  return {
    load: () => { try { return JSON.parse(localStorage.getItem(key) ?? 'null') as ChatSnapshot | null; } catch { return null; } },
    save: (snap) => { try { localStorage.setItem(key, JSON.stringify(snap)); } catch { /* full or blocked: the cache is optional */ } },
  };
}

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
  const outer = useContext(EngineCtx);
  const shared = !!outer && outer.me === me;
  const [engine, setEngine] = useState<ChatEngine | null>(null);
  useEffect(() => {
    // The app keeps one engine for the whole session (so calls survive moving between pages); pages reuse it.
    if (shared) return;
    const e = new ChatEngine({ client: api(), me, outbox: localOutbox(me), cache: localCache(me), onSignedOut, uploader: xhrUploader });
    setEngine(e);
    void e.start();
    // A chat counts as read only while its tab is showing.
    const vis = () => { e.setVisible(document.visibilityState === 'visible'); if (document.visibilityState === 'hidden') e.flushCache(); };
    vis();
    // Reloading or closing the tab: save what's pending so the next load starts from it.
    const leaving = () => e.flushCache();
    document.addEventListener('visibilitychange', vis);
    window.addEventListener('pagehide', leaving);
    return () => { document.removeEventListener('visibilitychange', vis); window.removeEventListener('pagehide', leaving); e.stop(); };
  }, [me, onSignedOut, shared]);
  if (shared) return <>{children}</>;
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

export { clock, dayLabel, lastSeen, listTime } from '@yays/shared';

const NONE = () => () => undefined;
const nothing = () => null;
/** The engine's state, or null outside a signed-in page. */
export function useOptionalChatState(): ChatState | null {
  const e = useContext(EngineCtx);
  return useSyncExternalStore(e ? e.subscribe : NONE, e ? e.getState : nothing, e ? e.getState : nothing);
}

import React, { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ChatEngine, type ChatCache, type ChatSnapshot, type ChatState, type OutboxStore, type PendingMessage } from '@yays/shared';
import { api } from './api';

/** Unsent messages survive the app being closed: they are kept in phone storage until the server has them. */
export function phoneOutbox(me: string): OutboxStore {
  const key = `yays.outbox.${me}`;
  return {
    load: async () => { try { return JSON.parse((await AsyncStorage.getItem(key)) ?? '[]') as PendingMessage[]; } catch { return []; } },
    save: async (items) => { if (items.length) await AsyncStorage.setItem(key, JSON.stringify(items)); else await AsyncStorage.removeItem(key); },
  };
}

/** Chat list and recent messages, so the app opens with chats showing even with no signal. */
export function phoneCache(me: string): ChatCache {
  const key = `yays.cache.${me}`;
  return {
    load: async () => { try { return JSON.parse((await AsyncStorage.getItem(key)) ?? 'null') as ChatSnapshot | null; } catch { return null; } },
    save: async (snap) => { await AsyncStorage.setItem(key, JSON.stringify(snap)); },
  };
}

const Ctx = createContext<ChatEngine | null>(null);

/** One chat engine while signed in. Reads count only while the app is in front. */
export function ChatProvider({ me, children }: { me: string; children: ReactNode }) {
  const [engine, setEngine] = useState<ChatEngine | null>(null);
  useEffect(() => {
    let e: ChatEngine | null = null;
    let cancelled = false;
    void api().then((client) => {
      if (cancelled) return;
      e = new ChatEngine({ client, me, outbox: phoneOutbox(me), cache: phoneCache(me), socketOptions: (globalThis as { YAYS_SOCKET_OPTIONS?: Record<string, unknown> }).YAYS_SOCKET_OPTIONS });
      setEngine(e);
      void e.start();
    });
    const sub = AppState.addEventListener('change', (s) => e?.setVisible(s === 'active'));
    return () => { cancelled = true; sub.remove(); e?.stop(); };
  }, [me]);
  if (!engine) return null;
  return <Ctx.Provider value={engine}>{children}</Ctx.Provider>;
}

export function useEngine() {
  const e = useContext(Ctx);
  if (!e) throw new Error('useEngine outside ChatProvider');
  return e;
}
export function useChatState(): ChatState {
  const e = useEngine();
  return useSyncExternalStore(e.subscribe, e.getState, e.getState);
}

export { clock, dayLabel, lastSeen, listTime } from '@yays/shared';

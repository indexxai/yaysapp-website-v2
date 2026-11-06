import React, { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ApiError, DEFAULT_APP_PREFS, DEFAULT_NOTIFICATIONS, DEFAULT_PRIVACY, type AuthResult, type MeProfile } from '@yays/shared';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api, onSignedOut, tokenStore } from './api';

const ME_KEY = 'yays.me';
const remember = (me: MeProfile | null) => { void (me ? AsyncStorage.setItem(ME_KEY, JSON.stringify(me)) : AsyncStorage.removeItem(ME_KEY)).catch(() => undefined); };
const recall = async () => { try { return JSON.parse((await AsyncStorage.getItem(ME_KEY)) ?? 'null') as MeProfile | null; } catch { return null; } };

type State = { status: 'loading' } | { status: 'signedOut' } | { status: 'signedIn'; me: MeProfile; offline?: boolean };
interface Session { state: State; signedIn(r: AuthResult): void; setMe(m: MeProfile): void; signOut(): Promise<void>; reload(): Promise<void> }
const Ctx = createContext<Session | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>({ status: 'loading' });
  const reload = useCallback(async () => {
    if (!(await tokenStore.get())) { setState({ status: 'signedOut' }); return; }
    try { const me = await (await api()).me(); remember(me); setState({ status: 'signedIn', me }); }
    catch (e) {
      if (e instanceof ApiError && (e.status === 401 || e.status === 403)) { await tokenStore.set(null); remember(null); setState({ status: 'signedOut' }); }
      else {
        // Offline at launch: open with the profile from last time, so chats and the unsent queue still work.
        const cached = await recall();
        setState((s) => (s.status === 'signedIn' ? { ...s, offline: true } : { status: 'signedIn', offline: true, me: cached ?? placeholderMe }));
      }
    }
  }, []);
  useEffect(() => { void reload(); return onSignedOut(() => { remember(null); setState({ status: 'signedOut' }); }); }, [reload]);
  const value = useMemo<Session>(() => ({
    state, reload,
    signedIn: (r) => { remember(r.me); setState({ status: 'signedIn', me: r.me }); },
    setMe: (me) => { remember(me); setState({ status: 'signedIn', me }); },
    signOut: async () => { try { await (await api()).logout(); } catch { await tokenStore.set(null); } remember(null); setState({ status: 'signedOut' }); },
  }), [state, reload]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

const placeholderMe: MeProfile = { id: '', displayName: '', username: null, about: '', photoUrl: null, phone: null, email: null, hasGoogle: false, createdAt: '', migrated: false, pending: [], twoStep: false, privacy: DEFAULT_PRIVACY, notifications: DEFAULT_NOTIFICATIONS, preferences: DEFAULT_APP_PREFS };

export function useSession() {
  const s = useContext(Ctx);
  if (!s) throw new Error('useSession outside SessionProvider');
  return s;
}

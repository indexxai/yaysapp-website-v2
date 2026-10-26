import React, { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ApiError, type AuthResult, type MeProfile } from '@yays/shared';
import { api, onSignedOut, tokenStore } from './api';

type State = { status: 'loading' } | { status: 'signedOut' } | { status: 'signedIn'; me: MeProfile; offline?: boolean };
interface Session { state: State; signedIn(r: AuthResult): void; setMe(m: MeProfile): void; signOut(): Promise<void>; reload(): Promise<void> }
const Ctx = createContext<Session | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>({ status: 'loading' });
  const reload = useCallback(async () => {
    if (!(await tokenStore.get())) { setState({ status: 'signedOut' }); return; }
    try { setState({ status: 'signedIn', me: await (await api()).me() }); }
    catch (e) {
      if (e instanceof ApiError && (e.status === 401 || e.status === 403)) { await tokenStore.set(null); setState({ status: 'signedOut' }); }
      // Offline at launch: keep the person signed in; screens retry when the network is back.
      else setState((s) => (s.status === 'signedIn' ? { ...s, offline: true } : { status: 'signedIn', offline: true, me: placeholderMe }));
    }
  }, []);
  useEffect(() => { void reload(); return onSignedOut(() => setState({ status: 'signedOut' })); }, [reload]);
  const value = useMemo<Session>(() => ({
    state, reload,
    signedIn: (r) => setState({ status: 'signedIn', me: r.me }),
    setMe: (me) => setState({ status: 'signedIn', me }),
    signOut: async () => { try { await (await api()).logout(); } catch { await tokenStore.set(null); } setState({ status: 'signedOut' }); },
  }), [state, reload]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

const placeholderMe: MeProfile = { id: '', displayName: '', username: null, about: '', photoUrl: null, phone: null, email: null, hasGoogle: false, createdAt: '', migrated: false, pending: [] };

export function useSession() {
  const s = useContext(Ctx);
  if (!s) throw new Error('useSession outside SessionProvider');
  return s;
}

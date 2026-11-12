import { useEffect, useRef } from 'react';
import { Linking } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from './api';
import { config } from './config';

// ---------------------------------------------------------------------------------------------------------------
// Links that open the app: the web app's own links (web.yaysapp.com/join/…, iOS Associated Domains and Android App
// Links), and the same paths on yaysapp://. Links that arrive before sign-in wait until the person is signed in.
// ---------------------------------------------------------------------------------------------------------------
export type LinkTarget =
  | { to: 'join'; kind: 'group' | 'circle'; code: string }
  | { to: 'circle'; id: string }
  | { to: 'post'; id: string }
  | { to: 'event'; id: string }
  | { to: 'ref'; code: string };

const PENDING = 'yays.link';
const REF = 'yays.ref';
const OBJECT_ID = /^[a-f0-9]{24}$/i;
const CODE = /^[A-Za-z0-9_-]{4,64}$/;
const REF_CODE = /^[A-Za-z0-9]{2,12}-[A-Za-z0-9]{3}$/;

/** What a link points at in the app, or null for anything else (a sign-in return, someone else's site). */
export function parseLink(raw: string): LinkTarget | null {
  let u: URL;
  try { u = new URL(raw); } catch { return null; }
  const scheme = u.protocol.replace(/:$/, '');
  const web = new URL(config.webUrl);
  const ours = scheme === config.scheme || ((scheme === 'https' || scheme === 'http') && (u.host === web.host || config.linkHosts.includes(u.host)));
  if (!ours) return null;
  // yaysapp://join/CODE has "join" as its host; https://…/join/CODE has it in the path.
  const parts = [...(scheme === config.scheme && u.host ? [u.host] : []), ...u.pathname.split('/')].filter(Boolean).map(decodeURIComponent);
  const id = u.searchParams.get('id') ?? '';
  if ((parts[0] === 'join' || parts[0] === 'c') && parts[1] && CODE.test(parts[1])) return { to: 'join', kind: parts[0] === 'join' ? 'group' : 'circle', code: parts[1] };
  if (parts[0] === 'circles' && OBJECT_ID.test(id)) {
    if (parts[1] === 'post') return { to: 'post', id };
    if (parts[1] === 'event') return { to: 'event', id };
    if (!parts[1]) return { to: 'circle', id };
  }
  const ref = u.searchParams.get('ref');
  if (ref && REF_CODE.test(ref)) return { to: 'ref', code: ref.toUpperCase() };
  return null;
}

/** Someone's invite code: kept until there's an account, then given to the server once (as the web does). */
export async function applyStoredRef() {
  const code = await AsyncStorage.getItem(REF).catch(() => null);
  if (!code) return;
  try { await (await api()).useReferralCode(code); await AsyncStorage.removeItem(REF); }
  catch (e) { const s = (e as { status?: number }).status ?? 0; if (s >= 400 && s < 500) await AsyncStorage.removeItem(REF).catch(() => undefined); }
}

/**
 * Listens for links (the one that opened the app, and any later). Signed out: a link waits (an invite code is kept
 * for the new account). Signed in: `open` takes it there.
 */
export function useLinks(signedIn: boolean, open: (t: Exclude<LinkTarget, { to: 'ref' }>) => void) {
  const live = useRef({ signedIn, open });
  live.current = { signedIn, open };
  const handle = async (url: string | null) => {
    const t = url ? parseLink(url) : null;
    if (!t) return;
    if (t.to === 'ref') {
      await AsyncStorage.setItem(REF, t.code).catch(() => undefined);
      if (live.current.signedIn) await applyStoredRef();
      return;
    }
    if (live.current.signedIn) live.current.open(t);
    else await AsyncStorage.setItem(PENDING, JSON.stringify(t)).catch(() => undefined);
  };
  useEffect(() => {
    void Linking.getInitialURL().then(handle).catch(() => undefined);
    const sub = Linking.addEventListener('url', ({ url }) => void handle(url));
    return () => sub.remove();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // Just signed in: the link that was waiting, and the invite code.
  useEffect(() => {
    if (!signedIn) return;
    void (async () => {
      await applyStoredRef();
      const raw = await AsyncStorage.getItem(PENDING).catch(() => null);
      if (!raw) return;
      await AsyncStorage.removeItem(PENDING).catch(() => undefined);
      try { live.current.open(JSON.parse(raw) as Exclude<LinkTarget, { to: 'ref' }>); } catch { /* not ours */ }
    })();
  }, [signedIn]);
}

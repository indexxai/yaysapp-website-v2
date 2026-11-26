'use client';
import { useEffect, useState } from 'react';
import type { IndexxLink } from '@yays/shared';
import { api } from '@/lib/api';
import { errText } from '@/lib/phase2';
import { Banner, Field, OvalButton } from './ui';

/**
 * Sign in to Indexx with the Indexx account's email and password. YaysApp's server keeps the Indexx login token
 * (not the password) and reads BTCY, EMMM, ShoperPal, Wall Street and the wallet with it.
 */
export function IndexxSignIn({ email, onDone, title = 'Sign in to Indexx', sub, ended }: {
  email: string | null; onDone: (s: IndexxLink) => void; title?: string; sub?: string;
  /** The last sign-in ran out: say so. */
  ended?: boolean;
}) {
  const [e, setE] = useState(email ?? '');
  const [p, setP] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const google = async (googleToken: string) => {
    setBusy(true); setError(null);
    try { onDone(await api().signInIndexxGoogle(googleToken)); }
    catch (x) { setError(errText(x)); } finally { setBusy(false); }
  };
  const go = async () => {
    setBusy(true); setError(null);
    try { const s = await api().signInIndexx(e, p); setP(''); onDone(s); }
    catch (x) { setError(errText(x)); } finally { setBusy(false); }
  };
  return (
    <section className="p2-card p2-card--pad p2-ixsign" aria-labelledby="ixsign-h">
      <div className="row" style={{ gap: 14 }}>
        <span className="ys-oval" style={{ width: 52, ['--ys-oval-fill' as string]: '#ffffff' }}><img src="/brand/products/indexx.png" alt="" /></span>
        <span className="p2-col" style={{ flex: 1 }}>
          <h2 id="ixsign-h" style={{ margin: 0 }}>{title}</h2>
          <span className="muted">{sub ?? 'See your BTCY mining, EMMM positions, ShoperPal orders, Wall Street stocks and wallet here, and withdraw BTCY tokens to the BTCY app.'}</span>
        </span>
      </div>
      {ended && <Banner tone="info">Your Indexx sign-in ended. Sign in again to see your products.</Banner>}
      <form className="p2-ixsign__form" noValidate onSubmit={(x) => { x.preventDefault(); if (e.trim() && p) void go(); }}>
        <Field id="ix-email" label="Indexx email">
          <input id="ix-email" className="ys-input" type="email" value={e} onChange={(x) => setE(x.target.value)} autoComplete="username" />
        </Field>
        <Field id="ix-password" label="Indexx password" error={error}>
          <input id="ix-password" className="ys-input" type="password" value={p} onChange={(x) => setP(x.target.value)} autoComplete="current-password" />
        </Field>
        <OvalButton type="submit" icon="arrow-right" label="Sign in to Indexx" size="md" loading={busy} disabled={!e.trim() || !p} />
      </form>
      <IndexxGoogle busy={busy} onToken={(tk) => void google(tk)} onError={setError} />
      <p className="muted p2-xs" style={{ margin: 0 }}>Use the account you use for BTCY and Indexx Exchange. YaysApp doesn’t keep your password. <a href="https://indexx.ai" target="_blank" rel="noopener noreferrer">No Indexx account yet?</a></p>
    </section>
  );
}

declare global { interface Window { google?: { accounts: { oauth2: { initTokenClient: (o: { client_id: string; scope: string; callback: (r: { access_token?: string; error?: string }) => void; error_callback?: (e: { type?: string }) => void }) => { requestAccessToken: () => void } } } } } }

/**
 * For Indexx accounts made with Google (they have no Indexx password): Google's own window gives an access token,
 * which Indexx checks with Google. Shown when the site has a Google client id; a stand-in locally and in tests.
 */
function IndexxGoogle({ busy, onToken, onError }: { busy: boolean; onToken: (token: string) => void; onError: (m: string) => void }) {
  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
  const [ready, setReady] = useState(!clientId);
  useEffect(() => {
    if (!clientId) return;
    if (window.google?.accounts?.oauth2) { setReady(true); return; }
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client'; s.async = true; s.onload = () => setReady(true);
    document.head.appendChild(s);
  }, [clientId]);
  if (!clientId && process.env.NEXT_PUBLIC_DEV_GOOGLE !== '1') return null;
  const click = () => {
    if (!clientId) { const em = window.prompt('Dev Google (Indexx): email') ?? ''; if (em) onToken(`dev-google:${em}`); return; }
    const c = window.google?.accounts.oauth2.initTokenClient({
      client_id: clientId, scope: 'openid email profile',
      callback: (r) => { if (r.access_token) onToken(r.access_token); else if (r.error && r.error !== 'access_denied') onError('Google didn’t sign you in. Try again.'); },
      error_callback: (er) => { if (er.type !== 'popup_closed') onError('Google’s window couldn’t open. Allow pop-ups for this site and try again.'); },
    });
    c?.requestAccessToken();
  };
  return (
    <div className="p2-ixsign__google">
      <span className="divider">or</span>
      <OvalButton icon="google" label="Continue with Google" size="md" variant="soft" loading={busy || !ready} onClick={click} />
      <span className="muted p2-xs">For Indexx accounts you made with Google.</span>
    </div>
  );
}

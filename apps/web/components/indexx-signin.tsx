'use client';
import { useState } from 'react';
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
          <span className="muted">{sub ?? 'See your BTCY mining, EMMM positions, ShoperPal orders, Wall Street stocks and wallet here, and withdraw INEX to Indexx Exchange.'}</span>
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
      <p className="muted p2-xs" style={{ margin: 0 }}>Use the account you use for BTCY and Indexx Exchange. YaysApp doesn’t keep your password. <a href="https://indexx.ai" target="_blank" rel="noopener noreferrer">No Indexx account yet?</a></p>
    </section>
  );
}

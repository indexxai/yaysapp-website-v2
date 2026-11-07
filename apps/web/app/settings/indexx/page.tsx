'use client';
import { useState } from 'react';
import { api } from '@/lib/api';
import { Icon } from '@/lib/icons';
import { Card, SettingsFrame, useSaved } from '@/components/settings';
import { IndexxSignIn } from '@/components/indexx-signin';
import { Banner, OvalButton } from '@/components/ui';
import { errText, useLoad } from '@/lib/phase2';

export default function IndexxPage() { return <SettingsFrame>{(me) => <Indexx email={me.email} />}</SettingsFrame>; }

/** p15: the Indexx sign-in (BTCY, EMMM, ShoperPal, Wall Street, the wallet and withdrawing INEX). */
function Indexx({ email }: { email: string | null }) {
  const s = useLoad(() => api().indexx());
  const saved = useSaved();
  const [busy, setBusy] = useState(false);
  const signOut = async () => { setBusy(true); try { s.setData(await api().unlinkIndexx()); saved.ok('Signed out of Indexx.'); } catch (e) { saved.fail(errText(e)); } finally { setBusy(false); } };
  const d = s.data;
  return (
    <>
      {saved.banner}
      {s.error && <Banner>{s.error}</Banner>}
      {d && !d.available && <Banner tone="info">Signing in to Indexx isn’t available yet.</Banner>}
      {d?.linked ? (
        <section className="set-card set-card--pad p2-indexx">
          <div className="row" style={{ gap: 14 }}>
            <span className="ys-oval" style={{ width: 60, ['--ys-oval-fill' as string]: '#ffffff' }}><img src="/brand/products/indexx.png" alt="" style={{ width: '62%', height: '62%', objectFit: 'contain' }} /></span>
            <span className="p2-col" style={{ flex: 1 }}><strong style={{ fontSize: 18 }}>One account for every Indexx product</strong><span className="muted">YaysApp reads your BTCY, EMMM, ShoperPal, Wall Street and wallet with your Indexx sign-in.</span></span>
          </div>
          <div className="p2-linked">
            <span className="ys-oval ys-oval--success" style={{ width: 40 }}><Icon name="check" size={18} /></span>
            <span className="p2-col" style={{ flex: 1 }}><strong>Signed in</strong><span className="muted">{d.email} · since {new Date(d.linkedAt!).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })}</span></span>
            <OvalButton icon="logout" label="Sign out of Indexx" size="sm" variant="ghost" loading={busy} onClick={() => void signOut()} />
          </div>
        </section>
      ) : d?.available && (
        <IndexxSignIn email={d.email ?? email} ended={!!d.email} onDone={(n) => { s.setData(n); saved.ok('Signed in to Indexx.'); }} />
      )}
      <Card label="What the Indexx sign-in shows">
        <div className="ys-row-item"><span className="ys-row-item__text"><span className="ys-row-item__title">Explore</span><span className="ys-row-item__sub">BTCY mining, EMMM positions, ShoperPal orders and Wall Street stocks</span></span></div>
        <div className="ys-row-item"><span className="ys-row-item__text"><span className="ys-row-item__title">Wallet</span><span className="ys-row-item__sub">INEX, BTCY Nuggets, USDXX and Indexx Exchange; withdraw INEX to the exchange</span></span></div>
        <div className="ys-row-item"><span className="ys-row-item__text"><span className="ys-row-item__title">BTCY bonus</span><span className="ys-row-item__sub">Your mining streak and friends who join your team count toward INEX</span></span></div>
        <div className="ys-row-item"><span className="ys-row-item__text"><span className="ys-row-item__title">Your password</span><span className="ys-row-item__sub">Sent to Indexx once to sign in, never kept by YaysApp</span></span></div>
      </Card>
    </>
  );
}

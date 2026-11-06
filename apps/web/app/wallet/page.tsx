'use client';
import { useState } from 'react';
import type { WalletTx, WalletView } from '@yays/shared';
import { AppShell } from '@/components/app-shell';
import { Modal } from '@/components/message-actions';
import { Banner, LineArt, OvalButton } from '@/components/ui';
import { useMe } from '@/components/use-me';
import { api } from '@/lib/api';
import { Icon } from '@/lib/icons';
import { errText, fmtNuggets, fmtPoints, fmtUsd, setBalance, useLoad, when } from '@/lib/phase2';

const TAG: Record<WalletTx['status'], string> = { done: 'neutral', failed: 'danger' };
const STATUS: Record<WalletTx['status'], string> = { done: 'Done', failed: 'Failed' };

function amountOf(t: WalletTx) {
  const v = `${fmtNuggets(t.amount / 10000)} N`;
  if (t.status === 'failed') return { text: v, cls: 'muted strike' };
  return { text: `${t.direction === 'in' ? '+' : '−'}${v}`, cls: '' };
}

/** W4: balances, activity, and converting points to BTCY Nuggets (p10). */
export default function WalletPage() {
  const { me } = useMe();
  const wallet = useLoad(() => api().wallet());
  const activity = useLoad(() => api().walletActivity());
  const w = wallet.data;
  return (
    <AppShell me={me}>
      <LineArt name="wallet" height={360} opacity={0.17} className="p2-art p2-art--br" />
      <div className="p2-page p2-page--wide">
        <div className="p2-head">
          <h1>Wallet</h1>
          {w?.syncedAt && <span className="muted p2-small row" style={{ gap: 6 }}><Icon name="refresh" size={14} />Synced {when(w.syncedAt)}</span>}
        </div>
        {wallet.error && <Banner>{wallet.error}</Banner>}
        {w && !w.linked && (
          <div className="p2-card p2-card--pad p2-link-cta">
            <span className="ys-oval" style={{ width: 52, ['--ys-oval-fill' as string]: '#ffffff' }}><img src="/brand/products/indexx.png" alt="" /></span>
            <span className="p2-col" style={{ flex: 1 }}><strong>Link your Indexx account</strong><span className="muted">See BTCY Nuggets, USDXX and Exchange balances here, and convert INEX to Nuggets.</span></span>
            <OvalButton icon="link" label="Link account" size="sm" href="/settings/indexx" />
          </div>
        )}
        <div className="p2-grid p2-grid--wallet">
          <div className="p2-col" style={{ gap: 16, minWidth: 0 }}>
            <div className="p2-assets">
              <Asset name="INEX" amount={w ? fmtPoints(w.points) : '—'} sub="Earned in YaysApp" icon />
              <Asset name="BTCY Nuggets" amount={w?.nuggets != null ? fmtNuggets(w.nuggets) : '—'} sub={w?.linked ? 'From BTCY mining' : 'Not linked'} logo="/brand/products/btcy.png" />
              <Asset name="USDXX" amount={w?.usdxxCents != null ? fmtUsd(w.usdxxCents) : '—'} sub={w?.linked ? 'Indexx Pay' : 'Not linked'} logo="/brand/products/usdxx.png" />
              <Asset name="Indexx Exchange" amount={w?.exchangeUsdCents != null ? fmtUsd(w.exchangeUsdCents) : '—'} sub={w?.linked ? 'Read-only' : 'Not linked'} logo="/brand/products/exchange.png" />
            </div>
            <section className="p2-card" aria-labelledby="tx">
              <div className="p2-card__head p2-card__head--pad"><h2 id="tx">Activity</h2></div>
              {activity.error && <div style={{ padding: '0 18px 18px' }}><Banner>{activity.error}</Banner></div>}
              {activity.data && !activity.data.length && <p className="muted" style={{ margin: '4px 20px 20px' }}>Nothing yet. INEX you convert to Nuggets shows here.</p>}
              {!!activity.data?.length && (
                <div style={{ overflowX: 'auto' }}>
                  <table className="p2-table">
                    <thead><tr><th>What</th><th>Date</th><th>Status</th><th className="num">Amount</th></tr></thead>
                    <tbody>{activity.data.map((t) => { const a = amountOf(t); return (
                      <tr key={t.id}><td><strong>{t.title}</strong><br /><span className="muted p2-small">{t.sub}</span></td><td className="muted">{when(t.at)}</td><td><span className={`ys-tag ys-tag--${TAG[t.status]}`}>{STATUS[t.status]}</span></td><td className={`num ${a.cls}`}>{a.text}</td></tr>
                    ); })}</tbody>
                  </table>
                </div>
              )}
            </section>
          </div>
          {w && <Convert w={w} onDone={(n) => { wallet.setData(n); setBalance(n.points); void activity.reload(); }} />}
        </div>
      </div>
    </AppShell>
  );
}

function Asset({ name, amount, sub, logo, icon }: { name: string; amount: string; sub: string; logo?: string; icon?: boolean }) {
  return (
    <div className="p2-asset">
      {icon ? <span className="ys-oval ys-oval--ember" style={{ width: 40 }}><Icon name="star" size={18} /></span> : <span className="ys-oval" style={{ width: 40, ['--ys-oval-fill' as string]: '#ffffff' }}><img src={logo} alt="" /></span>}
      <span className="muted p2-small" style={{ marginTop: 10 }}>{name}</span>
      <strong className="p2-asset__amt">{amount}</strong>
      <span className="muted p2-xs">{sub}</span>
    </div>
  );
}

function Convert({ w, onDone }: { w: WalletView; onDone: (w: WalletView) => void }) {
  const [raw, setRaw] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const n = Number(raw.replace(/[,\s]/g, '')) || 0;
  const left = Math.max(0, w.convert.dailyMax - w.convert.usedToday);
  const max = Math.min(w.points, left) - (Math.min(w.points, left) % w.convert.pointsPerNugget);
  const problem = !raw ? null
    : !Number.isInteger(n) || n <= 0 ? 'Enter a whole number of INEX.'
      : n > w.points ? `You have ${fmtPoints(w.points)} INEX. Enter ${fmtPoints(w.points)} or less.`
        : n < w.convert.min ? `The smallest conversion is ${fmtPoints(w.convert.min)} INEX.`
          : n % w.convert.pointsPerNugget ? `Convert in steps of ${w.convert.pointsPerNugget} INEX.`
            : n > left ? `You can convert ${fmtPoints(left)} more INEX today.` : null;
  const nuggets = !problem && n ? n / w.convert.pointsPerNugget : null;
  const go = async () => {
    setBusy(true); setError(null);
    try { const next = await api().convertPoints(n); onDone(next); setConfirm(false); setRaw(''); setDone(`${fmtPoints(n)} INEX became ${fmtNuggets(n / w.convert.pointsPerNugget)} BTCY Nuggets.`); }
    catch (e) { setError(errText(e)); } finally { setBusy(false); }
  };
  return (
    <aside className="p2-card p2-card--pad p2-convert" aria-labelledby="conv">
      <h2 id="conv">Convert</h2>
      {!w.linked ? <p className="muted" style={{ margin: 0 }}>Link your Indexx account to convert INEX to BTCY Nuggets.</p> : (
        <>
          {done && <Banner tone="success">{done}</Banner>}
          <div className={`ys-field${problem ? ' ys-field--error' : ''}`}>
            <label className="ys-field__label" htmlFor="amt">INEX to convert</label>
            <div className="ys-field__box"><input id="amt" className="ys-input p2-convert__input" inputMode="numeric" value={raw} onChange={(e) => { setRaw(e.target.value); setDone(null); }} placeholder="0" aria-describedby="amt-hint" /><button type="button" className="link-btn" onClick={() => setRaw(String(max))} disabled={max < w.convert.min}>Max</button></div>
            <span className="ys-field__hint" id="amt-hint" role={problem ? 'alert' : undefined}>{problem ?? `You have ${fmtPoints(w.points)} INEX.`}</span>
          </div>
          <div className="row center muted"><Icon name="arrow-down" size={18} /></div>
          <div className="p2-convert__to"><span className="ys-oval" style={{ width: 36, ['--ys-oval-fill' as string]: '#ffffff' }}><img src="/brand/products/btcy.png" alt="" /></span><span style={{ flex: 1, fontWeight: 700 }}>BTCY Nuggets</span><strong>{nuggets !== null ? fmtNuggets(nuggets) : '—'}</strong></div>
          <dl className="p2-dl">
            <dt>Rate</dt><dd>{w.convert.pointsPerNugget} INEX = 1 Nugget</dd>
            <dt>Limits</dt><dd>Min {fmtPoints(w.convert.min)} · {fmtPoints(w.convert.dailyMax)} per day</dd>
            <dt>Used today</dt><dd>{fmtPoints(w.convert.usedToday)}</dd>
          </dl>
          <div className="row center"><OvalButton icon="check" label="Convert" size="lg" disabled={!nuggets} onClick={() => setConfirm(true)} /></div>
        </>
      )}
      {confirm && nuggets !== null && (
        <Modal title="Convert INEX?" onClose={() => setConfirm(false)}>
          <div className="p2-confirm">
            <div><span className="muted">You convert</span><strong>{fmtPoints(n)} INEX</strong></div>
            <Icon name="arrow-down" size={18} />
            <div><span className="muted">You get</span><strong>{fmtNuggets(nuggets)} BTCY Nuggets</strong></div>
          </div>
          <dl className="p2-dl"><dt>Fee</dt><dd>None</dd><dt>Arrives</dt><dd>In your BTCY balance, instantly</dd></dl>
          <p className="muted p2-small" style={{ margin: 0 }}>Conversions can’t be undone.</p>
          {error && <Banner>{error}</Banner>}
          <div className="row center"><OvalButton icon="close" label="Cancel" variant="ghost" onClick={() => setConfirm(false)} /><OvalButton icon="check" label="Convert" size="lg" loading={busy} onClick={() => void go()} /></div>
        </Modal>
      )}
    </aside>
  );
}

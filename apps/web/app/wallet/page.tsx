'use client';
import { useEffect, useRef, useState } from 'react';
import { ApiError, ErrorCode, type WalletView, type Withdrawal, type WithdrawalsPage, type WithdrawQuote } from '@yays/shared';
import { AppShell } from '@/components/app-shell';
import { BackButton } from '@/components/back';
import { IndexxSignIn } from '@/components/indexx-signin';
import { Modal } from '@/components/message-actions';
import { Banner, LineArt, OvalButton } from '@/components/ui';
import { useMe } from '@/components/use-me';
import { api } from '@/lib/api';
import { Icon } from '@/lib/icons';
import { errText, money, num, useLoad, when } from '@/lib/phase2';

const STATUS: Record<Withdrawal['status'], { label: string; tone: string }> = {
  completed: { label: 'Completed', tone: 'success' }, failed: { label: 'Failed · INEX returned', tone: 'danger' }, processing: { label: 'Processing', tone: 'warning' },
};

/** W4: INEX, BTCY Nuggets, USDXX and Indexx Exchange from the person's Indexx account, and withdrawing INEX to the exchange. */
export default function WalletPage() {
  const { me } = useMe();
  const wallet = useLoad(() => api().wallet());
  const ix = useLoad(() => api().indexx());
  const [history, setHistory] = useState<WithdrawalsPage | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const linked = !!wallet.data?.linked;
  const loadHistory = async (skip = 0) => {
    try { const p = await api().withdrawals(skip); setHistory((h) => (skip && h ? { items: [...h.items, ...p.items], hasMore: p.hasMore } : p)); setHistoryError(null); }
    catch (e) { setHistoryError(errText(e)); }
  };
  useEffect(() => { if (linked) void loadHistory(); }, [linked]); // eslint-disable-line react-hooks/exhaustive-deps
  const w = wallet.data;
  const refresh = async () => { await wallet.reload(); await loadHistory(); };
  return (
    <AppShell me={me}>
      <LineArt name="wallet" height={360} opacity={0.17} className="p2-art p2-art--br" />
      <div className="p2-page p2-page--wide">
        <div className="p2-head">
          <BackButton />
          <h1>Wallet</h1>
          {linked && <button type="button" className="link-btn muted p2-small row" style={{ gap: 6 }} onClick={() => void refresh()}><Icon name="refresh" size={14} />Refresh</button>}
        </div>
        {wallet.error && <Banner>{wallet.error}</Banner>}
        {w && !w.linked && ix.data && (
          <IndexxSignIn email={ix.data.email ?? me?.email ?? null} ended={!!ix.data.email} sub="Your INEX, BTCY Nuggets, USDXX and Indexx Exchange balances show here once you sign in, and you can withdraw INEX to Indexx Exchange." onDone={(s) => { ix.setData(s); void wallet.reload(); }} />
        )}
        <div className="p2-grid p2-grid--wallet">
          <div className="p2-col" style={{ gap: 16, minWidth: 0 }}>
            <div className="p2-assets">
              <Asset name="INEX" amount={w?.inex ? num(w.inex.balance) : '—'} sub={w?.inex?.source ?? 'Earned in YaysApp'} icon testId="card-inex" />
              <Asset name="BTCY Nuggets" amount={w?.nuggets ? num(w.nuggets.balance, 2) : '—'} sub={w?.nuggets?.source ?? 'From BTCY mining'} logo="/brand/products/btcy.png" />
              <Asset name="USDXX" amount={w?.usdxx ? money(w.usdxx.usd ?? w.usdxx.balance) : '—'} sub={w?.usdxx?.source ?? 'Indexx Pay'} logo="/brand/products/usdxx.png" />
              <Asset name="Indexx Exchange" amount={w?.exchange ? money(w.exchange.totalUsd) : '—'} sub={w?.linked && !w.exchange ? 'Couldn’t read it right now' : 'Read-only'} logo="/brand/products/exchange.png" testId="card-exchange" />
            </div>
            {w?.exchange && <Exchange x={w.exchange} />}
            {linked && (
              <section className="p2-card" aria-labelledby="wd-h">
                <div className="p2-card__head p2-card__head--pad"><h2 id="wd-h">Withdrawals</h2></div>
                {historyError && <div style={{ padding: '0 18px 18px' }}><Banner>{historyError}</Banner></div>}
                {history && !history.items.length && <p className="muted" style={{ margin: '4px 20px 20px' }}>Nothing yet. INEX you withdraw to Indexx Exchange shows here.</p>}
                {!!history?.items.length && (
                  <div style={{ overflowX: 'auto' }}>
                    <table className="p2-table">
                      <thead><tr><th>What</th><th>Date</th><th>Status</th><th className="num">Amount</th></tr></thead>
                      <tbody>{history.items.map((t) => (
                        <tr key={t.id}>
                          <td><strong>To Indexx Exchange</strong><br /><span className="muted p2-small">INEX wallet{t.network ? ` · ${t.network}` : ''}</span></td>
                          <td className="muted">{when(t.createdAt)}</td>
                          <td><span className={`ys-tag ys-tag--${STATUS[t.status]?.tone ?? 'neutral'}`}>{STATUS[t.status]?.label ?? t.status}</span></td>
                          <td className={`num${t.status === 'failed' ? ' muted strike' : ''}`}>{num(t.amount)} INEX</td>
                        </tr>
                      ))}</tbody>
                    </table>
                  </div>
                )}
                {history?.hasMore && <div className="row center" style={{ padding: 14 }}><OvalButton icon="chevron-down" label="Show more" size="sm" variant="ghost" onClick={() => void loadHistory(history.items.length)} /></div>}
              </section>
            )}
          </div>
          {w && <Withdraw w={w} onDone={(r) => { wallet.setData((cur) => (cur?.inex ? { ...cur, inex: { ...cur.inex, balance: r.balance } } : cur)); void refresh(); }} onSignedOut={() => { void ix.reload(); void wallet.reload(); }} />}
        </div>
      </div>
    </AppShell>
  );
}

function Asset({ name, amount, sub, logo, icon, testId }: { name: string; amount: string; sub: string; logo?: string; icon?: boolean; testId?: string }) {
  return (
    <div className="p2-asset" data-testid={testId}>
      {icon ? <span className="ys-oval ys-oval--ember" style={{ width: 40 }}><Icon name="star" size={18} /></span> : <span className="ys-oval" style={{ width: 40, ['--ys-oval-fill' as string]: '#ffffff' }}><img src={logo} alt="" /></span>}
      <span className="muted p2-small" style={{ marginTop: 10 }}>{name}</span>
      <strong className="p2-asset__amt">{amount}</strong>
      <span className="muted p2-xs">{sub}</span>
    </div>
  );
}

/** What's in the Indexx Exchange wallet, coin by coin, at live prices. */
function Exchange({ x }: { x: NonNullable<WalletView['exchange']> }) {
  return (
    <section className="p2-card" aria-labelledby="ex-h">
      <div className="p2-card__head p2-card__head--pad"><h2 id="ex-h">On Indexx Exchange</h2></div>
      {!x.assets.length && <p className="muted" style={{ margin: '4px 20px 20px' }}>Nothing on the exchange yet.</p>}
      {!!x.assets.length && (
        <div style={{ overflowX: 'auto' }}>
          <table className="p2-table">
            <thead><tr><th>Coin</th><th className="num">Balance</th><th className="num">Price</th><th className="num">Value</th></tr></thead>
            <tbody>{x.assets.map((a) => (
              <tr key={`${a.symbol}-${a.network}`}>
                <td><strong>{a.symbol}</strong>{a.network && <><br /><span className="muted p2-small">{a.network}</span></>}</td>
                <td className="num">{num(a.balance, 2)}</td>
                <td className="num muted">{money(a.price)}</td>
                <td className="num">{money(a.usd)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      {x.partial && <p className="muted p2-small" style={{ margin: '0 20px 18px' }}>Some coins have no price yet, so they aren’t in the total.</p>}
    </section>
  );
}

function Withdraw({ w, onDone, onSignedOut }: { w: WalletView; onDone: (r: Withdrawal) => void; onSignedOut: () => void }) {
  const [raw, setRaw] = useState('');
  const [quote, setQuote] = useState<WithdrawQuote | null>(null);
  const [confirm, setConfirm] = useState<{ amount: number; key: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const asked = useRef(0);
  const n = Number(raw.replace(/[,\s]/g, ''));
  const typed = raw.trim() !== '';
  const whole = typed && Number.isInteger(n) && n > 0;

  // The panel's limits first, then a fresh check as the amount changes.
  useEffect(() => {
    if (!w.linked) return;
    const amount = whole ? n : 0, ticket = ++asked.current;
    const t = setTimeout(() => {
      api().withdrawQuote(amount).then((q) => { if (ticket === asked.current) setQuote(q); }).catch((e) => {
        if (ticket !== asked.current) return;
        if (e instanceof ApiError && e.code === ErrorCode.INDEXX_SIGN_IN) onSignedOut(); else setError(errText(e));
      });
    }, amount ? 300 : 0);
    return () => clearTimeout(t);
  }, [w.linked, raw]); // eslint-disable-line react-hooks/exhaustive-deps

  const current = quote && whole && quote.amount === n ? quote : null;
  const problem = !typed ? null : !whole ? 'Enter a whole number of INEX.' : current && !current.eligible ? current.reason : null;
  const max = quote ? Math.max(0, Math.min(quote.balance, quote.remainingToday ?? quote.balance)) : 0;
  const go = async () => {
    if (!confirm) return;
    setBusy(true); setError(null);
    try {
      const r = await api().withdraw(confirm.amount, confirm.key);
      setConfirm(null); setRaw('');
      setDone(`${num(r.amount)} INEX is on its way to your Indexx Exchange INEX wallet.`);
      onDone(r);
    } catch (e) {
      if (e instanceof ApiError && e.code === ErrorCode.INDEXX_SIGN_IN) { setConfirm(null); onSignedOut(); return; }
      setError(errText(e)); // the same key is used if they try again, so it can't pay twice
    } finally { setBusy(false); }
  };
  return (
    <aside className="p2-card p2-card--pad p2-convert" aria-labelledby="wd">
      <h2 id="wd">Withdraw</h2>
      {!w.linked ? <p className="muted" style={{ margin: 0 }}>Sign in to Indexx to withdraw INEX to your Indexx Exchange INEX wallet.</p> : (
        <>
          {done && <Banner tone="success">{done}</Banner>}
          {error && !confirm && <Banner>{error}</Banner>}
          <div className={`ys-field${problem ? ' ys-field--error' : ''}`}>
            <label className="ys-field__label" htmlFor="amt">INEX to withdraw</label>
            <div className="ys-field__box"><input id="amt" className="ys-input p2-convert__input" inputMode="numeric" value={raw} onChange={(e) => { setRaw(e.target.value); setDone(null); setError(null); }} placeholder="0" aria-describedby="amt-hint" /><button type="button" className="link-btn" onClick={() => setRaw(String(max))} disabled={!quote || max < quote.minimum}>Max</button></div>
            <span className="ys-field__hint" id="amt-hint" role={problem ? 'alert' : undefined}>{problem ?? (quote ? `You have ${num(quote.balance)} INEX.` : ' ')}</span>
          </div>
          <div className="row center muted"><Icon name="arrow-down" size={18} /></div>
          <div className="p2-convert__to"><span className="ys-oval" style={{ width: 36, ['--ys-oval-fill' as string]: '#ffffff' }}><img src="/brand/products/exchange.png" alt="" /></span><span style={{ flex: 1, fontWeight: 700 }}>{quote?.destination ?? 'Indexx Exchange INEX wallet'}</span><strong>{current?.eligible ? num(n) : '—'}</strong></div>
          <dl className="p2-dl">
            <dt>Rate</dt><dd>1 INEX = 1 INEX on the exchange</dd>
            <dt>Minimum</dt><dd>{quote ? `${num(quote.minimum)} INEX` : '—'}</dd>
            {quote?.dailyMax != null && <><dt>Daily limit</dt><dd>{num(quote.dailyMax)} INEX</dd><dt>Left today</dt><dd>{num(quote.remainingToday)} INEX</dd></>}
          </dl>
          <div className="row center"><OvalButton icon="upload" label="Withdraw" size="lg" disabled={!current?.eligible} onClick={() => { setError(null); setConfirm({ amount: n, key: crypto.randomUUID() }); }} /></div>
        </>
      )}
      {confirm && (
        <Modal title="Withdraw INEX?" onClose={() => { if (!busy) setConfirm(null); }}>
          <div className="p2-confirm">
            <div><span className="muted">You send</span><strong>{num(confirm.amount)} INEX</strong></div>
            <Icon name="arrow-down" size={18} />
            <div><span className="muted">It arrives in</span><strong>Indexx Exchange INEX wallet</strong></div>
          </div>
          <dl className="p2-dl"><dt>Fee</dt><dd>None</dd><dt>Left in YaysApp</dt><dd>{quote ? `${num(quote.balance - confirm.amount)} INEX` : '—'}</dd></dl>
          <p className="muted p2-small" style={{ margin: 0 }}>Withdrawals can’t be undone. If the exchange can’t take it, your INEX comes back.</p>
          {error && <Banner>{error}</Banner>}
          <div className="row center"><OvalButton icon="close" label="Cancel" variant="ghost" disabled={busy} onClick={() => setConfirm(null)} /><OvalButton icon="check" label={error ? 'Try again' : 'Withdraw'} size="lg" loading={busy} onClick={() => void go()} /></div>
        </Modal>
      )}
    </aside>
  );
}

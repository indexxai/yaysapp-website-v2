'use client';
import { Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { INDEXX_LINKS, type IndexxEmmm, type IndexxShoperPal, type IndexxWallStreet } from '@yays/shared';
import { AppShell } from '@/components/app-shell';
import { IndexxSignIn } from '@/components/indexx-signin';
import { Banner, LineArt, OvalButton } from '@/components/ui';
import { useMe } from '@/components/use-me';
import { api } from '@/lib/api';
import { Icon } from '@/lib/icons';
import { money, num, PRODUCTS, shortDate, timeLeft, useLoad } from '@/lib/phase2';

const ABOUT: Record<string, string> = {
  emmm: 'Prediction markets on sports, crypto and world events.',
  shoperpal: 'Shop and sell, and earn BTCY on what you buy.',
  rehuman: 'Supplements and wellness from ReHuman.',
  wallstreet: 'Buy into companies, or list your own, on Wall Street Indexx.',
};
const TABS = PRODUCTS.filter((p) => p.id in ABOUT);
type Tab = 'emmm' | 'shoperpal' | 'rehuman' | 'wallstreet';

export default function ProductsPage() { return <Suspense fallback={null}><Products /></Suspense>; }

/** p14: one tab per Indexx product, with what YaysApp can show from the person's Indexx account. */
function Products() {
  const { me } = useMe();
  const router = useRouter();
  const asked = useSearchParams().get('tab');
  const p = TABS.find((x) => x.id === asked) ?? TABS[0]!;
  const tab = p.id as Tab;
  // Each answer remembers its tab, so a tab never shows the previous tab's data while its own loads.
  const loaded = useLoad(async () => (tab === 'rehuman' ? null : { tab, ...(await api().exploreProduct(tab)) }), [tab]);
  const v = { ...loaded, data: loaded.data?.tab === tab ? loaded.data : null };
  const ix = useLoad(() => api().indexx());
  const url = (v.data?.links ?? INDEXX_LINKS)[tab];
  return (
    <AppShell me={me}>
      <LineArt name="explorer" height={360} opacity={0.16} className="p2-art p2-art--br" />
      <div className="p2-page p2-page--narrow">
        <div className="p2-head"><OvalButton icon="arrow-left" label="Explore" size="sm" variant="ghost" href="/explore" /><h1>Products</h1></div>
        <div className="ys-tabs" role="tablist" aria-label="Products">
          {TABS.map((t) => <button key={t.id} type="button" role="tab" className="ys-tab" aria-selected={t.id === p.id} onClick={() => router.replace(`/products?tab=${t.id}`)}>{t.name}</button>)}
        </div>
        <section className="p2-card p2-card--pad">
          <div className="row" style={{ gap: 14 }}>
            <span className="ys-oval" style={{ width: 56, ['--ys-oval-fill' as string]: '#ffffff' }}><img src={p.logo} alt="" /></span>
            <span className="p2-col" style={{ flex: 1 }}><strong style={{ fontSize: 18 }}>{p.name}</strong><span className="muted">{p.sub}</span></span>
            <a className="ys-ovalbtn ys-ovalbtn--sm ys-ovalbtn--primary" href={url} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none' }}><span className="ys-oval"><Icon name="external" size={16} /></span><span className="ys-ovalbtn__label">Open {p.name}</span></a>
          </div>
          <p className="muted" style={{ margin: 0 }}>{ABOUT[tab]}</p>
        </section>
        {v.error && <Banner>{v.error}</Banner>}
        {tab !== 'rehuman' && v.data && !v.data.linked && ix.data && (
          <IndexxSignIn email={ix.data.email ?? me?.email ?? null} ended={!!ix.data.email} onDone={(s) => { ix.setData(s); void v.reload(); }} />
        )}
        {tab !== 'rehuman' && v.data?.linked && !v.data.data && <Banner tone="warning">{p.name} didn’t answer. Try again in a minute.</Banner>}
        {tab === 'emmm' && v.data?.data && <Emmm e={v.data.data as IndexxEmmm} />}
        {tab === 'shoperpal' && v.data?.linked && v.data.data && <ShoperPal s={v.data.data as IndexxShoperPal} url={url} />}
        {tab === 'wallstreet' && v.data?.data && <WallStreet w={v.data.data as IndexxWallStreet} />}
        <p className="muted p2-small">Shown for information. Trades and purchases happen in each product, not in YaysApp.</p>
      </div>
    </AppShell>
  );
}

const TONE: Record<string, string> = { open: 'warning', won: 'success', lost: 'danger' };

function Emmm({ e }: { e: IndexxEmmm }) {
  return (
    <>
      <div className="p2-stats p2-stats--cards">
        <div><b data-testid="emmm-open">{num(e.openPositions)}</b><span>Open positions</span></div>
        <div><b>{num(e.settledThisMonth?.count)}</b><span>Settled this month{e.settledThisMonth?.payoutUsd ? ` · ${money(e.settledThisMonth.payoutUsd)} paid` : ''}</span></div>
      </div>
      <section className="p2-card" aria-labelledby="mk">
        <h2 id="mk" className="p2-card__title">Your markets</h2>
        {!e.markets.length && <p className="muted" style={{ margin: '0 18px 18px' }}>No markets yet. Trades happen in EMMM.</p>}
        {e.markets.map((m) => (
          <div key={m.marketSlug} className="ys-row-item">
            <span className="ys-row-item__text">
              <span className="ys-row-item__title" style={{ whiteSpace: 'normal' }}>{m.title}</span>
              <span className="ys-row-item__sub">
                {m.outcome ? `${m.outcome} · ` : ''}{num(m.shares)} shares · staked {money(m.stakeUsd)}
                {m.status === 'open' ? ` · now ${money(m.currentValue)}` : m.status === 'won' ? ` · paid ${money(m.payoutUsd)}` : ''}
                {m.settledAt ? ` · ${shortDate(m.settledAt)}` : ''}
              </span>
            </span>
            <span className={`ys-tag ys-tag--${TONE[m.status] ?? 'neutral'}`}>{m.status === 'open' ? 'Open' : m.status === 'won' ? 'Won' : 'Lost'}</span>
          </div>
        ))}
      </section>
    </>
  );
}

/** ShoperPal's order states, in plain words. */
const ORDER: Record<string, string> = { PENDING: 'Waiting for payment', PAYMENT_CONFIRMED: 'Paid', PROCESSING: 'Being prepared', SHIPPED: 'Shipped', DELIVERED: 'Delivered', CANCELLED: 'Cancelled', REFUNDED: 'Refunded' };
const orderWord = (s: string) => ORDER[s] ?? s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, ' ');

function ShoperPal({ s, url }: { s: IndexxShoperPal; url: string }) {
  if (s.role === 'seller' && s.supplier) {
    const x = s.supplier;
    return (
      <>
        <div className="p2-stats p2-stats--cards" data-testid="shoperpal-seller">
          <div><b>{num(x.productsListed)}{x.productsLimit != null ? ` / ${num(x.productsLimit)}` : ''}</b><span>Products in your store</span></div>
          <div><b>{num(x.ordersToday)}</b><span>Orders today</span></div>
          <div><b>{num(x.pendingOrders)}</b><span>Paid, not shipped yet</span></div>
          <div><b>{money(x.earnings?.available)}</b><span>Available{x.earnings?.pendingAmount ? ` · ${money(x.earnings.pendingAmount)} pending` : ''}</span></div>
        </div>
        <section className="p2-card p2-card--pad">
          <dl className="p2-dl">
            <dt>Plan</dt><dd>{x.plan ?? '—'}</dd>
            <dt>Commission</dt><dd>{x.commission ?? '—'}</dd>
            {x.aiCredits && <><dt>AI credits</dt><dd>{num(x.aiCredits.used)} of {num(x.aiCredits.total)} used{x.aiCredits.resetsInDays != null ? ` · resets in ${x.aiCredits.resetsInDays} days` : ''}</dd></>}
            {x.earnings && <><dt>Earned in total</dt><dd>{money(x.earnings.totalEarned)}</dd></>}
          </dl>
        </section>
      </>
    );
  }
  const b = s.buyer;
  if (!b) {
    return (
      <div className="p2-card p2-card--pad p2-link-cta">
        <span className="p2-col" style={{ flex: 1 }}><strong>No ShoperPal account yet</strong><span className="muted">Shop on ShoperPal with your Indexx email to earn BTCY on what you buy.</span></span>
        <a className="ys-ovalbtn ys-ovalbtn--sm ys-ovalbtn--soft" href={url} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none' }}><span className="ys-oval"><Icon name="external" size={16} /></span><span className="ys-ovalbtn__label">Open ShoperPal</span></a>
      </div>
    );
  }
  return (
    <>
      <div className="p2-stats p2-stats--cards" data-testid="shoperpal-buyer">
        <div><b>{money(b.monthSpend)}</b><span>Spent this month · {num(b.orderCount)} orders</span></div>
        <div><b>{num(b.nuggets?.released, 2)}</b><span>Nuggets earned{b.nuggets?.pending ? ` · ${num(b.nuggets.pending, 2)} on the way` : ''}</span></div>
      </div>
      {b.flash && <Banner tone="info">Flash deal: {b.flash.title} · ends in {timeLeft(b.flash.endsAt)}</Banner>}
      <section className="p2-card" aria-labelledby="buys">
        <h2 id="buys" className="p2-card__title">Recent purchases</h2>
        {!b.recentPurchases.length && <p className="muted" style={{ margin: '0 18px 18px' }}>No purchases yet.{b.earnRate ? ` You earn ${b.earnRate}.` : ''}</p>}
        {b.recentPurchases.map((o) => (
          <div key={o.id} className="ys-row-item">
            <span className="ys-row-item__text">
              <span className="ys-row-item__title" style={{ whiteSpace: 'normal' }}>{o.items.map((i) => (i.quantity > 1 ? `${i.name} ×${i.quantity}` : i.name)).join(', ') || 'Order'}</span>
              <span className="ys-row-item__sub">{shortDate(o.createdAt)} · {money(o.total)}</span>
            </span>
            <span className={`ys-tag ys-tag--${/SHIPPED|DELIVERED/.test(o.status) ? 'success' : /CANCEL|REFUND/.test(o.status) ? 'danger' : 'warning'}`}>{orderWord(o.status)}</span>
          </div>
        ))}
      </section>
    </>
  );
}

function WallStreet({ w }: { w: IndexxWallStreet }) {
  return (
    <>
      <div className="p2-stats p2-stats--cards">
        <div><b data-testid="ws-stocks">{num(w.holdings.count)}</b><span>Stocks bought · {money(w.holdings.totalInvested)} invested</span></div>
        <div><b>{num(w.listings.count)}</b><span>Companies you listed</span></div>
      </div>
      <section className="p2-card" aria-labelledby="hold">
        <h2 id="hold" className="p2-card__title">Stocks you bought</h2>
        {!w.holdings.items.length && <p className="muted" style={{ margin: '0 18px 18px' }}>None yet. Buy into companies on Wall Street Indexx.</p>}
        {w.holdings.items.map((h) => (
          <div key={h.campaignId} className="ys-row-item">
            <span className="ys-oval ys-oval--wash" style={{ width: 40, fontWeight: 800, fontSize: 11 }}>{h.tokenSymbol.slice(0, 4)}</span>
            <span className="ys-row-item__text"><span className="ys-row-item__title">{h.tokenName}</span><span className="ys-row-item__sub">{num(h.tokensReceived)} {h.tokenSymbol} · last bought {shortDate(h.lastPurchasedAt)}</span></span>
            <strong>{money(h.amountInvested)}</strong>
          </div>
        ))}
        {w.holdings.count > w.holdings.items.length && <p className="muted p2-small" style={{ margin: '0 18px 18px' }}>Showing {w.holdings.items.length} of {w.holdings.count}.</p>}
      </section>
      <section className="p2-card" aria-labelledby="list">
        <h2 id="list" className="p2-card__title">Companies you listed</h2>
        {!w.listings.items.length && <p className="muted" style={{ margin: '0 18px 18px' }}>None. You can list your company on Wall Street Indexx.</p>}
        {w.listings.items.map((l) => {
          const pctRaised = l.fundingGoal ? Math.min(100, Math.round(((l.raised ?? 0) / l.fundingGoal) * 100)) : 0;
          return (
            <div key={l.campaignId} className="ys-row-item" style={{ alignItems: 'flex-start' }}>
              <span className="ys-oval" style={{ width: 40, ['--ys-oval-fill' as string]: '#ffffff' }}>{l.logo ? <img src={l.logo} alt="" /> : <Icon name="briefcase" size={18} />}</span>
              <span className="ys-row-item__text" style={{ gap: 6 }}>
                <span className="ys-row-item__title">{l.companyName} · {l.tokenSymbol}</span>
                <span className="ys-row-item__sub">{money(l.raised)} of {money(l.fundingGoal)} · {num(l.investors)} investors{l.deadline ? ` · ends ${shortDate(l.deadline)}` : ''}</span>
                <span className="p2-meter" aria-label={`${pctRaised}% raised`}><span style={{ width: `${pctRaised}%` }} /></span>
              </span>
              <span className="p2-col" style={{ gap: 4, alignItems: 'flex-end' }}>
                <span className="ys-tag">{l.status.charAt(0).toUpperCase() + l.status.slice(1)}</span>
                {l.verificationStatus === 'verified' && <span className="ys-tag ys-tag--success">Verified</span>}
              </span>
            </div>
          );
        })}
      </section>
    </>
  );
}

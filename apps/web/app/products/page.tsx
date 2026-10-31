'use client';
import { Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AppShell } from '@/components/app-shell';
import { Banner, LineArt, OvalButton } from '@/components/ui';
import { useMe } from '@/components/use-me';
import { api } from '@/lib/api';
import { Icon } from '@/lib/icons';
import { PRODUCTS, useLoad } from '@/lib/phase2';

const SITES: Record<string, { url: string; about: string }> = {
  emmm: { url: 'https://emmm.indexx.ai', about: 'Prediction markets on sports, crypto and world events.' },
  shoperpal: { url: 'https://shoperpal.com', about: 'Deals and cashback from shops you already use.' },
  rehuman: { url: 'https://rehuman.com', about: 'Supplements and wellness from ReHuman.' },
  wallstreet: { url: 'https://wallstreet.indexx.ai', about: 'Stock and crypto market tokens on Indexx.' },
};
const TABS = PRODUCTS.filter((p) => p.id in SITES);

export default function ProductsPage() { return <Suspense fallback={null}><Products /></Suspense>; }

/** p14: one tab per Indexx product, with what YaysApp can show from the linked account. */
function Products() {
  const { me } = useMe();
  const router = useRouter();
  const tab = useSearchParams().get('tab') ?? 'emmm';
  const v = useLoad(() => api().products());
  const p = TABS.find((x) => x.id === tab) ?? TABS[0]!;
  const site = SITES[p.id]!;
  const e = v.data?.emmm;
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
            <span className="p2-col" style={{ flex: 1 }}><strong style={{ fontSize: 18 }}>{p.name}</strong><span className="muted">{p.id === 'emmm' && e?.handle ? `${p.sub} · connected as ${e.handle}` : p.sub}</span></span>
            <a className="ys-ovalbtn ys-ovalbtn--sm ys-ovalbtn--primary" href={site.url} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none' }}><span className="ys-oval"><Icon name="external" size={16} /></span><span className="ys-ovalbtn__label">Open {p.name}</span></a>
          </div>
          <p className="muted" style={{ margin: 0 }}>{site.about}</p>
        </section>
        {v.error && <Banner>{v.error}</Banner>}
        {p.id === 'emmm' && v.data && (!v.data.linked ? (
          <div className="p2-card p2-card--pad p2-link-cta"><span className="p2-col" style={{ flex: 1 }}><strong>Link your Indexx account</strong><span className="muted">See your EMMM positions here.</span></span><OvalButton icon="link" label="Link account" size="sm" href="/settings/indexx" /></div>
        ) : e ? (
          <>
            <div className="p2-stats p2-stats--cards"><div><b>{e.open}</b><span>Open positions</span></div><div><b>{e.settledThisMonth}</b><span>Settled this month</span></div></div>
            <section className="p2-card" aria-labelledby="mk">
              <h2 id="mk" className="p2-card__title">Your markets</h2>
              {!e.markets.length && <p className="muted" style={{ margin: '0 18px 18px' }}>No open markets. Trades happen in EMMM.</p>}
              {e.markets.map((m) => (
                <div key={m.question} className="ys-row-item">
                  <span className="ys-row-item__text"><span className="ys-row-item__title" style={{ whiteSpace: 'normal' }}>{m.question}</span><span className="ys-row-item__sub">{m.closes}</span></span>
                  <span className={`ys-tag ys-tag--${m.side === 'yes' ? 'success' : m.side === 'no' ? 'danger' : 'warning'}`}>{m.side === 'yes' ? 'Yes' : m.side === 'no' ? 'No' : 'Pending'}</span>
                </div>
              ))}
            </section>
          </>
        ) : <Banner tone="warning">EMMM didn’t answer. Try again in a minute.</Banner>)}
        <p className="muted p2-small">Shown for information. Trades and purchases happen in each product, not in YaysApp.</p>
      </div>
    </AppShell>
  );
}

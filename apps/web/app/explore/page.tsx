'use client';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { AppShell } from '@/components/app-shell';
import { CheckinPopup } from '@/components/popups';
import { LineArt, OvalButton } from '@/components/ui';
import { useMe } from '@/components/use-me';
import { api } from '@/lib/api';
import { Icon, type IconName } from '@/lib/icons';
import { PRODUCTS, useLoad } from '@/lib/phase2';

const TILES: Array<{ title: string; sub: string; icon: IconName; href: string }> = [
  { title: 'Wallet', sub: 'INEX, Nuggets and USDXX', icon: 'wallet', href: '/wallet' },
  { title: 'Invite friends', sub: '+100 INEX each', icon: 'person-add', href: '/earn/invite' },
  { title: 'Help and support', sub: 'AI answers, then a person', icon: 'help', href: '/settings/help' },
];

/** W1: Jack's AI, today's check-in, the Indexx products and shortcuts. */
export default function ExplorePage() {
  const { me } = useMe();
  const [q, setQ] = useState('');
  const [claiming, setClaiming] = useState(false);
  const checkin = useLoad(() => api().checkin());
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return t ? PRODUCTS.filter((p) => `${p.name} ${p.sub}`.toLowerCase().includes(t)) : PRODUCTS;
  }, [q]);
  const c = checkin.data;
  return (
    <AppShell me={me}>
      <LineArt name="skater" height={420} opacity={0.2} className="p2-art p2-art--br" />
      <LineArt name="coins" height={200} opacity={0.16} className="p2-art p2-art--bl" />
      <div className="p2-page">
        <div className="p2-head">
          <h1>Explore</h1>
          <div className="ys-field ys-field--pill p2-search"><div className="ys-field__box"><Icon name="search" size={18} /><input className="ys-input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search products and features" aria-label="Search products and features" /></div></div>
        </div>

        <div className="p2-grid p2-grid--2-1">
          <Link href="/ai" className="p2-jack-card">
            <span className="ys-feature__deco a" />
            <LineArt name="gear" width={160} ink="#ffffff" opacity={0.6} className="p2-jack-card__art" />
            <span className="p2-jack-card__logo"><img src="/brand/jack.png" alt="" /></span>
            <span className="p2-jack-card__text"><strong>Ask Jack’s AI</strong><span>Questions, writing, translations and help with any Indexx product.</span></span>
          </Link>
          <div className="p2-card p2-checkin-tile">
            <div className="row" style={{ gap: 12 }}><span className="ys-oval ys-oval--wash" style={{ width: 48 }}><Icon name="gift" size={22} /></span><span className="p2-col"><strong>Daily check-in</strong><span className="muted">{c ? (c.claimedToday ? `Claimed · day ${c.streak} streak` : c.streak ? `Day ${c.streak + 1} streak` : 'Start a streak') : '…'}</span></span></div>
            <div className="p2-big">{c ? (c.claimedToday ? `Tomorrow +${c.tomorrowPoints}` : `+${c.todayPoints} INEX`) : ' '}</div>
            {c && !c.claimedToday ? <OvalButton icon="check" label="Claim" size="md" onClick={() => setClaiming(true)} /> : <OvalButton icon="star" label="Ways to earn" size="md" variant="soft" href="/earn" />}
          </div>
        </div>

        <section className="p2-card p2-card--pad" aria-labelledby="prod">
          <h2 id="prod">Indexx products</h2>
          <div className="p2-products">
            {shown.map((p) => {
              const inner = (<><span className="ys-oval" style={{ width: 60, ['--ys-oval-fill' as string]: '#ffffff' }}><img src={p.logo} alt="" /></span><strong>{p.name}</strong><span className="muted">{p.sub}</span></>);
              return p.href ? <Link key={p.id} href={p.href} className="p2-product">{inner}</Link> : <div key={p.id} className="p2-product p2-product--soon" aria-disabled="true">{inner}</div>;
            })}
            {!shown.length && <p className="muted">Nothing matches “{q}”.</p>}
          </div>
        </section>

        <div className="p2-grid p2-grid--3">
          {TILES.map((t) => (
            <Link key={t.href} href={t.href} className="p2-tile">
              <span className="ys-oval ys-oval--wash" style={{ width: 44 }}><Icon name={t.icon} size={20} /></span>
              <span className="p2-col" style={{ flex: 1 }}><strong>{t.title}</strong><span className="muted">{t.sub}</span></span>
              <Icon name="chevron-right" size={18} />
            </Link>
          ))}
        </div>
      </div>
      {claiming && c && me && <CheckinPopup first={me.displayName.split(/\s+/)[0]!} status={c} onClose={() => { setClaiming(false); void checkin.reload(); }} />}
    </AppShell>
  );
}

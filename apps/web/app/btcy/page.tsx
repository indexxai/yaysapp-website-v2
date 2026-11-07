'use client';
import { AppShell } from '@/components/app-shell';
import { BackButton } from '@/components/back';
import { IndexxSignIn } from '@/components/indexx-signin';
import { Banner, LineArt, OvalButton } from '@/components/ui';
import { useMe } from '@/components/use-me';
import { api } from '@/lib/api';
import { Icon, type IconName } from '@/lib/icons';
import { num, useLoad } from '@/lib/phase2';

/** "5h 12m" from seconds. */
const left = (s: number) => { const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return h ? `${h}h ${m}m` : `${m}m`; };

/** W6: mining, nuggets mined in the last 7 days, team and boost, from the person's Indexx account. */
export default function BtcyPage() {
  const { me } = useMe();
  const v = useLoad(() => api().exploreProduct('btcy'));
  const ix = useLoad(() => api().indexx());
  const b = v.data?.data ?? null;
  const site = v.data?.links.btcy ?? 'https://bitcoinyay.com';
  const days = b?.last7Days.days ?? [];
  const max = Math.max(0.0001, ...days.map((d) => d.nuggets ?? 0));
  const stats: Array<{ label: string; value: string; sub: string; icon: IconName }> = b ? [
    { label: 'BTCY tokens', value: num(b.portfolio.tokens), sub: 'Read-only', icon: 'bitcoin' },
    { label: 'Mining streak', value: b.mining.streakDays == null ? '—' : `${b.mining.streakDays} day${b.mining.streakDays === 1 ? '' : 's'}`, sub: b.mining.bestStreakDays != null ? `Best ${b.mining.bestStreakDays} days` : 'Days in a row', icon: 'flash' },
    { label: 'Team', value: `${num(b.team.miningNow)} of ${num(b.team.members)}`, sub: 'mining now', icon: 'people' },
    { label: 'Boost', value: b.boost.percent == null ? '—' : `+${b.boost.percent}%`, sub: '+5% for each teammate mining, up to +50%', icon: 'trending-up' },
  ] : [];
  return (
    <AppShell me={me}>
      <LineArt name="trader" height={380} opacity={0.18} className="p2-art p2-art--br" />
      <div className="p2-page">
        <div className="p2-head">
          <BackButton to="/explore" label="Explore" />
          <h1 className="row" style={{ gap: 10 }}><img src="/brand/products/btcy.png" alt="" style={{ height: '1.2em' }} />BTCY</h1>
          <a className="ys-ovalbtn ys-ovalbtn--sm ys-ovalbtn--soft" href={site} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none' }}><span className="ys-oval"><Icon name="external" size={16} /></span><span className="ys-ovalbtn__label">Open BTCY</span></a>
        </div>
        {v.error && <Banner>{v.error}</Banner>}
        {v.data && !v.data.linked && ix.data && (
          <IndexxSignIn email={ix.data.email ?? me?.email ?? null} ended={!!ix.data.email} sub="See your mining, Nuggets, team and boost here. BTCY bonus tasks count toward INEX." onDone={(s) => { ix.setData(s); void v.reload(); }} />
        )}
        {v.data?.linked && !b && <Banner tone="warning">BTCY didn’t answer. Try again in a minute.</Banner>}
        {b && (
          <div className="p2-grid p2-grid--btcy">
            <div className="p2-btcy-hero">
              <span className="ys-feature__deco a" />
              <img src="/brand/coin.png" alt="" />
              <div className="p2-col" style={{ gap: 4, position: 'relative' }}>
                <span className="p2-pill"><span className={`p2-dot${b.mining.active ? ' on' : ''}`} />{b.mining.active ? (b.mining.endsInSeconds != null ? `Mining active · ${left(b.mining.endsInSeconds)} left` : 'Mining active') : 'Not mining'}</span>
                <div className="p2-btcy-hero__num" data-testid="btcy-nuggets">{num(b.portfolio.nuggets, 2)}</div>
                <span>BTCY Nuggets{b.mining.plan ? ` · ${b.mining.plan} plan` : ''}{b.mining.speed != null ? ` · ${b.mining.speed}× speed` : ''}</span>
                <div style={{ marginTop: 10 }}>
                  <a className="ys-ovalbtn ys-ovalbtn--md ys-ovalbtn--secondary" href={site} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none' }}><span className="ys-oval"><Icon name="flash" size={18} /></span><span className="ys-ovalbtn__label">{b.mining.active ? 'Open in BTCY' : 'Keep mining'}</span></a>
                </div>
              </div>
            </div>
            <section className="p2-card p2-card--pad" aria-labelledby="week">
              <div className="p2-col"><h2 id="week">Nuggets mined, last 7 days</h2><span className="muted p2-small">Total {num(b.last7Days.total, 2)} · today’s bar fills in when the running session ends</span></div>
              <div className="p2-bars" role="img" aria-label={`Nuggets mined each day, ${num(b.last7Days.total, 2)} in total`}>
                {days.map((d, i) => <div key={d.date}><span style={{ height: `${Math.round(((d.nuggets ?? 0) / max) * 120)}px`, background: i === days.length - 1 ? 'var(--ember)' : 'var(--ember-light)' }} title={num(d.nuggets, 4)} /><span>{d.label}</span></div>)}
              </div>
            </section>
            <div className="p2-statgrid">
              {stats.map((s) => <div key={s.label} className="p2-stat"><span className="muted p2-small row" style={{ gap: 6 }}><Icon name={s.icon} size={16} />{s.label}</span><strong>{s.value}</strong><span className="muted p2-xs">{s.sub}</span></div>)}
            </div>
            <section className="p2-card p2-card--pad" aria-labelledby="team">
              <h2 id="team" style={{ margin: 0 }}>Your team</h2>
              <div className="p2-stats p2-stats--cards">
                <div><b>{num(b.team.members)}</b><span>Friends on your team</span></div>
                <div><b>{num(b.team.miningNow)}</b><span>Mining now</span></div>
              </div>
              {b.referrals && <p className="muted p2-small" style={{ margin: 0 }}>{num(b.referrals.active)} of {num(b.referrals.target)} active friends unlock the mining station{b.station?.unlocked ? ' (unlocked)' : ''}.</p>}
              <div className="row center"><OvalButton icon="person-add" label="Invite friends" size="sm" variant="soft" href="/earn/invite" /></div>
            </section>
          </div>
        )}
      </div>
    </AppShell>
  );
}

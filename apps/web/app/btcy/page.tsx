'use client';
import { useState } from 'react';
import { AppShell } from '@/components/app-shell';
import { Avatar, Banner, LineArt, OvalButton } from '@/components/ui';
import { useMe } from '@/components/use-me';
import { api } from '@/lib/api';
import { Icon, type IconName } from '@/lib/icons';
import { errText, fmtNuggets, timeLeft, useLoad } from '@/lib/phase2';

const BTCY_SITE = process.env.NEXT_PUBLIC_BTCY_URL ?? 'https://btcy.indexx.ai';

/** W6: mining, nuggets mined this week, team. Read from the linked Indexx account. */
export default function BtcyPage() {
  const { me } = useMe();
  const v = useLoad(() => api().btcy());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mine = async () => { setBusy(true); setError(null); try { v.setData(await api().keepMining()); } catch (e) { setError(errText(e)); } finally { setBusy(false); } };
  const b = v.data;
  const max = Math.max(0.0001, ...(b?.mining.last7.map((d) => d.amount) ?? [0]));
  const total = b?.mining.last7.reduce((n, d) => n + d.amount, 0) ?? 0;
  const day = (k: string, i: number) => (i === 6 ? 'Today' : new Date(`${k}T12:00:00Z`).toLocaleDateString([], { weekday: 'short' }));
  const stats: Array<{ label: string; value: string; sub: string; icon: IconName }> = b ? [
    { label: 'BTCY tokens', value: b.tokens.toLocaleString('en-US'), sub: 'Read-only', icon: 'bitcoin' },
    { label: 'Mining streak', value: `${b.mining.streak} day${b.mining.streak === 1 ? '' : 's'}`, sub: `Best ${b.mining.best} days`, icon: 'flash' },
    { label: 'Team', value: `${b.team.filter((t) => t.mining).length} of ${b.team.length}`, sub: 'mining now', icon: 'people' },
    { label: 'Boost', value: `+${b.boostPct}%`, sub: 'From your team', icon: 'trending-up' },
  ] : [];
  return (
    <AppShell me={me}>
      <LineArt name="trader" height={380} opacity={0.18} className="p2-art p2-art--br" />
      <div className="p2-page">
        <div className="p2-head">
          <h1 className="row" style={{ gap: 10 }}><img src="/brand/products/btcy.png" alt="" style={{ height: '1.2em' }} />BTCY</h1>
          <a className="ys-ovalbtn ys-ovalbtn--sm ys-ovalbtn--soft" href={BTCY_SITE} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none' }}><span className="ys-oval"><Icon name="external" size={16} /></span><span className="ys-ovalbtn__label">Open BTCY</span></a>
        </div>
        {v.error && <Banner>{v.error}</Banner>}
        {b && !b.linked && (
          <div className="p2-card p2-card--pad p2-link-cta">
            <img src="/brand/btcy-coin.png" alt="" style={{ width: 64 }} />
            <span className="p2-col" style={{ flex: 1 }}><strong>Link your Indexx account to see BTCY here</strong><span className="muted">Your mining, Nuggets and team, and BTCY bonus tasks count toward INEX.</span></span>
            <OvalButton icon="link" label="Link account" size="sm" href="/settings/indexx" />
          </div>
        )}
        {b?.linked && (
          <div className="p2-grid p2-grid--btcy">
            <div className="p2-btcy-hero">
              <span className="ys-feature__deco a" />
              <img src="/brand/coin.png" alt="" />
              <div className="p2-col" style={{ gap: 4, position: 'relative' }}>
                <span className="p2-pill"><span className={`p2-dot${b.mining.active ? ' on' : ''}`} />{b.mining.active && b.mining.endsAt ? `Mining active · ${timeLeft(b.mining.endsAt)} left` : 'Not mining'}</span>
                <div className="p2-btcy-hero__num">{fmtNuggets(b.mining.nuggets, 4)}</div>
                <span>BTCY Nuggets · +{fmtNuggets(b.mining.perHour, 4)} per hour</span>
                {error && <span className="p2-hero-error" role="alert">{error}</span>}
                <div style={{ marginTop: 10 }}><OvalButton icon="flash" label={b.mining.active ? 'Mining' : 'Keep mining'} size="md" variant="secondary" loading={busy} disabled={b.mining.active} onClick={() => void mine()} /></div>
              </div>
            </div>
            <section className="p2-card p2-card--pad" aria-labelledby="week">
              <div className="p2-col"><h2 id="week">Nuggets mined, last 7 days</h2><span className="muted p2-small">Total {fmtNuggets(total)}</span></div>
              <div className="p2-bars" role="img" aria-label={`Nuggets mined each day, ${fmtNuggets(total)} in total`}>
                {b.mining.last7.map((d, i) => <div key={d.day}><span style={{ height: `${Math.round((d.amount / max) * 120)}px`, background: i === 6 ? 'var(--ember)' : 'var(--ember-light)' }} title={`${fmtNuggets(d.amount, 4)}`} /><span>{day(d.day, i)}</span></div>)}
              </div>
            </section>
            <div className="p2-statgrid">
              {stats.map((s) => <div key={s.label} className="p2-stat"><span className="muted p2-small row" style={{ gap: 6 }}><Icon name={s.icon} size={16} />{s.label}</span><strong>{s.value}</strong><span className="muted p2-xs">{s.sub}</span></div>)}
            </div>
            <section className="p2-card" aria-labelledby="team">
              <h2 id="team" className="p2-card__title">Your team</h2>
              {!b.team.length && <p className="muted" style={{ margin: '0 18px 18px' }}>Invite friends to BTCY to build a team and boost your mining.</p>}
              {b.team.map((t) => (
                <div key={t.name + t.joinedAt} className="ys-row-item">
                  <Avatar name={t.name} size={36} />
                  <span className="ys-row-item__text"><span className="ys-row-item__title">{t.name}</span><span className="ys-row-item__sub">{t.mining ? `Joined ${new Date(t.joinedAt).toLocaleDateString([], { day: 'numeric', month: 'short' })}` : t.lastActiveAt ? `Session ended ${timeLeftAgo(t.lastActiveAt)}` : 'Hasn’t started yet'}</span></span>
                  {t.mining ? <span className="ys-tag ys-tag--success">Mining</span> : <span className="ys-tag">Idle</span>}
                </div>
              ))}
            </section>
          </div>
        )}
      </div>
    </AppShell>
  );
}

const timeLeftAgo = (iso: string) => { const d = Math.floor((Date.now() - Date.parse(iso)) / 86400_000); return d < 1 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`; };

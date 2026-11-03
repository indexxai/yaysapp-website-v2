'use client';
import { useState } from 'react';
import { AppShell } from '@/components/app-shell';
import { CheckinPopup, CheckinWeek, TaskList } from '@/components/popups';
import { Banner, LineArt, OvalButton } from '@/components/ui';
import { useMe } from '@/components/use-me';
import { api } from '@/lib/api';
import { Bar, errText, fmtPoints, inviteLink, refreshBalance, setBalance, useLoad } from '@/lib/phase2';

/** W3: points balance, the daily check-in, ways to earn today, bonuses and invites. */
export default function EarnPage() {
  const { me } = useMe();
  const points = useLoad(() => api().points());
  const checkin = useLoad(() => api().checkin());
  const today = useLoad(() => api().earnToday());
  const bonuses = useLoad(() => api().bonuses());
  const refs = useLoad(() => api().referrals());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [popup, setPopup] = useState(false);
  const claim = async () => {
    setBusy(true); setError(null);
    try { const s = await api().claimCheckin(); checkin.setData(s); setBalance(s.balance); setPopup(true); void points.reload(); void today.reload(); }
    catch (e) { setError(errText(e)); } finally { setBusy(false); }
  };
  const copy = async () => { if (!refs.data) return; try { await navigator.clipboard.writeText(inviteLink(refs.data.code)); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* no clipboard */ } };
  const p = points.data, c = checkin.data, t = today.data, r = refs.data;
  return (
    <AppShell me={me}>
      <LineArt name="coins" height={300} opacity={0.18} className="p2-art p2-art--br" />
      <div className="p2-page">
        <div className="p2-head"><h1>Earn</h1></div>
        {(points.error || checkin.error) && <Banner>{points.error ?? checkin.error}</Banner>}
        <div className="p2-grid p2-grid--earn">
          <div className="p2-hero">
            <span className="ys-feature__deco a" />
            <img src="/brand/coin.png" alt="" className="p2-hero__coin" />
            <span className="p2-hero__eyebrow">INEX</span>
            <div className="p2-hero__num" data-testid="points-balance">{p ? fmtPoints(p.balance) : '—'}</div>
            <span>{p ? `+${fmtPoints(p.earnedThisWeek)} this week${p.pending ? ` · ${fmtPoints(p.pending)} pending` : ''}` : ' '}</span>
            <div className="row" style={{ gap: 26, marginTop: 18 }}>
              <OvalButton icon="swap" label="Convert" size="md" variant="secondary" href="/wallet" />
              <OvalButton icon="clock" label="History" size="md" variant="secondary" href="/earn/history" />
            </div>
          </div>

          <section className="p2-card p2-card--pad" aria-labelledby="streak">
            <div className="p2-card__head"><h2 id="streak">Daily check-in</h2>{c && <span className="p2-accent">{c.streak ? `${c.streak}-day streak` : 'No streak yet'}</span>}</div>
            {c && <CheckinWeek status={c} />}
            {error && <Banner>{error}</Banner>}
            <div className="row center">{c && (c.claimedToday ? <span className="muted">Claimed today. Tomorrow: +{c.tomorrowPoints}</span> : <OvalButton icon="gift" label={`Claim +${c.todayPoints} today`} size="md" loading={busy} onClick={() => void claim()} />)}</div>
          </section>

          <section className="p2-card" aria-labelledby="acts">
            <h2 id="acts" className="p2-card__title">Ways to earn today</h2>
            {t && <TaskList tasks={t.tasks} compact />}
            {t && <div className="p2-cap"><span>Daily cap</span><Bar done={t.capUsed} of={t.cap} width={140} /><strong>{t.capUsed} / {t.cap}</strong></div>}
          </section>

          <section className="p2-card p2-card--pad" aria-labelledby="ref">
            <h2 id="ref">Invite friends</h2>
            <p className="muted" style={{ margin: 0 }}>Get 100 INEX when a friend joins with your code, verifies their number and sends a first message.</p>
            <div className="p2-code"><strong>{r?.code ?? '…'}</strong><OvalButton icon={copied ? 'check' : 'copy'} label={copied ? 'Copied' : 'Copy link'} size="sm" onClick={() => void copy()} disabled={!r} /></div>
            <div className="p2-stats">
              <div><b>{r?.invited ?? '–'}</b><span>Invited</span></div>
              <div><b>{r?.joined ?? '–'}</b><span>Joined</span></div>
              <div><b>{r?.pending ?? '–'}</b><span>Pending</span></div>
            </div>
            <div className="row center"><OvalButton icon="people" label="Your invites" size="sm" variant="soft" href="/earn/invite" /></div>
          </section>

          {bonuses.data?.map((b) => (
            <section key={b.id} className="p2-card" aria-labelledby={`b-${b.id}`}>
              <div className="p2-card__head p2-card__head--pad">
                <img src={b.product === 'jack' ? '/brand/jack-bunny.png' : '/brand/btcy-coin.png'} alt="" className="p2-bonus-thumb" />
                <span className="p2-col" style={{ flex: 1 }}><span className="ys-eyebrow">{b.eyebrow}</span><h2 id={`b-${b.id}`}>{b.complete ? `+${b.paid} earned` : `Up to +${b.points}`}</h2></span>
                <OvalButton icon={b.product === 'jack' ? 'sparkles' : 'bitcoin'} label={b.product === 'jack' ? 'Ask Jack' : b.needsLink ? 'Link Indexx' : 'Open BTCY'} size="sm" variant="soft" href={b.product === 'jack' ? '/ai' : b.needsLink ? '/settings/indexx' : '/btcy'} />
              </div>
              <TaskList tasks={b.tasks} compact />
            </section>
          ))}
        </div>
      </div>
      {popup && c && me && <CheckinPopup first={me.displayName.split(/\s+/)[0]!} status={c} onClose={() => { setPopup(false); void refreshBalance(); }} />}
    </AppShell>
  );
}

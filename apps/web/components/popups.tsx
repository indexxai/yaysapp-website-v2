'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import type { BonusCampaign, CheckinStatus, MeProfile } from '@yays/shared';
import { api } from '@/lib/api';
import { Icon, type IconName } from '@/lib/icons';
import { applyStoredRef, Bar, errText, fmtPoints, setBalance, timeLeft } from '@/lib/phase2';
import { Banner, LineArt, OvalButton } from './ui';

const SEEN = 'yays.popup.asked';

/**
 * As the app opens: at most one pop-up (daily check-in, then a bonus), and each at most once a day on any device.
 * The server decides; this asks once per browser tab.
 */
export function PopupHost({ me }: { me: MeProfile }) {
  const [now, setNow] = useState<{ kind: 'checkin'; checkin: CheckinStatus } | { kind: 'bonus'; bonus: BonusCampaign } | null>(null);
  useEffect(() => {
    void applyStoredRef();
    try { if (sessionStorage.getItem(SEEN)) return; sessionStorage.setItem(SEEN, '1'); } catch { /* private mode: ask anyway */ }
    let live = true;
    api().popupNow().then((p) => { if (live && p.kind !== 'none') setNow(p); }).catch(() => undefined);
    return () => { live = false; };
  }, []);
  if (!now) return null;
  const close = () => setNow(null);
  return now.kind === 'checkin'
    ? <CheckinPopup first={me.displayName.split(/\s+/)[0]!} status={now.checkin} onClose={close} />
    : <BonusPopup first={me.displayName.split(/\s+/)[0]!} bonus={now.bonus} onClose={close} />;
}

function useDialog(onClose: () => void) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    box.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [onClose]);
  return box;
}

/* ---------------------------------------------------------------- daily check-in (W8, p18) */

export function CheckinPopup({ first, status, onClose }: { first: string; status: CheckinStatus; onClose: () => void }) {
  const [s, setS] = useState(status);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [off, setOff] = useState(false);
  const box = useDialog(onClose);
  const later = () => { void api().dismissPopup('checkin', off).catch(() => undefined); onClose(); };
  const claim = async () => {
    setBusy(true); setError(null);
    try { const n = await api().claimCheckin(); setS(n); setBalance(n.balance); if (off) void api().dismissPopup('checkin', true).catch(() => undefined); }
    catch (e) { setError(errText(e)); }
    finally { setBusy(false); }
  };
  const done = s.claimedToday;
  return (
    <div className="p2-pop-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) later(); }}>
      <div className="p2-checkin" role="dialog" aria-modal="true" aria-labelledby="ci-title" ref={box}>
        <div className="p2-checkin__hero">
          <span className="ys-feature__deco a" /><span className="ys-feature__deco b" />
          <img src="/brand/coin.png" alt="" className="p2-checkin__coin" />
          <span className="p2-checkin__eyebrow">Daily check-in · Day {s.dayOfWeek}</span>
          <div className="p2-checkin__pts">+{s.todayPoints} INEX</div>
          <span>{done ? `New balance: ${fmtPoints(s.balance)}` : `Balance after claim: ${fmtPoints(s.balance + s.todayPoints)}`}</span>
        </div>
        <div className="p2-checkin__body">
          <div className="p2-checkin__head">
            <div>
              <h2 id="ci-title">{done ? `+${s.todayPoints} INEX added` : `Welcome back, ${first}`}</h2>
              <p>{done ? `That’s a ${s.streak}-day streak.` : s.streak ? `You’re on a ${s.streak}-day streak. Claim today’s INEX to keep it going.` : 'Claim today’s INEX to start a streak.'}</p>
            </div>
            <OvalButton icon="close" label="Close" size="sm" variant="ghost" onClick={later} />
          </div>
          <CheckinWeek status={s} />
          <div className="p2-note"><Icon name="gift" size={16} /><span>{s.dayOfWeek < 7 ? <>Come back tomorrow for <strong>+{s.tomorrowPoints}</strong>{s.dayOfWeek === 6 ? <strong> (Day 7 bonus)</strong> : null}. </> : <>That completes your week. </>}The pop-up shows once a day, on any device.</span></div>
          {error && <Banner>{error}</Banner>}
          <div className="p2-checkin__actions">
            {!done && <label className="p2-check"><input type="checkbox" checked={off} onChange={(e) => setOff(e.target.checked)} />Don’t show this on web</label>}
            <span style={{ flex: 1 }} />
            <OvalButton icon="star" label="Ways to earn" size="md" variant="soft" href="/earn" />
            {done ? <OvalButton icon="check" label="Done" size="lg" onClick={onClose} data-autofocus /> : <OvalButton icon="gift" label={`Claim +${s.todayPoints}`} size="lg" loading={busy} onClick={() => void claim()} data-autofocus />}
          </div>
        </div>
      </div>
    </div>
  );
}

export function CheckinWeek({ status }: { status: CheckinStatus }) {
  return (
    <div className="p2-week" role="list" aria-label="This week’s check-ins">
      {status.days.map((d) => (
        <div key={d.day} role="listitem" className={`p2-week__day p2-week__day--${d.state}`} aria-label={`Day ${d.day}: +${d.points}${d.state === 'done' || d.state === 'claimed' ? ', claimed' : d.state === 'today' ? ', today' : ''}`}>
          <span className="ys-oval">{d.state === 'done' || d.state === 'claimed' ? <Icon name="check" size={16} /> : `+${d.points}`}</span>
          <span>{d.state === 'today' || d.state === 'claimed' ? 'Today' : `Day ${d.day}`}</span>
        </div>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------- bonus campaigns (W13 Jack, W14 BTCY) */

const ART: Record<BonusCampaign['product'], { src: string; alt: string }> = { jack: { src: '/brand/jack-bunny.png', alt: 'Jack’s AI' }, btcy: { src: '/brand/btcy-coin.png', alt: 'BTCY' } };

export function BonusPopup({ first, bonus: b, onClose }: { first: string; bonus: BonusCampaign; onClose: () => void }) {
  const router = useRouter();
  const [noMore, setNoMore] = useState(false);
  const box = useDialog(onClose);
  const later = () => { void api().dismissPopup(noMore ? 'bonuses' : b.id).catch(() => undefined); onClose(); };
  const jack = b.product === 'jack';
  const go = () => { if (noMore) void api().dismissPopup('bonuses').catch(() => undefined); onClose(); router.push(jack ? '/ai' : b.needsLink ? '/settings/indexx' : '/btcy'); };
  const lead = jack
    ? `Welcome back, ${first}. Finish these ${b.tasks.length} tasks with Jack’s AI before midnight and the bonus is yours.`
    : b.needsLink ? `Welcome back, ${first}. Link your Indexx account and these count from BTCY this week. Each task pays on its own.`
      : `Welcome back, ${first}. Do any of these in BTCY this week. Each task pays its INEX as soon as it’s done.`;
  return (
    <div className="p2-pop-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) later(); }}>
      <div className={`p2-bonus p2-bonus--${b.product}`} role="dialog" aria-modal="true" aria-labelledby="bonus-title" ref={box}>
        <img src={ART[b.product].src} alt={ART[b.product].alt} className="p2-bonus__art" />
        <div className="p2-bonus__card">
          <LineArt name="coins" height={220} opacity={0.12} className="p2-bonus__coins" />
          {!jack && <LineArt name="trader" height={180} opacity={0.08} className="p2-bonus__trader" />}
          <span className="p2-bonus__close"><OvalButton icon="close" label="Close" size="sm" variant="ghost" onClick={later} /></span>
          <div className="p2-bonus__head">
            <span className="ys-eyebrow">{b.eyebrow}</span>
            <h2 id="bonus-title">Earn {jack ? '' : 'up to '}<span>+{b.points}</span> {jack ? 'bonus INEX' : 'INEX'}</h2>
            <p>{lead}</p>
          </div>
          <TaskList tasks={b.tasks} />
          <div className="p2-note"><Icon name="clock" size={18} /><span>Ends in <strong>{timeLeft(b.endsAt)}</strong>. {b.allRequired ? `The ${b.points} INEX land in your wallet when all ${b.tasks.length} are done.` : 'INEX lands in your wallet as each task is done.'}</span></div>
          <div className="p2-bonus__actions">
            <OvalButton icon="clock" label="Remind me later" size="lg" variant="ghost" onClick={later} />
            <OvalButton icon={jack ? 'sparkles' : 'bitcoin'} label={jack ? 'Ask Jack now' : b.needsLink ? 'Link Indexx account' : 'Open BTCY'} size="xl" onClick={go} data-autofocus />
          </div>
          <div className="p2-bonus__foot">
            <label className="p2-check"><input type="checkbox" checked={noMore} onChange={(e) => setNoMore(e.target.checked)} />Don’t show bonus pop-ups today</label>
            <Link href="/earn" onClick={onClose}>See all ways to earn</Link>
          </div>
        </div>
      </div>
    </div>
  );
}

export function TaskList({ tasks, compact }: { tasks: Array<{ id: string; title: string; icon: string; done: number; of: number; points: number; completed: boolean }>; compact?: boolean }) {
  return (
    <ul className={`p2-tasks${compact ? ' p2-tasks--compact' : ''}`}>
      {tasks.map((t) => (
        <li key={t.id}>
          <span className={`ys-oval${t.completed ? ' ys-oval--ember' : ' ys-oval--wash'}`}><Icon name={(t.completed ? 'check' : t.icon) as IconName} size={18} /></span>
          <span className="p2-tasks__text"><strong>{t.title}</strong><span><Bar done={t.done} of={t.of} />{t.done} of {t.of}</span></span>
          <span className={`p2-tasks__pts${t.completed ? ' p2-tasks__pts--done' : ''}`}>{t.completed ? 'Done' : `+${t.points}`}</span>
        </li>
      ))}
    </ul>
  );
}

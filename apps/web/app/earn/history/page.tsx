'use client';
import { useState } from 'react';
import type { PointsEntry } from '@yays/shared';
import { AppShell } from '@/components/app-shell';
import { Banner, LineArt, OvalButton } from '@/components/ui';
import { useMe } from '@/components/use-me';
import { api } from '@/lib/api';
import { Icon, type IconName } from '@/lib/icons';
import { errText, fmtPoints, useLoad } from '@/lib/phase2';

const FILTERS = [['all', 'All'], ['earned', 'Earned'], ['spent', 'Spent'], ['pending', 'Pending']] as const;
type Filter = (typeof FILTERS)[number][0];
const ICON: Record<PointsEntry['kind'], IconName> = { checkin: 'gift', activity: 'chats', referral: 'person-add', bonus: 'sparkles', convert: 'swap', ai_extra: 'sparkles', reversal: 'refresh' };

const group = (iso: string) => {
  const d = new Date(iso), now = new Date(), y = new Date(now); y.setDate(now.getDate() - 1);
  return d.toDateString() === now.toDateString() ? 'Today' : d.toDateString() === y.toDateString() ? 'Yesterday' : d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'short' });
};

/** p07: every point in and out, grouped by day. */
export default function HistoryPage() {
  const { me } = useMe();
  const [filter, setFilter] = useState<Filter>('all');
  const page = useLoad(() => api().pointsHistory(filter), [filter]);
  const [more, setMore] = useState<PointsEntry[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const items = [...(page.data?.items ?? []), ...more];
  const cursor = more.length ? next : page.data?.next ?? null;
  const loadMore = async () => { if (!cursor) return; try { const p = await api().pointsHistory(filter, cursor); setMore((m) => [...m, ...p.items]); setNext(p.next); } catch (e) { setError(errText(e)); } };
  const groups: Array<[string, PointsEntry[]]> = [];
  for (const i of items) { const g = group(i.at); const last = groups[groups.length - 1]; if (last && last[0] === g) last[1].push(i); else groups.push([g, [i]]); }
  return (
    <AppShell me={me}>
      <LineArt name="trader" height={320} opacity={0.15} className="p2-art p2-art--br" />
      <div className="p2-page p2-page--narrow">
        <div className="p2-head"><OvalButton icon="arrow-left" label="Earn" size="sm" variant="ghost" href="/earn" /><h1>Points history</h1></div>
        <div className="ys-tabs" role="tablist" aria-label="Filter points">
          {FILTERS.map(([f, label]) => <button key={f} type="button" role="tab" className="ys-tab" aria-selected={filter === f} onClick={() => { setFilter(f); setMore([]); setNext(null); }}>{label}</button>)}
        </div>
        {(page.error || error) && <Banner>{page.error ?? error}</Banner>}
        {page.data && !items.length && <div className="list-empty"><strong>Nothing here yet</strong>Check in daily, chat and invite friends to earn points.</div>}
        {groups.map(([g, rows]) => (
          <section key={g} className="p2-card" aria-label={g}>
            <h2 className="p2-card__label">{g}</h2>
            {rows.map((i) => (
              <div key={i.id} className="ys-row-item p2-ledger">
                <span className="ys-oval ys-oval--wash" style={{ width: 40 }}><Icon name={ICON[i.kind]} size={18} /></span>
                <span className="ys-row-item__text"><span className="ys-row-item__title">{i.title}</span><span className={`ys-row-item__sub p2-ledger__sub--${i.status}`}>{i.status === 'pending' ? `Pending · ${i.sub}` : i.sub}</span></span>
                <span className={`p2-ledger__amt p2-ledger__amt--${i.amount < 0 ? 'out' : i.status}`}>{i.amount > 0 ? '+' : '−'}{fmtPoints(Math.abs(i.amount))}</span>
              </div>
            ))}
          </section>
        ))}
        {cursor && <div className="row center"><OvalButton icon="chevron-down" label="Show more" size="sm" variant="soft" onClick={() => void loadMore()} /></div>}
        <p className="muted p2-small">Points from invites show as pending until your friend verifies their number and sends a first message.</p>
      </div>
    </AppShell>
  );
}

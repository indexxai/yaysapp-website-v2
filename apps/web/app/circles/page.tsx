'use client';
import { Suspense, useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { MyCircles } from '@yays/shared';
import { api } from '@/lib/api';
import { AppShell } from '@/components/app-shell';
import { CircleHome, CircleList, CreateCircleDialog, NoCircles } from '@/components/circles/circle';
import { EventMiniRow, errText } from '@/components/circles/common';
import { Banner, LineArt, OvalButton } from '@/components/ui';
import { useMe } from '@/components/use-me';

export default function CirclesPage() { return <Suspense fallback={null}><Circles /></Suspense>; }

/** p35 / W19: my circles on the left, the open one on the right. */
function Circles() {
  const { me, error } = useMe();
  const router = useRouter();
  const params = useSearchParams();
  const active = params.get('id');
  const [mine, setMine] = useState<MyCircles | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const load = useCallback(() => api().myCircles().then((m) => { setMine(m); setLoadError(null); }, (e) => setLoadError(errText(e, 'Couldn’t load your circles.'))), []);
  useEffect(() => { if (me) void load(); }, [me, load]);
  const created = (id: string) => { setCreating(false); void load(); router.push(`/circles?id=${id}`); };
  const dialog = creating && <CreateCircleDialog onClose={() => setCreating(false)} onCreated={created} />;
  if (me && mine && !mine.circles.length && !active) return <AppShell me={me} bare><NoCircles onNew={() => setCreating(true)} />{dialog}</AppShell>;
  return (
    <AppShell me={me} bare>
      <div className={`chats${active ? ' chats--open' : ''}`}>
        <aside className="chats__list" aria-label="Your circles">
          <div className="chats__head">
            <h1>Circles</h1>
            <span className="row" style={{ gap: 14 }}>
              <OvalButton icon="compass" label="Discover" size="sm" variant="soft" href="/circles/discover" />
              <OvalButton icon="plus" label="New" size="sm" onClick={() => setCreating(true)} />
            </span>
          </div>
          {error || loadError ? <Banner>{error ?? loadError}</Banner> : !mine ? <div className="list-empty" aria-busy="true"><span className="ys-spin" aria-hidden /> Loading…</div> : (
            <>
              {mine.upcoming.length > 0 && (
                <section className="ccard cside-up"><div className="ccard__head"><h3>Coming up</h3></div>{mine.upcoming.slice(0, 2).map((e) => <EventMiniRow key={e.id} e={e} href={`/circles/event?id=${e.id}`} />)}</section>
              )}
              <h2 className="chats__sub">Your circles</h2>
              <CircleList list={mine.circles} active={active} />
              <p className="muted p2-small" style={{ padding: '10px 20px' }}>Communities are now Circles: your groups, a feed of posts and events, all in one place.</p>
            </>
          )}
        </aside>
        <main className="chats__pane">
          {active && me ? <CircleHome key={active} id={active} me={me} tab={params.get('tab')} onChanged={() => void load()} /> : (
            <div className="pane-center pane-welcome">
              <span className="ys-feature__deco a" style={{ width: 480, top: -200, right: -150, opacity: 0.5 }} aria-hidden />
              <div className="pane-welcome__body">
                <LineArt name="hype" width={150} />
                <h2 className="pane-welcome__title" style={{ fontSize: 26 }}>Circles</h2>
                <p>Pick a circle to see its posts, events and chats. Or find new ones to join.</p>
                <div className="row" style={{ justifyContent: 'center', gap: 22 }}><OvalButton icon="compass" label="Discover" size="md" variant="soft" href="/circles/discover" /><OvalButton icon="plus" label="New circle" size="md" onClick={() => setCreating(true)} /></div>
              </div>
            </div>
          )}
        </main>
      </div>
      {dialog}
    </AppShell>
  );
}

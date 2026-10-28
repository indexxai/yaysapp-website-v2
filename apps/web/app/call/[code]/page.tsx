'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { ApiError, type CallLinkPreview } from '@yays/shared';
import { api } from '@/lib/api';
import { AppShell } from '@/components/app-shell';
import { useCalls } from '@/components/call';
import { Avatar, Banner, OvalButton } from '@/components/ui';
import { useMe } from '@/components/use-me';
import { useChatState, useEngine } from '@/lib/chat';

/** Opening a call link: see whose call it is, then join (or wait to be let in). */
export default function CallLinkPage() {
  const { me } = useMe();
  return <AppShell me={me}>{me ? <JoinCall /> : <div className="pane-center"><span className="ys-spin" aria-label="Loading" /></div>}</AppShell>;
}

function JoinCall() {
  const { code } = useParams<{ code: string }>();
  const calls = useCalls();
  const engine = useEngine();
  const s = useChatState();
  const [p, setP] = useState<CallLinkPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<'idle' | 'busy' | 'waiting' | 'denied' | 'joined'>('idle');
  const load = useCallback(() => api().callLink(code).then(setP, (e) => setError(e instanceof ApiError ? e.message : 'Could not open this call link.')), [code]);
  useEffect(() => { void load(); }, [load]);
  const join = useCallback(async () => {
    setState('busy'); setError(null);
    try { setState(await calls.joinLink(code)); } catch (e) { setError(e instanceof ApiError ? e.message : 'Could not join. Try again.'); setState('idle'); }
  }, [calls, code]);
  // Waiting: the host's answer arrives over the live connection.
  const mine = Object.values(s.calls).find((c) => c.linkCode === code && c.status !== 'ended');
  const myState = mine?.participants.find((x) => x.userId === engine.me)?.state;
  useEffect(() => {
    if (state !== 'waiting') return;
    if (myState === 'admitted') void join();
    if (myState === 'denied') setState('denied');
  }, [state, myState, join]);
  // While waiting, leaving the page takes the request back.
  const waitingIn = useRef<string | null>(null);
  waitingIn.current = state === 'waiting' && mine ? mine.id : null;
  useEffect(() => () => { if (waitingIn.current) void api().leaveCall(waitingIn.current).catch(() => undefined); }, []);
  return (
    <div className="join-card card" aria-label="Call link">
      {error && <Banner>{error}</Banner>}
      {!p && !error && <span className="ys-spin" aria-label="Loading" />}
      {p && (
        <>
          <Avatar name={p.host.displayName} photoUrl={p.host.photoUrl} size={96} />
          <h1>{p.name}</h1>
          <span className="muted">{p.media === 'video' ? 'Video' : 'Voice'} call · from {p.mine ? 'you' : p.host.displayName}{p.live ? ` · ${p.count} on the call now` : ''}</span>
          {state === 'waiting' ? (
            <>
              <Banner tone="info">Waiting for {p.host.displayName.split(' ')[0]} to let you in…</Banner>
              <span className="ys-spin" aria-hidden />
              <OvalButton icon="close" label="Cancel" variant="ghost" onClick={() => { if (mine) void api().leaveCall(mine.id).catch(() => undefined); setState('idle'); }} />
            </>
          ) : state === 'denied' ? <Banner>The host didn’t let you in to this call.</Banner>
            : state === 'joined' ? <Banner tone="success">You’re on the call.</Banner>
            : <OvalButton icon={p.media === 'video' ? 'video' : 'phone'} label="Join call" size="lg" loading={state === 'busy'} onClick={() => void join()} />}
        </>
      )}
    </div>
  );
}

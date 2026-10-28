'use client';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ApiError, callText, type SystemEvent, type CallJoin, type CallMedia, type CallView } from '@yays/shared';
import { api } from '@/lib/api';
import { useChatState, useEngine } from '@/lib/chat';
import { Icon, type IconName } from '@/lib/icons';
import { getPrefs } from '@/lib/prefs';
import { Avatar, Banner, OvalButton } from './ui';
import type { CallSession } from './call-media';

const errText = (e: unknown, f: string) => (e instanceof ApiError ? e.message : f);
const CallScreen = dynamic(() => import('./call-media').then((m) => m.CallScreen), { ssr: false });
// ---------------------------------------------------------------------------------------------------------------
// Calls for the whole signed-in app: start, answer, join by link, and the one call this tab is on.
// ---------------------------------------------------------------------------------------------------------------
interface CallsApi {
  session: CallSession | null;
  start(conversationId: string, media: CallMedia): Promise<void>;
  answer(callId: string, video: boolean): Promise<void>;
  joinLink(code: string): Promise<'joined' | 'waiting' | 'denied'>;
  /** Joins after the host let me in (link calls) or rejoins a group call from its chat. */
  join(callId: string, video: boolean): Promise<void>;
  error: string | null;
  clearError(): void;
}
const CallsCtx = createContext<CallsApi | null>(null);
export const useCalls = () => { const c = useContext(CallsCtx); if (!c) throw new Error('useCalls outside CallsProvider'); return c; };

export function CallsProvider({ children }: { children: ReactNode }) {
  const engine = useEngine();
  const [session, setSession] = useState<CallSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const current = useRef<CallSession | null>(null);
  const open = useCallback(async (get: () => Promise<CallJoin>, video: boolean) => {
    setError(null);
    if (current.current) { const old = current.current; current.current = null; setSession(null); await old.hangUp(); }
    try {
      const j = await get();
      engine.onCall(j.call);
      const { CallSession } = await import('./call-media');
      const s = new CallSession(j, video);
      current.current = s; setSession(s);
    } catch (e) { setError(errText(e, 'Could not start the call. Try again.')); throw e; }
  }, [engine]);
  // The tab closing hangs up (LiveKit would notice a moment later anyway).
  useEffect(() => {
    const bye = () => {
      const s = current.current; if (!s) return;
      void api().accessToken().then((t) => { if (t) void fetch(`${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'}/v1/calls/${s.callId}/leave`, { method: 'POST', keepalive: true, headers: { authorization: `Bearer ${t}` } }); });
    };
    window.addEventListener('pagehide', bye);
    return () => window.removeEventListener('pagehide', bye);
  }, []);
  const value = useMemo<CallsApi>(() => ({
    session, error, clearError: () => setError(null),
    start: (conversationId, media) => open(() => api().startCall(conversationId, media), media === 'video'),
    answer: (callId, video) => open(() => api().acceptCall(callId), video),
    join: (callId, video) => open(() => api().acceptCall(callId), video),
    joinLink: async (code) => {
      setError(null);
      const r = await api().joinCallLink(code);
      if (r.status === 'joined') await open(async () => r, r.call.media === 'video');
      else if (r.status === 'waiting') engine.onCall(r.call);
      return r.status;
    },
  }), [session, error, open, engine]);
  // When the call ends (server says so, or the room drops for good), close this tab's side after a moment.
  const s = useChatState();
  const view = session ? s.calls[session.callId] : undefined;
  useEffect(() => {
    if (!session || view?.status !== 'ended') return;
    const t = setTimeout(() => { session.close(); if (current.current === session) { current.current = null; setSession(null); } }, 2500);
    return () => clearTimeout(t);
  }, [session, view?.status]);
  useEffect(() => () => { current.current?.close(); }, []);
  const close = useCallback(() => { const x = current.current; if (x) { x.close(); current.current = null; setSession(null); } }, []);
  return <CallsCtx.Provider value={value}><CloseCtx.Provider value={close}>{children}</CloseCtx.Provider></CallsCtx.Provider>;
}
export const CloseCtx = createContext<() => void>(() => undefined);

// ---------------------------------------------------------------------------------------------------------------
// Sounds: a ringtone for incoming calls and a ringback while my call rings. Made with WebAudio, no files.
// ---------------------------------------------------------------------------------------------------------------
export function useTone(kind: 'ring' | 'ringback' | null) {
  useEffect(() => {
    if (!kind || !getPrefs().sound) return;
    let ctx: AudioContext | null = null;
    try { ctx = new AudioContext(); } catch { return; }
    let stopped = false;
    const beep = (at: number, f1: number, f2: number, len: number) => {
      for (const f of [f1, f2]) {
        const o = ctx!.createOscillator(), g = ctx!.createGain();
        o.frequency.value = f; g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(kind === 'ring' ? 0.08 : 0.04, at + 0.03); g.gain.setValueAtTime(kind === 'ring' ? 0.08 : 0.04, at + len - 0.05); g.gain.exponentialRampToValueAtTime(0.0001, at + len);
        o.connect(g).connect(ctx!.destination); o.start(at); o.stop(at + len + 0.02);
      }
    };
    const cycle = () => {
      if (stopped || !ctx) return;
      const t = ctx.currentTime + 0.05;
      if (kind === 'ring') { beep(t, 660, 880, 0.35); beep(t + 0.45, 660, 880, 0.35); } else beep(t, 440, 480, 1.6);
    };
    cycle();
    const id = setInterval(cycle, kind === 'ring' ? 2200 : 4000);
    return () => { stopped = true; clearInterval(id); void ctx?.close(); };
  }, [kind]);
}

// ---------------------------------------------------------------------------------------------------------------
// What shows on top of every page: incoming rings, people asking to join my call link, and the call itself.
// ---------------------------------------------------------------------------------------------------------------
export function CallLayer() {
  const engine = useEngine();
  const s = useChatState();
  const calls = useCalls();
  const me = engine.me;
  const ringing = Object.values(s.calls).filter((c) => c.status !== 'ended' && c.id !== calls.session?.callId && c.createdBy !== me && c.participants.some((p) => p.userId === me && p.state === 'ringing'))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const asking = Object.values(s.calls).filter((c) => c.status !== 'ended' && c.id !== calls.session?.callId && c.hostIds.includes(me) && c.participants.some((p) => p.state === 'waiting'));
  useTone(ringing.length ? 'ring' : null);
  return (
    <>
      {calls.session && <CallScreen session={calls.session} />}
      <div className="call-alerts">
        {ringing.slice(0, 2).map((c) => <IncomingCall key={c.id} call={c} />)}
        {asking.map((c) => <JoinRequests key={c.id} call={c} />)}
        {calls.error && !calls.session && <div className="call-alert call-alert--light" role="alert"><Banner>{calls.error}</Banner><button type="button" className="icon-btn" aria-label="Dismiss" onClick={calls.clearError}><Icon name="close" size={16} /></button></div>}
      </div>
    </>
  );
}

export function RoundButton({ icon, label, onClick, fill, ink = '#ffffff', size = 'lg', pressed, disabled, testId }: { icon: IconName; label: string; onClick?: () => void; fill: string; ink?: string; size?: 'md' | 'lg' | 'xl'; pressed?: boolean; disabled?: boolean; testId?: string }) {
  return (
    <button type="button" className={`ys-ovalbtn ys-ovalbtn--${size} call-btn`} onClick={onClick} aria-pressed={pressed} disabled={disabled} data-testid={testId}>
      <span className="ys-oval" style={{ ['--ys-oval-fill' as string]: fill, ['--ys-oval-ink' as string]: ink }}><Icon name={icon} size={size === 'xl' ? 26 : 22} /></span>
      <span className="ys-ovalbtn__label">{label}</span>
    </button>
  );
}

function IncomingCall({ call }: { call: CallView }) {
  const calls = useCalls();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const caller = call.participants.find((p) => p.userId === call.createdBy);
  const kind = `${call.kind === 'group' ? 'group ' : ''}${call.media} call`;
  const answer = async (video: boolean) => { setBusy(true); try { await calls.answer(call.id, video); } catch (e) { setError(errText(e, 'Could not answer.')); setBusy(false); } };
  const decline = () => { void api().declineCall(call.id).catch(() => undefined); };
  return (
    <div className="call-alert" role="alertdialog" aria-labelledby={`ic-${call.id}`} aria-describedby={`icd-${call.id}`} data-testid="incoming-call">
      <div className="call-alert__who">
        <Avatar name={call.title} photoUrl={call.photoUrl} size={64} />
        <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span className="call-alert__kind" id={`icd-${call.id}`}><Icon name={call.media === 'video' ? 'video' : 'phone'} size={14} />Incoming {kind}</span>
          <strong id={`ic-${call.id}`} className="call-alert__name">{call.title}</strong>
          {call.kind === 'group' && caller && <span style={{ fontSize: 13, opacity: 0.75 }}>{caller.name} is calling</span>}
        </span>
      </div>
      {error && <Banner>{error}</Banner>}
      <div className="call-alert__actions">
        <RoundButton icon="phone-off" label="Decline" fill="var(--danger)" onClick={decline} disabled={busy} />
        {call.conversationId && <RoundButton icon="chat" label="Message" fill="rgba(255,255,255,.16)" onClick={() => { decline(); router.push(`/chats?c=${call.conversationId}`); }} disabled={busy} />}
        {call.media === 'video' && <RoundButton icon="phone" label="Voice only" fill="rgba(255,255,255,.16)" onClick={() => void answer(false)} disabled={busy} />}
        <RoundButton icon={call.media === 'video' ? 'video' : 'phone'} label="Accept" fill="var(--success)" ink="var(--on-success)" onClick={() => void answer(call.media === 'video')} disabled={busy} />
      </div>
    </div>
  );
}

/** Someone used my call link and waits for me to let them in. */
export function JoinRequests({ call, inline }: { call: CallView; inline?: boolean }) {
  const engine = useEngine();
  const [error, setError] = useState<string | null>(null);
  const waiting = call.participants.filter((p) => p.state === 'waiting');
  const decide = (userId: string, allow: boolean) => { void api().admitToCall(call.id, userId, allow).then((v) => engine.onCall(v)).catch((e) => setError(errText(e, 'That did not work.'))); };
  if (!waiting.length) return null;
  return (
    <div className={inline ? 'call-requests' : 'call-alert call-alert--light'} role="region" aria-label="Asking to join">
      {!inline && <strong style={{ font: '700 15px var(--font-display)' }}>{call.title}</strong>}
      {error && <Banner>{error}</Banner>}
      {waiting.map((p) => (
        <div key={p.userId} className="call-request" data-testid="join-request">
          <Avatar name={p.name} photoUrl={p.photoUrl} size={36} />
          <span style={{ flex: 1, minWidth: 0 }}><strong>{p.name}</strong> wants to join</span>
          <button type="button" className="btn btn--ghost" onClick={() => decide(p.userId, false)} aria-label={`Deny ${p.name}`}>Deny</button>
          <button type="button" className="btn" onClick={() => decide(p.userId, true)} aria-label={`Let ${p.name} in`}>Let in</button>
        </div>
      ))}
    </div>
  );
}

export function CallButtons({ conversationId, canCall, live }: { conversationId: string; canCall: boolean; live?: { id: string; media: CallMedia; count: number } | null }) {
  const calls = useCalls();
  const [busy, setBusy] = useState<CallMedia | null>(null);
  const go = async (media: CallMedia) => { setBusy(media); try { await calls.start(conversationId, media); } catch { /* shown by the call layer */ } finally { setBusy(null); } };
  if (!canCall) return null;
  const onThis = calls.session && live && calls.session.callId === live.id;
  if (live && !onThis) return (
    <button type="button" className="call-join" onClick={() => void calls.join(live.id, false)} aria-label={`Join ${live.media} call`}>
      <Icon name={live.media === 'video' ? 'video' : 'phone'} size={16} />Join<span className="call-join__count">{live.count}</span>
    </button>
  );
  return (
    <>
      <OvalButton icon="video" label="Video" size="sm" variant="ghost" aria-label="Video call" disabled={!!busy || !!onThis} onClick={() => void go('video')} />
      <OvalButton icon="phone" label="Voice" size="sm" variant="ghost" aria-label="Voice call" disabled={!!busy || !!onThis} onClick={() => void go('voice')} />
    </>
  );
}


/** A finished call, as a line in the chat: "Missed voice call · 12:30", with a button to call back. */
export function CallLine({ e, mine, at, conversationId, canCall }: { e: Extract<SystemEvent, { kind: 'call' }>; mine: boolean; at: string; conversationId: string; canCall: boolean }) {
  const calls = useCalls();
  const missed = !mine && e.outcome !== 'completed' && e.outcome !== 'declined';
  return (
    <div className={`call-line${missed ? ' call-line--missed' : ''}`} data-testid="call-line">
      <span className="ys-oval" style={{ width: 32 }}><Icon name={missed ? 'call-missed' : mine ? 'call-outgoing' : 'call-incoming'} size={16} /></span>
      <span className="call-line__text"><strong>{callText(e, mine)}</strong><span>{at}</span></span>
      {canCall && <button type="button" className="btn btn--ghost call-line__back" onClick={() => void calls.start(conversationId, e.media).catch(() => undefined)} aria-label={`Call back (${e.media})`}><Icon name={e.media === 'video' ? 'video' : 'phone'} size={16} /></button>}
    </div>
  );
}

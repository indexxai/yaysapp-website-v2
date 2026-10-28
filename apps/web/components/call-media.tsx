'use client';
import { useContext, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ConnectionQuality, ConnectionState, Room, RoomEvent, Track, type Participant, type RemoteTrack } from 'livekit-client';
import { ApiError, callDuration, type CallJoin, type CallView } from '@yays/shared';
import { api } from '@/lib/api';
import { useChatState, useEngine } from '@/lib/chat';
import { Icon } from '@/lib/icons';
import { Avatar, Banner } from './ui';
import { CloseCtx, JoinRequests, RoundButton, useTone } from './call';

// Everything here needs LiveKit, so it loads only once a call starts.
const errText = (e: unknown, f: string) => (e instanceof ApiError ? e.message : f);
// ---------------------------------------------------------------------------------------------------------------
// The media side of one call: a LiveKit room plus what this device is sending. Lives outside React so that
// re-renders and page changes never drop the connection.
// ---------------------------------------------------------------------------------------------------------------
export class CallSession {
  readonly room: Room;
  readonly callId: string;
  first: CallView;
  state: 'connecting' | 'connected' | 'reconnecting' | 'disconnected' = 'connecting';
  mic = true; cam = false; screen = false; minimized = false;
  error: string | null = null;
  /** Bumped on every change, for useSyncExternalStore. */
  version = 0;
  private listeners = new Set<() => void>();
  constructor(join: CallJoin, private readonly wantVideo: boolean) {
    this.callId = join.call.id;
    this.first = join.call;
    this.room = new Room({ adaptiveStream: true, dynacast: true, publishDefaults: { simulcast: true } });
    const bump = () => this.changed();
    for (const ev of [RoomEvent.ParticipantConnected, RoomEvent.ParticipantDisconnected, RoomEvent.TrackSubscribed, RoomEvent.TrackUnsubscribed, RoomEvent.TrackMuted, RoomEvent.TrackUnmuted,
      RoomEvent.LocalTrackPublished, RoomEvent.LocalTrackUnpublished, RoomEvent.ActiveSpeakersChanged, RoomEvent.ConnectionQualityChanged, RoomEvent.TrackPublished, RoomEvent.TrackUnpublished]) this.room.on(ev, bump);
    this.room.on(RoomEvent.ConnectionStateChanged, (s: ConnectionState) => {
      this.state = s === ConnectionState.Connected ? 'connected' : s === ConnectionState.Reconnecting || s === ConnectionState.SignalReconnecting ? 'reconnecting' : s === ConnectionState.Disconnected ? 'disconnected' : 'connecting';
      this.changed();
    });
    this.room.on(RoomEvent.MediaDevicesError, (e: Error) => { this.error = deviceError(e); this.changed(); });
    void this.connect(join);
  }
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  getVersion = () => this.version;
  changed() { this.version++; for (const l of this.listeners) l(); }

  private async connect(join: CallJoin) {
    try {
      await this.room.connect(join.url, join.token);
    } catch {
      this.error = 'Could not connect the call. Check your connection and try again.';
      this.state = 'disconnected'; this.changed();
      return;
    }
    try { await this.room.localParticipant.setMicrophoneEnabled(true); } catch (e) { this.mic = false; this.error = deviceError(e); }
    if (this.wantVideo) { try { await this.room.localParticipant.setCameraEnabled(true); this.cam = true; } catch (e) { this.error = deviceError(e); } }
    this.changed();
  }
  async toggleMic() {
    try { await this.room.localParticipant.setMicrophoneEnabled(!this.mic); this.mic = !this.mic; this.error = null; } catch (e) { this.error = deviceError(e); }
    this.changed();
  }
  async toggleCam() {
    try { await this.room.localParticipant.setCameraEnabled(!this.cam); this.cam = !this.cam; this.error = null; } catch (e) { this.error = deviceError(e); }
    this.changed();
  }
  async toggleScreen() {
    try { await this.room.localParticipant.setScreenShareEnabled(!this.screen, { audio: false }); this.screen = !this.screen; this.error = null; }
    catch (e) { if ((e as Error)?.name !== 'NotAllowedError') this.error = 'Could not share your screen.'; }
    this.changed();
  }
  setMinimized(v: boolean) { this.minimized = v; this.changed(); }
  /** Hangs up: tells the server first so the other side stops waiting, then closes the media. */
  async hangUp() {
    await api().leaveCall(this.callId).catch(() => undefined);
    await this.room.disconnect();
  }
  close() { void this.room.disconnect(); }
}

function deviceError(e: unknown) {
  const n = (e as Error)?.name;
  if (n === 'NotAllowedError' || n === 'PermissionDeniedError') return 'Allow microphone and camera for this site in your browser, then try again.';
  if (n === 'NotFoundError' || n === 'DevicesNotFoundError') return 'No microphone or camera found.';
  if (n === 'NotReadableError') return 'Your microphone or camera is being used by another app.';
  return 'Could not use your microphone or camera.';
}

function useTicker(on: boolean) {
  const [, set] = useState(0);
  useEffect(() => { if (!on) return; const t = setInterval(() => set((x) => x + 1), 1000); return () => clearInterval(t); }, [on]);
}

/** One camera or screen, attached to a <video>. */
function VideoTrack({ p, source, mirror }: { p: Participant; source: Track.Source; mirror?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  const pub = p.getTrackPublication(source);
  const track = pub?.track && !pub.isMuted ? pub.track : undefined;
  useEffect(() => {
    const el = ref.current;
    if (!el || !track) return;
    track.attach(el);
    return () => { track.detach(el); };
  }, [track]);
  if (!track) return null;
  return <video ref={ref} className={`call-video${mirror ? ' call-video--mirror' : ''}`} autoPlay playsInline muted data-testid={p.isLocal ? 'local-video' : 'remote-video'} data-source={source} />;
}

/** Everyone else's sound. Always mounted, so the mini window keeps playing it. */
function RemoteAudio({ session }: { session: CallSession }) {
  useSyncExternalStore(session.subscribe, session.getVersion, session.getVersion);
  const tracks: RemoteTrack[] = [];
  for (const p of session.room.remoteParticipants.values()) for (const pub of p.audioTrackPublications.values()) if (pub.track) tracks.push(pub.track as RemoteTrack);
  return <>{tracks.map((t) => <AudioEl key={t.sid} track={t} />)}</>;
}
function AudioEl({ track }: { track: RemoteTrack }) {
  const ref = useRef<HTMLAudioElement>(null);
  useEffect(() => { const el = ref.current; if (!el) return; track.attach(el); return () => { track.detach(el); }; }, [track]);
  return <audio ref={ref} autoPlay data-testid="remote-audio" />;
}

function statusLine(view: CallView, session: CallSession, me: string) {
  if (view.status === 'ended') {
    const o = view.outcome;
    if (o === 'declined') return 'Declined';
    if (o === 'busy') return 'On another call';
    if (o === 'missed' && view.createdBy === me) return 'No answer';
    return 'Call ended';
  }
  if (session.state === 'reconnecting') return 'Reconnecting…';
  if (session.state === 'connecting') return 'Connecting…';
  if (session.state === 'disconnected') return 'Disconnected';
  if (view.kind === 'link' && view.participants.find((p) => p.userId === me)?.state === 'waiting') return 'Waiting for the host…';
  if (!view.startedAt) {
    if (view.kind === 'link') return 'Waiting for others to join';
    return view.participants.some((p) => p.userId !== me && p.state === 'ringing') ? 'Ringing…' : 'Calling…';
  }
  return callDuration((Date.now() - Date.parse(view.startedAt)) / 1000);
}

export function CallScreen({ session }: { session: CallSession }) {
  const engine = useEngine();
  const s = useChatState();
  const close = useContext(CloseCtx);
  useSyncExternalStore(session.subscribe, session.getVersion, session.getVersion);
  const view = s.calls[session.callId] ?? session.first;
  const me = engine.me;
  const live = view.status !== 'ended';
  useTicker(live);
  useTone(live && !view.startedAt && view.kind !== 'link' && view.createdBy === me && session.state === 'connected' ? 'ringback' : null);
  const [devices, setDevices] = useState(false);
  const [adding, setAdding] = useState(false);
  const [copied, setCopied] = useState(false);
  const room = session.room;
  // Phones' browsers can't share the screen.
  const canShare = typeof navigator !== 'undefined' && !!navigator.mediaDevices && 'getDisplayMedia' in navigator.mediaDevices && !/Android|iPhone|iPad/.test(navigator.userAgent);
  const remotes = [...room.remoteParticipants.values()];
  const everyone: Participant[] = [room.localParticipant, ...remotes];
  const presenter = everyone.find((p) => p.isScreenShareEnabled);
  const anyVideo = view.media === 'video' || everyone.some((p) => p.isCameraEnabled);
  const joinedCount = view.participants.filter((p) => p.state === 'joined').length;
  const pending = view.participants.filter((p) => p.userId !== me && (p.state === 'ringing' || (p.state === 'joined' && !room.remoteParticipants.has(p.userId) && session.state === 'connected')));
  const weakMe = room.localParticipant.connectionQuality === ConnectionQuality.Poor;
  const weakOther = remotes.find((p) => p.connectionQuality === ConnectionQuality.Poor);
  const status = statusLine(view, session, me);
  const nameOf = (p: Participant) => (p.isLocal ? 'You' : view.participants.find((x) => x.userId === p.identity)?.name ?? p.name ?? 'Someone');
  const photoOf = (p: Participant) => view.participants.find((x) => x.userId === (p.isLocal ? me : p.identity))?.photoUrl ?? null;
  const subtitle = view.kind === 'direct' ? status : `${status}${view.startedAt && live ? ` · ${joinedCount} on the call` : ''}`;
  const hangUp = () => { void session.hangUp().then(close); };
  const copyLink = async () => { if (!view.linkCode) return; try { await navigator.clipboard.writeText(`${location.origin}/call/${view.linkCode}`); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* clipboard blocked */ } };

  if (session.minimized) {
    return (
      <div className="call-mini" role="region" aria-label={`Call with ${view.title}`}>
        <RemoteAudio session={session} />
        <button type="button" className="call-mini__open" onClick={() => session.setMinimized(false)} aria-label="Back to call">
          <Avatar name={view.title} photoUrl={view.photoUrl} size={40} />
          <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', textAlign: 'left' }}><strong>{view.title}</strong><span data-testid="call-status">{subtitle}</span></span>
        </button>
        <button type="button" className="call-mini__btn" aria-label={session.mic ? 'Mute' : 'Unmute'} aria-pressed={!session.mic} onClick={() => void session.toggleMic()}><Icon name={session.mic ? 'mic' : 'mic-off'} size={18} /></button>
        <button type="button" className="call-mini__btn call-mini__btn--end" aria-label="End call" onClick={hangUp}><Icon name="phone-off" size={18} /></button>
      </div>
    );
  }
  const tile = (p: Participant) => {
    const speaking = p.isSpeaking && p.isMicrophoneEnabled;
    const weak = p.connectionQuality === ConnectionQuality.Poor || p.connectionQuality === ConnectionQuality.Lost;
    return (
      <div key={p.identity || 'me'} className={`call-tile${speaking ? ' call-tile--speaking' : ''}${weak ? ' call-tile--weak' : ''}${p.isCameraEnabled ? ' call-tile--video' : ''}`} data-testid="call-tile" data-who={p.isLocal ? 'me' : p.identity}>
        {p.isCameraEnabled ? <VideoTrack p={p} source={Track.Source.Camera} mirror={p.isLocal} /> : <Avatar name={nameOf(p) === 'You' ? view.participants.find((x) => x.userId === me)?.name ?? 'You' : nameOf(p)} photoUrl={photoOf(p)} size={72} />}
        <span className="call-tile__label">{!p.isMicrophoneEnabled && <Icon name="mic-off" size={14} title="Muted" />}{nameOf(p)}{weak && !p.isLocal ? ' · Reconnecting…' : ''}</span>
      </div>
    );
  };
  return (
    <div className={`call${anyVideo ? ' call--video' : ' call--voice'}`} role="dialog" aria-modal="true" aria-label={`${view.media === 'video' ? 'Video' : 'Voice'} call with ${view.title}`} data-state={session.state} data-status={view.status}>
      <RemoteAudio session={session} />
      <header className="call__head">
        {anyVideo ? <>
          <Avatar name={view.title} photoUrl={view.photoUrl} size={40} />
          <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
            <strong style={{ font: '700 17px var(--font-display)' }}>{view.title}</strong>
            <span className="call__sub" data-testid="call-status">{subtitle}</span>
          </span>
        </> : <span className="call__kind"><Icon name="phone" size={16} />YaysApp {view.kind === 'group' ? 'group ' : ''}voice call<span style={{ flex: 1 }} /></span>}
        {(weakMe || weakOther) && live && <span className="call__weak" role="status"><Icon name="alert-triangle" size={16} />{weakMe ? 'Your connection is weak. Video lowered to keep the call going.' : `Weak connection on ${nameOf(weakOther!).split(' ')[0]}’s side`}</span>}
        <button type="button" className="call__mini" onClick={() => session.setMinimized(true)} aria-label="Mini window"><Icon name="chevron-down" size={20} /></button>
      </header>
      {session.error && <div className="call__error"><Banner tone="warning">{session.error}</Banner></div>}
      {view.hostIds.includes(me) && <JoinRequests call={view} inline />}
      {anyVideo ? (
        <div className="call__stage">
          {presenter ? (
            <div className="call__present">
              <div className="call__present-bar"><Icon name="screen-share" size={16} /><strong>{presenter.isLocal ? 'You are presenting' : `${nameOf(presenter)} is presenting`}</strong></div>
              <div className="call__present-body"><VideoTrack p={presenter} source={Track.Source.ScreenShare} /></div>
            </div>
          ) : null}
          <div className={presenter ? 'call__side' : `call__grid call__grid--${Math.min(everyone.length, 9)}`}>
            {everyone.map(tile)}
            {pending.map((p) => <div key={p.userId} className="call__pending" data-testid="call-pending"><Avatar name={p.name} photoUrl={p.photoUrl} size={28} /><span style={{ flex: 1 }}>{p.name.split(' ')[0]} · {p.state === 'ringing' ? 'Ringing…' : 'Connecting…'}</span></div>)}
          </div>
        </div>
      ) : (
        <div className="call__voice">
          <div className="call__rings"><span className="ys-oval call__ring1" /><span className="ys-oval call__ring2" /><Avatar name={view.title} photoUrl={view.photoUrl} size={160} /></div>
          <h1 className="call__title">{view.title}</h1>
          <span className="call__timer" data-testid="call-status">{subtitle}</span>
          {view.kind !== 'direct' && <div className="call__people" aria-label="On the call">{everyone.map((p) => <span key={p.identity || 'me'} className={`call__person${p.isSpeaking ? ' call__person--speaking' : ''}`} data-testid="call-tile" data-who={p.isLocal ? 'me' : p.identity}><Avatar name={nameOf(p)} photoUrl={photoOf(p)} size={36} />{nameOf(p)}{!p.isMicrophoneEnabled && <Icon name="mic-off" size={14} title="Muted" />}</span>)}
            {pending.map((p) => <span key={p.userId} className="call__person call__person--pending" data-testid="call-pending">{p.name.split(' ')[0]} · Ringing…</span>)}</div>}
          {view.kind === 'direct' && remotes[0] && !remotes[0].isMicrophoneEnabled && <span className="call__chip"><Icon name="mic-off" size={14} />{view.title.split(' ')[0]} is muted</span>}
        </div>
      )}
      <div className="call__controls">
        <RoundButton icon={session.mic ? 'mic' : 'mic-off'} label={session.mic ? 'Mute' : 'Unmute'} fill={session.mic ? 'rgba(255,255,255,.14)' : '#ffffff'} ink={session.mic ? '#ffffff' : '#1f1a16'} pressed={!session.mic} onClick={() => void session.toggleMic()} disabled={!live} />
        <RoundButton icon={session.cam ? 'video' : 'video-off'} label={session.cam ? 'Camera off' : anyVideo ? 'Camera on' : 'Turn on video'} fill="rgba(255,255,255,.14)" pressed={session.cam} onClick={() => void session.toggleCam()} disabled={!live} />
        {canShare && <RoundButton icon="screen-share" label={session.screen ? 'Stop sharing' : 'Share screen'} fill={session.screen ? 'var(--ember)' : 'rgba(255,255,255,.14)'} pressed={session.screen} onClick={() => void session.toggleScreen()} disabled={!live || session.state !== 'connected'} />}
        {view.kind === 'group' && <RoundButton icon="person-add" label="Add people" fill="rgba(255,255,255,.14)" onClick={() => setAdding(true)} disabled={!live} />}
        {view.kind === 'link' && <RoundButton icon={copied ? 'check' : 'link'} label={copied ? 'Link copied' : 'Copy link'} fill="rgba(255,255,255,.14)" onClick={() => void copyLink()} />}
        <RoundButton icon="settings" label="Devices" fill="rgba(255,255,255,.14)" onClick={() => setDevices(true)} />
        <RoundButton icon="phone-off" label={view.kind === 'direct' ? 'End' : 'Leave'} fill="var(--danger)" onClick={hangUp} testId="hang-up" />
      </div>
      {devices && <DevicesDialog session={session} onClose={() => setDevices(false)} />}
      {adding && view.conversationId && <AddPeopleDialog call={view} onClose={() => setAdding(false)} />}
    </div>
  );
}

function DevicesDialog({ session, onClose }: { session: CallSession; onClose: () => void }) {
  const [list, setList] = useState<Record<'audioinput' | 'videoinput' | 'audiooutput', MediaDeviceInfo[]>>({ audioinput: [], videoinput: [], audiooutput: [] });
  useEffect(() => {
    void Promise.all((['audioinput', 'videoinput', 'audiooutput'] as const).map((k) => Room.getLocalDevices(k, false).catch(() => [] as MediaDeviceInfo[]))).then(([a, v, o]) => setList({ audioinput: a!, videoinput: v!, audiooutput: o! }));
  }, []);
  const pick = (k: MediaDeviceKind, id: string) => { void session.room.switchActiveDevice(k, id).then(() => session.changed()); };
  const row = (k: 'audioinput' | 'videoinput' | 'audiooutput', label: string) => list[k].length > 0 && (
    <label className="call-device"><span>{label}</span>
      <select className="ys-input" defaultValue={session.room.getActiveDevice(k) ?? ''} onChange={(e) => pick(k, e.target.value)}>
        {list[k].map((d, i) => <option key={d.deviceId || i} value={d.deviceId}>{d.label || `${label} ${i + 1}`}</option>)}
      </select>
    </label>
  );
  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Devices">
        <div className="modal__head"><h2>Devices</h2><button type="button" className="icon-btn" aria-label="Close" onClick={onClose}><Icon name="close" size={20} /></button></div>
        {row('audioinput', 'Microphone')}{row('audiooutput', 'Speaker')}{row('videoinput', 'Camera')}
        {!list.audioinput.length && !list.videoinput.length && <p className="muted" style={{ margin: 0 }}>No devices found. Allow microphone and camera for this site in your browser.</p>}
      </div>
    </div>
  );
}

function AddPeopleDialog({ call, onClose }: { call: CallView; onClose: () => void }) {
  const engine = useEngine();
  const s = useChatState();
  const g = call.conversationId ? s.groups[call.conversationId] : undefined;
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (call.conversationId && !g) void engine.loadGroup(call.conversationId).catch(() => undefined); }, [call.conversationId, g, engine]);
  const on = new Set(call.participants.filter((p) => p.state === 'joined' || p.state === 'ringing').map((p) => p.userId));
  const members = (g?.members ?? []).filter((m) => m.id !== engine.me);
  const ring = (id: string) => { void api().inviteToCall(call.id, [id]).then((v) => engine.onCall(v)).catch((e) => setError(errText(e, 'Could not ring them.'))); };
  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Add people">
        <div className="modal__head"><h2>Add people</h2><button type="button" className="icon-btn" aria-label="Close" onClick={onClose}><Icon name="close" size={20} /></button></div>
        {error && <Banner>{error}</Banner>}
        {!g && <span className="ys-spin" aria-label="Loading" />}
        {members.map((m) => (
          <div key={m.id} className="call-request">
            <Avatar name={m.displayName} photoUrl={m.photoUrl} size={36} />
            <span style={{ flex: 1 }}>{m.displayName}</span>
            {on.has(m.id) ? <span className="muted" style={{ fontSize: 13 }}>{call.participants.find((p) => p.userId === m.id)?.state === 'joined' ? 'On the call' : 'Ringing…'}</span>
              : <button type="button" className="btn" onClick={() => ring(m.id)} aria-label={`Ring ${m.displayName}`}>Ring</button>}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Voice and video buttons for a chat header; "Join" while a group call is going on. */
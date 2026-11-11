import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Modal, Pressable, ScrollView, StatusBar, StyleSheet, Vibration, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { VideoView } from '@livekit/react-native';
import { ConnectionQuality, Track, type Participant, type VideoTrack } from 'livekit-client';
import { ApiError, callDuration, type CallJoin, type CallMedia, type CallView } from '@yays/shared';
import { api } from '../lib/api';
import { useChatState, useEngine } from '../lib/chat';
import { font, useTheme } from '../lib/theme';
import { Icon, type IconName } from '../ui/Icon';
import { Oval } from '../ui/Oval';
import { Avatar, Banner } from '../ui/kit';
import { Text } from '../ui/Text';
import { askPermissions, CallSession } from './session';

const errText = (e: unknown, f: string) => (e instanceof ApiError ? e.message : f);
/** Calls look the same in light and dark mode: a dark room, like the phone's own call screen. */
const C = { bg: '#1f1a16', raised: 'rgba(255,255,255,0.12)', ink: '#ffffff', soft: 'rgba(255,255,255,0.72)', end: '#c85a45', accept: '#88f102', onAccept: '#1f1a16', ember: '#e5852b' };

// ---------------------------------------------------------------------------------------------------------------
// Calls for the whole signed-in app: start, answer, join, and the one call this phone is on.
// ---------------------------------------------------------------------------------------------------------------
interface CallsApi {
  session: CallSession | null;
  start(conversationId: string, media: CallMedia): Promise<void>;
  answer(callId: string, video: boolean): Promise<void>;
  /** Joins a group call that is already going on, from its chat. */
  join(callId: string, video: boolean): Promise<void>;
  error: string | null;
  clearError(): void;
  close(): void;
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
    if (!(await askPermissions(video))) {
      const msg = 'YaysApp needs your microphone for calls. Allow it in Settings, then try again.';
      setError(msg); throw new Error(msg);
    }
    if (current.current) { const old = current.current; current.current = null; setSession(null); await old.hangUp(); }
    try {
      const j = await get();
      engine.onCall(j.call);
      const s = new CallSession(j, video);
      current.current = s; setSession(s);
    } catch (e) { setError(errText(e, 'Could not start the call. Try again.')); throw e; }
  }, [engine]);
  const close = useCallback(() => { const x = current.current; if (x) { x.close(); current.current = null; setSession(null); } }, []);
  const value = useMemo<CallsApi>(() => ({
    session, error, clearError: () => setError(null), close,
    start: (conversationId, media) => open(() => api().then((c) => c.startCall(conversationId, media)), media === 'video'),
    answer: (callId, video) => open(() => api().then((c) => c.acceptCall(callId)), video),
    join: (callId, video) => open(() => api().then((c) => c.acceptCall(callId)), video),
  }), [session, error, open, close]);
  // When the call ends (the server says so), show "Call ended" for a moment, then close.
  const s = useChatState();
  const view = session ? s.calls[session.callId] : undefined;
  useEffect(() => {
    if (!session || view?.status !== 'ended') return;
    const t = setTimeout(() => { if (current.current === session) close(); }, 2500);
    return () => clearTimeout(t);
  }, [session, view?.status, close]);
  // Signing out or the app closing ends the call on this phone.
  useEffect(() => () => { current.current?.close(); }, []);
  return <CallsCtx.Provider value={value}>{children}</CallsCtx.Provider>;
}

// ---------------------------------------------------------------------------------------------------------------
// On top of every screen: a call ringing this phone, the call itself, or the mini bar while you use the app.
// ---------------------------------------------------------------------------------------------------------------
export function CallLayer({ openChat }: { openChat: (conversationId: string) => void }) {
  const engine = useEngine();
  const s = useChatState();
  const calls = useCalls();
  const me = engine.me;
  const ringing = Object.values(s.calls).filter((c) => c.status !== 'ended' && c.id !== calls.session?.callId && c.createdBy !== me && c.participants.some((p) => p.userId === me && p.state === 'ringing'))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const ring = ringing[0];
  // The phone vibrates while a call rings it (and stops for the call screen).
  useEffect(() => {
    if (!ring) return;
    Vibration.vibrate([0, 700, 1300], true);
    return () => Vibration.cancel();
  }, [ring?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      {calls.session ? <CallScreen session={calls.session} /> : null}
      {ring ? <IncomingCall call={ring} openChat={openChat} /> : null}
      {calls.error && !calls.session ? (
        <SafeAreaView edges={['top']} pointerEvents="box-none" style={styles.toastWrap}>
          <View style={styles.toast}>
            <View style={{ flex: 1 }}><Banner>{calls.error}</Banner></View>
            <Pressable accessibilityRole="button" accessibilityLabel="Dismiss" onPress={calls.clearError} hitSlop={10}><Icon name="close" size={18} color="#1f1a16" /></Pressable>
          </View>
        </SafeAreaView>
      ) : null}
    </>
  );
}

/** A round button with its label under it, for the dark call screens. */
function RoundButton({ icon, label, onPress, fill = C.raised, ink = C.ink, size = 60, pressed, disabled, testID }: { icon: IconName; label: string; onPress?: () => void; fill?: string; ink?: string; size?: number; pressed?: boolean; disabled?: boolean; testID?: string }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: !!disabled, selected: pressed }} onPress={disabled ? undefined : onPress} testID={testID}
      style={({ pressed: down }) => [{ alignItems: 'center', gap: 8, width: 72, opacity: disabled ? 0.45 : 1, transform: [{ scale: down ? 0.94 : 1 }] }]} hitSlop={6}>
      <Oval width={size} fill={fill}><Icon name={icon} size={size > 60 ? 28 : 24} color={ink} /></Oval>
      <Text numberOfLines={2} style={{ fontFamily: font.display, fontWeight: '700', fontSize: 12, color: C.soft, textAlign: 'center' }}>{label}</Text>
    </Pressable>
  );
}

function IncomingCall({ call, openChat }: { call: CallView; openChat: (id: string) => void }) {
  const calls = useCalls();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const caller = call.participants.find((p) => p.userId === call.createdBy);
  const kind = `${call.kind === 'group' ? 'group ' : ''}${call.media} call`;
  const answer = async (video: boolean) => { setBusy(true); try { await calls.answer(call.id, video); } catch (e) { setError(errText(e, 'Could not answer.')); setBusy(false); } };
  const decline = () => { void api().then((c) => c.declineCall(call.id)).catch(() => undefined); };
  return (
    <Modal visible animationType="slide" statusBarTranslucent onRequestClose={decline}>
      <StatusBar barStyle="light-content" />
      <SafeAreaView testID="incoming-call" style={[styles.fill, { backgroundColor: C.bg }]}>
        <View style={styles.center}>
          <Text style={styles.kind}><Icon name={call.media === 'video' ? 'video' : 'phone'} size={14} color={C.soft} />  Incoming {kind}</Text>
          <Rings><Avatar name={call.title} photoUrl={call.photoUrl} size={140} /></Rings>
          <Text accessibilityRole="header" style={styles.title} numberOfLines={2}>{call.title}</Text>
          {call.kind === 'group' && caller ? <Text style={styles.sub}>{caller.name} is calling</Text> : null}
          {error ? <View style={{ alignSelf: 'stretch', paddingHorizontal: 24 }}><Banner>{error}</Banner></View> : null}
        </View>
        <View style={styles.controls}>
          <RoundButton icon="phone-off" label="Decline" fill={C.end} size={68} onPress={decline} disabled={busy} />
          {call.conversationId ? <RoundButton icon="chat" label="Message" onPress={() => { decline(); openChat(call.conversationId!); }} disabled={busy} /> : null}
          {call.media === 'video' ? <RoundButton icon="phone" label="Voice only" onPress={() => void answer(false)} disabled={busy} /> : null}
          <RoundButton icon={call.media === 'video' ? 'video' : 'phone'} label="Accept" fill={C.accept} ink={C.onAccept} size={68} onPress={() => void answer(call.media === 'video')} disabled={busy} />
        </View>
      </SafeAreaView>
    </Modal>
  );
}

/** The brand ovals behind a big avatar, like the web call screen. */
function Rings({ children }: { children: ReactNode }) {
  return (
    <View style={{ width: 260, height: 240, alignItems: 'center', justifyContent: 'center' }}>
      <Oval width={260} fill="rgba(229,133,43,0.16)" style={StyleSheet.absoluteFillObject as never} />
      <Oval width={210} fill="rgba(229,133,43,0.22)" style={{ position: 'absolute', left: 25, top: 25 }} />
      {children}
    </View>
  );
}

function useTicker(on: boolean) {
  const [, set] = useState(0);
  useEffect(() => { if (!on) return; const t = setInterval(() => set((x) => x + 1), 1000); return () => clearInterval(t); }, [on]);
}

export function statusLine(view: CallView, state: CallSession['state'], me: string) {
  if (view.status === 'ended') {
    const o = view.outcome;
    if (o === 'declined') return 'Declined';
    if (o === 'busy') return 'On another call';
    if (o === 'missed' && view.createdBy === me) return 'No answer';
    return 'Call ended';
  }
  if (state === 'reconnecting') return 'Reconnecting…';
  if (state === 'connecting') return 'Connecting…';
  if (state === 'disconnected') return 'Disconnected';
  if (!view.startedAt) return view.participants.some((p) => p.userId !== me && p.state === 'ringing') ? 'Ringing…' : 'Calling…';
  return callDuration((Date.now() - Date.parse(view.startedAt)) / 1000);
}

const camTrack = (p: Participant) => { const pub = p.getTrackPublication(Track.Source.Camera); return pub?.track && !pub.isMuted ? (pub.track as VideoTrack) : undefined; };

function CallScreen({ session }: { session: CallSession }) {
  const engine = useEngine();
  const s = useChatState();
  const calls = useCalls();
  useSyncExternalStore(session.subscribe, session.getVersion, session.getVersion);
  const view = s.calls[session.callId] ?? session.first;
  const me = engine.me;
  const live = view.status !== 'ended';
  useTicker(live);
  const [adding, setAdding] = useState(false);
  const room = session.room;
  const remotes = [...room.remoteParticipants.values()];
  const everyone: Participant[] = [room.localParticipant, ...remotes];
  const anyVideo = everyone.some((p) => !!camTrack(p));
  const joined = view.participants.filter((p) => p.state === 'joined').length;
  const pending = view.participants.filter((p) => p.userId !== me && p.state === 'ringing');
  const status = statusLine(view, session.state, me);
  const subtitle = view.kind === 'direct' ? status : `${status}${view.startedAt && live ? ` · ${joined} on the call` : ''}`;
  const nameOf = (p: Participant) => (p.isLocal ? 'You' : view.participants.find((x) => x.userId === p.identity)?.name ?? p.name ?? 'Someone');
  const photoOf = (p: Participant) => view.participants.find((x) => x.userId === (p.isLocal ? me : p.identity))?.photoUrl ?? null;
  const weak = live && (room.localParticipant.connectionQuality === ConnectionQuality.Poor || remotes.some((p) => p.connectionQuality === ConnectionQuality.Poor));
  const hangUp = () => { void session.hangUp().then(calls.close); };

  if (session.minimized) {
    return (
      <SafeAreaView edges={['bottom']} pointerEvents="box-none" style={styles.miniWrap}>
        <View testID="call-bar" style={styles.mini}>
          <Pressable accessibilityRole="button" accessibilityLabel="Back to call" onPress={() => session.setMinimized(false)} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, minWidth: 0 }}>
            <Icon name={view.media === 'video' ? 'video' : 'phone'} size={18} color={C.ink} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={1} style={{ color: C.ink, fontWeight: '800', fontFamily: font.display }}>{view.title}</Text>
              <Text testID="call-status" style={{ color: C.soft, fontSize: 12 }}>{subtitle}</Text>
            </View>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={session.mic ? 'Mute' : 'Unmute'} onPress={() => void session.toggleMic()} hitSlop={8} style={styles.miniBtn}><Icon name={session.mic ? 'mic' : 'mic-off'} size={18} color={C.ink} /></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="End call" onPress={hangUp} hitSlop={8} style={[styles.miniBtn, { backgroundColor: C.end }]}><Icon name="phone-off" size={18} color={C.ink} /></Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const remoteVideo = view.kind === 'direct' ? remotes.find((p) => camTrack(p)) : undefined;
  const myVideo = camTrack(room.localParticipant);
  return (
    <Modal visible animationType="slide" statusBarTranslucent onRequestClose={() => session.setMinimized(true)}>
      <StatusBar barStyle="light-content" />
      <View testID="call-screen" accessibilityLabel={`${view.media === 'video' ? 'Video' : 'Voice'} call with ${view.title}`} style={[styles.fill, { backgroundColor: C.bg }]}>
        {/* A one-to-one video call: the other person fills the screen, you in the corner. */}
        {remoteVideo ? <VideoView videoTrack={camTrack(remoteVideo)} objectFit="cover" style={StyleSheet.absoluteFillObject} /> : null}
        <SafeAreaView style={styles.fill} pointerEvents="box-none">
          <View style={[styles.head, remoteVideo ? styles.scrim : null]}>
            <Pressable accessibilityRole="button" accessibilityLabel="Minimise call" onPress={() => session.setMinimized(true)} hitSlop={12} style={styles.headBtn}><Icon name="chevron-down" size={22} color={C.ink} /></Pressable>
            <View style={{ flex: 1, alignItems: 'center' }}>
              <Text style={{ color: C.soft, fontSize: 13, fontFamily: font.display, fontWeight: '700' }}>YaysApp {view.kind === 'group' ? 'group ' : ''}{view.media} call</Text>
              {anyVideo ? <Text numberOfLines={1} style={{ color: C.ink, fontSize: 17, fontWeight: '800', fontFamily: font.display }}>{view.title}</Text> : null}
              {anyVideo ? <Text testID="call-status" style={{ color: C.soft, fontSize: 13 }}>{subtitle}</Text> : null}
            </View>
            <View style={{ width: 40 }} />
          </View>
          {session.error ? <View style={{ paddingHorizontal: 16 }}><Banner tone="warning">{session.error}</Banner></View> : null}
          {weak ? <View style={styles.chip}><Icon name="alert-triangle" size={14} color={C.ink} /><Text style={{ color: C.ink, fontSize: 13 }}>Weak connection. Video lowered to keep the call going.</Text></View> : null}

          {remoteVideo ? <View style={{ flex: 1 }} />
            : anyVideo ? (
              <ScrollView contentContainerStyle={styles.grid}>
                {everyone.map((p) => {
                  const v = camTrack(p);
                  return (
                    <View key={p.identity || 'me'} testID="call-tile" style={[styles.tile, p.isSpeaking ? { borderColor: '#e5852b' } : null]}>
                      {v ? <VideoView videoTrack={v} objectFit="cover" mirror={p.isLocal && session.frontCamera} style={StyleSheet.absoluteFillObject} /> : <Avatar name={nameOf(p) === 'You' ? view.participants.find((x) => x.userId === me)?.name ?? 'You' : nameOf(p)} photoUrl={photoOf(p)} size={64} />}
                      <View style={styles.tileLabel}>{!p.isMicrophoneEnabled ? <Icon name="mic-off" size={12} color={C.ink} /> : null}<Text numberOfLines={1} style={{ color: C.ink, fontSize: 12, fontWeight: '700' }}>{nameOf(p)}</Text></View>
                    </View>
                  );
                })}
                {pending.map((p) => <View key={p.userId} testID="call-pending" style={[styles.tile, { opacity: 0.6 }]}><Avatar name={p.name} photoUrl={p.photoUrl} size={48} /><Text style={{ color: C.soft, fontSize: 12, marginTop: 6 }}>{p.name.split(' ')[0]} · Ringing…</Text></View>)}
              </ScrollView>
            ) : (
              <View style={styles.center}>
                <Rings><Avatar name={view.title} photoUrl={view.photoUrl} size={140} /></Rings>
                <Text accessibilityRole="header" style={styles.title} numberOfLines={2}>{view.title}</Text>
                <Text testID="call-status" style={styles.sub}>{subtitle}</Text>
                {view.kind !== 'direct' ? (
                  <View accessibilityLabel="On the call" style={styles.people}>
                    {everyone.map((p) => <View key={p.identity || 'me'} testID="call-tile" style={[styles.person, p.isSpeaking ? { borderColor: '#e5852b' } : null]}><Text style={{ color: C.ink, fontSize: 13, fontWeight: '700' }}>{nameOf(p)}</Text>{!p.isMicrophoneEnabled ? <Icon name="mic-off" size={12} color={C.soft} /> : null}</View>)}
                    {pending.map((p) => <View key={p.userId} testID="call-pending" style={[styles.person, { opacity: 0.6 }]}><Text style={{ color: C.soft, fontSize: 13 }}>{p.name.split(' ')[0]} · Ringing…</Text></View>)}
                  </View>
                ) : remotes[0] && !remotes[0].isMicrophoneEnabled ? <View style={styles.chip}><Icon name="mic-off" size={14} color={C.ink} /><Text style={{ color: C.ink, fontSize: 13 }}>{view.title.split(' ')[0]} is muted</Text></View> : null}
              </View>
            )}

          {/* You, in the corner of a one-to-one video call. */}
          {remoteVideo && myVideo ? <View testID="local-video" style={styles.selfie}><VideoView videoTrack={myVideo} objectFit="cover" mirror={session.frontCamera} zOrder={1} style={StyleSheet.absoluteFillObject} /></View> : null}

          <View style={styles.controls}>
            <RoundButton icon={session.speaker ? 'volume' : 'volume-off'} label={session.speaker ? 'Speaker on' : 'Speaker'} pressed={session.speaker} fill={session.speaker ? '#ffffff' : C.raised} ink={session.speaker ? C.bg : C.ink} onPress={() => void session.toggleSpeaker()} disabled={!live} />
            <RoundButton icon={session.cam ? 'video' : 'video-off'} label={session.cam ? 'Camera off' : 'Camera'} pressed={session.cam} onPress={() => void session.toggleCam()} disabled={!live} />
            <RoundButton icon={session.mic ? 'mic' : 'mic-off'} label={session.mic ? 'Mute' : 'Unmute'} pressed={!session.mic} fill={session.mic ? C.raised : '#ffffff'} ink={session.mic ? C.ink : C.bg} onPress={() => void session.toggleMic()} disabled={!live} />
            {session.cam ? <RoundButton icon="refresh" label="Flip" onPress={() => void session.flipCamera()} disabled={!live} />
              : view.kind === 'group' ? <RoundButton icon="person-add" label="Add people" onPress={() => setAdding(true)} disabled={!live} /> : null}
            <RoundButton icon="phone-off" label={view.kind === 'direct' ? 'End' : 'Leave'} fill={C.end} onPress={hangUp} testID="hang-up" />
          </View>
        </SafeAreaView>
        {adding && view.conversationId ? <AddPeople call={view} onClose={() => setAdding(false)} /> : null}
      </View>
    </Modal>
  );
}

/** Ring more people from the group into its call. */
function AddPeople({ call, onClose }: { call: CallView; onClose: () => void }) {
  const t = useTheme();
  const engine = useEngine();
  const s = useChatState();
  const g = call.conversationId ? s.groups[call.conversationId] : undefined;
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (call.conversationId && !g) void engine.loadGroup(call.conversationId).catch(() => undefined); }, [call.conversationId, g, engine]);
  const on = new Map(call.participants.filter((p) => p.state === 'joined' || p.state === 'ringing').map((p) => [p.userId, p.state]));
  const members = (g?.members ?? []).filter((m) => m.id !== engine.me);
  const ring = (id: string) => { void api().then((c) => c.inviteToCall(call.id, [id])).then((v) => engine.onCall(v)).catch((e) => setError(errText(e, 'Could not ring them.'))); };
  return (
    <Modal transparent visible animationType="slide" onRequestClose={onClose}>
      <Pressable accessibilityLabel="Close" style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' }} onPress={onClose} />
      <SafeAreaView edges={['bottom']} testID="add-people" style={{ backgroundColor: t.ground, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 16, gap: 8, maxHeight: '70%' }}>
        <Text accessibilityRole="header" style={{ fontFamily: font.display, fontWeight: '800', fontSize: 18, color: t.ink, paddingHorizontal: 4 }}>Add people</Text>
        {error ? <Banner>{error}</Banner> : null}
        <ScrollView>
          {members.map((m) => (
            <View key={m.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 }}>
              <Avatar name={m.displayName} photoUrl={m.photoUrl} size={40} />
              <Text style={{ flex: 1, fontWeight: '700', color: t.ink, fontSize: 15 }}>{m.displayName}</Text>
              {on.has(m.id) ? <Text style={{ color: t['ink-soft'], fontSize: 13 }}>{on.get(m.id) === 'joined' ? 'On the call' : 'Ringing…'}</Text>
                : <Pressable accessibilityRole="button" accessibilityLabel={`Ring ${m.displayName}`} onPress={() => ring(m.id)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: t['ember-wash'] }}>
                  <Icon name="phone" size={16} color={t['ember-ink']} /><Text style={{ color: t['ember-ink'], fontWeight: '700', fontFamily: font.display }}>Ring</Text>
                </Pressable>}
            </View>
          ))}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

/** Voice and video buttons for a chat's header; "Join" while a group call is going on that this phone isn't on. */
export function CallButtons({ conversationId, canCall, live }: { conversationId: string; canCall: boolean; live?: { id: string; media: CallMedia; count: number } | null }) {
  const t = useTheme();
  const calls = useCalls();
  const [busy, setBusy] = useState(false);
  if (!canCall) return null;
  const go = (fn: () => Promise<void>) => { setBusy(true); void fn().catch(() => undefined).finally(() => setBusy(false)); };
  const onThis = !!calls.session && !!live && calls.session.callId === live.id;
  if (live && !onThis) return (
    <Pressable accessibilityRole="button" accessibilityLabel={`Join ${live.media} call`} disabled={busy} onPress={() => go(() => calls.join(live.id, false))}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, backgroundColor: t.success }}>
      <Icon name={live.media === 'video' ? 'video' : 'phone'} size={16} color={t['on-success']} />
      <Text style={{ fontFamily: font.display, fontWeight: '800', color: t['on-success'] }}>Join · {live.count}</Text>
    </Pressable>
  );
  const btn = (media: CallMedia) => (
    <Pressable key={media} accessibilityRole="button" accessibilityLabel={media === 'video' ? 'Video call' : 'Voice call'} accessibilityState={{ disabled: busy || !!calls.session }} disabled={busy || !!calls.session}
      onPress={() => go(() => calls.start(conversationId, media))} hitSlop={8} style={{ padding: 6, opacity: busy || calls.session ? 0.4 : 1 }}>
      <Icon name={media === 'video' ? 'video' : 'phone'} size={22} color={t['ember-ink']} />
    </Pressable>
  );
  return <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>{btn('video')}{btn('voice')}</View>;
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, paddingHorizontal: 24 },
  kind: { color: C.soft, fontSize: 14, fontWeight: '700', fontFamily: font.display, marginBottom: 6 },
  title: { color: C.ink, fontSize: 30, fontWeight: '800', fontFamily: font.display, textAlign: 'center' },
  sub: { color: C.soft, fontSize: 16, textAlign: 'center' },
  head: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8 },
  /** Keeps the name and timer readable over someone's video. */
  scrim: { backgroundColor: 'rgba(0,0,0,0.38)', marginHorizontal: 12, borderRadius: 24 },
  headBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.25)' },
  controls: { flexDirection: 'row', justifyContent: 'space-evenly', alignItems: 'flex-start', paddingHorizontal: 8, paddingTop: 16, paddingBottom: 24 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'center', marginTop: 8, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, backgroundColor: 'rgba(0,0,0,0.35)' },
  people: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8, marginTop: 12 },
  person: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, backgroundColor: C.raised, borderWidth: 2, borderColor: 'transparent' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, padding: 12, justifyContent: 'center' },
  tile: { width: '47%', aspectRatio: 3 / 4, borderRadius: 20, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', backgroundColor: '#2c2520', borderWidth: 2, borderColor: 'transparent' },
  tileLabel: { position: 'absolute', left: 8, bottom: 8, flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, backgroundColor: 'rgba(0,0,0,0.45)', maxWidth: '90%' },
  selfie: { position: 'absolute', right: 16, top: 110, width: 108, height: 156, borderRadius: 18, overflow: 'hidden', backgroundColor: '#2c2520', borderWidth: 2, borderColor: 'rgba(255,255,255,0.6)' },
  toastWrap: { position: 'absolute', left: 0, right: 0, top: 0, zIndex: 50 },
  toast: { flexDirection: 'row', alignItems: 'center', gap: 8, margin: 12, padding: 8, borderRadius: 18, backgroundColor: '#ffffff', shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 12, elevation: 6 },
  /** Above the tab bar and the message box, so neither the header nor what you type is covered. */
  miniWrap: { position: 'absolute', left: 0, right: 0, bottom: 84, zIndex: 50 },
  mini: { flexDirection: 'row', alignItems: 'center', gap: 10, marginHorizontal: 12, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 22, backgroundColor: C.ember, shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 10, elevation: 8 },
  miniBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.2)' },
});

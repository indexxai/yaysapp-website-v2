import { useEffect, useRef } from 'react';
import { AppState, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { callIdFromUuid, callUuid } from '@yays/shared';
import { api } from '../lib/api';
import { useChatState } from '../lib/chat';
import { useCalls } from './Calls';

// ---------------------------------------------------------------------------------------------------------------
// Ringing when YaysApp is closed or the phone is locked, like a phone call.
//
// iPhone: the server sends a VoIP push; AppDelegate.swift shows it on the phone's call screen (CallKit) at once, as
// Apple requires. Answer and End on that screen come here, and the app answers or declines the call.
// Android: the server sends a data-only push; the app shows a full-screen call notification that keeps ringing,
// with Answer and Decline (Notifee). Firebase hands the push to the app even when it's closed (index.js).
// ---------------------------------------------------------------------------------------------------------------
export interface CallPush { type?: string; callId?: string; uuid?: string; media?: string; caller?: string; title?: string; body?: string }
const PENDING = 'yays.call.answer';
const notifId = (callId: string) => `call:${callId}`;

/* ------------------------------------------------------------------ Android */

const notifee = () => (Platform.OS === 'android' ? (require('@notifee/react-native') as typeof import('@notifee/react-native')) : null);

/** The full-screen incoming call: rings (looping) until answered, declined, or 45 seconds pass. */
export async function showIncoming(d: CallPush) {
  const n = notifee();
  if (!n || !d.callId) return;
  const N = n.default;
  // The channel is also made natively (MainApplication.kt) with the phone's ringtone; this is a no-op then.
  await N.createChannel({ id: 'calls', name: 'Calls', importance: n.AndroidImportance.HIGH, sound: 'default', vibration: true });
  const video = d.media === 'video';
  await N.displayNotification({
    id: notifId(d.callId),
    title: d.caller ?? d.title ?? 'YaysApp',
    body: video ? 'Incoming video call' : 'Incoming voice call',
    data: { callId: d.callId, media: d.media ?? 'voice' },
    android: {
      channelId: 'calls', category: n.AndroidCategory.CALL, importance: n.AndroidImportance.HIGH, visibility: n.AndroidVisibility.PUBLIC,
      ongoing: true, autoCancel: false, loopSound: true, timeoutAfter: 45_000, smallIcon: 'ic_launcher', lightUpScreen: true,
      // Locked or busy elsewhere: the call screen takes over; otherwise a heads-up with the two buttons.
      fullScreenAction: { id: 'default', launchActivity: 'default' },
      pressAction: { id: 'default', launchActivity: 'default' },
      actions: [
        { title: 'Decline', pressAction: { id: 'decline' } },
        { title: video ? 'Answer video' : 'Answer', pressAction: { id: 'answer', launchActivity: 'default' } },
      ],
    },
  });
}
export const stopRinging = async (callId: string) => { await notifee()?.default.cancelNotification(notifId(callId)).catch(() => undefined); };

/** A call push, from Firebase in the background or while open. */
export async function handleCallPush(d: CallPush) {
  if (d.type === 'call') await showIncoming(d);
  else if (d.type === 'call_end' && d.callId) await stopRinging(d.callId);
}

/** Answer / Decline on the notification. Answer opens the app; it picks the call up from here when it's ready. */
export async function handleNotificationAction(action: string | undefined, data: Record<string, unknown> | undefined) {
  const callId = typeof data?.callId === 'string' ? data.callId : null;
  if (!callId) return;
  if (action === 'decline') {
    await stopRinging(callId);
    await api().then((c) => c.declineCall(callId)).catch(() => undefined);
  } else if (action === 'answer') {
    await stopRinging(callId);
    await AsyncStorage.setItem(PENDING, JSON.stringify({ callId, video: data?.media === 'video', at: Date.now() })).catch(() => undefined);
  }
}

/** For index.js: pushes and button presses while YaysApp is closed or in the background. */
export function registerBackgroundCallHandlers() {
  if (Platform.OS !== 'android') return;
  try {
    const app = require('@react-native-firebase/app') as typeof import('@react-native-firebase/app');
    if (app.getApps().length) {
      const m = require('@react-native-firebase/messaging') as typeof import('@react-native-firebase/messaging');
      m.setBackgroundMessageHandler(m.getMessaging(), async (msg) => { await handleCallPush((msg.data ?? {}) as CallPush); });
    }
  } catch { /* no Firebase in this build: calls ring only while the app is open */ }
  const n = notifee();
  n?.default.onBackgroundEvent(async ({ type, detail }) => {
    if (type === n.EventType.ACTION_PRESS) await handleNotificationAction(detail.pressAction?.id, detail.notification?.data);
  });
}

/* ------------------------------------------------------------------ iPhone */

const callKeep = () => (Platform.OS === 'ios' ? (require('react-native-callkeep') as typeof import('react-native-callkeep')).default : null);
const voip = () => (Platform.OS === 'ios' ? (require('react-native-voip-push-notification') as typeof import('react-native-voip-push-notification')).default : null);

/* ------------------------------------------------------------------ the app, while signed in */

/**
 * Connects the phone's own call screens to the app's calls: answers and declines from them, keeps them in step with
 * the call (ended elsewhere, answered here, hung up here), and on iPhone gives the server the VoIP token.
 */
export function useNativeRinging() {
  const calls = useCalls();
  const state = useChatState();
  const ref = useRef({ calls, state });
  ref.current = { calls, state };
  /** Calls the phone's call screen knows about (iPhone), and whether it was answered there. */
  const shown = useRef(new Map<string, { video: boolean; answered: boolean }>());

  const answer = async (callId: string, video: boolean) => {
    const c = ref.current.calls;
    if (c.session?.callId === callId) return;
    await c.answer(callId, video).catch(() => undefined);
  };

  // iPhone: CallKit and the VoIP token.
  useEffect(() => {
    const CK = callKeep(), V = voip();
    if (!CK || !V) return;
    void CK.setup({ ios: { appName: 'YaysApp', supportsVideo: true, maximumCallGroups: '1', maximumCallsPerCallGroup: '1', includesCallsInRecents: false }, android: { alertTitle: '', alertDescription: '', cancelButton: '', okButton: '', additionalPermissions: [] } }).catch(() => undefined);
    const send = (token: string) => void api().then((c) => c.registerPushDevice({ platform: 'ios', token, sandbox: __DEV__, voip: true })).catch(() => undefined);
    const onAnswer = ({ callUUID }: { callUUID: string }) => {
      const id = callIdFromUuid(callUUID);
      const s = shown.current.get(id) ?? { video: false, answered: false };
      shown.current.set(id, { ...s, answered: true });
      void answer(id, s.video);
    };
    const onEnd = ({ callUUID }: { callUUID: string }) => {
      const id = callIdFromUuid(callUUID);
      shown.current.delete(id);
      const c = ref.current.calls;
      if (c.session?.callId === id) void c.session.hangUp().then(() => c.close());
      else void api().then((x) => x.declineCall(id)).catch(() => undefined);
    };
    const onShown = ({ callUUID, payload }: { callUUID: string; payload?: Record<string, unknown> }) => {
      if (payload?.type === 'call_end') return;
      shown.current.set(callIdFromUuid(callUUID), { video: payload?.media === 'video', answered: false });
    };
    const onMute = ({ muted, callUUID }: { muted: boolean; callUUID: string }) => {
      const s = ref.current.calls.session;
      if (s && s.callId === callIdFromUuid(callUUID) && s.mic === muted) void s.toggleMic();
    };
    CK.addEventListener('answerCall', onAnswer);
    CK.addEventListener('endCall', onEnd);
    CK.addEventListener('didDisplayIncomingCall', onShown as never);
    CK.addEventListener('didPerformSetMutedCallAction', onMute);
    V.addEventListener('register', send);
    // What happened before the app's JavaScript was running (the push that woke it, a tap on Answer).
    V.addEventListener('didLoadWithEvents', (events) => { for (const e of events ?? []) if (e.name === V.RNVoipPushRemoteNotificationsRegisteredEvent) send(e.data as string); });
    void CK.getInitialEvents().then((events) => {
      for (const e of events ?? []) {
        const d = e.data as { callUUID?: string; payload?: Record<string, unknown> };
        if (!d.callUUID) continue;
        if (e.name === 'RNCallKeepDidDisplayIncomingCall') onShown(d as { callUUID: string });
        else if (e.name === 'RNCallKeepPerformAnswerCallAction') onAnswer(d as { callUUID: string });
        else if (e.name === 'RNCallKeepPerformEndCallAction') onEnd(d as { callUUID: string });
      }
      CK.clearInitialEvents();
    }).catch(() => undefined);
    V.registerVoipToken();
    return () => {
      for (const ev of ['answerCall', 'endCall', 'didDisplayIncomingCall', 'didPerformSetMutedCallAction'] as const) CK.removeEventListener(ev);
      V.removeEventListener('register'); V.removeEventListener('didLoadWithEvents');
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Android: Answer pressed while the app was closed or in the background; pushes and presses while it's open.
  useEffect(() => {
    const n = notifee();
    if (!n) return;
    const pickUp = async () => {
      const raw = await AsyncStorage.getItem(PENDING).catch(() => null);
      if (!raw) return;
      await AsyncStorage.removeItem(PENDING).catch(() => undefined);
      const p = JSON.parse(raw) as { callId: string; video: boolean; at: number };
      if (Date.now() - p.at < 60_000) await answer(p.callId, p.video);
    };
    const offFg = n.default.onForegroundEvent(({ type, detail }) => {
      if (type === n.EventType.ACTION_PRESS) void handleNotificationAction(detail.pressAction?.id, detail.notification?.data).then(pickUp);
    });
    void n.default.getInitialNotification().then(async (i) => { if (i?.pressAction.id === 'answer') await handleNotificationAction('answer', i.notification.data); await pickUp(); }).catch(() => undefined);
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') void pickUp(); });
    let offMsg: (() => void) | undefined;
    try {
      const app = require('@react-native-firebase/app') as typeof import('@react-native-firebase/app');
      if (app.getApps().length) {
        const m = require('@react-native-firebase/messaging') as typeof import('@react-native-firebase/messaging');
        // While open the app rings itself; a "call over" still takes away a notification shown just before.
        offMsg = m.onMessage(m.getMessaging(), (msg) => { const d = (msg.data ?? {}) as CallPush; if (d.type === 'call_end') void handleCallPush(d); });
      }
    } catch { /* no Firebase in this build */ }
    return () => { offFg(); sub.remove(); offMsg?.(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the phone's call screens in step with the call.
  const sessionId = calls.session?.callId ?? null;
  const prevSession = useRef<string | null>(null);
  useEffect(() => {
    const CK = callKeep();
    // Answered here (in the app's own ringing screen): the notification stops, CallKit shows it as answered.
    if (sessionId) {
      void stopRinging(sessionId);
      const s = shown.current.get(sessionId);
      if (CK && s && !s.answered) { shown.current.set(sessionId, { ...s, answered: true }); CK.answerIncomingCall(callUuid(sessionId)); }
    }
    // Hung up here: CallKit's call ends too.
    const was = prevSession.current;
    if (was && was !== sessionId && shown.current.has(was)) { shown.current.delete(was); CK?.endCall(callUuid(was)); }
    prevSession.current = sessionId;
  }, [sessionId]);
  // Over before it was answered here (missed, answered on another device, the caller hung up): stop ringing.
  const over = useRef(new Set<string>());
  useEffect(() => {
    const CK = callKeep();
    for (const [id, v] of Object.entries(state.calls)) {
      if (v.status !== 'ended' || over.current.has(id)) continue;
      over.current.add(id);
      void stopRinging(id);
      if (shown.current.has(id) && sessionId !== id) { shown.current.delete(id); CK?.reportEndCallWithUUID(callUuid(id), 2); }
    }
  }, [state.calls, sessionId]);
}

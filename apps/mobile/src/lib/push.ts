import { useEffect, useRef } from 'react';
import { AppState, PermissionsAndroid, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from './api';

// ---------------------------------------------------------------------------------------------------------------
// Notifications on the phone. Android: Firebase Cloud Messaging. iPhone: Apple's push service directly. The phone
// asks once, gives the server its token, and opens the right chat when a notification is tapped. The server only
// notifies when YaysApp isn't open, so nothing here shows notifications itself.
// ---------------------------------------------------------------------------------------------------------------
/** What a notification carries (the server's push payload, as strings). */
export interface PushData { type?: string; conversationId?: string; callId?: string; tag?: string }
type Opened = (d: PushData) => void;
const ASKED = 'yays.push.asked';

/** Firebase is set up only when the build has google-services.json; without it, Android just has no notifications. */
function firebase() {
  if (Platform.OS !== 'android') return null;
  try {
    const app = require('@react-native-firebase/app') as typeof import('@react-native-firebase/app');
    if (!app.getApps().length) return null;
    const m = require('@react-native-firebase/messaging') as typeof import('@react-native-firebase/messaging');
    return { m, messaging: m.getMessaging() };
  } catch { return null; }
}
const ios = () => (Platform.OS === 'ios' ? (require('@react-native-community/push-notification-ios').default as typeof import('@react-native-community/push-notification-ios').default) : null);

async function send(token: string) {
  await (await api()).registerPushDevice({ platform: Platform.OS === 'ios' ? 'ios' : 'android', token, sandbox: Platform.OS === 'ios' && __DEV__ });
}

/** Android 13+ and iPhone ask the person, the first time only; after that this just checks what they chose. */
async function allowed(ask: boolean): Promise<boolean> {
  if (Platform.OS === 'android') {
    if (Number(Platform.Version) < 33) return true;
    if (!ask) return PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
    return (await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS)) === PermissionsAndroid.RESULTS.GRANTED;
  }
  const P = ios()!;
  // Asking again doesn't prompt on iPhone, and it registers with Apple's push service, so the token stays current.
  const p = ask ? await P.requestPermissions({ alert: true, badge: true, sound: true }) : await new Promise<{ alert?: boolean; sound?: boolean }>((r) => P.checkPermissions(r));
  if (!ask && (p.alert || p.sound)) await P.requestPermissions({ alert: true, badge: true, sound: true });
  return !!(p.alert || p.sound);
}

/**
 * While signed in: ask for notifications (once), keep the server's copy of this phone's token current, and open the
 * chat when a notification is tapped (also when the tap launched the app).
 */
export function usePushNotifications(onOpen: Opened) {
  const open = useRef(onOpen);
  open.current = onOpen;
  useEffect(() => {
    let stopped = false;
    const offs: Array<() => void> = [];
    const opened = (d: PushData | undefined) => { if (d && !stopped) open.current(d); };
    // iPhone: listen before asking, because asking registers with Apple and the token can arrive straight away.
    const P = ios();
    if (P) {
      P.addEventListener('register', (token) => { if (!stopped) void send(token).catch(() => undefined); });
      P.addEventListener('notification', (n) => {
        const d = n.getData() as PushData & { userInteraction?: number };
        if (d.userInteraction === 1) opened(d);
        // "Read on another device": take that chat's notifications off this phone.
        else if (d.type === 'read' && d.conversationId) clearChat(d.conversationId);
        n.finish('UIBackgroundFetchResultNoData');
      });
      offs.push(() => { P.removeEventListener('register'); P.removeEventListener('notification'); });
    }
    void (async () => {
      // Ask the first time; after that, carry on only if they said yes.
      const asked = await AsyncStorage.getItem(ASKED).catch(() => null);
      if (!asked) await AsyncStorage.setItem(ASKED, '1').catch(() => undefined);
      const ok = await allowed(!asked).catch(() => false);
      if (stopped || !ok) return;
      const fb = firebase();
      if (fb) {
        const { m, messaging } = fb;
        try { await send(await m.getToken(messaging)); } catch { /* offline or not set up: tried again on the next launch */ }
        offs.push(m.onTokenRefresh(messaging, (t) => { void send(t).catch(() => undefined); }));
        offs.push(m.onNotificationOpenedApp(messaging, (msg) => opened(msg.data as PushData)));
        const first = await m.getInitialNotification(messaging).catch(() => null);
        if (first) opened(first.data as PushData);
        return;
      }
      if (!P) return;
      const first = await P.getInitialNotification().catch(() => null);
      if (first) opened(first.getData() as PushData);
    })();
    return () => { stopped = true; for (const f of offs) f(); };
  }, []);
}

/** Removes a chat's notifications from the iPhone's notification list (opening the chat does the same). */
export function clearChat(conversationId: string) {
  const P = ios();
  if (!P) return;
  P.getDeliveredNotifications((list) => {
    const ids = list.filter((n) => (n.userInfo as PushData | undefined)?.conversationId === conversationId).map((n) => n.identifier as string);
    if (ids.length) P.removeDeliveredNotifications(ids);
  });
}

/** Coming back to the app clears the badge on the icon. */
export function useClearBadgeOnOpen() {
  useEffect(() => {
    const P = ios();
    if (!P) return;
    P.setApplicationIconBadgeNumber(0);
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') P.setApplicationIconBadgeNumber(0); });
    return () => sub.remove();
  }, []);
}
export const notificationsAllowed = () => allowed(false).catch(() => false);

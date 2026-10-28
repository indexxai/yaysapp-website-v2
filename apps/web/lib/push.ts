'use client';
import { api } from './api';

export type PushState = 'unsupported' | 'blocked' | 'off' | 'on';
const DISMISS_KEY = 'yays.push.dismissed';
/** Turned off in Settings on this browser, even though the browser still allows it. */
const OFF_KEY = 'yays.push.off';
const turnedOff = () => { try { return localStorage.getItem(OFF_KEY) === '1'; } catch { return false; } };

const supported = () => typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const b64ToBytes = (b64: string) => {
  const s = atob(b64.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
};

export function pushState(): PushState {
  if (!supported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'blocked';
  return Notification.permission === 'granted' && !turnedOff() ? 'on' : 'off';
}

export const bannerDismissed = () => { try { return localStorage.getItem(DISMISS_KEY) === '1' || turnedOff(); } catch { return false; } };
export const dismissBanner = () => { try { localStorage.setItem(DISMISS_KEY, '1'); } catch { /* fine */ } };

async function registration() {
  return navigator.serviceWorker.register('/sw.js', { scope: '/' }).then(() => navigator.serviceWorker.ready);
}

/** Subscribes this browser and tells the server. Safe to call on every visit (the server keeps one per browser). */
async function subscribe() {
  const reg = await registration();
  const { vapidPublicKey } = await api().request<{ vapidPublicKey: string }>('GET', '/v1/push/config', undefined, { auth: false });
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(vapidPublicKey) });
  const j = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
  await api().request('POST', '/v1/push/subscriptions', { endpoint: j.endpoint, keys: j.keys });
}

/** Asks for permission (only from a click) and turns notifications on. */
export async function enablePush(): Promise<PushState> {
  if (!supported()) return 'unsupported';
  const p = await Notification.requestPermission();
  if (p !== 'granted') return p === 'denied' ? 'blocked' : 'off';
  try { localStorage.removeItem(OFF_KEY); } catch { /* fine */ }
  await subscribe();
  return 'on';
}

/** Keeps the subscription fresh when permission was already given (the browser can rotate it). */
export async function refreshPush() {
  if (pushState() === 'on') await subscribe().catch(() => undefined);
}

/** On sign-out: this browser stops getting this account's notifications. */
export async function disablePush(remember = false) {
  if (!supported()) return;
  if (remember) { try { localStorage.setItem(OFF_KEY, '1'); } catch { /* fine */ } }
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  await api().request('DELETE', '/v1/push/subscriptions', { endpoint: sub.endpoint }).catch(() => undefined);
  await sub.unsubscribe().catch(() => undefined);
}

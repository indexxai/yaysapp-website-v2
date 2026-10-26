'use client';
import { YaysClient, type Tokens } from '@yays/shared';

const TOKENS_KEY = 'yays.tokens';
const DEVICE_KEY = 'yays.device';

const safe = <T,>(fn: () => T, fallback: T): T => { try { return fn(); } catch { return fallback; } };

function deviceId(): string {
  let id = safe(() => localStorage.getItem(DEVICE_KEY), null);
  if (!id) {
    id = 'web-' + crypto.randomUUID();
    safe(() => localStorage.setItem(DEVICE_KEY, id!), undefined);
  }
  return id;
}

function browserName() {
  const ua = navigator.userAgent;
  const b = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os = /Windows/.test(ua) ? 'Windows' : /Mac OS/.test(ua) ? 'Mac' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Linux/.test(ua) ? 'Linux' : '';
  return os ? `${b} on ${os}` : b;
}

let client: YaysClient | null = null;
const listeners = new Set<() => void>();
export const onSignedOut = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };

export function api(): YaysClient {
  if (!client) {
    client = new YaysClient({
      baseUrl: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000',
      device: { deviceId: deviceId(), platform: 'web', name: browserName(), appVersion: '0.1.0' },
      tokens: {
        get: () => safe(() => JSON.parse(localStorage.getItem(TOKENS_KEY) ?? 'null') as Tokens | null, null),
        set: (t) => safe(() => (t ? localStorage.setItem(TOKENS_KEY, JSON.stringify(t)) : localStorage.removeItem(TOKENS_KEY)), undefined),
      },
      onSignedOut: () => listeners.forEach((l) => l()),
    });
  }
  return client;
}

export const hasSession = () => safe(() => !!localStorage.getItem(TOKENS_KEY), false);

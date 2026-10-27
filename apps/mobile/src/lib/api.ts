import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Keychain from 'react-native-keychain';
import { Platform } from 'react-native';
import { YaysClient, type Tokens } from '@yays/shared';
import { config } from './config';

const SERVICE = 'yays.tokens';
const DEVICE_KEY = 'yays.deviceId';

/** Tokens live in the Keychain (iOS) / Keystore (Android), not plain storage. */
export const tokenStore = {
  async get(): Promise<Tokens | null> {
    try { const c = await Keychain.getGenericPassword({ service: SERVICE }); return c ? (JSON.parse(c.password) as Tokens) : null; } catch { return null; }
  },
  async set(t: Tokens | null) {
    if (t) await Keychain.setGenericPassword('session', JSON.stringify(t), { service: SERVICE, accessible: Keychain.ACCESSIBLE.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY });
    else {
      await Keychain.resetGenericPassword({ service: SERVICE });
      // Signed out: saved chats and unsent messages leave the phone too.
      const keys = (await AsyncStorage.getAllKeys().catch(() => [] as readonly string[])).filter((k) => k.startsWith('yays.cache.') || k.startsWith('yays.outbox.') || k === 'yays.me');
      if (keys.length) await AsyncStorage.multiRemove(keys).catch(() => undefined);
    }
  },
};

const randomId = () => {
  const hex = '0123456789abcdef';
  let s = '';
  for (let i = 0; i < 32; i++) s += hex[Math.floor(Math.random() * 16)];
  return `${Platform.OS}-${Date.now().toString(36)}-${s}`;
};
export async function deviceId() {
  let id = await AsyncStorage.getItem(DEVICE_KEY);
  if (!id) { id = randomId(); await AsyncStorage.setItem(DEVICE_KEY, id); }
  return id;
}

let client: YaysClient | null = null;
const listeners = new Set<() => void>();
export const onSignedOut = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };

export async function api(): Promise<YaysClient> {
  if (!client) {
    client = new YaysClient({
      baseUrl: config.apiUrl,
      tokens: tokenStore,
      device: { deviceId: await deviceId(), platform: Platform.OS === 'ios' ? 'ios' : 'android', name: Platform.OS === 'ios' ? 'iPhone' : 'Android phone', appVersion: config.appVersion },
      onSignedOut: () => listeners.forEach((l) => l()),
    });
  }
  return client;
}
/** Tests point the app at a different server. */
export const resetApiForTests = () => { client = null; };

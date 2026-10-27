import { randomUUID } from 'crypto';
import { io, type Socket } from 'socket.io-client';
import { bearer, device, signUpPhone, type TestApp } from './helpers';

export interface TUser { id: string; token: string; auth: { authorization: string }; body: { tokens: import('@yays/shared').Tokens; me: { id: string } }; name: string }

let n = 0;
/** A fresh v2 user with a name and username. */
export async function makeUser(t: TestApp, name: string, dev = device(1)): Promise<TUser> {
  const i = ++n + Math.floor(Math.random() * 1000) * 100;
  const phone = `+92300${String(2000000 + i).padStart(7, '0')}`;
  const body = await signUpPhone(t, phone, `${name.toLowerCase()}${i}@example.com`, dev);
  // Every sign-up comes from 127.0.0.1; clear the per-IP code limit so a test can make many users.
  const keys = await t.redis.keys('rl:otp:ip:*');
  if (keys.length) await t.redis.del(...keys);
  await t.http.patch('/v1/me').set(bearer(body)).send({ displayName: name, username: `${name.toLowerCase()}_${i}` }).expect(200);
  return { id: body.me.id, token: body.tokens.accessToken, auth: bearer(body), body, name };
}

export const cid = () => randomUUID();

/** Connects a socket and resolves once the server accepted it (or rejects with the server's reason). */
export function connect(url: string, token: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const s = io(url, { path: '/v1/socket', auth: { token }, transports: ['websocket'], forceNew: true, reconnection: false, timeout: 5000 });
    s.once('connect', () => resolve(s));
    s.once('connect_error', (e: Error & { data?: unknown }) => { s.close(); reject(e); });
  });
}

export function emit<T = unknown>(s: Socket, event: string, payload: unknown): Promise<{ ok: boolean; data?: T; error?: { status: number; code: string; message: string } }> {
  return s.timeout(5000).emitWithAck(event, payload);
}

/** The next `event` on this socket that matches, or a timeout error. */
export function next<T = any>(s: Socket, event: string, match: (p: T) => boolean = () => true, ms = 4000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { s.off(event, h); reject(new Error(`no ${event} within ${ms} ms`)); }, ms);
    const h = (p: T) => { if (match(p)) { clearTimeout(timer); s.off(event, h); resolve(p); } };
    s.on(event, h);
  });
}

/** Collects every `event` on the socket, to check later that something did NOT arrive. */
export function record<T = any>(s: Socket, event: string) { const got: T[] = []; s.on(event, (p: T) => got.push(p)); return got; }
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

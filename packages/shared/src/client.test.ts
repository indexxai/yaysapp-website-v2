import test from 'node:test';
import assert from 'node:assert';
import { YaysClient } from './client';
import { ApiError } from './errors';
import type { Tokens } from './types';

const tok = (n: number): Tokens => ({ accessToken: 'a' + n, refreshToken: 'r'.repeat(30) + n, accessExpiresAt: '', sessionId: 's' });
function setup(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  let stored: Tokens | null = tok(1);
  let signedOut = 0;
  const calls: string[] = [];
  const c = new YaysClient({
    baseUrl: 'http://x', device: { deviceId: 'dev-12345678', platform: 'web' },
    tokens: { get: () => stored, set: (t) => { stored = t; } },
    onSignedOut: () => { signedOut++; },
    fetch: (async (u: string, i: RequestInit) => { calls.push(`${i.method} ${u} ${(i.headers as Record<string, string>).authorization ?? ''}`); return handler(u, i); }) as typeof fetch,
  });
  return { c, calls, get stored() { return stored; }, get signedOut() { return signedOut; } };
}
const json = (s: number, b: unknown) => new Response(JSON.stringify(b), { status: s, headers: { 'content-type': 'application/json' } });

test('401 refreshes once and retries with the new token', async () => {
  const s = setup((u, i) => {
    if (u.endsWith('/auth/refresh')) return json(200, tok(2));
    return (i.headers as Record<string, string>).authorization === 'Bearer a2' ? json(200, { id: 'u1' }) : json(401, { error: { code: 'unauthenticated', message: 'x' } });
  });
  const me = await s.c.me();
  assert.deepStrictEqual(me, { id: 'u1' });
  assert.strictEqual(s.stored?.accessToken, 'a2');
});
test('parallel 401s share one refresh', async () => {
  let refreshes = 0;
  const s = setup(async (u, i) => {
    if (u.endsWith('/auth/refresh')) { refreshes++; await new Promise((r) => setTimeout(r, 20)); return json(200, tok(2)); }
    return (i.headers as Record<string, string>).authorization === 'Bearer a2' ? json(200, {}) : json(401, { error: { code: 'unauthenticated', message: 'x' } });
  });
  await Promise.all([s.c.me(), s.c.devices(), s.c.me()]);
  assert.strictEqual(refreshes, 1);
});
test('a rejected refresh signs the user out and surfaces the error', async () => {
  const s = setup((u) => u.endsWith('/auth/refresh') ? json(401, { error: { code: 'session_revoked', message: 'Signed out' } }) : json(401, { error: { code: 'unauthenticated', message: 'x' } }));
  await assert.rejects(() => s.c.me(), (e: unknown) => e instanceof ApiError && e.status === 401);
  assert.strictEqual(s.stored, null);
  assert.strictEqual(s.signedOut, 1);
});
test('network failure is a friendly error, and keeps the session', async () => {
  const s = setup(() => { throw new TypeError('fetch failed'); });
  await assert.rejects(() => s.c.me(), (e: unknown) => e instanceof ApiError && e.status === 0 && /connection/i.test(e.message));
  assert.ok(s.stored);
});
test('non-JSON error pages still give an ApiError', async () => {
  const s = setup(() => new Response('<html>502</html>', { status: 502 }));
  await assert.rejects(() => s.c.health(), (e: unknown) => e instanceof ApiError && e.status === 502);
});
test('rate-limit details expose retryAfter', async () => {
  const s = setup(() => json(429, { error: { code: 'rate_limited', message: 'Wait', details: { retryAfter: 27 } } }));
  await assert.rejects(() => s.c.startPhone('+923001234567'), (e: unknown) => e instanceof ApiError && e.retryAfter === 27);
});

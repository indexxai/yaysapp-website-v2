import { API, codeFor, freshEmail, freshPhone } from './helpers';

/** People made through the real API, for the app to talk to. */
export interface U { id: string; name: string; username: string; tokens: { accessToken: string } & Record<string, string> }
export async function call(path: string, body?: unknown, token?: string, method = body === undefined ? 'GET' : 'POST') {
  const r = await fetch(`${API}${path}`, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const j = r.status === 204 ? null : await r.json();
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status} ${JSON.stringify(j)}`);
  return j;
}
export async function user(name: string): Promise<U> {
  const phone = freshPhone(), email = freshEmail(name.toLowerCase());
  const dev = { deviceId: `m-${phone.slice(-7)}-device`, platform: 'android', name: 'Test phone' };
  await call('/v1/auth/phone/start', { phone });
  const v = await call('/v1/auth/phone/verify', { phone, code: await codeFor(phone), device: dev });
  await call('/v1/auth/signup/email/start', { signupToken: v.signupToken, email });
  const r = await call('/v1/auth/signup/email/verify', { signupToken: v.signupToken, email, code: await codeFor(email), device: dev });
  const username = `${name.toLowerCase()}_${phone.slice(-6)}`;
  await call('/v1/me', { displayName: name, username }, r.tokens.accessToken, 'PATCH');
  return { id: r.me.id, name, username, tokens: r.tokens };
}
export const uuid = () => 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, () => Math.floor(Math.random() * 16).toString(16));
export const say = (from: U, convId: string, text: string) => call(`/v1/conversations/${convId}/messages`, { clientId: uuid(), text }, from.tokens.accessToken);


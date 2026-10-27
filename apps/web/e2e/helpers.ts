import { expect, type Page } from '@playwright/test';
import { MongoClient, ObjectId } from 'mongodb';

export const API = 'http://127.0.0.1:4100';
let n = Date.now() % 1_000_000;
/** A fresh Pakistani mobile number for each test, so tests never collide. */
export const freshPhone = () => `+92300${String(++n).padStart(7, '0').slice(-7)}`;
export const freshEmail = (tag = 'user') => `${tag}.${++n}@example.com`;
export const local = (e164: string) => '0' + e164.slice(3); // +923001234567 -> 03001234567

export async function codeFor(to: string): Promise<string> {
  for (let i = 0; i < 20; i++) {
    const r = await fetch(`${API}/v1/_test/outbox?to=${encodeURIComponent(to)}`);
    if (r.ok) return ((await r.json()) as { code: string }).code;
    await new Promise((x) => setTimeout(x, 150));
  }
  throw new Error(`no code sent to ${to}`);
}

export async function db<T>(fn: (d: import('mongodb').Db) => Promise<T>): Promise<T> {
  const c = await new MongoClient('mongodb://127.0.0.1:27120/?replicaSet=rs0').connect();
  try { return await fn(c.db('web_e2e')); } finally { await c.close(); }
}
export const seedLegacy = (email: string, extra: Record<string, unknown> = {}) =>
  db((d) => d.collection('users').insertOne({ _id: new ObjectId(), email, firstName: 'Bilal', lastName: 'Khan', username: 'bilal_btcy', referralCode: 'BILAL1', userWallets: [{ coin: 'BTCY', balance: 50 }], ...extra }));

export async function typeCode(page: Page, code: string) {
  await page.getByLabel('6-digit code').fill(code);
}

/** Phone sign-up through the UI, ending on whatever page comes after the email step. */
export async function signUpWithPhone(page: Page, phone: string, email: string) {
  await page.goto('/sign-in');
  await page.getByLabel('Phone number').fill(local(phone));
  await page.getByRole('button', { name: 'Send code' }).click();
  await expect(page.getByRole('heading', { name: 'Enter the code' })).toBeVisible();
  await typeCode(page, await codeFor(phone));
  await expect(page.getByRole('heading', { name: 'Add your email' })).toBeVisible();
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Send code' }).click();
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
  await typeCode(page, await codeFor(email));
}

export async function signInWithEmail(page: Page, email: string) {
  await page.goto('/sign-in');
  await page.getByRole('tab', { name: 'Email' }).click();
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Send code' }).click();
  // Wait for the code screen, so the code read below is the one just sent and not an older one.
  await expect(page.getByLabel('6-digit code')).toBeVisible();
  await typeCode(page, await codeFor(email));
}

export interface ApiUser { id: string; name: string; username: string; email: string; phone: string; tokens: Record<string, string> }
async function call(path: string, body?: unknown, token?: string, method = body === undefined ? 'GET' : 'POST') {
  const r = await fetch(`${API}${path}`, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const j = r.status === 204 ? null : await r.json();
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status} ${JSON.stringify(j)}`);
  return j;
}
/** A signed-up user made straight through the API (faster than the UI), with a name and username. */
export async function apiUser(name: string): Promise<ApiUser> {
  const tag = name.toLowerCase().replace(/[^a-z]/g, '') || 'user';
  const phone = freshPhone(), email = freshEmail(tag);
  const dev = { deviceId: `web-${phone.slice(-7)}-device`, platform: 'web', name: 'Playwright' };
  await call('/v1/auth/phone/start', { phone });
  const v = await call('/v1/auth/phone/verify', { phone, code: await codeFor(phone), device: dev });
  await call('/v1/auth/signup/email/start', { signupToken: v.signupToken, email });
  const r = await call('/v1/auth/signup/email/verify', { signupToken: v.signupToken, email, code: await codeFor(email), device: dev });
  const username = `${tag}_${phone.slice(-6)}`;
  await call('/v1/me', { displayName: name, username }, r.tokens.accessToken, 'PATCH');
  return { id: r.me.id, name, username, email, phone, tokens: r.tokens };
}
/** A browser tab already signed in as this user. */
export async function pageAs(browser: import('@playwright/test').Browser, u: ApiUser, viewport = { width: 1280, height: 800 }) {
  const ctx = await browser.newContext({ baseURL: 'http://127.0.0.1:3100', viewport });
  await ctx.addInitScript((t) => { if (!localStorage.getItem('yays.tokens')) localStorage.setItem('yays.tokens', t); }, JSON.stringify(u.tokens));
  const page = await ctx.newPage();
  return { ctx, page };
}
export const apiCall = call;

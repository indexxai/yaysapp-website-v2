import { expect, type Page } from '@playwright/test';
import { MongoClient, ObjectId } from 'mongodb';

export const API = 'http://127.0.0.1:4100';
/** The daily check-in and bonus pop-ups open as the app starts; most tests are about something else. */
export const NO_POPUPS = () => { try { sessionStorage.setItem('yays.popup.asked', '1'); } catch { /* about:blank */ } };
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

/** The sign-in page opens on the QR code; this switches to signing in with a phone number or email. */
export async function openCodeSignIn(page: Page) {
  await page.goto('/sign-in');
  await page.getByRole('button', { name: 'Sign in with a code instead' }).click();
}

export async function typeCode(page: Page, code: string) {
  await page.getByLabel('6-digit code').fill(code);
}

/** Phone sign-up through the UI, ending on whatever page comes after the email step. */
export async function signUpWithPhone(page: Page, phone: string, email: string) {
  await openCodeSignIn(page);
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
  await openCodeSignIn(page);
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
export async function pageAs(browser: import('@playwright/test').Browser, u: ApiUser, viewport = { width: 1280, height: 800 }, opts: { askForPermissions?: boolean; popups?: boolean } = {}) {
  // askForPermissions: a browser that hasn't been asked anything yet (notifications show as "default").
  const ctx = await browser.newContext({ baseURL: 'http://127.0.0.1:3100', viewport, ...(opts.askForPermissions ? {} : { permissions: ['microphone', 'camera', 'clipboard-read', 'clipboard-write'] }) });
  await ctx.addInitScript((t) => { if (!localStorage.getItem('yays.tokens')) localStorage.setItem('yays.tokens', t); }, JSON.stringify(u.tokens));
  if (!opts.popups) await ctx.addInitScript(NO_POPUPS);
  const page = await ctx.newPage();
  return { ctx, page };
}
export const apiCall = call;

/** A real PNG of the given size (solid colour), for upload tests. */
export function png(w: number, h: number, rgb: [number, number, number] = [232, 128, 40]): Buffer {
  const zlib = require('zlib') as typeof import('zlib');
  const crcTable = [...Array(256)].map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type: string, data: Buffer) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array(w).fill(rgb).flat())]);
  const raw = Buffer.concat(Array(h).fill(row));
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

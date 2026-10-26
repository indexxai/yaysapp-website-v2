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
  await typeCode(page, await codeFor(email));
}

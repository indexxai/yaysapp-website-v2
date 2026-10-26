import { MongoClient, ObjectId } from 'mongodb';
export const API = 'http://127.0.0.1:4130';
let n = Date.now() % 1_000_000;
export const freshPhone = () => `+92301${String(++n).padStart(7, '0').slice(-7)}`;
export const freshEmail = (tag = 'm') => `${tag}.${++n}@example.com`;
export const local = (e164: string) => '0' + e164.slice(3);
export async function codeFor(to: string): Promise<string> {
  for (let i = 0; i < 30; i++) {
    const r = await fetch(`${API}/v1/_test/outbox?to=${encodeURIComponent(to)}`);
    if (r.ok) return ((await r.json()) as { code: string }).code;
    await new Promise<void>((x) => setTimeout(() => x(), 150));
  }
  throw new Error(`no code sent to ${to}`);
}
export async function db<T>(fn: (d: import('mongodb').Db) => Promise<T>) {
  const c = await new MongoClient('mongodb://127.0.0.1:27130/?replicaSet=rs0').connect();
  try { return await fn(c.db('mobile_e2e')); } finally { await c.close(); }
}
export const seedLegacy = (email: string) => db((d) => d.collection('users').insertOne({ _id: new ObjectId(), email, firstName: 'Zainab', lastName: 'Kazmi', referralCode: 'ZK1', userWallets: [{ coin: 'BTCY', balance: 9 }] }));

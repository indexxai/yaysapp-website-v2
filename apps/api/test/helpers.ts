import { readFileSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { MongoClient, type Db } from 'mongodb';
import type Redis from 'ioredis';
import { normalizeEmail } from '@yays/shared';
import { createApp } from '../src/app';

export interface TestApp { app: INestApplication; http: ReturnType<typeof request>; db: Db; redis: Redis; env: Record<string, string>; close(): Promise<void> }

let seq = 0;
export async function startApp(overrides: Record<string, string> = {}): Promise<TestApp> {
  const infra = JSON.parse(readFileSync(path.join(tmpdir(), 'yays-e2e-env.json'), 'utf8')) as { MONGO_URI: string; REDIS_URL: string };
  const env: Record<string, string> = {
    NODE_ENV: 'test', LOG_LEVEL: 'silent', TEST_OUTBOX: '1',
    MONGO_URI: infra.MONGO_URI, MONGO_DB: `e2e_${process.pid}_${Date.now()}_${seq++}`, REDIS_URL: infra.REDIS_URL,
    JWT_SECRET: 'test-secret-that-is-long-enough-1234567890', PUBLIC_URL: 'http://127.0.0.1:0',
    LOCAL_STORAGE_DIR: mkdtempSync(path.join(tmpdir(), 'yays-store-')), OTP_RESEND_SECONDS: '0', CORS_ORIGINS: 'http://localhost:3000',
    ...overrides,
  };
  const { app, db, redis, shutdown } = await createApp(env);
  await app.init();
  await redis.flushdb();
  const http = request(app.getHttpServer());
  return { app, http, db, redis, env, close: async () => { await db.dropDatabase().catch(() => undefined); await shutdown(); } };
}

export const device = (n = 1, platform: 'ios' | 'android' | 'web' = 'web') => ({ deviceId: `device-${n}-abcdefgh`, platform, name: `Test ${platform} ${n}` });

export async function lastCode(t: TestApp, to: string): Promise<string> {
  const r = await t.http.get('/v1/_test/outbox').query({ to });
  if (r.status !== 200) throw new Error(`no code sent to ${to}: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body.code as string;
}
export const wrongCode = (c: string) => String((Number(c) + 1) % 1_000_000).padStart(6, '0');

/** Full phone sign-up: phone code, then email code. Returns the auth result body. */
export async function signUpPhone(t: TestApp, phone: string, email: string, dev = device()) {
  await t.http.post('/v1/auth/phone/start').send({ phone }).expect(200);
  const v = await t.http.post('/v1/auth/phone/verify').send({ phone, code: await lastCode(t, phone), device: dev }).expect(200);
  if (v.body.status === 'signed_in') return v.body;
  await t.http.post('/v1/auth/signup/email/start').send({ signupToken: v.body.signupToken, email }).expect(200);
  const r = await t.http.post('/v1/auth/signup/email/verify').send({ signupToken: v.body.signupToken, email, code: await lastCode(t, email), device: dev });
  if (r.status !== 200) throw new Error(`signup failed ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
}
export async function signInEmail(t: TestApp, email: string, dev = device()) {
  await t.http.post('/v1/auth/email/start').send({ email }).expect(200);
  return (await t.http.post('/v1/auth/email/verify').send({ email, code: await lastCode(t, normalizeEmail(email)!), device: dev }).expect(200)).body;
}
export const bearer = (b: { tokens: { accessToken: string } }) => ({ authorization: `Bearer ${b.tokens.accessToken}` });
export const googleToken = (p: Record<string, unknown>) => 'dev.' + Buffer.from(JSON.stringify(p)).toString('base64url');

export function infraEnv() { return JSON.parse(readFileSync(path.join(tmpdir(), 'yays-e2e-env.json'), 'utf8')) as { MONGO_URI: string; REDIS_URL: string }; }
/** A direct connection, for seeding legacy data the way the old backend wrote it. */
export async function withRawDb<T>(dbName: string, fn: (db: Db) => Promise<T>): Promise<T> {
  const c = await new MongoClient(infraEnv().MONGO_URI).connect();
  try { return await fn(c.db(dbName)); } finally { await c.close(); }
}

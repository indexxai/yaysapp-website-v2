import { loadConfig } from '../src/config';
import { startApp, withRawDb, type TestApp } from './helpers';

describe('Week 1 · foundation', () => {
  let t: TestApp;
  beforeAll(async () => { t = await startApp(); });
  afterAll(async () => { await t.close(); });

  it('health reports MongoDB, Redis and storage as up', async () => {
    const r = await t.http.get('/v1/health').expect(200);
    expect(r.body.status).toBe('ok');
    for (const k of ['mongo', 'redis', 'storage']) expect(r.body.checks[k].ok).toBe(true);
    expect(typeof r.body.uptimeSeconds).toBe('number');
  });

  it('runs on a replica set, so transactions work', async () => {
    const hello = await t.db.admin().command({ hello: 1 });
    expect(hello.setName).toBe('rs0');
  });

  it('echoes a request id and sets security headers', async () => {
    const r = await t.http.get('/v1/health').set('x-request-id', 'trace-123');
    expect(r.headers['x-request-id']).toBe('trace-123');
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.headers['x-powered-by']).toBeUndefined();
    const auto = await t.http.get('/v1/health');
    expect(auto.headers['x-request-id']).toMatch(/[0-9a-f-]{36}/);
  });

  it('allows the web origin and no other', async () => {
    const ok = await t.http.options('/v1/health').set('Origin', 'http://localhost:3000').set('Access-Control-Request-Method', 'GET');
    expect(ok.headers['access-control-allow-origin']).toBe('http://localhost:3000');
    const bad = await t.http.options('/v1/health').set('Origin', 'https://evil.example').set('Access-Control-Request-Method', 'GET');
    expect(bad.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('unknown routes return the shared error shape', async () => {
    const r = await t.http.get('/v1/nope').expect(404);
    expect(r.body.error).toMatchObject({ code: 'not_found' });
    expect(r.body.error.requestId).toBeTruthy();
  });

  it('broken JSON is a 400, not a crash', async () => {
    const r = await t.http.post('/v1/auth/phone/start').set('content-type', 'application/json').send('{"phone":');
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('validation_failed');
  });

  it('bodies over 256 KB are refused', async () => {
    const r = await t.http.post('/v1/auth/phone/start').send({ phone: 'x'.repeat(300_000) });
    expect(r.status).toBe(413);
    expect(r.body.error.code).toBe('validation_failed');
  });

  it('creates the v2 indexes on the shared users collection as partial indexes only', async () => {
    const idx = await t.db.collection('users').indexes();
    const phone = idx.find((i) => i.name === 'yc_phone_unique');
    expect(phone?.unique).toBe(true);
    expect(phone?.partialFilterExpression).toEqual({ 'yc.phoneE164': { $type: 'string' } });
  });

  it('starts cleanly when the shared database already has an email index with other options', async () => {
    const name = `e2e_legacy_idx_${Date.now()}`;
    await withRawDb(name, (db) => db.collection('users').createIndex({ email: 1 }, { name: 'email_1', sparse: true }));
    const other = await startApp({ MONGO_DB: name });
    const idx = await other.db.collection('users').indexes();
    expect(idx.find((i) => i.name === 'email_1')?.sparse).toBe(true); // left as the old backend made it
    expect(idx.some((i) => i.name === 'yc_phone_unique')).toBe(true);
    await other.close();
  });
});

describe('Week 1 · health when a dependency is down', () => {
  it('returns 503 and names the failing check', async () => {
    const t = await startApp();
    t.redis.disconnect();
    const r = await t.http.get('/v1/health');
    expect(r.status).toBe(503);
    expect(r.body.status).toBe('degraded');
    expect(r.body.checks.redis.ok).toBe(false);
    expect(r.body.checks.mongo.ok).toBe(true);
    await t.close();
  });
});

describe('Week 1 · configuration', () => {
  const base = { MONGO_URI: 'mongodb://x', REDIS_URL: 'redis://x', JWT_SECRET: 'a'.repeat(40) };
  it('names every missing setting', () => {
    expect(() => loadConfig({})).toThrow(/MONGO_URI[\s\S]*REDIS_URL[\s\S]*JWT_SECRET/);
  });
  it('refuses a short JWT secret', () => {
    expect(() => loadConfig({ ...base, JWT_SECRET: 'short' })).toThrow(/at least 32/);
  });
  it('refuses dev drivers in production', () => {
    expect(() => loadConfig({ ...base, NODE_ENV: 'production' })).toThrow(/SMS_DRIVER=dev[\s\S]*EMAIL_DRIVER=dev[\s\S]*GOOGLE_DRIVER=dev[\s\S]*STORAGE_DRIVER=local/);
  });
  it('needs Twilio credentials when Twilio is chosen', () => {
    expect(() => loadConfig({ ...base, SMS_DRIVER: 'twilio' })).toThrow(/TWILIO_ACCOUNT_SID/);
  });
  it('production needs real Web Push with its own keys', () => {
    const prod = { ...base, NODE_ENV: 'production' };
    expect(() => loadConfig(prod)).toThrow(/PUSH_DRIVER=dev is not allowed in production/);
    expect(() => loadConfig({ ...prod, PUSH_DRIVER: 'webpush' })).toThrow(/needs VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY/);
    expect(() => loadConfig({ ...prod, PUSH_INSECURE_TLS: '1' })).toThrow(/PUSH_INSECURE_TLS must be off in production/);
  });
  it('accepts a full production setup', () => {
    const c = loadConfig({ ...base, NODE_ENV: 'production', SMS_DRIVER: 'twilio', TWILIO_ACCOUNT_SID: 'AC1', TWILIO_AUTH_TOKEN: 't', TWILIO_VERIFY_SID: 'VA1', EMAIL_DRIVER: 'ses', SES_REGION: 'us-east-1', SES_FROM: 'no-reply@yays.app', GOOGLE_DRIVER: 'google', GOOGLE_CLIENT_IDS: 'a,b', STORAGE_DRIVER: 's3', S3_BUCKET: 'b', S3_REGION: 'us-east-1', CORS_ORIGINS: 'https://web.yays.app, https://yays.app', PUSH_DRIVER: 'webpush', VAPID_PUBLIC_KEY: 'pub', VAPID_PRIVATE_KEY: 'priv' });
    expect(c.corsOrigins).toEqual(['https://web.yays.app', 'https://yays.app']);
    expect(c.googleClientIds).toEqual(['a', 'b']);
  });
});

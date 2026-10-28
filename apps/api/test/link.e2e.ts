import type { LinkPoll, LinkStart } from '@yays/shared';
import { startApp, type TestApp } from './helpers';
import { makeUser, type TUser } from './chat-helpers';

describe('Linking a browser with a QR code', () => {
  let t: TestApp; let ali: TUser;
  const device = { deviceId: 'web-linked-browser-1', platform: 'web', name: 'Firefox on Linux' };
  beforeAll(async () => { t = await startApp(); ali = await makeUser(t, 'Ali'); });
  afterAll(async () => { await t.close(); });

  it('the code shown on the new browser, typed on a signed-in device, signs that browser in once', async () => {
    const s = (await t.http.post('/v1/auth/link/start').send({ device }).expect(200)).body as LinkStart;
    expect(s.qr).toMatch(/^yays:\/\/link\/[A-Za-z0-9_-]{20,}$/);
    expect(s.code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(((await t.http.get(`/v1/auth/link/${s.pollId}`).expect(200)).body as LinkPoll).status).toBe('waiting');
    await t.http.post('/v1/auth/link/approve').send({ code: s.code }).expect(401); // only from a signed-in device
    await t.http.post('/v1/auth/link/approve').set(ali.auth).send({ code: 'nope' }).expect(400);
    const ok = (await t.http.post('/v1/auth/link/approve').set(ali.auth).send({ code: s.code.toLowerCase().replace('-', ' ') }).expect(200)).body;
    expect(ok).toEqual({ deviceName: 'Firefox on Linux' });
    const p = (await t.http.get(`/v1/auth/link/${s.pollId}`).expect(200)).body as LinkPoll;
    expect(p.status).toBe('linked');
    if (p.status !== 'linked') return;
    expect(p.me.id).toBe(ali.id);
    expect((await t.http.get('/v1/me').set({ authorization: `Bearer ${p.tokens.accessToken}` }).expect(200)).body.id).toBe(ali.id);
    // Handed over once only; the code can't be used twice.
    expect(((await t.http.get(`/v1/auth/link/${s.pollId}`).expect(200)).body as LinkPoll).status).toBe('expired');
    await t.http.post('/v1/auth/link/approve').set(ali.auth).send({ code: s.code }).expect(404);
    const devices = (await t.http.get('/v1/me/devices').set(ali.auth).expect(200)).body as Array<{ name: string }>;
    expect(devices.map((d) => d.name)).toContain('Firefox on Linux');
  });

  it('scanning the QR code works the same way', async () => {
    const s = (await t.http.post('/v1/auth/link/start').send({ device: { ...device, deviceId: 'web-linked-browser-2' } }).expect(200)).body as LinkStart;
    await t.http.post('/v1/auth/link/approve').set(ali.auth).send({ qr: s.qr }).expect(200);
    expect(((await t.http.get(`/v1/auth/link/${s.pollId}`).expect(200)).body as LinkPoll).status).toBe('linked');
    await t.http.post('/v1/auth/link/approve').set(ali.auth).send({ qr: s.qr }).expect(404);
    expect(((await t.http.get('/v1/auth/link/not-a-real-poll-id').expect(200)).body as LinkPoll).status).toBe('expired');
  });
});

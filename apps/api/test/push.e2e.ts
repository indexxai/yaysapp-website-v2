import { createECDH, randomBytes } from 'crypto';
import * as http from 'http';
import * as https from 'https';
import { execSync } from 'child_process';
import { mkdtempSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import * as nodePath from 'path';
import type { AddressInfo } from 'net';
import { ObjectId } from 'mongodb';
import { device, signInEmail, startApp, type TestApp } from './helpers';
import { cid, connect, emit, makeUser, sleep, type TUser } from './chat-helpers';

/** A browser-like push subscription: a real P-256 key pair and auth secret. */
const fakeSub = (endpoint: string) => {
  const ecdh = createECDH('prime256v1'); ecdh.generateKeys();
  return { endpoint, keys: { p256dh: ecdh.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url') } };
};
type Push = { endpoint: string; payload: { type: string; title?: string; body?: string; tag: string; conversationId: string; url?: string } };

describe('Notifications', () => {
  let t: TestApp; let ali: TUser; let sara: TUser; let omar: TUser;
  const sockets: Array<{ close(): void }> = [];
  const pushes = async (u: TUser) => (await t.http.get('/v1/_test/pushes').query({ userId: u.id }).expect(200)).body as Push[];
  const say = (u: TUser, c: string, text: string) => t.http.post(`/v1/conversations/${c}/messages`).set(u.auth).send({ clientId: cid(), text }).expect(200);
  /** Pushes are sent in the background: wait until the count settles. */
  const settle = async (u: TUser, n: number) => { for (let i = 0; i < 40; i++) { if ((await pushes(u)).length >= n) break; await sleep(50); } await sleep(150); return pushes(u); };
  beforeAll(async () => { t = await startApp(); [ali, sara, omar] = [await makeUser(t, 'Ali'), await makeUser(t, 'Sara'), await makeUser(t, 'Omar')]; });
  beforeEach(async () => { for (const u of [ali, sara, omar]) await t.redis.del(`push:dev:${u.id}`); });
  afterEach(() => { while (sockets.length) sockets.pop()!.close(); });
  afterAll(async () => { await t.close(); });

  it('gives browsers the public key and checks subscriptions', async () => {
    expect((await t.http.get('/v1/push/config').expect(200)).body.vapidPublicKey).toMatch(/^[A-Za-z0-9_-]{80,}$/);
    for (const bad of [{}, { endpoint: 'not a url', keys: fakeSub('x').keys }, { endpoint: 'http://evil.example/x', keys: fakeSub('x').keys }, { endpoint: 'https://push.example/1', keys: { p256dh: 'x', auth: 'y' } }]) {
      expect((await t.http.post('/v1/push/subscriptions').set(ali.auth).send(bad)).status).toBe(400);
    }
    expect((await t.http.post('/v1/push/subscriptions').send(fakeSub('https://push.example/1'))).status).toBe(401);
  });

  it('notifies when the app is closed or in the background, and not while it is in front', async () => {
    const c = (await t.http.post('/v1/conversations/direct').set(sara.auth).send({ userId: ali.id }).expect(200)).body;
    await t.http.post('/v1/push/subscriptions').set(ali.auth).send(fakeSub('https://push.example/ali-laptop')).expect(204);
    await say(sara, c.id, 'Are you joining tonight?');
    const [p] = await settle(ali, 1);
    expect(p).toMatchObject({ endpoint: 'https://push.example/ali-laptop', payload: { type: 'message', title: 'Sara', body: 'Are you joining tonight?', tag: `c:${c.id}`, url: `/chats?c=${c.id}`, conversationId: c.id } });
    expect(await pushes(sara)).toEqual([]); // never for your own message

    // App in front (any chat): no push; the open app shows its own banner.
    const s = await connect(t.url, ali.token); sockets.push(s);
    await emit(s, 'focus', { conversationId: null, visible: true });
    await say(sara, c.id, 'hello?');
    expect(await settle(ali, 2)).toHaveLength(1);
    // Tab in the background: push again.
    await emit(s, 'focus', { conversationId: c.id, visible: false });
    await say(sara, c.id, 'still there?');
    expect((await settle(ali, 2))[0].payload.body).toBe('still there?');
    // Closing the last connection counts as not looking.
    await emit(s, 'focus', { conversationId: c.id, visible: true });
    s.close();
    await sleep(200);
    await say(sara, c.id, 'bye');
    expect((await settle(ali, 3))[0].payload.body).toBe('bye');
  });

  it('groups say who wrote; being added is a notification; muted chats stay quiet', async () => {
    await t.http.post('/v1/push/subscriptions').set(omar.auth).send(fakeSub('https://push.example/omar')).expect(204);
    const g = (await t.http.post('/v1/groups').set(ali.auth).send({ name: 'Family', memberIds: [omar.id, sara.id] }).expect(200)).body;
    await say(sara, g.id, 'Lunch at 1?');
    const got = await settle(omar, 1);
    expect(got[0].payload).toMatchObject({ title: 'Family', body: 'Sara: Lunch at 1?' });
    // The "created" line isn't a notification; "added you" is.
    const g2 = (await t.http.post('/v1/groups').set(ali.auth).send({ name: 'Trip', memberIds: [sara.id] }).expect(200)).body;
    await t.http.post(`/v1/groups/${g2.id}/members`).set(ali.auth).send({ userIds: [omar.id] }).expect(200);
    expect((await settle(omar, 2))[0].payload).toMatchObject({ title: 'Trip', body: 'Ali added you' });
    await t.db.collection('yc_chat_prefs').insertOne({ _id: `${g.id}:${omar.id}`, convId: new ObjectId(g.id), userId: new ObjectId(omar.id), mutedUntil: new Date(Date.now() + 3600_000), updatedAt: new Date() } as never);
    await say(sara, g.id, 'muted?');
    expect(await settle(omar, 3)).toHaveLength(2);
    // An expired mute lets notifications through again.
    await t.db.collection('yc_chat_prefs').updateOne({ _id: `${g.id}:${omar.id}` } as never, { $set: { mutedUntil: new Date(Date.now() - 1000) } });
    await say(sara, g.id, 'unmuted');
    expect((await settle(omar, 3))[0].payload.body).toBe('Sara: unmuted');
  });

  it('reading on one device clears the notification on the others', async () => {
    const c = (await t.http.post('/v1/conversations/direct').set(sara.auth).send({ userId: omar.id }).expect(200)).body;
    await t.http.post('/v1/push/subscriptions').set(omar.auth).send(fakeSub('https://push.example/omar')).expect(204);
    const m = (await say(sara, c.id, 'read me')).body.message;
    await settle(omar, 1);
    await t.http.post(`/v1/conversations/${c.id}/read`).set(omar.auth).send({ seq: m.seq }).expect(200);
    const got = await settle(omar, 2);
    expect(got[0].payload).toEqual({ type: 'read', conversationId: c.id, tag: `c:${c.id}` });
    // Reading again changes nothing, so no second "read".
    await t.http.post(`/v1/conversations/${c.id}/read`).set(omar.auth).send({ seq: m.seq }).expect(200);
    expect(await settle(omar, 3)).toHaveLength(2);
  });

  it('a signed-out device or an unsubscribed browser gets nothing; a browser moves to its new account', async () => {
    const c = (await t.http.post('/v1/conversations/direct').set(sara.auth).send({ userId: ali.id }).expect(200)).body;
    const second = await signInEmail(t, (await t.http.get('/v1/me').set(ali.auth)).body.email, device(4));
    await t.http.post('/v1/push/subscriptions').set({ authorization: `Bearer ${second.tokens.accessToken}` }).send(fakeSub('https://push.example/ali-2')).expect(204);
    await t.http.delete(`/v1/me/devices/${second.tokens.sessionId}`).set(ali.auth).expect(204);
    await sleep(100);
    expect(await t.db.collection('yc_push_subscriptions').countDocuments({ endpoint: 'https://push.example/ali-2' })).toBe(0);
    const sub = fakeSub('https://push.example/shared-browser');
    await t.http.post('/v1/push/subscriptions').set(ali.auth).send(sub).expect(204);
    await t.http.delete('/v1/push/subscriptions').set(ali.auth).send({ endpoint: sub.endpoint }).expect(204);
    await say(sara, c.id, 'nobody hears this');
    await sleep(300);
    expect((await pushes(ali)).filter((p) => p.endpoint === 'https://push.example/shared-browser' || p.endpoint === 'https://push.example/ali-2')).toEqual([]);
    // Same browser, now signed in as Omar: the subscription is his.
    await t.http.post('/v1/push/subscriptions').set(ali.auth).send(sub).expect(204);
    await t.http.post('/v1/push/subscriptions').set(omar.auth).send(sub).expect(204);
    expect((await t.db.collection('yc_push_subscriptions').findOne({ endpoint: sub.endpoint }))!.userId.toHexString()).toBe(omar.id);
  });
});

describe('Notifications through real Web Push', () => {
  let t: TestApp; let ali: TUser; let sara: TUser; let server: https.Server; let url = '';
  const received: Array<{ path: string; headers: http.IncomingHttpHeaders; body: Buffer }> = [];
  let answer = 201;
  beforeAll(async () => {
    // A stand-in for the browser's push service (FCM, Mozilla, Apple).
    const dir = mkdtempSync(nodePath.join(tmpdir(), 'push-tls-'));
    execSync(`openssl req -x509 -newkey rsa:2048 -nodes -keyout ${dir}/k.pem -out ${dir}/c.pem -days 1 -subj /CN=127.0.0.1 2>/dev/null`);
    server = https.createServer({ key: readFileSync(`${dir}/k.pem`), cert: readFileSync(`${dir}/c.pem`) }, (req, res) => {
      const parts: Buffer[] = [];
      req.on('data', (c) => parts.push(c));
      req.on('end', () => { received.push({ path: req.url ?? '', headers: req.headers, body: Buffer.concat(parts) }); res.statusCode = answer; res.end(); });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    url = `https://127.0.0.1:${(server.address() as AddressInfo).port}`;
    t = await startApp({ PUSH_DRIVER: 'webpush', PUSH_INSECURE_TLS: '1' });
    [ali, sara] = [await makeUser(t, 'Ali'), await makeUser(t, 'Sara')];
  });
  afterAll(async () => { await t.close(); await new Promise((r) => server.close(r)); });

  it('sends encrypted, signed pushes, and forgets subscriptions the push service says are gone', async () => {
    const c = (await t.http.post('/v1/conversations/direct').set(sara.auth).send({ userId: ali.id }).expect(200)).body;
    await t.http.post('/v1/push/subscriptions').set(ali.auth).send(fakeSub(`${url}/send/abc`)).expect(204);
    await t.http.post(`/v1/conversations/${c.id}/messages`).set(sara.auth).send({ clientId: cid(), text: 'secret text' }).expect(200);
    for (let i = 0; i < 40 && !received.length; i++) await sleep(50);
    const r = received[0];
    expect(r.path).toBe('/send/abc');
    expect(r.headers['content-encoding']).toBe('aes128gcm');
    expect(r.headers.ttl).toBe('86400');
    expect(r.headers.urgency).toBe('high');
    expect(r.headers.authorization).toMatch(/^vapid t=.+, k=.+$/);
    expect(r.body.length).toBeGreaterThan(100);
    expect(r.body.includes(Buffer.from('secret text'))).toBe(false); // encrypted, not readable on the way
    answer = 410;
    await t.http.post(`/v1/conversations/${c.id}/messages`).set(sara.auth).send({ clientId: cid(), text: 'again' }).expect(200);
    for (let i = 0; i < 40 && received.length < 2; i++) await sleep(50);
    await sleep(200);
    expect(await t.db.collection('yc_push_subscriptions').countDocuments({ userId: new ObjectId(ali.id) })).toBe(0);
  });
});

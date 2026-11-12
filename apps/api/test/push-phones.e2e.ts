import { generateKeyPairSync } from 'crypto';
import * as http from 'http';
import * as http2 from 'http2';
import type { AddressInfo } from 'net';
import { decodeProtectedHeader, importSPKI, jwtVerify } from 'jose';
import { startApp, type TestApp } from './helpers';
import { cid, makeUser, sleep, type TUser } from './chat-helpers';

const FCM_TOKEN = 'fcm-android-token-' + 'a'.repeat(40);
const APNS_TOKEN = 'b'.repeat(64);
const CALL = '65f0c0ffee00000000abcdef', UUID = '65f0c0ff-ee00-0000-00ab-cdef00000000';
const say = (t: TestApp, u: TUser, c: string, text: string) => t.http.post(`/v1/conversations/${c}/messages`).set(u.auth).send({ clientId: cid(), text }).expect(200);

describe('Phone notifications: registering the app', () => {
  let t: TestApp; let ali: TUser; let sara: TUser;
  type Rec = { endpoint: string; payload: { type: string; title?: string; body?: string; conversationId?: string } };
  const pushes = async (u: TUser) => (await t.http.get('/v1/_test/pushes').query({ userId: u.id }).expect(200)).body as Rec[];
  beforeAll(async () => { t = await startApp(); ali = await makeUser(t, 'Ali'); sara = await makeUser(t, 'Sara'); });
  afterAll(async () => { await t.close(); });

  it('takes Android and iPhone tokens, checks them, and notifies both; a token can be dropped', async () => {
    expect((await t.http.get('/v1/push/config').expect(200)).body.phones).toEqual({ android: true, ios: true });
    for (const bad of [{}, { platform: 'android' }, { platform: 'windows', token: FCM_TOKEN }, { platform: 'ios', token: 'short' }, { platform: 'ios', token: 'has spaces in it and more' }]) {
      expect((await t.http.post('/v1/push/devices').set(ali.auth).send(bad)).status).toBe(400);
    }
    expect((await t.http.post('/v1/push/devices').send({ platform: 'android', token: FCM_TOKEN })).status).toBe(401);
    await t.http.post('/v1/push/devices').set(ali.auth).send({ platform: 'android', token: FCM_TOKEN }).expect(204);
    await t.http.post('/v1/push/devices').set(ali.auth).send({ platform: 'ios', token: APNS_TOKEN, sandbox: true }).expect(204);
    await t.http.post('/v1/push/devices').set(ali.auth).send({ platform: 'ios', token: APNS_TOKEN, sandbox: true }).expect(204); // again: still one
    const c = (await t.http.post('/v1/conversations/direct').set(sara.auth).send({ userId: ali.id }).expect(200)).body;
    await say(t, sara, c.id, 'Dinner at 8?');
    let got: Rec[] = [];
    for (let i = 0; i < 40 && got.length < 2; i++) { got = await pushes(ali); await sleep(50); }
    expect(got.map((p) => p.endpoint).sort()).toEqual([`apns:${APNS_TOKEN}`, `fcm:${FCM_TOKEN}`]);
    expect(got[0]!.payload).toMatchObject({ type: 'message', title: 'Sara', body: 'Dinner at 8?', conversationId: c.id });
    const doc = await t.db.collection('yc_push_subscriptions').findOne({ endpoint: `apns:${APNS_TOKEN}` });
    expect(doc).toMatchObject({ kind: 'apns', sandbox: true });
    // Signing out of the phone (or turning notifications off) drops the token.
    await t.http.delete('/v1/push/devices').set(ali.auth).send({ token: FCM_TOKEN }).expect(204);
    expect(await t.db.collection('yc_push_subscriptions').countDocuments({ userId: doc!.userId })).toBe(1);
  });
});

describe('Phone notifications: delivery to Firebase and Apple', () => {
  // Stand-ins for Google (sign-in + FCM) and Apple (APNs over HTTP/2), with real keys, checking what YaysApp sends.
  const rsa = generateKeyPairSync('rsa', { modulusLength: 2048, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
  const ec = generateKeyPairSync('ec', { namedCurve: 'P-256', publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
  const fcmSent: Array<{ auth?: string; message: Record<string, unknown> }> = [];
  const apnsSent: Array<{ path: string; headers: http2.IncomingHttpHeaders; body: Record<string, unknown> }> = [];
  let tokenAsks = 0;
  let google: http.Server; let apple: http2.Http2Server; let t: TestApp; let ali: TUser; let sara: TUser;

  beforeAll(async () => {
    google = http.createServer((req, res) => {
      let text = ''; req.on('data', (c) => { text += c; });
      req.on('end', async () => {
        if (req.url === '/token') {
          // The service account's signed request for a token.
          const assertion = new URLSearchParams(text).get('assertion')!;
          const { payload } = await jwtVerify(assertion, await importSPKI(rsa.publicKey, 'RS256'), { issuer: 'push@yays-test.iam.gserviceaccount.com', audience: `http://127.0.0.1:${(google.address() as AddressInfo).port}/token` });
          expect(payload.scope).toBe('https://www.googleapis.com/auth/firebase.messaging');
          tokenAsks++;
          res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ access_token: 'google-access-token', expires_in: 3600 }));
          return;
        }
        expect(req.url).toBe('/v1/projects/yays-test/messages:send');
        const { message } = JSON.parse(text) as { message: { token: string } };
        fcmSent.push({ auth: req.headers.authorization, message });
        if (message.token.startsWith('gone')) { res.writeHead(404, { 'content-type': 'application/json' }).end(JSON.stringify({ error: { status: 'NOT_FOUND', details: [{ errorCode: 'UNREGISTERED' }] } })); return; }
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ name: 'projects/yays-test/messages/1' }));
      });
    });
    await new Promise<void>((r) => google.listen(0, '127.0.0.1', r));
    apple = http2.createServer();
    apple.on('stream', (stream, headers) => {
      let text = ''; stream.on('data', (c: Buffer) => { text += c.toString(); });
      stream.on('end', () => {
        const path = String(headers[':path']);
        apnsSent.push({ path, headers, body: JSON.parse(text) });
        if (path.endsWith('/' + 'c'.repeat(64))) { stream.respond({ ':status': 410 }); stream.end(JSON.stringify({ reason: 'Unregistered' })); return; }
        stream.respond({ ':status': 200 }); stream.end();
      });
    });
    await new Promise<void>((r) => apple.listen(0, '127.0.0.1', r));
    const gp = (google.address() as AddressInfo).port;
    t = await startApp({
      PUSH_DRIVER: 'webpush', FCM_API_URL: `http://127.0.0.1:${gp}`,
      FCM_SERVICE_ACCOUNT_JSON: JSON.stringify({ type: 'service_account', project_id: 'yays-test', client_email: 'push@yays-test.iam.gserviceaccount.com', private_key: rsa.privateKey, token_uri: `http://127.0.0.1:${gp}/token` }),
      APNS_KEY: ec.privateKey, APNS_KEY_ID: 'KEY1234567', APNS_TEAM_ID: 'TEAM123456', APNS_HOST: `http://127.0.0.1:${(apple.address() as AddressInfo).port}`,
    });
    ali = await makeUser(t, 'Ali'); sara = await makeUser(t, 'Sara');
  });
  afterAll(async () => { await t.close(); google.close(); apple.close(); });
  const wait = async (fn: () => boolean) => { for (let i = 0; i < 100 && !fn(); i++) await sleep(30); expect(fn()).toBe(true); };

  it('a message: Firebase gets a notification on the messages channel, Apple an alert; signed with the right keys', async () => {
    expect((await t.http.get('/v1/push/config').expect(200)).body).toMatchObject({ delivery: 'webpush', phones: { android: true, ios: true } });
    await t.http.post('/v1/push/devices').set(ali.auth).send({ platform: 'android', token: FCM_TOKEN }).expect(204);
    await t.http.post('/v1/push/devices').set(ali.auth).send({ platform: 'ios', token: APNS_TOKEN }).expect(204);
    const c = (await t.http.post('/v1/conversations/direct').set(sara.auth).send({ userId: ali.id }).expect(200)).body;
    await say(t, sara, c.id, 'Running 10 minutes late');
    await wait(() => fcmSent.length === 1 && apnsSent.length === 1);

    expect(fcmSent[0]!.auth).toBe('Bearer google-access-token');
    expect(fcmSent[0]!.message).toMatchObject({
      token: FCM_TOKEN, notification: { title: 'Sara', body: 'Running 10 minutes late' },
      data: { type: 'message', conversationId: c.id, tag: `c:${c.id}` },
      android: { priority: 'high', ttl: '86400s', collapse_key: c.id, notification: { channel_id: 'messages', tag: `c:${c.id}` } },
    });
    const a = apnsSent[0]!;
    expect(a.path).toBe(`/3/device/${APNS_TOKEN}`);
    expect(a.headers).toMatchObject({ 'apns-topic': 'com.indexx.yaysapp', 'apns-push-type': 'alert', 'apns-priority': '10', 'apns-collapse-id': `c:${c.id}` });
    expect(a.body).toMatchObject({ aps: { alert: { title: 'Sara', body: 'Running 10 minutes late' }, sound: 'default', 'thread-id': c.id }, type: 'message', conversationId: c.id });
    // Apple's token: ES256 from the team, with the key's id.
    const jwt = String(a.headers.authorization).replace(/^bearer /, '');
    expect(decodeProtectedHeader(jwt)).toMatchObject({ alg: 'ES256', kid: 'KEY1234567' });
    expect((await jwtVerify(jwt, await importSPKI(ec.publicKey, 'ES256'))).payload.iss).toBe('TEAM123456');

    // Reading it on another device: silent pushes, so the phones can clear the notification.
    fcmSent.length = 0; apnsSent.length = 0;
    await t.http.post(`/v1/conversations/${c.id}/read`).set(ali.auth).send({ seq: 1 }).expect(200);
    await wait(() => fcmSent.length === 1 && apnsSent.length === 1);
    expect(fcmSent[0]!.message).toMatchObject({ data: { type: 'read', conversationId: c.id }, android: { priority: 'normal' } });
    expect(fcmSent[0]!.message.notification).toBeUndefined();
    expect(apnsSent[0]!.headers).toMatchObject({ 'apns-push-type': 'background', 'apns-priority': '5' });
    expect(apnsSent[0]!.body).toMatchObject({ aps: { 'content-available': 1 } });
    // One Google token for all of it.
    expect(tokenAsks).toBe(1);
  });

  it('a call rings: data only at high priority on Android (the app shows the full-screen call), time-sensitive on an iPhone without a VoIP token', async () => {
    fcmSent.length = 0; apnsSent.length = 0;
    // No LiveKit server in these tests: ring through the push service, as the calls service does.
    const { PUSH } = await import('../src/push/push.service');
    const svc = t.app.get(PUSH) as import('../src/push/push.service').PushService;
    const { ObjectId } = await import('mongodb');
    await svc.callRing(new ObjectId(ali.id), { type: 'call', callId: CALL, title: 'Sara', body: 'Incoming video call', tag: `call:${CALL}`, url: '/calls', media: 'video', caller: 'Sara' });
    await wait(() => fcmSent.length === 1 && apnsSent.length === 1);
    expect(fcmSent[0]!.message).toMatchObject({ data: { type: 'call', callId: CALL, uuid: UUID, media: 'video', caller: 'Sara', title: 'Sara', body: 'Incoming video call' }, android: { priority: 'high', ttl: '45s' } });
    expect(fcmSent[0]!.message.notification).toBeUndefined();
    expect((fcmSent[0]!.message.android as Record<string, unknown>).notification).toBeUndefined();
    expect(apnsSent[0]!.body).toMatchObject({ aps: { alert: { title: 'Sara', body: 'Incoming video call' }, 'interruption-level': 'time-sensitive' }, type: 'call', callId: CALL });
  });

  it('a phone that dropped its token (uninstalled) is forgotten', async () => {
    fcmSent.length = 0; apnsSent.length = 0;
    await t.http.post('/v1/push/devices').set(ali.auth).send({ platform: 'android', token: 'gone-' + 'x'.repeat(30) }).expect(204);
    await t.http.post('/v1/push/devices').set(ali.auth).send({ platform: 'ios', token: 'c'.repeat(64) }).expect(204);
    const subs = () => t.db.collection('yc_push_subscriptions').countDocuments({});
    expect(await subs()).toBe(4);
    const c = (await t.http.post('/v1/conversations/direct').set(sara.auth).send({ userId: ali.id }).expect(200)).body;
    await say(t, sara, c.id, 'Still there?');
    await wait(() => fcmSent.length === 2 && apnsSent.length === 2);
    for (let i = 0; i < 50 && (await subs()) !== 2; i++) await sleep(30);
    expect(await subs()).toBe(2);
  });

  it('an iPhone with a VoIP token: the ring and its end go by VoIP (CallKit), not as an alert; messages never use VoIP', async () => {
    fcmSent.length = 0; apnsSent.length = 0;
    const VOIP = 'd'.repeat(64), ALERT = 'e'.repeat(64);
    await t.http.post('/v1/push/devices').set(sara.auth).send({ platform: 'ios', token: ALERT, sandbox: true }).expect(204);
    await t.http.post('/v1/push/devices').set(sara.auth).send({ platform: 'ios', token: VOIP, sandbox: true, voip: true }).expect(204);
    expect(await t.db.collection('yc_push_subscriptions').findOne({ endpoint: `voip:${VOIP}` })).toMatchObject({ kind: 'voip', sandbox: true });
    const { PUSH } = await import('../src/push/push.service');
    const svc = t.app.get(PUSH) as import('../src/push/push.service').PushService;
    const { ObjectId } = await import('mongodb');
    await svc.callRing(new ObjectId(sara.id), { type: 'call', callId: CALL, title: 'Ali', body: 'Incoming voice call', tag: `call:${CALL}`, url: '/calls', media: 'voice', caller: 'Ali' });
    await wait(() => apnsSent.length === 1);
    await sleep(200);
    expect(apnsSent).toHaveLength(1); // not also the ordinary alert
    expect(apnsSent[0]!.path).toBe(`/3/device/${VOIP}`);
    expect(apnsSent[0]!.headers).toMatchObject({ 'apns-topic': 'com.indexx.yaysapp.voip', 'apns-push-type': 'voip', 'apns-priority': '10' });
    expect(apnsSent[0]!.body).toMatchObject({ aps: {}, type: 'call', callId: CALL, uuid: UUID, media: 'voice', caller: 'Ali' });
    // The call is over: CallKit takes it away.
    apnsSent.length = 0;
    svc.callEnded([new ObjectId(sara.id)], CALL);
    await wait(() => apnsSent.length === 2);
    const voip = apnsSent.find((x) => x.path.endsWith(VOIP))!;
    expect(voip.headers['apns-push-type']).toBe('voip');
    expect(voip.body).toMatchObject({ type: 'call_end', callId: CALL, uuid: UUID });
    // A message goes to the ordinary token only.
    apnsSent.length = 0;
    const c = (await t.http.post('/v1/conversations/direct').set(ali.auth).send({ userId: sara.id }).expect(200)).body;
    await say(t, ali, c.id, 'Call me back');
    await wait(() => apnsSent.length >= 1);
    await sleep(200);
    expect(apnsSent.map((x) => x.path)).toEqual([`/3/device/${ALERT}`]);
    // Dropping the VoIP token works like any other.
    await t.http.delete('/v1/push/devices').set(sara.auth).send({ token: VOIP }).expect(204);
    expect(await t.db.collection('yc_push_subscriptions').countDocuments({ endpoint: `voip:${VOIP}` })).toBe(0);
  });
});

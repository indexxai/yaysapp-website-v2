import type { ConversationSummary, MeProfile, StorageReport } from '@yays/shared';
import { bearer, device, lastCode, startApp, type TestApp } from './helpers';
import { cid, connect, emit, makeUser, sleep, type TUser } from './chat-helpers';

const resetLimits = async (t: TestApp) => { const k = await t.redis.keys('rl:*'); if (k.length) await t.redis.del(...k); };
const meOf = async (t: TestApp, u: TUser) => (await t.http.get('/v1/me').set(u.auth).expect(200)).body as MeProfile;

describe('Two-step verification', () => {
  let t: TestApp; let ali: TUser; let email: string; let phone: string;
  const emailSignIn = async (dev = device(7)) => {
    await resetLimits(t);
    await t.http.post('/v1/auth/email/start').send({ email }).expect(200);
    return (await t.http.post('/v1/auth/email/verify').send({ email, code: await lastCode(t, email), device: dev }).expect(200)).body;
  };
  beforeAll(async () => { t = await startApp(); ali = await makeUser(t, 'Ali'); const me = await meOf(t, ali); email = me.email!; phone = me.phone!; });
  afterAll(async () => { await t.close(); });

  it('turns on with a 6-digit PIN that isn’t easy to guess; changing it needs the current one', async () => {
    for (const pin of ['111111', '123456', '12345', 'abcdef']) expect((await t.http.put('/v1/me/two-step').set(ali.auth).send({ pin })).status).toBe(400);
    expect((await t.http.put('/v1/me/two-step').set(ali.auth).send({ pin: '482916' }).expect(200)).body.twoStep).toBe(true);
    expect((await t.http.put('/v1/me/two-step').set(ali.auth).send({ pin: '555123' })).status).toBe(400);
    expect((await t.http.put('/v1/me/two-step').set(ali.auth).send({ pin: '555123', currentPin: '000999' })).status).toBe(400);
    await t.http.put('/v1/me/two-step').set(ali.auth).send({ pin: '730184', currentPin: '482916' }).expect(200);
    const doc = await t.db.collection('users').findOne({ 'yc.emailLower': email });
    expect(JSON.stringify(doc!.yc.twoStep)).not.toContain('730184'); // stored hashed
  });

  it('asks for the PIN after the code, by email or phone; wrong PINs count down and lock', async () => {
    const r = await emailSignIn();
    expect(r).toMatchObject({ status: 'pin_required', via: 'email' });
    expect(r.tokens).toBeUndefined();
    const wrong = await t.http.post('/v1/auth/pin').send({ pinToken: r.pinToken, pin: '111222' });
    expect(wrong.status).toBe(400);
    expect(wrong.body.error.message).toBe('Wrong PIN. 4 tries left.');
    const ok = (await t.http.post('/v1/auth/pin').send({ pinToken: r.pinToken, pin: '730184' }).expect(200)).body;
    expect(ok.tokens.accessToken).toBeTruthy();
    expect((await t.http.post('/v1/auth/pin').send({ pinToken: r.pinToken, pin: '730184' })).status).toBe(401); // used up
    // By phone too.
    await resetLimits(t);
    await t.http.post('/v1/auth/phone/start').send({ phone }).expect(200);
    const p = (await t.http.post('/v1/auth/phone/verify').send({ phone, code: await lastCode(t, phone), device: device(8) }).expect(200)).body;
    expect(p).toMatchObject({ status: 'pin_required', via: 'phone' });
    for (let i = 0; i < 5; i++) await t.http.post('/v1/auth/pin').send({ pinToken: p.pinToken, pin: '000111' });
    const locked = await t.http.post('/v1/auth/pin').send({ pinToken: p.pinToken, pin: '730184' });
    expect(locked.status).toBe(423);
    await t.redis.del(`pin:a:${ali.id}`);
  });

  it('forgot PIN: a code goes to the other address, and resetting turns two-step off', async () => {
    const r = await emailSignIn(device(9));
    await resetLimits(t);
    const sent = (await t.http.post('/v1/auth/pin/forgot').send({ pinToken: r.pinToken }).expect(200)).body;
    expect(sent.channel).toBe('sms'); // signed in by email, so the code goes to the phone
    expect((await t.http.post('/v1/auth/pin/reset').send({ pinToken: r.pinToken, code: '000000' })).status).toBe(400);
    const done = (await t.http.post('/v1/auth/pin/reset').send({ pinToken: r.pinToken, code: await lastCode(t, phone) }).expect(200)).body;
    expect(done.me.twoStep).toBe(false);
    // Turn on and off again while signed in.
    const auth = bearer(done);
    await t.http.put('/v1/me/two-step').set(auth).send({ pin: '264801' }).expect(200);
    expect((await t.http.delete('/v1/me/two-step').set(auth).send({ pin: '999000' })).status).toBe(400);
    expect((await t.http.delete('/v1/me/two-step').set(auth).send({ pin: '264801' }).expect(200)).body.twoStep).toBe(false);
    expect((await emailSignIn(device(10))).tokens).toBeTruthy();
  });
});

describe('Privacy', () => {
  let t: TestApp; let ali: TUser; let sara: TUser; let omar: TUser; let c: string;
  const sockets: Array<{ close(): void }> = [];
  beforeAll(async () => {
    t = await startApp();
    [ali, sara, omar] = [await makeUser(t, 'Ali'), await makeUser(t, 'Sara'), await makeUser(t, 'Omar')];
    c = (await t.http.post('/v1/conversations/direct').set(ali.auth).send({ userId: sara.id }).expect(200)).body.id;
    await t.http.post(`/v1/conversations/${c}/messages`).set(ali.auth).send({ clientId: cid(), text: 'hi' }).expect(200);
    // Omar shares only a group with Ali: not a contact.
    await t.http.post('/v1/groups').set(omar.auth).send({ name: 'G', memberIds: [ali.id] }).expect(200);
  });
  afterEach(() => { while (sockets.length) sockets.pop()!.close(); });
  afterAll(async () => { await t.close(); });

  it('photo and about for contacts only, or nobody', async () => {
    const photo = (await t.http.post('/v1/media/upload-url').set(ali.auth).send({ purpose: 'avatar', contentType: 'image/png', size: 8 }).expect(200)).body;
    await t.http.put(new URL(photo.uploadUrl).pathname).set('content-type', 'image/png').send(Buffer.from('89504e470d0a1a0a', 'hex')).expect(204);
    await t.http.patch('/v1/me').set(ali.auth).send({ photoKey: photo.key, about: 'Busy' }).expect(200);
    const me = (await t.http.put('/v1/me/privacy').set(ali.auth).send({ photo: 'contacts', about: 'nobody' }).expect(200)).body as MeProfile;
    expect(me.privacy).toMatchObject({ photo: 'contacts', about: 'nobody', lastSeen: 'everyone' });
    const asSara = (await t.http.get('/v1/users/profiles').query({ ids: ali.id }).set(sara.auth).expect(200)).body[0];
    expect(asSara.photoUrl).toBeTruthy();
    expect(asSara.about).toBe('');
    const asOmar = (await t.http.get('/v1/users/profiles').query({ ids: ali.id }).set(omar.auth).expect(200)).body[0];
    expect(asOmar.photoUrl).toBeNull();
    expect((await t.http.get(`/v1/conversations/${c}`).set(sara.auth).expect(200)).body.peer.photoUrl).toBeTruthy();
    expect((await meOf(t, ali)).about).toBe('Busy'); // I still see my own
    expect((await t.http.put('/v1/me/privacy').set(ali.auth).send({ photo: 'friends' })).status).toBe(400);
  });

  it('last seen and online: hidden from people outside the setting, and hiding mine hides theirs', async () => {
    await t.http.put('/v1/me/privacy').set(ali.auth).send({ lastSeen: 'contacts' }).expect(200);
    const a = await connect(t.url, ali.token); sockets.push(a);
    const s = await connect(t.url, sara.token); sockets.push(s);
    const o = await connect(t.url, omar.token); sockets.push(o);
    expect((await emit<Array<{ online: boolean }>>(s, 'presence:watch', { userIds: [ali.id] })).data).toEqual([{ userId: ali.id, online: true, lastSeenAt: null }]);
    expect((await emit<Array<{ online: boolean }>>(o, 'presence:watch', { userIds: [ali.id] })).data).toEqual([{ userId: ali.id, online: false, lastSeenAt: null }]);
    // Changing it to nobody: Sara's screen stops showing Ali online, and is asked to check again.
    const rechecked = new Promise((r) => s.once('presence:recheck', r));
    await t.http.put('/v1/me/privacy').set(ali.auth).send({ lastSeen: 'nobody' }).expect(200);
    await rechecked;
    expect((await emit<Array<{ online: boolean }>>(s, 'presence:watch', { userIds: [ali.id] })).data![0].online).toBe(false);
    // Ali hides his: he sees Sara online but not her last seen.
    s.close(); await sleep(300);
    const back = (await emit<Array<{ online: boolean; lastSeenAt: string | null }>>(a, 'presence:watch', { userIds: [sara.id] })).data![0];
    expect(back).toEqual({ userId: sara.id, online: false, lastSeenAt: null });
    await t.http.put('/v1/me/privacy').set(ali.auth).send({ lastSeen: 'everyone' }).expect(200);
    expect((await emit<Array<{ lastSeenAt: string | null }>>(a, 'presence:watch', { userIds: [sara.id] })).data![0].lastSeenAt).toBeTruthy();
  });

  it('read receipts off: the other side sees delivered, and I don’t see theirs either', async () => {
    const m = (await t.http.post(`/v1/conversations/${c}/messages`).set(ali.auth).send({ clientId: cid(), text: 'did you read?' }).expect(200)).body.message;
    await t.http.put('/v1/me/privacy').set(sara.auth).send({ readReceipts: false }).expect(200);
    const a = await connect(t.url, ali.token); sockets.push(a);
    const got = new Promise<{ readSeq: number; deliveredSeq: number }>((r) => a.on('receipt', (p) => { if (p.userId === sara.id) r(p); }));
    await t.http.post(`/v1/conversations/${c}/read`).set(sara.auth).send({ seq: m.seq }).expect(200);
    expect(await got).toMatchObject({ readSeq: 0, deliveredSeq: m.seq });
    expect(((await t.http.get(`/v1/conversations/${c}`).set(ali.auth).expect(200)).body as ConversationSummary).receipts[sara.id]).toEqual({ readSeq: 0, deliveredSeq: m.seq });
    const info = (await t.http.get(`/v1/conversations/${c}/messages/${m.id}/info`).set(ali.auth).expect(200)).body;
    expect(info.readBy).toEqual([]);
    expect(info.deliveredTo.map((x: { user: { id: string } }) => x.user.id)).toEqual([sara.id]);
    // Sara doesn't see Ali's reading either.
    const m2 = (await t.http.post(`/v1/conversations/${c}/messages`).set(sara.auth).send({ clientId: cid(), text: 'maybe' }).expect(200)).body.message;
    await t.http.post(`/v1/conversations/${c}/read`).set(ali.auth).send({ seq: m2.seq }).expect(200);
    expect(((await t.http.get(`/v1/conversations/${c}`).set(sara.auth).expect(200)).body as ConversationSummary).receipts[ali.id].readSeq).toBe(0);
    await t.http.put('/v1/me/privacy').set(sara.auth).send({ readReceipts: true }).expect(200);
    expect(((await t.http.get(`/v1/conversations/${c}`).set(ali.auth).expect(200)).body as ConversationSummary).receipts[sara.id].readSeq).toBe(m2.seq);
  });

  it('only people I chat with can add me to groups', async () => {
    await t.http.put('/v1/me/privacy').set(sara.auth).send({ groups: 'contacts' }).expect(200);
    const r = await t.http.post('/v1/groups').set(omar.auth).send({ name: 'Nope', memberIds: [sara.id] });
    expect(r.status).toBe(403);
    expect(r.body.error.message).toBe('Sara can only be added by people they chat with. Send them the invite link instead.');
    await t.http.post('/v1/groups').set(ali.auth).send({ name: 'Yes', memberIds: [sara.id] }).expect(200);
  });
});

describe('Notification settings', () => {
  let t: TestApp; let ali: TUser; let sara: TUser;
  const pushes = async (u: TUser) => (await t.http.get('/v1/_test/pushes').query({ userId: u.id }).expect(200)).body as Array<{ payload: { title: string; body: string } }>;
  const settle = async (u: TUser) => { await sleep(400); return pushes(u); };
  beforeAll(async () => {
    t = await startApp();
    [ali, sara] = [await makeUser(t, 'Ali'), await makeUser(t, 'Sara')];
    await t.http.post('/v1/push/subscriptions').set(ali.auth).send({ endpoint: 'https://push.example/ali', keys: { p256dh: 'BOr2Ae_W_example_p256dh_key_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', auth: 'aaaaaaaaaaaaaaaaaaaaaa' } }).expect(204);
  });
  beforeEach(async () => { await t.redis.del(`push:dev:${ali.id}`); });
  afterAll(async () => { await t.close(); });

  it('previews off, group alerts off, and quiet hours', async () => {
    const c = (await t.http.post('/v1/conversations/direct').set(sara.auth).send({ userId: ali.id }).expect(200)).body.id;
    const g = (await t.http.post('/v1/groups').set(sara.auth).send({ name: 'Fam', memberIds: [ali.id] }).expect(200)).body.id;
    await t.http.put('/v1/me/notifications').set(ali.auth).send({ preview: false }).expect(200);
    await t.http.post(`/v1/conversations/${c}/messages`).set(sara.auth).send({ clientId: cid(), text: 'my secret' }).expect(200);
    expect((await settle(ali)).map((p) => [p.payload.title, p.payload.body])).toEqual([['Sara', 'New message']]);
    await t.redis.del(`push:dev:${ali.id}`);
    await t.http.put('/v1/me/notifications').set(ali.auth).send({ preview: true, groups: false }).expect(200);
    await t.http.post(`/v1/conversations/${g}/messages`).set(sara.auth).send({ clientId: cid(), text: 'group hi' }).expect(200);
    expect(await settle(ali)).toEqual([]);
    // Quiet hours that cover right now (in UTC): nothing; a window elsewhere in the day: notifications again.
    const h = new Date().getUTCHours();
    const at = (x: number) => `${String((x + 24) % 24).padStart(2, '0')}:00`;
    await t.http.put('/v1/me/notifications').set(ali.auth).send({ quietHours: { on: true, from: at(h - 1), to: at(h + 1) }, timeZone: 'UTC' }).expect(200);
    await t.http.post(`/v1/conversations/${c}/messages`).set(sara.auth).send({ clientId: cid(), text: 'late' }).expect(200);
    expect(await settle(ali)).toEqual([]);
    const me = (await t.http.put('/v1/me/notifications').set(ali.auth).send({ quietHours: { on: true, from: at(h + 2), to: at(h + 4) } }).expect(200)).body as MeProfile;
    expect(me.notifications).toMatchObject({ preview: true, groups: false, timeZone: 'UTC' });
    await t.http.post(`/v1/conversations/${c}/messages`).set(sara.auth).send({ clientId: cid(), text: 'now ok' }).expect(200);
    expect((await settle(ali)).map((p) => p.payload.body)).toEqual(['now ok']);
    expect((await t.http.put('/v1/me/notifications').set(ali.auth).send({ timeZone: 'Mars/Base' })).status).toBe(400);
  });
});

describe('Account: delete, export, delete chat, support, storage', () => {
  let t: TestApp;
  beforeAll(async () => { t = await startApp(); });
  afterAll(async () => { await t.close(); });

  it('deleting a chat hides it until someone writes again', async () => {
    const [a, b] = [await makeUser(t, 'Ali'), await makeUser(t, 'Sara')];
    const c = (await t.http.post('/v1/conversations/direct').set(a.auth).send({ userId: b.id }).expect(200)).body.id;
    await t.http.post(`/v1/conversations/${c}/messages`).set(b.auth).send({ clientId: cid(), text: 'old' }).expect(200);
    await t.http.delete(`/v1/conversations/${c}`).set(a.auth).expect(204);
    expect((await t.http.get('/v1/conversations').set(a.auth).expect(200)).body.items.map((x: { id: string }) => x.id)).not.toContain(c);
    await t.http.post(`/v1/conversations/${c}/messages`).set(b.auth).send({ clientId: cid(), text: 'new' }).expect(200);
    const back = (await t.http.get('/v1/conversations').set(a.auth).expect(200)).body.items.find((x: { id: string }) => x.id === c);
    expect(back.lastMessage.text).toBe('new');
    expect((await t.http.get(`/v1/conversations/${c}/messages`).set(a.auth).expect(200)).body.items.map((m: { text: string }) => m.text)).toEqual(['new']);
    const g = (await t.http.post('/v1/groups').set(a.auth).send({ name: 'G', memberIds: [b.id] }).expect(200)).body.id;
    expect((await t.http.delete(`/v1/conversations/${g}`).set(a.auth)).status).toBe(400);
  });

  it('exports my data, then deletes the account after a code: signed out everywhere, out of groups, a fresh start if they come back', async () => {
    const [ali, sara] = [await makeUser(t, 'Ali'), await makeUser(t, 'Sara')];
    const me = await meOf(t, ali);
    const c = (await t.http.post('/v1/conversations/direct').set(ali.auth).send({ userId: sara.id }).expect(200)).body.id;
    await t.http.post(`/v1/conversations/${c}/messages`).set(ali.auth).send({ clientId: cid(), text: 'bye everyone' }).expect(200);
    const g = (await t.http.post('/v1/groups').set(ali.auth).send({ name: 'Ali’s group', memberIds: [sara.id] }).expect(200)).body.id;
    const data = (await t.http.get('/v1/me/export').set(ali.auth).expect(200)).body;
    expect(data.profile.displayName).toBe('Ali');
    expect(data.messagesSent.map((m: { text: string; chat: string }) => [m.chat, m.text])).toEqual([['Sara', 'bye everyone']]);
    expect(data.chats).toHaveLength(2);

    await resetLimits(t);
    expect((await t.http.post('/v1/me/delete/start').set(ali.auth).expect(200)).body.channel).toBe('sms');
    expect((await t.http.post('/v1/me/delete').set(ali.auth).send({ code: '000000' })).status).toBe(400);
    await t.http.post('/v1/me/delete').set(ali.auth).send({ code: await lastCode(t, me.phone!), reason: 'Testing' }).expect(204);
    expect((await t.http.get('/v1/me').set(ali.auth)).status).toBe(401);
    // Sara: Ali is gone from the group (she runs it now), and their chat shows "Deleted account" and can't be written to.
    const gi = (await t.http.get(`/v1/groups/${g}`).set(sara.auth).expect(200)).body;
    expect(gi.members.map((m: { id: string }) => m.id)).toEqual([sara.id]);
    expect(gi.role).toBe('admin');
    const dc = (await t.http.get(`/v1/conversations/${c}`).set(sara.auth).expect(200)).body as ConversationSummary;
    expect(dc.peer).toMatchObject({ displayName: 'Deleted account', photoUrl: null, username: null });
    expect((await t.http.post(`/v1/conversations/${c}/messages`).set(sara.auth).send({ clientId: cid(), text: 'hello?' })).status).toBe(403);
    expect((await t.http.get('/v1/users/lookup').query({ q: me.phone }).set(sara.auth)).status).toBe(404);
    expect(await t.db.collection('yc_account_deletions').countDocuments({ reason: 'Testing' })).toBe(1);

    // Signing up again with the same number: a new, empty account.
    await resetLimits(t);
    await t.http.post('/v1/auth/phone/start').send({ phone: me.phone }).expect(200);
    const v = (await t.http.post('/v1/auth/phone/verify').send({ phone: me.phone, code: await lastCode(t, me.phone!), device: device(3) }).expect(200)).body;
    expect(v.status).toBe('email_required');
    await t.http.post('/v1/auth/signup/email/start').send({ signupToken: v.signupToken, email: me.email }).expect(200);
    const again = (await t.http.post('/v1/auth/signup/email/verify').send({ signupToken: v.signupToken, email: me.email, code: await lastCode(t, me.email!), device: device(3) }).expect(200)).body;
    expect(again.isNew).toBe(true);
    expect(again.me.pending).toContain('profile');
    expect((await t.http.get('/v1/conversations').set(bearer(again)).expect(200)).body.items).toEqual([]);
  });

  it('contact us opens a chat with YaysApp Support; problems and storage', async () => {
    const u = await makeUser(t, 'Zara');
    const c = (await t.http.post('/v1/support/chat').set(u.auth).expect(200)).body as ConversationSummary;
    expect(c.peer).toMatchObject({ displayName: 'YaysApp Support', username: 'yaysapp' });
    expect(c.lastMessage?.text).toMatch(/This is YaysApp Support/);
    expect(((await t.http.post('/v1/support/chat').set(u.auth).expect(200)).body as ConversationSummary).id).toBe(c.id);
    expect((await t.http.post('/v1/support/problems').set(u.auth).send({ text: 'short' })).status).toBe(400);
    await t.http.post('/v1/support/problems').set(u.auth).send({ text: 'Messages do not arrive on Firefox', userAgent: 'Firefox' }).expect(204);
    expect(await t.db.collection('yc_problem_reports').countDocuments({ text: 'Messages do not arrive on Firefox' })).toBe(1);
    const k = (await t.http.post('/v1/media/upload-url').set(u.auth).send({ purpose: 'media', kind: 'file', contentType: 'application/pdf', size: 8, name: 'a.pdf' }).expect(200)).body;
    await t.http.put(new URL(k.uploadUrl).pathname).set('content-type', 'application/pdf').send(Buffer.from('%PDF-1.4')).expect(204);
    await t.http.post(`/v1/conversations/${c.id}/messages`).set(u.auth).send({ clientId: cid(), attachment: { kind: 'file', key: k.key, name: 'a.pdf' } }).expect(200);
    const st = (await t.http.get('/v1/me/storage').set(u.auth).expect(200)).body as StorageReport;
    expect(st).toMatchObject({ total: 8, byKind: { file: 8 } });
    expect(st.chats).toEqual([{ conversationId: c.id, name: 'YaysApp Support', kind: 'direct', bytes: 8, counts: { file: 1 } }]);
  });
});

import { ObjectId } from 'mongodb';
import { bearer, device, googleToken, lastCode, signInEmail, signUpPhone, startApp, wrongCode, type TestApp } from './helpers';

/** A user exactly as the old backend stores it: email with capitals, unverified local phone, BTCY fields. */
const legacyUser = (over: Record<string, unknown> = {}) => ({
  _id: new ObjectId(), email: 'Sara.Ahmed@Example.com', phone: '03001234567', username: 'sara_btcy', firstName: 'Sara', lastName: 'Ahmed',
  profilePic: 'https://cdn.example.com/old/sara.jpg', referralCode: 'SARA92', vipLevel: 'VIP-3', kycStatus: 'Approved',
  userWallets: [{ coin: 'BTCY', balance: 1200 }], authProviders: [{ provider: 'google', userid: 'g-old' }], lastLogin: new Date('2026-09-01'),
  ...over,
});

describe('Week 2 · phone sign-in codes', () => {
  let t: TestApp;
  beforeAll(async () => { t = await startApp(); });
  afterAll(async () => { await t.close(); });
  beforeEach(async () => { await t.redis.flushdb(); });

  it('rejects numbers that are not mobile numbers', async () => {
    for (const phone of ['', '123', 'abc', '+92 42 111 222 333']) {
      const r = await t.http.post('/v1/auth/phone/start').send({ phone }).expect(400);
      expect(r.body.error.code).toBe('validation_failed');
      expect(r.body.error.details.fields.phone).toMatch(/valid mobile number/);
    }
  });

  it('treats 0300…, +92 300… and 0092… as the same number', async () => {
    const s = await t.http.post('/v1/auth/phone/start').send({ phone: '0300 1112233' }).expect(200);
    expect(s.body).toMatchObject({ channel: 'sms', expiresInSeconds: 600 });
    expect(s.body.sentTo).toBe('+923 ••• 233');
    const code = await lastCode(t, '+923001112233');
    const v = await t.http.post('/v1/auth/phone/verify').send({ phone: '0092-300-1112233', code, device: device() }).expect(200);
    expect(v.body.status).toBe('email_required');
    expect(v.body.phone).toBe('+923001112233');
  });

  it('counts wrong codes, then locks the code even for the right one', async () => {
    const phone = '+923001112234';
    await t.http.post('/v1/auth/phone/start').send({ phone }).expect(200);
    const code = await lastCode(t, phone);
    for (let i = 4; i >= 1; i--) {
      const r = await t.http.post('/v1/auth/phone/verify').send({ phone, code: wrongCode(code), device: device() }).expect(400);
      expect(r.body.error).toMatchObject({ code: 'code_invalid', details: { attemptsLeft: i } });
    }
    expect((await t.http.post('/v1/auth/phone/verify').send({ phone, code: wrongCode(code), device: device() })).status).toBe(423);
    const locked = await t.http.post('/v1/auth/phone/verify').send({ phone, code, device: device() });
    expect(locked.status).toBe(423);
    expect(locked.body.error.code).toBe('code_locked');
    // A new code unlocks it.
    await t.http.post('/v1/auth/phone/start').send({ phone }).expect(200);
    await t.http.post('/v1/auth/phone/verify').send({ phone, code: await lastCode(t, phone), device: device() }).expect(200);
  });

  it('a code works once', async () => {
    const phone = '+923001112235';
    await t.http.post('/v1/auth/phone/start').send({ phone });
    const code = await lastCode(t, phone);
    await t.http.post('/v1/auth/phone/verify').send({ phone, code, device: device() }).expect(200);
    const again = await t.http.post('/v1/auth/phone/verify').send({ phone, code, device: device() });
    expect(again.status).toBe(410);
    expect(again.body.error.code).toBe('code_expired');
  });

  it('a code never asked for reads as expired', async () => {
    const r = await t.http.post('/v1/auth/phone/verify').send({ phone: '+923001112236', code: '123456', device: device() });
    expect(r.status).toBe(410);
  });

  it('two taps with the right code: only one succeeds', async () => {
    const phone = '+923001112237';
    await t.http.post('/v1/auth/phone/start').send({ phone });
    const code = await lastCode(t, phone);
    const [a, b] = await Promise.all([1, 2].map(() => t.http.post('/v1/auth/phone/verify').send({ phone, code, device: device() })));
    expect([a.status, b.status].sort()).toEqual([200, 410]);
  });

  it('rejects malformed codes and devices before checking anything', async () => {
    for (const body of [{ code: '12345' }, { code: '1234567' }, { code: 'abcdef' }, { code: '123456', device: { deviceId: 'x', platform: 'web' } }, { code: '123456', device: { deviceId: 'device-123456', platform: 'tv' } }]) {
      const r = await t.http.post('/v1/auth/phone/verify').send({ phone: '+923001112238', device: device(), ...body });
      expect(r.status).toBe(400);
    }
  });
});

describe('Week 2 · resend and hourly limits', () => {
  it('makes people wait before a resend and says how long', async () => {
    const t = await startApp({ OTP_RESEND_SECONDS: '30' });
    await t.http.post('/v1/auth/phone/start').send({ phone: '+923001110001' }).expect(200);
    const r = await t.http.post('/v1/auth/phone/start').send({ phone: '+923001110001' }).expect(429);
    expect(r.body.error.code).toBe('rate_limited');
    expect(r.body.error.details.retryAfter).toBeGreaterThan(25);
    expect(Number(r.headers['retry-after'])).toBeGreaterThan(25);
    await t.close();
  });
  it('allows 5 codes per number per hour', async () => {
    const t = await startApp();
    for (let i = 0; i < 5; i++) await t.http.post('/v1/auth/phone/start').send({ phone: '+923001110002' }).expect(200);
    const r = await t.http.post('/v1/auth/phone/start').send({ phone: '+923001110002' }).expect(429);
    expect(r.body.error.message).toMatch(/last hour/);
    await t.close();
  });
  it('allows 30 codes per IP per hour across numbers', async () => {
    const t = await startApp();
    for (let i = 0; i < 30; i++) await t.http.post('/v1/auth/email/start').send({ email: `ip${i}@example.com` }).expect(200);
    await t.http.post('/v1/auth/email/start').send({ email: 'ip31@example.com' }).expect(429);
    await t.close();
  });
});

describe('Week 2 · phone sign-up and linking old accounts', () => {
  let t: TestApp;
  beforeAll(async () => { t = await startApp(); });
  afterAll(async () => { await t.close(); });
  beforeEach(async () => { await t.redis.flushdb(); await t.db.collection('users').deleteMany({}); });

  it('a new phone and new email make a new account', async () => {
    const r = await signUpPhone(t, '+923005550001', 'new.person@example.com');
    expect(r.isNew).toBe(true);
    expect(r.me).toMatchObject({ phone: '+923005550001', email: 'new.person@example.com', migrated: false, hasGoogle: false });
    expect(r.me.pending).toEqual(['profile']);
    const me = await t.http.get('/v1/me').set(bearer(r)).expect(200);
    expect(me.body.id).toBe(r.me.id);
  });

  it('links a phone to an old account only after the email code, keeping every BTCY field', async () => {
    const legacy = legacyUser();
    await t.db.collection('users').insertOne(legacy);
    const before = await t.db.collection('users').findOne({ _id: legacy._id });
    const r = await signUpPhone(t, '+923009990001', 'sara.ahmed@example.com');
    expect(r.isNew).toBe(false);
    expect(r.me).toMatchObject({ id: legacy._id.toHexString(), displayName: 'Sara Ahmed', migrated: true, phone: '+923009990001', email: 'sara.ahmed@example.com', photoUrl: legacy.profilePic });
    const after = await t.db.collection('users').findOne({ _id: legacy._id });
    const { yc, ...rest } = after!;
    expect(rest).toEqual(before); // nothing the old app or BTCY reads has changed
    expect(yc).toMatchObject({ phoneE164: '+923009990001', emailLower: 'sara.ahmed@example.com', legacy: true });
  });

  it('never links by the old unverified phone field alone', async () => {
    await t.db.collection('users').insertOne(legacyUser());
    await t.http.post('/v1/auth/phone/start').send({ phone: '03001234567' });
    const v = await t.http.post('/v1/auth/phone/verify').send({ phone: '03001234567', code: await lastCode(t, '+923001234567'), device: device() }).expect(200);
    expect(v.body.status).toBe('email_required');
    expect(v.body.tokens).toBeUndefined();
  });

  it('refuses to put a second number on an account that already has one', async () => {
    await signUpPhone(t, '+923005550002', 'owner@example.com');
    await t.http.post('/v1/auth/phone/start').send({ phone: '+923005550003' });
    const v = await t.http.post('/v1/auth/phone/verify').send({ phone: '+923005550003', code: await lastCode(t, '+923005550003'), device: device(2) });
    await t.http.post('/v1/auth/signup/email/start').send({ signupToken: v.body.signupToken, email: 'owner@example.com' }).expect(200);
    const r = await t.http.post('/v1/auth/signup/email/verify').send({ signupToken: v.body.signupToken, email: 'owner@example.com', code: await lastCode(t, 'owner@example.com'), device: device(2) });
    expect(r.status).toBe(409);
    expect(r.body.error).toMatchObject({ code: 'phone_taken', details: { existingPhone: '+923 ••• 002' } });
  });

  it('a sign-up step can not be replayed or forged', async () => {
    await t.http.post('/v1/auth/phone/start').send({ phone: '+923005550004' });
    const v = await t.http.post('/v1/auth/phone/verify').send({ phone: '+923005550004', code: await lastCode(t, '+923005550004'), device: device() });
    const token: string = v.body.signupToken;
    const forged = token.slice(0, -4) + (token.endsWith('AAAA') ? 'BBBB' : 'AAAA');
    expect((await t.http.post('/v1/auth/signup/email/start').send({ signupToken: forged, email: 'a@example.com' })).status).toBe(401);
    await t.http.post('/v1/auth/signup/email/start').send({ signupToken: token, email: 'a@example.com' }).expect(200);
    await t.http.post('/v1/auth/signup/email/verify').send({ signupToken: token, email: 'a@example.com', code: await lastCode(t, 'a@example.com'), device: device() }).expect(200);
    await t.http.post('/v1/auth/signup/email/start').send({ signupToken: token, email: 'b@example.com' }).expect(200);
    const replay = await t.http.post('/v1/auth/signup/email/verify').send({ signupToken: token, email: 'b@example.com', code: await lastCode(t, 'b@example.com'), device: device() });
    expect(replay.status).toBe(401);
  });

  it("an email code asked for one phone can't finish another phone's sign-up", async () => {
    const tok = async (p: string) => { await t.http.post('/v1/auth/phone/start').send({ phone: p }); return (await t.http.post('/v1/auth/phone/verify').send({ phone: p, code: await lastCode(t, p), device: device() })).body.signupToken as string; };
    const a = await tok('+923005550005'), b = await tok('+923005550006');
    await t.http.post('/v1/auth/signup/email/start').send({ signupToken: a, email: 'shared@example.com' }).expect(200);
    const r = await t.http.post('/v1/auth/signup/email/verify').send({ signupToken: b, email: 'shared@example.com', code: await lastCode(t, 'shared@example.com'), device: device() });
    expect(r.status).toBe(410);
  });

  it('a returning phone signs straight in, on any formatting', async () => {
    const first = await signUpPhone(t, '+923005550007', 'back@example.com');
    await t.http.post('/v1/auth/phone/start').send({ phone: '0300 5550007' });
    const r = await t.http.post('/v1/auth/phone/verify').send({ phone: '03005550007', code: await lastCode(t, '+923005550007'), device: device(9) }).expect(200);
    expect(r.body.status).toBe('signed_in');
    expect(r.body.me.id).toBe(first.me.id);
    expect(r.body.isNew).toBe(false);
  });

  it('picks the most recently used account when an old email exists twice', async () => {
    const older = legacyUser({ email: 'dup@example.com', lastLogin: new Date('2025-01-01'), firstName: 'Old' });
    const newer = legacyUser({ email: 'DUP@example.com', lastLogin: new Date('2026-10-01'), firstName: 'New' });
    await t.db.collection('users').insertMany([older, newer]);
    const r = await signInEmail(t, 'dup@example.com');
    expect(r.me.id).toBe(older._id.toHexString()); // exact-case match wins first
    await t.db.collection('users').deleteMany({});
    await t.db.collection('users').insertMany([legacyUser({ _id: new ObjectId(), email: 'Dup@Example.com', lastLogin: new Date('2025-01-01') }), { ...legacyUser({ email: 'DUP@EXAMPLE.COM', lastLogin: new Date('2026-10-01') }), _id: newer._id }]);
    await t.redis.flushdb();
    const r2 = await signInEmail(t, 'dup@example.com');
    expect(r2.me.id).toBe(newer._id.toHexString()); // then the most recent login
  });
});

describe('Week 2 · email and Google sign-in', () => {
  let t: TestApp;
  beforeAll(async () => { t = await startApp(); });
  afterAll(async () => { await t.close(); });
  beforeEach(async () => { await t.redis.flushdb(); await t.db.collection('users').deleteMany({}); });

  it('email sign-in creates an account that still needs a phone and a name', async () => {
    const r = await signInEmail(t, '  New.User@Example.COM ');
    expect(r.isNew).toBe(true);
    expect(r.me.email).toBe('new.user@example.com');
    expect(r.me.pending).toEqual(['add_phone', 'profile']);
  });

  it('email sign-in finds an old account in any capitalisation', async () => {
    const l = legacyUser();
    await t.db.collection('users').insertOne(l);
    const r = await signInEmail(t, 'SARA.AHMED@example.com');
    expect(r.me).toMatchObject({ id: l._id.toHexString(), migrated: true, displayName: 'Sara Ahmed' });
    expect(r.me.pending).toEqual(['add_phone']);
  });

  it('Google creates, then reuses, one account', async () => {
    const tok = googleToken({ sub: 'g-1', email: 'Gee@Example.com', name: 'Gee Khan' });
    const a = await t.http.post('/v1/auth/google').send({ idToken: tok, device: device() }).expect(200);
    expect(a.body).toMatchObject({ isNew: true, me: { displayName: 'Gee Khan', hasGoogle: true, email: 'gee@example.com' } });
    const b = await t.http.post('/v1/auth/google').send({ idToken: tok, device: device(2) }).expect(200);
    expect(b.body.me.id).toBe(a.body.me.id);
    expect(b.body.isNew).toBe(false);
  });

  it('Google links to an old account by its verified email', async () => {
    const l = legacyUser();
    await t.db.collection('users').insertOne(l);
    const r = await t.http.post('/v1/auth/google').send({ idToken: googleToken({ sub: 'g-sara', email: 'sara.ahmed@example.com' }), device: device() }).expect(200);
    expect(r.body.me.id).toBe(l._id.toHexString());
    // The old app's own authProviders list is untouched.
    expect((await t.db.collection('users').findOne({ _id: l._id }))!.authProviders).toEqual(l.authProviders);
  });

  it('a second Google account can not take over an email already linked to another', async () => {
    await t.http.post('/v1/auth/google').send({ idToken: googleToken({ sub: 'g-a', email: 'one@example.com' }), device: device() }).expect(200);
    const r = await t.http.post('/v1/auth/google').send({ idToken: googleToken({ sub: 'g-b', email: 'one@example.com' }), device: device() });
    expect(r.status).toBe(409);
  });

  it('refuses unverified Google emails and junk tokens', async () => {
    expect((await t.http.post('/v1/auth/google').send({ idToken: googleToken({ sub: 'g-x', email: 'x@example.com', email_verified: false }), device: device() })).status).toBe(401);
    expect((await t.http.post('/v1/auth/google').send({ idToken: 'not-a-real-google-token-at-all', device: device() })).status).toBe(401);
  });

  it('a turned-off account can not sign in', async () => {
    const l = legacyUser({ email: 'off@example.com', yc: { disabledAt: new Date() } });
    await t.db.collection('users').insertOne(l);
    await t.http.post('/v1/auth/email/start').send({ email: 'off@example.com' });
    const r = await t.http.post('/v1/auth/email/verify').send({ email: 'off@example.com', code: await lastCode(t, 'off@example.com'), device: device() });
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('account_disabled');
  });
});

describe('Week 2 · sessions and devices', () => {
  let t: TestApp;
  beforeAll(async () => { t = await startApp(); });
  afterAll(async () => { await t.close(); });
  beforeEach(async () => { await t.redis.flushdb(); await t.db.collection('users').deleteMany({}); await t.db.collection('yc_sessions').deleteMany({}); });

  it('requires a valid bearer token', async () => {
    expect((await t.http.get('/v1/me')).status).toBe(401);
    expect((await t.http.get('/v1/me').set('authorization', 'Bearer nope')).status).toBe(401);
    expect((await t.http.get('/v1/me').set('authorization', 'Basic abc')).status).toBe(401);
  });

  it('refresh rotates the token; reusing the old one signs the device out', async () => {
    const a = await signInEmail(t, 'rot@example.com');
    const r1 = await t.http.post('/v1/auth/refresh').send({ refreshToken: a.tokens.refreshToken }).expect(200);
    expect(r1.body.refreshToken).not.toBe(a.tokens.refreshToken);
    await t.http.get('/v1/me').set('authorization', `Bearer ${r1.body.accessToken}`).expect(200);
    const reuse = await t.http.post('/v1/auth/refresh').send({ refreshToken: a.tokens.refreshToken });
    expect(reuse.status).toBe(401);
    expect(reuse.body.error.code).toBe('session_revoked');
    // The stolen pair is dead, and so is the legitimate one: the person signs in again.
    expect((await t.http.post('/v1/auth/refresh').send({ refreshToken: r1.body.refreshToken })).status).toBe(401);
    expect((await t.http.get('/v1/me').set('authorization', `Bearer ${r1.body.accessToken}`)).status).toBe(401);
  });

  it('logout kills the access token at once', async () => {
    const a = await signInEmail(t, 'out@example.com');
    await t.http.post('/v1/auth/logout').set(bearer(a)).expect(204);
    const r = await t.http.get('/v1/me').set(bearer(a));
    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe('session_revoked');
    expect((await t.http.post('/v1/auth/refresh').send({ refreshToken: a.tokens.refreshToken })).status).toBe(401);
  });

  it('signing in again on the same device replaces its session', async () => {
    const a = await signInEmail(t, 'same@example.com', device(1));
    const b = await signInEmail(t, 'same@example.com', device(1));
    expect((await t.http.get('/v1/me').set(bearer(a))).status).toBe(401);
    const list = await t.http.get('/v1/me/devices').set(bearer(b)).expect(200);
    expect(list.body).toHaveLength(1);
  });

  it('lists devices, signs one out, and signs out all others', async () => {
    const web = await signInEmail(t, 'multi@example.com', device(1, 'web'));
    const phone = await signInEmail(t, 'multi@example.com', device(2, 'android'));
    const ipad = await signInEmail(t, 'multi@example.com', device(3, 'ios'));
    const list = (await t.http.get('/v1/me/devices').set(bearer(web)).expect(200)).body as Array<{ id: string; current: boolean; platform: string }>;
    expect(list).toHaveLength(3);
    expect(list.filter((d) => d.current)).toHaveLength(1);
    await t.http.delete(`/v1/me/devices/${phone.tokens.sessionId}`).set(bearer(web)).expect(204);
    expect((await t.http.get('/v1/me').set(bearer(phone))).status).toBe(401);
    const r = await t.http.post('/v1/me/devices/revoke-others').set(bearer(web)).expect(200);
    expect(r.body.revoked).toBe(1);
    expect((await t.http.get('/v1/me').set(bearer(ipad))).status).toBe(401);
    await t.http.get('/v1/me').set(bearer(web)).expect(200);
  });

  it("can not sign out someone else's device", async () => {
    const a = await signInEmail(t, 'a1@example.com');
    const b = await signInEmail(t, 'b1@example.com', device(5));
    expect((await t.http.delete(`/v1/me/devices/${b.tokens.sessionId}`).set(bearer(a))).status).toBe(404);
    await t.http.get('/v1/me').set(bearer(b)).expect(200);
    expect((await t.http.delete('/v1/me/devices/../../etc').set(bearer(a))).status).toBe(404);
  });

  it('turning an account off blocks its live tokens', async () => {
    const a = await signInEmail(t, 'later-off@example.com');
    await t.db.collection('users').updateOne({ _id: new ObjectId(a.me.id) }, { $set: { 'yc.disabledAt': new Date() } });
    expect((await t.http.get('/v1/me').set(bearer(a))).status).toBe(403);
  });
});

describe('Week 2 · profile, username and photo', () => {
  let t: TestApp;
  beforeAll(async () => { t = await startApp(); });
  afterAll(async () => { await t.close(); });
  beforeEach(async () => { await t.redis.flushdb(); await t.db.collection('users').deleteMany({}); });

  it('updates name and about, trimming spaces', async () => {
    const a = await signInEmail(t, 'p1@example.com');
    const r = await t.http.patch('/v1/me').set(bearer(a)).send({ displayName: '  Sara Ahmed ', about: ' Coffee first ' }).expect(200);
    expect(r.body).toMatchObject({ displayName: 'Sara Ahmed', about: 'Coffee first', pending: ['add_phone'] });
  });

  it('validates name and about length', async () => {
    const a = await signInEmail(t, 'p2@example.com');
    expect((await t.http.patch('/v1/me').set(bearer(a)).send({ displayName: '   ' })).status).toBe(400);
    expect((await t.http.patch('/v1/me').set(bearer(a)).send({ about: 'x'.repeat(81) })).status).toBe(400);
  });

  it('usernames: format, reserved, taken in v2 or the old app, and free for the owner', async () => {
    await t.db.collection('users').insertOne(legacyUser({ email: 'legacy@example.com', username: 'Taken.Name' }));
    const a = await signInEmail(t, 'p3@example.com');
    const b = await signInEmail(t, 'p4@example.com', device(2));
    const check = async (u: string) => (await t.http.get('/v1/me/username-available').query({ u }).set(bearer(a)).expect(200)).body;
    expect(await check('ab')).toMatchObject({ available: false });
    expect(await check('admin')).toMatchObject({ available: false, reason: 'That username is reserved.' });
    expect(await check('taken.name')).toMatchObject({ available: false, reason: 'That username is taken.' });
    expect(await check('sara.92')).toEqual({ available: true });
    await t.http.patch('/v1/me').set(bearer(a)).send({ username: 'Sara.92' }).expect(200);
    const clash = await t.http.patch('/v1/me').set(bearer(b)).send({ username: 'sara.92' });
    expect(clash.status).toBe(409);
    expect(clash.body.error.details.fields.username).toBe('That username is taken.');
    expect((await t.http.patch('/v1/me').set(bearer(a)).send({ username: 'sara.92' })).status).toBe(200); // keeping your own is fine
  });

  it('two people racing for one username: exactly one gets it', async () => {
    const a = await signInEmail(t, 'r1@example.com');
    const b = await signInEmail(t, 'r2@example.com', device(2));
    const rs = await Promise.all([a, b].map((x) => t.http.patch('/v1/me').set(bearer(x)).send({ username: 'race.winner' })));
    expect(rs.map((r) => r.status).sort()).toEqual([200, 409]);
  });

  it('photo upload: type and size are checked, only your own upload can be used, and it can be downloaded', async () => {
    const a = await signInEmail(t, 'ph1@example.com');
    const b = await signInEmail(t, 'ph2@example.com', device(2));
    expect((await t.http.post('/v1/media/upload-url').set(bearer(a)).send({ purpose: 'avatar', contentType: 'image/gif', size: 100 })).status).toBe(400);
    expect((await t.http.post('/v1/media/upload-url').set(bearer(a)).send({ purpose: 'avatar', contentType: 'image/png', size: 6 * 1024 * 1024 })).status).toBe(400);
    const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4c40000000049454e44ae426082', 'hex');
    const ticket = (await t.http.post('/v1/media/upload-url').set(bearer(a)).send({ purpose: 'avatar', contentType: 'image/png', size: png.length }).expect(200)).body;
    const uploadPath = new URL(ticket.uploadUrl).pathname;
    expect((await t.http.put(uploadPath).set('content-type', 'image/jpeg').send(png)).status).toBe(400); // wrong type for this ticket
    // Using the photo before it is uploaded fails clearly.
    expect((await t.http.patch('/v1/me').set(bearer(a)).send({ photoKey: ticket.key })).status).toBe(400);
    await t.http.put(uploadPath).set('content-type', 'image/png').send(png).expect(204);
    expect((await t.http.patch('/v1/me').set(bearer(b)).send({ photoKey: ticket.key })).status).toBe(403);
    const me = (await t.http.patch('/v1/me').set(bearer(a)).send({ photoKey: ticket.key }).expect(200)).body;
    const img = await t.http.get(new URL(me.photoUrl).pathname).expect(200);
    expect(img.headers['content-type']).toBe('image/png');
    expect(Buffer.compare(img.body, png)).toBe(0);
    // Removing the photo hides the old one too.
    expect((await t.http.patch('/v1/me').set(bearer(a)).send({ photoKey: null }).expect(200)).body.photoUrl).toBeNull();
    // Tampered links are refused.
    expect((await t.http.get(new URL(me.photoUrl).pathname.slice(0, -3) + 'abc')).status).toBe(403);
  });

  it('changing the photo saves the new one and deletes the old file, unless a group still uses it', async () => {
    const a = await signInEmail(t, 'ph3@example.com');
    const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4c40000000049454e44ae426082', 'hex');
    const upload = async () => {
      const k = (await t.http.post('/v1/media/upload-url').set(bearer(a)).send({ purpose: 'avatar', contentType: 'image/png', size: png.length }).expect(200)).body;
      await t.http.put(new URL(k.uploadUrl).pathname).set('content-type', 'image/png').send(png).expect(204);
      return k.key as string;
    };
    const first = await upload();
    const one = (await t.http.patch('/v1/me').set(bearer(a)).send({ photoKey: first }).expect(200)).body;
    await t.http.get(new URL(one.photoUrl).pathname).expect(200);
    // A new photo replaces it: the new one shows (also after reloading the profile), the old file is gone.
    const second = await upload();
    const two = (await t.http.patch('/v1/me').set(bearer(a)).send({ photoKey: second }).expect(200)).body;
    expect(two.photoUrl).not.toBe(one.photoUrl);
    expect((await t.http.get('/v1/me').set(bearer(a)).expect(200)).body.photoUrl).toBe(two.photoUrl);
    let gone = 0;
    for (let i = 0; i < 20 && gone !== 404; i++) { gone = (await t.http.get(new URL(one.photoUrl).pathname)).status; if (gone !== 404) await new Promise((r) => setTimeout(r, 50)); }
    expect(gone).toBe(404);
    await t.http.get(new URL(two.photoUrl).pathname).expect(200);
    // The same file used as a group photo too is kept when the profile photo is removed.
    const friend = await signInEmail(t, 'ph4@example.com', device(2));
    const r = await t.http.post('/v1/groups').set(bearer(a)).send({ name: 'Photo test', memberIds: [friend.me.id] });
    expect(r.status).toBe(200);
    const g = r.body.id as string;
    await t.http.patch(`/v1/groups/${g}`).set(bearer(a)).send({ photoKey: second }).expect(200);
    expect((await t.http.patch('/v1/me').set(bearer(a)).send({ photoKey: null }).expect(200)).body.photoUrl).toBeNull();
    await new Promise((r) => setTimeout(r, 200));
    expect((await t.http.get(new URL(two.photoUrl).pathname)).status).toBe(200);
  });

  it('refuses uploads larger than the ticket allows', async () => {
    const a = await signInEmail(t, 'big@example.com');
    const ticket = (await t.http.post('/v1/media/upload-url').set(bearer(a)).send({ purpose: 'avatar', contentType: 'image/jpeg', size: 1000 }).expect(200)).body;
    const r = await t.http.put(new URL(ticket.uploadUrl).pathname).set('content-type', 'image/jpeg').send(Buffer.alloc(5 * 1024 * 1024 + 10));
    expect(r.status).toBe(413);
  });
});

describe('Week 2 · adding a phone and matching contacts', () => {
  let t: TestApp;
  beforeAll(async () => { t = await startApp(); });
  afterAll(async () => { await t.close(); });
  beforeEach(async () => { await t.redis.flushdb(); await t.db.collection('users').deleteMany({}); });

  it('an email account adds a phone with a code', async () => {
    const a = await signInEmail(t, 'add@example.com');
    await t.http.post('/v1/me/phone/start').set(bearer(a)).send({ phone: '03007770001' }).expect(200);
    const me = await t.http.post('/v1/me/phone/verify').set(bearer(a)).send({ phone: '+923007770001', code: await lastCode(t, '+923007770001') }).expect(200);
    expect(me.body.phone).toBe('+923007770001');
    expect(me.body.pending).not.toContain('add_phone');
  });

  it("a number already on another account can't be added, and a code is tied to who asked", async () => {
    await signUpPhone(t, '+923007770002', 'holder@example.com');
    const a = await signInEmail(t, 'thief@example.com', device(2));
    expect((await t.http.post('/v1/me/phone/start').set(bearer(a)).send({ phone: '+923007770002' })).body.error.code).toBe('phone_taken');
    const b = await signInEmail(t, 'other@example.com', device(3));
    await t.http.post('/v1/me/phone/start').set(bearer(a)).send({ phone: '+923007770003' }).expect(200);
    const code = await lastCode(t, '+923007770003');
    expect((await t.http.post('/v1/me/phone/verify').set(bearer(b)).send({ phone: '+923007770003', code })).status).toBe(410);
  });

  it('matches only YaysApp users, reads local numbers in my country, skips me, duplicates and turned-off accounts', async () => {
    const me = await signUpPhone(t, '+923008880000', 'me@example.com');
    const amara = await signUpPhone(t, '+923008880001', 'amara@example.com', device(2));
    await t.http.patch('/v1/me').set(bearer(amara)).send({ displayName: 'Amara Okafor' });
    const lena = await signUpPhone(t, '+4915123456789', 'lena@example.com', device(3));
    const off = await signUpPhone(t, '+923008880002', 'off2@example.com', device(4));
    await t.db.collection('users').updateOne({ _id: new ObjectId(off.me.id) }, { $set: { 'yc.disabledAt': new Date() } });
    const r = await t.http.post('/v1/contacts/match').set(bearer(me)).send({ phones: ['0300 8880001', '+92 300 8880001', '+49 151 23456789', '03008880000', '03008880002', '0300 1231231', 'junk', ''] }).expect(200);
    const got = (r.body as Array<{ phone: string; user: { id: string; displayName: string } }>).map((m) => m.phone).sort();
    expect(got).toEqual(['+4915123456789', '+923008880001']);
    expect(r.body.find((m: { phone: string }) => m.phone === '+923008880001').user).toMatchObject({ id: amara.me.id, displayName: 'Amara Okafor' });
    expect(JSON.stringify(r.body)).not.toMatch(/email/); // public profiles never carry emails
    void lena;
  });

  it('caps the phone book at 5,000 numbers and 20 syncs an hour', async () => {
    const a = await signInEmail(t, 'cap@example.com');
    expect((await t.http.post('/v1/contacts/match').set(bearer(a)).send({ phones: Array(5001).fill('+923001234567') })).status).toBe(400);
    for (let i = 0; i < 20; i++) await t.http.post('/v1/contacts/match').set(bearer(a)).send({ phones: [] }).expect(200);
    expect((await t.http.post('/v1/contacts/match').set(bearer(a)).send({ phones: [] })).status).toBe(429);
  });
});

import type { AiReply, BonusCampaign, CheckinStatus, ChatMessage, ExploreView, PointsSummary, PopupNow, WalletView, Withdrawal, WithdrawalsPage, WithdrawQuote } from '@yays/shared';
import { startApp, type TestApp } from './helpers';
import { cid, makeUser, sleep, type TUser } from './chat-helpers';

const TZ = { 'x-time-zone': 'Asia/Karachi' };
const dayIn = (tz: string, offsetDays = 0) => new Date(Date.now() + offsetDays * 86400_000).toLocaleDateString('en-CA', { timeZone: tz });
const resetLimits = async (t: TestApp) => { const k = await t.redis.keys('rl:*'); if (k.length) await t.redis.del(...k); };

async function direct(t: TestApp, a: TUser, b: TUser) { return (await t.http.post('/v1/conversations/direct').set(a.auth).send({ userId: b.id }).expect(200)).body.id as string; }
async function say(t: TestApp, u: TUser, conv: string, n = 1) { for (let i = 0; i < n; i++) await t.http.post(`/v1/conversations/${conv}/messages`).set(u.auth).send({ clientId: cid(), text: `hi ${i}` }).expect(200); }
async function points(t: TestApp, u: TUser) { return (await t.http.get('/v1/rewards/points').set(u.auth).set(TZ).expect(200)).body as PointsSummary; }
/** Points for messages are added just after the message; wait for them. */
async function until<T>(fn: () => Promise<T>, ok: (v: T) => boolean, ms = 4000): Promise<T> {
  const end = Date.now() + ms; let v = await fn();
  while (!ok(v) && Date.now() < end) { await sleep(60); v = await fn(); }
  return v;
}

describe('Points: check-in, activity, cap', () => {
  let t: TestApp; let sara: TUser; let amara: TUser;
  beforeAll(async () => { t = await startApp(); sara = await makeUser(t, 'Sara'); amara = await makeUser(t, 'Amara'); });
  afterAll(async () => { await t.close(); });

  it('check-in pays day 1, only once a day, and continues a streak from yesterday', async () => {
    const s0 = (await t.http.get('/v1/rewards/checkin').set(sara.auth).set(TZ).expect(200)).body as CheckinStatus;
    expect(s0).toMatchObject({ claimedToday: false, dayOfWeek: 1, todayPoints: 10, streak: 0 });
    const s1 = (await t.http.post('/v1/rewards/checkin').set(sara.auth).set(TZ).expect(200)).body as CheckinStatus;
    expect(s1).toMatchObject({ claimedToday: true, streak: 1, balance: 10 });
    expect(s1.days[0]!.state).toBe('claimed');
    expect((await t.http.post('/v1/rewards/checkin').set(sara.auth).set(TZ)).status).toBe(409);
    // Amara checked in yesterday on day 5 of a 5-day streak: today is day 6, +20.
    const y = dayIn('Asia/Karachi', -1);
    const { ObjectId } = await import('mongodb');
    await t.db.collection('yc_checkins').insertOne({ _id: `${amara.id}:${y}` as never, userId: new ObjectId(amara.id), day: y, dayOfWeek: 5, streak: 5, points: 20, at: new Date() });
    const a = (await t.http.get('/v1/rewards/checkin').set(amara.auth).set(TZ).expect(200)).body as CheckinStatus;
    expect(a).toMatchObject({ dayOfWeek: 6, todayPoints: 20, tomorrowPoints: 50, streak: 5 });
    expect(a.days.slice(0, 5).every((d) => d.state === 'done')).toBe(true);
    expect((await t.http.post('/v1/rewards/checkin').set(amara.auth).set(TZ).expect(200)).body.streak).toBe(6);
  });

  it('ten messages pay +10 once; the history and today’s tasks show it', async () => {
    const conv = await direct(t, sara, amara);
    await say(t, sara, conv, 11);
    const p = await until(() => points(t, sara), (x) => x.balance >= 20);
    expect(p).toMatchObject({ balance: 20, earnedToday: 20, capUsed: 20, cap: 200 });
    const today = (await t.http.get('/v1/rewards/today').set(sara.auth).set(TZ).expect(200)).body;
    expect(today.tasks.find((x: { id: string }) => x.id === 'messages')).toMatchObject({ done: 10, of: 10, completed: true });
    const h = (await t.http.get('/v1/rewards/history?filter=earned').set(sara.auth).expect(200)).body;
    expect(h.items.map((i: { title: string }) => i.title)).toEqual(['Send 10 messages', 'Daily check-in']);
  });

  it('everyday points stop at the daily cap', async () => {
    const { ObjectId } = await import('mongodb');
    const day = dayIn('Asia/Karachi');
    await t.db.collection('yc_points_ledger').insertOne({ _id: new ObjectId(), userId: new ObjectId(amara.id), key: 'seed', kind: 'activity', title: 'x', sub: '', amount: 175, status: 'done', at: new Date(), day, week: 'x', capped: true }); // plus today's check-in (+20): 195
    await t.db.collection('yc_points').updateOne({ _id: new ObjectId(amara.id) as never }, { $inc: { balance: 175 } });
    const conv = await direct(t, amara, sara);
    await say(t, amara, conv, 10);
    const p = await until(() => points(t, amara), (x) => x.capUsed >= 200);
    expect(p.capUsed).toBe(200); // the +10 was cut to +5
  });
});

describe('Referrals', () => {
  let t: TestApp; let sara: TUser; let hamza: TUser;
  beforeAll(async () => { t = await startApp(); sara = await makeUser(t, 'Sara'); hamza = await makeUser(t, 'Hamza'); });
  afterAll(async () => { await t.close(); });

  it('a friend’s code is pending until they send a first message, then pays 100', async () => {
    const r = (await t.http.get('/v1/rewards/referrals').set(sara.auth).expect(200)).body;
    expect(r.code).toMatch(/^SARA-[A-Z0-9]{3}$/);
    expect((await t.http.post('/v1/rewards/referrals/use').set(sara.auth).send({ code: r.code })).status).toBe(400);
    expect((await t.http.post('/v1/rewards/referrals/use').set(hamza.auth).send({ code: 'NOPE-123' })).status).toBe(404);
    await t.http.post('/v1/rewards/referrals/use').set(hamza.auth).send({ code: r.code.toLowerCase() }).expect(200);
    expect((await t.http.post('/v1/rewards/referrals/use').set(hamza.auth).send({ code: r.code })).status).toBe(409);
    expect(await points(t, sara)).toMatchObject({ balance: 0, pending: 100 });
    const pending = (await t.http.get('/v1/rewards/referrals').set(sara.auth).expect(200)).body;
    expect(pending).toMatchObject({ invited: 1, joined: 0, pending: 1 });
    await say(t, hamza, await direct(t, hamza, sara));
    const p = await until(() => points(t, sara), (x) => x.balance >= 100);
    expect(p).toMatchObject({ balance: 100, pending: 0 });
    expect((await t.http.get('/v1/rewards/referrals').set(sara.auth).expect(200)).body).toMatchObject({ joined: 1, pointsEarned: 100 });
  });

  it('accounts older than a week don’t earn the inviter anything', async () => {
    const old = await makeUser(t, 'Omar');
    const { ObjectId } = await import('mongodb');
    await t.db.collection('users').updateOne({ _id: new ObjectId(old.id) }, { $set: { 'yc.joinedAt': new Date(Date.now() - 30 * 86400_000) } });
    const code = (await t.http.get('/v1/rewards/referrals').set(sara.auth).expect(200)).body.code;
    await t.http.post('/v1/rewards/referrals/use').set(old.auth).send({ code }).expect(200);
    const r = (await t.http.get('/v1/rewards/referrals').set(sara.auth).expect(200)).body;
    expect(r.friends[0]).toMatchObject({ name: 'Omar', status: 'not_eligible' });
    expect((await points(t, sara)).pending).toBe(0);
  });
});

describe('Jack’s AI, the Jack bonus and pop-ups', () => {
  let t: TestApp; let sara: TUser; let amara: TUser; let family: string;
  beforeAll(async () => {
    t = await startApp(); sara = await makeUser(t, 'Sara'); amara = await makeUser(t, 'Amara');
    family = (await t.http.post('/v1/groups').set(sara.auth).send({ name: 'Family', memberIds: [amara.id] }).expect(200)).body.id;
  });
  afterAll(async () => { await t.close(); });

  it('pop-ups: check-in first, then the Jack bonus, then BTCY, each once a day', async () => {
    const one = (await t.http.get('/v1/rewards/popup').set(sara.auth).set(TZ).expect(200)).body as PopupNow;
    expect(one.kind).toBe('checkin');
    const two = (await t.http.get('/v1/rewards/popup').set(sara.auth).set(TZ).expect(200)).body as PopupNow;
    expect(two).toMatchObject({ kind: 'bonus', bonus: { id: 'jack-daily', points: 50, allRequired: true } });
    const three = (await t.http.get('/v1/rewards/popup').set(sara.auth).set(TZ).expect(200)).body as PopupNow;
    expect(three).toMatchObject({ kind: 'bonus', bonus: { id: 'btcy-weekly', points: 100, needsLink: true } });
    expect((await t.http.get('/v1/rewards/popup').set(sara.auth).set(TZ).expect(200)).body.kind).toBe('none');
    // "Don't show this on web" turns the check-in pop-up off for good.
    await t.http.post('/v1/rewards/popup/dismiss').set(amara.auth).set(TZ).send({ popup: 'checkin', forever: true }).expect(204);
    await t.redis.flushdb();
    await t.db.collection('yc_popups').deleteMany({});
    expect((await t.http.get('/v1/rewards/popup').set(amara.auth).set(TZ).expect(200)).body).toMatchObject({ kind: 'bonus', bonus: { id: 'jack-daily' } });
  });

  it('answers questions, keeps the conversation, and writes documents with versions', async () => {
    const a = (await t.http.post('/v1/ai/chats').set(sara.auth).send({ text: 'Give me 3 post ideas for BTCY Traders' }).expect(200)).body as AiReply;
    expect(a.assistant.text).toContain('demo mode');
    expect(a.quota).toMatchObject({ used: 1, limit: 30 });
    await t.http.post(`/v1/ai/chats/${a.chat.id}/messages`).set(sara.auth).send({ text: 'Make it shorter' }).expect(200);
    const d1 = (await t.http.post('/v1/ai/chats').set(sara.auth).send({ text: 'Write a sponsorship proposal for Lahore Runners', mode: 'document' }).expect(200)).body as AiReply;
    expect(d1.assistant.document).toMatchObject({ version: 1 });
    expect(d1.assistant.document!.markdown).toMatch(/^# /);
    const d2 = (await t.http.post(`/v1/ai/chats/${d1.chat.id}/messages`).set(sara.auth).send({ text: 'Add our Instagram handle', mode: 'document' }).expect(200)).body as AiReply;
    expect(d2.assistant.document!.version).toBe(2);
    expect((await t.http.get(`/v1/ai/chats/${d1.chat.id}`).set(sara.auth).expect(200)).body.document.version).toBe(2);
    await t.http.patch(`/v1/ai/chats/${a.chat.id}`).set(sara.auth).send({ saved: true }).expect(200);
    const list = (await t.http.get('/v1/ai/chats').set(sara.auth).expect(200)).body;
    expect(list).toHaveLength(2);
    expect((await t.http.get(`/v1/ai/chats/${a.chat.id}`).set(amara.auth)).status).toBe(404);
  });

  it('summarising a chat needs consent; then the Jack bonus pays 50 when all 3 tasks are done', async () => {
    await say(t, amara, family, 2);
    expect((await t.http.post('/v1/ai/summarize').set(sara.auth).send({ conversationId: family })).status).toBe(403);
    await t.http.put(`/v1/ai/consent/${family}`).set(sara.auth).expect(200);
    const s = (await t.http.post('/v1/ai/summarize').set(sara.auth).send({ conversationId: family }).expect(200)).body;
    expect(s.count).toBe(2);
    await say(t, sara, family, 10);
    const b = await until(async () => ((await t.http.get('/v1/rewards/bonuses').set(sara.auth).set(TZ).expect(200)).body as BonusCampaign[])[0]!, (x) => x.complete);
    expect(b).toMatchObject({ id: 'jack-daily', complete: true, paid: 50 });
    expect(b.tasks.map((x) => x.completed)).toEqual([true, true, true]);
    const h = (await t.http.get('/v1/rewards/history').set(sara.auth).expect(200)).body.items.map((i: { title: string }) => i.title);
    expect(h).toEqual(expect.arrayContaining(['Jack’s AI bonus', 'Ask Jack’s AI a question', 'Send 10 messages']));
  });

  it('30 messages a day, then 50 points buys 10 more', async () => {
    const q = (await t.http.get('/v1/ai/quota').set(sara.auth).expect(200)).body;
    const day = q.resetsAt; expect(day).toBeTruthy();
    const keys = await t.redis.keys(`ai:q:${sara.id}:*`);
    await t.redis.set(keys[0]!, '30');
    const full = await t.http.post('/v1/ai/chats').set(sara.auth).send({ text: 'one more' });
    expect(full.status).toBe(409);
    expect(full.body.error.message).toContain('50 INEX');
    const bal = (await points(t, sara)).balance;
    const after = (await t.http.post('/v1/ai/quota/extra').set(sara.auth).expect(200)).body;
    expect(after).toMatchObject({ used: 30, limit: 40 });
    expect((await points(t, sara)).balance).toBe(bal - 50);
    await t.http.post('/v1/ai/chats').set(sara.auth).send({ text: 'one more' }).expect(200);
    await t.db.collection('yc_points').updateOne({ _id: (await import('mongodb')).ObjectId.createFromHexString(amara.id) as never }, { $set: { balance: 10 } }, { upsert: true });
    expect((await t.http.post('/v1/ai/quota/extra').set(amara.auth)).status).toBe(400);
  });

  it('the website box answers without an account and takes leads', async () => {
    const r = (await t.http.post('/v1/site/ask').send({ messages: [{ role: 'user', text: 'How do I earn points?' }] }).expect(200)).body;
    expect(r.text).toBeTruthy();
    expect((await t.http.post('/v1/site/leads').send({ name: 'Daniel', email: 'daniel@brooks', consent: true })).status).toBe(400);
    expect((await t.http.post('/v1/site/leads').send({ name: 'Daniel', email: 'daniel@brooks.com', consent: false })).status).toBe(400);
    await t.http.post('/v1/site/leads').send({ name: 'Daniel', email: 'daniel@brooks.com', consent: true, question: 'Business plans?' }).expect(204);
    expect(await t.db.collection('yc_leads').countDocuments({ email: 'daniel@brooks.com' })).toBe(1);
  });

  it('support: an AI answer first, then a ticket in the Support chat', async () => {
    const a = (await t.http.post('/v1/support/ask').set(sara.auth).send({ question: 'My check-in didn’t add points' }).expect(200)).body;
    expect(a.ai).toBe(true);
    const tk = (await t.http.post('/v1/support/tickets').set(sara.auth).send({ question: 'My check-in didn’t add points', answer: a.answer }).expect(200)).body;
    expect(tk.number).toMatch(/^YS-\d{5}$/);
    const msgs = (await t.http.get(`/v1/conversations/${tk.conversationId}/messages`).set(sara.auth).expect(200)).body.items as ChatMessage[];
    expect(msgs.map((m) => m.text).join('\n')).toContain(`Ticket #${tk.number} created`);
  });
});

describe('Indexx account, wallet and BTCY', () => {
  let t: TestApp; let sara: TUser; let amara: TUser; let lena: TUser; let conv: string;
  const { ObjectId } = require('mongodb') as typeof import('mongodb');
  beforeAll(async () => {
    t = await startApp(); sara = await makeUser(t, 'Sara'); amara = await makeUser(t, 'Amara'); lena = await makeUser(t, 'Lena');
    conv = await direct(t, sara, amara);
  });
  afterAll(async () => { await t.close(); });

  const stub = () => t.db.collection('yc_indexx_stub');
  const signIn = (u: TUser, email: string, password = 'secret-pass') => t.http.post('/v1/indexx/sign-in').set(u.auth).send({ email, password });

  it('signs in to Indexx with email and password; keeps only the token, encrypted; one YaysApp account per Indexx account', async () => {
    expect((await t.http.get('/v1/indexx').set(sara.auth).expect(200)).body).toMatchObject({ linked: false, available: true });
    expect((await t.http.get('/v1/explore').set(sara.auth).expect(200)).body).toMatchObject({ linked: false, btcy: null, links: { btcy: 'https://bitcoinyay.com', rehuman: 'https://rehumansystem.com' } });
    expect((await t.http.get('/v1/wallet').set(sara.auth).expect(200)).body).toEqual({ linked: false, inex: null, nuggets: null, usdxx: null, exchange: null });
    expect((await t.http.get('/v1/wallet/withdraw/quote').set(sara.auth)).body.error.code).toBe('indexx_sign_in');
    expect((await signIn(sara, 'nope')).status).toBe(400);
    const wrong = await signIn(sara, 'sara@indexx.io', 'wrong-password');
    expect(wrong.status).toBe(400);
    expect(wrong.body.error.message).toBe('Indexx said: Invalid email or password');
    expect((await signIn(sara, 'Sara@Indexx.io').expect(200)).body).toMatchObject({ linked: true, email: 'sara@indexx.io' });
    const kept = (await t.db.collection('users').findOne({ _id: new ObjectId(sara.id) }))!.yc.indexx;
    expect(kept).toMatchObject({ email: 'sara@indexx.io', token: expect.any(String) });
    expect(JSON.stringify(kept)).not.toContain('secret-pass');
    expect(kept.token.split('.')).toHaveLength(3);
    expect(Buffer.from(kept.token.split('.')[2], 'base64url').toString()).not.toContain('sara@indexx.io'); // not readable
    expect((await signIn(lena, 'sara@indexx.io')).status).toBe(409);
    await signIn(amara, 'amara@indexx.io').expect(200);
  });

  it('Explore: every product in one call, as Indexx sends it; a product Indexx can’t read is null, the rest still load', async () => {
    const e = (await t.http.get('/v1/explore').set(sara.auth).expect(200)).body as ExploreView;
    expect(e.linked).toBe(true);
    expect(e.btcy).toMatchObject({ mining: { plan: 'Free', streakDays: 2, bestStreakDays: null }, team: { members: 4, miningNow: 2 }, boost: { percent: 10 }, portfolio: { nuggets: 10, tokens: 1240 } });
    expect(e.btcy!.last7Days.days).toHaveLength(7);
    expect(e.btcy!.last7Days.days[6]!.label).toBe('Today');
    expect(e.emmm).toMatchObject({ openPositions: 1, settledThisMonth: { count: 1, payoutUsd: 14.5 } });
    expect(e.emmm!.markets.map((m) => m.status)).toEqual(['open', 'won']);
    expect(e.shoperpal).toMatchObject({ role: 'buyer', supplier: null, buyer: { orderCount: 2 } });
    expect(e.wallstreet).toMatchObject({ holdings: { count: 1 }, listings: { count: 0 } });
    await stub().updateOne({ _id: 'sara@indexx.io' as never }, { $set: { down: ['emmm'] } });
    const d = (await t.http.get('/v1/explore').set(sara.auth).expect(200)).body as ExploreView;
    expect(d.emmm).toBeNull();
    expect(d.btcy).not.toBeNull();
    expect((await t.http.get('/v1/explore/emmm').set(sara.auth).expect(200)).body).toMatchObject({ linked: true, data: null });
    expect((await t.http.get('/v1/explore/wallstreet').set(sara.auth).expect(200)).body.data.holdings.items[0]).toMatchObject({ tokenSymbol: 'ACME' });
    expect((await t.http.get('/v1/explore/nothing').set(sara.auth)).status).toBe(404);
    await stub().updateOne({ _id: 'sara@indexx.io' as never }, { $set: { down: [] } });
  });

  it('wallet: the four cards; withdraw checks limits, pays once per key, and the INEX moves to the exchange', async () => {
    const w = (await t.http.get('/v1/wallet').set(sara.auth).expect(200)).body as WalletView;
    expect(w).toMatchObject({ linked: true, inex: { balance: 60 }, nuggets: { balance: 10 }, usdxx: { usd: 47.5 }, exchange: { totalUsd: 1.73, partial: true } });
    expect(w.exchange!.assets.map((a) => a.symbol)).toEqual(['INEX', 'XYZ']);
    const q = async (n: number) => (await t.http.get(`/v1/wallet/withdraw/quote?amount=${n}`).set(sara.auth).expect(200)).body as WithdrawQuote;
    expect(await q(0)).toMatchObject({ eligible: false, reason: 'Enter how much INEX to withdraw.', minimum: 25, dailyMax: 5000, balance: 60 });
    expect((await q(10)).reason).toBe('The minimum withdrawal is 25 INEX.');
    expect((await q(1000)).reason).toBe('You have 60 INEX.');
    expect(await q(25)).toMatchObject({ eligible: true, reason: null });
    const key = cid();
    const send = (amount: number, k = key) => t.http.post('/v1/wallet/withdraw').set(sara.auth).send({ amount, idempotencyKey: k });
    expect((await send(10)).body.error.message).toBe('The minimum withdrawal is 25 INEX.');
    expect((await send(2.5)).status).toBe(400);
    const r = (await send(25).expect(200)).body as Withdrawal;
    expect(r).toMatchObject({ status: 'completed', amount: 25, balance: 35, network: 'BSC', duplicate: false });
    expect((await send(25).expect(200)).body).toMatchObject({ id: r.id, duplicate: true }); // same key: paid once
    const after = (await t.http.get('/v1/wallet').set(sara.auth).expect(200)).body as WalletView;
    expect(after.inex!.balance).toBe(35);
    expect(after.exchange!.assets.find((a) => a.symbol === 'INEX')!.balance).toBe(25.33);
    // The exchange can't take it: nothing spent, and it shows as failed.
    await stub().updateOne({ _id: 'sara@indexx.io' as never }, { $set: { failNext: 'unavailable' } });
    const down = await send(25, cid());
    expect(down.status).toBe(503);
    expect(down.body.error.message).toContain('balance is unchanged');
    await stub().updateOne({ _id: 'sara@indexx.io' as never }, { $set: { failNext: 'in_progress' } });
    expect((await send(25, cid())).status).toBe(409);
    const h = (await t.http.get('/v1/wallet/withdrawals').set(sara.auth).expect(200)).body as WithdrawalsPage;
    expect(h.items.map((x) => x.status)).toEqual(['failed', 'completed']);
    expect(h.hasMore).toBe(false);
  });

  it('when Indexx stops accepting the token, YaysApp drops it and asks to sign in again', async () => {
    await stub().updateOne({ _id: 'amara@indexx.io' as never }, { $set: { revokedBefore: new Date(Date.now() + 60_000) } });
    expect((await t.http.get('/v1/explore').set(amara.auth).expect(200)).body.linked).toBe(false);
    expect((await t.http.get('/v1/indexx').set(amara.auth).expect(200)).body).toMatchObject({ linked: false, email: 'amara@indexx.io' });
    expect((await t.http.post('/v1/wallet/withdraw').set(amara.auth).send({ amount: 25, idempotencyKey: cid() })).body.error.code).toBe('indexx_sign_in');
    await stub().updateOne({ _id: 'amara@indexx.io' as never }, { $set: { revokedBefore: null } });
    await signIn(amara, 'amara@indexx.io').expect(200);
    expect((await t.http.get('/v1/wallet').set(amara.auth).expect(200)).body.linked).toBe(true);
    expect((await t.http.delete('/v1/indexx/link').set(amara.auth).expect(200)).body).toMatchObject({ linked: false, email: null });
  });

  it('BTCY bonus: the mining streak and friends who joined the team this week count; paid once', async () => {
    const before = (await points(t, sara)).balance;
    let b = ((await t.http.get('/v1/rewards/bonuses').set(sara.auth).set(TZ).expect(200)).body as BonusCampaign[]).find((x) => x.id === 'btcy-weekly')!;
    expect(b).toMatchObject({ needsLink: false, paid: 0 });
    expect(b.tasks.map((x) => x.done)).toEqual([0, 2, 0]);
    await stub().updateOne({ _id: 'sara@indexx.io' as never }, { $set: { 'btcy.members': 14, 'btcy.streakDays': 8 } });
    b = ((await t.http.get('/v1/rewards/bonuses').set(sara.auth).set(TZ).expect(200)).body as BonusCampaign[]).find((x) => x.id === 'btcy-weekly')!;
    expect(b.tasks.map((x) => x.done)).toEqual([10, 7, 0]);
    expect(b).toMatchObject({ paid: 70, complete: false });
    await t.http.get('/v1/rewards/bonuses').set(sara.auth).set(TZ).expect(200);
    expect((await points(t, sara)).balance).toBe(before + 70);
  });

  it('old routes are gone: pay in chat, convert to Nuggets, activity, start mining', async () => {
    for (const [method, path] of [['put', '/v1/pay/pin'], ['post', '/v1/pay/send'], ['post', '/v1/wallet/convert'], ['get', '/v1/wallet/activity'], ['post', '/v1/btcy/mine'], ['get', '/v1/products'], ['post', '/v1/indexx/link']] as const) {
      expect((await t.http[method](path).set(sara.auth).send({ conversationId: conv, points: 500, email: 'x@y.io' })).status).toBe(404);
    }
  });

  it('socials: shown to others unless hidden', async () => {
    await t.http.put('/v1/me/socials/instagram').set(sara.auth).send({ handle: 'sara.creates' }).expect(200);
    expect((await t.http.put('/v1/me/socials/x').set(sara.auth).send({ handle: 'bad handle!' })).status).toBe(400);
    expect((await t.http.get(`/v1/users/${sara.id}/socials`).set(amara.auth).expect(200)).body.links).toEqual([{ network: 'instagram', handle: '@sara.creates', url: 'https://instagram.com/sara.creates', verified: false }]);
    await t.http.put('/v1/me/socials').set(sara.auth).send({ visibility: 'nobody' }).expect(200);
    expect((await t.http.get(`/v1/users/${sara.id}/socials`).set(amara.auth).expect(200)).body.links).toEqual([]);
  });
});

describe('Anthropic provider', () => {
  it('sends the conversation and turns web citations into numbered sources', async () => {
    const { AnthropicProvider } = await import('../src/ai/ai.provider');
    let sent: { url: string; body: Record<string, unknown>; headers: Record<string, string> } | null = null;
    const fake = (async (url: string, init: { body: string; headers: Record<string, string> }) => {
      sent = { url, body: JSON.parse(init.body), headers: init.headers };
      return new Response(JSON.stringify({ content: [
        { type: 'server_tool_use' },
        { type: 'text', text: 'Early morning is coolest.', citations: [{ url: 'https://weather.example.com/lahore', title: 'Lahore hourly', cited_text: 'Coolest 6–8 am' }] },
        { type: 'text', text: ' Avoid evenings.', citations: [{ url: 'https://air.example.org/x', title: 'Air quality', cited_text: 'Rises after 6 pm' }, { url: 'https://weather.example.com/lahore', title: 'Lahore hourly', cited_text: '' }] },
      ] }), { status: 200 });
    }) as unknown as typeof fetch;
    const p = new AnthropicProvider({ ANTHROPIC_API_KEY: 'k', AI_MODEL: 'claude-sonnet-5-5' } as never, { warn() {} } as never, fake);
    const r = await p.complete({ system: 'sys', turns: [{ role: 'user', text: 'Best time to run?' }], search: true });
    expect(sent!.url).toBe('https://api.anthropic.com/v1/messages');
    expect(sent!.headers['x-api-key']).toBe('k');
    expect(sent!.body).toMatchObject({ model: 'claude-sonnet-5-5', system: 'sys', messages: [{ role: 'user', content: 'Best time to run?' }], tools: [{ name: 'web_search' }] });
    expect(r.text).toBe('Early morning is coolest.[1] Avoid evenings.[2][1]');
    expect(r.sources.map((s) => `${s.n} ${s.domain}`)).toEqual(['1 weather.example.com', '2 air.example.org']);
  });
});

describe('Facebook: link, sign in, show on profile', () => {
  let t: TestApp; let sara: TUser; let amara: TUser;
  const WEB = 'http://web.test';
  beforeAll(async () => { t = await startApp({ WEB_URL: WEB }); sara = await makeUser(t, 'Sara'); amara = await makeUser(t, 'Amara'); });
  afterAll(async () => { await t.close(); });
  /** Plays Facebook: follows the start URL to the stand-in page, then "Continue" as `name`. Returns where the browser lands. */
  async function viaFacebook(url: string, name: string | null) {
    const u = new URL(url);
    expect(u.pathname).toBe('/v1/oauth/facebook/dev');
    const page = await t.http.get(u.pathname + u.search).expect(200);
    expect(page.text).toContain('Development stand-in');
    const state = u.searchParams.get('state')!;
    const r = await t.http.get('/v1/oauth/facebook/callback').query(name === null ? { state, error: 'access_denied' } : { state, dev_name: name }).expect(302);
    return r.headers.location as string;
  }
  const device = { deviceId: 'web-fb-device-1234', platform: 'web', name: 'Chrome' };

  it('links Facebook through Facebook’s page, once per Facebook account', async () => {
    const start = (await t.http.post('/v1/me/socials/facebook/start').set(sara.auth).send({ login: true }).expect(200)).body;
    expect(await viaFacebook(start.url, 'Sara Ahmed')).toBe(`${WEB}/settings/socials?fb=linked`);
    const me = (await t.http.get('/v1/me/socials').set(sara.auth).expect(200)).body;
    expect(me.facebook).toMatchObject({ name: 'Sara Ahmed', login: true });
    expect(me.links[0]).toEqual({ network: 'facebook', handle: 'Sara Ahmed', url: null, verified: true });
    // Amara sees it on Sara's profile, marked verified.
    expect((await t.http.get(`/v1/users/${sara.id}/socials`).set(amara.auth).expect(200)).body.links[0]).toMatchObject({ network: 'facebook', verified: true });
    // The same Facebook can't be linked to a second account; cancelling changes nothing.
    const again = (await t.http.post('/v1/me/socials/facebook/start').set(amara.auth).send({ login: true }).expect(200)).body;
    expect(await viaFacebook(again.url, 'Sara Ahmed')).toBe(`${WEB}/settings/socials?fb=taken`);
    const cancel = (await t.http.post('/v1/me/socials/facebook/start').set(amara.auth).send({ login: false }).expect(200)).body;
    expect(await viaFacebook(cancel.url, null)).toBe(`${WEB}/settings/socials?fb=cancelled`);
    expect((await t.http.get('/v1/me/socials').set(amara.auth).expect(200)).body.facebook).toBeNull();
    // A used or made-up state goes nowhere.
    expect((await t.http.get('/v1/oauth/facebook/callback').query({ state: 'nope', dev_name: 'X' }).expect(302)).headers.location).toBe(`${WEB}/sign-in?fb=expired`);
  });

  it('started in the phone app, Facebook comes back to the app (yaysapp://), not the web', async () => {
    const phone = { deviceId: 'ios-fb-device-1234', platform: 'ios', name: 'iPhone' };
    const s = (await t.http.post('/v1/auth/facebook/start').send({ device: phone, returnTo: 'app' }).expect(200)).body;
    const back = await viaFacebook(s.url, 'Sara Ahmed');
    expect(back.startsWith('yaysapp://auth/facebook?fb_ticket=')).toBe(true);
    const r = (await t.http.post('/v1/auth/facebook/finish').send({ ticket: new URL(back).searchParams.get('fb_ticket') }).expect(200)).body;
    expect(r.me.id).toBe(sara.id);
    const sessions = (await t.http.get('/v1/me/devices').set({ authorization: `Bearer ${r.tokens.accessToken}` }).expect(200)).body;
    expect(sessions.find((x: { current: boolean }) => x.current)).toMatchObject({ platform: 'ios' });
    const s2 = (await t.http.post('/v1/auth/facebook/start').send({ device: phone, returnTo: 'app' }).expect(200)).body;
    expect(await viaFacebook(s2.url, 'Someone New')).toBe('yaysapp://auth/facebook?fb=not_linked&fb_name=Someone%20New');
    const s3 = (await t.http.post('/v1/auth/facebook/start').send({ device: phone, returnTo: 'app' }).expect(200)).body;
    expect(await viaFacebook(s3.url, null)).toBe('yaysapp://auth/facebook?fb=cancelled');
    expect((await t.http.post('/v1/auth/facebook/start').send({ device: phone, returnTo: 'elsewhere' })).status).toBe(400);
    // Linking from the phone's settings comes back to the app too.
    const l = (await t.http.post('/v1/me/socials/facebook/start').set(amara.auth).send({ login: false, returnTo: 'app' }).expect(200)).body;
    expect(await viaFacebook(l.url, null)).toBe('yaysapp://settings/facebook?fb=cancelled');
  });

  it('signs in with a linked Facebook, with the PIN when two-step is on', async () => {
    const s = (await t.http.post('/v1/auth/facebook/start').send({ device }).expect(200)).body;
    const back = await viaFacebook(s.url, 'Sara Ahmed');
    const ticket = new URL(back).searchParams.get('fb_ticket')!;
    expect(back.startsWith(`${WEB}/sign-in?fb_ticket=`)).toBe(true);
    const r = (await t.http.post('/v1/auth/facebook/finish').send({ ticket }).expect(200)).body;
    expect(r.me.id).toBe(sara.id);
    expect(r.tokens.accessToken).toBeTruthy();
    expect((await t.http.post('/v1/auth/facebook/finish').send({ ticket })).status).toBe(401); // one use
    await t.http.put('/v1/me/two-step').set(sara.auth).send({ pin: '482916' }).expect(200);
    const s2 = (await t.http.post('/v1/auth/facebook/start').send({ device }).expect(200)).body;
    const t2 = new URL(await viaFacebook(s2.url, 'Sara Ahmed')).searchParams.get('fb_ticket')!;
    expect((await t.http.post('/v1/auth/facebook/finish').send({ ticket: t2 }).expect(200)).body).toMatchObject({ status: 'pin_required', via: 'facebook' });
  });

  it('a Facebook that isn’t linked, or has sign-in turned off, doesn’t sign in', async () => {
    const s = (await t.http.post('/v1/auth/facebook/start').send({ device }).expect(200)).body;
    expect(await viaFacebook(s.url, 'Someone New')).toBe(`${WEB}/sign-in?fb=not_linked&fb_name=Someone%20New`);
    expect((await t.http.put('/v1/me/socials/facebook/login').set(sara.auth).send({ on: false }).expect(200)).body.facebook.login).toBe(false);
    const s2 = (await t.http.post('/v1/auth/facebook/start').send({ device }).expect(200)).body;
    expect((await viaFacebook(s2.url, 'Sara Ahmed')).includes('fb=not_linked')).toBe(true);
    expect((await t.http.put('/v1/me/socials/facebook/login').set(amara.auth).send({ on: true })).status).toBe(400);
    expect((await t.http.delete('/v1/me/socials/facebook').set(sara.auth).expect(200)).body.facebook).toBeNull();
    expect((await t.http.get(`/v1/users/${sara.id}/socials`).set(amara.auth).expect(200)).body.links).toEqual([]);
  });
});

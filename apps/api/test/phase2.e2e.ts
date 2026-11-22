import type { AiReply, BonusCampaign, EarnToday, Perk, CheckinStatus, ChatMessage, ExploreView, PointsSummary, PopupNow, WalletView, Withdrawal, WithdrawalsPage, WithdrawQuote } from '@yays/shared';
import { startApp, type TestApp } from './helpers';
import { cid, makeUser, sleep, type TUser } from './chat-helpers';

const TZ = { 'x-time-zone': 'Asia/Karachi' };
const dayIn = (tz: string, offsetDays = 0) => new Date(Date.now() + offsetDays * 86400_000).toLocaleDateString('en-CA', { timeZone: tz });
const resetLimits = async (t: TestApp) => { const k = await t.redis.keys('rl:*'); if (k.length) await t.redis.del(...k); };

async function direct(t: TestApp, a: TUser, b: TUser) { return (await t.http.post('/v1/conversations/direct').set(a.auth).send({ userId: b.id }).expect(200)).body.id as string; }
async function say(t: TestApp, u: TUser, conv: string, n = 1, text?: (i: number) => string) {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) ids.push((await t.http.post(`/v1/conversations/${conv}/messages`).set(u.auth).send({ clientId: cid(), text: text ? text(i) : `hi there ${cid().slice(0, 8)}` }).expect(200)).body.message.id);
  return ids;
}
/** Replies only count from accounts with a verified number that are 3+ days old. */
async function ageUser(t: TestApp, u: TUser, days = 5) {
  const { ObjectId } = await import('mongodb');
  await t.db.collection('users').updateOne({ _id: new ObjectId(u.id) }, { $set: { 'yc.joinedAt': new Date(Date.now() - days * 86400_000) } });
}
async function today(t: TestApp, u: TUser) { return (await t.http.get('/v1/rewards/today').set(u.auth).set(TZ).expect(200)).body as EarnToday; }
/** A conversation for `me`: 3 counting messages from me, a reply from `them`. */
async function converse(t: TestApp, me: TUser, them: TUser) { const c = await direct(t, me, them); await say(t, me, c, 3); await say(t, them, c, 1); return c; }
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

  it('everyday points stop at the daily cap', async () => {
    const { ObjectId } = await import('mongodb');
    const day = dayIn('Asia/Karachi');
    await t.db.collection('yc_points_ledger').insertOne({ _id: new ObjectId(), userId: new ObjectId(amara.id), key: 'seed', kind: 'activity', title: 'x', sub: '', amount: 190, status: 'done', at: new Date(), day, week: 'x', capped: true }); // plus today's check-in (+20): 210 > 200
    await t.db.collection('yc_points').updateOne({ _id: new ObjectId(amara.id) as never }, { $inc: { balance: 190 } });
    await t.http.post('/v1/ai/chats').set(amara.auth).send({ text: 'What can I earn today?' }).expect(200);
    const p = await until(() => points(t, amara), (x) => x.capUsed >= 210);
    expect(p.capUsed).toBe(210); // "Ask Jack's AI" (+5) was not paid over the cap
    expect((await today(t, amara)).tasks.find((x) => x.id === 'ask_jack')).toMatchObject({ completed: true });
    expect(p.balance).toBe(210);
  });
});

describe('Chat to Earn', () => {
  let t: TestApp; let sara: TUser; let f: TUser[]; let fresh: TUser;
  beforeAll(async () => {
    t = await startApp(); sara = await makeUser(t, 'Sara'); fresh = await makeUser(t, 'Nadia');
    f = [await makeUser(t, 'Amara'), await makeUser(t, 'Bilal'), await makeUser(t, 'Hina')];
    for (const u of f) await ageUser(t, u);
  });
  afterAll(async () => { await t.close(); });
  const settle = (b: Record<string, unknown> = {}) => t.http.post('/v1/_test/chat-earn/settle').send(b).expect(200);

  it('short or repeated messages and replies from brand-new accounts don’t count', async () => {
    const c0 = await direct(t, sara, fresh);
    await say(t, sara, c0, 3); await say(t, fresh, c0, 2);
    const c1 = await direct(t, sara, f[0]!);
    await say(t, sara, c1, 3, () => 'ok'); // one word
    await say(t, sara, c1, 3, () => 'same text again'); // repeats: only the first counts
    await say(t, f[0]!, c1, 1);
    await sleep(300);
    const d = await today(t, sara);
    expect(d.chat).toMatchObject({ conversations: 0, newConnections: 0, newConnectionsMax: 3 });
    expect(d.chat.tiers.map((x) => x.reached)).toEqual([false, false, false]);
  });

  it('3 conversations: Tier 1 is 10 BTCY pending until the day is checked, and fills the Jack task', async () => {
    for (const u of f) await converse(t, sara, u);
    const d = await until(() => today(t, sara), (x) => x.chat.conversations >= 3);
    expect(d.chat.conversations).toBe(3);
    expect(d.chat.tiers[0]).toMatchObject({ of: 3, reached: true, reward: '10 BTCY' });
    const p = await until(() => points(t, sara), (x) => x.pending >= 10);
    expect(p).toMatchObject({ pending: 10, balance: 0 });
    expect((await today(t, sara)).chat.week.days.filter((x) => x === 'met')).toHaveLength(1);
    const b = ((await t.http.get('/v1/rewards/bonuses').set(sara.auth).set(TZ).expect(200)).body as BonusCampaign[]).find((x) => x.id === 'jack-daily')!;
    expect(b.tasks.find((x) => x.title === 'Have 3 conversations today')).toMatchObject({ completed: true });
    // Each friend also had a conversation? No: they sent one message each, not 3.
    expect((await today(t, f[0]!)).chat.conversations).toBe(0);
    // Not yet due: nothing settles today.
    await t.http.post('/v1/_test/chat-earn/settle').send({ hours: 0 }).expect(200);
    expect((await points(t, sara)).pending).toBe(10);
    await settle();
    expect(await points(t, sara)).toMatchObject({ pending: 0, balance: 10 });
    const h = (await t.http.get('/v1/rewards/history?filter=earned').set(sara.auth).expect(200)).body.items;
    expect(h[0]).toMatchObject({ title: 'Chat to Earn · Tier 1', sub: '3 conversations', amount: 10 });
  });

  it('Tier 1 on 5 days of a week: a chat week pays 50 BTCY and a Turbo mining day', async () => {
    const { ObjectId } = await import('mongodb');
    const me = new ObjectId(sara.id);
    const t1 = (await t.db.collection('yc_points_ledger').findOne({ userId: me, key: { $regex: '^chat:t1:' } }))!;
    // Four earlier days this week already met (seeded), and a fifth waiting to be checked.
    await t.db.collection('yc_points_ledger').insertMany(['a', 'b', 'c', 'd'].map((x) => ({ _id: new ObjectId(), userId: me, key: `chat:t1:seed-${x}`, kind: 'chat', title: 'Chat to Earn · Tier 1', sub: '', amount: 0, status: 'done', at: new Date(), day: `seed-${x}`, week: t1.week })));
    await t.db.collection('yc_points_ledger').updateOne({ _id: t1._id }, { $set: { status: 'pending', settleAt: new Date() } });
    await t.db.collection('yc_points').updateOne({ _id: me as never }, { $inc: { balance: -10, pending: 10 } });
    await settle();
    const h = (await t.http.get('/v1/rewards/history?filter=earned').set(sara.auth).expect(200)).body.items;
    expect(h[0]).toMatchObject({ title: 'Chat week complete', amount: 50 });
    expect((await points(t, sara)).balance).toBe(60);
    const perks = (await t.http.get('/v1/rewards/perks').set(sara.auth).expect(200)).body as Perk[];
    expect(perks).toEqual([expect.objectContaining({ kind: 'turbo_day', status: 'ready', product: 'btcy' })]);
    await settle(); // once only
    expect((await points(t, sara)).balance).toBe(60);
  });

  it('a message deleted for everyone stops counting; the reward is reversed when the day is checked', async () => {
    const omar = await makeUser(t, 'Omar'), [x, y, z] = [await makeUser(t, 'Xena'), await makeUser(t, 'Yusuf'), await makeUser(t, 'Zara')];
    for (const u of [x, y, z]) await ageUser(t, u);
    const c = await direct(t, omar, x); const mine = await say(t, omar, c, 3); await say(t, x, c, 1);
    await converse(t, omar, y); await converse(t, omar, z);
    await until(() => points(t, omar), (v) => v.pending >= 10);
    await t.http.delete(`/v1/conversations/${c}/messages/${mine[0]}`).query({ for: 'everyone' }).set(omar.auth).expect(200);
    const d = await until(() => today(t, omar), (v) => v.chat.conversations < 3);
    expect(d.chat.conversations).toBe(2);
    await settle();
    expect(await points(t, omar)).toMatchObject({ pending: 0, balance: 0 });
    const h = (await t.http.get('/v1/rewards/history').set(omar.auth).expect(200)).body.items;
    expect(h.find((i: { title: string }) => i.title === 'Chat to Earn · Tier 1')).toMatchObject({ status: 'reversed' });
  });

  it('messages typed faster than a person can don’t count', async () => {
    await settle({ hours: 0, typingCheck: true });
    try {
      const kim = await makeUser(t, 'Kim');
      const c = await direct(t, kim, f[1]!);
      await say(t, kim, c, 3); await say(t, f[1]!, c, 1);
      await sleep(300);
      expect((await today(t, kim)).chat.conversations).toBe(0); // back to back: only the first message counted
    } finally { await settle({ hours: 0, typingCheck: false }); }
  });

  it('a new connection pays 5 BTCY each once you have both replied on 2 different days', async () => {
    const { ObjectId } = await import('mongodb');
    const lena = await makeUser(t, 'Lena'), mo = await makeUser(t, 'Mo');
    for (const u of [lena, mo]) await ageUser(t, u);
    const c = await direct(t, lena, mo);
    await say(t, lena, c, 3); await say(t, mo, c, 3);
    await until(() => today(t, lena), (v) => v.chat.conversations >= 1);
    expect((await points(t, lena)).pending).toBe(0);
    // Move those messages to yesterday, then talk again today.
    const y = dayIn('Asia/Karachi', -1);
    await t.db.collection('yc_chat_events').updateMany({ convId: new ObjectId(c) }, { $set: { day: y, at: new Date(Date.now() - 86400_000) } });
    await say(t, lena, c, 3); await say(t, mo, c, 3);
    const p = await until(() => points(t, lena), (v) => v.pending >= 5);
    expect(p.pending).toBe(5);
    expect((await points(t, mo)).pending).toBe(5);
    const h = (await t.http.get('/v1/rewards/history').set(lena.auth).expect(200)).body.items.map((i: { title: string }) => i.title);
    expect(h).toContain('New connection: Mo');
    expect((await today(t, lena)).chat.newConnections).toBe(1);
  });

  it('perks start empty', async () => {
    expect((await t.http.get('/v1/rewards/perks').set(f[2]!.auth).expect(200)).body as Perk[]).toEqual([]);
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
  let t: TestApp; let sara: TUser; let amara: TUser; let omar: TUser; let hina: TUser; let family: string;
  beforeAll(async () => {
    t = await startApp(); sara = await makeUser(t, 'Sara'); amara = await makeUser(t, 'Amara'); omar = await makeUser(t, 'Omar'); hina = await makeUser(t, 'Hina');
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
    for (const u of [amara, omar, hina]) { await ageUser(t, u); await converse(t, sara, u); }
    const b = await until(async () => ((await t.http.get('/v1/rewards/bonuses').set(sara.auth).set(TZ).expect(200)).body as BonusCampaign[])[0]!, (x) => x.complete);
    expect(b).toMatchObject({ id: 'jack-daily', complete: true, paid: 50 });
    expect(b.tasks.map((x) => x.completed)).toEqual([true, true, true]);
    const h = (await t.http.get('/v1/rewards/history').set(sara.auth).expect(200)).body.items.map((i: { title: string }) => i.title);
    expect(h).toEqual(expect.arrayContaining(['Jack’s AI bonus', 'Ask Jack’s AI a question', 'Chat to Earn · Tier 1']));
  });

  it('30 messages a day, then 50 points buys 10 more', async () => {
    const q = (await t.http.get('/v1/ai/quota').set(sara.auth).expect(200)).body;
    const day = q.resetsAt; expect(day).toBeTruthy();
    const keys = await t.redis.keys(`ai:q:${sara.id}:*`);
    await t.redis.set(keys[0]!, '30');
    const full = await t.http.post('/v1/ai/chats').set(sara.auth).send({ text: 'one more' });
    expect(full.status).toBe(409);
    expect(full.body.error.message).toContain('50 BTCY');
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

  it('wallet: the four cards; withdraw checks limits, pays once per key, and the BTCY tokens go to the BTCY app', async () => {
    const w = (await t.http.get('/v1/wallet').set(sara.auth).expect(200)).body as WalletView;
    expect(w).toMatchObject({ linked: true, inex: { balance: 60 }, nuggets: { balance: 10 }, usdxx: { usd: 47.5 }, exchange: { totalUsd: 1.73, partial: true } });
    expect(w.exchange!.assets.map((a) => a.symbol)).toEqual(['INEX', 'XYZ']);
    const q = async (n: number) => (await t.http.get(`/v1/wallet/withdraw/quote?amount=${n}`).set(sara.auth).expect(200)).body as WithdrawQuote;
    expect(await q(0)).toMatchObject({ eligible: false, reason: 'Enter how many BTCY tokens to withdraw.', minimum: 25, dailyMax: 5000, balance: 60 });
    expect((await q(10)).reason).toBe('The minimum withdrawal is 25 BTCY.');
    expect((await q(1000)).reason).toBe('You have 60 BTCY.');
    expect(await q(25)).toMatchObject({ eligible: true, reason: null });
    const key = cid();
    const send = (amount: number, k = key) => t.http.post('/v1/wallet/withdraw').set(sara.auth).send({ amount, idempotencyKey: k });
    expect((await send(10)).body.error.message).toBe('The minimum withdrawal is 25 BTCY.');
    expect((await send(2.5)).status).toBe(400);
    const r = (await send(25).expect(200)).body as Withdrawal;
    expect(r).toMatchObject({ status: 'completed', amount: 25, balance: 35, network: null, duplicate: false });
    expect((await send(25).expect(200)).body).toMatchObject({ id: r.id, duplicate: true }); // same key: paid once
    const after = (await t.http.get('/v1/wallet').set(sara.auth).expect(200)).body as WalletView;
    expect(after.inex!.balance).toBe(35);
    expect(after.exchange!.assets.find((a) => a.symbol === 'INEX')!.balance).toBe(0.33); // the exchange holdings don't change
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

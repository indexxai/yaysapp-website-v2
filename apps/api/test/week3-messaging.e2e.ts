import { ObjectId } from 'mongodb';
import { tickFor, type ConversationSummary } from '@yays/shared';
import { bearer, device, signInEmail, startApp, type TestApp } from './helpers';
import { cid, connect, emit, makeUser, next, record, sleep, type TUser } from './chat-helpers';

const send = (t: TestApp, u: TUser, convId: string, text: string, clientId = cid()) => t.http.post(`/v1/conversations/${convId}/messages`).set(u.auth).send({ clientId, text });
const open = async (t: TestApp, a: TUser, b: TUser) => (await t.http.post('/v1/conversations/direct').set(a.auth).send({ userId: b.id }).expect(200)).body as ConversationSummary;
const conv = async (t: TestApp, u: TUser, id: string) => (await t.http.get(`/v1/conversations/${id}`).set(u.auth).expect(200)).body as ConversationSummary;

describe('Week 3 · finding people and starting chats', () => {
  let t: TestApp; let ali: TUser; let sara: TUser;
  beforeAll(async () => { t = await startApp(); ali = await makeUser(t, 'Ali'); sara = await makeUser(t, 'Sara'); });
  afterAll(async () => { await t.close(); });

  it('finds people by exact username, phone or email only', async () => {
    const me = (await t.http.get('/v1/me').set(sara.auth).expect(200)).body;
    for (const q of [`@${me.username}`, me.username, me.username.toUpperCase(), me.phone, me.phone.replace('+92', '0'), me.email.toUpperCase()]) {
      const r = await t.http.get('/v1/users/lookup').query({ q }).set(ali.auth);
      expect([q, r.status]).toEqual([q, 200]);
      expect(r.body).toMatchObject({ id: sara.id, displayName: 'Sara' });
      expect(r.body.phone).toBeUndefined(); // contact details are never shown to others
      expect(r.body.email).toBeUndefined();
    }
    expect((await t.http.get('/v1/users/lookup').query({ q: me.username.slice(0, 4) }).set(ali.auth)).status).toBe(404);
    expect((await t.http.get('/v1/users/lookup').query({ q: 'nobody_here_123' }).set(ali.auth)).status).toBe(404);
    expect((await t.http.get('/v1/users/lookup').query({ q: '' }).set(ali.auth)).status).toBe(400);
    expect((await t.http.get('/v1/users/lookup').query({ q: '!!' }).set(ali.auth)).status).toBe(400);
    const self = await t.http.get('/v1/users/lookup').query({ q: me.username }).set(sara.auth);
    expect(self.status).toBe(400);
    expect(self.body.error.message).toBe("That's you.");
    expect((await t.http.get('/v1/users/lookup').query({ q: 'x' })).status).toBe(401);
  });

  it('a pair has exactly one direct chat, whoever opens it and however many times at once', async () => {
    const results = await Promise.all([...Array(6)].map((_, i) => t.http.post('/v1/conversations/direct').set(i % 2 ? ali.auth : sara.auth).send({ userId: i % 2 ? sara.id : ali.id })));
    const ids = new Set(results.map((r) => { expect(r.status).toBe(200); return r.body.id; }));
    expect(ids.size).toBe(1);
    expect(await t.db.collection('yc_conversations').countDocuments({ kind: 'direct' })).toBe(1);
    const c = results[1].body as ConversationSummary;
    expect(c).toMatchObject({ kind: 'direct', lastSeq: 0, lastMessage: null, unread: 0 });
    expect(c.peer).toMatchObject({ id: sara.id, displayName: 'Sara' });
    expect(c.memberIds.sort()).toEqual([ali.id, sara.id].sort());
  });

  it('an empty chat stays out of the list until someone writes', async () => {
    const c = await open(t, ali, sara);
    expect((await t.http.get('/v1/conversations').set(ali.auth).expect(200)).body.items).toEqual([]);
    await send(t, ali, c.id, 'Salam').expect(200);
    const list = (await t.http.get('/v1/conversations').set(sara.auth).expect(200)).body;
    expect(list.items.map((x: ConversationSummary) => x.id)).toEqual([c.id]);
  });

  it('refuses chats with yourself, unknown people and bad ids', async () => {
    expect((await t.http.post('/v1/conversations/direct').set(ali.auth).send({ userId: ali.id })).status).toBe(400);
    expect((await t.http.post('/v1/conversations/direct').set(ali.auth).send({ userId: 'a'.repeat(24) })).status).toBe(404);
    expect((await t.http.post('/v1/conversations/direct').set(ali.auth).send({ userId: 'not-an-id' })).status).toBe(400);
    expect((await t.http.post('/v1/conversations/direct').set(ali.auth).send({})).status).toBe(400);
  });

  it("can't chat with a turned-off account", async () => {
    const gone = await makeUser(t, 'Gone');
    await t.db.collection('users').updateOne({ _id: new ObjectId(gone.id) }, { $set: { 'yc.disabledAt': new Date() } });
    expect((await t.http.post('/v1/conversations/direct').set(ali.auth).send({ userId: gone.id })).status).toBe(404);
  });
});

describe('Week 3 · sending', () => {
  let t: TestApp; let ali: TUser; let sara: TUser; let omar: TUser; let c: ConversationSummary;
  beforeAll(async () => { t = await startApp(); ali = await makeUser(t, 'Ali'); sara = await makeUser(t, 'Sara'); omar = await makeUser(t, 'Omar'); c = await open(t, ali, sara); });
  afterAll(async () => { await t.close(); });

  it('stores a message, numbers it and updates both chat lists', async () => {
    const r = await send(t, ali, c.id, '  Hello Sara 👋  ').expect(200);
    expect(r.body.duplicate).toBe(false);
    expect(r.body.message).toMatchObject({ conversationId: c.id, seq: 1, senderId: ali.id, type: 'text', text: 'Hello Sara 👋' });
    const mine = await conv(t, ali, c.id), hers = await conv(t, sara, c.id);
    expect(mine).toMatchObject({ lastSeq: 1, unread: 0, lastMessage: { id: r.body.message.id } });
    expect(hers).toMatchObject({ lastSeq: 1, unread: 1 });
    expect(tickFor(r.body.message, mine)).toBe('sent');
  });

  it('rejects empty, too long and badly formed messages', async () => {
    for (const text of ['', '   ', '\n\t ', '\u0000']) expect((await send(t, ali, c.id, text)).status).toBe(400);
    expect((await send(t, ali, c.id, 'a'.repeat(4097))).status).toBe(400);
    // 4,096 emoji are 4,096 characters, even though each is two code units.
    expect((await send(t, ali, c.id, '😀'.repeat(4096))).status).toBe(200);
    expect((await t.http.post(`/v1/conversations/${c.id}/messages`).set(ali.auth).send({ clientId: 'abc', text: 'hi' })).status).toBe(400);
    expect((await t.http.post(`/v1/conversations/${c.id}/messages`).set(ali.auth).send({ text: 'hi' })).status).toBe(400);
    expect((await t.http.post(`/v1/conversations/${c.id}/messages`).set(ali.auth).send({ clientId: cid(), text: 42 })).status).toBe(400);
  });

  it("outsiders can't read or write a chat, and can't tell it exists", async () => {
    for (const id of [c.id, 'f'.repeat(24), 'nope']) {
      expect((await send(t, omar, id, 'hi')).status).toBe(404);
      expect((await t.http.get(`/v1/conversations/${id}/messages`).set(omar.auth)).status).toBe(404);
      expect((await t.http.get(`/v1/conversations/${id}`).set(omar.auth)).status).toBe(404);
      expect((await t.http.post(`/v1/conversations/${id}/read`).set(omar.auth).send({ seq: 1 })).status).toBe(404);
    }
    expect((await t.http.get(`/v1/conversations/${c.id}/messages`)).status).toBe(401);
  });

  it('sending the same message again (same clientId) never makes a second copy', async () => {
    const clientId = cid();
    const first = (await send(t, ali, c.id, 'once', clientId).expect(200)).body;
    const again = (await send(t, ali, c.id, 'once', clientId).expect(200)).body;
    expect(again).toEqual({ message: first.message, duplicate: true });
    // Ten retries racing each other still store one message.
    const id2 = cid();
    const race = await Promise.all([...Array(10)].map(() => send(t, ali, c.id, 'race', id2)));
    expect(race.every((r) => r.status === 200)).toBe(true);
    expect(new Set(race.map((r) => r.body.message.id)).size).toBe(1);
    expect(race.filter((r) => !r.body.duplicate).length).toBe(1);
    expect(await t.db.collection('yc_messages').countDocuments({ clientId: id2 })).toBe(1);
  });

  it('a clientId reused in a different chat is refused', async () => {
    const other = await open(t, ali, omar);
    const clientId = cid();
    await send(t, ali, c.id, 'here', clientId).expect(200);
    const r = await send(t, ali, other.id, 'there', clientId);
    expect(r.status).toBe(409);
  });

  it('messages sent at the same moment from both sides get unique numbers with no gaps', async () => {
    const start = (await conv(t, ali, c.id)).lastSeq;
    const rs = await Promise.all([...Array(30)].map((_, i) => send(t, i % 2 ? ali : sara, c.id, `m${i}`)));
    expect(rs.every((r) => r.status === 200)).toBe(true);
    const seqs = rs.map((r) => r.body.message.seq).sort((a, b) => a - b);
    expect(seqs).toEqual([...Array(30)].map((_, i) => start + i + 1));
    const all = await t.db.collection('yc_messages').find({ convId: { $exists: true } }).sort({ seq: 1 }).project({ seq: 1, convId: 1 }).toArray();
    const forConv = all.filter((m) => m.convId.toHexString() === c.id).map((m) => m.seq);
    expect(forConv).toEqual([...Array(forConv.length)].map((_, i) => i + 1));
  });

  it('pages history backwards, and catches up forwards from a known point', async () => {
    const last = (await conv(t, ali, c.id)).lastSeq;
    const p1 = (await t.http.get(`/v1/conversations/${c.id}/messages`).query({ limit: 10 }).set(sara.auth).expect(200)).body;
    expect(p1.items.map((m: { seq: number }) => m.seq)).toEqual([...Array(10)].map((_, i) => last - 9 + i));
    expect(p1.hasMore).toBe(true);
    const p2 = (await t.http.get(`/v1/conversations/${c.id}/messages`).query({ limit: 10, before: p1.items[0].seq }).set(sara.auth).expect(200)).body;
    expect(p2.items[p2.items.length - 1].seq).toBe(p1.items[0].seq - 1);
    const after = (await t.http.get(`/v1/conversations/${c.id}/messages`).query({ after: last - 3 }).set(sara.auth).expect(200)).body;
    expect(after).toMatchObject({ hasMore: false });
    expect(after.items.map((m: { seq: number }) => m.seq)).toEqual([last - 2, last - 1, last]);
    const none = (await t.http.get(`/v1/conversations/${c.id}/messages`).query({ after: last }).set(sara.auth).expect(200)).body;
    expect(none.items).toEqual([]);
    const oldest = (await t.http.get(`/v1/conversations/${c.id}/messages`).query({ before: 1 }).set(sara.auth).expect(200)).body;
    expect(oldest).toEqual({ items: [], hasMore: false });
    for (const q of [{ limit: 0 }, { limit: 101 }, { before: -1 }, { after: 'x' }, { before: 5, after: 2 }]) {
      expect((await t.http.get(`/v1/conversations/${c.id}/messages`).query(q).set(sara.auth)).status).toBe(400);
    }
  });

  it('receipts move forward only, never past the last message, and reading clears unread', async () => {
    for (let i = 0; i < 6; i++) await send(t, ali, c.id, `unread ${i}`).expect(200);
    const last = (await conv(t, sara, c.id)).lastSeq;
    expect((await conv(t, sara, c.id)).unread).toBeGreaterThan(0);
    const d = (await t.http.post(`/v1/conversations/${c.id}/delivered`).set(sara.auth).send({ seq: last + 50 }).expect(200)).body;
    expect(d.deliveredSeq).toBe(last);
    const r1 = (await t.http.post(`/v1/conversations/${c.id}/read`).set(sara.auth).send({ seq: last - 5 }).expect(200)).body;
    expect(r1).toEqual({ readSeq: last - 5, deliveredSeq: last });
    const back = (await t.http.post(`/v1/conversations/${c.id}/read`).set(sara.auth).send({ seq: 1 }).expect(200)).body;
    expect(back.readSeq).toBe(last - 5);
    await t.http.post(`/v1/conversations/${c.id}/read`).set(sara.auth).send({ seq: last }).expect(200);
    const hers = await conv(t, sara, c.id);
    expect(hers.unread).toBe(0);
    const mine = await conv(t, ali, c.id);
    expect(mine.receipts[sara.id]).toEqual({ readSeq: last, deliveredSeq: last });
    expect(tickFor({ seq: last, senderId: ali.id }, mine)).toBe('read');
    for (const seq of [-1, 1.5, '3', null]) expect((await t.http.post(`/v1/conversations/${c.id}/read`).set(sara.auth).send({ seq })).status).toBe(400);
  });

  it('replying counts as having read the chat', async () => {
    const m = (await send(t, ali, c.id, 'are you there?').expect(200)).body.message;
    expect((await conv(t, sara, c.id)).unread).toBe(1);
    await send(t, sara, c.id, 'yes').expect(200);
    expect((await conv(t, sara, c.id)).unread).toBe(0);
    expect(tickFor(m, await conv(t, ali, c.id))).toBe('read');
  });

  it('unread stops counting at 100', async () => {
    const d = await open(t, omar, sara);
    for (let i = 0; i < 105; i++) await send(t, omar, d.id, `spam ${i}`).expect(200);
    expect((await conv(t, sara, d.id)).unread).toBe(100);
  });

  it('limits how fast one person can send', async () => {
    await t.redis.del(`rl:send:${omar.id}`);
    const d = await open(t, omar, ali);
    let limited = 0;
    for (let i = 0; i < 125; i++) { const r = await send(t, omar, d.id, `fast ${i}`); if (r.status === 429) { limited++; expect(r.headers['retry-after'] ?? r.body.error.details.retryAfter).toBeDefined(); } }
    expect(limited).toBe(5);
  });

  it('pages the chat list newest first', async () => {
    const u = await makeUser(t, 'Zara');
    const peers = [ali, sara, omar];
    for (const p of peers) { const x = await open(t, u, p); await send(t, u, x.id, `hi ${p.name}`).expect(200); await sleep(5); }
    const p1 = (await t.http.get('/v1/conversations').query({ limit: 2 }).set(u.auth).expect(200)).body;
    expect(p1.items.map((x: ConversationSummary) => x.peer!.displayName)).toEqual(['Omar', 'Sara']);
    expect(p1.next).toBeTruthy();
    const p2 = (await t.http.get('/v1/conversations').query({ limit: 2, before: p1.next }).set(u.auth).expect(200)).body;
    expect(p2.items.map((x: ConversationSummary) => x.peer!.displayName)).toEqual(['Ali']);
    expect(p2.next).toBeNull();
    expect((await t.http.get('/v1/conversations').query({ before: 'garbage' }).set(u.auth)).status).toBe(400);
    // A new message moves a chat back to the top.
    const ali1 = p2.items[0] as ConversationSummary;
    await send(t, ali, ali1.id, 'bump').expect(200);
    const top = (await t.http.get('/v1/conversations').set(u.auth).expect(200)).body.items[0];
    expect(top.id).toBe(ali1.id);
    expect(top.unread).toBe(1);
  });
});

describe('Week 3 · live connection', () => {
  let t: TestApp; let ali: TUser; let sara: TUser; let omar: TUser; let c: ConversationSummary;
  const sockets: Array<{ close(): void }> = [];
  const conn = async (u: TUser | string) => { const s = await connect(t.url, typeof u === 'string' ? u : u.token); sockets.push(s); return s; };
  beforeAll(async () => { t = await startApp(); ali = await makeUser(t, 'Ali'); sara = await makeUser(t, 'Sara'); omar = await makeUser(t, 'Omar'); c = await open(t, ali, sara); });
  afterEach(() => { while (sockets.length) sockets.pop()!.close(); });
  afterAll(async () => { await t.close(); });

  it('refuses connections without a valid token', async () => {
    await expect(connect(t.url, '')).rejects.toMatchObject({ data: { code: 'unauthenticated' } });
    await expect(connect(t.url, 'not.a.token')).rejects.toMatchObject({ data: { code: 'unauthenticated' } });
    await expect(connect(t.url, ali.token.slice(0, -2) + 'xx')).rejects.toMatchObject({ data: { code: 'unauthenticated' } });
  });

  it('delivers a message to the other person and to my other devices, but not to outsiders', async () => {
    const aliWeb = await conn(ali);
    const ali2 = (await signInEmail(t, (await t.http.get('/v1/me').set(ali.auth)).body.email, device(2, 'android')));
    const aliPhone = await conn(ali2.tokens.accessToken);
    const saraS = await conn(sara), omarS = await conn(omar);
    const omarGot = record(omarS, 'msg:new');
    const clientId = cid();
    const [ack, toSara, toPhone, toSelf] = await Promise.all([
      emit<{ message: { id: string; seq: number } }>(aliWeb, 'msg:send', { conversationId: c.id, clientId, text: 'live hello' }),
      next(saraS, 'msg:new'), next(aliPhone, 'msg:new'), next(aliWeb, 'msg:new'),
    ]);
    expect(ack.ok).toBe(true);
    for (const e of [toSara, toPhone, toSelf]) expect(e.message).toMatchObject({ id: ack.data!.message.id, clientId, text: 'live hello', senderId: ali.id });
    await sleep(200);
    expect(omarGot).toEqual([]);
  });

  it('answers bad socket requests with an error instead of dropping them', async () => {
    const s = await conn(ali);
    expect(await emit(s, 'msg:send', { conversationId: c.id, clientId: 'x', text: 'hi' })).toMatchObject({ ok: false, error: { status: 400, code: 'validation_failed' } });
    expect(await emit(s, 'msg:send', { conversationId: c.id, clientId: cid(), text: '   ' })).toMatchObject({ ok: false, error: { status: 400 } });
    expect(await emit(s, 'msg:send', null)).toMatchObject({ ok: false, error: { status: 400 } });
    const outsider = await conn(omar);
    expect(await emit(outsider, 'msg:send', { conversationId: c.id, clientId: cid(), text: 'let me in' })).toMatchObject({ ok: false, error: { status: 404 } });
    expect(await emit(outsider, 'typing', { conversationId: c.id, on: true })).toMatchObject({ ok: false, error: { status: 404 } });
  });

  it('a retry over the socket after a lost answer returns the same message', async () => {
    const s = await conn(ali);
    const clientId = cid();
    const a = await emit<{ message: { id: string }; duplicate: boolean }>(s, 'msg:send', { conversationId: c.id, clientId, text: 'retry me' });
    const b = await emit<{ message: { id: string }; duplicate: boolean }>(s, 'msg:send', { conversationId: c.id, clientId, text: 'retry me' });
    expect(b.data!.message.id).toBe(a.data!.message.id);
    expect(b.data!.duplicate).toBe(true);
  });

  it('shows delivered and read ticks to the sender as they happen', async () => {
    const aliS = await conn(ali), saraS = await conn(sara);
    const sent = (await emit<{ message: { seq: number } }>(aliS, 'msg:send', { conversationId: c.id, clientId: cid(), text: 'tick test' })).data!.message;
    const [delivered] = await Promise.all([
      next(aliS, 'receipt', (p) => p.userId === sara.id && p.deliveredSeq >= sent.seq),
      emit(saraS, 'receipt:delivered', { conversationId: c.id, seq: sent.seq }),
    ]);
    expect(delivered).toMatchObject({ conversationId: c.id, userId: sara.id, deliveredSeq: sent.seq });
    expect(delivered.readSeq).toBeLessThan(sent.seq);
    expect(tickFor({ seq: sent.seq, senderId: ali.id }, await conv(t, ali, c.id))).toBe('delivered');
    const [read] = await Promise.all([
      next(aliS, 'receipt', (p) => p.userId === sara.id && p.readSeq >= sent.seq),
      emit(saraS, 'receipt:read', { conversationId: c.id, seq: sent.seq }),
    ]);
    expect(read).toMatchObject({ readSeq: sent.seq, deliveredSeq: sent.seq });
    // Repeating a receipt changes nothing and sends nothing.
    const extra = record(aliS, 'receipt');
    expect(await emit(saraS, 'receipt:read', { conversationId: c.id, seq: sent.seq })).toMatchObject({ ok: true });
    await sleep(200);
    expect(extra).toEqual([]);
  });

  it('tells the other person I am typing, and not me', async () => {
    const aliS = await conn(ali), saraS = await conn(sara);
    const mine = record(aliS, 'typing');
    const [got] = await Promise.all([next(saraS, 'typing'), emit(aliS, 'typing', { conversationId: c.id, on: true })]);
    expect(got).toEqual({ conversationId: c.id, userId: ali.id, on: true });
    // A second "typing" within 2 seconds is not repeated; "stopped" always is.
    const seen = record(saraS, 'typing');
    await emit(aliS, 'typing', { conversationId: c.id, on: true });
    await emit(aliS, 'typing', { conversationId: c.id, on: false });
    await sleep(200);
    expect(seen).toEqual([{ conversationId: c.id, userId: ali.id, on: false }]);
    expect(mine).toEqual([]);
  });

  it('shows online, then last seen once the last device disconnects', async () => {
    const saraS = await conn(sara);
    const first = await emit<Array<{ userId: string; online: boolean; lastSeenAt: string | null }>>(saraS, 'presence:watch', { userIds: [ali.id, omar.id, sara.id] });
    // Omar shares no chat with Sara, and Sara doesn't watch herself.
    expect(first.data!.map((p) => p.userId)).toEqual([ali.id]);
    expect(first.data![0].online).toBe(false);
    const [on1, a1] = await Promise.all([next(saraS, 'presence', (p) => p.userId === ali.id && p.online), connect(t.url, ali.token)]);
    expect(on1).toEqual({ userId: ali.id, online: true, lastSeenAt: null });
    const a2 = await connect(t.url, ali.token);
    const changes = record(saraS, 'presence');
    a1.close();
    await sleep(300);
    expect(changes).toEqual([]); // still online on the second device
    const before = Date.now();
    const [off] = await Promise.all([next(saraS, 'presence', (p) => p.userId === ali.id && !p.online), Promise.resolve(a2.close())]);
    expect(Date.parse(off.lastSeenAt)).toBeGreaterThanOrEqual(before - 1000);
    const again = await emit<Array<{ online: boolean; lastSeenAt: string }>>(saraS, 'presence:watch', { userIds: [ali.id] });
    expect(again.data![0]).toMatchObject({ online: false, lastSeenAt: off.lastSeenAt });
    // Watching nobody stops the updates.
    await emit(saraS, 'presence:watch', { userIds: [] });
    const quiet = record(saraS, 'presence');
    const a3 = await connect(t.url, ali.token); a3.close();
    await sleep(300);
    expect(quiet).toEqual([]);
    expect(await emit(saraS, 'presence:watch', { userIds: [...Array(51)].map(() => ali.id) })).toMatchObject({ ok: false, error: { status: 400 } });
  });

  it('a device that is signed out loses its live connection at once', async () => {
    const other = await signInEmail(t, (await t.http.get('/v1/me').set(sara.auth)).body.email, device(3, 'ios'));
    const phone = await conn(other.tokens.accessToken);
    const gone = new Promise<string>((r) => phone.on('disconnect', (reason) => r(reason)));
    await t.http.delete(`/v1/me/devices/${other.tokens.sessionId}`).set(sara.auth).expect(204);
    expect(await gone).toBe('io server disconnect');
    await expect(connect(t.url, other.tokens.accessToken)).rejects.toMatchObject({ data: { code: 'session_revoked' } });
  });

  it('a message sent over plain HTTP still reaches the open sockets', async () => {
    const saraS = await conn(sara);
    const [got] = await Promise.all([next(saraS, 'msg:new'), send(t, ali, c.id, 'via http').expect(200)]);
    expect(got.message.text).toBe('via http');
  });

  it('catches up after being offline, in order, with nothing missing', async () => {
    const saraS = await conn(sara);
    const known = (await conv(t, sara, c.id)).lastSeq;
    saraS.close();
    for (const text of ['one', 'two', 'three']) await send(t, ali, c.id, text).expect(200);
    const missed = (await t.http.get(`/v1/conversations/${c.id}/messages`).query({ after: known }).set(sara.auth).expect(200)).body.items;
    expect(missed.map((m: { text: string }) => m.text)).toEqual(['one', 'two', 'three']);
    expect(missed.map((m: { seq: number }) => m.seq)).toEqual([known + 1, known + 2, known + 3]);
  });
});

describe('Week 3 · two API servers', () => {
  let a: TestApp; let b: TestApp; let ali: TUser; let sara: TUser; let c: ConversationSummary;
  beforeAll(async () => {
    a = await startApp();
    b = await startApp({ MONGO_DB: a.env.MONGO_DB, LOCAL_STORAGE_DIR: a.env.LOCAL_STORAGE_DIR }, { keepRedis: true, keepDb: true });
    ali = await makeUser(a, 'Ali'); sara = await makeUser(a, 'Sara'); c = await open(a, ali, sara);
  });
  afterAll(async () => { await b.close(); await a.close(); });

  it('messages, ticks, typing and sign-outs reach people connected to the other server', async () => {
    const aliS = await connect(a.url, ali.token);
    const saraS = await connect(b.url, sara.token);
    try {
      const [ack, got] = await Promise.all([
        emit<{ message: { seq: number } }>(aliS, 'msg:send', { conversationId: c.id, clientId: cid(), text: 'across servers' }),
        next(saraS, 'msg:new'),
      ]);
      expect(got.message.text).toBe('across servers');
      const [rec] = await Promise.all([next(aliS, 'receipt', (p) => p.userId === sara.id), emit(saraS, 'receipt:read', { conversationId: c.id, seq: ack.data!.message.seq })]);
      expect(rec.readSeq).toBe(ack.data!.message.seq);
      const [typing] = await Promise.all([next(aliS, 'typing'), emit(saraS, 'typing', { conversationId: c.id, on: true })]);
      expect(typing.userId).toBe(sara.id);
      // Signing out a device through server A drops its socket on server B.
      const gone = new Promise<string>((r) => saraS.on('disconnect', (reason) => r(reason)));
      await a.http.delete(`/v1/me/devices/${sara.body.tokens.sessionId}`).set(bearer(sara.body)).expect(204);
      expect(await gone).toBe('io server disconnect');
    } finally { aliS.close(); saraS.close(); }
  });
});

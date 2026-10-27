import type { ChatOverview, ConversationPage, ConversationSummary } from '@yays/shared';
import { startApp, type TestApp } from './helpers';
import { cid, connect, emit, makeUser, next, record, sleep, type TUser } from './chat-helpers';

describe('Chat list: mute, pin, archive, unread, clear', () => {
  let t: TestApp; let ali: TUser; let sara: TUser; let omar: TUser;
  const sockets: Array<{ close(): void }> = [];
  const say = async (u: TUser, c: string, text: string) => (await t.http.post(`/v1/conversations/${c}/messages`).set(u.auth).send({ clientId: cid(), text }).expect(200)).body.message;
  const prefs = (u: TUser, c: string, body: object) => t.http.put(`/v1/conversations/${c}/prefs`).set(u.auth).send(body);
  const list = async (u: TUser, q = '') => (await t.http.get(`/v1/conversations${q}`).set(u.auth).expect(200)).body as ConversationPage;
  const one = async (u: TUser, c: string) => (await t.http.get(`/v1/conversations/${c}`).set(u.auth).expect(200)).body as ConversationSummary;
  const direct = async (a: TUser, b: TUser) => (await t.http.post('/v1/conversations/direct').set(a.auth).send({ userId: b.id }).expect(200)).body.id as string;
  beforeAll(async () => { t = await startApp(); [ali, sara, omar] = [await makeUser(t, 'Ali'), await makeUser(t, 'Sara'), await makeUser(t, 'Omar')]; });
  afterEach(() => { while (sockets.length) sockets.pop()!.close(); });
  afterAll(async () => { await t.close(); });

  it('mutes for 8 hours, a week or always, and unmutes; my other devices hear about it', async () => {
    const c = await direct(ali, sara);
    const s = await connect(t.url, ali.token); sockets.push(s);
    const changed = next(s, 'conv:update', (p: { conversationId: string }) => p.conversationId === c);
    const r = (await prefs(ali, c, { mute: '8h' }).expect(200)).body as ConversationSummary;
    await changed;
    expect(new Date(r.mutedUntil!).getTime() - Date.now()).toBeGreaterThan(7.9 * 3600_000);
    expect((await prefs(ali, c, { mute: '1w' }).expect(200)).body.mutedUntil).toBeTruthy();
    expect((await prefs(ali, c, { mute: 'always' }).expect(200)).body.mutedUntil).toMatch(/^9999-/);
    expect((await prefs(ali, c, { mute: 'off' }).expect(200)).body.mutedUntil).toBeNull();
    expect((await one(sara, c)).mutedUntil).toBeNull(); // only mine
    expect((await prefs(ali, c, {})).status).toBe(400);
    expect((await prefs(ali, c, { mute: '2h' })).status).toBe(400);
    expect((await prefs(omar, c, { mute: '8h' })).status).toBe(404);
  });

  it('pins up to 3 chats, which always come with the first page', async () => {
    const u = await makeUser(t, 'Pinner');
    const others = [await makeUser(t, 'P1'), await makeUser(t, 'P2'), await makeUser(t, 'P3'), await makeUser(t, 'P4')];
    const ids: string[] = [];
    for (const o of others) { const c = await direct(u, o); await say(o, c, `hi from ${o.name}`); ids.push(c); }
    for (let i = 0; i < 3; i++) await prefs(u, ids[i], { pinned: true }).expect(200);
    const r = await prefs(u, ids[3], { pinned: true });
    expect(r.status).toBe(409);
    expect(r.body.error.message).toBe('You can pin up to 3 chats. Unpin one first.');
    // The oldest pinned chat is still on page one even when the page is small.
    const p = await list(u, '?limit=1');
    expect(p.items.map((x) => x.id).sort()).toEqual([ids[3], ids[0], ids[1], ids[2]].sort());
    expect(p.items.filter((x) => x.pinnedAt).length).toBe(3);
    await prefs(u, ids[0], { pinned: false }).expect(200);
    await prefs(u, ids[3], { pinned: true }).expect(200);
  });

  it('archived chats leave the list, stay archived when new messages come, and are counted', async () => {
    const u = await makeUser(t, 'Archiver'), o = await makeUser(t, 'Chatty');
    const c = await direct(u, o);
    await say(o, c, 'one');
    await prefs(u, c, { pinned: true }).expect(200);
    const a = (await prefs(u, c, { archived: true }).expect(200)).body as ConversationSummary;
    expect(a).toMatchObject({ archived: true, pinnedAt: null }); // archiving unpins
    let p = await list(u);
    expect(p.items.map((x) => x.id)).not.toContain(c);
    expect(p.archived).toEqual({ count: 1, unread: 1 });
    await say(o, c, 'two');
    p = await list(u);
    expect(p.items.map((x) => x.id)).not.toContain(c);
    expect((await list(u, '?archived=1')).items.map((x) => [x.id, x.unread])).toEqual([[c, 2]]);
    await t.http.post(`/v1/conversations/${c}/read`).set(u.auth).send({ seq: 2 }).expect(200);
    expect((await list(u)).archived).toEqual({ count: 1, unread: 0 });
    await prefs(u, c, { archived: false }).expect(200);
    p = await list(u);
    expect(p.items.map((x) => x.id)).toContain(c);
    expect(p.archived).toEqual({ count: 0, unread: 0 });
    expect((await list(o)).items.find((x) => x.id === c)?.archived).toBe(false);
  });

  it('marks a chat unread by hand; opening it clears the mark', async () => {
    const c = await direct(omar, sara);
    const m = await say(sara, c, 'later');
    await t.http.post(`/v1/conversations/${c}/read`).set(omar.auth).send({ seq: m.seq }).expect(200);
    expect((await prefs(omar, c, { unread: true }).expect(200)).body).toMatchObject({ markedUnread: true, unread: 0 });
    expect((await one(sara, c)).receipts[omar.id].readSeq).toBe(m.seq); // the sender's ticks don't go back
    await t.http.post(`/v1/conversations/${c}/read`).set(omar.auth).send({ seq: m.seq }).expect(200);
    expect((await one(omar, c)).markedUnread).toBe(false);
    // "Mark as read" from the list moves the read point too.
    const m2 = await say(sara, c, 'and now');
    const r = (await prefs(omar, c, { unread: false }).expect(200)).body as ConversationSummary;
    expect(r.unread).toBe(0);
    expect((await one(sara, c)).receipts[omar.id].readSeq).toBe(m2.seq);
  });

  it('clearing a chat hides everything so far, for me only', async () => {
    const c = await direct(ali, omar);
    const m1 = await say(omar, c, 'old secret mango');
    await t.http.put(`/v1/conversations/${c}/messages/${m1.id}/star`).set(ali.auth).send({}).expect(200);
    await t.http.post(`/v1/conversations/${c}/messages/${m1.id}/pin`).set(ali.auth).expect(200);
    const cleared = (await t.http.post(`/v1/conversations/${c}/clear`).set(ali.auth).expect(200)).body as ConversationSummary;
    expect(cleared).toMatchObject({ visibleFrom: m1.seq + 1, lastMessage: null, unread: 0, pins: [] });
    expect((await t.http.get(`/v1/conversations/${c}/messages`).set(ali.auth).expect(200)).body.items).toEqual([]);
    expect((await t.http.get('/v1/search').query({ q: 'mango' }).set(ali.auth).expect(200)).body.messages).toEqual([]);
    // Starred messages stay, even after clearing.
    expect((await t.http.get('/v1/starred').set(ali.auth).expect(200)).body.items.map((x: { message: { text: string } }) => x.message.text)).toEqual(['old secret mango']);
    await say(omar, c, 'new one');
    expect((await t.http.get(`/v1/conversations/${c}/messages`).set(ali.auth).expect(200)).body.items.map((m: { text: string }) => m.text)).toEqual(['new one']);
    expect((await t.http.get(`/v1/conversations/${c}/messages`).set(omar.auth).expect(200)).body.items.map((m: { text: string }) => m.text)).toContain('old secret mango');
  });
});

describe('Contact info: shared media, docs, links and groups in common', () => {
  let t: TestApp; let ali: TUser; let sara: TUser;
  beforeAll(async () => { t = await startApp(); [ali, sara] = [await makeUser(t, 'Ali'), await makeUser(t, 'Sara')]; });
  afterAll(async () => { await t.close(); });
  const upload = async (u: TUser, kind: 'image' | 'file', name: string) => {
    const type = kind === 'image' ? 'image/png' : 'application/pdf';
    const body = kind === 'image' ? Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8cfc0f01f0005000201ee8f6d6b0000000049454e44ae426082', 'hex') : Buffer.from('%PDF-1.4');
    const k = (await t.http.post('/v1/media/upload-url').set(u.auth).send({ purpose: 'media', kind, contentType: type, size: body.length, name }).expect(200)).body;
    await t.http.put(new URL(k.uploadUrl).pathname).set('content-type', type).send(body).expect(204);
    return { kind, key: k.key, name, ...(kind === 'image' ? { width: 1, height: 1 } : {}) };
  };

  it('counts and pages what was shared, and lists groups we are both in', async () => {
    const c = (await t.http.post('/v1/conversations/direct').set(ali.auth).send({ userId: sara.id }).expect(200)).body.id;
    for (let i = 0; i < 3; i++) await t.http.post(`/v1/conversations/${c}/messages`).set(sara.auth).send({ clientId: cid(), attachment: await upload(sara, 'image', `p${i}.png`) }).expect(200);
    await t.http.post(`/v1/conversations/${c}/messages`).set(ali.auth).send({ clientId: cid(), attachment: await upload(ali, 'file', 'menu.pdf') }).expect(200);
    const link = (await t.http.post(`/v1/conversations/${c}/messages`).set(sara.auth).send({ clientId: cid(), text: 'see https://yaysapp.com/venue' }).expect(200)).body.message;
    await t.http.post(`/v1/conversations/${c}/messages`).set(sara.auth).send({ clientId: cid(), text: 'no link here' }).expect(200);
    await t.http.put(`/v1/conversations/${c}/messages/${link.id}/star`).set(ali.auth).send({}).expect(200);
    const g = (await t.http.post('/v1/groups').set(ali.auth).send({ name: 'Friday dinner', memberIds: [sara.id] }).expect(200)).body.id;
    await t.http.post('/v1/groups').set(ali.auth).send({ name: 'Just me', memberIds: [] });
    const o = (await t.http.get(`/v1/conversations/${c}/overview`).set(ali.auth).expect(200)).body as ChatOverview;
    expect(o.counts).toEqual({ media: 3, docs: 1, links: 1, starred: 1 });
    expect(o.recentMedia.map((m) => m.attachment!.name)).toEqual(['p2.png', 'p1.png', 'p0.png']);
    expect(o.recentMedia[0].attachment!.url).toBeTruthy();
    expect(o.commonGroups.map((x) => [x.id, x.name])).toEqual([[g, 'Friday dinner']]);
    expect(o.blocked).toBe(false);
    const docs = (await t.http.get(`/v1/conversations/${c}/shared`).query({ tab: 'docs' }).set(ali.auth).expect(200)).body;
    expect(docs.items.map((m: { attachment: { name: string } }) => m.attachment.name)).toEqual(['menu.pdf']);
    const links = (await t.http.get(`/v1/conversations/${c}/shared`).query({ tab: 'links' }).set(sara.auth).expect(200)).body;
    expect(links.items.map((m: { text: string }) => m.text)).toEqual(['see https://yaysapp.com/venue']);
    // Paging through media.
    const p1 = (await t.http.get(`/v1/conversations/${c}/shared`).query({ tab: 'media' }).set(ali.auth).expect(200)).body;
    expect(p1).toMatchObject({ next: null });
    expect(p1.items).toHaveLength(3);
    // Not in the chat: nothing.
    const zara = await makeUser(t, 'Zara');
    expect((await t.http.get(`/v1/conversations/${c}/overview`).set(zara.auth)).status).toBe(404);
    expect((await t.http.get(`/v1/conversations/${c}/shared`).set(zara.auth)).status).toBe(404);
  });
});

describe('Block and report', () => {
  let t: TestApp; let ali: TUser; let sara: TUser; let c: string;
  const sockets: Array<{ close(): void }> = [];
  const send = (u: TUser, text: string) => t.http.post(`/v1/conversations/${c}/messages`).set(u.auth).send({ clientId: cid(), text });
  const pushes = async (u: TUser) => (await t.http.get('/v1/_test/pushes').query({ userId: u.id }).expect(200)).body as unknown[];
  beforeAll(async () => {
    t = await startApp();
    [ali, sara] = [await makeUser(t, 'Ali'), await makeUser(t, 'Sara')];
    c = (await t.http.post('/v1/conversations/direct').set(ali.auth).send({ userId: sara.id }).expect(200)).body.id;
  });
  afterEach(() => { while (sockets.length) sockets.pop()!.close(); });
  afterAll(async () => { await t.close(); });

  it('a blocked person’s messages quietly never arrive, and they are not told', async () => {
    await send(sara, 'before the block').expect(200);
    await t.http.post('/v1/push/subscriptions').set(ali.auth).send({ endpoint: 'https://push.example/ali', keys: { p256dh: 'BOr2Ae_W_example_p256dh_key_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', auth: 'aaaaaaaaaaaaaaaaaaaaaa' } });
    const a = await connect(t.url, ali.token); sockets.push(a);
    const s = await connect(t.url, sara.token); sockets.push(s);
    await emit(a, 'presence:watch', { userIds: [sara.id] });
    expect((await emit<Array<{ online: boolean }>>(s, 'presence:watch', { userIds: [ali.id] })).data![0].online).toBe(true);
    await t.redis.del(`push:dev:${ali.id}`);

    const toSara = next(s, 'presence', (p: { userId: string; online: boolean }) => p.userId === ali.id && !p.online);
    await t.http.post('/v1/blocks').set(ali.auth).send({ userId: sara.id }).expect(204);
    await toSara; // Ali no longer shows as online to Sara
    expect((await t.http.get('/v1/blocks').set(ali.auth).expect(200)).body.map((p: { id: string }) => p.id)).toEqual([sara.id]);
    expect((await t.http.get(`/v1/conversations/${c}`).set(ali.auth).expect(200)).body).toMatchObject({ blocked: true, canSend: false });
    const fromSara = (await t.http.get(`/v1/conversations/${c}`).set(sara.auth).expect(200)).body as ConversationSummary;
    expect(fromSara).toMatchObject({ blocked: false, canSend: true }); // nothing changes on her side
    expect(fromSara.peer?.photoUrl).toBeNull();

    // Ali can't write; Sara can, but it never reaches Ali.
    expect((await send(ali, 'hi')).status).toBe(403);
    const aliGot = record(a, 'msg:new');
    const typing = record(a, 'typing');
    await emit(s, 'typing', { conversationId: c, on: true });
    const r = await send(sara, 'are you there?').expect(200);
    expect(r.body.message.held).toBe(true);
    await sleep(300);
    expect(aliGot).toEqual([]);
    expect(typing).toEqual([]);
    expect(await pushes(ali)).toEqual([]);
    const aliView = (await t.http.get(`/v1/conversations/${c}`).set(ali.auth).expect(200)).body as ConversationSummary;
    expect(aliView).toMatchObject({ unread: 1 }); // only "before the block"
    expect(aliView.lastMessage?.text).toBe('before the block');
    expect((await t.http.get(`/v1/conversations/${c}/messages`).set(ali.auth).expect(200)).body.items.map((m: { text: string }) => m.text)).toEqual(['before the block']);
    // Sara sees one tick, even after Ali reads everything.
    await t.http.post(`/v1/conversations/${c}/read`).set(ali.auth).send({ seq: 99 }).expect(200);
    const mine = (await t.http.get(`/v1/conversations/${c}/messages`).set(sara.auth).expect(200)).body.items;
    expect(mine.map((m: { text: string; held?: boolean }) => [m.text, !!m.held])).toEqual([['before the block', false], ['are you there?', true]]);
    const info = (await t.http.get(`/v1/conversations/${c}/messages/${r.body.message.id}/info`).set(sara.auth).expect(200)).body;
    expect(info).toMatchObject({ readBy: [], deliveredTo: [] });
    expect((await emit<Array<{ online: boolean; lastSeenAt: string | null }>>(s, 'presence:watch', { userIds: [ali.id] })).data).toEqual([]);

    // Unblocked: new messages flow again; the held one stays undelivered.
    await t.http.delete(`/v1/blocks/${sara.id}`).set(ali.auth).expect(204);
    const got = next(a, 'msg:new', (p: { message: { text: string } }) => p.message.text === 'back again');
    await send(sara, 'back again').expect(200);
    await got;
    expect((await t.http.get(`/v1/conversations/${c}/messages`).set(ali.auth).expect(200)).body.items.map((m: { text: string }) => m.text)).toEqual(['before the block', 'back again']);
    await send(ali, 'hi').expect(200);
  });

  it('reports keep the last messages as evidence, and can block at the same time', async () => {
    const omar = await makeUser(t, 'Omar');
    const d = (await t.http.post('/v1/conversations/direct').set(omar.auth).send({ userId: ali.id }).expect(200)).body.id;
    for (let i = 1; i <= 7; i++) await t.http.post(`/v1/conversations/${d}/messages`).set(omar.auth).send({ clientId: cid(), text: `buy crypto ${i}` }).expect(200);
    await t.http.post('/v1/reports').set(ali.auth).send({ userId: omar.id, reason: 'scam', block: true }).expect(204);
    const rep = await t.db.collection('yc_reports').findOne({ 'targetUserId': { $exists: true }, reason: 'scam' });
    expect(rep!.evidence.map((e: { text: string }) => e.text)).toEqual(['buy crypto 7', 'buy crypto 6', 'buy crypto 5', 'buy crypto 4', 'buy crypto 3']);
    expect(rep!.convId.toHexString()).toBe(d);
    expect((await t.http.get('/v1/blocks').set(ali.auth).expect(200)).body.map((p: { displayName: string }) => p.displayName)).toEqual(['Omar']);
    // A group can be reported too; someone not in it can't.
    const g = (await t.http.post('/v1/groups').set(omar.auth).send({ name: 'Free money', memberIds: [sara.id] }).expect(200)).body.id;
    await t.http.post(`/v1/conversations/${g}/messages`).set(omar.auth).send({ clientId: cid(), text: 'send 1 BTC get 2' }).expect(200);
    await t.http.post('/v1/reports').set(sara.auth).send({ conversationId: g, reason: 'spam' }).expect(204);
    expect((await t.db.collection('yc_reports').findOne({ reason: 'spam' }))!.evidence.map((e: { text: string }) => e.text)).toEqual(['send 1 BTC get 2']);
    expect((await t.http.post('/v1/reports').set(ali.auth).send({ conversationId: g, reason: 'spam' })).status).toBe(404);
    expect((await t.http.post('/v1/reports').set(ali.auth).send({ reason: 'spam' })).status).toBe(400);
    expect((await t.http.post('/v1/blocks').set(ali.auth).send({ userId: ali.id })).status).toBe(400);
  });
});

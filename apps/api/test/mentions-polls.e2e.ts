import type { ChatMessage, ConversationSummary } from '@yays/shared';
import { startApp, type TestApp } from './helpers';
import { cid, connect, makeUser, next, sleep, type TUser } from './chat-helpers';

describe('Mentions', () => {
  let t: TestApp; let ali: TUser; let sara: TUser; let omar: TUser; let zara: TUser; let g: string;
  const pushes = async (u: TUser) => (await t.http.get('/v1/_test/pushes').query({ userId: u.id }).expect(200)).body as Array<{ payload: { body: string } }>;
  beforeAll(async () => {
    t = await startApp();
    [ali, sara, omar, zara] = [await makeUser(t, 'Ali'), await makeUser(t, 'Sara'), await makeUser(t, 'Omar'), await makeUser(t, 'Zara')];
    g = (await t.http.post('/v1/groups').set(ali.auth).send({ name: 'Family', memberIds: [sara.id, omar.id] }).expect(200)).body.id;
  });
  afterAll(async () => { await t.close(); });

  it('keeps mentions of current members named in the text; others are dropped', async () => {
    const m = (await t.http.post(`/v1/conversations/${g}/messages`).set(ali.auth).send({ clientId: cid(), text: 'Thanks @Sara and @Zara', mentions: [sara.id, zara.id, ali.id] }).expect(200)).body.message as ChatMessage;
    expect(m.mentions).toEqual([sara.id]); // Zara isn't in the group; you can't mention yourself
    const direct = (await t.http.post('/v1/conversations/direct').set(ali.auth).send({ userId: sara.id }).expect(200)).body.id;
    expect((await t.http.post(`/v1/conversations/${direct}/messages`).set(ali.auth).send({ clientId: cid(), text: 'hi @Sara', mentions: [sara.id] }).expect(200)).body.message.mentions).toBeUndefined();
    expect((await t.http.post(`/v1/conversations/${g}/messages`).set(ali.auth).send({ clientId: cid(), text: 'no at sign', mentions: [sara.id] }).expect(200)).body.message.mentions).toBeUndefined();
  });

  it('shows "mentioned" on the chat until it is read, and notifies through a muted group', async () => {
    await t.http.post('/v1/push/subscriptions').set(omar.auth).send({ endpoint: 'https://push.example/omar', keys: { p256dh: 'BOr2Ae_W_example_p256dh_key_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', auth: 'aaaaaaaaaaaaaaaaaaaaaa' } }).expect(204);
    await t.http.put(`/v1/conversations/${g}/prefs`).set(omar.auth).send({ mute: 'always' }).expect(200);
    await t.http.post(`/v1/conversations/${g}/messages`).set(sara.auth).send({ clientId: cid(), text: 'quiet chat' }).expect(200);
    await sleep(300);
    expect(await pushes(omar)).toEqual([]);
    const m = (await t.http.post(`/v1/conversations/${g}/messages`).set(sara.auth).send({ clientId: cid(), text: '@Omar can you bring chairs?', mentions: [omar.id] }).expect(200)).body.message;
    await sleep(300);
    expect((await pushes(omar)).map((p) => p.payload.body)).toEqual(['Sara: @Omar can you bring chairs?']);
    expect(((await t.http.get(`/v1/conversations/${g}`).set(omar.auth).expect(200)).body as ConversationSummary).mentioned).toBe(true);
    expect(((await t.http.get(`/v1/conversations/${g}`).set(ali.auth).expect(200)).body as ConversationSummary).mentioned).toBeUndefined();
    await t.http.post(`/v1/conversations/${g}/read`).set(omar.auth).send({ seq: m.seq }).expect(200);
    expect(((await t.http.get(`/v1/conversations/${g}`).set(omar.auth).expect(200)).body as ConversationSummary).mentioned).toBeUndefined();
  });

  it('editing can change who is mentioned', async () => {
    const m = (await t.http.post(`/v1/conversations/${g}/messages`).set(ali.auth).send({ clientId: cid(), text: '@Sara hi', mentions: [sara.id] }).expect(200)).body.message;
    const e = (await t.http.patch(`/v1/conversations/${g}/messages/${m.id}`).set(ali.auth).send({ text: '@Omar hi', mentions: [omar.id] }).expect(200)).body as ChatMessage;
    expect(e.mentions).toEqual([omar.id]);
    const e2 = (await t.http.patch(`/v1/conversations/${g}/messages/${m.id}`).set(ali.auth).send({ text: 'hi all', mentions: [] }).expect(200)).body as ChatMessage;
    expect(e2.mentions).toBeUndefined();
  });
});

describe('Polls', () => {
  let t: TestApp; let ali: TUser; let sara: TUser; let omar: TUser; let g: string;
  const sockets: Array<{ close(): void }> = [];
  const poll = (u: TUser, body: object) => t.http.post(`/v1/conversations/${g}/polls`).set(u.auth).send({ clientId: cid(), ...body });
  const vote = (u: TUser, id: string, options: string[]) => t.http.put(`/v1/conversations/${g}/messages/${id}/vote`).set(u.auth).send({ options });
  beforeAll(async () => {
    t = await startApp();
    [ali, sara, omar] = [await makeUser(t, 'Ali'), await makeUser(t, 'Sara'), await makeUser(t, 'Omar')];
    g = (await t.http.post('/v1/groups').set(ali.auth).send({ name: 'Family', memberIds: [sara.id, omar.id] }).expect(200)).body.id;
  });
  afterEach(() => { while (sockets.length) sockets.pop()!.close(); });
  afterAll(async () => { await t.close(); });

  it('checks the question and options', async () => {
    const err = async (body: object) => (await poll(ali, body).expect(400)).body.error.message as string;
    expect(await err({ question: '  ', options: ['a', 'b'] })).toBe('Write the question.');
    expect(await err({ question: 'Lunch?', options: ['1 pm'] })).toBe('Add at least 2 options.');
    expect(await err({ question: 'Lunch?', options: ['1 pm', '1 PM'] })).toBe('Each option must be different.');
    expect(await err({ question: 'Lunch?', options: Array.from({ length: 13 }, (_, i) => `o${i}`) })).toBe('A poll can have up to 12 options.');
    expect(await err({ question: 'x'.repeat(256), options: ['a', 'b'] })).toBe('The question can be up to 255 characters.');
  });

  it('one answer each, changeable; everyone sees counts and voters live; the list shows it', async () => {
    const p = (await poll(ali, { question: 'Sunday lunch time?', options: ['1:00 pm', '2:30 pm', 'Dinner instead'] }).expect(200)).body.message as ChatMessage;
    expect(p).toMatchObject({ type: 'poll', text: 'Sunday lunch time?', poll: { multi: false, anonymous: false, voterCount: 0 } });
    const [o1, o2] = p.poll!.options.map((o) => o.id);
    const s = await connect(t.url, sara.token); sockets.push(s);
    const live = next<{ message: ChatMessage }>(s, 'msg:update', (x) => x.message.id === p.id && x.message.poll!.voterCount === 1);
    const mine = (await vote(omar, p.id, [o1]).expect(200)).body as ChatMessage;
    expect(mine.poll!.myVotes).toEqual([o1]);
    expect((await live).message.poll!.options[0]).toMatchObject({ votes: 1, voters: [omar.id] });
    expect((await vote(omar, p.id, [o1, o2])).status).toBe(400); // one answer only
    await vote(sara, p.id, [o2]).expect(200);
    const changed = (await vote(omar, p.id, [o2]).expect(200)).body as ChatMessage;
    expect(changed.poll!.options.map((o) => o.votes)).toEqual([0, 2, 0]);
    expect(changed.poll!.voterCount).toBe(2);
    const taken = (await vote(omar, p.id, []).expect(200)).body as ChatMessage;
    expect(taken.poll).toMatchObject({ voterCount: 1, myVotes: [] });
    expect((await vote(omar, p.id, ['zz'])).status).toBe(400);
    const list = (await t.http.get(`/v1/conversations/${g}`).set(sara.auth).expect(200)).body as ConversationSummary;
    expect(list.lastMessage).toMatchObject({ type: 'poll', text: 'Sunday lunch time?' });
    expect((await t.http.get('/v1/search').query({ q: 'lunch time' }).set(sara.auth).expect(200)).body.messages).toHaveLength(1);
    expect((await t.http.patch(`/v1/conversations/${g}/messages/${p.id}`).set(ali.auth).send({ text: 'edited' })).status).toBe(400);
  });

  it('several answers, and hidden voters', async () => {
    const p = (await poll(sara, { question: 'What to bring?', options: ['Kheer', 'Samosas', 'Chai'], multi: true, anonymous: true }).expect(200)).body.message as ChatMessage;
    const ids = p.poll!.options.map((o) => o.id);
    const r = (await vote(ali, p.id, [ids[0], ids[2]]).expect(200)).body as ChatMessage;
    expect(r.poll!.myVotes).toEqual([ids[0], ids[2]]);
    expect(r.poll!.options.every((o) => o.voters === undefined)).toBe(true);
    const asOmar = (await t.http.get(`/v1/conversations/${g}/messages`).set(omar.auth).expect(200)).body.items.find((m: ChatMessage) => m.id === p.id) as ChatMessage;
    expect(asOmar.poll).toMatchObject({ voterCount: 1, myVotes: [] });
    expect(asOmar.poll!.options.map((o) => o.votes)).toEqual([1, 0, 1]);
    // Someone who left can't vote.
    await t.http.post(`/v1/groups/${g}/leave`).set(omar.auth).expect(200);
    expect((await vote(omar, p.id, [ids[1]])).status).toBe(404);
  });
});

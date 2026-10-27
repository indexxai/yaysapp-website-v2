import type { SearchResults } from '@yays/shared';
import { startApp, type TestApp } from './helpers';
import { cid, makeUser, type TUser } from './chat-helpers';

describe('Search', () => {
  let t: TestApp; let ali: TUser; let sara: TUser; let omar: TUser; let zara: TUser;
  const say = async (u: TUser, c: string, text: string) => (await t.http.post(`/v1/conversations/${c}/messages`).set(u.auth).send({ clientId: cid(), text }).expect(200)).body.message;
  const find = async (u: TUser, q: string, type = 'all', before?: string) => (await t.http.get('/v1/search').query({ q, type, ...(before ? { before } : {}) }).set(u.auth).expect(200)).body as SearchResults;
  const texts = (r: SearchResults) => r.messages.map((m) => m.message.text);
  let direct: string; let group: string;

  beforeAll(async () => {
    t = await startApp();
    [ali, sara, omar, zara] = [await makeUser(t, 'Ali'), await makeUser(t, 'Sara'), await makeUser(t, 'Omar'), await makeUser(t, 'Zara')];
    await t.http.patch('/v1/me').set(sara.auth).send({ displayName: 'Sara Ahmed' }).expect(200);
    direct = (await t.http.post('/v1/conversations/direct').set(ali.auth).send({ userId: sara.id }).expect(200)).body.id;
    await say(sara, direct, 'Are you joining the BTCY call tonight?');
    await say(ali, direct, 'Yes! I’ll bring the Slides.');
    await say(sara, direct, 'کل ملتے ہیں slides کے ساتھ');
    group = (await t.http.post('/v1/groups').set(ali.auth).send({ name: 'Slides Team', memberIds: [sara.id] }).expect(200)).body.id;
    await say(sara, group, 'Updated the slides with the new oval system');
    // Omar and Zara talk privately: Ali must never see this.
    const private1 = (await t.http.post('/v1/conversations/direct').set(omar.auth).send({ userId: zara.id }).expect(200)).body.id;
    await say(omar, private1, 'secret slides for zara only');
  });
  afterAll(async () => { await t.close(); });

  it('finds chats, people and messages, ignoring case and in any script', async () => {
    const r = await find(ali, 'slides');
    expect(r.chats.map((c) => c.name)).toEqual(['Slides Team']);
    expect(texts(r)).toEqual(['Updated the slides with the new oval system', 'کل ملتے ہیں slides کے ساتھ', 'Yes! I’ll bring the Slides.']);
    expect(r.counts.messages).toBe(3);
    expect(r.messages[0]).toMatchObject({ chat: { name: 'Slides Team', kind: 'group' }, senderName: 'Sara Ahmed' });
    expect(r.messages[2].senderName).toBe('You');
    expect(texts(await find(ali, 'ملتے'))).toEqual(['کل ملتے ہیں slides کے ساتھ']);
    const people = await find(ali, 'ahmed', 'people');
    expect(people.people.map((p) => [p.displayName, p.stranger])).toEqual([['Sara Ahmed', false]]);
    const chats = await find(ali, 'sara', 'chats');
    expect(chats.chats.map((c) => [c.name, c.kind])).toEqual([['Sara Ahmed', 'direct']]);
  });

  it('never shows chats you aren’t in, or messages from before you joined or after you left', async () => {
    expect(texts(await find(ali, 'secret'))).toEqual([]);
    expect((await find(ali, 'zara', 'people')).people).toEqual([]); // not someone Ali shares a chat with
    const g = (await t.http.post('/v1/groups').set(sara.auth).send({ name: 'Later', memberIds: [omar.id] }).expect(200)).body.id;
    await say(sara, g, 'before Ali joined: kheer');
    await t.http.post(`/v1/groups/${g}/members`).set(sara.auth).send({ userIds: [ali.id] }).expect(200);
    await say(sara, g, 'after Ali joined: kheer');
    await t.http.post(`/v1/groups/${g}/leave`).set(ali.auth).expect(200);
    await say(sara, g, 'after Ali left: kheer');
    expect(texts(await find(ali, 'kheer'))).toEqual(['after Ali joined: kheer']);
  });

  it('leaves out deleted messages, messages deleted for me, and group lines', async () => {
    const m1 = await say(ali, direct, 'typo rhubarb');
    const m2 = await say(sara, direct, 'hide rhubarb from Ali');
    await say(ali, direct, 'keep rhubarb');
    await t.http.delete(`/v1/conversations/${direct}/messages/${m1.id}`).query({ for: 'everyone' }).set(ali.auth).expect(200);
    await t.http.delete(`/v1/conversations/${direct}/messages/${m2.id}`).query({ for: 'me' }).set(ali.auth).expect(200);
    expect(texts(await find(ali, 'rhubarb'))).toEqual(['keep rhubarb']);
    expect(texts(await find(sara, 'rhubarb'))).toEqual(['keep rhubarb', 'hide rhubarb from Ali']);
    expect(texts(await find(ali, 'created'))).toEqual([]); // "created the group" lines are not messages
  });

  it('exact usernames find people you don’t share a chat with yet', async () => {
    const zu = (await t.http.get('/v1/me').set(zara.auth)).body.username;
    const r = await find(ali, `@${zu}`, 'people');
    expect(r.people.map((p) => [p.displayName, p.stranger])).toEqual([['Zara', true]]);
    expect((await find(ali, zu.slice(0, 5), 'people')).people).toEqual([]); // only the exact name, so nobody can browse
  });

  it('finds files by name, and pages through many messages', async () => {
    const key = (await t.http.post('/v1/media/upload-url').set(sara.auth).send({ purpose: 'media', kind: 'file', contentType: 'application/pdf', size: 4, name: 'slides-v3.pdf' }).expect(200)).body;
    await t.http.put(new URL(key.uploadUrl).pathname).set('content-type', 'application/pdf').send(Buffer.from('%PDF')).expect(204);
    await t.http.post(`/v1/conversations/${direct}/messages`).set(sara.auth).send({ clientId: cid(), attachment: { kind: 'file', key: key.key, name: 'slides-v3.pdf' } }).expect(200);
    const f = await find(ali, 'v3', 'files');
    expect(f.files.map((x) => x.message.attachment!.name)).toEqual(['slides-v3.pdf']);
    expect(f.counts.files).toBe(1);
    for (let i = 0; i < 45; i++) await say(sara, direct, `mango ${i}`);
    const p1 = await find(ali, 'mango', 'messages');
    expect(p1.messages).toHaveLength(40);
    expect(p1.counts.messages).toBe(45);
    expect(p1.next).toBeTruthy();
    const p2 = await find(ali, 'mango', 'messages', p1.next!);
    expect(p2.messages.map((m) => m.message.text)).toEqual(['mango 4', 'mango 3', 'mango 2', 'mango 1', 'mango 0']);
    expect(p2.next).toBeNull();
  });

  it('searches inside one chat for "result 1 of n", and treats special characters as text', async () => {
    const r = (await t.http.get(`/v1/conversations/${direct}/search`).query({ q: 'SLIDES' }).set(ali.auth).expect(200)).body;
    expect(r.seqs.length).toBe(3); // two messages and the PDF's name
    expect(r.seqs).toEqual([...r.seqs].sort((a: number, b: number) => a - b));
    await say(ali, direct, 'price is 5.5$ (approx)');
    expect(texts(await find(ali, '5.5$ (a'))).toEqual(['price is 5.5$ (approx)']);
    expect(texts(await find(ali, '.*'))).toEqual([]);
    expect((await t.http.get('/v1/search').query({ q: 'a' }).set(ali.auth)).status).toBe(400);
    expect((await t.http.get(`/v1/conversations/${direct}/search`).query({ q: 'slides' }).set(zara.auth)).status).toBe(404);
  });
});

import { ObjectId } from 'mongodb';
import type { ChatMessage, ConversationSummary } from '@yays/shared';
import { device, signInEmail, startApp, type TestApp } from './helpers';
import { cid, connect, makeUser, next, sleep, type TUser } from './chat-helpers';

describe('Message actions', () => {
  let t: TestApp; let ali: TUser; let sara: TUser; let omar: TUser; let zara: TUser;
  const sockets: Array<{ close(): void }> = [];
  const conn = async (u: TUser | string) => { const s = await connect(t.url, typeof u === 'string' ? u : u.token); sockets.push(s); return s; };
  const direct = async (a: TUser, b: TUser) => (await t.http.post('/v1/conversations/direct').set(a.auth).send({ userId: b.id }).expect(200)).body as ConversationSummary;
  const group = async (owner: TUser, members: TUser[], extra: object = {}) => (await t.http.post('/v1/groups').set(owner.auth).send({ name: 'G', memberIds: members.map((m) => m.id), ...extra }).expect(200)).body as ConversationSummary;
  const say = async (u: TUser, c: string, text: string, extra: object = {}) => (await t.http.post(`/v1/conversations/${c}/messages`).set(u.auth).send({ clientId: cid(), text, ...extra }).expect(200)).body.message as ChatMessage;
  const url = (c: string, m: string, tail = '') => `/v1/conversations/${c}/messages/${m}${tail}`;
  const history = async (u: TUser, c: string) => (await t.http.get(`/v1/conversations/${c}/messages`).query({ limit: 100 }).set(u.auth).expect(200)).body.items as ChatMessage[];
  const find = async (u: TUser, c: string, id: string) => (await history(u, c)).find((m) => m.id === id);
  const age = (id: string, minutes: number) => t.db.collection('yc_messages').updateOne({ _id: new ObjectId(id) }, { $set: { createdAt: new Date(Date.now() - minutes * 60000) } });

  beforeAll(async () => { t = await startApp(); [ali, sara, omar, zara] = [await makeUser(t, 'Ali'), await makeUser(t, 'Sara'), await makeUser(t, 'Omar'), await makeUser(t, 'Zara')]; });
  afterEach(() => { while (sockets.length) sockets.pop()!.close(); });
  afterAll(async () => { await t.close(); });

  describe('reply', () => {
    it('quotes the original, live and in history; refuses quotes from elsewhere, of lines and of deleted messages', async () => {
      const c = await direct(ali, sara);
      const q = await say(sara, c.id, 'Are you joining the BTCY call tonight?');
      const saraS = await conn(sara);
      const [r, live] = await Promise.all([say(ali, c.id, 'Yes!', { replyToId: q.id }), next(saraS, 'msg:new')]);
      expect(r.replyTo).toEqual({ id: q.id, seq: q.seq, senderId: sara.id, type: 'text', text: 'Are you joining the BTCY call tonight?', deleted: false });
      expect(live.message.replyTo.id).toBe(q.id);
      expect((await find(sara, c.id, r.id))!.replyTo!.text).toBe('Are you joining the BTCY call tonight?');
      const other = await direct(ali, omar);
      const elsewhere = await say(omar, other.id, 'not in your chat with Sara');
      const bad = await t.http.post(`/v1/conversations/${c.id}/messages`).set(ali.auth).send({ clientId: cid(), text: 'x', replyToId: elsewhere.id });
      expect(bad.status).toBe(400);
      expect(bad.body.error.message).toBe('The message you’re replying to isn’t in this chat.');
      const g = await group(ali, [sara]);
      const line = (await history(ali, g.id))[0];
      expect((await t.http.post(`/v1/conversations/${g.id}/messages`).set(ali.auth).send({ clientId: cid(), text: 'x', replyToId: line.id })).body.error.message).toBe('You can’t reply to that.');
      // When the quoted message is deleted for everyone, the quote says so.
      await t.http.delete(url(c.id, q.id)).query({ for: 'everyone' }).set(sara.auth).expect(200);
      expect((await find(ali, c.id, r.id))!.replyTo).toMatchObject({ deleted: true, text: '' });
      expect((await t.http.post(`/v1/conversations/${c.id}/messages`).set(ali.auth).send({ clientId: cid(), text: 'x', replyToId: q.id })).body.error.message).toBe('You can’t reply to a deleted message.');
    });
  });

  describe('reactions', () => {
    it('one per person, replaced or removed, shown to everyone live', async () => {
      const c = await direct(ali, sara);
      const m = await say(ali, c.id, 'Venue is booked for 8 pm');
      const aliS = await conn(ali);
      const [r1, live] = await Promise.all([t.http.put(url(c.id, m.id, '/reaction')).set(sara.auth).send({ emoji: '👍' }).expect(200), next(aliS, 'msg:update')]);
      expect(r1.body.reactions).toEqual({ '👍': [sara.id] });
      expect(live.message.reactions).toEqual({ '👍': [sara.id] });
      await t.http.put(url(c.id, m.id, '/reaction')).set(sara.auth).send({ emoji: '❤️' }).expect(200);
      const r3 = (await t.http.put(url(c.id, m.id, '/reaction')).set(ali.auth).send({ emoji: '❤️' }).expect(200)).body;
      expect(r3.reactions).toEqual({ '❤️': [sara.id, ali.id] });
      for (const e of ['👍🏽', '🇵🇰', '👨‍👩‍👧', '1️⃣']) await t.http.put(url(c.id, m.id, '/reaction')).set(ali.auth).send({ emoji: e }).expect(200);
      const off = (await t.http.delete(url(c.id, m.id, '/reaction')).set(ali.auth).expect(200)).body;
      expect(off.reactions).toEqual({ '❤️': [sara.id] });
      for (const emoji of ['', 'a', 'hello', 'x😀', '😀'.repeat(9), 42]) expect((await t.http.put(url(c.id, m.id, '/reaction')).set(ali.auth).send({ emoji })).status).toBe(400);
      expect((await t.http.put(url(c.id, m.id, '/reaction')).set(omar.auth).send({ emoji: '👍' })).status).toBe(404);
      expect((await t.http.put(url(c.id, 'f'.repeat(24), '/reaction')).set(ali.auth).send({ emoji: '👍' })).status).toBe(404);
    });
  });

  describe('edit', () => {
    it('own text messages, within 15 minutes; everyone sees the new text marked edited', async () => {
      const c = await direct(ali, sara);
      const m = await say(ali, c.id, 'Yes! I’ll bring the slides.');
      const saraS = await conn(sara);
      const [r, live] = await Promise.all([t.http.patch(url(c.id, m.id)).set(ali.auth).send({ text: 'Yes! I’ll bring the slides and the printouts.' }).expect(200), next(saraS, 'msg:update')]);
      expect(r.body).toMatchObject({ text: 'Yes! I’ll bring the slides and the printouts.', editedAt: expect.any(String) });
      expect(live.message.text).toBe('Yes! I’ll bring the slides and the printouts.');
      expect((await find(sara, c.id, m.id))!.editedAt).toBeTruthy();
      expect((await t.http.patch(url(c.id, m.id)).set(sara.auth).send({ text: 'mine now' })).status).toBe(403);
      expect((await t.http.patch(url(c.id, m.id)).set(ali.auth).send({ text: '   ' })).status).toBe(400);
      await age(m.id, 16);
      const late = await t.http.patch(url(c.id, m.id)).set(ali.auth).send({ text: 'too late' });
      expect(late.status).toBe(409);
      expect(late.body.error.message).toBe('Messages can be edited for 15 minutes after sending.');
    });
  });

  describe('delete', () => {
    it('for everyone: own within 15 minutes, group admins any time; text, reactions and pin go', async () => {
      const g = await group(ali, [sara, omar]);
      const mine = await say(sara, g.id, 'oops wrong group');
      await t.http.put(url(g.id, mine.id, '/reaction')).set(omar.auth).send({ emoji: '😂' }).expect(200);
      await t.http.post(url(g.id, mine.id, '/pin')).set(sara.auth).expect(200);
      expect((await t.http.delete(url(g.id, mine.id)).query({ for: 'everyone' }).set(omar.auth)).status).toBe(403);
      const omarS = await conn(omar);
      const [d, live] = await Promise.all([t.http.delete(url(g.id, mine.id)).query({ for: 'everyone' }).set(sara.auth).expect(200), next(omarS, 'msg:update')]);
      expect(d.body).toMatchObject({ deleted: true, text: '' });
      expect(d.body.reactions).toBeUndefined();
      expect(live.message).toMatchObject({ id: mine.id, deleted: true, text: '' });
      expect((await t.http.get(`/v1/conversations/${g.id}`).set(ali.auth)).body.pins).toEqual([]);
      await t.http.delete(url(g.id, mine.id)).query({ for: 'everyone' }).set(sara.auth).expect(200); // again: fine
      // Admin removes someone else's message, even an old one.
      const old = await say(omar, g.id, 'spam');
      await age(old.id, 60 * 24);
      await t.http.delete(url(g.id, old.id)).query({ for: 'everyone' }).set(ali.auth).expect(200);
      // Own message after the window: only "for me".
      const late = await say(sara, g.id, 'late');
      await age(late.id, 20);
      expect((await t.http.delete(url(g.id, late.id)).query({ for: 'everyone' }).set(sara.auth)).status).toBe(409);
      expect((await t.http.delete(url(g.id, late.id)).set(sara.auth)).status).toBe(400);
      const line = (await history(ali, g.id))[0];
      expect((await t.http.delete(url(g.id, line.id)).query({ for: 'everyone' }).set(ali.auth)).status).toBe(400);
    });

    it('for me: gone from my devices only', async () => {
      const c = await direct(ali, sara);
      const m = await say(sara, c.id, 'something Ali wants gone');
      const ali2 = await signInEmail(t, (await t.http.get('/v1/me').set(ali.auth)).body.email, device(7));
      const other = await conn(ali2.tokens.accessToken);
      const [, live] = await Promise.all([t.http.delete(url(c.id, m.id)).query({ for: 'me' }).set(ali.auth).expect(200), next(other, 'msg:mine')]);
      expect(live).toEqual({ conversationId: c.id, messageId: m.id, hidden: true });
      expect(await find(ali, c.id, m.id)).toBeUndefined();
      expect((await find(sara, c.id, m.id))!.text).toBe('something Ali wants gone');
      expect((await t.http.put(url(c.id, m.id, '/reaction')).set(ali.auth).send({ emoji: '👍' })).status).toBe(404);
    });
  });

  describe('pin', () => {
    it('up to three; a fourth replaces the oldest; groups can limit pinning to admins', async () => {
      const g = await group(ali, [sara]);
      const ms = [await say(ali, g.id, 'one'), await say(ali, g.id, 'two'), await say(ali, g.id, 'three'), await say(ali, g.id, 'four')];
      for (const m of ms.slice(0, 3)) await t.http.post(url(g.id, m.id, '/pin')).set(sara.auth).expect(200);
      const s = (await t.http.post(url(g.id, ms[3].id, '/pin')).set(ali.auth).expect(200)).body as ConversationSummary;
      expect(s.pins.map((p) => p.text)).toEqual(['four', 'three', 'two']);
      expect(s.pins[0]).toMatchObject({ pinnedBy: ali.id, senderId: ali.id, seq: ms[3].seq });
      const before = (await history(ali, g.id)).length;
      await t.http.post(url(g.id, ms[3].id, '/pin')).set(ali.auth).expect(200); // already pinned: no new line
      expect((await history(ali, g.id)).length).toBe(before);
      expect((await history(sara, g.id)).slice(-1)[0].system).toEqual({ kind: 'pinned', messageId: ms[3].id, seq: ms[3].seq });
      await t.http.patch(`/v1/groups/${g.id}/settings`).set(ali.auth).send({ pin: 'admins' }).expect(200);
      const r = await t.http.delete(url(g.id, ms[3].id, '/pin')).set(sara.auth);
      expect(r.status).toBe(403);
      expect(r.body.error.message).toBe('Only admins can pin messages in this group.');
      expect(((await t.http.delete(url(g.id, ms[3].id, '/pin')).set(ali.auth).expect(200)).body as ConversationSummary).pins).toHaveLength(2);
    });
  });

  describe('star', () => {
    it('is private, survives in a starred list, and goes when the message is deleted for me', async () => {
      const c = await direct(ali, sara);
      const m = await say(sara, c.id, 'Wifi password: kheer123');
      const r = (await t.http.put(url(c.id, m.id, '/star')).set(ali.auth).expect(200)).body;
      expect(r.starred).toBe(true);
      expect((await find(ali, c.id, m.id))!.starred).toBe(true);
      expect((await find(sara, c.id, m.id))!.starred).toBe(false);
      const list = (await t.http.get('/v1/starred').set(ali.auth).expect(200)).body;
      expect(list.items[0]).toMatchObject({ conversationId: c.id, conversationName: 'Sara', message: { id: m.id, starred: true } });
      await t.http.delete(url(c.id, m.id)).query({ for: 'me' }).set(ali.auth).expect(200);
      expect((await t.http.get('/v1/starred').set(ali.auth).expect(200)).body.items.find((x: { message: { id: string } }) => x.message.id === m.id)).toBeUndefined();
    });
  });

  describe('message info', () => {
    it('lists who read and who received my message, with times; not for other people’s messages', async () => {
      const g = await group(ali, [sara, omar, zara]);
      const m = await say(ali, g.id, 'I’ll bring the kheer 🍮');
      await t.http.post(`/v1/conversations/${g.id}/delivered`).set(omar.auth).send({ seq: m.seq }).expect(200);
      await sleep(20);
      await t.http.post(`/v1/conversations/${g.id}/read`).set(sara.auth).send({ seq: m.seq }).expect(200);
      const nida = await makeUser(t, 'Nida');
      await t.http.post(`/v1/groups/${g.id}/members`).set(ali.auth).send({ userIds: [nida.id] }).expect(200);
      const info = (await t.http.get(url(g.id, m.id, '/info')).set(ali.auth).expect(200)).body;
      expect(info.readBy.map((x: { user: { displayName: string } }) => x.user.displayName)).toEqual(['Sara']);
      expect(info.deliveredTo.map((x: { user: { displayName: string } }) => x.user.displayName)).toEqual(['Omar']);
      expect(info.waiting.map((x: { displayName: string }) => x.displayName)).toEqual(['Zara']); // Nida joined later: not listed
      expect(Date.parse(info.readBy[0].at)).toBeGreaterThan(Date.parse(info.deliveredTo[0].at));
      expect((await t.http.get(url(g.id, m.id, '/info')).set(sara.auth)).status).toBe(403);
    });
  });

  describe('forward', () => {
    it('copies to several chats marked forwarded, with a note; reports chats it couldn’t reach', async () => {
      const c = await direct(ali, sara);
      const src = await say(sara, c.id, 'Poster for Friday 🎉');
      const g1 = await group(ali, [omar]);
      const ann = await group(zara, [ali], { settings: { send: 'admins' } });
      const targets = [g1.id, ann.id].map((conversationId) => ({ conversationId, clientId: cid(), commentClientId: cid() }));
      const r = (await t.http.post(url(c.id, src.id, '/forward')).set(ali.auth).send({ targets, comment: 'Look at this' }).expect(200)).body;
      expect(r[0]).toMatchObject({ conversationId: g1.id, ok: true, message: { forwarded: true, text: 'Poster for Friday 🎉', senderId: ali.id } });
      expect(r[1]).toEqual({ conversationId: ann.id, ok: false, error: 'Only admins can send messages in this group.' });
      expect((await history(omar, g1.id)).slice(-2).map((m) => [m.text, !!m.forwarded])).toEqual([['Poster for Friday 🎉', true], ['Look at this', false]]);
      // Retrying the same request makes nothing new.
      await t.http.post(url(c.id, src.id, '/forward')).set(ali.auth).send({ targets, comment: 'Look at this' }).expect(200);
      expect((await history(omar, g1.id)).filter((m) => m.text === 'Poster for Friday 🎉')).toHaveLength(1);
      const fwd = r[0].message as ChatMessage;
      expect((await t.http.patch(url(g1.id, fwd.id)).set(ali.auth).send({ text: 'changed' })).body.error.message).toBe('Forwarded messages can’t be edited.');
      const six = [...Array(6)].map(() => ({ conversationId: g1.id, clientId: cid() }));
      expect((await t.http.post(url(c.id, src.id, '/forward')).set(ali.auth).send({ targets: six })).status).toBe(400);
      expect((await t.http.post(url(c.id, src.id, '/forward')).set(ali.auth).send({ targets: [] })).status).toBe(400);
      expect((await t.http.post(url(c.id, src.id, '/forward')).set(omar.auth).send({ targets: [{ conversationId: g1.id, clientId: cid() }] })).status).toBe(404);
    });
  });
});

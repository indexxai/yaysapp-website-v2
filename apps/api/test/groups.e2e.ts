import { ObjectId } from 'mongodb';
import { tickFor, type ConversationSummary, type GroupInfo } from '@yays/shared';
import { startApp, type TestApp } from './helpers';
import { cid, connect, emit, makeUser, next, record, sleep, type TUser } from './chat-helpers';

describe('Groups', () => {
  let t: TestApp; let ali: TUser; let sara: TUser; let omar: TUser; let zara: TUser; let nida: TUser;
  const sockets: Array<{ close(): void }> = [];
  const conn = async (u: TUser) => { const s = await connect(t.url, u.token); sockets.push(s); return s; };
  const mk = (u: TUser, body: object) => t.http.post('/v1/groups').set(u.auth).send(body);
  const group = async (owner: TUser, members: TUser[], name = 'Family', extra: object = {}) => (await mk(owner, { name, memberIds: members.map((m) => m.id), ...extra }).expect(200)).body as ConversationSummary;
  const info = async (u: TUser, id: string) => (await t.http.get(`/v1/groups/${id}`).set(u.auth).expect(200)).body as GroupInfo;
  const conv = async (u: TUser, id: string) => (await t.http.get(`/v1/conversations/${id}`).set(u.auth).expect(200)).body as ConversationSummary;
  const say = (u: TUser, id: string, text: string) => t.http.post(`/v1/conversations/${id}/messages`).set(u.auth).send({ clientId: cid(), text });
  const history = async (u: TUser, id: string) => (await t.http.get(`/v1/conversations/${id}/messages`).query({ limit: 100 }).set(u.auth).expect(200)).body.items as Array<{ type: string; text: string; seq: number; system?: { kind: string } }>;
  const lines = async (u: TUser, id: string) => (await history(u, id)).map((m) => (m.type === 'system' ? `[${m.system!.kind}]` : m.text));

  beforeAll(async () => {
    t = await startApp();
    [ali, sara, omar, zara, nida] = [await makeUser(t, 'Ali'), await makeUser(t, 'Sara'), await makeUser(t, 'Omar'), await makeUser(t, 'Zara'), await makeUser(t, 'Nida')];
  });
  afterEach(() => { while (sockets.length) sockets.pop()!.close(); });
  afterAll(async () => { await t.close(); });

  describe('creating', () => {
    it('makes the creator owner and admin, adds a "created" line, and everyone sees it as unread', async () => {
      const saraS = await conn(sara);
      const [g, msg, upd] = await Promise.all([
        group(ali, [sara, omar], '  Sunday   lunch  ', { about: 'Lunches and recipes' }),
        next(saraS, 'msg:new'), next(saraS, 'conv:update'),
      ]);
      expect(g).toMatchObject({ kind: 'group', peer: null, canSend: true, lastSeq: 1, unread: 0 });
      expect(g.group).toMatchObject({ name: 'Sunday lunch', about: 'Lunches and recipes', memberCount: 3, role: 'admin', ownerId: ali.id, adminIds: [ali.id], settings: { send: 'all', editInfo: 'admins', addMembers: 'admins', approveNew: false } });
      expect(msg.message).toMatchObject({ type: 'system', system: { kind: 'created', name: 'Sunday lunch' }, senderId: ali.id, seq: 1 });
      expect(upd.conversationId).toBe(g.id);
      const hers = await conv(sara, g.id);
      expect(hers).toMatchObject({ unread: 1, lastSenderName: 'Ali', group: { role: 'member' } });
      const i = await info(sara, g.id);
      expect(i.members.map((m) => [m.displayName, m.admin, m.owner])).toEqual([['Sara', false, false], ['Ali', true, true], ['Omar', false, false]]);
      expect(i.inviteCode).toBeNull();
      expect(i.pendingRequests).toBe(0);
    });

    it('checks the name and the people', async () => {
      const err = async (body: object) => (await mk(ali, body).expect(400)).body.error.message as string;
      expect(await err({ name: '   ', memberIds: [sara.id] })).toBe('Give the group a name.');
      expect(await err({ name: 'x'.repeat(101), memberIds: [sara.id] })).toBe('Group names can be up to 100 characters.');
      expect(await err({ name: 'Solo', memberIds: [] })).toBe('Add at least one person to the group.');
      expect(await err({ name: 'Solo', memberIds: [ali.id] })).toBe('Add at least one person to the group.');
      expect(await err({ name: 'Ghosts', memberIds: [sara.id, new ObjectId().toHexString()] })).toBe('Some of the people you picked are not on YaysApp.');
      expect(await err({ name: 'Bad', memberIds: ['nope'] })).toBe('Not a valid id.');
      expect(await err({ name: 'Big', memberIds: [...Array(1024)].map(() => new ObjectId().toHexString()) })).toBe('A group can have up to 1024 members.');
      // Repeats and myself are ignored.
      const g = await group(ali, [sara, sara, ali], 'Dupes');
      expect(g.group!.memberCount).toBe(2);
    });
  });

  describe('who may do what', () => {
    it('members can’t rename by default; admins can, and can open it to everyone', async () => {
      const g = await group(ali, [sara]);
      expect((await t.http.patch(`/v1/groups/${g.id}`).set(sara.auth).send({ name: 'Mine now' })).status).toBe(403);
      const renamed = (await t.http.patch(`/v1/groups/${g.id}`).set(ali.auth).send({ name: 'Ahmed family', about: 'Hi all' }).expect(200)).body;
      expect(renamed.group).toMatchObject({ name: 'Ahmed family', about: 'Hi all' });
      expect((await lines(sara, g.id)).slice(-2)).toEqual(['[renamed]', '[about]']);
      // The same values again change nothing and add no lines.
      await t.http.patch(`/v1/groups/${g.id}`).set(ali.auth).send({ name: 'Ahmed family' }).expect(200);
      expect((await lines(sara, g.id))).toHaveLength(3);
      expect((await t.http.patch(`/v1/groups/${g.id}/settings`).set(sara.auth).send({ editInfo: 'all' })).status).toBe(403);
      await t.http.patch(`/v1/groups/${g.id}/settings`).set(ali.auth).send({ editInfo: 'all' }).expect(200);
      await t.http.patch(`/v1/groups/${g.id}`).set(sara.auth).send({ name: 'Sara’s group' }).expect(200);
      expect((await t.http.patch(`/v1/groups/${g.id}`).set(ali.auth).send({})).status).toBe(400);
      expect((await t.http.patch(`/v1/groups/${g.id}/settings`).set(ali.auth).send({ send: 'nobody' })).status).toBe(400);
    });

    it('an admins-only group refuses members’ messages, over HTTP and the socket', async () => {
      const g = await group(ali, [sara], 'Announcements', { settings: { send: 'admins' } });
      expect(g.group!.settings.send).toBe('admins');
      expect((await conv(sara, g.id)).canSend).toBe(false);
      const r = await say(sara, g.id, 'can I?');
      expect(r.status).toBe(403);
      expect(r.body.error.message).toBe('Only admins can send messages in this group.');
      const s = await conn(sara);
      expect(await emit(s, 'msg:send', { conversationId: g.id, clientId: cid(), text: 'socket?' })).toMatchObject({ ok: false, error: { status: 403 } });
      await say(ali, g.id, 'Welcome!').expect(200);
      await t.http.patch(`/v1/groups/${g.id}/settings`).set(ali.auth).send({ send: 'all' }).expect(200);
      await say(sara, g.id, 'Now I can').expect(200);
    });
  });

  describe('members', () => {
    it('new people see the group only from the line that added them', async () => {
      const g = await group(ali, [sara]);
      await say(sara, g.id, 'secret before Omar').expect(200);
      expect((await t.http.post(`/v1/groups/${g.id}/members`).set(sara.auth).send({ userIds: [omar.id] })).status).toBe(403);
      const omarS = await conn(omar);
      const [added, got] = await Promise.all([t.http.post(`/v1/groups/${g.id}/members`).set(ali.auth).send({ userIds: [omar.id] }).expect(200), next(omarS, 'msg:new')]);
      expect(added.body.group.memberCount).toBe(3);
      expect(got.message.system).toEqual({ kind: 'added', userIds: [omar.id] });
      expect(await lines(omar, g.id)).toEqual(['[added]']);
      expect((await t.http.get(`/v1/conversations/${g.id}/messages`).query({ after: 0 }).set(omar.auth).expect(200)).body.items).toHaveLength(1);
      expect((await t.http.get(`/v1/conversations/${g.id}/messages`).query({ before: 3 }).set(omar.auth).expect(200)).body.items).toEqual([]);
      expect((await conv(omar, g.id))).toMatchObject({ unread: 1, lastMessage: { system: { kind: 'added' } } });
      expect((await t.http.post(`/v1/groups/${g.id}/members`).set(ali.auth).send({ userIds: [omar.id] })).status).toBe(400);
      expect((await t.http.post(`/v1/groups/${g.id}/members`).set(ali.auth).send({ userIds: [] })).status).toBe(400);
    });

    it('a removed person keeps the history up to then, read-only, and can delete the chat afterwards', async () => {
      const g = await group(ali, [sara, omar]);
      await say(omar, g.id, 'hello all').expect(200);
      const omarS = await conn(omar);
      const [, upd] = await Promise.all([t.http.delete(`/v1/groups/${g.id}/members/${omar.id}`).set(ali.auth).expect(200), next(omarS, 'conv:update')]);
      expect(upd.conversationId).toBe(g.id);
      await say(ali, g.id, 'after Omar left').expect(200);
      const his = await conv(omar, g.id);
      expect(his).toMatchObject({ canSend: false, group: { role: 'former' } });
      expect(his.lastMessage!.system).toEqual({ kind: 'removed', userIds: [omar.id] });
      expect(await lines(omar, g.id)).toEqual(['[created]', 'hello all', '[removed]']);
      expect((await say(omar, g.id, 'let me back')).status).toBe(404);
      expect((await t.http.get('/v1/conversations').set(omar.auth).expect(200)).body.items.map((c: ConversationSummary) => c.id)).toContain(g.id);
      await t.http.post(`/v1/conversations/${g.id}/read`).set(omar.auth).send({ seq: 99 }).expect(200);
      expect((await conv(omar, g.id)).unread).toBe(0);
      expect((await t.http.delete(`/v1/groups/${g.id}`).set(sara.auth)).status).toBe(409); // still a member
      await t.http.delete(`/v1/groups/${g.id}`).set(omar.auth).expect(204);
      expect((await t.http.get(`/v1/conversations/${g.id}`).set(omar.auth)).status).toBe(404);
      expect((await t.http.get('/v1/conversations').set(omar.auth).expect(200)).body.items.map((c: ConversationSummary) => c.id)).not.toContain(g.id);
    });

    it('only admins remove people; the creator and non-members can’t be removed; leaving is separate', async () => {
      const g = await group(ali, [sara, omar]);
      expect((await t.http.delete(`/v1/groups/${g.id}/members/${omar.id}`).set(sara.auth)).status).toBe(403);
      await t.http.post(`/v1/groups/${g.id}/admins/${sara.id}`).set(ali.auth).expect(200);
      expect((await t.http.delete(`/v1/groups/${g.id}/members/${ali.id}`).set(sara.auth)).status).toBe(403);
      expect((await t.http.delete(`/v1/groups/${g.id}/members/${zara.id}`).set(sara.auth)).status).toBe(404);
      expect((await t.http.delete(`/v1/groups/${g.id}/members/${sara.id}`).set(sara.auth)).status).toBe(400);
      expect((await t.http.delete(`/v1/groups/${g.id}/members/nope`).set(sara.auth)).status).toBe(404);
      await t.http.delete(`/v1/groups/${g.id}/members/${omar.id}`).set(sara.auth).expect(200);
    });

    it('when the last admin leaves, the longest-standing member becomes admin', async () => {
      const g = await group(ali, [sara, omar]);
      const left = (await t.http.post(`/v1/groups/${g.id}/leave`).set(ali.auth).expect(200)).body;
      expect(left.group.role).toBe('former');
      const i = await info(sara, g.id);
      expect(i.adminIds).toEqual([sara.id]);
      expect((await lines(sara, g.id)).slice(-2)).toEqual(['[left]', '[admin]']);
      expect((await t.http.post(`/v1/groups/${g.id}/leave`).set(ali.auth)).status).toBe(404);
      // The only admin can't step down while others remain.
      expect((await t.http.delete(`/v1/groups/${g.id}/admins/${sara.id}`).set(sara.auth)).status).toBe(409);
      // Everyone leaving leaves an empty group without errors.
      await t.http.post(`/v1/groups/${g.id}/leave`).set(sara.auth).expect(200);
      await t.http.post(`/v1/groups/${g.id}/leave`).set(omar.auth).expect(200);
      expect((await t.db.collection('yc_conversations').findOne({ _id: new ObjectId(g.id) }))!.members).toEqual([]);
    });

    it('admins: make and dismiss; the creator stays admin', async () => {
      const g = await group(ali, [sara, omar]);
      expect((await t.http.post(`/v1/groups/${g.id}/admins/${omar.id}`).set(sara.auth)).status).toBe(403);
      await t.http.post(`/v1/groups/${g.id}/admins/${sara.id}`).set(ali.auth).expect(200);
      await t.http.post(`/v1/groups/${g.id}/admins/${sara.id}`).set(ali.auth).expect(200); // already admin: no change
      expect((await lines(ali, g.id)).filter((l) => l === '[admin]')).toHaveLength(1);
      expect((await t.http.delete(`/v1/groups/${g.id}/admins/${ali.id}`).set(sara.auth)).status).toBe(403);
      await t.http.delete(`/v1/groups/${g.id}/admins/${sara.id}`).set(ali.auth).expect(200);
      expect((await info(ali, g.id)).adminIds).toEqual([ali.id]);
      expect((await t.http.post(`/v1/groups/${g.id}/admins/${zara.id}`).set(ali.auth)).status).toBe(404);
    });

    it('a group stops at 1,024 members', async () => {
      const g = await group(ali, [sara]);
      const fillers = [...Array(1021)].map(() => new ObjectId());
      await t.db.collection('yc_conversations').updateOne({ _id: new ObjectId(g.id) }, { $push: { members: { $each: fillers } } } as never);
      const r = await t.http.post(`/v1/groups/${g.id}/members`).set(ali.auth).send({ userIds: [omar.id, zara.id] });
      expect(r.status).toBe(409);
      expect(r.body.error.message).toBe('A group can have up to 1024 members. This would make 1025.');
      await t.http.post(`/v1/groups/${g.id}/members`).set(ali.auth).send({ userIds: [omar.id] }).expect(200);
    });

    it('former members brought back start fresh from the line that re-added them', async () => {
      const g = await group(ali, [sara]);
      await t.http.post(`/v1/groups/${g.id}/leave`).set(sara.auth).expect(200);
      await say(ali, g.id, 'while Sara was away').expect(200);
      await t.http.post(`/v1/groups/${g.id}/members`).set(ali.auth).send({ userIds: [sara.id] }).expect(200);
      expect(await lines(sara, g.id)).toEqual(['[added]']);
      expect((await conv(sara, g.id)).group!.role).toBe('member');
    });
  });

  describe('ticks, typing and unread in groups', () => {
    it('read ticks need everyone; typing reaches every other member', async () => {
      const g = await group(ali, [sara, omar]);
      const sent = (await say(ali, g.id, 'who is coming?').expect(200)).body.message;
      await t.http.post(`/v1/conversations/${g.id}/read`).set(sara.auth).send({ seq: sent.seq }).expect(200);
      expect(tickFor(sent, await conv(ali, g.id))).toBe('sent');
      await t.http.post(`/v1/conversations/${g.id}/delivered`).set(omar.auth).send({ seq: sent.seq }).expect(200);
      expect(tickFor(sent, await conv(ali, g.id))).toBe('delivered');
      await t.http.post(`/v1/conversations/${g.id}/read`).set(omar.auth).send({ seq: sent.seq }).expect(200);
      expect(tickFor(sent, await conv(ali, g.id))).toBe('read');
      const [aS, sS, oS] = [await conn(ali), await conn(sara), await conn(omar)];
      const mine = record(aS, 'typing');
      const [ts, to] = await Promise.all([next(sS, 'typing'), next(oS, 'typing'), emit(aS, 'typing', { conversationId: g.id, on: true })]);
      expect([ts.userId, to.userId]).toEqual([ali.id, ali.id]);
      await sleep(150);
      expect(mine).toEqual([]);
    });
  });

  describe('invite links', () => {
    it('admins share a link; people join and see only from their "joined" line', async () => {
      const g = await group(ali, [sara]);
      await say(sara, g.id, 'before the link').expect(200);
      expect((await t.http.post(`/v1/groups/${g.id}/invite`).set(sara.auth)).status).toBe(403);
      const { inviteCode } = (await t.http.post(`/v1/groups/${g.id}/invite`).set(ali.auth).expect(200)).body;
      expect(inviteCode).toMatch(/^[A-Za-z0-9]{16}$/);
      expect((await info(ali, g.id)).inviteCode).toBe(inviteCode);
      expect((await info(sara, g.id)).inviteCode).toBeNull(); // members can't add people here, so no link
      const pv = (await t.http.get(`/v1/invites/${inviteCode}`).set(zara.auth).expect(200)).body;
      expect(pv).toMatchObject({ conversationId: g.id, name: 'Family', memberCount: 2, alreadyMember: false, needsApproval: false, requested: false });
      const j = (await t.http.post(`/v1/invites/${inviteCode}/join`).set(zara.auth).expect(200)).body;
      expect(j.status).toBe('joined');
      expect(j.conversation).toMatchObject({ id: g.id, unread: 0, group: { role: 'member', memberCount: 3 } });
      expect(await lines(zara, g.id)).toEqual(['[joined]']);
      // Joining twice is harmless.
      expect((await t.http.post(`/v1/invites/${inviteCode}/join`).set(zara.auth).expect(200)).body.status).toBe('joined');
      expect((await info(ali, g.id)).memberCount).toBe(3);
    });

    it('a reset or revoked link stops working; bad links get a clear message', async () => {
      const g = await group(ali, [sara]);
      const first = (await t.http.post(`/v1/groups/${g.id}/invite`).set(ali.auth).expect(200)).body.inviteCode;
      const second = (await t.http.post(`/v1/groups/${g.id}/invite`).set(ali.auth).expect(200)).body.inviteCode;
      expect(second).not.toBe(first);
      expect((await lines(ali, g.id)).slice(-1)).toEqual(['[invite_reset]']);
      const old = await t.http.post(`/v1/invites/${first}/join`).set(zara.auth);
      expect(old.status).toBe(404);
      expect(old.body.error.message).toBe('This invite link was reset or doesn’t exist. Ask for a new one.');
      await t.http.delete(`/v1/groups/${g.id}/invite`).set(ali.auth).expect(204);
      expect((await t.http.get(`/v1/invites/${second}`).set(zara.auth)).status).toBe(404);
      for (const bad of ['x', 'has spaces in it!', '../../etc']) expect((await t.http.get(`/v1/invites/${encodeURIComponent(bad)}`).set(zara.auth)).status).toBe(404);
      expect((await t.http.get(`/v1/invites/${second}`)).status).toBe(401);
    });

    it('with approval on, joining makes a request that admins approve or reject', async () => {
      const g = await group(ali, [sara], 'Club', {});
      await t.http.patch(`/v1/groups/${g.id}/settings`).set(ali.auth).send({ approveNew: true }).expect(200);
      const code = (await t.http.post(`/v1/groups/${g.id}/invite`).set(ali.auth).expect(200)).body.inviteCode;
      const aliS = await conn(ali);
      const [req, upd] = await Promise.all([t.http.post(`/v1/invites/${code}/join`).set(zara.auth).expect(200), next(aliS, 'conv:update')]);
      expect(req.body).toEqual({ status: 'requested' });
      expect(upd.conversationId).toBe(g.id);
      expect((await t.http.get(`/v1/invites/${code}`).set(zara.auth).expect(200)).body).toMatchObject({ requested: true, needsApproval: true });
      await t.http.post(`/v1/invites/${code}/join`).set(nida.auth).expect(200);
      await t.http.post(`/v1/invites/${code}/join`).set(omar.auth).expect(200);
      expect((await info(ali, g.id)).pendingRequests).toBe(3);
      expect((await info(sara, g.id)).pendingRequests).toBe(0);
      expect((await t.http.get(`/v1/groups/${g.id}/requests`).set(sara.auth)).status).toBe(403);
      const list = (await t.http.get(`/v1/groups/${g.id}/requests`).set(ali.auth).expect(200)).body;
      expect(list.map((r: { user: { displayName: string } }) => r.user.displayName)).toEqual(['Zara', 'Nida', 'Omar']);
      await t.http.post(`/v1/groups/${g.id}/requests/${zara.id}`).set(ali.auth).expect(200);
      expect((await conv(zara, g.id)).group!.role).toBe('member');
      expect((await t.http.post(`/v1/groups/${g.id}/requests/${zara.id}`).set(ali.auth)).status).toBe(404);
      await t.http.delete(`/v1/groups/${g.id}/requests/${nida.id}`).set(ali.auth).expect(204);
      expect((await t.http.get(`/v1/conversations/${g.id}`).set(nida.auth)).status).toBe(404);
      // Omar changes his mind.
      await t.http.delete(`/v1/invites/${code}/request`).set(omar.auth).expect(204);
      expect((await info(ali, g.id)).pendingRequests).toBe(0);
    });

    it('turning approval off lets everyone who was waiting in', async () => {
      const g = await group(ali, [sara]);
      await t.http.patch(`/v1/groups/${g.id}/settings`).set(ali.auth).send({ approveNew: true }).expect(200);
      const code = (await t.http.post(`/v1/groups/${g.id}/invite`).set(ali.auth).expect(200)).body.inviteCode;
      await t.http.post(`/v1/invites/${code}/join`).set(zara.auth).expect(200);
      await t.http.post(`/v1/invites/${code}/join`).set(nida.auth).expect(200);
      await t.http.patch(`/v1/groups/${g.id}/settings`).set(ali.auth).send({ approveNew: false }).expect(200);
      const i = await info(ali, g.id);
      expect(i.memberCount).toBe(4);
      expect(i.pendingRequests).toBe(0);
    });
  });

  it('outsiders can’t see or change a group', async () => {
    const g = await group(ali, [sara]);
    expect((await t.http.get(`/v1/groups/${g.id}`).set(zara.auth)).status).toBe(404);
    expect((await t.http.patch(`/v1/groups/${g.id}`).set(zara.auth).send({ name: 'x' })).status).toBe(404);
    expect((await t.http.post(`/v1/groups/${g.id}/members`).set(zara.auth).send({ userIds: [zara.id] })).status).toBe(404);
    expect((await t.http.post(`/v1/groups/${g.id}/leave`).set(zara.auth)).status).toBe(404);
    // A direct chat is not a group.
    const d = (await t.http.post('/v1/conversations/direct').set(ali.auth).send({ userId: sara.id }).expect(200)).body;
    expect((await t.http.get(`/v1/groups/${d.id}`).set(ali.auth)).status).toBe(404);
  });
});

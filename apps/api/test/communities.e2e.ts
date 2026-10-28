import type { CommunityInfo, CommunityReport, ConversationSummary } from '@yays/shared';
import { startApp, type TestApp } from './helpers';
import { cid, makeUser, type TUser } from './chat-helpers';

describe('Communities', () => {
  let t: TestApp; let ali: TUser; let sara: TUser; let omar: TUser; let zara: TUser;
  const api = (u: TUser) => ({
    get: (p: string) => t.http.get(p).set(u.auth),
    post: (p: string, b: object = {}) => t.http.post(p).set(u.auth).send(b),
    patch: (p: string, b: object) => t.http.patch(p).set(u.auth).send(b),
    put: (p: string, b: object = {}) => t.http.put(p).set(u.auth).send(b),
    del: (p: string) => t.http.delete(p).set(u.auth),
  });
  const info = async (u: TUser, id: string) => (await api(u).get(`/v1/communities/${id}`).expect(200)).body as CommunityInfo;
  const say = (u: TUser, c: string, text: string) => api(u).post(`/v1/conversations/${c}/messages`, { clientId: cid(), text });
  beforeAll(async () => {
    t = await startApp();
    [ali, sara, omar, zara] = [await makeUser(t, 'Ali'), await makeUser(t, 'Sara'), await makeUser(t, 'Omar'), await makeUser(t, 'Zara')];
  });
  afterAll(async () => { await t.close(); });

  it('creates a community with an announcements group, brings in a group I run, and makes new ones', async () => {
    const mine = (await api(ali).post('/v1/groups', { name: 'Runners chat', memberIds: [sara.id] }).expect(200)).body.id;
    const theirs = (await api(sara).post('/v1/groups', { name: 'Sara’s group', memberIds: [ali.id] }).expect(200)).body.id;
    expect((await api(ali).post('/v1/communities', { name: 'Lahore Runners', groupIds: [theirs] })).status).toBe(403); // not my group to add
    const c = (await api(ali).post('/v1/communities', { name: 'Lahore Runners', about: 'Weekend runs', groupIds: [mine], newGroups: ['Race sign-ups'] }).expect(200)).body as CommunityInfo;
    expect(c).toMatchObject({ name: 'Lahore Runners', role: 'admin', memberCount: 1, groupCount: 2, inviteCode: null, limits: { members: 5000, groups: 50 } });
    expect(c.groups.map((g) => [g.name, g.announcements, g.joined])).toEqual([['Announcements', true, true], ['Race sign-ups', false, true], ['Runners chat', false, true]].sort((a, b) => Number(b[1]) - Number(a[1])) as never);
    // The linked group says so, and its header knows its community.
    const g = (await api(sara).get(`/v1/conversations/${mine}`).expect(200)).body as ConversationSummary;
    expect(g.group?.community).toEqual({ id: c.id, name: 'Lahore Runners' });
    expect(g.lastMessage?.system).toEqual({ kind: 'community', name: 'Lahore Runners', added: true });
    // Only admins post in announcements; nobody manages its members directly.
    const ann = (await api(ali).get(`/v1/conversations/${c.announcementsId}`).expect(200)).body as ConversationSummary;
    expect(ann.group).toMatchObject({ announcements: true, settings: { send: 'admins' } });
    expect((await api(ali).post(`/v1/groups/${c.announcementsId}/members`, { userIds: [zara.id] })).status).toBe(400);
    expect((await api(ali).post(`/v1/groups/${c.announcementsId}/leave`)).status).toBe(400);
    expect((await api(ali).post('/v1/communities', { name: 'Other', groupIds: [mine] })).status).toBe(409); // already in one
  });

  it('joining by link: straight in, or ask and get approved; then join its groups', async () => {
    const c = (await api(ali).post('/v1/communities', { name: 'Gulberg Residents', newGroups: ['Block C'] }).expect(200)).body as CommunityInfo;
    const { inviteCode } = (await api(ali).post(`/v1/communities/${c.id}/invite`).expect(200)).body;
    expect((await api(sara).get(`/v1/community-invites/${inviteCode}`).expect(200)).body).toMatchObject({ name: 'Gulberg Residents', memberCount: 1, groupCount: 1, alreadyMember: false, needsApproval: false });
    expect((await api(sara).get(`/v1/communities/${c.id}`)).status).toBe(404); // not a member yet
    const j = (await api(sara).post(`/v1/community-invites/${inviteCode}/join`).expect(200)).body;
    expect(j.status).toBe('joined');
    expect(j.community.memberCount).toBe(2);
    // In the announcements group, quietly (no "joined" line), and sees only what's said from now on.
    await say(ali, c.announcementsId, 'Water off on Sunday').expect(200);
    const ann = (await api(sara).get(`/v1/conversations/${c.announcementsId}/messages`).expect(200)).body.items;
    expect(ann.map((m: { text: string }) => m.text)).toEqual(['Water off on Sunday']);
    expect((await say(sara, c.announcementsId, 'me too')).status).toBe(403);
    // Join a group in it.
    const block = j.community.groups.find((g: { name: string }) => g.name === 'Block C');
    expect(block).toMatchObject({ joined: false, needsApproval: false });
    expect((await api(sara).post(`/v1/communities/${c.id}/groups/${block.id}/join`).expect(200)).body.status).toBe('joined');
    expect((await api(zara).post(`/v1/communities/${c.id}/groups/${block.id}/join`)).status).toBe(404); // not in the community

    // Approval on: Omar asks, Ali approves.
    await api(ali).patch(`/v1/communities/${c.id}`, { approveNew: true }).expect(200);
    expect((await api(omar).post(`/v1/community-invites/${inviteCode}/join`).expect(200)).body).toEqual({ status: 'requested' });
    expect((await info(ali, c.id)).pendingRequests).toBe(1);
    expect((await api(ali).get(`/v1/communities/${c.id}/requests`).expect(200)).body.map((r: { user: { id: string } }) => r.user.id)).toEqual([omar.id]);
    expect((await api(sara).get(`/v1/communities/${c.id}/requests`)).status).toBe(403);
    await api(ali).post(`/v1/communities/${c.id}/requests/${omar.id}/approve`).expect(200);
    expect((await info(omar, c.id)).memberCount).toBe(3);
    expect((await api(omar).get('/v1/communities').expect(200)).body.map((x: { name: string }) => x.name)).toEqual(['Gulberg Residents']);
  });

  it('leaving takes you out of every group; admins can remove people; the last admin hands over', async () => {
    const c = (await api(ali).post('/v1/communities', { name: 'Design Guild', newGroups: ['Critique'] }).expect(200)).body as CommunityInfo;
    const { inviteCode } = (await api(ali).post(`/v1/communities/${c.id}/invite`).expect(200)).body;
    for (const u of [sara, omar]) await api(u).post(`/v1/community-invites/${inviteCode}/join`).expect(200);
    const crit = c.groups.find((g) => g.name === 'Critique')!.id;
    for (const u of [sara, omar]) await api(u).post(`/v1/communities/${c.id}/groups/${crit}/join`).expect(200);
    await api(omar).post(`/v1/communities/${c.id}/leave`).expect(204);
    expect((await api(omar).get(`/v1/communities/${c.id}`)).status).toBe(404);
    expect(((await api(omar).get(`/v1/conversations/${crit}`).expect(200)).body as ConversationSummary).group?.role).toBe('former');
    expect(((await api(omar).get(`/v1/conversations/${c.announcementsId}`).expect(200)).body as ConversationSummary).group?.role).toBe('former');
    // Remove Sara; make her... she is gone.
    await api(ali).del(`/v1/communities/${c.id}/members/${sara.id}`).expect(204);
    expect((await info(ali, c.id)).memberCount).toBe(1);
    expect(((await api(sara).get(`/v1/conversations/${crit}`).expect(200)).body as ConversationSummary).group?.role).toBe('former');
    // A second admin, then the creator leaves: the other admin runs it.
    await api(zara).post(`/v1/community-invites/${inviteCode}/join`).expect(200);
    await api(ali).put(`/v1/communities/${c.id}/admins/${zara.id}`).expect(204);
    expect(((await api(zara).get(`/v1/conversations/${c.announcementsId}`).expect(200)).body as ConversationSummary).canSend).toBe(true);
    await api(ali).post(`/v1/communities/${c.id}/leave`).expect(204);
    const z = await info(zara, c.id);
    expect(z).toMatchObject({ role: 'admin', ownerId: zara.id, memberCount: 1 });
    const members = (await api(zara).get(`/v1/communities/${c.id}/members`).expect(200)).body.items;
    expect(members.map((m: { id: string; owner: boolean }) => [m.id, m.owner])).toEqual([[zara.id, true]]);
  });

  it('members suggest groups, admins add them; groups can be taken out again', async () => {
    const c = (await api(ali).post('/v1/communities', { name: 'FAST Alumni', membersSuggest: true }).expect(200)).body as CommunityInfo;
    const { inviteCode } = (await api(ali).post(`/v1/communities/${c.id}/invite`).expect(200)).body;
    await api(sara).post(`/v1/community-invites/${inviteCode}/join`).expect(200);
    const sg = (await api(sara).post('/v1/groups', { name: 'Batch 2019', memberIds: [omar.id] }).expect(200)).body.id;
    await api(sara).post(`/v1/communities/${c.id}/suggestions/${sg}`).expect(204);
    const withSugg = await info(ali, c.id);
    expect(withSugg.suggestions.map((s) => [s.group.name, s.by.id])).toEqual([['Batch 2019', sara.id]]);
    expect((await info(sara, c.id)).suggestions).toEqual([]); // admins only
    const added = (await api(ali).post(`/v1/communities/${c.id}/suggestions/${sg}/approve`).expect(200)).body as CommunityInfo;
    expect(added.groups.map((g) => g.name)).toContain('Batch 2019');
    expect(added.suggestions).toEqual([]);
    const out = (await api(ali).del(`/v1/communities/${c.id}/groups/${sg}`).expect(200)).body as CommunityInfo;
    expect(out.groups.map((g) => g.name)).not.toContain('Batch 2019');
    expect(((await api(sara).get(`/v1/conversations/${sg}`).expect(200)).body as ConversationSummary).group?.community).toBeNull();
    expect((await api(ali).del(`/v1/communities/${c.id}/groups/${c.announcementsId}`)).status).toBe(400);
  });

  it('admins see reported messages in their groups and act on them; the reporter stays anonymous', async () => {
    const c = (await api(ali).post('/v1/communities', { name: 'BTCY Traders', newGroups: ['General'] }).expect(200)).body as CommunityInfo;
    const { inviteCode } = (await api(ali).post(`/v1/communities/${c.id}/invite`).expect(200)).body;
    for (const u of [sara, omar, zara]) await api(u).post(`/v1/community-invites/${inviteCode}/join`).expect(200);
    const gen = c.groups.find((g) => g.name === 'General')!.id;
    for (const u of [sara, omar, zara]) await api(u).post(`/v1/communities/${c.id}/groups/${gen}/join`).expect(200);
    const spam = (await say(omar, gen, 'DM me to double your BTCY in 24 hours').expect(200)).body.message;
    const rude = (await say(zara, gen, 'only an idiot asks that').expect(200)).body.message;
    await api(sara).post('/v1/reports', { conversationId: gen, messageId: spam.id, reason: 'scam' }).expect(204);
    await api(ali).post('/v1/reports', { conversationId: gen, messageId: spam.id, reason: 'scam' }).expect(204);
    await api(sara).post('/v1/reports', { conversationId: gen, messageId: rude.id, reason: 'harassment' }).expect(204);
    expect((await api(omar).post('/v1/reports', { conversationId: gen, messageId: spam.id, reason: 'spam' })).status).toBe(400); // own message
    const list = (await api(ali).get(`/v1/communities/${c.id}/reports`).expect(200)).body as CommunityReport[];
    expect(list.map((r) => [r.message?.text, r.reports, r.reason, r.chat.name, r.sender?.id])).toEqual([
      ['only an idiot asks that', 1, 'harassment', 'General', zara.id],
      ['DM me to double your BTCY in 24 hours', 2, 'scam', 'General', omar.id],
    ]);
    expect(JSON.stringify(list)).not.toContain(sara.id); // who reported isn't shown
    expect((await api(sara).get(`/v1/communities/${c.id}/reports`)).status).toBe(403);
    // Delete the scam for everyone and remove its sender; keep the other.
    const scamCard = list.find((r) => r.reason === 'scam')!;
    await api(ali).post(`/v1/communities/${c.id}/reports/${scamCard.id}`, { action: 'delete' }).expect(204);
    expect((await api(sara).get(`/v1/conversations/${gen}/messages`).expect(200)).body.items.find((m: { id: string }) => m.id === spam.id).deleted).toBe(true);
    await api(sara).post('/v1/reports', { conversationId: gen, messageId: rude.id, reason: 'harassment' }).expect(204);
    const again = (await api(ali).get(`/v1/communities/${c.id}/reports`).expect(200)).body as CommunityReport[];
    expect(again.map((r) => [r.reason, r.reports])).toEqual([['harassment', 2]]);
    await api(ali).post(`/v1/communities/${c.id}/reports/${again[0].id}`, { action: 'remove' }).expect(204);
    expect((await api(zara).get(`/v1/communities/${c.id}`)).status).toBe(404);
    expect((await api(ali).get(`/v1/communities/${c.id}/reports`).expect(200)).body).toEqual([]);
  });

  it('checks names and limits', async () => {
    expect((await api(ali).post('/v1/communities', { name: '  ' })).status).toBe(400);
    expect((await api(ali).post('/v1/communities', { name: 'x'.repeat(101) })).status).toBe(400);
    const c = (await api(ali).post('/v1/communities', { name: 'Tiny' }).expect(200)).body as CommunityInfo;
    await t.db.collection('yc_communities').updateOne({ _id: new (await import('mongodb')).ObjectId(c.id) }, { $set: { memberCount: 5000 } });
    const { inviteCode } = (await api(ali).post(`/v1/communities/${c.id}/invite`).expect(200)).body;
    const r = await api(sara).post(`/v1/community-invites/${inviteCode}/join`);
    expect(r.status).toBe(409);
    expect(r.body.error.message).toBe('This community is full.');
  });
});

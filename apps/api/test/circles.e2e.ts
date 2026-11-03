import { ObjectId } from 'mongodb';
import type { CircleComment, CircleDiscover, CircleEvent, CircleFeed, CirclePost, CircleReview, CircleView, MyCircles } from '@yays/shared';
import { moneySchemeMatches } from '@yays/shared';
import { lastCode, startApp, type TestApp } from './helpers';
import { makeUser, type TUser } from './chat-helpers';

const png = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(2000, 7)]);
const HOUR = 3600_000, DAY = 24 * HOUR;
const at = (ms: number) => new Date(Date.now() + ms).toISOString();

describe('Circles', () => {
  let t: TestApp; let owner: TUser; let sara: TUser; let omar: TUser; let hana: TUser; let king: TUser;
  const api = (u: TUser) => ({
    get: (p: string) => t.http.get(p).set(u.auth),
    post: (p: string, b: object = {}) => t.http.post(p).set(u.auth).send(b),
    patch: (p: string, b: object) => t.http.patch(p).set(u.auth).send(b),
    put: (p: string, b: object = {}) => t.http.put(p).set(u.auth).send(b),
    del: (p: string) => t.http.delete(p).set(u.auth),
  });
  const view = async (u: TUser, id: string) => (await api(u).get(`/v1/circles/${id}`).expect(200)).body as CircleView;
  const feed = async (u: TUser, id: string) => (await api(u).get(`/v1/circles/${id}/posts`).expect(200)).body as CircleFeed;
  const post = async (u: TUser, id: string, text: string, extra: object = {}) => (await api(u).post(`/v1/circles/${id}/posts`, { text, ...extra }).expect(200)).body as CirclePost;
  const make = async (u: TUser, b: object) => (await api(u).post('/v1/circles', b).expect(200)).body as CircleView;
  const official = (id: string) => t.db.collection('yc_communities').updateOne({ _id: new ObjectId(id) }, { $set: { official: true } });
  const resetLimits = async () => { const k = await t.redis.keys('rl:*'); if (k.length) await t.redis.del(...k); };

  let btcy: CircleView; let wellness: CircleView;
  beforeAll(async () => {
    t = await startApp();
    [owner, sara, omar, hana, king] = [await makeUser(t, 'Bilal'), await makeUser(t, 'Sara'), await makeUser(t, 'Omar'), await makeUser(t, 'Hana'), await makeUser(t, 'King')];
    btcy = await make(owner, { name: 'Bitcoin YAY Circle', about: 'Updates, mining tips and support from the BTCY team', category: 'crypto', rules: ['Be kind and on topic', 'No investment promotion or asking for money'] });
    await official(btcy.id);
    wellness = await make(owner, { name: 'ReHuman Wellness Club', about: 'Habits, sleep and nutrition', category: 'wellness', visibility: 'private', joinQuestion: 'Why do you want to join?' });
  });
  afterAll(async () => { await t.close(); });

  it('the money-scheme check marks the parts that promise profits or ask for money', () => {
    const text = 'Guaranteed 10% daily profit on BTCY! DM me to invest, only 5 spots left.';
    expect(moneySchemeMatches(text).map((m) => m.text)).toEqual(['Guaranteed 10% daily profit', 'DM me to invest']);
    expect(moneySchemeMatches('💰 100x signals daily! Send 0.1 BTC to join my VIP group')).toHaveLength(3);
    expect(moneySchemeMatches('Is mining paused when my phone is off?')).toEqual([]);
    // Warning people about scams isn't a scam.
    expect(moneySchemeMatches('Rule of thumb: nobody legit will ever ask you to send crypto first. Report it.')).toEqual([]);
    expect(moneySchemeMatches('Send your USDT to me and earn').map((m) => m.text)).toEqual(['Send your USDT to me']);
  });

  it('new people see no circles yet; Discover lists circles with the official one featured', async () => {
    expect((await api(sara).get('/v1/circles').expect(200)).body).toEqual({ circles: [], upcoming: [] });
    const d = (await api(sara).get('/v1/circles/discover').expect(200)).body as CircleDiscover;
    expect(d.featured).toMatchObject({ name: 'Bitcoin YAY Circle', official: true, role: null, visibility: 'public' });
    expect(d.items.map((c) => [c.name, c.visibility])).toEqual([['ReHuman Wellness Club', 'private']]);
    const w = (await api(sara).get('/v1/circles/discover?category=wellness').expect(200)).body as CircleDiscover;
    expect(w.featured).toBeNull();
    expect(w.items.map((c) => c.name)).toEqual(['ReHuman Wellness Club']);
  });

  it('a search that finds nothing suggests a spelling', async () => {
    const d = (await api(sara).get(`/v1/circles/discover?q=${encodeURIComponent('bitcion minning')}`).expect(200)).body as CircleDiscover;
    expect(d.items).toEqual([]);
    expect(d.didYouMean).toBe('bitcoin mining');
    expect(((await api(sara).get('/v1/circles/discover?q=bitcoin').expect(200)).body as CircleDiscover).items.map((c) => c.name)).toEqual(['Bitcoin YAY Circle']);
  });

  it('only checked circles can say “official”, and look-alikes are flagged', async () => {
    const r = await api(king).post('/v1/circles', { name: 'Bitcoin YAY Official Signals' });
    expect(r.status).toBe(400);
    expect(r.body.error.message).toMatch(/official/);
    const fake = await make(king, { name: 'Bitcoin YAY Signals', category: 'crypto' });
    expect(fake.lookalike).toBe(true);
    const d = (await api(sara).get('/v1/circles/discover?q=bitcoin%20yay').expect(200)).body as CircleDiscover;
    expect(d.items.map((c) => [c.name, c.official, c.lookalike])).toEqual([['Bitcoin YAY Circle', true, false], ['Bitcoin YAY Signals', false, true]]);
    expect((await api(king).patch(`/v1/circles/${fake.id}`, { name: 'Official BTCY' })).status).toBe(400);
    await api(king).del(`/v1/circles/${fake.id}`).expect(204);
  });

  it('visitors read a public circle but must join to post; joining a public circle is instant', async () => {
    const v = await view(sara, btcy.id);
    expect(v).toMatchObject({ access: 'visitor', canRead: true, official: true, rules: ['Be kind and on topic', 'No investment promotion or asking for money'] });
    expect(v.owners.map((o) => [o.displayName, o.role])).toEqual([['Bilal', 'owner']]);
    await feed(sara, btcy.id);
    expect((await api(sara).post(`/v1/circles/${btcy.id}/posts`, { text: 'hi' })).status).toBe(403);
    const j = (await api(sara).post(`/v1/circles/${btcy.id}/join`).expect(200)).body as CircleView;
    expect(j).toMatchObject({ access: 'member', memberCount: 2 });
    await api(omar).post(`/v1/circles/${btcy.id}/join`).expect(200);
    await api(hana).post(`/v1/circles/${btcy.id}/join`).expect(200);
    await api(king).post(`/v1/circles/${btcy.id}/join`).expect(200);
  });

  it('private circles show only About until the owners say yes; requests answer the owners’ question', async () => {
    const v = await view(sara, wellness.id);
    expect(v).toMatchObject({ access: 'visitor', canRead: false, joinQuestion: 'Why do you want to join?' });
    expect((await api(sara).get(`/v1/circles/${wellness.id}/posts`)).status).toBe(403);
    expect((await api(sara).post(`/v1/circles/${wellness.id}/join`)).status).toBe(400); // the question needs an answer
    const r = (await api(sara).post(`/v1/circles/${wellness.id}/join`, { answer: 'I want to fix my sleep.' }).expect(200)).body as CircleView;
    expect(r.access).toBe('requested');
    expect(r.request).toMatchObject({ answer: 'I want to fix my sleep.' });
    expect(Date.parse(r.request!.expiresAt) - Date.parse(r.request!.at)).toBe(7 * DAY);
    expect(((await api(sara).del(`/v1/circles/${wellness.id}/request`).expect(200)).body as CircleView).access).toBe('visitor');
    // Asked again; a request nobody answers for a week lapses.
    await api(sara).post(`/v1/circles/${wellness.id}/join`, { answer: 'Sleep.' }).expect(200);
    await t.db.collection('yc_community_requests').updateOne({ _id: `${wellness.id}:${sara.id}` as never }, { $set: { createdAt: new Date(Date.now() - 8 * DAY) } });
    expect((await view(sara, wellness.id)).access).toBe('visitor');
    // Owners say no: Sara can't ask again for 30 days.
    await api(omar).post(`/v1/circles/${wellness.id}/join`, { answer: 'Curious' }).expect(200);
    const reqs = (await api(owner).get(`/v1/communities/${wellness.id}/requests`).expect(200)).body as Array<{ user: { id: string } }>;
    expect(reqs.map((x) => x.user.id)).toEqual([omar.id]);
    await api(owner).del(`/v1/communities/${wellness.id}/requests/${omar.id}`).expect(204);
    const no = await view(omar, wellness.id);
    expect(no.access).toBe('declined');
    expect(Date.parse(no.declinedUntil!) - Date.now()).toBeGreaterThan(29 * DAY);
    expect((await api(omar).post(`/v1/circles/${wellness.id}/join`, { answer: 'Please' })).status).toBe(403);
    // Hana is let in.
    await api(hana).post(`/v1/circles/${wellness.id}/join`, { answer: 'Recovering from jet lag' }).expect(200);
    await api(owner).post(`/v1/communities/${wellness.id}/requests/${hana.id}/approve`).expect(200);
    expect((await view(hana, wellness.id)).access).toBe('member');
  });

  it('hidden circles (private, not listed) aren’t available to outsiders', async () => {
    const hidden = await make(owner, { name: 'Karachi Founders', visibility: 'private', listed: false });
    expect((await api(sara).get(`/v1/circles/${hidden.id}`)).status).toBe(404);
    expect((await api(sara).get('/v1/circles/0123456789abcdef01234567')).status).toBe(404);
    expect((await api(sara).get('/v1/circles/nope')).status).toBe(404);
  });

  it('posts, photos, likes, comments and an owner’s answer', async () => {
    const key = (await api(sara).post('/v1/media/upload-url', { purpose: 'media', kind: 'image', contentType: 'image/png', size: png.length }).expect(200)).body;
    await t.http.put(new URL(key.uploadUrl).pathname).set('content-type', 'image/png').send(png).expect(204);
    const p = await post(sara, btcy.id, 'Mined 7 days in a row! Any tips for the team boost?', { photoKeys: [key.key] });
    expect(p).toMatchObject({ status: 'live', mine: true, photos: [expect.any(String)], author: { displayName: 'Sara', role: 'member', official: false } });
    // Someone else's upload can't be reused.
    expect((await api(omar).post(`/v1/circles/${btcy.id}/posts`, { text: 'x', photoKeys: [key.key] })).status).toBe(403);
    const q = await post(omar, btcy.id, 'Is mining paused when my phone is off?');
    const liked = (await api(sara).put(`/v1/circle-posts/${q.id}/like`).expect(200)).body as CirclePost;
    expect(liked).toMatchObject({ likes: 1, liked: true });
    await api(sara).put(`/v1/circle-posts/${q.id}/like`).expect(200);
    expect(((await api(sara).get(`/v1/circle-posts/${q.id}`).expect(200)).body as CirclePost).likes).toBe(1);
    const a = (await api(owner).post(`/v1/circle-posts/${q.id}/comments`, { text: 'No, it keeps running for 24 hours.' }).expect(200)).body as CircleComment;
    expect(a.author).toMatchObject({ role: 'owner', official: true });
    const reply = (await api(omar).post(`/v1/circle-posts/${q.id}/comments`, { text: 'Thanks!', parentId: a.id }).expect(200)).body as CircleComment;
    const deep = (await api(hana).post(`/v1/circle-posts/${q.id}/comments`, { text: 'Same', parentId: reply.id }).expect(200)).body as CircleComment;
    expect([reply.parentId, deep.parentId]).toEqual([a.id, a.id]); // one level of replies
    expect((await api(sara).put(`/v1/circle-comments/${a.id}/answer`)).status).toBe(403);
    expect(((await api(owner).put(`/v1/circle-comments/${a.id}/answer`).expect(200)).body as CircleComment).answer).toBe(true);
    const f = await feed(hana, btcy.id);
    expect(f.items.find((x) => x.id === q.id)).toMatchObject({ comments: 3, answer: { by: 'Bilal', text: 'No, it keeps running for 24 hours.' } });
    // Newest first; owners pin.
    expect(f.items.slice(0, 2).map((x) => x.id)).toEqual([q.id, p.id]);
    await api(owner).put(`/v1/circle-posts/${p.id}/pin`).expect(200);
    expect((await feed(hana, btcy.id)).items[0]).toMatchObject({ id: p.id, pinned: true });
    expect((await api(sara).put(`/v1/circle-posts/${q.id}/pin`)).status).toBe(403);
  });

  it('new posts since I last looked show on my circles list', async () => {
    await feed(hana, btcy.id);
    await post(sara, btcy.id, 'One more thing');
    const m = (await api(hana).get('/v1/circles').expect(200)).body as MyCircles;
    expect(m.circles.find((c) => c.id === btcy.id)).toMatchObject({ newPosts: 1, role: 'member', official: true });
    await feed(hana, btcy.id);
    expect(((await api(hana).get('/v1/circles').expect(200)).body as MyCircles).circles.find((c) => c.id === btcy.id)!.newPosts).toBe(0);
  });

  it('a post that looks like a money scheme is stopped, and if sent anyway waits for the owners', async () => {
    const r = await api(king).post(`/v1/circles/${btcy.id}/posts`, { text: 'Guaranteed 10% daily profit on BTCY! DM me to invest.' });
    expect(r.status).toBe(400);
    expect(r.body.error.details).toMatchObject({ reason: 'money_scheme', matches: [{ text: 'Guaranteed 10% daily profit' }, { text: 'DM me to invest' }] });
    const held = await post(king, btcy.id, 'Guaranteed 10% daily profit on BTCY! DM me to invest.', { send: 'review' });
    expect(held.status).toBe('pending');
    // Only King and the owners see it.
    expect((await feed(king, btcy.id)).items.some((x) => x.id === held.id)).toBe(true);
    expect((await feed(sara, btcy.id)).items.some((x) => x.id === held.id)).toBe(false);
    const rv = (await api(owner).get(`/v1/circles/${btcy.id}/review`).expect(200)).body as CircleReview;
    expect(rv.pending.map((x) => x.id)).toEqual([held.id]);
    expect((await view(owner, btcy.id)).pendingReview).toBe(1);
    const gone = (await api(owner).post(`/v1/circle-posts/${held.id}/remove`, { reason: 'Rule 2: no investment promotion or asking for money.' }).expect(200)).body as CirclePost;
    expect(gone).toMatchObject({ status: 'removed', removedReason: 'Rule 2: no investment promotion or asking for money.' });
    expect((await feed(king, btcy.id)).items.find((x) => x.id === held.id)).toMatchObject({ status: 'removed', text: expect.stringContaining('Guaranteed') });
    // Comments are checked too.
    const anyPost = (await feed(sara, btcy.id)).items[0]!;
    expect((await api(king).post(`/v1/circle-posts/${anyPost.id}/comments`, { text: 'Send 0.1 BTC to join my VIP group' })).status).toBe(400);
  });

  it('circles with post approval hold members’ posts until an owner approves', async () => {
    await api(owner).patch(`/v1/circles/${btcy.id}`, { postApproval: true }).expect(200);
    const p = await post(sara, btcy.id, 'Waiting for approval?');
    expect(p.status).toBe('pending');
    expect((await post(owner, btcy.id, 'Owners post straight away')).status).toBe('live');
    const ok = (await api(owner).post(`/v1/circle-posts/${p.id}/approve`).expect(200)).body as CirclePost;
    expect(ok.status).toBe('live');
    expect((await api(owner).post(`/v1/circle-posts/${p.id}/approve`)).status).toBe(409);
    await api(owner).patch(`/v1/circles/${btcy.id}`, { postApproval: false }).expect(200);
  });

  it('reporting hides the post for me; blocking hides that person; owners settle reports', async () => {
    const spam = await post(king, btcy.id, 'Check out my channel, link in bio!!!');
    await api(sara).post(`/v1/circle-posts/${spam.id}/report`, { reason: 'spam' }).expect(204);
    expect((await feed(sara, btcy.id)).items.find((x) => x.id === spam.id)).toMatchObject({ hidden: 'reported', text: expect.any(String) });
    expect((await feed(omar, btcy.id)).items.find((x) => x.id === spam.id)!.hidden).toBeNull();
    await api(omar).post(`/v1/circle-posts/${spam.id}/report`, { reason: 'spam', block: true }).expect(204);
    expect((await feed(omar, btcy.id)).items.find((x) => x.id === spam.id)).toMatchObject({ hidden: 'blocked', text: '' });
    expect((await api(king).post(`/v1/circle-posts/${spam.id}/report`, { reason: 'spam' })).status).toBe(400);
    const rv = (await api(owner).get(`/v1/circles/${btcy.id}/review`).expect(200)).body as CircleReview;
    expect(rv.reports).toEqual([expect.objectContaining({ id: spam.id, reason: 'spam', reports: 2, post: expect.objectContaining({ text: 'Check out my channel, link in bio!!!' }) })]);
    expect((await api(sara).get(`/v1/circles/${btcy.id}/review`)).status).toBe(403);
    await api(owner).post(`/v1/circles/${btcy.id}/review/${spam.id}`, { action: 'remove', reason: 'Spam' }).expect(204);
    expect((await feed(sara, btcy.id)).items.some((x) => x.id === spam.id)).toBe(false);
    expect((await api(owner).post(`/v1/circles/${btcy.id}/review/${spam.id}`, { action: 'keep' })).status).toBe(404);
  });

  it('muted people read but can’t post or comment until the date', async () => {
    expect((await api(sara).put(`/v1/circles/${btcy.id}/mutes/${king.id}`, { days: 4 })).status).toBe(403);
    expect((await api(owner).put(`/v1/circles/${btcy.id}/mutes/${owner.id}`, { days: 4 })).status).toBe(403);
    await api(owner).put(`/v1/circles/${btcy.id}/mutes/${king.id}`, { days: 4, reason: 'Repeated off-topic posts' }).expect(204);
    const v = await view(king, btcy.id);
    expect(v.muted).toMatchObject({ reason: 'Repeated off-topic posts' });
    expect(Date.parse(v.muted!.until) - Date.now()).toBeGreaterThan(3.9 * DAY);
    await feed(king, btcy.id);
    expect((await api(king).post(`/v1/circles/${btcy.id}/posts`, { text: 'hello' })).status).toBe(403);
    const members = (await api(owner).get(`/v1/circles/${btcy.id}/members`).expect(200)).body as Array<{ id: string; role: string; mutedUntil: string | null }>;
    expect(members[0]).toMatchObject({ id: owner.id, role: 'owner' });
    expect(members.find((m) => m.id === king.id)!.mutedUntil).toEqual(v.muted!.until);
    await api(owner).del(`/v1/circles/${btcy.id}/mutes/${king.id}`).expect(204);
    expect((await view(king, btcy.id)).muted).toBeNull();
  });

  it('removed people are told why, can’t see the circle, and can’t rejoin for 30 days', async () => {
    await api(owner).post(`/v1/circles/${btcy.id}/members/${king.id}/remove`, { reason: 'Rule 1: be kind to other members.' }).expect(204);
    const v = await view(king, btcy.id);
    expect(v).toMatchObject({ access: 'removed', canRead: false, removed: { reason: 'Rule 1: be kind to other members.' } });
    expect((await api(king).get(`/v1/circles/${btcy.id}/posts`)).status).toBe(403);
    const again = await api(king).post(`/v1/circles/${btcy.id}/join`);
    expect(again.status).toBe(403);
    expect(again.body.error.message).toMatch(/removed/);
    // After the 30 days they can come back.
    await t.db.collection('yc_circle_bars').updateOne({ _id: `${btcy.id}:${king.id}` as never }, { $set: { until: new Date(Date.now() - 1000) } });
    expect((await view(king, btcy.id)).access).toBe('visitor');
  });

  it('events: RSVP, a full event’s waitlist, seat offers that lapse, and the link only for people going', async () => {
    const e = (await api(owner).post(`/v1/circles/${btcy.id}/events`, {
      title: 'Founders Breakfast', about: 'Coffee and short intros.', startsAt: at(5 * DAY), endsAt: at(5 * DAY + 2 * HOUR), timeZone: 'Asia/Karachi',
      mode: 'both', place: 'The Second Cup, Clifton', onlineUrl: 'https://meet.example.com/abc', seats: 2,
    }).expect(200)).body as CircleEvent;
    expect(e).toMatchObject({ going: 1, myRsvp: 'going', onlineUrl: 'https://meet.example.com/abc', canManage: true, seats: 2, status: 'scheduled' });
    expect((await api(king).put(`/v1/circle-events/${e.id}/rsvp`, { status: 'going' })).status).toBe(403); // not a member any more
    const s = (await api(sara).put(`/v1/circle-events/${e.id}/rsvp`, { status: 'going' }).expect(200)).body as CircleEvent;
    expect(s).toMatchObject({ myRsvp: 'going', going: 2, onlineUrl: 'https://meet.example.com/abc' });
    const o = (await api(omar).put(`/v1/circle-events/${e.id}/rsvp`, { status: 'going' }).expect(200)).body as CircleEvent;
    expect(o).toMatchObject({ myRsvp: 'waitlist', waitlistPos: 1, onlineUrl: null, hasOnlineLink: true });
    const h = (await api(hana).put(`/v1/circle-events/${e.id}/rsvp`, { status: 'going' }).expect(200)).body as CircleEvent;
    expect(h).toMatchObject({ myRsvp: 'waitlist', waitlistPos: 2, waitlist: 2 });
    // Sara can't go: Omar is offered her seat for 12 hours.
    await api(sara).put(`/v1/circle-events/${e.id}/rsvp`, { status: 'not_going' }).expect(200);
    const offer = (await api(omar).get(`/v1/circle-events/${e.id}`).expect(200)).body as CircleEvent;
    expect(offer.myRsvp).toBe('offered');
    expect(Date.parse(offer.offerUntil!) - Date.now()).toBeGreaterThan(11.9 * HOUR);
    // He doesn't confirm in time: the seat goes to Hana.
    await t.db.collection('yc_circle_rsvps').updateOne({ _id: `${e.id}:${omar.id}` as never }, { $set: { offerUntil: new Date(Date.now() - 1000) } });
    expect(((await api(omar).get(`/v1/circle-events/${e.id}`).expect(200)).body as CircleEvent).myRsvp).toBe('interested');
    expect((await api(omar).post(`/v1/circle-events/${e.id}/confirm`)).status).toBe(409);
    const hh = (await api(hana).post(`/v1/circle-events/${e.id}/confirm`).expect(200)).body as CircleEvent;
    expect(hh).toMatchObject({ myRsvp: 'going', going: 2, waitlist: 0 });
    // Leaving the waitlist.
    await api(omar).put(`/v1/circle-events/${e.id}/rsvp`, { status: 'going' }).expect(200);
    expect(((await api(omar).del(`/v1/circle-events/${e.id}/rsvp`).expect(200)).body as CircleEvent).myRsvp).toBeNull();
    // Shows on my circles' "coming up".
    expect(((await api(hana).get('/v1/circles').expect(200)).body as MyCircles).upcoming.map((x) => x.title)).toContain('Founders Breakfast');
  });

  it('events: changing the time or place asks people again; cancelling; ratings after it ends; questions', async () => {
    const e = (await api(owner).post(`/v1/circles/${btcy.id}/events`, {
      title: 'AI & Blockchain Seminar', startsAt: at(3 * DAY), endsAt: at(3 * DAY + 2 * HOUR), timeZone: 'America/Denver', mode: 'in_person', place: 'Downtown Library, Room 2',
    }).expect(200)).body as CircleEvent;
    await api(sara).put(`/v1/circle-events/${e.id}/rsvp`, { status: 'going' }).expect(200);
    expect((await api(sara).patch(`/v1/circle-events/${e.id}`, { place: 'x' })).status).toBe(403);
    const moved = (await api(owner).patch(`/v1/circle-events/${e.id}`, { startsAt: at(3 * DAY + HOUR), endsAt: at(3 * DAY + 3 * HOUR), place: 'Downtown Library, Room 4' }).expect(200)).body as CircleEvent;
    expect(moved.change!.was).toMatchObject({ place: 'Downtown Library, Room 2', startsAt: e.startsAt });
    const s = (await api(sara).get(`/v1/circle-events/${e.id}`).expect(200)).body as CircleEvent;
    expect(s.needsAck).toBe(true);
    expect(((await api(sara).post(`/v1/circle-events/${e.id}/ack`).expect(200)).body as CircleEvent).needsAck).toBe(false);
    // Questions, with an answer from the host.
    const q = (await api(hana).post(`/v1/circle-events/${e.id}/questions`, { text: 'Will slides be shared?' }).expect(200)).body as CircleComment;
    const a = (await api(owner).post(`/v1/circle-events/${e.id}/questions`, { text: 'Yes, the next morning.', parentId: q.id }).expect(200)).body as CircleComment;
    await api(owner).put(`/v1/circle-comments/${a.id}/answer`).expect(200);
    const qs = (await api(sara).get(`/v1/circle-events/${e.id}/questions`).expect(200)).body as CircleComment[];
    expect(qs.map((x) => [x.text, x.answer])).toEqual([['Will slides be shared?', false], ['Yes, the next morning.', true]]);
    expect(((await api(sara).get(`/v1/circle-events/${e.id}`).expect(200)).body as CircleEvent).questions).toBe(1);
    // Ended: recording, slides, ratings from people who went.
    expect((await api(sara).put(`/v1/circle-events/${e.id}/rating`, { stars: 4 })).status).toBe(409);
    await t.db.collection('yc_circle_events').updateOne({ _id: new ObjectId(e.id) }, { $set: { startsAt: new Date(Date.now() - 3 * HOUR), endsAt: new Date(Date.now() - HOUR) } });
    await api(owner).patch(`/v1/circle-events/${e.id}`, { recordingUrl: 'https://video.example.com/r1', slidesUrl: 'https://files.example.com/s.pdf' }).expect(200);
    const ended = (await api(sara).put(`/v1/circle-events/${e.id}/rating`, { stars: 4 }).expect(200)).body as CircleEvent;
    expect(ended).toMatchObject({ status: 'ended', recordingUrl: 'https://video.example.com/r1', rating: { average: 4, count: 1, mine: 4 }, needsAck: false });
    expect((await api(omar).put(`/v1/circle-events/${e.id}/rating`, { stars: 5 })).status).toBe(403);
    expect((await api(sara).put(`/v1/circle-events/${e.id}/rsvp`, { status: 'going' })).status).toBe(409);
    expect(((await api(sara).get(`/v1/circles/${btcy.id}/events?past=1`).expect(200)).body as CircleEvent[]).map((x) => x.title)).toEqual(['AI & Blockchain Seminar']);
    // Cancelled.
    const c = (await api(owner).post(`/v1/circles/${btcy.id}/events`, { title: 'Live Q&A: Mining v2', startsAt: at(DAY), endsAt: at(DAY + HOUR), timeZone: 'Asia/Karachi', mode: 'online', onlineUrl: 'https://meet.example.com/q' }).expect(200)).body as CircleEvent;
    const x = (await api(owner).post(`/v1/circle-events/${c.id}/cancel`, { note: 'We need more time to finish Mining v2.' }).expect(200)).body as CircleEvent;
    expect(x).toMatchObject({ status: 'cancelled', cancelNote: 'We need more time to finish Mining v2.', onlineUrl: null });
    expect((await api(sara).put(`/v1/circle-events/${c.id}/rsvp`, { status: 'going' })).status).toBe(409);
    // Bad input.
    expect((await api(owner).post(`/v1/circles/${btcy.id}/events`, { title: 'Past', startsAt: at(-DAY), endsAt: at(-DAY + HOUR), timeZone: 'Asia/Karachi', mode: 'online', onlineUrl: 'https://x.example.com' })).status).toBe(400);
    expect((await api(owner).post(`/v1/circles/${btcy.id}/events`, { title: 'No place', startsAt: at(DAY), endsAt: at(DAY + HOUR), timeZone: 'Asia/Karachi', mode: 'in_person' })).status).toBe(400);
  });

  it('the only owner picks a new owner before leaving, or deletes the circle', async () => {
    const k = await make(owner, { name: 'Karachi Startups', visibility: 'public' });
    await api(sara).post(`/v1/circles/${k.id}/join`).expect(200);
    const r = await api(owner).post(`/v1/circles/${k.id}/leave`);
    expect(r.status).toBe(409);
    expect(r.body.error.message).toMatch(/new owner/);
    expect((await api(sara).post(`/v1/circles/${k.id}/owner`, { userId: sara.id })).status).toBe(403);
    expect(((await api(owner).post(`/v1/circles/${k.id}/owner`, { userId: sara.id }).expect(200)).body as CircleView).isOwner).toBe(false);
    await api(owner).post(`/v1/circles/${k.id}/leave`).expect(204);
    expect(await view(sara, k.id)).toMatchObject({ isOwner: true, access: 'admin', memberCount: 1 });
    await post(sara, k.id, 'Last post');
    expect((await api(owner).del(`/v1/circles/${k.id}`)).status).toBe(403);
    await api(sara).del(`/v1/circles/${k.id}`).expect(204);
    expect((await api(sara).get(`/v1/circles/${k.id}`)).status).toBe(404);
    expect(await t.db.collection('yc_circle_posts').countDocuments({ circleId: new ObjectId(k.id) })).toBe(0);
  });

  it('deleting an account takes its posts and replies out of circles', async () => {
    await resetLimits();
    const temp = await makeUser(t, 'Temp');
    await api(temp).post(`/v1/circles/${btcy.id}/join`).expect(200);
    const p = await post(temp, btcy.id, 'Bye soon');
    const phone = ((await api(temp).get('/v1/me').expect(200)).body as { phone: string }).phone;
    await api(temp).post('/v1/me/delete/start', {}).expect(200);
    await api(temp).post('/v1/me/delete', { code: await lastCode(t, phone) }).expect(204);
    expect(await t.db.collection('yc_circle_posts').countDocuments({ _id: new ObjectId(p.id) })).toBe(0);
  });
});

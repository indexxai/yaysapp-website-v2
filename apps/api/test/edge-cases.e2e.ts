import { ObjectId } from 'mongodb';
import type { CheckinStatus, CircleEvent, CirclePost, CircleView } from '@yays/shared';
import { startApp, type TestApp } from './helpers';
import { makeUser, type TUser } from './chat-helpers';

/* Edge cases found missing in the full test review (Nov 2026). */
const TZ = { 'x-time-zone': 'Asia/Karachi' };
const HOUR = 3600_000, DAY = 24 * HOUR;
const at = (ms: number) => new Date(Date.now() + ms).toISOString();
const dayIn = (offset: number) => new Date(Date.now() + offset * DAY).toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' });

describe('Edge cases', () => {
  let t: TestApp; let owner: TUser; let sara: TUser; let omar: TUser; let hana: TUser; let visitor: TUser;
  const api = (u: TUser) => ({
    get: (p: string) => t.http.get(p).set(u.auth).set(TZ),
    post: (p: string, b: object = {}) => t.http.post(p).set(u.auth).set(TZ).send(b),
    patch: (p: string, b: object) => t.http.patch(p).set(u.auth).send(b),
    put: (p: string, b: object = {}) => t.http.put(p).set(u.auth).send(b),
    del: (p: string) => t.http.delete(p).set(u.auth),
  });
  beforeAll(async () => {
    t = await startApp();
    [owner, sara, omar, hana, visitor] = [await makeUser(t, 'Bilal'), await makeUser(t, 'Sara'), await makeUser(t, 'Omar'), await makeUser(t, 'Hana'), await makeUser(t, 'Visitor')];
  });
  afterAll(async () => { await t.close(); });

  describe('daily check-in', () => {
    const put = (u: TUser, offset: number, dayOfWeek: number, streak: number) =>
      t.db.collection('yc_checkins').insertOne({ _id: `${u.id}:${dayIn(offset)}` as never, userId: new ObjectId(u.id), day: dayIn(offset), dayOfWeek, streak, points: 10, at: new Date() });

    it('missing a day starts again at day 1', async () => {
      await put(sara, -2, 4, 4); // last check-in was the day before yesterday
      const s = (await api(sara).get('/v1/rewards/checkin').expect(200)).body as CheckinStatus;
      expect(s).toMatchObject({ dayOfWeek: 1, streak: 0, todayPoints: 10 });
      expect((await api(sara).post('/v1/rewards/checkin').expect(200)).body).toMatchObject({ streak: 1, dayOfWeek: 1 });
    });
    it('after day 7 the week starts over but the streak keeps counting', async () => {
      await put(omar, -1, 7, 13);
      expect((await api(omar).post('/v1/rewards/checkin').expect(200)).body).toMatchObject({ dayOfWeek: 1, streak: 14 });
    });
  });

  describe('circles', () => {
    let c: CircleView;
    const post = async (u: TUser, text: string) => (await api(u).post(`/v1/circles/${c.id}/posts`, { text }).expect(200)).body as CirclePost;
    beforeAll(async () => {
      c = (await api(owner).post('/v1/circles', { name: 'Edge Circle', rules: ['Be kind'] }).expect(200)).body;
      for (const u of [sara, omar, hana]) await api(u).post(`/v1/circles/${c.id}/join`).expect(200);
    });

    it('visitors of a public circle can read but not like, comment, ask or RSVP', async () => {
      const p = await post(sara, 'Hello circle');
      const e = (await api(owner).post(`/v1/circles/${c.id}/events`, { title: 'Meetup', startsAt: at(DAY), endsAt: at(DAY + HOUR), timeZone: 'Asia/Karachi', mode: 'online', onlineUrl: 'https://meet.example.com/m' }).expect(200)).body as CircleEvent;
      await api(visitor).get(`/v1/circle-posts/${p.id}/comments`).expect(200);
      expect((await api(visitor).put(`/v1/circle-posts/${p.id}/like`)).status).toBe(403);
      expect((await api(visitor).post(`/v1/circle-posts/${p.id}/comments`, { text: 'hi' })).status).toBe(403);
      expect((await api(visitor).post(`/v1/circle-events/${e.id}/questions`, { text: 'hi?' })).status).toBe(403);
      expect((await api(visitor).put(`/v1/circle-events/${e.id}/rsvp`, { status: 'going' })).status).toBe(403);
      // The online link stays hidden from visitors.
      expect(((await api(visitor).get(`/v1/circle-events/${e.id}`).expect(200)).body as CircleEvent).onlineUrl).toBeNull();
      expect((await api(visitor).get(`/v1/circles/${c.id}/review`)).status).toBe(403);
    });

    it('up to 3 pinned posts; editing a post into a money scheme is refused; pending posts take no comments or likes', async () => {
      const ps = [await post(owner, 'Pin 1'), await post(owner, 'Pin 2'), await post(owner, 'Pin 3'), await post(owner, 'Pin 4')];
      for (const p of ps.slice(0, 3)) await api(owner).put(`/v1/circle-posts/${p.id}/pin`).expect(200);
      expect((await api(owner).put(`/v1/circle-posts/${ps[3]!.id}/pin`)).status).toBe(409);
      const mine = await post(sara, 'Nice weather for a run');
      const r = await api(sara).patch(`/v1/circle-posts/${mine.id}`, { text: 'Double your BTC: send 0.5 BTC to join' });
      expect(r.status).toBe(400);
      expect(r.body.error.details.reason).toBe('money_scheme');
      expect((await api(omar).patch(`/v1/circle-posts/${mine.id}`, { text: 'hijack' })).status).toBe(403);
      const held = (await api(sara).post(`/v1/circles/${c.id}/posts`, { text: 'Guaranteed returns for everyone', send: 'review' }).expect(200)).body as CirclePost;
      expect((await api(sara).post(`/v1/circle-posts/${held.id}/comments`, { text: 'x' })).status).toBe(409);
      expect((await api(omar).get(`/v1/circle-posts/${held.id}`)).status).toBe(404); // others can't see it
      for (const p of ps.slice(0, 3)) await api(owner).del(`/v1/circle-posts/${p.id}/pin`).expect(200);
    });

    it('deleting a comment takes its replies with it and keeps the count right', async () => {
      const p = await post(sara, 'Question about mining');
      const top = (await api(owner).post(`/v1/circle-posts/${p.id}/comments`, { text: 'Answer' }).expect(200)).body;
      await api(sara).post(`/v1/circle-posts/${p.id}/comments`, { text: 'Thanks', parentId: top.id }).expect(200);
      await api(owner).put(`/v1/circle-comments/${top.id}/answer`).expect(200);
      expect((await api(omar).del(`/v1/circle-comments/${top.id}`)).status).toBe(403);
      await api(owner).del(`/v1/circle-comments/${top.id}`).expect(204);
      const after = (await api(sara).get(`/v1/circle-posts/${p.id}`).expect(200)).body as CirclePost;
      expect(after).toMatchObject({ comments: 0, answer: null });
      expect((await api(sara).post(`/v1/circle-posts/${p.id}/comments`, { text: 'Reply to nothing', parentId: top.id })).status).toBe(404);
    });

    it('adding seats offers them to the waitlist in order', async () => {
      const e = (await api(owner).post(`/v1/circles/${c.id}/events`, { title: 'Small dinner', startsAt: at(2 * DAY), endsAt: at(2 * DAY + HOUR), timeZone: 'Asia/Karachi', mode: 'in_person', place: 'Clifton', seats: 1 }).expect(200)).body as CircleEvent;
      for (const u of [sara, omar, hana]) expect(((await api(u).put(`/v1/circle-events/${e.id}/rsvp`, { status: 'going' }).expect(200)).body as CircleEvent).myRsvp).toBe('waitlist');
      expect(((await api(hana).get(`/v1/circle-events/${e.id}`).expect(200)).body as CircleEvent).waitlistPos).toBe(3);
      await api(owner).patch(`/v1/circle-events/${e.id}`, { seats: 3 }).expect(200);
      const states = await Promise.all([sara, omar, hana].map(async (u) => ((await api(u).get(`/v1/circle-events/${e.id}`).expect(200)).body as CircleEvent).myRsvp));
      expect(states).toEqual(['offered', 'offered', 'waitlist']);
      // Saying "going" when offered takes the seat.
      expect(((await api(sara).put(`/v1/circle-events/${e.id}/rsvp`, { status: 'going' }).expect(200)).body as CircleEvent).myRsvp).toBe('going');
      // Interested and can't go don't take seats.
      expect(((await api(omar).put(`/v1/circle-events/${e.id}/rsvp`, { status: 'interested' }).expect(200)).body as CircleEvent).myRsvp).toBe('interested');
      expect(((await api(hana).get(`/v1/circle-events/${e.id}`).expect(200)).body as CircleEvent).myRsvp).toBe('offered');
    });

    it('a private circle with no question takes a request without an answer; a removed person can’t use an invite link either', async () => {
      const p = (await api(owner).post('/v1/circles', { name: 'Quiet Room', visibility: 'private' }).expect(200)).body as CircleView;
      expect(((await api(sara).post(`/v1/circles/${p.id}/join`).expect(200)).body as CircleView).access).toBe('requested');
      await api(owner).post(`/v1/communities/${p.id}/requests/${sara.id}/approve`).expect(200);
      await api(owner).post(`/v1/circles/${p.id}/members/${sara.id}/remove`, { reason: 'Spam' }).expect(204);
      const { inviteCode } = (await api(owner).post(`/v1/communities/${p.id}/invite`).expect(200)).body;
      const r = await api(sara).post(`/v1/community-invites/${inviteCode}/join`);
      expect(r.status).toBe(403);
      expect(r.body.error.message).toMatch(/removed/);
    });

    it('when the owner leaves and another admin exists, that admin takes over without asking', async () => {
      const k = (await api(owner).post('/v1/circles', { name: 'Handover Circle' }).expect(200)).body as CircleView;
      for (const u of [sara, omar]) await api(u).post(`/v1/circles/${k.id}/join`).expect(200);
      await api(owner).put(`/v1/communities/${k.id}/admins/${sara.id}`).expect(204);
      await api(owner).post(`/v1/circles/${k.id}/leave`).expect(204);
      expect(((await api(sara).get(`/v1/circles/${k.id}`).expect(200)).body as CircleView).isOwner).toBe(true);
    });

    it('a post that goes live completes the “Post in a circle” task; a held post only counts once approved', async () => {
      const earn = async (u: TUser) => ((await api(u).get('/v1/rewards/today').expect(200)).body as { tasks: Array<{ id: string; completed: boolean; title: string }> }).tasks.find((x) => x.id === 'post')!;
      expect((await earn(hana)).title).toBe('Post in a circle');
      await api(hana).post(`/v1/circles/${c.id}/posts`, { text: 'Guaranteed profit, DM me to invest', send: 'review' }).expect(200);
      await new Promise((r) => setTimeout(r, 300));
      expect((await earn(hana)).completed).toBe(false);
      await api(hana).post(`/v1/circles/${c.id}/posts`, { text: 'Morning run done' }).expect(200);
      for (let i = 0; i < 20 && !(await earn(hana)).completed; i++) await new Promise((r) => setTimeout(r, 100));
      expect((await earn(hana)).completed).toBe(true);
    });

    it('bad input: unknown category is ignored in Discover, bad ids and huge posts are refused', async () => {
      await api(sara).get('/v1/circles/discover?category=nonsense').expect(200);
      expect((await api(sara).get('/v1/circle-posts/not-an-id')).status).toBe(404);
      expect((await api(sara).get('/v1/circle-events/0123456789abcdef01234567')).status).toBe(404);
      expect((await api(sara).post(`/v1/circles/${c.id}/posts`, { text: 'x'.repeat(3001) })).status).toBe(400);
      expect((await api(sara).post(`/v1/circles/${c.id}/posts`, { text: '   ' })).status).toBe(400);
      expect((await api(owner).post(`/v1/circles/${c.id}/events`, { title: 'Backwards', startsAt: at(2 * DAY), endsAt: at(DAY), timeZone: 'Asia/Karachi', mode: 'online', onlineUrl: 'https://x.example.com' })).status).toBe(400);
      expect((await api(owner).post(`/v1/circles/${c.id}/events`, { title: 'Bad zone', startsAt: at(DAY), endsAt: at(DAY + HOUR), timeZone: 'Mars/Base', mode: 'online', onlineUrl: 'https://x.example.com' })).status).toBe(400);
      expect((await api(owner).post(`/v1/circles/${c.id}/events`, { title: 'Bad link', startsAt: at(DAY), endsAt: at(DAY + HOUR), timeZone: 'Asia/Karachi', mode: 'online', onlineUrl: 'javascript:alert(1)' })).status).toBe(400);
    });
  });
});

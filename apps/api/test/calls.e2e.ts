import { createHash } from 'crypto';
import { AccessToken, TokenVerifier } from 'livekit-server-sdk';
import type { CallHistoryPage, CallJoin, CallLinkJoin, CallView, ChatMessage, ConversationSummary } from '@yays/shared';
import { startApp, type TestApp } from './helpers';
import { connect, makeUser, next, record, sleep, type TUser } from './chat-helpers';

const LK = { LIVEKIT_URL: 'ws://127.0.0.1:1', LIVEKIT_API_KEY: 'devkey', LIVEKIT_API_SECRET: 'calls-e2e-secret-that-is-long-enough-123', CALL_RING_SECONDS: '2' };
type Sock = Awaited<ReturnType<typeof connect>>;

describe('Calls', () => {
  let t: TestApp; let ali: TUser; let sara: TUser; let omar: TUser; let zara: TUser;
  const sockets: Sock[] = [];
  const sock = async (u: TUser) => { const s = await connect(t.url, u.token); sockets.push(s); return s; };
  const direct = async (a: TUser, b: TUser, say = true) => {
    const id = (await t.http.post('/v1/conversations/direct').set(a.auth).send({ userId: b.id }).expect(200)).body.id as string;
    if (say) await t.http.post(`/v1/conversations/${id}/messages`).set(a.auth).send({ clientId: crypto.randomUUID(), text: 'hi' }).expect(200);
    return id;
  };
  const start = (u: TUser, conversationId: string, media = 'voice') => t.http.post('/v1/calls').set(u.auth).send({ conversationId, media });
  const history = async (u: TUser, q: Record<string, string> = {}) => (await t.http.get('/v1/calls').query(q).set(u.auth).expect(200)).body as CallHistoryPage;
  const pushes = async (u: TUser) => (await t.http.get('/v1/_test/pushes').query({ userId: u.id }).expect(200)).body as Array<{ payload: { type: string; title?: string; body?: string; callId?: string } }>;
  const subscribe = (u: TUser) => t.http.post('/v1/push/subscriptions').set(u.auth).send({ endpoint: `https://push.example/${u.id}`, keys: { p256dh: 'BOr2Ae_W_example_p256dh_key_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', auth: 'aaaaaaaaaaaaaaaaaaaaaa' } }).expect(204);

  beforeAll(async () => {
    t = await startApp(LK);
    [ali, sara, omar, zara] = [await makeUser(t, 'Ali'), await makeUser(t, 'Sara'), await makeUser(t, 'Omar'), await makeUser(t, 'Zara')];
  });
  afterAll(async () => { for (const s of sockets) s.close(); await t.close(); });

  it('a direct call rings every device of the other person, connects, and ends with a line in the chat', async () => {
    const c = await direct(ali, sara);
    const [s1, s2, a1] = [await sock(sara), await sock(sara), await sock(ali)];
    await subscribe(sara);
    const rings = [next<{ call: CallView }>(s1, 'call:ring'), next<{ call: CallView }>(s2, 'call:ring')];
    const j = (await start(ali, c, 'video').expect(200)).body as CallJoin;
    expect(j.url).toBe(LK.LIVEKIT_URL);
    const grant = await new TokenVerifier(LK.LIVEKIT_API_KEY, LK.LIVEKIT_API_SECRET).verify(j.token);
    expect(grant.sub).toBe(ali.id);
    expect(grant.video?.room).toBe(j.call.id);
    expect(j.call).toMatchObject({ kind: 'direct', media: 'video', status: 'ringing', title: 'Sara', conversationId: c });
    const [r1, r2] = await Promise.all(rings);
    expect(r1!.call.title).toBe('Ali');
    expect(r2!.call.participants.find((p) => p.userId === sara.id)?.state).toBe('ringing');
    // Sara's devices are connected but not looking at the app: her phone gets a ring notification too.
    await sleep(200);
    expect((await pushes(sara)).map((p) => p.payload)).toContainEqual(expect.objectContaining({ type: 'call', title: 'Ali', body: 'Incoming video call', callId: j.call.id }));

    const aliSees = next<{ call: CallView }>(a1, 'call:update', (p) => p.call.status === 'active');
    const otherDevice = next<{ call: CallView }>(s2, 'call:update', (p) => p.call.status === 'active');
    const acc = (await t.http.post(`/v1/calls/${j.call.id}/accept`).set(sara.auth).expect(200)).body as CallJoin;
    expect((await new TokenVerifier(LK.LIVEKIT_API_KEY, LK.LIVEKIT_API_SECRET).verify(acc.token)).sub).toBe(sara.id);
    expect((await aliSees).call.startedAt).toBeTruthy();
    expect((await otherDevice).call.participants.find((p) => p.userId === sara.id)?.state).toBe('joined'); // stops ringing there
    // Answering twice (another device) just hands out a token again.
    await t.http.post(`/v1/calls/${j.call.id}/accept`).set(sara.auth).expect(200);

    await sleep(1100);
    const line = next<{ message: ChatMessage }>(s1, 'msg:new', (p) => p.message.type === 'system');
    const ended = (await t.http.post(`/v1/calls/${j.call.id}/leave`).set(sara.auth).expect(200)).body as CallView;
    expect(ended).toMatchObject({ status: 'ended', outcome: 'completed' });
    const sys = (await line).message;
    expect(sys.system).toMatchObject({ kind: 'call', media: 'video', outcome: 'completed', group: false });
    expect(sys.senderId).toBe(ali.id);
    expect((sys.system as { durationSec: number }).durationSec).toBeGreaterThanOrEqual(1);
    const ah = (await history(ali)).items[0]!, sh = (await history(sara)).items[0]!;
    expect(ah).toMatchObject({ id: j.call.id, direction: 'out', result: 'answered', media: 'video', title: 'Sara', peerId: sara.id });
    expect(sh).toMatchObject({ direction: 'in', result: 'answered', title: 'Ali', peerId: ali.id });
    expect(ah.durationSec).toBeGreaterThanOrEqual(1);
    // Over is over.
    await t.http.post(`/v1/calls/${j.call.id}/accept`).set(sara.auth).expect(410);
  });

  it('declining ends the call; nobody answering makes it a missed call', async () => {
    const c = await direct(ali, omar);
    const o = await sock(omar);
    const ring = next(o, 'call:ring');
    const j = (await start(ali, c).expect(200)).body as CallJoin;
    await ring;
    const d = (await t.http.post(`/v1/calls/${j.call.id}/decline`).set(omar.auth).expect(200)).body as CallView;
    expect(d).toMatchObject({ status: 'ended', outcome: 'declined' });
    expect((await history(ali)).items[0]).toMatchObject({ result: 'declined', direction: 'out' });
    expect((await history(omar)).items[0]).toMatchObject({ result: 'declined', direction: 'in' });

    await subscribe(omar);
    await t.http.post('/v1/calls/seen').set(omar.auth).expect(204);
    const j2 = (await start(ali, c).expect(200)).body as CallJoin;
    const over = next<{ call: CallView }>(o, 'call:update', (p) => p.call.status === 'ended', 5000);
    expect((await over).call).toMatchObject({ outcome: 'missed' });
    const oh = await history(omar);
    expect(oh.items[0]).toMatchObject({ id: j2.call.id, result: 'missed' });
    expect(oh.missed).toBe(1);
    expect((await history(omar, { filter: 'missed' })).items.map((i) => i.id)).toEqual([j2.call.id]);
    expect((await history(ali)).items[0]).toMatchObject({ result: 'no_answer' });
    await sleep(200);
    expect((await pushes(omar)).map((p) => p.payload.type)).toEqual(expect.arrayContaining(['call', 'call_end']));
    // The chat says what happened, from each side.
    const msgs = (await t.http.get(`/v1/conversations/${c}/messages`).set(omar.auth).expect(200)).body.items as ChatMessage[];
    expect(msgs.filter((m) => m.type === 'system').map((m) => (m.system as { outcome: string }).outcome)).toEqual(['declined', 'missed']);
    const list = (await t.http.get(`/v1/conversations/${c}`).set(omar.auth).expect(200)).body as ConversationSummary;
    expect(list.lastMessage?.system).toMatchObject({ kind: 'call', outcome: 'missed' });
    await t.http.post('/v1/calls/seen').set(omar.auth).expect(204);
    expect((await history(omar)).missed).toBe(0);
  });

  it('someone on another call is busy; blocked people and strangers to the chat cannot call', async () => {
    const oz = await direct(omar, zara);
    const j = (await start(omar, oz).expect(200)).body as CallJoin;
    await t.http.post(`/v1/calls/${j.call.id}/accept`).set(zara.auth).expect(200);
    const ao = await direct(ali, omar, false);
    const busy = (await start(ali, ao).expect(200)).body as CallJoin;
    expect(busy.call).toMatchObject({ status: 'ended', outcome: 'busy' });
    expect((await history(ali)).items[0]).toMatchObject({ result: 'busy' });
    // Starting a new call hangs up the one you're on.
    const zs = await direct(zara, sara);
    await start(zara, zs).expect(200);
    expect(((await t.http.get(`/v1/calls/${j.call.id}`).set(omar.auth).expect(200)).body as CallView).status).toBe('ended');
    await t.http.post(`/v1/calls/${(await history(zara)).items[0]!.id}/leave`).set(zara.auth).expect(200);

    const as = await direct(ali, sara, false);
    await t.http.post('/v1/blocks').set(sara.auth).send({ userId: ali.id }).expect((r) => expect([200, 204]).toContain(r.status));
    expect((await start(ali, as).expect(403)).body.error.message).toBe("You can't call this person.");
    expect((await start(sara, as).expect(403)).body.error.message).toBe('Unblock this contact to call them.');
    await t.http.delete(`/v1/blocks/${ali.id}`).set(sara.auth).expect((r) => expect([200, 204]).toContain(r.status));
    await start(omar, as).expect(404); // not his chat
  });

  it('group calls ring members (not those who muted the group), show "join" on the chat, and end when everyone leaves', async () => {
    const g = (await t.http.post('/v1/groups').set(ali.auth).send({ name: 'Family', memberIds: [sara.id, omar.id, zara.id] }).expect(200)).body.id as string;
    await t.http.put(`/v1/conversations/${g}/prefs`).set(zara.auth).send({ mute: 'always' }).expect(200);
    const [s, z] = [await sock(sara), await sock(zara)];
    const zr = record(z, 'call:ring');
    const ring = next<{ call: CallView }>(s, 'call:ring');
    const j = (await start(ali, g, 'video').expect(200)).body as CallJoin;
    expect(j.call).toMatchObject({ kind: 'group', title: 'Family' });
    expect((await ring).call.participants.find((p) => p.userId === zara.id)?.state).toBe('invited');
    const sum = (await t.http.get(`/v1/conversations/${g}`).set(zara.auth).expect(200)).body as ConversationSummary;
    expect(sum.call).toEqual({ id: j.call.id, media: 'video', count: 1 });
    // Zara joins from the chat later; "starting" a call there joins the one going on.
    const zj = (await start(zara, g, 'voice').expect(200)).body as CallJoin;
    expect(zj.call.id).toBe(j.call.id);
    expect(zj.call.status).toBe('active');
    await t.http.post(`/v1/calls/${j.call.id}/accept`).set(sara.auth).expect(200);
    expect(((await t.http.get(`/v1/conversations/${g}`).set(omar.auth).expect(200)).body as ConversationSummary).call?.count).toBe(3);
    expect(zr).toHaveLength(0);
    // Omar's ring times out; the call goes on.
    await sleep(2600);
    let v = (await t.http.get(`/v1/calls/${j.call.id}`).set(ali.auth).expect(200)).body as CallView;
    expect(v.status).toBe('active');
    expect(v.participants.find((p) => p.userId === omar.id)?.state).toBe('missed');
    // Ring him again from the call.
    const o = await sock(omar);
    const again = next(o, 'call:ring');
    await t.http.post(`/v1/calls/${j.call.id}/invite`).set(sara.auth).send({ userIds: [omar.id] }).expect(200);
    await again;
    await t.http.post(`/v1/calls/${j.call.id}/decline`).set(omar.auth).expect(200);
    for (const u of [ali, sara]) await t.http.post(`/v1/calls/${j.call.id}/leave`).set(u.auth).expect(200);
    v = (await t.http.get(`/v1/calls/${j.call.id}`).set(ali.auth).expect(200)).body as CallView;
    expect(v.status).toBe('active'); // Zara is still on
    await t.http.post(`/v1/calls/${j.call.id}/leave`).set(zara.auth).expect(200);
    v = (await t.http.get(`/v1/calls/${j.call.id}`).set(ali.auth).expect(200)).body as CallView;
    expect(v).toMatchObject({ status: 'ended', outcome: 'completed' });
    expect(((await t.http.get(`/v1/conversations/${g}`).set(zara.auth).expect(200)).body as ConversationSummary).call).toBeNull();
    expect((await history(omar, { conversationId: g })).items[0]).toMatchObject({ result: 'declined', kind: 'group', title: 'Family' });
    expect((await history(zara, { conversationId: g })).items[0]).toMatchObject({ result: 'answered' });
  });

  it('"Silence unknown callers" keeps a call from a non-contact from ringing', async () => {
    const stranger = await makeUser(t, 'Bilal');
    await t.http.put('/v1/me/privacy').set(sara.auth).send({ silenceUnknown: true }).expect(200);
    const s = await sock(sara);
    const rings = record(s, 'call:ring');
    const c = await direct(stranger, sara, false);
    const j = (await start(stranger, c).expect(200)).body as CallJoin;
    expect(j.call.participants.find((p) => p.userId === sara.id)?.state).toBe('ringing'); // the caller can't tell
    await sleep(2600);
    expect(rings).toHaveLength(0);
    const h = await history(sara);
    expect(h.items[0]).toMatchObject({ id: j.call.id, result: 'silenced' });
    expect((await history(sara, { filter: 'missed' })).items.map((i) => i.id)).not.toContain(j.call.id);
    // Contacts still ring.
    const known = await direct(omar, sara);
    const ring = next(s, 'call:ring');
    const j2 = (await start(omar, known).expect(200)).body as CallJoin;
    await ring;
    await t.http.post(`/v1/calls/${j2.call.id}/leave`).set(omar.auth).expect(200);
    await t.http.put('/v1/me/privacy').set(sara.auth).send({ silenceUnknown: false }).expect(200);
  });

  it('call links: contacts go straight in, others wait until the host lets them in', async () => {
    const stranger = await makeUser(t, 'Hana'), other = await makeUser(t, 'Lena');
    const link = (await t.http.post('/v1/call-links').set(ali.auth).send({ name: 'Design review', media: 'video', approve: true }).expect(200)).body;
    expect(link).toMatchObject({ name: 'Design review', media: 'video', approve: true, url: `/call/${link.code}` });
    expect((await t.http.get(`/v1/call-links/${link.code}`).set(stranger.auth).expect(200)).body).toMatchObject({ name: 'Design review', live: false, mine: false, host: { id: ali.id } });
    expect((await t.http.patch(`/v1/call-links/${link.code}`).set(ali.auth).send({ media: 'voice' }).expect(200)).body).toMatchObject({ media: 'voice', approve: true });
    await t.http.patch(`/v1/call-links/${link.code}`).set(sara.auth).send({ media: 'video' }).expect(404);
    await t.http.patch(`/v1/call-links/${link.code}`).set(ali.auth).send({ media: 'video' }).expect(200);
    const a = await sock(ali);
    const aj = (await t.http.post(`/v1/call-links/${link.code}/join`).set(ali.auth).expect(200)).body as CallLinkJoin;
    expect(aj.status).toBe('joined');
    const callId = aj.status === 'joined' ? aj.call.id : '';
    const sj = (await t.http.post(`/v1/call-links/${link.code}/join`).set(sara.auth).expect(200)).body as CallLinkJoin; // Sara has chatted with Ali
    expect(sj.status).toBe('joined');
    const asks = next<{ call: CallView }>(a, 'call:update', (p) => p.call.participants.some((x) => x.userId === stranger.id && x.state === 'waiting'));
    const hj = (await t.http.post(`/v1/call-links/${link.code}/join`).set(stranger.auth).expect(200)).body as CallLinkJoin;
    expect(hj.status).toBe('waiting');
    await asks;
    // Waiting people aren't shown to other guests.
    expect(((await t.http.get(`/v1/calls/${callId}`).set(sara.auth).expect(200)).body as CallView).participants.map((p) => p.userId)).not.toContain(stranger.id);
    await t.http.post(`/v1/calls/${callId}/accept`).set(stranger.auth).expect(403);
    await t.http.post(`/v1/calls/${callId}/admit`).set(sara.auth).send({ userId: stranger.id, allow: true }).expect(404); // only the host
    const h = await sock(stranger);
    const letIn = next<{ call: CallView }>(h, 'call:update', (p) => p.call.participants.some((x) => x.userId === stranger.id && x.state === 'admitted'));
    await t.http.post(`/v1/calls/${callId}/admit`).set(ali.auth).send({ userId: stranger.id, allow: true }).expect(200);
    await letIn;
    expect(((await t.http.post(`/v1/call-links/${link.code}/join`).set(stranger.auth).expect(200)).body as CallLinkJoin).status).toBe('joined');
    await t.http.post(`/v1/call-links/${link.code}/join`).set(other.auth).expect(200);
    await t.http.post(`/v1/calls/${callId}/admit`).set(ali.auth).send({ userId: other.id, allow: false }).expect(200);
    expect(((await t.http.post(`/v1/call-links/${link.code}/join`).set(other.auth).expect(200)).body as CallLinkJoin).status).toBe('denied');
    expect((await t.http.get(`/v1/call-links/${link.code}`).set(other.auth).expect(200)).body).toMatchObject({ live: true, count: 3 });
    for (const u of [ali, sara, stranger]) await t.http.post(`/v1/calls/${callId}/leave`).set(u.auth).expect(200);
    expect(((await t.http.get(`/v1/calls/${callId}`).set(ali.auth).expect(200)).body as CallView).status).toBe('ended');
    // A new call on the same link starts fresh.
    expect(((await t.http.post(`/v1/call-links/${link.code}/join`).set(ali.auth).expect(200)).body as CallLinkJoin).status).toBe('joined');
    await t.http.delete(`/v1/call-links/${link.code}`).set(ali.auth).expect(204);
    await t.http.get(`/v1/call-links/${link.code}`).set(stranger.auth).expect(404);
  });

  it('LiveKit telling us someone dropped off takes them off the call; unsigned notices are refused', async () => {
    const c = await direct(zara, omar);
    const j = (await start(zara, c).expect(200)).body as CallJoin;
    await t.http.post(`/v1/calls/${j.call.id}/accept`).set(omar.auth).expect(200);
    const body = JSON.stringify({ event: 'participant_left', id: 'EV_1', createdAt: String(Math.floor(Date.now() / 1000)), room: { name: j.call.id }, participant: { identity: omar.id } });
    await t.http.post('/v1/livekit/webhook').set('content-type', 'application/webhook+json').set('authorization', 'nope').send(body).expect(401);
    const at = new AccessToken(LK.LIVEKIT_API_KEY, LK.LIVEKIT_API_SECRET);
    at.sha256 = createHash('sha256').update(body).digest('base64');
    await t.http.post('/v1/livekit/webhook').set('content-type', 'application/webhook+json').set('authorization', await at.toJwt()).send(body).expect(200);
    expect(((await t.http.get(`/v1/calls/${j.call.id}`).set(zara.auth).expect(200)).body as CallView)).toMatchObject({ status: 'ended', outcome: 'completed' });
  });
});

describe('Calls without LiveKit set up', () => {
  let t: TestApp;
  beforeAll(async () => { t = await startApp(); });
  afterAll(async () => { await t.close(); });
  it('says calls are not available', async () => {
    const [a, b] = [await makeUser(t, 'Ali'), await makeUser(t, 'Sara')];
    const c = (await t.http.post('/v1/conversations/direct').set(a.auth).send({ userId: b.id }).expect(200)).body.id;
    expect((await t.http.post('/v1/calls').set(a.auth).send({ conversationId: c, media: 'voice' }).expect(503)).body.error.message).toBe("Calls aren't available right now. Try again later.");
  });
});

import * as net from 'net';
import { ChatEngine, memoryOutbox, YaysClient, type OutboxStore, type PendingMessage, type Tokens } from '@yays/shared';
import { device, signInEmail, startApp, type TestApp } from './helpers';
import { cid, makeUser, sleep, type TUser } from './chat-helpers';

/** A TCP relay in front of the API. down() is the Wi-Fi going off: open connections drop, new ones are refused. */
class NetSwitch {
  private server: net.Server; private conns = new Set<net.Socket>(); private isUp = true; port = 0;
  constructor(public target: number) {
    this.server = net.createServer((c) => {
      if (!this.isUp) { c.destroy(); return; }
      const u = net.connect(this.target, '127.0.0.1');
      this.conns.add(c); this.conns.add(u);
      const end = () => { c.destroy(); u.destroy(); this.conns.delete(c); this.conns.delete(u); };
      c.on('error', end); u.on('error', end); c.on('close', end); u.on('close', end);
      c.pipe(u); u.pipe(c);
    });
  }
  async listen() { await new Promise<void>((r) => this.server.listen(0, '127.0.0.1', () => r())); this.port = (this.server.address() as net.AddressInfo).port; return this; }
  down() { this.isUp = false; for (const c of this.conns) c.destroy(); this.conns.clear(); }
  up() { this.isUp = true; }
  async close() { this.down(); await new Promise((r) => this.server.close(() => r(null))); }
  get url() { return `http://127.0.0.1:${this.port}`; }
}

async function waitFor<T>(fn: () => T | undefined | null | false, what: string, ms = 8000): Promise<T> {
  const until = Date.now() + ms;
  for (;;) { const v = fn(); if (v) return v; if (Date.now() > until) throw new Error(`timed out waiting for ${what}`); await sleep(40); }
}

interface Dev { engine: ChatEngine; net: NetSwitch; tokens: { v: Tokens | null }; outbox: OutboxStore; signedOut: boolean; client: YaysClient }

describe('Week 3 · chat engine (what web and mobile run) against the live server', () => {
  let t: TestApp; let ali: TUser; let sara: TUser;
  const devs: Dev[] = [];
  const dev = async (u: { body: { tokens: Tokens; me?: { id: string } }; id: string }, outbox: OutboxStore = memoryOutbox(), target?: number): Promise<Dev> => {
    const sw = await new NetSwitch(target ?? Number(new URL(t.url).port)).listen();
    const tokens = { v: u.body.tokens as Tokens | null };
    const d: Dev = { net: sw, tokens, outbox, signedOut: false, engine: undefined as unknown as ChatEngine, client: undefined as unknown as YaysClient };
    d.client = new YaysClient({ baseUrl: sw.url, tokens: { get: () => tokens.v, set: (x) => { tokens.v = x; } }, device: device(9), timeoutMs: 4000 });
    d.engine = new ChatEngine({ client: d.client, me: u.id, outbox, ackTimeoutMs: 2000, onSignedOut: () => { d.signedOut = true; } });
    await d.engine.start();
    await waitFor(() => d.engine.getState().connection === 'online', 'connection');
    devs.push(d);
    return d;
  };
  const items = (d: Dev, convId: string) => d.engine.thread(convId);
  const texts = (d: Dev, convId: string) => items(d, convId).map((i) => i.text);

  beforeAll(async () => { t = await startApp(); ali = await makeUser(t, 'Ali'); sara = await makeUser(t, 'Sara'); });
  afterEach(async () => { while (devs.length) { const d = devs.pop()!; d.engine.stop(); await d.net.close(); } });
  afterAll(async () => { await t.close(); });

  it('sends, delivers and reads, with ticks going pending → sent → delivered → read', async () => {
    const a = await dev(ali), s = await dev(sara);
    const c = await a.engine.startDirect(sara.id);
    await a.engine.open(c.id);
    const clientId = await a.engine.send(c.id, 'Hello from the engine');
    expect(items(a, c.id).find((i) => i.clientId === clientId)?.tick).toMatch(/pending|sent/);
    await waitFor(() => s.engine.getState().conversations[c.id]?.unread === 1, 'Sara sees an unread chat');
    expect(s.engine.getState().order[0]).toBe(c.id);
    await waitFor(() => items(a, c.id)[0]?.tick === 'delivered', 'delivered tick');
    await s.engine.open(c.id);
    expect(texts(s, c.id)).toEqual(['Hello from the engine']);
    await waitFor(() => items(a, c.id)[0]?.tick === 'read', 'read tick');
    expect(s.engine.getState().conversations[c.id].unread).toBe(0);
    expect(a.engine.getState().outbox).toEqual([]);
  });

  it('messages typed with no connection wait, then go out once, in order, when it comes back', async () => {
    const a = await dev(ali), s = await dev(sara);
    const c = await a.engine.startDirect(sara.id);
    await a.engine.open(c.id); await s.engine.open(c.id);
    const before = (await t.http.get(`/v1/conversations/${c.id}`).set(ali.auth)).body.lastSeq;
    a.net.down();
    await waitFor(() => a.engine.getState().connection === 'offline', 'offline');
    for (const x of ['first', 'second', 'third']) await a.engine.send(c.id, x);
    await sleep(1500);
    const waiting = items(a, c.id).filter((i) => i.tick === 'pending').map((i) => i.text);
    expect(waiting).toEqual(['first', 'second', 'third']);
    expect((await a.outbox.load()).map((p) => p.text)).toEqual(['first', 'second', 'third']); // kept on the device
    a.net.up();
    await waitFor(() => a.engine.getState().outbox.length === 0, 'queue empties', 15000);
    const saved = (await t.http.get(`/v1/conversations/${c.id}/messages`).query({ after: before }).set(ali.auth)).body.items;
    expect(saved.map((m: { text: string; seq: number }) => [m.text, m.seq])).toEqual([['first', before + 1], ['second', before + 2], ['third', before + 3]]);
    await waitFor(() => texts(s, c.id).slice(-3).join() === 'first,second,third', 'Sara gets all three in order');
    expect(texts(s, c.id).filter((x) => x === 'first')).toHaveLength(1);
  });

  it('a device that was offline catches up on everything it missed', async () => {
    const a = await dev(ali), s = await dev(sara);
    const c = await a.engine.startDirect(sara.id);
    await s.engine.open(c.id);
    s.net.down();
    await waitFor(() => s.engine.getState().connection === 'offline', 'Sara offline');
    for (let i = 0; i < 5; i++) await a.engine.send(c.id, `missed ${i}`);
    await waitFor(() => a.engine.getState().outbox.length === 0, 'Ali sent');
    await sleep(300);
    expect(texts(s, c.id).filter((x) => x.startsWith('missed'))).toEqual([]);
    s.net.up();
    await waitFor(() => texts(s, c.id).filter((x) => x.startsWith('missed')).length === 5, 'catch-up', 15000);
    expect(texts(s, c.id).filter((x) => x.startsWith('missed'))).toEqual([0, 1, 2, 3, 4].map((i) => `missed ${i}`));
    const seqs = items(s, c.id).map((i) => i.seq!);
    expect(seqs).toEqual([...seqs].sort((x, y) => x - y));
    expect(new Set(seqs).size).toBe(seqs.length);
  });

  it('after the app is closed mid-send, the next start sends the queue without doubling anything', async () => {
    const store = memoryOutbox();
    const a1 = await dev(ali, store);
    const c = await a1.engine.startDirect(sara.id);
    a1.net.down();
    await waitFor(() => a1.engine.getState().connection === 'offline', 'offline');
    await a1.engine.send(c.id, 'survives a restart');
    // A message the server already stored whose answer never came back.
    const lost: PendingMessage = { clientId: cid(), conversationId: c.id, text: 'answer was lost', createdAt: new Date().toISOString(), attempts: 1, status: 'pending' };
    await t.http.post(`/v1/conversations/${c.id}/messages`).set(ali.auth).send({ clientId: lost.clientId, text: lost.text }).expect(200);
    await store.save([lost, ...(await store.load())]);
    a1.engine.stop();
    const a2 = await dev(ali, store);
    await a2.engine.open(c.id);
    await waitFor(() => a2.engine.getState().outbox.length === 0, 'queue sent', 15000);
    const all = (await t.http.get(`/v1/conversations/${c.id}/messages`).query({ limit: 100 }).set(ali.auth)).body.items.map((m: { text: string }) => m.text);
    expect(all.filter((x: string) => x === 'answer was lost')).toHaveLength(1);
    expect(all.filter((x: string) => x === 'survives a restart')).toHaveLength(1);
    await waitFor(() => texts(a2, c.id).includes('survives a restart'), 'shown as sent');
  });

  it('a message the server refuses for good is marked failed and can be retried or removed', async () => {
    const omar = await makeUser(t, 'Omar');
    const notMine = (await t.http.post('/v1/conversations/direct').set(omar.auth).send({ userId: sara.id }).expect(200)).body.id;
    const a = await dev(ali);
    const id = await a.engine.send(notMine, 'should fail');
    await waitFor(() => a.engine.getState().outbox.find((p) => p.clientId === id)?.status === 'failed', 'failed');
    expect(a.engine.getState().outbox[0].error).toBe('Chat not found.');
    const c = await a.engine.startDirect(sara.id);
    await a.engine.send(c.id, 'later ones still go'); // a failed message does not block the queue
    await waitFor(() => a.engine.getState().outbox.length === 1, 'the good one sent');
    await a.engine.retry(id);
    await waitFor(() => a.engine.getState().outbox[0]?.status === 'failed' && a.engine.getState().outbox[0].attempts === 0, 'failed again');
    await a.engine.discard(id);
    expect(a.engine.getState().outbox).toEqual([]);
    await expect(a.engine.send(c.id, '   ')).rejects.toThrow('The message is empty.');
  });

  it('shows typing, clears it when the message lands, and reads on one device clear the badge on the other', async () => {
    const a = await dev(ali);
    const s1 = await dev(sara);
    const sara2 = await signInEmail(t, (await t.http.get('/v1/me').set(sara.auth)).body.email, device(5, 'android'));
    const s2 = await dev({ id: sara.id, body: sara2 });
    const c = await a.engine.startDirect(sara.id);
    await s1.engine.open(c.id);
    a.engine.typing(c.id, true);
    await waitFor(() => s1.engine.typingIn(c.id).includes(ali.id), 'typing shown');
    s1.engine.setVisible(false); // Sara's first device is in the background
    await a.engine.send(c.id, 'typing done');
    await waitFor(() => s1.engine.typingIn(c.id).length === 0 && s1.engine.getState().conversations[c.id]?.unread === 1, 'typing cleared, unread on device 1');
    await waitFor(() => s2.engine.getState().conversations[c.id]?.unread === 1, 'unread on device 2');
    await s2.engine.open(c.id);
    await waitFor(() => s1.engine.getState().conversations[c.id].unread === 0, 'read on device 2 clears device 1');
  });

  it('follows the other person online and offline while their chat is open', async () => {
    const s = await dev(sara);
    const c = await s.engine.startDirect(ali.id);
    await s.engine.open(c.id);
    await waitFor(() => s.engine.getState().presence[ali.id], 'presence loaded');
    const a = await dev(ali);
    await waitFor(() => s.engine.getState().presence[ali.id]?.online, 'online');
    a.engine.stop();
    await waitFor(() => s.engine.getState().presence[ali.id]?.online === false && s.engine.getState().presence[ali.id]?.lastSeenAt, 'last seen');
  });

  it('a device signed out from elsewhere stops and reports it', async () => {
    const other = await signInEmail(t, (await t.http.get('/v1/me').set(sara.auth)).body.email, device(6, 'ios'));
    const d = await dev({ id: sara.id, body: other });
    await t.http.delete(`/v1/me/devices/${other.tokens.sessionId}`).set(sara.auth).expect(204);
    await waitFor(() => d.signedOut && d.engine.getState().signedOut, 'signed out');
  });

  it('survives the server restarting: queued messages go out to the new server', async () => {
    const a = await dev(ali), s = await dev(sara);
    const c = await a.engine.startDirect(sara.id);
    await s.engine.open(c.id);
    const env = t.env;
    await t.stop(); // the server goes away; the database stays
    await waitFor(() => a.engine.getState().connection === 'offline', 'offline after restart');
    await a.engine.send(c.id, 'sent while the server was down');
    t = await startApp({ MONGO_DB: env.MONGO_DB, LOCAL_STORAGE_DIR: env.LOCAL_STORAGE_DIR }, { keepRedis: true });
    const port = Number(new URL(t.url).port);
    a.net.target = port; s.net.target = port;
    await waitFor(() => a.engine.getState().outbox.length === 0, 'queue flushed to new server', 20000);
    await waitFor(() => texts(s, c.id).includes('sent while the server was down'), 'Sara gets it', 20000);
  });
});

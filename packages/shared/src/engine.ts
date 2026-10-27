import { io as ioConnect, type Socket } from 'socket.io-client';
import { ApiError } from './errors';
import type { YaysClient } from './client';
import { tickFor, type Ack, type ChatMessage, type ClientEvents, type ConversationSummary, type MemberReceipt, type Presence, type SendResult, type ServerEvents, type Tick } from './chat';

/** A message typed on this device that the server has not confirmed yet. Kept on the device until it has. */
export interface PendingMessage {
  clientId: string;
  conversationId: string;
  text: string;
  createdAt: string;
  attempts: number;
  status: 'pending' | 'failed';
  error?: string;
}

/** Where the unsent queue survives an app restart: localStorage on web, AsyncStorage on mobile. */
export interface OutboxStore { load(): Promise<PendingMessage[]> | PendingMessage[]; save(items: PendingMessage[]): Promise<void> | void }
export const memoryOutbox = (): OutboxStore => { let v: PendingMessage[] = []; return { load: () => v, save: (x) => { v = x; } }; };

export interface Thread { items: ChatMessage[]; hasMore: boolean; loaded: boolean; loading: boolean }

export interface ChatState {
  /** online: live connection up. connecting: trying. offline: no connection, messages wait in the queue. */
  connection: 'connecting' | 'online' | 'offline';
  conversations: Record<string, ConversationSummary>;
  /** Conversation ids, most recent activity first. Empty chats appear only after a message. */
  order: string[];
  listLoaded: boolean;
  listNext: string | null;
  threads: Record<string, Thread>;
  outbox: PendingMessage[];
  /** conversationId → userId → typing until (ms). */
  typing: Record<string, Record<string, number>>;
  presence: Record<string, Presence>;
  active: string | null;
  signedOut: boolean;
}

export interface ThreadItem { key: string; mine: boolean; text: string; createdAt: string; seq: number | null; senderId: string; tick: Tick | null; clientId: string }

export interface EngineOptions {
  client: YaysClient;
  me: string;
  outbox?: OutboxStore;
  /** Extra socket.io options (tests use this to force a transport). */
  socketOptions?: Record<string, unknown>;
  /** How long to wait for the server to confirm a message before trying again. */
  ackTimeoutMs?: number;
  onSignedOut?: () => void;
}

const TYPING_SHOWN_MS = 6000;
const TYPING_SEND_EVERY_MS = 2500;
const CATCH_UP_PAGE = 100;
const CATCH_UP_MAX = 1000;

/** A random v4 UUID that also works where crypto.randomUUID is missing (React Native). */
export function uuid(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string; getRandomValues?: (a: Uint8Array) => Uint8Array } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  const b = new Uint8Array(16);
  if (c?.getRandomValues) c.getRandomValues(b); else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

const byActivity = (cs: Record<string, ConversationSummary>) => Object.values(cs).filter((c) => c.lastSeq > 0).sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt) || b.id.localeCompare(a.id)).map((c) => c.id);

/**
 * Everything a chat screen needs, the same on web and mobile: the chat list, threads, the unsent queue,
 * ticks, typing and online status. Screens read `getState()` and re-render on `subscribe`.
 */
export class ChatEngine {
  private state: ChatState = { connection: 'connecting', conversations: {}, order: [], listLoaded: false, listNext: null, threads: {}, outbox: [], typing: {}, presence: {}, active: null, signedOut: false };
  private listeners = new Set<() => void>();
  private socket?: Socket<ServerEvents, ClientEvents>;
  private flushing = false;
  private flushTimer?: ReturnType<typeof setTimeout>;
  private typingTimer?: ReturnType<typeof setInterval>;
  private lastTypingSent: Record<string, number> = {};
  private stopped = false;
  private visible = true;
  private readonly outbox: OutboxStore;
  private readonly ackTimeout: number;
  private catchingUp = new Map<string, Promise<void>>();

  constructor(private readonly o: EngineOptions) {
    this.outbox = o.outbox ?? memoryOutbox();
    this.ackTimeout = o.ackTimeoutMs ?? 8000;
  }

  /** The signed-in user's id. */
  get me() { return this.o.me; }

  // ---------- store ----------
  getState = () => this.state;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  private set(patch: Partial<ChatState>) { this.state = { ...this.state, ...patch }; for (const l of this.listeners) l(); }
  private setConv(c: ConversationSummary) {
    const conversations = { ...this.state.conversations, [c.id]: c };
    this.set({ conversations, order: byActivity(conversations) });
  }
  private setThread(id: string, t: Partial<Thread>) {
    const cur = this.state.threads[id] ?? { items: [], hasMore: true, loaded: false, loading: false };
    this.set({ threads: { ...this.state.threads, [id]: { ...cur, ...t } } });
  }
  private async setOutbox(items: PendingMessage[]) { this.set({ outbox: items }); try { await this.outbox.save(items); } catch { /* storage full: the queue still lives in memory */ } }

  // ---------- lifecycle ----------
  async start() {
    const saved = await Promise.resolve(this.outbox.load()).catch(() => [] as PendingMessage[]);
    // Anything that was mid-send when the app closed goes back to waiting.
    this.set({ outbox: (saved ?? []).map((p) => ({ ...p, status: p.status === 'failed' ? 'failed' : 'pending' })) });
    this.connect();
    this.typingTimer = setInterval(() => this.pruneTyping(), 1000);
    await this.loadList().catch(() => undefined);
    void this.flush();
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.flushTimer); clearInterval(this.typingTimer);
    this.socket?.removeAllListeners(); this.socket?.disconnect(); this.socket = undefined;
    this.listeners.clear();
  }

  /** Tell the engine whether the window/app is in front. Read ticks are only sent while it is. */
  setVisible(v: boolean) { this.visible = v; if (v && this.state.active) void this.markActiveRead(); }

  private connect() {
    const s: Socket<ServerEvents, ClientEvents> = ioConnect(this.o.client.baseUrl, {
      path: '/v1/socket', transports: ['websocket'], reconnectionDelay: 500, reconnectionDelayMax: 5000, timeout: 8000,
      auth: (cb: (d: object) => void) => { void this.o.client.accessToken().then((token) => cb({ token: token ?? '' }), () => cb({ token: '' })); },
      ...this.o.socketOptions,
    });
    this.socket = s;
    s.on('connect', () => { this.set({ connection: 'online' }); void this.catchUpAll(); void this.flush(true); this.rewatch(); });
    s.on('disconnect', (reason) => {
      this.set({ connection: 'offline', typing: {} });
      // The server only closes us on purpose when this device was signed out; check, then reconnect.
      if (reason === 'io server disconnect') void this.recheckSession();
    });
    s.on('connect_error', (e: Error & { data?: { code?: string } }) => {
      if (this.stopped) return;
      this.set({ connection: 'offline' });
      const code = e.data?.code;
      if (code === 'unauthenticated' || code === 'session_revoked' || code === 'account_disabled') void this.recheckSession();
      // Network errors: socket.io keeps retrying on its own.
    });
    s.on('msg:new', ({ message }) => this.onMessage(message));
    s.on('receipt', (r) => this.onReceipt(r.conversationId, r.userId, { deliveredSeq: r.deliveredSeq, readSeq: r.readSeq }));
    s.on('typing', ({ conversationId, userId, on }) => this.onTyping(conversationId, userId, on));
    s.on('presence', (p) => this.set({ presence: { ...this.state.presence, [p.userId]: p } }));
  }

  /** After a refused connection: refresh the access token and reconnect, or report sign-out. */
  private async recheckSession() {
    if (this.stopped) return;
    const token = await this.o.client.accessToken(true).catch(() => null);
    if (this.stopped) return;
    if (!token) {
      // Still holding tokens means the refresh failed for network reasons: try again shortly.
      if (await this.o.client.hasSession()) { setTimeout(() => void this.recheckSession(), 3000); return; }
      this.set({ signedOut: true }); this.o.onSignedOut?.(); this.stop(); return;
    }
    setTimeout(() => { if (!this.stopped && this.socket && !this.socket.connected) this.socket.connect(); }, 300);
  }

  // ---------- chat list ----------
  async loadList(more = false) {
    if (more && !this.state.listNext) return;
    const page = await this.o.client.conversations({ before: more ? this.state.listNext ?? undefined : undefined, limit: 30 });
    const conversations = { ...this.state.conversations };
    for (const c of page.items) conversations[c.id] = this.mergeConv(conversations[c.id], c);
    this.set({ conversations, order: byActivity(conversations), listLoaded: true, listNext: more || !this.state.listLoaded ? page.next : this.state.listNext });
    for (const c of page.items) this.ackDelivered(c);
  }

  /** A fresher summary from the server, keeping receipts that already moved further here. */
  private mergeConv(old: ConversationSummary | undefined, c: ConversationSummary): ConversationSummary {
    if (!old) return c;
    const receipts = { ...c.receipts };
    for (const [u, r] of Object.entries(old.receipts)) { const n = receipts[u]; if (n) receipts[u] = { deliveredSeq: Math.max(n.deliveredSeq, r.deliveredSeq), readSeq: Math.max(n.readSeq, r.readSeq) }; }
    return { ...c, receipts };
  }

  /** Opens or creates the direct chat with someone, so it can be shown before the first message. */
  async startDirect(userId: string) {
    const c = await this.o.client.openDirect(userId);
    this.setConv(this.mergeConv(this.state.conversations[c.id], c));
    return c;
  }
  lookup(q: string) { return this.o.client.lookupUser(q); }

  // ---------- threads ----------
  /** The chat on screen: loads it, keeps it read, and follows the other person's online status. */
  async open(conversationId: string | null) {
    this.set({ active: conversationId });
    this.rewatch();
    if (!conversationId) return;
    if (!this.state.conversations[conversationId]) {
      const c = await this.o.client.conversation(conversationId);
      this.setConv(this.mergeConv(this.state.conversations[conversationId], c));
    }
    const t = this.state.threads[conversationId];
    if (!t?.loaded) await this.loadLatest(conversationId);
    else await this.catchUp(conversationId);
    void this.markActiveRead();
  }

  private async loadLatest(id: string) {
    this.setThread(id, { loading: true });
    try {
      const p = await this.o.client.messages(id, { limit: 50 });
      const have = this.state.threads[id]?.items ?? [];
      this.setThread(id, { items: mergeMessages(have, p.items), hasMore: p.hasMore, loaded: true, loading: false });
    } catch (e) { this.setThread(id, { loading: false }); throw e; }
  }

  async loadOlder(id: string) {
    const t = this.state.threads[id];
    if (!t?.loaded || !t.hasMore || t.loading) return;
    this.setThread(id, { loading: true });
    try {
      const p = await this.o.client.messages(id, { before: t.items[0]?.seq ?? 1, limit: 50 });
      this.setThread(id, { items: mergeMessages(this.state.threads[id]?.items ?? [], p.items), hasMore: p.hasMore, loading: false });
    } catch (e) { this.setThread(id, { loading: false }); throw e; }
  }

  /** Fetches whatever arrived after the newest message this device has, in order, with no gaps. */
  private catchUp(id: string): Promise<void> {
    const running = this.catchingUp.get(id);
    if (running) return running;
    const p = (async () => {
      const t = this.state.threads[id];
      if (!t?.loaded) return;
      let after = t.items[t.items.length - 1]?.seq ?? 0;
      for (let fetched = 0; fetched < CATCH_UP_MAX;) {
        const page = await this.o.client.messages(id, { after, limit: CATCH_UP_PAGE });
        if (page.items.length) { this.setThread(id, { items: mergeMessages(this.state.threads[id]?.items ?? [], page.items) }); after = page.items[page.items.length - 1].seq; fetched += page.items.length; }
        if (!page.hasMore) return;
      }
      // Too far behind: start the thread again from the latest messages.
      this.setThread(id, { items: [], loaded: false });
      await this.loadLatest(id);
    })().finally(() => this.catchingUp.delete(id));
    this.catchingUp.set(id, p);
    return p;
  }

  private async catchUpAll() {
    try {
      await this.loadList();
      await Promise.all(Object.keys(this.state.threads).map((id) => this.catchUp(id).catch(() => undefined)));
      void this.markActiveRead();
    } catch { /* the next reconnect tries again */ }
  }

  /** Confirmed messages plus this device's unsent ones, oldest first, each with its ticks. */
  thread(id: string): ThreadItem[] {
    const conv = this.state.conversations[id];
    const t = this.state.threads[id];
    const me = this.o.me;
    const items: ThreadItem[] = (t?.items ?? []).map((m) => ({
      key: m.clientId, mine: m.senderId === me, text: m.text, createdAt: m.createdAt, seq: m.seq, senderId: m.senderId, clientId: m.clientId,
      tick: m.senderId === me && conv ? tickFor(m, conv) : null,
    }));
    const confirmed = new Set(items.map((i) => i.clientId));
    for (const p of this.state.outbox) {
      if (p.conversationId !== id || confirmed.has(p.clientId)) continue;
      items.push({ key: p.clientId, mine: true, text: p.text, createdAt: p.createdAt, seq: null, senderId: me, clientId: p.clientId, tick: p.status === 'failed' ? 'failed' : 'pending' });
    }
    return items;
  }

  // ---------- sending ----------
  /** Queues a message and sends it as soon as there is a connection. Returns its clientId. */
  async send(conversationId: string, text: string): Promise<string> {
    const t = text.replace(/\u0000/g, '').trim();
    if (!t) throw new ApiError(400, 'validation_failed', 'The message is empty.');
    const p: PendingMessage = { clientId: uuid(), conversationId, text: t, createdAt: new Date().toISOString(), attempts: 0, status: 'pending' };
    await this.setOutbox([...this.state.outbox, p]);
    this.typing(conversationId, false);
    void this.flush(true);
    return p.clientId;
  }

  async retry(clientId: string) {
    await this.setOutbox(this.state.outbox.map((p) => (p.clientId === clientId ? { ...p, status: 'pending', attempts: 0, error: undefined } : p)));
    void this.flush(true);
  }
  async discard(clientId: string) { await this.setOutbox(this.state.outbox.filter((p) => p.clientId !== clientId)); }

  /** Sends the queue one message at a time, oldest first, so messages arrive in the order they were typed. */
  private async flush(now = false) {
    if (now) { clearTimeout(this.flushTimer); this.flushTimer = undefined; }
    if (this.flushing || this.stopped) return;
    this.flushing = true;
    let retryIn = 0;
    try {
      for (;;) {
        const p = this.state.outbox.find((x) => x.status === 'pending');
        if (!p || this.stopped) break;
        const r = await this.sendOne(p);
        if (r.kind === 'sent') {
          this.onMessage(r.message);
          await this.setOutbox(this.state.outbox.filter((x) => x.clientId !== p.clientId));
        } else if (r.kind === 'failed') {
          await this.setOutbox(this.state.outbox.map((x) => (x.clientId === p.clientId ? { ...x, status: 'failed', error: r.error } : x)));
        } else {
          const attempts = p.attempts + 1;
          await this.setOutbox(this.state.outbox.map((x) => (x.clientId === p.clientId ? { ...x, attempts } : x)));
          retryIn = r.retryInMs ?? Math.min(30_000, 1000 * 2 ** Math.min(attempts - 1, 5));
          break;
        }
      }
    } finally { this.flushing = false; }
    if (retryIn && !this.stopped && !this.flushTimer) this.flushTimer = setTimeout(() => { this.flushTimer = undefined; void this.flush(); }, retryIn);
  }

  private async sendOne(p: PendingMessage): Promise<{ kind: 'sent'; message: ChatMessage } | { kind: 'failed'; error: string } | { kind: 'later'; retryInMs?: number }> {
    const classify = (status: number, code: string, message: string, retryAfter?: number) => {
      if (status === 429) return { kind: 'later' as const, retryInMs: (retryAfter ?? 5) * 1000 };
      if (status === 401) { void this.recheckSession(); return { kind: 'later' as const }; }
      if (status >= 400 && status < 500) return { kind: 'failed' as const, error: message || code };
      return { kind: 'later' as const };
    };
    const s = this.socket;
    if (s?.connected) {
      try {
        const r = (await s.timeout(this.ackTimeout).emitWithAck('msg:send', { conversationId: p.conversationId, clientId: p.clientId, text: p.text })) as Ack<SendResult>;
        if (r.ok) return { kind: 'sent', message: r.data.message };
        return classify(r.error.status, r.error.code, r.error.message, r.error.details?.retryAfter as number | undefined);
      } catch { return { kind: 'later' }; } // no answer in time: same clientId next time, so no double
    }
    try {
      const r = await this.o.client.sendMessage(p.conversationId, p.clientId, p.text);
      return { kind: 'sent', message: r.message };
    } catch (e) {
      if (e instanceof ApiError) return e.status === 0 ? { kind: 'later' } : classify(e.status, e.code, e.message, e.retryAfter);
      return { kind: 'later' };
    }
  }

  // ---------- incoming ----------
  private onMessage(m: ChatMessage) {
    const id = m.conversationId;
    const conv = this.state.conversations[id];
    if (!conv) { void this.o.client.conversation(id).then((c) => { this.setConv(this.mergeConv(this.state.conversations[id], c)); this.ackDelivered(c); this.onMessage(m); }).catch(() => undefined); return; }
    const mine = m.senderId === this.o.me;
    const isNew = m.seq > conv.lastSeq;
    const readingNow = this.state.active === id && this.visible;
    const next: ConversationSummary = isNew
      ? { ...conv, lastSeq: m.seq, lastMessage: m, lastActivityAt: m.createdAt > conv.lastActivityAt ? m.createdAt : conv.lastActivityAt, unread: mine || readingNow ? (mine ? 0 : conv.unread) : Math.min(100, conv.unread + 1) }
      : conv;
    if (mine && isNew) next.receipts = { ...next.receipts, [m.senderId]: { deliveredSeq: m.seq, readSeq: m.seq } };
    this.setConv(next);
    const t = this.state.threads[id];
    if (t?.loaded) {
      const last = t.items[t.items.length - 1]?.seq ?? 0;
      if (m.seq <= last + 1) this.setThread(id, { items: mergeMessages(t.items, [m]) });
      else void this.catchUp(id); // something in between was missed
    }
    if (this.state.outbox.some((p) => p.clientId === m.clientId) && mine) void this.setOutbox(this.state.outbox.filter((p) => p.clientId !== m.clientId));
    if (!mine && isNew) {
      const ty = this.state.typing[id];
      if (ty?.[m.senderId]) { const { [m.senderId]: _gone, ...rest } = ty; this.set({ typing: { ...this.state.typing, [id]: rest } }); }
      this.emitReceipt('receipt:delivered', id, m.seq);
      if (readingNow) void this.markActiveRead();
    }
  }

  private onReceipt(convId: string, userId: string, r: MemberReceipt) {
    const c = this.state.conversations[convId];
    if (!c) return;
    const cur = c.receipts[userId] ?? { deliveredSeq: 0, readSeq: 0 };
    const nr = { deliveredSeq: Math.max(cur.deliveredSeq, r.deliveredSeq), readSeq: Math.max(cur.readSeq, r.readSeq) };
    let unread = c.unread;
    // Read on another of my devices: the badge here clears too.
    if (userId === this.o.me) unread = nr.readSeq >= c.lastSeq ? 0 : this.countUnread(convId, nr.readSeq, c.unread);
    this.setConv({ ...c, receipts: { ...c.receipts, [userId]: nr }, unread });
  }

  private countUnread(convId: string, readSeq: number, fallback: number) {
    const t = this.state.threads[convId];
    const conv = this.state.conversations[convId];
    if (!t?.loaded || !conv) return fallback;
    const first = t.items[0]?.seq ?? Infinity;
    if (first > readSeq + 1 && t.hasMore) return Math.min(fallback, conv.lastSeq - readSeq);
    return t.items.filter((m) => m.seq > readSeq && m.senderId !== this.o.me).length;
  }

  private ackDelivered(c: ConversationSummary) {
    const mine = c.receipts[this.o.me];
    if (c.lastSeq > 0 && (!mine || mine.deliveredSeq < c.lastSeq) && c.lastMessage?.senderId !== this.o.me) this.emitReceipt('receipt:delivered', c.id, c.lastSeq);
  }

  private emitReceipt(event: 'receipt:delivered' | 'receipt:read', conversationId: string, seq: number) {
    const s = this.socket;
    const apply = (r: MemberReceipt) => this.onReceipt(conversationId, this.o.me, r);
    if (s?.connected) {
      void s.timeout(this.ackTimeout).emitWithAck(event, { conversationId, seq }).then((r) => { if ((r as Ack<MemberReceipt>).ok) apply((r as { data: MemberReceipt }).data); }, () => undefined);
    } else {
      const call = event === 'receipt:read' ? this.o.client.markRead(conversationId, seq) : this.o.client.markDelivered(conversationId, seq);
      void call.then(apply, () => undefined); // offline: the next connect re-sends from the chat list
    }
  }

  private async markActiveRead() {
    const id = this.state.active;
    if (!id || !this.visible) return;
    const c = this.state.conversations[id];
    if (!c || c.lastSeq === 0) return;
    const mine = c.receipts[this.o.me];
    if (mine && mine.readSeq >= c.lastSeq && c.unread === 0) return;
    this.setConv({ ...c, unread: 0 });
    this.emitReceipt('receipt:read', id, c.lastSeq);
  }

  // ---------- typing and presence ----------
  /** Call on every keystroke (on=true) and when the box empties or the message is sent (on=false). */
  typing(conversationId: string, on: boolean) {
    const s = this.socket;
    if (!s?.connected) return;
    const now = Date.now(), last = this.lastTypingSent[conversationId] ?? 0;
    if (on && now - last < TYPING_SEND_EVERY_MS) return;
    if (!on && !last) return;
    this.lastTypingSent[conversationId] = on ? now : 0;
    s.emit('typing', { conversationId, on });
  }

  private onTyping(convId: string, userId: string, on: boolean) {
    const cur = { ...(this.state.typing[convId] ?? {}) };
    if (on) cur[userId] = Date.now() + TYPING_SHOWN_MS; else delete cur[userId];
    this.set({ typing: { ...this.state.typing, [convId]: cur } });
  }

  private pruneTyping() {
    const now = Date.now();
    let changed = false;
    const typing: ChatState['typing'] = {};
    for (const [c, users] of Object.entries(this.state.typing)) {
      const keep: Record<string, number> = {};
      for (const [u, until] of Object.entries(users)) { if (until > now) keep[u] = until; else changed = true; }
      typing[c] = keep;
    }
    if (changed) this.set({ typing });
  }

  /** People typing in a chat right now, excluding me. */
  typingIn(conversationId: string): string[] { const now = Date.now(); return Object.entries(this.state.typing[conversationId] ?? {}).filter(([u, t]) => t > now && u !== this.o.me).map(([u]) => u); }

  private rewatch() {
    const s = this.socket;
    if (!s?.connected) return;
    const c = this.state.active ? this.state.conversations[this.state.active] : null;
    const userIds = c ? c.memberIds.filter((m) => m !== this.o.me).slice(0, 50) : [];
    void s.timeout(this.ackTimeout).emitWithAck('presence:watch', { userIds }).then((r) => {
      const a = r as Ack<Presence[]>;
      if (a.ok) { const presence = { ...this.state.presence }; for (const p of a.data) presence[p.userId] = p; this.set({ presence }); }
    }, () => undefined);
  }
}

/** Merges two sorted message lists by seq, dropping duplicates. */
export function mergeMessages(a: ChatMessage[], b: ChatMessage[]): ChatMessage[] {
  if (!b.length) return a;
  const map = new Map<number, ChatMessage>();
  for (const m of a) map.set(m.seq, m);
  for (const m of b) map.set(m.seq, m);
  return [...map.values()].sort((x, y) => x.seq - y.seq);
}

import type { Server as HttpServer } from 'http';
import Redis from 'ioredis';
import { ObjectId, type Collection } from 'mongodb';
import { Server, type Socket } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import type { ZodTypeAny, z } from 'zod';
import {
  ErrorCode, focusSchema, presenceWatchSchema, socketReceiptSchema, socketSendSchema, typingSchema,
  type Ack, type ChatMessage, type ClientEvents, type MemberReceipt, type Presence, type ServerEvents,
} from '@yays/shared';
import { AppError } from '../common/app-error';
import { parse } from '../common/zod';
import type { Logger } from '../common/logger';
import type { Config } from '../config';
import type { RateLimiter } from '../infra/rate-limit';
import type { SessionService } from '../auth/sessions';
import type { TokenService } from '../auth/tokens';
import { privacyOf, type UserDoc } from '../users/users.repo';
import { sees } from '../chat/chat.service';
import { SEND_LIMIT } from '../chat/chat.controller';
import type { PushService } from '../push/push.service';
import type { ChatEvents, ChatService } from '../chat/chat.service';

interface SocketData { userId: ObjectId; uid: string; sid: string; watching: Set<string>; typingAt: Map<string, number>; heartbeat?: NodeJS.Timeout; joined?: Promise<void> }
type IoServer = Server<ClientEvents, ServerEvents, Record<string, never>, SocketData>;
type IoSocket = Socket<ClientEvents, ServerEvents, Record<string, never>, SocketData>;

export interface RealtimeDeps {
  config: Config; log: Logger; redis: Redis; tokens: TokenService; sessions: SessionService; chat: ChatService; limiter: RateLimiter; users: Collection<UserDoc>; push: PushService;
}

/** How long a socket counts as online without a heartbeat (covers servers that die without saying goodbye). */
const PRESENCE_TTL_MS = 90_000;
const HEARTBEAT_MS = 30_000;
const TYPING_EVERY_MS = 2_000;
const room = { user: (id: string) => `u:${id}`, session: (sid: string) => `s:${sid}`, presence: (id: string) => `p:${id}` };
const pKey = (uid: string) => `pres:${uid}`;
// Adds this socket and returns how many live sockets the user had before it.
const JOIN = `redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[1]) local n = redis.call('ZCARD', KEYS[1]) redis.call('ZADD', KEYS[1], ARGV[2], ARGV[3]) redis.call('PEXPIRE', KEYS[1], ARGV[4]) return n`;
// Removes this socket and returns how many live sockets the user still has.
const LEAVE = `redis.call('ZREM', KEYS[1], ARGV[2]) redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[1]) return redis.call('ZCARD', KEYS[1])`;

/**
 * The live connection between apps and the server. Several API servers can run at once: the Redis adapter
 * passes every event to whichever server holds the receiving person's sockets.
 */
export class Realtime implements ChatEvents {
  private io?: IoServer;
  private pub?: Redis;
  private sub?: Redis;
  private pending = new Set<Promise<unknown>>();
  constructor(private readonly d: RealtimeDeps) {}

  attach(http: HttpServer) {
    const { config } = this.d;
    const io: IoServer = new Server(http, {
      path: '/v1/socket', cors: { origin: config.corsOrigins }, serveClient: false,
      pingInterval: 20_000, pingTimeout: 20_000, maxHttpBufferSize: 64 * 1024, connectionStateRecovery: undefined,
    });
    this.pub = new Redis(config.REDIS_URL, { lazyConnect: false, maxRetriesPerRequest: null });
    this.sub = this.pub.duplicate();
    io.adapter(createAdapter(this.pub, this.sub, { key: 'yc-sio' }));
    io.use((socket, next) => { this.authenticate(socket as IoSocket).then(() => next(), (e) => next(socketError(e))); });
    io.on('connection', (s) => this.onConnection(s));
    this.io = io;
    return io;
  }

  private async authenticate(socket: IoSocket) {
    const token = typeof socket.handshake.auth?.token === 'string' ? socket.handshake.auth.token : '';
    if (!token) throw AppError.unauthenticated();
    const claims = await this.d.tokens.verifyAccess(token);
    await this.d.sessions.assertActive(claims.sid);
    if (!/^[a-f0-9]{24}$/.test(claims.sub)) throw AppError.unauthenticated();
    const userId = new ObjectId(claims.sub);
    const u = await this.d.users.findOne({ _id: userId }, { projection: { 'yc.disabledAt': 1 } });
    if (!u) throw AppError.unauthenticated();
    if (u.yc?.disabledAt) throw new AppError(403, ErrorCode.ACCOUNT_DISABLED, 'This account is turned off. Contact support.');
    socket.data = { userId, uid: claims.sub, sid: claims.sid, watching: new Set(), typingAt: new Map() };
  }

  private onConnection(s: IoSocket) {
    const { uid, sid } = s.data;
    void s.join([room.user(uid), room.session(sid)]);
    s.data.joined = this.markOnline(s);
    s.data.heartbeat = setInterval(() => {
      void this.d.redis.zadd(pKey(uid), Date.now() + PRESENCE_TTL_MS, s.id).then(() => this.d.redis.pexpire(pKey(uid), PRESENCE_TTL_MS)).catch(() => undefined);
      void this.d.push.touchFocus(uid, s.id).catch(() => undefined);
    }, HEARTBEAT_MS);
    s.on('disconnect', () => {
      clearInterval(s.data.heartbeat);
      void this.d.push.clearFocus(uid, s.id).catch(() => undefined);
      const p = (s.data.joined ?? Promise.resolve()).then(() => this.markOffline(s));
      this.pending.add(p); void p.finally(() => this.pending.delete(p));
    });

    this.on(s, 'msg:send', socketSendSchema, async (v) => {
      await this.d.limiter.hit(`send:${uid}`, SEND_LIMIT.count, SEND_LIMIT.windowSeconds, 'You are sending messages too fast. Wait a moment.');
      return this.d.chat.send(s.data.userId, v.conversationId, v.clientId, v.text, { replyToId: v.replyToId, attachment: v.attachment, mentions: v.mentions });
    });
    this.on(s, 'receipt:delivered', socketReceiptSchema, (v) => this.d.chat.receipt(s.data.userId, v.conversationId, 'delivered', v.seq));
    this.on(s, 'receipt:read', socketReceiptSchema, (v) => this.d.chat.receipt(s.data.userId, v.conversationId, 'read', v.seq));
    this.on(s, 'typing', typingSchema, async (v) => {
      // "Started typing" at most every 2 seconds per chat; "stopped" always goes through.
      const now = Date.now(), last = s.data.typingAt.get(v.conversationId) ?? 0;
      if (v.on && now - last < TYPING_EVERY_MS) return null;
      s.data.typingAt.set(v.conversationId, v.on ? now : 0);
      const c = await this.d.chat.memberConv(v.conversationId, s.data.userId);
      let others = c.members.filter((m) => !m.equals(s.data.userId));
      if (c.kind === 'direct') { const blocked = await this.d.chat.blockedEitherWay(s.data.userId, others); others = others.filter((m) => !blocked.has(m.toHexString())); }
      const rooms = others.map((m) => room.user(m.toHexString()));
      if (rooms.length) this.io!.to(rooms).emit('typing', { conversationId: v.conversationId, userId: uid, on: v.on });
      return null;
    });
    this.on(s, 'focus', focusSchema, async (v) => { await this.d.push.setFocus(uid, s.id, v.conversationId, v.visible); return null; });
    this.on(s, 'presence:watch', presenceWatchSchema, async (v) => {
      // Only people you share a chat with: online status is not public.
      const asked = [...new Set(v.userIds)].filter((id) => id !== uid);
      const allowed = await this.d.chat.sharesChatWith(s.data.userId, asked.map((i) => new ObjectId(i)));
      // Blocking hides online status both ways.
      for (const id of await this.d.chat.blockedEitherWay(s.data.userId, [...allowed].map((i) => new ObjectId(i)))) allowed.delete(id);
      // Each person's "last seen and online" setting decides who sees it.
      const { visible, iHide } = await this.presenceRules(s.data.userId, [...allowed]);
      for (const id of s.data.watching) if (!visible.has(id)) void s.leave(room.presence(id));
      for (const id of visible) void s.join(room.presence(id));
      s.data.watching = visible;
      const shown = await this.presenceOf([...visible]);
      return [...allowed].map((id) => {
        const p = shown.find((x) => x.userId === id);
        if (!p) return { userId: id, online: false, lastSeenAt: null };
        // Hiding my own last seen means I don't see other people's either.
        return iHide ? { ...p, lastSeenAt: null } : p;
      });
    });
  }

  /** Runs a handler, validates its input and always answers with { ok, data } or { ok, error }. */
  private on<S extends ZodTypeAny, R>(s: IoSocket, event: keyof ClientEvents, schema: S, fn: (v: z.output<S>) => Promise<R> | R) {
    (s as unknown as Socket).on(event, async (payload: unknown, ack?: (r: Ack<R>) => void) => {
      const reply = typeof ack === 'function' ? ack : () => undefined;
      try {
        reply({ ok: true, data: await fn(parse(schema, payload)) });
      } catch (e) {
        if (e instanceof AppError) reply({ ok: false, error: { status: e.status, code: e.code, message: e.message, details: e.details } });
        else { this.d.log.error({ err: e, event }, 'socket handler failed'); reply({ ok: false, error: { status: 500, code: ErrorCode.INTERNAL, message: 'Something went wrong. Try again.' } }); }
      }
    });
  }

  private async markOnline(s: IoSocket) {
    const { uid } = s.data, now = Date.now();
    try {
      const before = Number(await this.d.redis.eval(JOIN, 1, pKey(uid), now, now + PRESENCE_TTL_MS, s.id, PRESENCE_TTL_MS));
      if (before === 0) this.io?.to(room.presence(uid)).emit('presence', { userId: uid, online: true, lastSeenAt: null });
    } catch (e) { this.d.log.warn({ err: e }, 'presence join failed'); }
  }

  private async markOffline(s: IoSocket) {
    const { uid, userId } = s.data;
    try {
      const left = Number(await this.d.redis.eval(LEAVE, 1, pKey(uid), Date.now(), s.id));
      if (left > 0) return;
      const at = new Date();
      await this.d.users.updateOne({ _id: userId }, { $set: { 'yc.lastSeenAt': at } });
      this.io?.to(room.presence(uid)).emit('presence', { userId: uid, online: false, lastSeenAt: at.toISOString() });
    } catch (e) { this.d.log.warn({ err: e }, 'presence leave failed'); }
  }

  async presenceOf(ids: string[]): Promise<Presence[]> {
    if (!ids.length) return [];
    const now = Date.now();
    const pipe = this.d.redis.pipeline();
    for (const id of ids) pipe.zcount(pKey(id), now, '+inf');
    const counts = (await pipe.exec()) ?? [];
    const users = await this.d.users.find({ _id: { $in: ids.map((i) => new ObjectId(i)) } }, { projection: { 'yc.lastSeenAt': 1 } }).toArray();
    const seen = new Map(users.map((u) => [u._id.toHexString(), (u.yc as { lastSeenAt?: Date } | undefined)?.lastSeenAt ?? null]));
    return ids.map((id, i) => {
      const online = Number(counts[i]?.[1] ?? 0) > 0;
      const ls = seen.get(id);
      return { userId: id, online, lastSeenAt: online || !ls ? null : ls.toISOString() };
    });
  }

  // ---- ChatEvents ----
  messageCreated(members: ObjectId[], message: ChatMessage) {
    if (members.length) this.io?.to(members.map((m) => room.user(m.toHexString()))).emit('msg:new', { message });
  }
  receiptChanged(members: ObjectId[], conversationId: string, userId: string, r: MemberReceipt) {
    this.io?.to(members.map((m) => room.user(m.toHexString()))).emit('receipt', { conversationId, userId, ...r });
  }

  messageUpdated(userIds: ObjectId[], message: ChatMessage) {
    if (userIds.length) this.io?.to(userIds.map((m) => room.user(m.toHexString()))).emit('msg:update', { message });
  }
  mine(userId: ObjectId, p: { conversationId: string; messageId: string; hidden?: boolean; starred?: boolean }) {
    this.io?.to(room.user(userId.toHexString())).emit('msg:mine', p);
  }

  conversationChanged(userIds: ObjectId[], conversationId: string) {
    if (userIds.length) this.io?.to(userIds.map((m) => room.user(m.toHexString()))).emit('conv:update', { conversationId });
  }

  private async presenceRules(viewer: ObjectId, ids: string[]) {
    const docs = (await this.d.users.find({ _id: { $in: [viewer, ...ids.map((i) => new ObjectId(i))] } }, { projection: { 'yc.privacy': 1 } }).toArray()) as UserDoc[];
    const others = docs.filter((d) => !d._id.equals(viewer));
    const contacts = await this.d.chat.contactsOf(viewer, others.map((d) => d._id));
    const me = docs.find((d) => d._id.equals(viewer));
    return {
      visible: new Set(others.filter((d) => sees(privacyOf(d).lastSeen, contacts.has(d._id.toHexString()))).map((d) => d._id.toHexString())),
      iHide: !!me && privacyOf(me).lastSeen === 'nobody',
    };
  }

  /** Someone changed who sees their online status: everyone watching them checks again. */
  privacyChanged(uid: ObjectId) {
    const id = uid.toHexString();
    this.io?.to(room.presence(id)).emit('presence', { userId: id, online: false, lastSeenAt: null });
    this.io?.to(room.presence(id)).emit('presence:recheck', { userId: id });
    this.io?.in(room.presence(id)).socketsLeave(room.presence(id));
  }

  /** After a block, neither side keeps watching the other's online status. */
  blocked(by: ObjectId, target: ObjectId) {
    const b = by.toHexString(), t = target.toHexString();
    this.io?.in(room.user(t)).socketsLeave(room.presence(b));
    this.io?.in(room.user(b)).socketsLeave(room.presence(t));
    // Their screen stops showing me online, the same as anyone who can't see it.
    this.io?.to(room.user(t)).emit('presence', { userId: b, online: false, lastSeenAt: null });
  }

  callEvent(userId: ObjectId, event: 'call:ring' | 'call:update', call: import('@yays/shared').CallView) {
    this.io?.to(room.user(userId.toHexString())).emit(event, { call });
  }

  /** A device that was signed out loses its live connection right away, on whichever server holds it. */
  kickSession(sid: string) { this.io?.in(room.session(sid)).disconnectSockets(true); }

  async close() {
    if (this.io) {
      for (const s of this.io.of('/').sockets.values()) clearInterval(s.data.heartbeat);
      // Without this the http server stays open; Nest closes it again afterwards, which is harmless.
      this.io.of('/').disconnectSockets(true);
      await new Promise<void>((r) => this.io!.close(() => r()));
      await Promise.allSettled([...this.pending]);
    }
    // quit() waits for commands already sent (the adapter may still be publishing the disconnects).
    await Promise.all([this.pub?.quit().catch(() => undefined), this.sub?.quit().catch(() => undefined)]);
  }
}

function socketError(e: unknown) {
  const err = new Error(e instanceof AppError ? e.code : ErrorCode.UNAUTHENTICATED) as Error & { data?: unknown };
  err.data = e instanceof AppError ? { status: e.status, code: e.code, message: e.message } : { status: 401, code: ErrorCode.UNAUTHENTICATED, message: 'Please sign in again.' };
  return err;
}
export const REALTIME = Symbol('REALTIME');

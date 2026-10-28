import { createHash } from 'crypto';
import * as https from 'https';
import type Redis from 'ioredis';
import { ObjectId, type Collection, type Db } from 'mongodb';
import webpush from 'web-push';
import { messagePreview, systemText, type ChatMessage } from '@yays/shared';
import type { Config } from '../config';
import type { Logger } from '../common/logger';
import { C } from '../infra/mongo';
import type { NotificationSettings } from '@yays/shared';
import { displayNameOf, notifyOf, type UserDoc } from '../users/users.repo';

/** True when it's inside the person's quiet hours, in their time zone (a range may cross midnight). */
export function inQuietHours(n: NotificationSettings, now = new Date()) {
  if (!n.quietHours.on) return false;
  let hm: string;
  try { hm = new Intl.DateTimeFormat('en-GB', { timeZone: n.timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now); } catch { return false; }
  const { from, to } = n.quietHours;
  return from <= to ? hm >= from && hm < to : hm >= from || hm < to;
}
import type { ChatPrefDoc, ConversationDoc } from '../chat/chat.service';

export interface PushSubDoc { _id: string; userId: ObjectId; sid: string; endpoint: string; keys: { p256dh: string; auth: string }; createdAt: Date; lastOkAt?: Date; userAgent?: string }

export type PushPayload =
  | { type: 'message'; conversationId: string; messageId: string; title: string; body: string; tag: string; url: string }
  | { type: 'read'; conversationId: string; tag: string }
  | { type: 'call'; callId: string; title: string; body: string; tag: string; url: string }
  | { type: 'call_end'; callId: string; tag: string };

/** Where pushes go. "dev" keeps them in Redis so tests (and developers) can see what would have been sent. */
interface Sender { send(sub: PushSubDoc, payload: PushPayload): Promise<'ok' | 'gone'> }

class DevSender implements Sender {
  constructor(private readonly redis: Redis) {}
  async send(sub: PushSubDoc, payload: PushPayload) {
    await this.redis.lpush(`push:dev:${sub.userId.toHexString()}`, JSON.stringify({ endpoint: sub.endpoint, payload, at: Date.now() }));
    await this.redis.ltrim(`push:dev:${sub.userId.toHexString()}`, 0, 199);
    await this.redis.expire(`push:dev:${sub.userId.toHexString()}`, 3600);
    return 'ok' as const;
  }
}

class WebPushSender implements Sender {
  constructor(private readonly c: { publicKey: string; privateKey: string; subject: string; agent?: https.Agent }) {}
  async send(sub: PushSubDoc, payload: PushPayload) {
    try {
      await webpush.sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, JSON.stringify(payload), {
        vapidDetails: { subject: this.c.subject, publicKey: this.c.publicKey, privateKey: this.c.privateKey },
        // Messages are worth delivering for a day; "read" signals only matter right now.
        ...(this.c.agent ? { agent: this.c.agent } : {}),
        // Messages are worth a day; a ring only while it rings; "read" and "call over" only right now.
        TTL: payload.type === 'message' ? 86400 : payload.type === 'call' ? 45 : 60, urgency: payload.type === 'message' || payload.type === 'call' ? 'high' : 'low',
        // Topic: URL-safe, up to 32 characters. A newer push for the same chat (or call) replaces one still waiting.
        topic: ('conversationId' in payload ? payload.conversationId : payload.callId).slice(0, 32),
      });
      return 'ok' as const;
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) return 'gone' as const; // the browser dropped this subscription
      throw e;
    }
  }
}

const subId = (endpoint: string) => createHash('sha256').update(endpoint).digest('base64url');
export const prefKey = (conv: ObjectId, user: ObjectId) => `${conv.toHexString()}:${user.toHexString()}`;

/**
 * Notifications for people who aren't looking. Nobody gets a push while any of their devices has the app
 * in front (the open app shows its own banner), for a muted chat, or for their own messages.
 */
export class PushService {
  readonly subs: Collection<PushSubDoc>;
  readonly prefs: Collection<ChatPrefDoc>;
  private readonly users: Collection<UserDoc>;
  private readonly sender: Sender;
  readonly publicKey: string;

  constructor(db: Db, private readonly redis: Redis, c: Config, private readonly log: Logger) {
    this.subs = db.collection(C.pushSubs);
    this.prefs = db.collection(C.chatPrefs);
    this.users = db.collection(C.users);
    let pub = c.VAPID_PUBLIC_KEY, priv = c.VAPID_PRIVATE_KEY;
    if (!pub || !priv) { const k = webpush.generateVAPIDKeys(); pub = k.publicKey; priv = k.privateKey; } // dev only (config refuses this in production)
    this.publicKey = pub;
    this.sender = c.PUSH_DRIVER === 'webpush' ? new WebPushSender({ publicKey: pub, privateKey: priv, subject: c.VAPID_SUBJECT, ...(c.PUSH_INSECURE_TLS ? { agent: new https.Agent({ rejectUnauthorized: false }) } : {}) }) : new DevSender(redis);
  }

  async subscribe(userId: ObjectId, sid: string, s: { endpoint: string; keys: { p256dh: string; auth: string } }, userAgent?: string) {
    const _id = subId(s.endpoint);
    // The same browser re-subscribing (or a new account in it) takes the subscription over.
    await this.subs.updateOne({ _id }, { $set: { userId, sid, endpoint: s.endpoint, keys: s.keys, userAgent: userAgent?.slice(0, 200) }, $setOnInsert: { createdAt: new Date() } }, { upsert: true });
  }
  async unsubscribe(userId: ObjectId, endpoint: string) { await this.subs.deleteOne({ _id: subId(endpoint), userId }); }
  /** A signed-out device stops getting notifications. */
  async forgetSession(sid: string) { await this.subs.deleteMany({ sid }); }

  async isMuted(conv: ObjectId, user: ObjectId) {
    const p = await this.prefs.findOne({ _id: prefKey(conv, user) }, { projection: { mutedUntil: 1 } });
    return !!p?.mutedUntil && p.mutedUntil.getTime() > Date.now();
  }

  /** True while any of this person's devices has the app open and in front. */
  async inFront(user: string) {
    const all = await this.redis.hgetall(`focus:${user}`);
    const now = Date.now();
    return Object.values(all).some((v) => { try { const f = JSON.parse(v) as { v: boolean; t: number }; return f.v && now - f.t < 120_000; } catch { return false; } });
  }

  /** Called for every new message. Runs in the background; failures are logged, never thrown at the sender. */
  /** `to`: who the message was delivered to (leaves out anyone who blocked the sender). */
  messageCreated(c: ConversationDoc, m: ChatMessage, to: ObjectId[] = c.members) {
    void this.notifyMessage(c, m, to).catch((e) => this.log.warn({ err: e }, 'push failed'));
  }

  private async notifyMessage(c: ConversationDoc, m: ChatMessage, to: ObjectId[]) {
    let targets = to.filter((u) => u.toHexString() !== m.senderId);
    if (m.type === 'system') {
      // Only "added you" is worth a notification.
      const e = m.system;
      if (e?.kind !== 'added') return;
      targets = targets.filter((u) => e.userIds.includes(u.toHexString()));
    }
    if (!targets.length) return;
    const subs = await this.subs.find({ userId: { $in: targets } }).toArray();
    if (!subs.length) return;
    const ids = [...new Set([m.senderId, ...(m.system?.kind === 'added' ? m.system.userIds : [])])].map((x) => new ObjectId(x));
    const names = new Map((await this.users.find({ _id: { $in: ids } }, { projection: { firstName: 1, lastName: 1, username: 1, email: 1, 'yc.displayName': 1 } }).toArray()).map((u) => [u._id.toHexString(), displayNameOf(u)]));
    const sender = names.get(m.senderId) ?? 'Someone';
    const settings = new Map((await this.users.find({ _id: { $in: [...new Set(subs.map((s) => s.userId.toHexString()))].map((x) => new ObjectId(x)) } }, { projection: { 'yc.notify': 1 } }).toArray()).map((u) => [u._id.toHexString(), notifyOf(u as UserDoc)]));
    const byUser = new Map<string, PushSubDoc[]>();
    for (const s of subs) byUser.set(s.userId.toHexString(), [...(byUser.get(s.userId.toHexString()) ?? []), s]);
    for (const [uid, list] of byUser) {
      if (await this.inFront(uid)) continue;
      // Being @mentioned gets through a muted group and "no group notifications".
      const mentioned = !!m.mentions?.includes(uid);
      if (!mentioned && await this.isMuted(c._id, new ObjectId(uid))) continue;
      const n = settings.get(uid);
      if (n && c.kind === 'group' && !n.groups && m.type !== 'system' && !mentioned) continue;
      if (n && inQuietHours(n)) continue;
      const name = (id: string) => (id === uid ? 'You' : names.get(id) ?? 'Someone');
      const preview = m.type === 'system' && m.system ? systemText(m.system, m.senderId, name) : messagePreview(m);
      const payload: PushPayload = {
        type: 'message', conversationId: m.conversationId, messageId: m.id, tag: `c:${m.conversationId}`, url: `/chats?c=${m.conversationId}`,
        title: c.kind === 'group' ? c.name ?? 'Group' : sender,
        body: n && !n.preview && m.type !== 'system' ? (c.kind === 'group' ? `${sender.split(' ')[0]} sent a message` : 'New message')
          : c.kind === 'group' && m.type !== 'system' ? `${sender.split(' ')[0]}: ${preview}` : preview,
      };
      await Promise.all(list.map((s) => this.deliver(s, payload)));
    }
  }

  /** After I read a chat on one device, clear its notification on the others. */
  read(userId: ObjectId, conversationId: string) {
    void (async () => {
      const subs = await this.subs.find({ userId }).toArray();
      await Promise.all(subs.map((s) => this.deliver(s, { type: 'read', conversationId, tag: `c:${conversationId}` })));
    })().catch((e) => this.log.warn({ err: e }, 'push read failed'));
  }

  /** Rings my devices that aren't looking (a looking device rings from the live connection). */
  async callRing(userId: ObjectId, payload: Extract<PushPayload, { type: 'call' }>) {
    const uid = userId.toHexString();
    if (await this.inFront(uid)) return;
    const u = await this.users.findOne({ _id: userId }, { projection: { 'yc.notify': 1 } });
    if (u && inQuietHours(notifyOf(u as UserDoc))) return;
    const subs = await this.subs.find({ userId }).toArray();
    await Promise.all(subs.map((s) => this.deliver(s, payload)));
  }
  /** The call stopped ringing: take its notification away. */
  callEnded(userIds: ObjectId[], callId: string) {
    if (!userIds.length) return;
    void (async () => {
      const subs = await this.subs.find({ userId: { $in: userIds } }).toArray();
      await Promise.all(subs.map((s) => this.deliver(s, { type: 'call_end', callId, tag: `call:${callId}` })));
    })().catch((e) => this.log.warn({ err: e }, 'push call end failed'));
  }

  private async deliver(s: PushSubDoc, payload: PushPayload) {
    try {
      const r = await this.sender.send(s, payload);
      if (r === 'gone') await this.subs.deleteOne({ _id: s._id });
      else await this.subs.updateOne({ _id: s._id }, { $set: { lastOkAt: new Date() } });
    } catch (e) { this.log.warn({ err: e, endpoint: s.endpoint.slice(0, 60) }, 'push delivery failed'); }
  }

  // ---- focus, reported by each live connection ----
  async setFocus(user: string, socketId: string, conversationId: string | null, visible: boolean) {
    await this.redis.hset(`focus:${user}`, socketId, JSON.stringify({ c: conversationId, v: visible, t: Date.now() }));
    await this.redis.pexpire(`focus:${user}`, 180_000);
  }
  async touchFocus(user: string, socketId: string) {
    const cur = await this.redis.hget(`focus:${user}`, socketId);
    if (cur) { const f = JSON.parse(cur) as { c: string | null; v: boolean }; await this.setFocus(user, socketId, f.c, f.v); }
  }
  async clearFocus(user: string, socketId: string) { await this.redis.hdel(`focus:${user}`, socketId); }
}
export const PUSH = Symbol('PUSH');

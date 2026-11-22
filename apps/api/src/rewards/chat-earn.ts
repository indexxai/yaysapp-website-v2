import { createHash } from 'crypto';
import { ObjectId, type Collection, type Db } from 'mongodb';
import { CHAT_EARN, type ChatDayState, type ChatEarnToday, type Perk, type PerkKind } from '@yays/shared';
import { C } from '../infra/mongo';
import type { ConversationDoc, MessageDoc } from '../chat/chat.service';
import { displayNameOf, type UserDoc } from '../users/users.repo';
import { dayKey, nextMidnight, shiftDay, startOf, weekKey } from './days';
import type { RewardsService } from './rewards.service';

/**
 * One thing that can make a chat count: a counting message I sent, or a call I was on for 2+ minutes.
 * Only metadata: who, which chat, when. The message text is never stored here.
 */
interface ChatEventDoc { _id: ObjectId; userId: ObjectId; convId: ObjectId; kind: 'msg' | 'call'; msgId?: ObjectId; day: string; at: Date }
/** Short-lived fingerprints of today's messages, only to spot copy-paste repeats. Removed after two days. */
interface RecentDoc { _id: string; userId: ObjectId; h: string[]; lastAt: Date; expiresAt: Date }
interface PerkDoc { _id: ObjectId; userId: ObjectId; key: string; kind: PerkKind; title: string; sub: string; product: Perk['product']; status: Perk['status']; code?: string; at: Date; expiresAt?: Date }
interface CallLike { _id: ObjectId; convId?: ObjectId; startedAt?: Date; endedAt?: Date; outcome?: string; parts: Array<{ userId: ObjectId; joinedAt?: Date; leftAt?: Date; everJoined?: boolean }> }

/** The chats that counted for someone on one day. */
export interface ChatDay { count: number; convs: Array<{ convId: ObjectId; kind: 'direct' | 'group'; partner?: ObjectId; createdAt: Date; directKey?: string }> }

const DAY_MS = 86400_000;
/** Faster than anyone types: more characters per second than this since their last message. */
const MAX_CHARS_PER_SEC = 25;
const SETTLE_GRACE_MS = 10 * 60_000;

/** Two or more real words (letters or numbers), so "ok" or "👍" alone doesn't count. */
export function wordCount(text: string) { return text.trim().split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length; }
const fingerprint = (text: string) => createHash('sha256').update(text.toLowerCase().replace(/\s+/g, ' ').trim()).digest('base64url').slice(0, 16);

/** Two upserts of the same new doc at once: one wins, the other gets a duplicate-key error; trying again updates it. */
async function upsertOnce<T>(run: () => Promise<T>): Promise<T> {
  try { return await run(); } catch (e) { if ((e as { code?: number }).code === 11000) return run(); throw e; }
}

export class ChatEarn {
  readonly events: Collection<ChatEventDoc>;
  readonly recent: Collection<RecentDoc>;
  readonly perks: Collection<PerkDoc>;
  private readonly convs: Collection<ConversationDoc>;
  private readonly users: Collection<UserDoc>;
  private timer?: NodeJS.Timeout;
  /** Gives extra Jack's AI messages for today (wired to the AI service). */
  grantAiMessages: (userId: ObjectId, day: string, n: number) => Promise<void> = async () => undefined;
  /** Skip messages typed faster than a person can. Off in tests, which send messages back to back. */
  typingCheck = true;

  constructor(private readonly db: Db, private readonly rewards: RewardsService) {
    this.events = db.collection(C.chatEvents);
    this.recent = db.collection(C.chatRecent);
    this.perks = db.collection(C.perks);
    this.convs = db.collection(C.conversations);
    this.users = db.collection(C.users);
  }

  /* ------------------------------------------------------------ what counts */

  /**
   * Decides, as a message is sent, whether it can count: 2+ words, a photo or a voice note; not forwarded, not a
   * repeat of something sent today, not typed faster than a person can. Only the yes/no is kept.
   */
  private async qualifies(me: ObjectId, day: string, m: MessageDoc): Promise<boolean> {
    if (m.forwarded || m.type === 'system' || m.type === 'poll') return false;
    const media = m.type === 'media' && (m.attachment?.kind === 'image' || m.attachment?.kind === 'voice');
    if (m.type === 'media' && !media) return false;
    if (m.type === 'text' && wordCount(m.text) < 2) return false;
    const id = `${me.toHexString()}:${day}`;
    const prev = await this.recent.findOne({ _id: id });
    if (m.type === 'text' && this.typingCheck) {
      const secs = prev ? (m.createdAt.getTime() - prev.lastAt.getTime()) / 1000 : Infinity;
      if (secs < 0.8 || m.text.length / Math.max(secs, 0.001) > MAX_CHARS_PER_SEC) {
        await this.recent.updateOne({ _id: id }, { $set: { lastAt: m.createdAt } });
        return false;
      }
    }
    if (m.type === 'text') {
      const h = fingerprint(m.text);
      if (prev?.h.includes(h)) { await this.recent.updateOne({ _id: id }, { $set: { lastAt: m.createdAt } }); return false; }
      await upsertOnce(() => this.recent.updateOne({ _id: id }, { $push: { h: { $each: [h], $slice: -200 } }, $set: { lastAt: m.createdAt }, $setOnInsert: { userId: me, expiresAt: new Date(Date.now() + 2 * DAY_MS) } }, { upsert: true }));
      return true;
    }
    await upsertOnce(() => this.recent.updateOne({ _id: id }, { $set: { lastAt: m.createdAt }, $setOnInsert: { userId: me, h: [], expiresAt: new Date(Date.now() + 2 * DAY_MS) } }, { upsert: true }));
    return true;
  }

  /** Called after every message someone sends in a chat or group (not in community chats). */
  async onMessage(me: ObjectId, conv: ConversationDoc, m: MessageDoc) {
    if ((conv as { communityId?: unknown }).communityId) return;
    const tz = await this.rewards.tz(me), day = dayKey(m.createdAt, tz);
    if (!(await this.qualifies(me, day, m))) return;
    await this.events.insertOne({ _id: new ObjectId(), userId: me, convId: conv._id, kind: 'msg', msgId: m._id, day, at: m.createdAt });
    // My message can complete my chat, and also count as the reply that completes theirs.
    const others = await this.events.distinct('userId', { convId: conv._id, userId: { $ne: me }, at: { $gte: new Date(Date.now() - DAY_MS - 2 * 3600_000) } });
    await this.refresh(me);
    for (const u of others) await this.refresh(u);
  }

  /** A message deleted for everyone stops counting. Anything already paid for today is checked again at settling. */
  async onDeleted(m: MessageDoc) {
    const gone = await this.events.findOneAndDelete({ msgId: m._id });
    if (gone) await this.refresh(gone.userId);
  }

  /** A finished call: everyone on it for 2+ minutes gets that chat counted. */
  async onCall(call: CallLike) {
    if (!call.convId || call.outcome !== 'completed' || !call.startedAt) return;
    const end = call.endedAt ?? new Date();
    for (const p of call.parts) {
      if (!p.everJoined || !p.joinedAt) continue;
      const from = p.joinedAt > call.startedAt ? p.joinedAt : call.startedAt;
      const secs = ((p.leftAt && p.leftAt < end ? p.leftAt : end).getTime() - from.getTime()) / 1000;
      if (secs < CHAT_EARN.minCallSec) continue;
      const tz = await this.rewards.tz(p.userId);
      await this.events.insertOne({ _id: new ObjectId(), userId: p.userId, convId: call.convId, kind: 'call', day: dayKey(end, tz), at: end });
      await this.refresh(p.userId);
    }
  }

  /* ------------------------------------------------------------ counting */

  /** The chats that counted for `me` on `day` (in their time zone). */
  async countDay(me: ObjectId, day: string, tz: string): Promise<ChatDay> {
    const from = startOf(day, tz), to = startOf(shiftDay(day, 1), tz);
    const mine = await this.events.find({ userId: me, at: { $gte: from, $lt: to } }).toArray();
    const byConv = new Map<string, { msgs: number; call: boolean; convId: ObjectId }>();
    for (const e of mine) {
      const k = e.convId.toHexString(), v = byConv.get(k) ?? { msgs: 0, call: false, convId: e.convId };
      if (e.kind === 'msg') v.msgs++; else v.call = true;
      byConv.set(k, v);
    }
    const cands = [...byConv.values()].filter((v) => v.call || v.msgs >= CHAT_EARN.minMessages);
    if (!cands.length) return { count: 0, convs: [] };
    const convDocs = await this.convs.find({ _id: { $in: cands.map((c) => c.convId) } }, { projection: { kind: 1, members: 1, createdAt: 1, directKey: 1, communityId: 1 } }).toArray();
    const convById = new Map(convDocs.map((c) => [c._id.toHexString(), c]));
    // Who replied with counting messages in those chats the same day.
    const msgConvs = cands.filter((c) => !c.call).map((c) => c.convId);
    const replies = msgConvs.length ? await this.events.aggregate<{ _id: ObjectId; users: ObjectId[] }>([
      { $match: { convId: { $in: msgConvs }, userId: { $ne: me }, kind: 'msg', at: { $gte: from, $lt: to } } },
      { $group: { _id: '$convId', users: { $addToSet: '$userId' } } },
    ]).toArray() : [];
    const replierIds = [...new Set(replies.flatMap((r) => r.users.map((u) => u.toHexString())))].map((s) => new ObjectId(s));
    const ok = await this.eligible(replierIds, from);
    const repliedBy = new Map(replies.map((r) => [r._id.toHexString(), r.users.filter((u) => ok.has(u.toHexString())).length]));
    const out: ChatDay['convs'] = [];
    for (const c of cands) {
      const doc = convById.get(c.convId.toHexString());
      if (!doc || (doc as { communityId?: unknown }).communityId) continue;
      const need = doc.kind === 'direct' ? 1 : 2;
      if (!c.call && (repliedBy.get(c.convId.toHexString()) ?? 0) < need) continue;
      const partner = doc.kind === 'direct' ? doc.members.find((x) => !x.equals(me)) : undefined;
      out.push({ convId: doc._id, kind: doc.kind, ...(partner ? { partner } : {}), createdAt: doc.createdAt, ...(doc.directKey ? { directKey: doc.directKey } : {}) });
    }
    return { count: out.length, convs: out };
  }

  /** People whose replies count: a verified phone number, an account at least 3 days old, not deleted or disabled. */
  private async eligible(ids: ObjectId[], dayStart: Date) {
    if (!ids.length) return new Set<string>();
    const rows = await this.users.find({ _id: { $in: ids } }, { projection: { 'yc.phoneVerifiedAt': 1, 'yc.joinedAt': 1, 'yc.deletedAt': 1, 'yc.disabledAt': 1 } }).toArray();
    const oldEnough = dayStart.getTime() - CHAT_EARN.replierMinAgeDays * DAY_MS;
    return new Set(rows.filter((u) => u.yc?.phoneVerifiedAt && !u.yc?.deletedAt && !u.yc?.disabledAt && (u.yc?.joinedAt ?? u._id.getTimestamp()).getTime() <= oldEnough).map((u) => u._id.toHexString()));
  }

  /* ------------------------------------------------------------ paying */

  /** Recounts today and pays (as pending) any tier or new connection reached. */
  async refresh(me: ObjectId) {
    const tz = await this.rewards.tz(me), now = new Date(), day = dayKey(now, tz);
    const d = await this.countDay(me, day, tz);
    await this.rewards.setConversations(me, day, d.count);
    const settleAt = new Date(nextMidnight(now, tz).getTime() + SETTLE_GRACE_MS);
    for (const [i, t] of CHAT_EARN.tiers.entries()) {
      if (d.count < t.of) continue;
      if (t.points) await this.rewards.award(me, tz, { key: `chat:t${i + 1}:${day}`, kind: 'chat', title: `Chat to Earn · ${t.label}`, sub: `${t.of} conversations · settles at midnight`, amount: t.points, status: 'pending', capped: true, settleAt });
      if (t.aiMessages) {
        const paid = await this.rewards.award(me, tz, { key: `chat:t${i + 1}:${day}`, kind: 'perk', title: `+${t.aiMessages} Jack’s AI messages`, sub: `Chat to Earn · ${t.label} · today`, amount: 0 });
        if (paid) await this.grantAiMessages(me, day, t.aiMessages);
      }
    }
    await this.newConnections(me, tz, day, d, settleAt);
  }

  /** First chat with someone new: once you've both replied on 2 different days, 5 BTCY each (up to 3 a day). */
  private async newConnections(me: ObjectId, tz: string, day: string, d: ChatDay, settleAt: Date) {
    const windowStart = Date.now() - CHAT_EARN.newConnectionWindowDays * DAY_MS;
    for (const c of d.convs) {
      if (c.kind !== 'direct' || !c.partner || !c.directKey || c.createdAt.getTime() < windowStart) continue;
      const key = `conn:${c.directKey}`;
      if (await this.rewards.ledger.findOne({ userId: me, key }, { projection: { _id: 1 } })) continue;
      const days = await this.events.aggregate<{ _id: ObjectId; days: string[] }>([
        { $match: { convId: c.convId, kind: 'msg' } }, { $group: { _id: '$userId', days: { $addToSet: '$day' } } },
      ]).toArray();
      const daysOf = (u: ObjectId) => days.find((x) => x._id.equals(u))?.days.length ?? 0;
      if (daysOf(me) < 2 || daysOf(c.partner) < 2) continue;
      const [partner, self] = await Promise.all([this.users.findOne({ _id: c.partner }), this.users.findOne({ _id: me })]);
      const first = (u: UserDoc | null) => (u ? displayNameOf(u).split(/\s+/)[0] : '') || 'someone new';
      const name = first(partner);
      for (const [who, other] of [[me, name], [c.partner, null]] as const) {
        const whoTz = who.equals(me) ? tz : await this.rewards.tz(who), whoDay = dayKey(new Date(), whoTz);
        const today = await this.rewards.ledger.countDocuments({ userId: who, day: whoDay, key: { $regex: '^conn:' } });
        if (today >= CHAT_EARN.newConnectionsPerDay) continue;
        const label = other ?? first(self);
        await this.rewards.award(who, whoTz, { key, kind: 'chat', title: `New connection: ${label}`, sub: 'You both replied on 2 different days · settles at midnight', amount: CHAT_EARN.newConnectionPoints, status: 'pending', capped: true, settleAt: who.equals(me) ? settleAt : new Date(nextMidnight(new Date(), whoTz).getTime() + SETTLE_GRACE_MS) });
      }
    }
  }

  /* ------------------------------------------------------------ settling */

  /** Starts the settling job: every few minutes, finished days are checked again and paid or reversed. */
  start(everyMs = 5 * 60_000) { this.timer = setInterval(() => { void this.settleDue().catch(() => undefined); }, everyMs); this.timer.unref?.(); }
  stop() { if (this.timer) clearInterval(this.timer); }

  /** Pending chat rewards whose day is over: still true → paid; no longer true (messages deleted) → reversed. */
  async settleDue(now = new Date()) {
    const due = await this.rewards.ledger.find({ status: 'pending', settleAt: { $lte: now } }).limit(500).toArray();
    const seen = new Map<string, ChatDay>();
    for (const e of due) {
      const tz = await this.rewards.tz(e.userId), k = `${e.userId.toHexString()}:${e.day}`;
      let keep = true;
      const tier = /^chat:t(\d):/.exec(e.key);
      if (tier) {
        const d = seen.get(k) ?? await this.countDay(e.userId, e.day, tz);
        seen.set(k, d);
        keep = d.count >= CHAT_EARN.tiers[Number(tier[1]) - 1]!.of;
      }
      await this.rewards.resolve(e.userId, e.key, keep);
      if (keep && tier?.[1] === '1') await this.chatWeek(e.userId, tz, e.week);
    }
    return due.length;
  }

  /** Tier 1 on 5 days of a week: 50 BTCY and a Turbo mining day. 4 chat weeks in a row: a badge and a coupon. */
  private async chatWeek(me: ObjectId, tz: string, week: string) {
    const met = await this.rewards.ledger.countDocuments({ userId: me, week, status: 'done', key: { $regex: '^chat:t1:' } });
    if (met < CHAT_EARN.weekDays) return;
    const paid = await this.rewards.award(me, tz, { key: `chatweek:${week}`, kind: 'chat', title: 'Chat week complete', sub: `Tier 1 on ${CHAT_EARN.weekDays} of 7 days · plus 1 Turbo mining day`, amount: CHAT_EARN.weekPoints, capped: true });
    if (!paid) return;
    await this.givePerk(me, `turbo:${week}`, { kind: 'turbo_day', title: 'Turbo mining day', sub: 'From Chat week', product: 'btcy', days: 7 });
    // The month: this week and the 3 before it, and no month reward inside that run already.
    const weeks = Array.from({ length: CHAT_EARN.monthWeeks }, (_, i) => shiftDay(week, -7 * i));
    const run = await this.rewards.ledger.countDocuments({ userId: me, key: { $in: weeks.map((w) => `chatweek:${w}`) } });
    if (run < CHAT_EARN.monthWeeks) return;
    if (await this.rewards.ledger.findOne({ userId: me, key: { $in: weeks.slice(1).map((w) => `chatmonth:${w}`) } }, { projection: { _id: 1 } })) return;
    const month = await this.rewards.award(me, tz, { key: `chatmonth:${week}`, kind: 'perk', title: 'Chat month: Chat Champion', sub: `${CHAT_EARN.monthWeeks} chat weeks in a row · badge + a coupon`, amount: 0 });
    if (!month) return;
    await this.users.updateOne({ _id: me }, { $addToSet: { 'yc.badges': 'chat_champion' } } as Record<string, unknown>);
    await this.givePerk(me, `coupon:${week}`, { kind: 'coupon_choice', title: 'Pick your coupon', sub: 'From Chat month · ShoperPal or ReHuman', product: 'shoperpal', days: 30 });
  }

  private async givePerk(me: ObjectId, key: string, p: { kind: PerkKind; title: string; sub: string; product: Perk['product']; days: number }) {
    const at = new Date();
    await this.perks.updateOne({ userId: me, key }, { $setOnInsert: { _id: new ObjectId(), userId: me, key, kind: p.kind, title: p.title, sub: p.sub, product: p.product, status: 'ready', at, expiresAt: new Date(at.getTime() + p.days * DAY_MS) } }, { upsert: true });
  }

  /* ------------------------------------------------------------ reading */

  async today(me: ObjectId, tz: string): Promise<ChatEarnToday> {
    const now = new Date(), day = dayKey(now, tz), week = weekKey(now, tz);
    const [d, t1, conns, streak] = await Promise.all([
      this.countDay(me, day, tz),
      this.rewards.ledger.find({ userId: me, week, key: { $regex: '^chat:t1:' }, status: { $ne: 'reversed' } }, { projection: { day: 1 } }).toArray(),
      this.rewards.ledger.countDocuments({ userId: me, day, key: { $regex: '^conn:' } }),
      this.weekStreak(me, week),
    ]);
    const metDays = new Set(t1.map((e) => e.day));
    const days: ChatDayState[] = Array.from({ length: 7 }, (_, i) => {
      const k = shiftDay(week, i);
      return metDays.has(k) ? 'met' : k === day ? 'today' : k < day ? 'missed' : 'upcoming';
    });
    return {
      conversations: d.count,
      tiers: CHAT_EARN.tiers.map((t) => ({ of: t.of, label: t.label, reward: t.points ? `${t.points} BTCY` : `+${t.aiMessages} Jack’s AI messages`, reached: d.count >= t.of })),
      newConnections: conns, newConnectionsMax: CHAT_EARN.newConnectionsPerDay,
      week: { daysMet: metDays.size, of: CHAT_EARN.weekDays, days },
      month: { weeks: streak, of: CHAT_EARN.monthWeeks },
      settlesAt: nextMidnight(now, tz).toISOString(),
    };
  }

  /** Chat weeks in a row, ending with last week (this week counts once it's earned). */
  private async weekStreak(me: ObjectId, week: string) {
    const recent = new Set((await this.rewards.ledger.find({ userId: me, key: { $regex: '^chatweek:' } }, { projection: { key: 1 } }).sort({ _id: -1 }).limit(8).toArray()).map((e) => e.key.slice(9)));
    let n = 0, w = recent.has(week) ? week : shiftDay(week, -7);
    while (recent.has(w) && n < CHAT_EARN.monthWeeks) { n++; w = shiftDay(w, -7); }
    return n;
  }

  async listPerks(me: ObjectId): Promise<Perk[]> {
    const now = new Date();
    const rows = await this.perks.find({ userId: me }).sort({ at: -1 }).limit(50).toArray();
    return rows.map((p) => ({
      id: p._id.toHexString(), kind: p.kind, title: p.title, product: p.product, code: p.code ?? null,
      status: p.status === 'ready' && p.expiresAt && p.expiresAt < now ? 'expired' : p.status,
      sub: p.expiresAt ? `${p.sub} · use by ${p.expiresAt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}` : p.sub,
      expiresAt: p.expiresAt?.toISOString() ?? null,
    }));
  }
}

import { randomInt } from 'crypto';
import { ObjectId, type ClientSession, type Collection, type Db, type MongoClient } from 'mongodb';
import {
  CHECKIN_POINTS, DAILY_POINTS_CAP, REFERRAL_POINTS,
  type BonusCampaign, type BonusId, type CheckinStatus, type EarnTask, type EarnToday, type PointsEntry, type PointsHistoryPage, type PointsStatus, type PointsSummary, type PopupNow, type ReferralSummary,
} from '@yays/shared';
import { AppError } from '../common/app-error';
import { isDup } from '../chat/chat.service';
import { C } from '../infra/mongo';
import { displayNameOf, type UserDoc } from '../users/users.repo';
import type { IndexxService } from '../indexx/indexx.service';
import { cleanTz, dayKey, endOfWeek, nextMidnight, shiftDay, startOf, weekKey } from './days';

interface Balance { _id: ObjectId; balance: number; pending: number }
export interface LedgerDoc {
  _id: ObjectId; userId: ObjectId; key: string; kind: PointsEntry['kind']; title: string; sub: string; amount: number; status: PointsStatus;
  at: Date; day: string; week: string; capped?: boolean;
}
interface ActivityDoc { _id: string; userId: ObjectId; day: string; messages?: number; posts?: number; aiQuestions?: number; aiSummaries?: number }
interface CheckinDoc { _id: string; userId: ObjectId; day: string; dayOfWeek: number; streak: number; points: number; at: Date }
interface ReferralDoc { _id: ObjectId /* invitee */; inviterId: ObjectId; code: string; status: 'pending' | 'rewarded' | 'not_eligible'; at: Date; rewardedAt?: Date }
interface PopupDoc { _id: string; userId: ObjectId; day: string; seen: string[] }

type Counter = 'messages' | 'posts' | 'aiQuestions' | 'aiSummaries';
const EARN: Array<{ id: EarnTask['id']; title: string; icon: string; counter: Counter; of: number; points: number }> = [
  { id: 'messages', title: 'Send 10 messages', icon: 'chats', counter: 'messages', of: 10, points: 10 },
  { id: 'post', title: 'Post in a circle', icon: 'people', counter: 'posts', of: 1, points: 15 },
  { id: 'ask_jack', title: 'Ask Jack’s AI a question', icon: 'sparkles', counter: 'aiQuestions', of: 1, points: 5 },
];
const JACK_TASKS: Array<{ id: string; title: string; icon: string; counter: Counter; of: number; points: number }> = [
  { id: 'ask', title: 'Ask Jack’s AI 3 questions', icon: 'sparkles', counter: 'aiQuestions', of: 3, points: 15 },
  { id: 'summary', title: 'Summarise a chat with Jack', icon: 'document', counter: 'aiSummaries', of: 1, points: 15 },
  { id: 'messages', title: 'Send 10 messages today', icon: 'chats', counter: 'messages', of: 10, points: 20 },
];
const BTCY_TASKS = [
  { id: 'invites', title: 'Invite 10 friends to BTCY', icon: 'people', of: 10, points: 40 },
  { id: 'mining', title: 'Mine BTCY 7 days in a row', icon: 'flash', of: 7, points: 30 },
  { id: 'alchemy', title: 'Convert nuggets to tokens with Alchemy', icon: 'swap', of: 1, points: 30 },
] as const;

/** INEX (stored as points): what people earn in YaysApp, kept as a ledger. Every award has a key, so nothing is paid twice. */
export class RewardsService {
  readonly ledger: Collection<LedgerDoc>;
  readonly balances: Collection<Balance>;
  readonly activity: Collection<ActivityDoc>;
  readonly checkins: Collection<CheckinDoc>;
  readonly referrals: Collection<ReferralDoc>;
  readonly popups: Collection<PopupDoc>;
  readonly users: Collection<UserDoc>;
  indexx?: IndexxService;

  constructor(private readonly client: MongoClient, private readonly db: Db) {
    this.ledger = db.collection(C.pointsLedger);
    this.balances = db.collection(C.points);
    this.activity = db.collection(C.activity);
    this.checkins = db.collection(C.checkins);
    this.referrals = db.collection(C.referrals);
    this.popups = db.collection(C.popups);
    this.users = db.collection(C.users);
  }

  private async tx<T>(fn: (s: ClientSession) => Promise<T>): Promise<T> {
    const session = this.client.startSession();
    try { let out!: T; await session.withTransaction(async () => { out = await fn(session); }); return out; }
    finally { await session.endSession(); }
  }

  /** The person's own time zone (the app sends it); remembered so background awards use the same days. */
  async tz(me: ObjectId, sent?: string | null): Promise<string> {
    const u = await this.users.findOne({ _id: me }, { projection: { 'yc.tz': 1 } });
    const known = (u?.yc as { tz?: string } | undefined)?.tz;
    if (sent && sent !== known) { await this.users.updateOne({ _id: me }, { $set: { 'yc.tz': sent } }); return sent; }
    return cleanTz(known ?? 'UTC');
  }

  /* ------------------------------------------------------------ ledger */

  /**
   * Adds or takes points once per key. Capped awards (everyday activity) stop at the daily cap.
   * Returns the entry, or null when the key was already used (or the cap left nothing).
   */
  async award(me: ObjectId, tz: string, v: { key: string; kind: LedgerDoc['kind']; title: string; sub: string; amount: number; status?: PointsStatus; capped?: boolean }): Promise<LedgerDoc | null> {
    const now = new Date(), day = dayKey(now, tz);
    try {
      return await this.tx(async (s) => {
        let amount = v.amount;
        if (v.capped) {
          const used = await this.capUsed(me, day, s);
          amount = Math.min(amount, DAILY_POINTS_CAP - used);
          if (amount <= 0) return null;
        }
        if (amount < 0) {
          const ok = await this.balances.updateOne({ _id: me, balance: { $gte: -amount } }, { $inc: { balance: amount } }, { session: s });
          if (!ok.modifiedCount) {
            const b = await this.balances.findOne({ _id: me }, { session: s });
            throw AppError.validation(`You have ${(b?.balance ?? 0).toLocaleString('en-US')} INEX. That isn’t enough.`);
          }
        }
        const doc: LedgerDoc = { _id: new ObjectId(), userId: me, key: v.key, kind: v.kind, title: v.title, sub: v.sub, amount, status: v.status ?? 'done', at: now, day, week: weekKey(now, tz), ...(v.capped ? { capped: true } : {}) };
        await this.ledger.insertOne(doc, { session: s });
        if (amount > 0) await this.balances.updateOne({ _id: me }, { $inc: doc.status === 'pending' ? { pending: amount, balance: 0 } : { balance: amount, pending: 0 } }, { upsert: true, session: s });
        return doc;
      });
    } catch (e) {
      if (isDup(e)) return null;
      throw e;
    }
  }

  /** A pending award becomes real (a friend verified). */
  private async settle(userId: ObjectId, key: string) {
    await this.tx(async (s) => {
      const e = await this.ledger.findOneAndUpdate({ userId, key, status: 'pending' }, { $set: { status: 'done', at: new Date() } }, { session: s });
      if (e) await this.balances.updateOne({ _id: userId }, { $inc: { pending: -e.amount, balance: e.amount } }, { session: s });
    });
  }

  private async capUsed(me: ObjectId, day: string, session?: ClientSession) {
    const r = await this.ledger.aggregate<{ n: number }>([{ $match: { userId: me, day, capped: true } }, { $group: { _id: null, n: { $sum: '$amount' } } }], { session }).toArray();
    return r[0]?.n ?? 0;
  }

  async balance(me: ObjectId) { return (await this.balances.findOne({ _id: me }))?.balance ?? 0; }

  async summary(me: ObjectId, tzSent: string | null): Promise<PointsSummary> {
    const tz = await this.tz(me, tzSent), now = new Date(), day = dayKey(now, tz), week = weekKey(now, tz);
    const [b, sums, capUsed] = await Promise.all([
      this.balances.findOne({ _id: me }),
      this.ledger.aggregate<{ _id: string; n: number }>([
        { $match: { userId: me, week, status: 'done', amount: { $gt: 0 } } },
        { $group: { _id: { $cond: [{ $eq: ['$day', day] }, 'today', 'week'] }, n: { $sum: '$amount' } } },
      ]).toArray(),
      this.capUsed(me, day),
    ]);
    const today = sums.find((x) => x._id === 'today')?.n ?? 0, rest = sums.find((x) => x._id === 'week')?.n ?? 0;
    return { balance: b?.balance ?? 0, pending: b?.pending ?? 0, earnedToday: today, earnedThisWeek: today + rest, capUsed, cap: DAILY_POINTS_CAP };
  }

  async history(me: ObjectId, filter: 'all' | 'earned' | 'spent' | 'pending', before?: string): Promise<PointsHistoryPage> {
    const q: Record<string, unknown> = { userId: me };
    if (filter === 'earned') Object.assign(q, { amount: { $gt: 0 }, status: 'done' });
    if (filter === 'spent') Object.assign(q, { amount: { $lt: 0 } });
    if (filter === 'pending') Object.assign(q, { status: 'pending' });
    if (before && ObjectId.isValid(before)) q._id = { $lt: new ObjectId(before) };
    const rows = await this.ledger.find(q).sort({ _id: -1 }).limit(41).toArray();
    const items = rows.slice(0, 40).map((e): PointsEntry => ({ id: e._id.toHexString(), kind: e.kind, title: e.title, sub: e.sub, amount: e.amount, status: e.status, at: e.at.toISOString() }));
    return { items, next: rows.length > 40 ? rows[39]!._id.toHexString() : null };
  }

  /* ------------------------------------------------------------ check-in */

  async checkinStatus(me: ObjectId, tzSent: string | null): Promise<CheckinStatus> {
    const tz = await this.tz(me, tzSent), today = dayKey(new Date(), tz);
    const [mine, last, balance] = await Promise.all([
      this.checkins.findOne({ _id: `${me.toHexString()}:${today}` }),
      this.checkins.findOne({ _id: `${me.toHexString()}:${shiftDay(today, -1)}` }),
      this.balance(me),
    ]);
    // Where today sits: after a claim, today's own slot; before, the slot after yesterday's (or day 1).
    const dayOfWeek = mine ? mine.dayOfWeek : last ? (last.dayOfWeek % 7) + 1 : 1;
    const streak = mine ? mine.streak : last ? last.streak : 0;
    const days = CHECKIN_POINTS.map((points, i) => {
      const d = i + 1;
      const state = d < dayOfWeek ? 'done' : d === dayOfWeek ? (mine ? 'claimed' : 'today') : 'upcoming';
      return { day: d, points, state } as CheckinStatus['days'][number];
    });
    return { streak, claimedToday: !!mine, dayOfWeek, todayPoints: CHECKIN_POINTS[dayOfWeek - 1]!, tomorrowPoints: CHECKIN_POINTS[dayOfWeek % 7]!, days, balance };
  }

  async claimCheckin(me: ObjectId, tzSent: string | null): Promise<CheckinStatus> {
    const tz = await this.tz(me, tzSent), today = dayKey(new Date(), tz);
    const last = await this.checkins.findOne({ _id: `${me.toHexString()}:${shiftDay(today, -1)}` });
    const dayOfWeek = last ? (last.dayOfWeek % 7) + 1 : 1, streak = last ? last.streak + 1 : 1;
    const points = CHECKIN_POINTS[dayOfWeek - 1]!;
    try { await this.checkins.insertOne({ _id: `${me.toHexString()}:${today}`, userId: me, day: today, dayOfWeek, streak, points, at: new Date() }); }
    catch (e) { if (isDup(e)) throw AppError.conflict('You already checked in today. Come back tomorrow.'); throw e; }
    await this.award(me, tz, { key: `checkin:${today}`, kind: 'checkin', title: 'Daily check-in', sub: `Day ${streak} streak`, amount: points, capped: true });
    return this.checkinStatus(me, tz);
  }

  /* ------------------------------------------------------------ everyday activity */

  private async counts(me: ObjectId, day: string): Promise<ActivityDoc> {
    return (await this.activity.findOne({ _id: `${me.toHexString()}:${day}` })) ?? { _id: '', userId: me, day };
  }

  private async bump(me: ObjectId, tz: string, counter: Counter) {
    const day = dayKey(new Date(), tz);
    const r = await this.activity.findOneAndUpdate({ _id: `${me.toHexString()}:${day}` }, { $inc: { [counter]: 1 }, $setOnInsert: { userId: me, day } }, { upsert: true, returnDocument: 'after' });
    return r!;
  }

  /** After something counted: pay any everyday task and the Jack's AI bonus that it finished. */
  private async payTasks(me: ObjectId, tz: string, a: ActivityDoc) {
    for (const t of EARN) if ((a[t.counter] ?? 0) >= t.of) await this.award(me, tz, { key: `task:${t.id}:${a.day}`, kind: 'activity', title: t.title, sub: 'Daily activity', amount: t.points, capped: true });
    if (JACK_TASKS.every((t) => (a[t.counter] ?? 0) >= t.of)) await this.award(me, tz, { key: `bonus:jack-daily:${a.day}`, kind: 'bonus', title: 'Jack’s AI bonus', sub: 'All 3 tasks done', amount: JACK_TASKS.reduce((n, t) => n + t.points, 0) });
  }

  /** Called for every message someone sends (not system lines). */
  async onMessage(me: ObjectId, inCommunity: boolean) {
    const tz = await this.tz(me);
    await this.bump(me, tz, 'messages');
    const a = inCommunity ? await this.bump(me, tz, 'posts') : await this.counts(me, dayKey(new Date(), tz));
    await this.payTasks(me, tz, a);
    await this.qualifyReferral(me);
  }
  /** A post that went live in a circle's feed counts toward "Post in a circle". */
  async onCirclePost(me: ObjectId) { const tz = await this.tz(me); await this.payTasks(me, tz, await this.bump(me, tz, 'posts')); }
  async onAiQuestion(me: ObjectId) { const tz = await this.tz(me); await this.payTasks(me, tz, await this.bump(me, tz, 'aiQuestions')); }
  async onAiSummary(me: ObjectId) { const tz = await this.tz(me); await this.payTasks(me, tz, await this.bump(me, tz, 'aiSummaries')); }

  async today(me: ObjectId, tzSent: string | null): Promise<EarnToday> {
    const tz = await this.tz(me, tzSent), day = dayKey(new Date(), tz);
    const [a, capUsed] = await Promise.all([this.counts(me, day), this.capUsed(me, day)]);
    return {
      tasks: EARN.map((t) => { const done = Math.min(a[t.counter] ?? 0, t.of); return { id: t.id, title: t.title, icon: t.icon, done, of: t.of, points: t.points, completed: done >= t.of }; }),
      capUsed, cap: DAILY_POINTS_CAP,
    };
  }

  /* ------------------------------------------------------------ referrals */

  /** My invite code, made the first time I ask: my name and three random characters (SARA-7K2). */
  async code(me: ObjectId): Promise<string> {
    const u = await this.users.findOne({ _id: me });
    if (!u) throw AppError.notFound();
    const have = (u.yc as { refCode?: string } | undefined)?.refCode;
    if (have) return have;
    const base = (displayNameOf(u).split(/\s+/)[0] ?? '').normalize('NFKD').replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 8) || 'YAYS';
    const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    for (let i = 0; i < 8; i++) {
      const code = `${base.length >= 2 ? base : base + 'Y'}-${Array.from({ length: 3 }, () => abc[randomInt(abc.length)]).join('')}`;
      try {
        const r = await this.users.updateOne({ _id: me, 'yc.refCode': { $exists: false } }, { $set: { 'yc.refCode': code } });
        if (r.modifiedCount) return code;
        return ((await this.users.findOne({ _id: me }))!.yc as { refCode: string }).refCode;
      } catch (e) { if (!isDup(e)) throw e; }
    }
    throw new Error('could not make a referral code');
  }

  /** A new person says who invited them. Accounts older than a week (or from the old app) don't count. */
  async useCode(me: ObjectId, raw: string) {
    const code = raw.trim().toUpperCase();
    const inviter = await this.users.findOne({ 'yc.refCode': code } as Record<string, unknown>);
    if (!inviter) throw AppError.notFound('That invite code wasn’t found. Check it with your friend.');
    if (inviter._id.equals(me)) throw AppError.validation('That’s your own code. Share it with friends instead.');
    const u = await this.users.findOne({ _id: me });
    if (!u) throw AppError.notFound();
    const joined = u.yc?.joinedAt ?? u._id.getTimestamp();
    const eligible = !u.yc?.legacy && Date.now() - joined.getTime() < 7 * 86400_000;
    try { await this.referrals.insertOne({ _id: me, inviterId: inviter._id, code, status: eligible ? 'pending' : 'not_eligible', at: new Date() }); }
    catch (e) { if (isDup(e)) throw AppError.conflict('You already used an invite code.'); throw e; }
    if (eligible) {
      await this.award(inviter._id, await this.tz(inviter._id), { key: `ref:${me.toHexString()}`, kind: 'referral', title: `Invited ${displayNameOf(u).split(/\s+/)[0]}`, sub: 'Pending · waiting for them to verify and say hi', amount: REFERRAL_POINTS, status: 'pending' });
      await this.qualifyReferral(me);
    }
    return { ok: true as const, inviter: displayNameOf(inviter) };
  }

  /** The invited friend counts once they verified a phone number and sent a first message. */
  async qualifyReferral(invitee: ObjectId) {
    const r = await this.referrals.findOne({ _id: invitee, status: 'pending' });
    if (!r) return;
    const u = await this.users.findOne({ _id: invitee }, { projection: { 'yc.phoneVerifiedAt': 1, 'yc.displayName': 1, firstName: 1 } });
    if (!u?.yc?.phoneVerifiedAt) return;
    const sent = await this.db.collection(C.messages).findOne({ senderId: invitee, type: { $ne: 'system' } }, { projection: { _id: 1 } });
    if (!sent) return;
    const done = await this.referrals.updateOne({ _id: invitee, status: 'pending' }, { $set: { status: 'rewarded', rewardedAt: new Date() } });
    if (!done.modifiedCount) return;
    await this.ledger.updateOne({ userId: r.inviterId, key: `ref:${invitee.toHexString()}` }, { $set: { sub: 'Joined, verified and said hi' } });
    await this.settle(r.inviterId, `ref:${invitee.toHexString()}`);
  }

  async referralSummary(me: ObjectId): Promise<ReferralSummary> {
    const code = await this.code(me);
    const rows = await this.referrals.find({ inviterId: me }).sort({ at: -1 }).limit(100).toArray();
    const people = await this.users.find({ _id: { $in: rows.map((r) => r._id) } }).toArray();
    const byId = new Map(people.map((p) => [p._id.toHexString(), p]));
    const fmt = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    return {
      code,
      invited: rows.length,
      joined: rows.filter((r) => r.status === 'rewarded').length,
      pending: rows.filter((r) => r.status === 'pending').length,
      pointsEarned: rows.filter((r) => r.status === 'rewarded').length * REFERRAL_POINTS,
      friends: rows.map((r) => {
        const p = byId.get(r._id.toHexString());
        return {
          name: p ? displayNameOf(p) : 'Someone', photoUrl: null, status: r.status, at: r.at.toISOString(),
          sub: r.status === 'rewarded' ? `Joined ${fmt(r.at)} · +${REFERRAL_POINTS}` : r.status === 'pending' ? `Joined ${fmt(r.at)} · waiting for a verified number and a first message` : 'Already had an account',
        };
      }),
    };
  }

  /* ------------------------------------------------------------ bonus campaigns */

  async bonuses(me: ObjectId, tzSent: string | null): Promise<BonusCampaign[]> {
    const tz = await this.tz(me, tzSent);
    return [await this.jack(me, tz), await this.btcy(me, tz)];
  }

  private async jack(me: ObjectId, tz: string): Promise<BonusCampaign> {
    const now = new Date(), day = dayKey(now, tz);
    const [a, paid] = await Promise.all([this.counts(me, day), this.ledger.findOne({ userId: me, key: `bonus:jack-daily:${day}` })]);
    const tasks = JACK_TASKS.map((t) => { const done = Math.min(a[t.counter] ?? 0, t.of); return { id: t.id, title: t.title, icon: t.icon, done, of: t.of, points: t.points, completed: done >= t.of }; });
    const total = JACK_TASKS.reduce((n, t) => n + t.points, 0);
    return { id: 'jack-daily', product: 'jack', eyebrow: 'Jack’s AI bonus · Today', points: total, allRequired: true, endsAt: nextMidnight(now, tz).toISOString(), tasks, paid: paid?.amount ?? 0, complete: !!paid, needsLink: false };
  }

  private async btcy(me: ObjectId, tz: string): Promise<BonusCampaign> {
    const now = new Date(), week = weekKey(now, tz);
    const total = BTCY_TASKS.reduce((n, t) => n + t.points, 0);
    const base = { id: 'btcy-weekly' as const, product: 'btcy' as const, eyebrow: 'BTCY bonus · This week', points: total, allRequired: false, endsAt: endOfWeek(now, tz).toISOString() };
    const link = await this.indexx?.accountOf(me);
    if (!link || !this.indexx) return { ...base, tasks: BTCY_TASKS.map((t) => ({ id: t.id, title: t.title, icon: t.icon, done: 0, of: t.of, points: t.points, completed: false })), paid: 0, complete: false, needsLink: true };
    const w = (await this.indexx.provider.btcy(link, tz)).week;
    const done = { invites: w.invites, mining: w.miningDays, alchemy: w.alchemyConversions };
    const tasks = BTCY_TASKS.map((t) => { const d = Math.min(done[t.id], t.of); return { id: t.id, title: t.title, icon: t.icon, done: d, of: t.of, points: t.points, completed: d >= t.of }; });
    let paid = 0;
    for (const t of tasks) {
      if (!t.completed) continue;
      await this.award(me, tz, { key: `bonus:btcy-weekly:${week}:${t.id}`, kind: 'bonus', title: 'BTCY bonus', sub: t.title, amount: t.points });
      paid += t.points;
    }
    return { ...base, tasks, paid, complete: tasks.every((t) => t.completed), needsLink: false };
  }

  /* ------------------------------------------------------------ pop-ups */

  /** The one pop-up to show as the app opens. Each shows at most once a day, on any device. */
  async popupNow(me: ObjectId, tzSent: string | null): Promise<PopupNow> {
    const tz = await this.tz(me, tzSent), day = dayKey(new Date(), tz), id = `${me.toHexString()}:${day}`;
    const seen = new Set((await this.popups.findOne({ _id: id }))?.seen ?? []);
    const u = await this.users.findOne({ _id: me }, { projection: { 'yc.popups': 1 } });
    const off = ((u?.yc as { popups?: { checkinOff?: boolean } } | undefined)?.popups) ?? {};
    const claim = async (key: string) => (await this.popups.updateOne({ _id: id, seen: { $ne: key } }, { $addToSet: { seen: key }, $setOnInsert: { userId: me, day } }, { upsert: true }).catch((e) => { if (isDup(e)) return { modifiedCount: 0, upsertedCount: 0 }; throw e; })) as { modifiedCount: number; upsertedCount: number };
    const took = (r: { modifiedCount: number; upsertedCount: number }) => r.modifiedCount + r.upsertedCount > 0;
    if (!seen.has('checkin') && !off.checkinOff) {
      const c = await this.checkinStatus(me, tz);
      if (!c.claimedToday && took(await claim('checkin'))) return { kind: 'checkin', checkin: c };
    }
    if (!seen.has('bonuses')) {
      for (const b of await this.bonuses(me, tz)) {
        if (b.complete || seen.has(b.id)) continue;
        if (took(await claim(b.id))) return { kind: 'bonus', bonus: b };
      }
    }
    return { kind: 'none' };
  }

  async dismiss(me: ObjectId, tzSent: string | null, popup: 'checkin' | BonusId | 'bonuses', forever?: boolean) {
    const tz = await this.tz(me, tzSent), day = dayKey(new Date(), tz);
    await this.popups.updateOne({ _id: `${me.toHexString()}:${day}` }, { $addToSet: { seen: popup }, $setOnInsert: { userId: me, day } }, { upsert: true });
    if (popup === 'checkin' && forever !== undefined) await this.users.updateOne({ _id: me }, { $set: { 'yc.popups.checkinOff': forever } });
  }

  /** Start of the person's today, for daily limits elsewhere (Jack's AI messages). */
  async dayStart(me: ObjectId) { const tz = await this.tz(me); return { tz, day: dayKey(new Date(), tz), start: startOf(dayKey(new Date(), tz), tz), next: nextMidnight(new Date(), tz) }; }
}
export const REWARDS = Symbol('REWARDS');

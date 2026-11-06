import { randomUUID } from 'crypto';
import { ObjectId, type Collection, type Db } from 'mongodb';
import { CONVERT, type BtcyView, type IndexxLink, type ProductsView, type WalletTx, type WalletView } from '@yays/shared';
import { AppError } from '../common/app-error';
import { C } from '../infra/mongo';
import type { UserDoc } from '../users/users.repo';
import type { RewardsService } from '../rewards/rewards.service';
import { dayKey } from '../rewards/days';
import { NUGGET_UNIT, type IndexxProvider } from './indexx.provider';

interface LinkFields { indexx?: { account: string; email: string; linkedAt: Date } }

/** The person's Indexx account (BTCY, Indexx Pay, Exchange, EMMM): linking it, and what YaysApp shows from it. */
export class IndexxService {
  readonly users: Collection<UserDoc>;
  constructor(readonly provider: IndexxProvider, private readonly db: Db, private readonly rewards: RewardsService) {
    this.users = db.collection(C.users);
  }

  private async link(me: ObjectId) { return ((await this.users.findOne({ _id: me }, { projection: { 'yc.indexx': 1 } }))?.yc as LinkFields | undefined)?.indexx ?? null; }
  async accountOf(me: ObjectId) { return (await this.link(me))?.account ?? null; }
  private async need(me: ObjectId) {
    const a = await this.accountOf(me);
    if (!a) throw AppError.validation('Link your Indexx account first, in Settings › Indexx account.');
    return a;
  }

  async status(me: ObjectId): Promise<IndexxLink> {
    const l = await this.link(me);
    return { linked: !!l, email: l?.email ?? null, linkedAt: l?.linkedAt.toISOString() ?? null, available: this.provider.available };
  }

  async linkAccount(me: ObjectId, email: string): Promise<IndexxLink> {
    const account = await this.provider.find(email);
    const taken = await this.users.findOne({ 'yc.indexx.account': account, _id: { $ne: me } } as Record<string, unknown>, { projection: { _id: 1 } });
    if (taken) throw AppError.conflict('That Indexx account is already linked to another YaysApp account.');
    await this.users.updateOne({ _id: me }, { $set: { 'yc.indexx': { account, email: email.trim().toLowerCase(), linkedAt: new Date() } } });
    return this.status(me);
  }

  async unlink(me: ObjectId): Promise<IndexxLink> {
    await this.users.updateOne({ _id: me }, { $unset: { 'yc.indexx': '' } });
    return this.status(me);
  }

  async wallet(me: ObjectId, tzSent: string | null): Promise<WalletView> {
    const tz = await this.rewards.tz(me, tzSent);
    const [points, account, usedToday] = await Promise.all([this.rewards.balance(me), this.accountOf(me), this.convertedToday(me, tz)]);
    const b = account ? await this.provider.balances(account) : null;
    return {
      points, linked: !!account,
      nuggets: b ? b.nuggetUnits / NUGGET_UNIT : null, usdxxCents: b?.usdxxCents ?? null, exchangeUsdCents: b?.exchangeUsdCents ?? null,
      syncedAt: b?.syncedAt.toISOString() ?? null,
      convert: { pointsPerNugget: CONVERT.pointsPerNugget, min: CONVERT.min, dailyMax: CONVERT.dailyMax, usedToday },
    };
  }

  private async convertedToday(me: ObjectId, tz: string) {
    const r = await this.rewards.ledger.aggregate<{ n: number }>([{ $match: { userId: me, kind: 'convert', day: dayKey(new Date(), tz) } }, { $group: { _id: null, n: { $sum: '$amount' } } }]).toArray();
    return -(r[0]?.n ?? 0);
  }

  /** Points become BTCY Nuggets in the linked Indexx account. If Indexx refuses, the points come back. */
  async convert(me: ObjectId, tzSent: string | null, points: number): Promise<WalletView> {
    const account = await this.need(me);
    const tz = await this.rewards.tz(me, tzSent);
    if (points < CONVERT.min) throw AppError.validation(`The smallest conversion is ${CONVERT.min.toLocaleString('en-US')} INEX.`);
    if (points % CONVERT.pointsPerNugget) throw AppError.validation(`Convert in steps of ${CONVERT.pointsPerNugget} INEX.`);
    const left = CONVERT.dailyMax - (await this.convertedToday(me, tz));
    if (points > left) throw AppError.validation(left > 0 ? `You can convert ${left.toLocaleString('en-US')} more INEX today.` : 'You’ve converted the most allowed today. Try again tomorrow.');
    const nuggets = points / CONVERT.pointsPerNugget, ref = randomUUID();
    const debit = await this.rewards.award(me, tz, { key: `convert:${ref}`, kind: 'convert', title: 'Converted to BTCY Nuggets', sub: `${points.toLocaleString('en-US')} INEX → ${nuggets} Nuggets`, amount: -points });
    if (!debit) throw AppError.validation('That didn’t go through. Try again.');
    try { await this.provider.creditNuggets(account, nuggets * NUGGET_UNIT, `yays-convert-${ref}`); }
    catch (e) {
      await this.rewards.award(me, tz, { key: `convert-refund:${ref}`, kind: 'reversal', title: 'Conversion refunded', sub: 'Indexx didn’t accept it, so your INEX is back', amount: points });
      throw e instanceof AppError ? e : AppError.validation('Indexx didn’t accept the conversion. Your INEX is back.');
    }
    return this.wallet(me, tz);
  }

  /** Wallet activity: INEX converted to BTCY Nuggets, newest first. */
  async activity(me: ObjectId): Promise<WalletTx[]> {
    const conv = await this.rewards.ledger.find({ userId: me, kind: 'convert' }).sort({ _id: -1 }).limit(50).toArray();
    return conv.map((c): WalletTx => ({ id: c._id.toHexString(), kind: 'convert', direction: 'in', title: 'Converted INEX', sub: c.sub, at: c.at.toISOString(), status: 'done', amount: (-c.amount / CONVERT.pointsPerNugget) * NUGGET_UNIT, unit: 'NUGGET' }));
  }

  async btcy(me: ObjectId, tzSent: string | null): Promise<BtcyView> {
    const account = await this.accountOf(me);
    const empty: BtcyView = { linked: false, mining: { active: false, endsAt: null, nuggets: 0, perHour: 0, last7: [], streak: 0, best: 0 }, tokens: 0, boostPct: 0, team: [] };
    if (!account) return empty;
    const tz = await this.rewards.tz(me, tzSent);
    const [b, a] = await Promise.all([this.provider.balances(account), this.provider.btcy(account, tz)]);
    const now = Date.now();
    return {
      linked: true,
      mining: { active: !!a.mining.endsAt, endsAt: a.mining.endsAt?.toISOString() ?? null, nuggets: b.nuggetUnits / NUGGET_UNIT, perHour: a.mining.perHourUnits / NUGGET_UNIT, last7: a.mining.last7.map((d) => ({ day: d.day, amount: d.units / NUGGET_UNIT })), streak: a.mining.streak, best: a.mining.best },
      tokens: b.btcyTokens, boostPct: a.boostPct,
      team: a.team.map((t) => ({ name: t.name, joinedAt: t.joinedAt.toISOString(), mining: !!t.lastMinedAt && now - t.lastMinedAt.getTime() < 24 * 3600_000, lastActiveAt: t.lastMinedAt?.toISOString() ?? null })),
    };
  }

  async mine(me: ObjectId, tzSent: string | null) {
    const tz = await this.rewards.tz(me, tzSent);
    await this.provider.startMining(await this.need(me), tz);
    return this.btcy(me, tz);
  }

  async products(me: ObjectId): Promise<ProductsView> {
    const account = await this.accountOf(me);
    if (!account) return { linked: false, emmm: null };
    try {
      const e = await this.provider.emmm(account);
      return { linked: true, emmm: e ? { handle: e.handle, open: e.open, settledThisMonth: e.settledThisMonth, markets: e.markets, trendingError: false } : null };
    } catch { return { linked: true, emmm: null }; }
  }
}
export const INDEXX_SERVICE = Symbol('INDEXX_SERVICE');

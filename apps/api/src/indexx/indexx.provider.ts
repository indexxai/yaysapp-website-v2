import type { Collection, Db } from 'mongodb';
import { AppError } from '../common/app-error';
import { dayKey, shiftDay, weekKey } from '../rewards/days';

/** Nuggets are kept as whole numbers of 1/10000 Nugget. */
export const NUGGET_UNIT = 10_000;

export interface IndexxBalances { nuggetUnits: number; usdxxCents: number; exchangeUsdCents: number; btcyTokens: number; syncedAt: Date }
export interface BtcyActivity {
  mining: { endsAt: Date | null; perHourUnits: number; streak: number; best: number; last7: Array<{ day: string; units: number }> };
  boostPct: number;
  team: Array<{ name: string; joinedAt: Date; lastMinedAt: Date | null }>;
  /** This week (Monday on), for the BTCY bonus. */
  week: { invites: number; miningDays: number; alchemyConversions: number };
}
export interface EmmmActivity { handle: string; open: number; settledThisMonth: number; markets: Array<{ question: string; closes: string; side: 'yes' | 'no' | 'pending' }> }

/**
 * Everything YaysApp reads from or asks of the Indexx platform (BTCY, Indexx Pay, Exchange, EMMM).
 * YaysApp never holds these balances itself: it asks Indexx.
 */
export interface IndexxProvider {
  readonly available: boolean;
  /** Finds the Indexx account with this email. Returns its id. */
  find(email: string): Promise<string>;
  balances(account: string): Promise<IndexxBalances>;
  creditNuggets(account: string, units: number, ref: string): Promise<void>;
  btcy(account: string, tz: string): Promise<BtcyActivity>;
  startMining(account: string, tz: string): Promise<void>;
  emmm(account: string): Promise<EmmmActivity | null>;
}

/** Used when no Indexx connection is set up: nothing can be linked. */
export const offIndexx: IndexxProvider = {
  available: false,
  find: async () => { throw AppError.validation('Linking Indexx accounts isn’t available yet.'); },
  balances: async () => { throw AppError.validation('Indexx isn’t connected.'); },
  creditNuggets: async () => { throw AppError.validation('Indexx isn’t connected.'); },
  btcy: async () => { throw AppError.validation('Indexx isn’t connected.'); },
  startMining: async () => { throw AppError.validation('Indexx isn’t connected.'); },
  emmm: async () => null,
};

interface DevAccount {
  _id: string; // email
  nuggetUnits: number; usdxxCents: number; exchangeUsdCents: number; btcyTokens: number;
  mining: { endsAt: Date | null; perHourUnits: number; streak: number; best: number; days: Record<string, number>; lastDay: string | null };
  boostPct: number;
  team: Array<{ name: string; joinedAt: Date; lastMinedAt: Date | null }>;
  weeks: Record<string, { invites: number; miningDays: number; alchemyConversions: number }>;
  emmm: EmmmActivity | null;
  transfers: string[];
}

/**
 * Development and tests only: a stand-in Indexx kept in this database (yc_indexx_dev), so every screen can be
 * used before the real Indexx API is connected. Refused in production.
 */
export class DevIndexx implements IndexxProvider {
  readonly available = true;
  readonly col: Collection<DevAccount>;
  constructor(db: Db) { this.col = db.collection<DevAccount>('yc_indexx_dev'); }

  private async get(id: string): Promise<DevAccount> {
    const a = await this.col.findOne({ _id: id });
    if (!a) throw AppError.notFound('That Indexx account wasn’t found.');
    return a;
  }

  async find(email: string) {
    const id = email.trim().toLowerCase();
    await this.col.updateOne({ _id: id }, {
      $setOnInsert: {
        nuggetUnits: 10 * NUGGET_UNIT, usdxxCents: 4250, exchangeUsdCents: 31820, btcyTokens: 1240,
        mining: { endsAt: null, perHourUnits: 125, streak: 0, best: 0, days: {}, lastDay: null },
        boostPct: 0, team: [], weeks: {}, transfers: [],
        emmm: { handle: '@' + id.split('@')[0]!.replace(/[^a-z0-9_]/g, '').slice(0, 15), open: 0, settledThisMonth: 0, markets: [] },
      },
    }, { upsert: true });
    return id;
  }

  async balances(id: string): Promise<IndexxBalances> {
    const a = await this.get(id);
    return { nuggetUnits: a.nuggetUnits, usdxxCents: a.usdxxCents, exchangeUsdCents: a.exchangeUsdCents, btcyTokens: a.btcyTokens, syncedAt: new Date() };
  }

  async creditNuggets(id: string, units: number, ref: string) {
    await this.col.updateOne({ _id: id, transfers: { $ne: ref } }, { $inc: { nuggetUnits: units }, $push: { transfers: ref } });
  }

  async btcy(id: string, tz: string): Promise<BtcyActivity> {
    const a = await this.get(id);
    const today = dayKey(new Date(), tz);
    const last7 = Array.from({ length: 7 }, (_, i) => shiftDay(today, i - 6)).map((d) => ({ day: d, units: a.mining.days[d] ?? 0 }));
    const w = a.weeks[weekKey(new Date(), tz)] ?? { invites: 0, miningDays: 0, alchemyConversions: 0 };
    const streak = a.mining.lastDay && a.mining.lastDay >= shiftDay(today, -1) ? a.mining.streak : 0;
    return { mining: { endsAt: a.mining.endsAt && a.mining.endsAt > new Date() ? a.mining.endsAt : null, perHourUnits: a.mining.perHourUnits, streak, best: a.mining.best, last7 }, boostPct: a.boostPct, team: a.team, week: w };
  }

  async startMining(id: string, tz: string) {
    const a = await this.get(id);
    const now = new Date();
    if (a.mining.endsAt && a.mining.endsAt > now) throw AppError.conflict('Mining is already running.');
    const today = dayKey(now, tz), wk = weekKey(now, tz);
    const first = a.mining.lastDay !== today;
    const streak = !first ? a.mining.streak : a.mining.lastDay === shiftDay(today, -1) ? a.mining.streak + 1 : 1;
    const earned = a.mining.perHourUnits * 24;
    await this.col.updateOne({ _id: id }, {
      $set: { 'mining.endsAt': new Date(now.getTime() + 24 * 3600_000), 'mining.lastDay': today, 'mining.streak': streak, 'mining.best': Math.max(a.mining.best, streak) },
      $inc: { [`mining.days.${today}`]: earned, nuggetUnits: earned, ...(first ? { [`weeks.${wk}.miningDays`]: 1 } : {}) },
    });
  }

  async emmm(id: string) { return (await this.get(id)).emmm; }
}

export const INDEXX = Symbol('INDEXX');

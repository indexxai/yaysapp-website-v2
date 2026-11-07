import { randomBytes } from 'crypto';
import type { Collection, Db } from 'mongodb';
import { INDEXX_LINKS, type ExchangeAsset, type IndexxBtcy, type IndexxEmmm, type IndexxShoperPal, type IndexxWallStreet, type Withdrawal } from '@yays/shared';

/**
 * Development and tests only: answers like the Indexx API does (YaysApp Explore and Wallet APIs, 7 Nov 2026), so
 * the real client and every screen can be used without Indexx. Kept in this database (yc_indexx_stub), one record
 * per email. Any password signs in except "wrong-password". Refused in production.
 */
export interface StubAccount {
  _id: string; // email
  inex: number;
  nuggets: number;
  usdxx: number;
  exchange: ExchangeAsset[];
  /** Mining: endsAt, and nuggets mined per UTC day. */
  btcy: { plan: string; speed: number; endsAt: Date | null; streakDays: number; minedByDay: Record<string, number>; members: number; miningNow: number; tokens: number; totalMined: number };
  emmm: IndexxEmmm;
  shoperpal: IndexxShoperPal;
  wallstreet: IndexxWallStreet;
  withdrawals: Array<Withdrawal & { key: string }>;
  /** Products that answer null (as if down), for trying the empty states. */
  down: string[];
  /** Tokens made before this no longer work (as if they expired). */
  revokedBefore: Date | null;
  /** The next withdraw fails this way. */
  failNext: 'unavailable' | 'in_progress' | null;
}

export const STUB_MIN = 25, STUB_DAILY_MAX = 5000;
const dayOf = (d: Date) => d.toISOString().slice(0, 10);

export function newStubAccount(email: string, now = new Date()): StubAccount {
  const day = (n: number) => dayOf(new Date(now.getTime() - n * 86400_000));
  return {
    _id: email, inex: 60, nuggets: 10, usdxx: 47.5,
    exchange: [{ symbol: 'INEX', network: 'Binance Smart Chain', balance: 0.33, price: 5.25, usd: 1.73 }, { symbol: 'XYZ', network: 'Ethereum', balance: 10, price: null, usd: null }],
    btcy: { plan: 'Free', speed: 1, endsAt: null, streakDays: 2, minedByDay: { [day(1)]: 4.5, [day(0)]: 0.3 }, members: 4, miningNow: 2, tokens: 1240, totalMined: 10 },
    emmm: {
      openPositions: 1, settledThisMonth: { count: 1, payoutUsd: 14.5 },
      markets: [
        { marketSlug: 'btc-above-100k-dec', title: 'Will BTC close above $100k in December?', outcome: 'Yes', status: 'open', shares: 20, currentValue: 11.2, stakeUsd: 10, payoutUsd: null, settledAt: null },
        { marketSlug: 'lakers-vs-celtics-nov-2', title: 'Lakers vs Celtics', outcome: 'Lakers', status: 'won', shares: 15, currentValue: 0, stakeUsd: 8, payoutUsd: 14.5, settledAt: new Date(now.getTime() - 4 * 86400_000).toISOString() },
      ],
      eligibility: { eligible: true, nuggetBalance: 10, totalMined: 10, maxBetNuggets: 5, reason: null },
      portfolio: { value: 11.2, cash: 0, usdt: 0 },
    },
    shoperpal: {
      role: 'buyer', supplier: null,
      buyer: {
        monthSpend: 64.98, orderCount: 2, earnRate: '0.5-2 BTCY / $1',
        nuggets: { released: 10, pending: 4, wallet: 10, lifetime: 14 },
        flash: { title: '20% off Wireless Earbuds', endsAt: new Date(now.getTime() + 9 * 3600_000).toISOString() },
        recentPurchases: [
          { id: 'cm3x-earbuds', status: 'SHIPPED', total: 39.99, createdAt: new Date(now.getTime() - 3 * 86400_000).toISOString(), items: [{ name: 'Wireless Earbuds', quantity: 1, price: 39.99 }] },
          { id: 'cm3x-cerave', status: 'PENDING', total: 24.99, createdAt: new Date(now.getTime() - 86400_000).toISOString(), items: [{ name: 'CeraVe Moisturizing Cream', quantity: 1, price: 18.99 }, { name: 'Lip balm', quantity: 2, price: 3 }] },
        ],
      },
    },
    wallstreet: {
      holdings: { count: 1, totalInvested: 500, items: [{ campaignId: '6721acme', tokenSymbol: 'ACME', tokenName: 'Acme Corp', amountInvested: 500, tokensReceived: 1000, purchases: 2, lastPurchasedAt: new Date(now.getTime() - 6 * 86400_000).toISOString() }] },
      listings: { count: 0, items: [] },
    },
    withdrawals: [], down: [], revokedBefore: null, failNext: null,
  };
}

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const ok = (data: unknown) => json(200, { data });

function sumByDay(a: StubAccount, day: string) { return a.withdrawals.filter((w) => w.status !== 'failed' && w.createdAt.slice(0, 10) === day).reduce((n, w) => n + w.amount, 0); }

function btcyOf(a: StubAccount, now: Date): IndexxBtcy {
  const days = Array.from({ length: 7 }, (_, i) => { const d = new Date(now.getTime() - (6 - i) * 86400_000); return { date: dayOf(d), label: i === 6 ? 'Today' : d.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' }), nuggets: a.btcy.minedByDay[dayOf(d)] ?? 0 }; });
  const active = !!a.btcy.endsAt && a.btcy.endsAt > now;
  const percent = Math.min(50, a.btcy.miningNow * 5);
  return {
    mining: { active, speed: a.btcy.speed, plan: a.btcy.plan, endsInSeconds: active ? Math.round((a.btcy.endsAt!.getTime() - now.getTime()) / 1000) : null, streakDays: a.btcy.streakDays, bestStreakDays: null },
    last7Days: { days, total: Math.round(days.reduce((n, d) => n + (d.nuggets ?? 0), 0) * 10000) / 10000 },
    team: { members: a.btcy.members, miningNow: a.btcy.miningNow },
    boost: { percent, multiplier: 1 + percent / 100 },
    portfolio: { nuggets: a.nuggets, tokens: a.btcy.tokens, totalMined: a.btcy.totalMined },
    alchemy: { currentUsd: 52000, targetUsd: 100000 }, referrals: { active: a.btcy.members, target: 25 }, station: { unlocked: false },
    ambassador: { tier: null, nextTierAt: 25 }, watchEarn: { watched: 3, total: null, nuggetsToday: null },
  };
}

function quoteOf(a: StubAccount, amount: number, now: Date) {
  const used = sumByDay(a, dayOf(now)), remaining = Math.max(0, STUB_DAILY_MAX - used);
  const reason = !amount ? 'Enter how much INEX to withdraw.'
    : amount < STUB_MIN ? `The minimum withdrawal is ${STUB_MIN} INEX.`
      : amount > a.inex ? `You have ${a.inex} INEX.`
        : amount > remaining ? `You can withdraw ${remaining} more INEX today.` : null;
  return { amount, balance: a.inex, minimum: STUB_MIN, dailyMax: STUB_DAILY_MAX, usedToday: used, remainingToday: remaining, destination: 'Indexx Exchange INEX wallet', eligible: !reason, reason };
}

/** A fetch function that answers the Indexx API's routes from the stand-in records. */
export function standInIndexx(db: Db): typeof fetch {
  const col: Collection<StubAccount> = db.collection<StubAccount>('yc_indexx_stub');
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const path = url.pathname.replace(/^.*\/api\/v1/, '');
    const h = new Headers(init?.headers);
    if (/curl|postman/i.test(h.get('user-agent') ?? '')) return json(403, { message: 'Requests from this client are not allowed' });
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
    const now = new Date();

    if (init?.method === 'POST' && path === '/inex/user/login') {
      const email = String(body.email ?? '').trim().toLowerCase();
      if (!email || !body.password || body.password === 'wrong-password') return json(400, { status: 400, message: 'Invalid email or password' });
      await col.updateOne({ _id: email }, { $setOnInsert: newStubAccount(email, now) }, { upsert: true });
      const iat = Math.floor(now.getTime() / 1000);
      return json(200, { status: 200, data: { access_token: `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ email, iat, exp: iat + 7 * 86400 })}.${randomBytes(12).toString('base64url')}` } });
    }
    if (path === '/yays/ecosystem/config') return ok({ products: { btcy: 'live', shoperpal: 'live', emmm: 'live', rehuman: 'content', wallstreet: 'live' } });

    // Everything else needs the login token.
    let email = '', iat = 0;
    try {
      const p = JSON.parse(Buffer.from((h.get('authorization') ?? '').replace(/^Bearer /, '').split('.')[1] ?? '', 'base64url').toString()) as { email: string; iat: number; exp: number };
      if (p.exp * 1000 < now.getTime()) throw new Error('expired');
      email = p.email; iat = p.iat;
    } catch { return json(401, { message: 'Unauthorized: invalid token' }); }
    const a = await col.findOne({ _id: email });
    if (!a || (a.revokedBefore && iat * 1000 < a.revokedBefore.getTime())) return json(401, { message: 'Unauthorized: invalid token' });
    const up = (p: string) => (a.down.includes(p) ? null : p === 'btcy' ? btcyOf(a, now) : a[p as 'emmm' | 'shoperpal' | 'wallstreet']);

    if (path === '/yays/ecosystem/explore') return ok({ links: INDEXX_LINKS, btcy: up('btcy'), emmm: up('emmm'), shoperpal: up('shoperpal'), wallstreet: up('wallstreet') });
    const one = /^\/yays\/ecosystem\/(btcy|emmm|shoperpal|wallstreet)$/.exec(path);
    if (one) return a.down.includes(one[1]!) ? json(500, { message: 'Could not read this product', code: 'server' }) : ok(up(one[1]!));
    if (path === '/yays/ecosystem/profile') return ok({ referralCode: 'AB12CD34', kycPassed: true });
    if (path === '/yays/wallet/summary') {
      const assets = a.exchange.filter((x) => x.balance > 0).map((x) => ({ ...x, usd: x.price == null ? null : Math.round(x.balance * x.price * 100) / 100 }));
      return ok({
        inex: { balance: a.inex, source: 'Earned in YaysApp' },
        nuggets: { balance: a.nuggets, source: 'From BTCY mining' },
        usdxx: { balance: a.usdxx, usd: a.usdxx, source: 'Indexx Pay' },
        exchange: a.down.includes('exchange') ? null : { totalUsd: Math.round(assets.reduce((n, x) => n + (x.usd ?? 0), 0) * 100) / 100, assets, partial: assets.some((x) => x.usd == null), readOnly: true },
      });
    }
    if (path === '/yays/wallet/withdraw/quote') return ok(quoteOf(a, Math.max(0, Math.floor(Number(url.searchParams.get('amount') ?? 0) || 0)), now));
    if (path === '/yays/wallet/withdraw/history') {
      const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') ?? 25))), skip = Math.max(0, Number(url.searchParams.get('skip') ?? 0));
      const all = [...a.withdrawals].reverse().map(({ key: _k, ...w }) => w);
      return ok({ items: all.slice(skip, skip + limit), hasMore: all.length > skip + limit });
    }
    if (init?.method === 'POST' && path === '/yays/wallet/withdraw') {
      const key = String(body.idempotencyKey ?? h.get('x-idempotency-key') ?? '');
      if (!key) return json(400, { message: 'idempotencyKey is required.', code: 'validation' });
      const seen = a.withdrawals.find((w) => w.key === key);
      if (seen) { const { key: _k, ...w } = seen; return ok({ ...w, duplicate: true }); }
      const amount = Number(body.amount);
      if (!Number.isInteger(amount)) return json(400, { message: 'Enter a whole number of INEX.', code: 'validation' });
      const q = quoteOf(a, amount, now);
      if (!q.eligible) return json(400, { message: q.reason, code: 'validation' });
      if (a.failNext === 'in_progress') { await col.updateOne({ _id: email }, { $set: { failNext: null } }); return json(409, { message: 'Another withdrawal is still running.', code: 'in_progress' }); }
      const id = randomBytes(12).toString('hex');
      if (a.failNext === 'unavailable') {
        await col.updateOne({ _id: email }, { $set: { failNext: null }, $push: { withdrawals: { id, key, status: 'failed', amount, balance: a.inex, network: null, createdAt: now.toISOString(), duplicate: false } } });
        return json(503, { message: 'The exchange could not take the INEX right now. Your balance is unchanged.', code: 'unavailable' });
      }
      const w = { id, key, status: 'completed' as const, amount, balance: a.inex - amount, network: 'BSC', createdAt: now.toISOString(), duplicate: false };
      const exchange = a.exchange.some((x) => x.symbol === 'INEX') ? a.exchange.map((x) => (x.symbol === 'INEX' ? { ...x, balance: Math.round((x.balance + amount) * 100) / 100 } : x)) : [{ symbol: 'INEX', network: 'Binance Smart Chain', balance: amount, price: 5.25, usd: null }, ...a.exchange];
      await col.updateOne({ _id: email }, { $set: { inex: a.inex - amount, exchange }, $push: { withdrawals: w } });
      const { key: _k, ...out } = w;
      return ok(out);
    }
    return json(404, { message: 'Not found' });
  }) as typeof fetch;
}

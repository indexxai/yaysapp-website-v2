import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import type { Collection, Db, ObjectId } from 'mongodb';
import {
  ErrorCode, INDEXX_LINKS, type ExploreProduct, type ExploreView, type IndexxBtcy, type IndexxLink, type IndexxLinks,
  type WalletView, type Withdrawal, type WithdrawalsPage, type WithdrawQuote,
} from '@yays/shared';
import { AppError } from '../common/app-error';
import type { Logger } from '../common/logger';
import { C } from '../infra/mongo';
import type { UserDoc } from '../users/users.repo';
import { IndexxSignedOut, type IndexxClient } from './indexx.client';

/** Kept on the YaysApp user (under yc): the Indexx email, and the login token encrypted. Never the password. */
interface IndexxFields { indexx?: { email: string; token?: string; expiresAt?: Date | null; linkedAt: Date } }

const SIGNED_OUT = 'Your Indexx sign-in ended. Sign in to Indexx again.';

/**
 * The person's Indexx sign-in, and everything YaysApp shows from Indexx (Explore cards, wallet, withdraw).
 * Their login token is used only from this server, so the web and mobile apps only ever talk to YaysApp.
 */
export class IndexxService {
  readonly users: Collection<UserDoc>;
  private readonly key: Buffer;
  constructor(private readonly client: IndexxClient | null, db: Db, secret: string, private readonly log: Logger) {
    this.users = db.collection(C.users);
    this.key = createHash('sha256').update(`yays-indexx-token:${secret}`).digest();
  }
  get available() { return !!this.client; }

  private seal(token: string) {
    const iv = randomBytes(12), c = createCipheriv('aes-256-gcm', this.key, iv);
    const data = Buffer.concat([c.update(token, 'utf8'), c.final()]);
    return [iv, c.getAuthTag(), data].map((b) => b.toString('base64url')).join('.');
  }
  private open(sealed: string): string | null {
    try {
      const [iv, tag, data] = sealed.split('.').map((x) => Buffer.from(x, 'base64url'));
      const d = createDecipheriv('aes-256-gcm', this.key, iv!); d.setAuthTag(tag!);
      return Buffer.concat([d.update(data!), d.final()]).toString('utf8');
    } catch { return null; }
  }

  private async fields(me: ObjectId) { return ((await this.users.findOne({ _id: me }, { projection: { 'yc.indexx': 1 } }))?.yc as IndexxFields | undefined)?.indexx ?? null; }
  /** The working login token, or null when not signed in (or it ran out). */
  private async token(me: ObjectId): Promise<string | null> {
    const f = await this.fields(me);
    if (!f?.token || (f.expiresAt && f.expiresAt.getTime() < Date.now())) return null;
    return this.open(f.token);
  }
  private async forget(me: ObjectId) { await this.users.updateOne({ _id: me }, { $unset: { 'yc.indexx.token': '', 'yc.indexx.expiresAt': '' } }); }

  /** Calls Indexx with the person's token. If Indexx says the token is no longer good, it's dropped. */
  private async call<T>(me: ObjectId, fn: (c: IndexxClient, token: string) => Promise<T>): Promise<T> {
    const token = this.client ? await this.token(me) : null;
    if (!token || !this.client) throw new AppError(409, ErrorCode.INDEXX_SIGN_IN, 'Sign in to Indexx first.');
    try { return await fn(this.client, token); }
    catch (e) {
      if (e instanceof IndexxSignedOut) { await this.forget(me); throw new AppError(409, ErrorCode.INDEXX_SIGN_IN, SIGNED_OUT); }
      throw e;
    }
  }
  private static signInNeeded(e: unknown) { return e instanceof AppError && e.code === ErrorCode.INDEXX_SIGN_IN; }

  async status(me: ObjectId): Promise<IndexxLink> {
    const f = await this.fields(me);
    const linked = !!(this.client && (await this.token(me)));
    return { linked, email: f?.email ?? null, linkedAt: linked && f ? f.linkedAt.toISOString() : null, available: this.available };
  }
  async linked(me: ObjectId) { return !!(this.client && (await this.token(me))); }

  async signIn(me: ObjectId, emailIn: string, password: string): Promise<IndexxLink> {
    if (!this.client) throw AppError.validation('Signing in to Indexx isn’t available yet.');
    const email = emailIn.trim().toLowerCase();
    const taken = await this.users.findOne({ 'yc.indexx.email': email, 'yc.indexx.token': { $exists: true }, _id: { $ne: me } } as Record<string, unknown>, { projection: { _id: 1 } });
    if (taken) throw AppError.conflict('That Indexx account is already signed in on another YaysApp account.');
    const { token, expiresAt } = await this.client.login(email, password);
    await this.users.updateOne({ _id: me }, { $set: { 'yc.indexx': { email, token: this.seal(token), expiresAt, linkedAt: new Date() } } });
    this.log.info({ userId: me.toHexString() }, 'signed in to Indexx');
    return this.status(me);
  }

  async signOut(me: ObjectId): Promise<IndexxLink> {
    await this.users.updateOne({ _id: me }, { $unset: { 'yc.indexx': '' } });
    return this.status(me);
  }

  /* ------------------------------------------------------------ Explore */

  private static links(l: Partial<IndexxLinks> | undefined | null): IndexxLinks { return { ...INDEXX_LINKS, ...(l ?? {}) }; }

  async explore(me: ObjectId): Promise<ExploreView> {
    const none: ExploreView = { linked: false, links: INDEXX_LINKS, btcy: null, emmm: null, shoperpal: null, wallstreet: null };
    try {
      const d = await this.call(me, (c, t) => c.get<Partial<ExploreView> & { links?: IndexxLinks }>(t, '/yays/ecosystem/explore', 30_000));
      return { linked: true, links: IndexxService.links(d?.links), btcy: d?.btcy ?? null, emmm: d?.emmm ?? null, shoperpal: d?.shoperpal ?? null, wallstreet: d?.wallstreet ?? null };
    } catch (e) { if (IndexxService.signInNeeded(e)) return none; throw e; }
  }

  /** One product, for its own page. A product Indexx can't read comes back as null, like on Explore. */
  async product<P extends ExploreProduct>(me: ObjectId, p: P): Promise<{ linked: boolean; links: IndexxLinks; data: ExploreView[P] }> {
    try {
      const data = await this.call(me, (c, t) => c.get<ExploreView[P]>(t, `/yays/ecosystem/${p}`, 20_000)).catch((e) => {
        if (IndexxService.signInNeeded(e)) throw e;
        return null as ExploreView[P];
      });
      return { linked: true, links: INDEXX_LINKS, data };
    } catch { return { linked: false, links: INDEXX_LINKS, data: null as ExploreView[P] }; }
  }

  /** For the BTCY bonus: this person's BTCY numbers, or null when not signed in or Indexx didn't answer. */
  async btcyFor(me: ObjectId): Promise<IndexxBtcy | null> { return (await this.product(me, 'btcy').catch(() => null))?.data ?? null; }

  /* ------------------------------------------------------------ Wallet */

  async wallet(me: ObjectId): Promise<WalletView> {
    try {
      const d = await this.call(me, (c, t) => c.get<Omit<WalletView, 'linked'>>(t, '/yays/wallet/summary'));
      return { linked: true, inex: d?.inex ?? null, nuggets: d?.nuggets ?? null, usdxx: d?.usdxx ?? null, exchange: d?.exchange ?? null };
    } catch (e) {
      if (IndexxService.signInNeeded(e)) return { linked: false, inex: null, nuggets: null, usdxx: null, exchange: null };
      throw e;
    }
  }

  quote(me: ObjectId, amount: number): Promise<WithdrawQuote> {
    const n = Number.isFinite(amount) && amount > 0 ? Math.floor(amount) : 0;
    return this.call(me, (c, t) => c.get<WithdrawQuote>(t, `/yays/wallet/withdraw/quote${n ? `?amount=${n}` : ''}`));
  }

  /** INEX 1:1 to the person's Indexx Exchange INEX wallet. The same key twice pays once. */
  withdraw(me: ObjectId, amount: number, idempotencyKey: string): Promise<Withdrawal> {
    return this.call(me, (c, t) => c.post<Withdrawal>(t, '/yays/wallet/withdraw', { amount, idempotencyKey }, { 'x-idempotency-key': idempotencyKey }));
  }

  withdrawals(me: ObjectId, skip: number): Promise<WithdrawalsPage> {
    const s = Number.isFinite(skip) && skip > 0 ? Math.floor(skip) : 0;
    return this.call(me, (c, t) => c.get<WithdrawalsPage>(t, `/yays/wallet/withdraw/history?limit=25&skip=${s}`));
  }
}
export const INDEXX_SERVICE = Symbol('INDEXX_SERVICE');

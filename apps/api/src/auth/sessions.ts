import { randomBytes } from 'crypto';
import type Redis from 'ioredis';
import { ObjectId, type Collection, type Db } from 'mongodb';
import { ErrorCode, type DeviceSession, type Tokens } from '@yays/shared';
import { AppError } from '../common/app-error';
import type { Config } from '../config';
import { C } from '../infra/mongo';
import { TokenService } from './tokens';

export interface SessionDoc {
  _id: string;
  userId: ObjectId;
  deviceId: string;
  platform: 'ios' | 'android' | 'web';
  name: string;
  appVersion?: string;
  refreshHash: string;
  prevRefreshHash?: string;
  createdAt: Date;
  lastActiveAt: Date;
  expiresAt: Date;
  revokedAt?: Date;
  revokedReason?: string;
  ip?: string;
}

export interface DeviceInput { deviceId: string; platform: 'ios' | 'android' | 'web'; name?: string; appVersion?: string }

/**
 * One session per signed-in device. Refresh tokens are `<sessionId>.<secret>`, stored hashed and rotated on every use.
 * Presenting the previous secret again means the token was copied: the session is revoked.
 */
export class SessionService {
  private col: Collection<SessionDoc>;
  /** Set by the real-time layer so a signed-out device also loses its live connection. */
  onRevoked: (sid: string) => void = () => undefined;
  constructor(db: Db, private readonly redis: Redis, private readonly tokens: TokenService, private readonly c: Config) { this.col = db.collection<SessionDoc>(C.sessions); }

  private revokedKey(sid: string) { return `sess:revoked:${sid}`; }
  private ttlMs() { return this.c.REFRESH_TTL_DAYS * 86400_000; }

  async create(userId: ObjectId, d: DeviceInput, ip?: string): Promise<Tokens> {
    // Signing in again on the same device replaces its old session.
    const old = await this.col.find({ userId, deviceId: d.deviceId, revokedAt: { $exists: false } }).project<{ _id: string }>({ _id: 1 }).toArray();
    for (const o of old) await this.revoke(o._id, 'replaced');
    const sid = randomBytes(16).toString('hex');
    const secret = TokenService.refreshSecret();
    const now = new Date();
    await this.col.insertOne({ _id: sid, userId, deviceId: d.deviceId, platform: d.platform, name: d.name || defaultName(d.platform), appVersion: d.appVersion, refreshHash: TokenService.hash(secret), createdAt: now, lastActiveAt: now, expiresAt: new Date(now.getTime() + this.ttlMs()), ip });
    return this.issue(userId.toHexString(), sid, secret);
  }

  private async issue(userId: string, sid: string, secret: string): Promise<Tokens> {
    const a = await this.tokens.access(userId, sid);
    return { accessToken: a.token, accessExpiresAt: a.expiresAt, refreshToken: `${sid}.${secret}`, sessionId: sid };
  }

  async refresh(refreshToken: string): Promise<Tokens> {
    const dot = refreshToken.indexOf('.');
    const sid = refreshToken.slice(0, dot), secret = refreshToken.slice(dot + 1);
    if (dot < 1 || !secret) throw AppError.unauthenticated();
    const h = TokenService.hash(secret);
    const next = TokenService.refreshSecret();
    const now = new Date();
    const s = await this.col.findOneAndUpdate(
      { _id: sid, refreshHash: h, revokedAt: { $exists: false }, expiresAt: { $gt: now } },
      { $set: { refreshHash: TokenService.hash(next), prevRefreshHash: h, lastActiveAt: now, expiresAt: new Date(now.getTime() + this.ttlMs()) } },
      { returnDocument: 'after' },
    );
    if (s) return this.issue(s.userId.toHexString(), sid, next);
    const reused = await this.col.findOne({ _id: sid, prevRefreshHash: h, revokedAt: { $exists: false } });
    if (reused) {
      await this.revoke(sid, 'refresh_reuse');
      throw new AppError(401, ErrorCode.SESSION_REVOKED, 'For your safety you were signed out on this device. Sign in again.');
    }
    const revoked = await this.col.findOne({ _id: sid }, { projection: { revokedAt: 1 } });
    if (revoked?.revokedAt) throw new AppError(401, ErrorCode.SESSION_REVOKED, 'This device was signed out. Sign in again.');
    throw AppError.unauthenticated();
  }

  async assertActive(sid: string) {
    if (await this.redis.exists(this.revokedKey(sid))) throw new AppError(401, ErrorCode.SESSION_REVOKED, 'This device was signed out. Sign in again.');
  }

  async touch(sid: string) {
    // At most one write a minute per session.
    if (await this.redis.set(`sess:touch:${sid}`, '1', 'EX', 60, 'NX')) await this.col.updateOne({ _id: sid }, { $set: { lastActiveAt: new Date() } });
  }

  async revoke(sid: string, reason: string) {
    await this.col.updateOne({ _id: sid, revokedAt: { $exists: false } }, { $set: { revokedAt: new Date(), revokedReason: reason } });
    // Access tokens are short-lived; remembering the revocation for that long blocks them immediately.
    await this.redis.set(this.revokedKey(sid), '1', 'EX', this.c.ACCESS_TTL_SECONDS + 60);
    this.onRevoked(sid);
  }

  async list(userId: ObjectId, currentSid: string): Promise<DeviceSession[]> {
    const rows = await this.col.find({ userId, revokedAt: { $exists: false }, expiresAt: { $gt: new Date() } }).sort({ lastActiveAt: -1 }).toArray();
    return rows.map((r) => ({ id: r._id, name: r.name, platform: r.platform, lastActiveAt: r.lastActiveAt.toISOString(), createdAt: r.createdAt.toISOString(), current: r._id === currentSid }));
  }

  async revokeOwn(userId: ObjectId, sid: string) {
    const s = await this.col.findOne({ _id: sid, userId, revokedAt: { $exists: false } });
    if (!s) throw AppError.notFound('That device is not signed in.');
    await this.revoke(sid, 'user_revoked');
  }

  async revokeOthers(userId: ObjectId, keepSid: string) {
    const rows = await this.col.find({ userId, _id: { $ne: keepSid }, revokedAt: { $exists: false } }).project<{ _id: string }>({ _id: 1 }).toArray();
    for (const r of rows) await this.revoke(r._id, 'user_revoked_all');
    return rows.length;
  }
}
const defaultName = (p: string) => (p === 'web' ? 'Web browser' : p === 'ios' ? 'iPhone' : 'Android phone');
export const SESSIONS = Symbol('SESSIONS');

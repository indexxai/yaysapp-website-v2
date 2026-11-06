import { MongoServerError, ObjectId, type Collection, type Db } from 'mongodb';
import { DEFAULT_APP_PREFS, DEFAULT_NOTIFICATIONS, DEFAULT_PRIVACY, type AppPreferences, type MeProfile, type NotificationSettings, type PrivacySettings, type PublicProfile } from '@yays/shared';
import { C } from '../infra/mongo';

/** v2's own fields, kept under `yc` so nothing BTCY or the old app reads ever changes. */
export interface YcFields {
  phoneE164?: string;
  phoneVerifiedAt?: Date;
  emailLower?: string;
  emailVerifiedAt?: Date;
  googleSub?: string;
  displayName?: string;
  username?: string;
  about?: string;
  photoKey?: string | null;
  joinedAt?: Date;
  /** The account existed in the old app before it first signed in to v2. */
  legacy?: boolean;
  disabledAt?: Date;
  /** When the last live connection closed. */
  lastSeenAt?: Date;
  /** Two-step verification PIN (scrypt). */
  twoStep?: { hash: string; salt: string; setAt: Date };
  /** The person deleted their YaysApp account. Signing in again starts a fresh profile. */
  deletedAt?: Date;
  privacy?: Partial<PrivacySettings>;
  notify?: Partial<NotificationSettings>;
  prefs?: Partial<AppPreferences>;
  /** Phase 2: Facebook link, typed-in socials, payment PIN, linked Indexx account. */
  facebook?: unknown;
  socials?: unknown;
  payPin?: unknown;
  indexx?: unknown;
}
/** Only the legacy fields v2 reads. Everything else on the document is left alone. */
export interface UserDoc {
  _id: ObjectId;
  email?: string;
  phone?: string;
  username?: string;
  firstName?: string;
  lastName?: string;
  profilePic?: string;
  createdAt?: Date;
  yc?: YcFields;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export const isDuplicate = (e: unknown, field?: string) => e instanceof MongoServerError && e.code === 11000 && (!field || JSON.stringify(e.keyPattern ?? {}).includes(field));

export class UsersRepo {
  readonly col: Collection<UserDoc>;
  constructor(db: Db) { this.col = db.collection<UserDoc>(C.users); }

  byId(id: ObjectId) { return this.col.findOne({ _id: id }); }
  byPhone(phone: string) { return this.col.findOne({ 'yc.phoneE164': phone }); }
  byGoogleSub(sub: string) { return this.col.findOne({ 'yc.googleSub': sub }); }

  /**
   * Old accounts may store email with any capitalisation, and a few emails appear on more than one
   * account. Prefer the account v2 already linked, then an exact match, then any case; among several,
   * the one that signed in most recently.
   */
  async byEmail(email: string): Promise<UserDoc | null> {
    const linked = await this.col.findOne({ 'yc.emailLower': email });
    if (linked) return linked;
    // An old-app email counts only until the person sets another one in YaysApp (then the old one no longer signs in).
    const exact = await this.col.find({ email, 'yc.emailLower': { $exists: false } }).sort({ lastLogin: -1, _id: 1 }).limit(1).toArray();
    if (exact[0]) return exact[0];
    const any = await this.col.find({ email: { $regex: `^${escapeRe(email)}$`, $options: 'i' }, 'yc.emailLower': { $exists: false } }).sort({ lastLogin: -1, _id: 1 }).limit(1).toArray();
    return any[0] ?? null;
  }

  async create(fields: { email?: string; phone?: string; googleSub?: string; displayName?: string }): Promise<UserDoc> {
    const now = new Date();
    const doc: UserDoc = {
      _id: new ObjectId(),
      ...(fields.email ? { email: fields.email } : {}),
      ...(fields.phone ? { phone: fields.phone } : {}),
      createdAt: now,
      yc: {
        joinedAt: now, legacy: false,
        ...(fields.phone ? { phoneE164: fields.phone, phoneVerifiedAt: now } : {}),
        ...(fields.email ? { emailLower: fields.email, emailVerifiedAt: now } : {}),
        ...(fields.googleSub ? { googleSub: fields.googleSub } : {}),
        ...(fields.displayName ? { displayName: fields.displayName.slice(0, 60) } : {}),
      },
    };
    await this.col.insertOne(doc);
    return doc;
  }

  /** Sets v2 fields with $set on `yc.*` only. Marks old accounts as legacy the first time v2 touches them. */
  async setYc(id: ObjectId, fields: Partial<YcFields>, unset: Array<keyof YcFields> = []) {
    const u = await this.byId(id);
    const $set: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(fields)) if (v !== undefined) $set[`yc.${k}`] = v;
    if (u && !u.yc?.joinedAt) { $set['yc.joinedAt'] = new Date(); $set['yc.legacy'] = true; }
    const update: Record<string, unknown> = {};
    if (Object.keys($set).length) update.$set = $set;
    if (unset.length) update.$unset = Object.fromEntries(unset.map((k) => [`yc.${k}`, '']));
    if (!Object.keys(update).length) return u;
    return this.col.findOneAndUpdate({ _id: id }, update, { returnDocument: 'after' });
  }

  /** True when no other account uses this username, in v2 or in the old app. */
  async usernameFree(username: string, selfId?: ObjectId) {
    const re = { $regex: `^${escapeRe(username)}$`, $options: 'i' };
    const other = await this.col.findOne({ $or: [{ 'yc.username': username }, { username: re }], ...(selfId ? { _id: { $ne: selfId } } : {}) }, { projection: { _id: 1 } });
    return !other;
  }
}

export function displayNameOf(u: UserDoc) {
  if (u.yc?.deletedAt) return 'Deleted account';
  return u.yc?.displayName || [u.firstName, u.lastName].filter(Boolean).join(' ').trim() || u.username || (u.email ? u.email.split('@')[0] : '') || 'YaysApp user';
}

export async function toMe(u: UserDoc, photoUrl: (key: string) => Promise<string>): Promise<MeProfile> {
  const yc = u.yc ?? {};
  const pending: MeProfile['pending'] = [];
  if (!yc.emailLower && !u.email) pending.push('link_email');
  if (!yc.phoneE164) pending.push('add_phone');
  if (!yc.displayName && !u.firstName && !u.username) pending.push('profile');
  return {
    id: u._id.toHexString(),
    displayName: displayNameOf(u),
    username: yc.username ?? null,
    about: yc.about ?? '',
    photoUrl: yc.photoKey ? await photoUrl(yc.photoKey) : yc.photoKey === null ? null : (u.profilePic || null),
    phone: yc.phoneE164 ?? null,
    email: yc.emailLower ?? u.email?.toLowerCase() ?? null,
    hasGoogle: !!yc.googleSub,
    createdAt: (yc.joinedAt ?? u.createdAt ?? u._id.getTimestamp()).toISOString(),
    migrated: !!yc.legacy,
    pending,
    twoStep: !!yc.twoStep,
    privacy: privacyOf(u),
    notifications: notifyOf(u),
    preferences: prefsOf(u),
  };
}

export const privacyOf = (u: UserDoc): PrivacySettings => ({ ...DEFAULT_PRIVACY, ...(u.yc?.privacy ?? {}) });
export const prefsOf = (u: UserDoc): AppPreferences => ({ ...DEFAULT_APP_PREFS, ...(u.yc?.prefs ?? {}) });
export const notifyOf = (u: UserDoc): NotificationSettings => ({ ...DEFAULT_NOTIFICATIONS, ...(u.yc?.notify ?? {}), quietHours: { ...DEFAULT_NOTIFICATIONS.quietHours, ...(u.yc?.notify?.quietHours ?? {}) } });

export async function toPublic(u: UserDoc, photoUrl: (key: string) => Promise<string>): Promise<PublicProfile> {
  const yc = u.yc ?? {};
  if (yc.deletedAt) return { id: u._id.toHexString(), displayName: 'Deleted account', username: null, about: '', photoUrl: null };
  return { id: u._id.toHexString(), displayName: displayNameOf(u), username: yc.username ?? null, about: yc.about ?? '', photoUrl: yc.photoKey ? await photoUrl(yc.photoKey) : (u.profilePic || null) };
}
export const USERS = Symbol('USERS');

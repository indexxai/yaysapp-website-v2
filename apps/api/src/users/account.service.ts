import { ObjectId, type Db } from 'mongodb';
import type { AppPreferences, CodeSent, MeProfile, NotificationSettings, PrivacySettings } from '@yays/shared';
import { AppError } from '../common/app-error';
import { C } from '../infra/mongo';
import type { Storage } from '../infra/storage';
import type { RateLimiter } from '../infra/rate-limit';
import { hashPin, pinMatches } from '../auth/auth.service';
import type { OtpService } from '../auth/otp.service';
import type { SessionService } from '../auth/sessions';
import type { ChatService } from '../chat/chat.service';
import type { GroupsService } from '../chat/groups.service';
import type { ChatPrefsService } from '../chat/prefs.service';
import type { PushService } from '../push/push.service';
import { displayNameOf, notifyOf, prefsOf, privacyOf, toMe, type UsersRepo } from './users.repo';

const EXPORT_MESSAGES = 20_000;

/** Two-step PIN, privacy and notification settings, data export and deleting the account. */
export class AccountService {
  constructor(
    private readonly users: UsersRepo, private readonly otp: OtpService, private readonly sessions: SessionService, private readonly chat: ChatService,
    private readonly groups: GroupsService, private readonly prefs: ChatPrefsService, private readonly push: PushService, private readonly storage: Storage,
    private readonly limiter: RateLimiter, private readonly db: Db,
  ) {}
  private photo = (k: string) => this.storage.downloadUrl(k);
  private async me(id: ObjectId) { const u = await this.users.byId(id); if (!u) throw AppError.unauthenticated(); return u; }
  private async checkPin(id: ObjectId, pin: string | undefined, stored: { hash: string; salt: string }) {
    await this.limiter.hit(`pincheck:${id}`, 5, 3600, 'Too many wrong PINs. Try again in an hour.');
    if (!pin || !(await pinMatches(pin, stored))) throw AppError.validation('That PIN is not right.', { fields: { currentPin: 'That PIN is not right.' } });
  }

  async setPin(id: ObjectId, pin: string, currentPin?: string): Promise<MeProfile> {
    const u = await this.me(id);
    if (u.yc?.twoStep) await this.checkPin(id, currentPin, u.yc.twoStep);
    return toMe((await this.users.setYc(id, { twoStep: await hashPin(pin) }))!, this.photo);
  }
  async removePin(id: ObjectId, pin: string): Promise<MeProfile> {
    const u = await this.me(id);
    if (!u.yc?.twoStep) return toMe(u, this.photo);
    await this.checkPin(id, pin, u.yc.twoStep);
    return toMe((await this.users.setYc(id, {}, ['twoStep']))!, this.photo);
  }

  async setPrivacy(id: ObjectId, v: Partial<PrivacySettings>): Promise<MeProfile> {
    const u = await this.me(id);
    const next = { ...privacyOf(u), ...Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined)) };
    const out = (await this.users.setYc(id, { privacy: next }))!;
    this.onPrivacyChanged(id);
    return toMe(out, this.photo);
  }
  /** Set by the app: leaves every community (before the groups). */
  leaveCommunities: (id: ObjectId) => Promise<void> = async () => undefined;
  /** Set by the app: online status watchers re-check what they may see. */
  onPrivacyChanged: (id: ObjectId) => void = () => undefined;

  async setNotifications(id: ObjectId, v: Partial<NotificationSettings>): Promise<MeProfile> {
    const u = await this.me(id);
    const cur = notifyOf(u);
    const next = { ...cur, ...Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined)) } as NotificationSettings;
    return toMe((await this.users.setYc(id, { notify: next }))!, this.photo);
  }

  async setPreferences(id: ObjectId, v: Partial<AppPreferences>): Promise<MeProfile> {
    const u = await this.me(id);
    const next = { ...prefsOf(u), ...Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined)) } as AppPreferences;
    return toMe((await this.users.setYc(id, { prefs: next }))!, this.photo);
  }

  // ---------- delete account ----------
  private target(u: Awaited<ReturnType<AccountService['me']>>) {
    if (u.yc?.phoneE164) return { kind: 'phone' as const, value: u.yc.phoneE164, channel: 'sms' as const };
    const email = u.yc?.emailLower ?? u.email?.toLowerCase();
    if (email) return { kind: 'email' as const, value: email };
    throw AppError.validation('This account has no phone or email to confirm with. Contact support.');
  }
  async startDelete(id: ObjectId, ip: string): Promise<CodeSent> {
    const u = await this.me(id);
    return this.otp.start('delete_account', this.target(u), ip, id.toHexString());
  }

  /**
   * Leaves every group (the longest-standing member takes over where needed), hides every chat, signs out
   * every device and clears the profile. Messages already sent stay for the people who got them, from
   * "Deleted account". The old app's own fields on the account are left alone.
   */
  async delete(id: ObjectId, code: string, reason?: string) {
    const u = await this.me(id);
    await this.otp.verify('delete_account', this.target(u), code, id.toHexString());
    await this.leaveCommunities(id).catch(() => undefined);
    const convs = await this.chat.convs.find({ $or: [{ members: id }, { former: id }] }, { projection: { _id: 1, kind: 1, members: 1 } }).toArray();
    for (const c of convs) {
      if (c.kind === 'group' && c.members.some((m) => m.equals(id))) await this.groups.leave(id, c._id.toHexString()).catch(() => undefined);
      await this.prefs.deleteChat(id, c._id.toHexString()).catch(() => undefined);
    }
    await Promise.all([
      this.chat.stars.deleteMany({ userId: id }),
      this.chat.blocks.deleteMany({ by: id }),
      this.push.subs.deleteMany({ userId: id }),
    ]);
    await this.users.setYc(id, { deletedAt: new Date(), disabledAt: new Date(), photoKey: null },
      ['phoneE164', 'phoneVerifiedAt', 'emailLower', 'emailVerifiedAt', 'googleSub', 'displayName', 'username', 'about', 'twoStep', 'privacy', 'notify', 'prefs', 'facebook', 'socials', 'payPin', 'indexx']);
    await this.db.collection(C.accountDeletions).insertOne({ userId: id, reason: reason?.trim() || null, at: new Date() });
    await this.sessions.revokeAll(id, 'account_deleted');
  }

  // ---------- export ----------
  async export(id: ObjectId) {
    const u = await this.me(id);
    const convs = await this.chat.convs.find({ $or: [{ members: id }, { former: id }] }).toArray();
    const peers = new Map((await this.chat.users.find({ _id: { $in: convs.filter((c) => c.kind === 'direct').flatMap((c) => c.members) } }).toArray()).map((x) => [x._id.toHexString(), displayNameOf(x)]));
    const nameOf = (c: (typeof convs)[number]) => c.kind === 'group' ? c.name ?? 'Group' : peers.get(c.members.find((m) => !m.equals(id))?.toHexString() ?? '') ?? 'Deleted account';
    const names = new Map(convs.map((c) => [c._id.toHexString(), nameOf(c)]));
    const sent = await this.chat.msgs.find({ senderId: id, type: { $in: ['text', 'media', 'poll'] }, deletedAt: { $exists: false } }).sort({ _id: 1 }).limit(EXPORT_MESSAGES).toArray();
    const blocked = await this.chat.blocks.find({ by: id }).toArray();
    return {
      exportedAt: new Date().toISOString(),
      profile: await toMe(u, this.photo),
      chats: convs.map((c) => ({ id: c._id.toHexString(), kind: c.kind, name: names.get(c._id.toHexString()), member: c.members.some((m) => m.equals(id)) })),
      messagesSent: sent.map((m) => ({ chat: names.get(m.convId.toHexString()) ?? '', text: m.text, ...(m.attachment ? { file: m.attachment.name } : {}), at: m.createdAt.toISOString() })),
      messagesSentTruncated: sent.length >= EXPORT_MESSAGES,
      blocked: blocked.map((b) => ({ userId: b.target.toHexString(), name: peers.get(b.target.toHexString()) ?? null, at: b.at.toISOString() })),
      devices: await this.sessions.list(id, ''),
    };
  }
}
export const ACCOUNT = Symbol('ACCOUNT');

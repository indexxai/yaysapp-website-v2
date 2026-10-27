import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'crypto';
import { promisify } from 'util';
import type Redis from 'ioredis';
import { ObjectId } from 'mongodb';
import { ErrorCode, type AuthResult, type CodeSent, type PinRequired, type SignInResult } from '@yays/shared';
import { AppError } from '../common/app-error';
import type { Storage } from '../infra/storage';
import { isDuplicate, toMe, type UserDoc, type UsersRepo } from '../users/users.repo';
import type { GoogleVerifier } from './google';
import type { OtpService } from './otp.service';
import type { DeviceInput, SessionService } from './sessions';
import type { TokenService } from './tokens';

const maskPhone = (p: string) => p.slice(0, 4) + ' ••• ' + p.slice(-3);
const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;
type Via = 'phone' | 'email' | 'google';
const PIN_TRIES = 5;
const PIN_STEP_SECONDS = 600;

/** PINs are stored as scrypt hashes with their own salt. */
export async function hashPin(pin: string) {
  const salt = randomBytes(16);
  return { hash: (await scrypt(pin, salt, 32)).toString('base64'), salt: salt.toString('base64'), setAt: new Date() };
}
export async function pinMatches(pin: string, stored: { hash: string; salt: string }) {
  const got = await scrypt(pin, Buffer.from(stored.salt, 'base64'), 32);
  const want = Buffer.from(stored.hash, 'base64');
  return got.length === want.length && timingSafeEqual(got, want);
}

export class AuthService {
  constructor(
    private readonly users: UsersRepo, private readonly otp: OtpService, private readonly sessions: SessionService,
    private readonly tokens: TokenService, private readonly googleVerifier: GoogleVerifier, private readonly storage: Storage, private readonly redis: Redis,
  ) {}

  private photo = (k: string) => this.storage.downloadUrl(k);

  private async signIn(u: UserDoc, device: DeviceInput, ip: string, isNew: boolean, via: Via): Promise<SignInResult> {
    if (u.yc?.deletedAt) {
      // Signing in after deleting the account starts a fresh profile.
      u = (await this.users.col.findOneAndUpdate({ _id: u._id }, { $unset: { 'yc.deletedAt': '', 'yc.disabledAt': '' }, $set: { 'yc.joinedAt': new Date() } }, { returnDocument: 'after' }))!;
      isNew = true;
    }
    if (u.yc?.disabledAt) throw new AppError(403, ErrorCode.ACCOUNT_DISABLED, 'This account is turned off. Contact support.');
    if (u.yc?.twoStep && !isNew) return this.pinStep(u, device, ip, via);
    return this.finish(u, device, ip, isNew);
  }
  private async finish(u: UserDoc, device: DeviceInput, ip: string, isNew: boolean): Promise<AuthResult> {
    const tokens = await this.sessions.create(u._id, device, ip);
    return { tokens, me: await toMe(u, this.photo), isNew };
  }

  // ---------- two-step verification ----------
  private async pinStep(u: UserDoc, device: DeviceInput, ip: string, via: Via): Promise<PinRequired> {
    const pinToken = randomBytes(24).toString('base64url');
    await this.redis.set(`pin:t:${pinToken}`, JSON.stringify({ uid: u._id.toHexString(), device, ip, via }), 'EX', PIN_STEP_SECONDS);
    return { status: 'pin_required', pinToken, via };
  }
  private async pinRecord(pinToken: string) {
    const raw = await this.redis.get(`pin:t:${pinToken}`);
    if (!raw) throw AppError.unauthenticated('This sign-in step expired. Start again.');
    const rec = JSON.parse(raw) as { uid: string; device: DeviceInput; ip: string; via: Via; target?: { kind: 'phone' | 'email'; value: string } };
    const u = await this.users.byId(new ObjectId(rec.uid));
    if (!u) throw AppError.unauthenticated('This sign-in step expired. Start again.');
    return { rec, u };
  }

  async verifyPin(pinToken: string, pin: string): Promise<AuthResult> {
    const { rec, u } = await this.pinRecord(pinToken);
    const triesKey = `pin:a:${rec.uid}`;
    if (Number(await this.redis.get(triesKey) ?? 0) >= PIN_TRIES) throw new AppError(423, ErrorCode.CODE_LOCKED, 'Too many wrong PINs. Try again in an hour, or reset your PIN.');
    if (!u.yc?.twoStep) return this.finish(u, rec.device, rec.ip, false); // turned off meanwhile
    if (!(await pinMatches(pin, u.yc.twoStep))) {
      const n = await this.redis.incr(triesKey);
      await this.redis.expire(triesKey, 3600);
      const left = PIN_TRIES - n;
      if (left <= 0) throw new AppError(423, ErrorCode.CODE_LOCKED, 'Too many wrong PINs. Try again in an hour, or reset your PIN.');
      throw new AppError(400, ErrorCode.CODE_INVALID, `Wrong PIN. ${left} ${left === 1 ? 'try' : 'tries'} left.`);
    }
    await this.redis.del(`pin:t:${pinToken}`, triesKey);
    return this.finish(u, rec.device, rec.ip, false);
  }

  /** The reset code goes to the other way in: email when you signed in by phone, phone when you used email or Google. */
  async forgotPin(pinToken: string, ip: string): Promise<CodeSent> {
    const { rec, u } = await this.pinRecord(pinToken);
    const email = u.yc?.emailLower ?? u.email?.toLowerCase();
    const phone = u.yc?.phoneE164;
    const target = rec.via === 'phone' ? (email ? { kind: 'email' as const, value: email } : null) : phone ? { kind: 'phone' as const, value: phone } : email ? { kind: 'email' as const, value: email } : null;
    if (!target) throw AppError.validation('This account has no other way to confirm it’s you. Contact support.');
    const sent = await this.otp.start('pin_reset', target.kind === 'phone' ? { ...target, channel: 'sms' } : target, ip, rec.uid);
    await this.redis.set(`pin:t:${pinToken}`, JSON.stringify({ ...rec, target }), 'KEEPTTL');
    return sent;
  }

  async resetPin(pinToken: string, code: string): Promise<AuthResult> {
    const { rec, u } = await this.pinRecord(pinToken);
    if (!rec.target) throw AppError.validation('Ask for a reset code first.');
    await this.otp.verify('pin_reset', rec.target, code, rec.uid);
    await this.users.setYc(u._id, {}, ['twoStep']);
    await this.redis.del(`pin:t:${pinToken}`, `pin:a:${rec.uid}`);
    return this.finish((await this.users.byId(u._id))!, rec.device, rec.ip, false);
  }

  // ---------- phone ----------
  startPhone(phone: string, channel: 'sms' | 'whatsapp', ip: string): Promise<CodeSent> {
    return this.otp.start('phone_login', { kind: 'phone', value: phone, channel }, ip);
  }

  async verifyPhone(phone: string, code: string, device: DeviceInput, ip: string) {
    await this.otp.verify('phone_login', { kind: 'phone', value: phone }, code);
    const u = await this.users.byPhone(phone);
    if (u) { const r = await this.signIn(u, device, ip, false, 'phone'); return 'tokens' in r ? { status: 'signed_in' as const, ...r } : r; }
    // New number: we never link by the old app's unverified `phone` field. The person must prove an email.
    return { status: 'email_required' as const, signupToken: await this.tokens.signup(phone), phone };
  }

  async startSignupEmail(signupToken: string, email: string, ip: string): Promise<CodeSent> {
    const { phone } = await this.tokens.verifySignup(signupToken);
    return this.otp.start('signup_email', { kind: 'email', value: email }, ip, phone);
  }

  async verifySignupEmail(signupToken: string, email: string, code: string, device: DeviceInput, ip: string): Promise<SignInResult> {
    const { phone, jti } = await this.tokens.verifySignup(signupToken);
    if (await this.redis.exists(`signup:used:${jti}`)) throw AppError.unauthenticated('This sign-up step was already completed. Sign in with your phone number.');
    await this.otp.verify('signup_email', { kind: 'email', value: email }, code, phone);
    // The phone may have been claimed by another account while this person was typing.
    const owner = await this.users.byPhone(phone);
    if (owner) {
      const sameAccount = owner.yc?.emailLower === email || owner.email?.toLowerCase() === email;
      if (!sameAccount) throw AppError.conflict('This number is already used by another account.', ErrorCode.PHONE_TAKEN);
      await this.redis.set(`signup:used:${jti}`, '1', 'EX', 1800);
      return this.signIn(owner, device, ip, false, 'phone');
    }
    let u = await this.users.byEmail(email);
    let isNew = false;
    if (u) {
      const existing = u.yc?.phoneE164;
      if (existing && existing !== phone)
        throw AppError.conflict(`This email's account already uses ${maskPhone(existing)}. Sign in with that number, or sign in with email and change your number in Settings.`, ErrorCode.PHONE_TAKEN, { existingPhone: maskPhone(existing) });
      try { u = (await this.users.setYc(u._id, { phoneE164: phone, phoneVerifiedAt: new Date(), emailLower: email, emailVerifiedAt: new Date() }))!; }
      catch (e) { if (isDuplicate(e)) throw AppError.conflict('This number or email is already used by another account.', ErrorCode.PHONE_TAKEN); throw e; }
    } else {
      try { u = await this.users.create({ email, phone }); isNew = true; }
      catch (e) {
        if (!isDuplicate(e)) throw e;
        // Someone finished the same sign-up a moment ago (double tap, two devices): sign in to that account.
        u = (await this.users.byEmail(email)) ?? (await this.users.byPhone(phone));
        if (!u || u.yc?.phoneE164 !== phone) throw AppError.conflict('This number or email is already used by another account.', ErrorCode.PHONE_TAKEN);
      }
    }
    await this.redis.set(`signup:used:${jti}`, '1', 'EX', 1800);
    return this.signIn(u, device, ip, isNew, 'phone');
  }

  // ---------- email ----------
  startEmail(email: string, ip: string) { return this.otp.start('email_login', { kind: 'email', value: email }, ip); }

  async verifyEmail(email: string, code: string, device: DeviceInput, ip: string): Promise<SignInResult> {
    await this.otp.verify('email_login', { kind: 'email', value: email }, code);
    let u = await this.users.byEmail(email);
    if (u) {
      if (!u.yc?.emailLower) {
        try { u = (await this.users.setYc(u._id, { emailLower: email, emailVerifiedAt: new Date() }))!; }
        catch (e) { if (!isDuplicate(e)) throw e; u = (await this.users.byEmail(email))!; }
      }
      return this.signIn(u, device, ip, false, 'email');
    }
    try { u = await this.users.create({ email }); return this.signIn(u, device, ip, true, 'email'); }
    catch (e) { if (!isDuplicate(e)) throw e; return this.signIn((await this.users.byEmail(email))!, device, ip, false, 'email'); }
  }

  // ---------- google ----------
  async google(idToken: string, device: DeviceInput, ip: string): Promise<SignInResult> {
    const g = await this.googleVerifier.verify(idToken);
    let u = await this.users.byGoogleSub(g.sub);
    if (u) return this.signIn(u, device, ip, false, 'google');
    u = await this.users.byEmail(g.email);
    if (u) {
      if (u.yc?.googleSub && u.yc.googleSub !== g.sub) throw AppError.conflict('This email is linked to a different Google account.');
      try { u = (await this.users.setYc(u._id, { googleSub: g.sub, emailLower: g.email, emailVerifiedAt: u.yc?.emailVerifiedAt ?? new Date() }))!; }
      catch (e) { if (!isDuplicate(e)) throw e; u = (await this.users.byGoogleSub(g.sub))!; }
      return this.signIn(u, device, ip, false, 'google');
    }
    try { u = await this.users.create({ email: g.email, googleSub: g.sub, displayName: g.name }); return this.signIn(u, device, ip, true, 'google'); }
    catch (e) { if (!isDuplicate(e)) throw e; return this.signIn((await this.users.byGoogleSub(g.sub)) ?? (await this.users.byEmail(g.email))!, device, ip, false, 'google'); }
  }

  // ---------- add or change phone while signed in ----------
  async startAddPhone(userId: ObjectId, phone: string, channel: 'sms' | 'whatsapp', ip: string) {
    const owner = await this.users.byPhone(phone);
    if (owner && !owner._id.equals(userId)) throw AppError.conflict('This number is already used by another account.', ErrorCode.PHONE_TAKEN);
    if (owner) throw AppError.conflict('This is already your number.');
    return this.otp.start('add_phone', { kind: 'phone', value: phone, channel }, ip, userId.toHexString());
  }
  async verifyAddPhone(userId: ObjectId, phone: string, code: string) {
    await this.otp.verify('add_phone', { kind: 'phone', value: phone }, code, userId.toHexString());
    try { return (await this.users.setYc(userId, { phoneE164: phone, phoneVerifiedAt: new Date() }))!; }
    catch (e) { if (isDuplicate(e)) throw AppError.conflict('This number is already used by another account.', ErrorCode.PHONE_TAKEN); throw e; }
  }
}
export const AUTH = Symbol('AUTH');

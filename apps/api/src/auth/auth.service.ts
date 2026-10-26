import type Redis from 'ioredis';
import type { ObjectId } from 'mongodb';
import { ErrorCode, type AuthResult, type CodeSent } from '@yays/shared';
import { AppError } from '../common/app-error';
import type { Storage } from '../infra/storage';
import { isDuplicate, toMe, type UserDoc, type UsersRepo } from '../users/users.repo';
import type { GoogleVerifier } from './google';
import type { OtpService } from './otp.service';
import type { DeviceInput, SessionService } from './sessions';
import type { TokenService } from './tokens';

const maskPhone = (p: string) => p.slice(0, 4) + ' ••• ' + p.slice(-3);

export class AuthService {
  constructor(
    private readonly users: UsersRepo, private readonly otp: OtpService, private readonly sessions: SessionService,
    private readonly tokens: TokenService, private readonly googleVerifier: GoogleVerifier, private readonly storage: Storage, private readonly redis: Redis,
  ) {}

  private photo = (k: string) => this.storage.downloadUrl(k);

  private async signIn(u: UserDoc, device: DeviceInput, ip: string, isNew: boolean): Promise<AuthResult> {
    if (u.yc?.disabledAt) throw new AppError(403, ErrorCode.ACCOUNT_DISABLED, 'This account is turned off. Contact support.');
    const tokens = await this.sessions.create(u._id, device, ip);
    return { tokens, me: await toMe(u, this.photo), isNew };
  }

  // ---------- phone ----------
  startPhone(phone: string, channel: 'sms' | 'whatsapp', ip: string): Promise<CodeSent> {
    return this.otp.start('phone_login', { kind: 'phone', value: phone, channel }, ip);
  }

  async verifyPhone(phone: string, code: string, device: DeviceInput, ip: string) {
    await this.otp.verify('phone_login', { kind: 'phone', value: phone }, code);
    const u = await this.users.byPhone(phone);
    if (u) return { status: 'signed_in' as const, ...(await this.signIn(u, device, ip, false)) };
    // New number: we never link by the old app's unverified `phone` field. The person must prove an email.
    return { status: 'email_required' as const, signupToken: await this.tokens.signup(phone), phone };
  }

  async startSignupEmail(signupToken: string, email: string, ip: string): Promise<CodeSent> {
    const { phone } = await this.tokens.verifySignup(signupToken);
    return this.otp.start('signup_email', { kind: 'email', value: email }, ip, phone);
  }

  async verifySignupEmail(signupToken: string, email: string, code: string, device: DeviceInput, ip: string): Promise<AuthResult> {
    const { phone, jti } = await this.tokens.verifySignup(signupToken);
    if (await this.redis.exists(`signup:used:${jti}`)) throw AppError.unauthenticated('This sign-up step was already completed. Sign in with your phone number.');
    await this.otp.verify('signup_email', { kind: 'email', value: email }, code, phone);
    // The phone may have been claimed by another account while this person was typing.
    const owner = await this.users.byPhone(phone);
    if (owner) {
      const sameAccount = owner.yc?.emailLower === email || owner.email?.toLowerCase() === email;
      if (!sameAccount) throw AppError.conflict('This number is already used by another account.', ErrorCode.PHONE_TAKEN);
      await this.redis.set(`signup:used:${jti}`, '1', 'EX', 1800);
      return this.signIn(owner, device, ip, false);
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
    return this.signIn(u, device, ip, isNew);
  }

  // ---------- email ----------
  startEmail(email: string, ip: string) { return this.otp.start('email_login', { kind: 'email', value: email }, ip); }

  async verifyEmail(email: string, code: string, device: DeviceInput, ip: string): Promise<AuthResult> {
    await this.otp.verify('email_login', { kind: 'email', value: email }, code);
    let u = await this.users.byEmail(email);
    if (u) {
      if (!u.yc?.emailLower) {
        try { u = (await this.users.setYc(u._id, { emailLower: email, emailVerifiedAt: new Date() }))!; }
        catch (e) { if (!isDuplicate(e)) throw e; u = (await this.users.byEmail(email))!; }
      }
      return this.signIn(u, device, ip, false);
    }
    try { u = await this.users.create({ email }); return this.signIn(u, device, ip, true); }
    catch (e) { if (!isDuplicate(e)) throw e; return this.signIn((await this.users.byEmail(email))!, device, ip, false); }
  }

  // ---------- google ----------
  async google(idToken: string, device: DeviceInput, ip: string): Promise<AuthResult> {
    const g = await this.googleVerifier.verify(idToken);
    let u = await this.users.byGoogleSub(g.sub);
    if (u) return this.signIn(u, device, ip, false);
    u = await this.users.byEmail(g.email);
    if (u) {
      if (u.yc?.googleSub && u.yc.googleSub !== g.sub) throw AppError.conflict('This email is linked to a different Google account.');
      try { u = (await this.users.setYc(u._id, { googleSub: g.sub, emailLower: g.email, emailVerifiedAt: u.yc?.emailVerifiedAt ?? new Date() }))!; }
      catch (e) { if (!isDuplicate(e)) throw e; u = (await this.users.byGoogleSub(g.sub))!; }
      return this.signIn(u, device, ip, false);
    }
    try { u = await this.users.create({ email: g.email, googleSub: g.sub, displayName: g.name }); return this.signIn(u, device, ip, true); }
    catch (e) { if (!isDuplicate(e)) throw e; return this.signIn((await this.users.byGoogleSub(g.sub)) ?? (await this.users.byEmail(g.email))!, device, ip, false); }
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

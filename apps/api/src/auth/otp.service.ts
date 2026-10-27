import { createHmac, randomInt, timingSafeEqual } from 'crypto';
import type Redis from 'ioredis';
import { ErrorCode, type CodeSent } from '@yays/shared';
import { AppError } from '../common/app-error';
import type { Config } from '../config';
import type { RateLimiter } from '../infra/rate-limit';
import type { EmailSender, PhoneSender } from './senders';

export type OtpPurpose = 'phone_login' | 'email_login' | 'signup_email' | 'add_phone' | 'pin_reset' | 'delete_account';
type Target = { kind: 'phone'; value: string; channel: 'sms' | 'whatsapp' } | { kind: 'email'; value: string };

const mask = (t: Target) => t.kind === 'phone'
  ? t.value.slice(0, 4) + ' ••• ' + t.value.slice(-3)
  : t.value.replace(/^(.)(.*)(@.*)$/, (_m, a: string, b: string, d: string) => a + '•'.repeat(Math.min(b.length, 6)) + d);

/**
 * One-time codes. Rules: a code lives OTP_TTL_SECONDS; resend waits OTP_RESEND_SECONDS;
 * OTP_MAX_ATTEMPTS wrong tries lock that code; 5 sends per target per hour; 30 per IP per hour.
 * `scope` ties a code to who asked for it (e.g. the signed-in user adding a phone).
 */
export class OtpService {
  constructor(private readonly redis: Redis, private readonly c: Config, private readonly limiter: RateLimiter, private readonly phone: PhoneSender, private readonly email: EmailSender) {}

  private k(p: OtpPurpose, target: string, scope: string) { return `otp:${p}:${scope}:${target}`; }
  private hash(p: OtpPurpose, target: string, scope: string, code: string) { return createHmac('sha256', this.c.JWT_SECRET).update(`${p}|${scope}|${target}|${code}`).digest(); }

  async start(p: OtpPurpose, t: Target, ip: string, scope = '-'): Promise<CodeSent> {
    const key = this.k(p, t.value, scope);
    const cooldown = await this.redis.pttl(`${key}:cd`);
    if (cooldown > 0) throw AppError.rateLimited(Math.ceil(cooldown / 1000), `Wait ${Math.ceil(cooldown / 1000)} seconds before asking for another code.`);
    await this.limiter.hit(`otp:t:${t.value}`, 5, 3600, 'Too many codes for this address in the last hour. Try again later.');
    await this.limiter.hit(`otp:ip:${ip}`, this.c.OTP_IP_PER_HOUR, 3600);
    const managed = t.kind === 'phone' && this.phone.managesCodes;
    const code = managed ? undefined : String(randomInt(0, 1_000_000)).padStart(6, '0');
    // Send first: a failed send must not burn the cooldown or replace a code the person already has.
    if (t.kind === 'phone') await this.phone.send(t.value, t.channel, code);
    else await this.email.send(t.value, `${code} is your YaysApp code`, `Your YaysApp code is ${code}. It expires in ${Math.round(this.c.OTP_TTL_SECONDS / 60)} minutes. If you didn't ask for it, ignore this email.`, code!);
    const ttl = this.c.OTP_TTL_SECONDS;
    const tx = this.redis.multi()
      .del(key)
      .hset(key, { h: code ? this.hash(p, t.value, scope, code).toString('base64') : 'managed', a: '0' })
      .expire(key, ttl)
      .del(`${key}:lock`);
    if (this.c.OTP_RESEND_SECONDS > 0) tx.set(`${key}:cd`, '1', 'EX', this.c.OTP_RESEND_SECONDS);
    await tx.exec();
    return { sentTo: mask(t), channel: t.kind === 'phone' ? t.channel : 'email', expiresInSeconds: ttl, resendInSeconds: this.c.OTP_RESEND_SECONDS };
  }

  /** Resolves when the code is right; throws CODE_INVALID / CODE_EXPIRED / CODE_LOCKED otherwise. Single use. */
  async verify(p: OtpPurpose, t: { kind: 'phone' | 'email'; value: string }, code: string, scope = '-'): Promise<void> {
    const key = this.k(p, t.value, scope);
    if (await this.redis.exists(`${key}:lock`)) throw new AppError(423, ErrorCode.CODE_LOCKED, 'Too many wrong codes. Ask for a new code.');
    const rec = await this.redis.hgetall(key);
    if (!rec.h) throw new AppError(410, ErrorCode.CODE_EXPIRED, 'This code expired. Ask for a new one.');
    let ok: boolean;
    if (rec.h === 'managed') ok = !!(await this.phone.check?.(t.value, code));
    else {
      const want = Buffer.from(rec.h, 'base64');
      const got = this.hash(p, t.value, scope, code);
      ok = want.length === got.length && timingSafeEqual(want, got);
    }
    if (ok) {
      // Delete atomically; if two requests race with the right code only the first wins.
      const deleted = await this.redis.del(key);
      if (deleted === 0) throw new AppError(410, ErrorCode.CODE_EXPIRED, 'This code was already used. Ask for a new one.');
      await this.redis.del(`${key}:cd`);
      return;
    }
    const attempts = await this.redis.hincrby(key, 'a', 1);
    if (attempts >= this.c.OTP_MAX_ATTEMPTS) {
      await this.redis.multi().del(key).set(`${key}:lock`, '1', 'EX', this.c.OTP_TTL_SECONDS).exec();
      throw new AppError(423, ErrorCode.CODE_LOCKED, 'Too many wrong codes. Ask for a new code.');
    }
    const left = this.c.OTP_MAX_ATTEMPTS - attempts;
    throw new AppError(400, ErrorCode.CODE_INVALID, `That code isn't right. ${left} ${left === 1 ? 'try' : 'tries'} left.`, { attemptsLeft: left });
  }
}
export const OTP = Symbol('OTP');

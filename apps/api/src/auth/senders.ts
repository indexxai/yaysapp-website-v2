import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import type Redis from 'ioredis';
import twilio from 'twilio';
import { ErrorCode } from '@yays/shared';
import { AppError } from '../common/app-error';
import type { Config } from '../config';
import type { Logger } from '../common/logger';

export interface OutboxMessage { to: string; channel: 'sms' | 'whatsapp' | 'email'; code?: string; text: string; at: string }

/** Dev/test only: keeps the last messages per recipient in Redis so tests and local runs can read the code. */
export class Outbox {
  constructor(private readonly redis: Redis) {}
  async push(m: OutboxMessage) { await this.redis.multi().lpush(`outbox:${m.to}`, JSON.stringify(m)).ltrim(`outbox:${m.to}`, 0, 19).expire(`outbox:${m.to}`, 3600).exec(); }
  async last(to: string): Promise<OutboxMessage | null> { const v = await this.redis.lindex(`outbox:${to}`, 0); return v ? (JSON.parse(v) as OutboxMessage) : null; }
  async all(to: string): Promise<OutboxMessage[]> { return (await this.redis.lrange(`outbox:${to}`, 0, -1)).map((v) => JSON.parse(v) as OutboxMessage); }
}

/** Sends the phone code. Twilio Verify makes and checks its own codes; the dev driver uses ours. */
export interface PhoneSender {
  readonly managesCodes: boolean;
  send(phone: string, channel: 'sms' | 'whatsapp', code?: string): Promise<void>;
  check?(phone: string, code: string): Promise<boolean>;
}

export class DevPhoneSender implements PhoneSender {
  readonly managesCodes = false;
  constructor(private readonly outbox: Outbox, private readonly log: Logger) {}
  async send(phone: string, channel: 'sms' | 'whatsapp', code?: string) {
    await this.outbox.push({ to: phone, channel, code, text: `Your YaysApp code is ${code}`, at: new Date().toISOString() });
    this.log.info({ to: phone, channel }, 'dev sms queued in outbox');
  }
}

export class TwilioPhoneSender implements PhoneSender {
  readonly managesCodes = true;
  private client: twilio.Twilio;
  constructor(sid: string, token: string, private readonly serviceSid: string) { this.client = twilio(sid, token); }
  private fail(e: unknown): never {
    const status = (e as { status?: number }).status;
    const code = (e as { code?: number }).code;
    if (code === 60200 || code === 21211 || code === 21614) throw AppError.validation('That number can\'t receive codes. Check it and try again.');
    if (code === 60203 || status === 429) throw AppError.rateLimited(600, 'Too many codes sent to this number. Try again in 10 minutes.');
    throw new AppError(503, ErrorCode.PROVIDER_UNAVAILABLE, "We couldn't send the code right now. Try again in a minute.");
  }
  async send(phone: string, channel: 'sms' | 'whatsapp') {
    try { await this.client.verify.v2.services(this.serviceSid).verifications.create({ to: phone, channel }); } catch (e) { this.fail(e); }
  }
  async check(phone: string, code: string) {
    try {
      const r = await this.client.verify.v2.services(this.serviceSid).verificationChecks.create({ to: phone, code });
      return r.status === 'approved';
    } catch (e) {
      if ((e as { status?: number }).status === 404) return false; // Twilio expired or never sent it
      this.fail(e);
    }
  }
}

export interface EmailSender { send(to: string, subject: string, text: string, code: string): Promise<void> }

export class DevEmailSender implements EmailSender {
  constructor(private readonly outbox: Outbox) {}
  async send(to: string, _subject: string, text: string, code: string) { await this.outbox.push({ to, channel: 'email', code, text, at: new Date().toISOString() }); }
}

export class SesEmailSender implements EmailSender {
  private ses: SESv2Client;
  constructor(region: string, private readonly from: string) { this.ses = new SESv2Client({ region }); }
  async send(to: string, subject: string, text: string) {
    try {
      await this.ses.send(new SendEmailCommand({ FromEmailAddress: this.from, Destination: { ToAddresses: [to] }, Content: { Simple: { Subject: { Data: subject }, Body: { Text: { Data: text } } } } }));
    } catch {
      throw new AppError(503, ErrorCode.PROVIDER_UNAVAILABLE, "We couldn't send the email right now. Try again in a minute.");
    }
  }
}

export const PHONE_SENDER = Symbol('PHONE_SENDER');
export const EMAIL_SENDER = Symbol('EMAIL_SENDER');
export const OUTBOX = Symbol('OUTBOX');

export function createSenders(c: Config, redis: Redis, log: Logger) {
  const outbox = new Outbox(redis);
  const phone: PhoneSender = c.SMS_DRIVER === 'twilio' ? new TwilioPhoneSender(c.TWILIO_ACCOUNT_SID!, c.TWILIO_AUTH_TOKEN!, c.TWILIO_VERIFY_SID!) : new DevPhoneSender(outbox, log);
  const email: EmailSender = c.EMAIL_DRIVER === 'ses' ? new SesEmailSender(c.SES_REGION!, c.SES_FROM!) : new DevEmailSender(outbox);
  return { outbox, phone, email };
}

import { z } from 'zod';
import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js/max';

/** Normalises any typed phone number to E.164 (+923001234567). Returns null when it isn't a real mobile-capable number. */
export function normalizePhone(input: string, defaultCountry: CountryCode = 'PK'): string | null {
  if (typeof input !== 'string') return null;
  const cleaned = input.trim().replace(/^00/, '+');
  if (cleaned.length < 4 || cleaned.length > 24) return null;
  const p = parsePhoneNumberFromString(cleaned, defaultCountry);
  if (!p || !p.isValid()) return null;
  const type = p.getType();
  if (type && !['MOBILE', 'FIXED_LINE_OR_MOBILE', 'PERSONAL_NUMBER', 'VOIP'].includes(type)) return null;
  return p.number;
}

export function normalizeEmail(input: string): string | null {
  if (typeof input !== 'string') return null;
  const e = input.trim().toLowerCase();
  if (e.length > 254) return null;
  return z.string().email().safeParse(e).success ? e : null;
}

export const phoneSchema = z.string().transform((v, ctx) => {
  const n = normalizePhone(v);
  if (!n) { ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Enter a valid mobile number with country code.' }); return z.NEVER; }
  return n;
});
export const emailSchema = z.string().transform((v, ctx) => {
  const n = normalizeEmail(v);
  if (!n) { ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Enter a valid email address.' }); return z.NEVER; }
  return n;
});
export const codeSchema = z.string().trim().regex(/^\d{6}$/, 'The code has 6 digits.');
export const deviceSchema = z.object({
  deviceId: z.string().trim().min(8).max(128),
  platform: z.enum(['ios', 'android', 'web']),
  name: z.string().trim().max(80).optional(),
  appVersion: z.string().trim().max(32).optional(),
});

/** Usernames: 3–30 chars, lowercase letters, digits, dots and underscores; no dot at the ends or twice in a row. */
export const USERNAME_RE = /^(?!.*\.\.)(?![.])[a-z0-9._]{3,30}(?<![.])$/;
export const profileSchema = z.object({
  displayName: z.string().trim().min(1, 'Your name is needed.').max(60).optional(),
  username: z.string().trim().toLowerCase().regex(USERNAME_RE, 'Use 3–30 letters, numbers, dots or underscores.').optional(),
  about: z.string().trim().max(80).optional(),
  photoKey: z.string().trim().max(512).nullable().optional(),
});

export const phoneStartSchema = z.object({ phone: phoneSchema, channel: z.enum(['sms', 'whatsapp']).default('sms') });
export const phoneVerifySchema = z.object({ phone: phoneSchema, code: codeSchema, device: deviceSchema });
export const emailStartSchema = z.object({ email: emailSchema });
export const emailVerifySchema = z.object({ email: emailSchema, code: codeSchema, device: deviceSchema });
export const googleSchema = z.object({ idToken: z.string().min(20).max(4096), device: deviceSchema });
export const linkEmailStartSchema = z.object({ email: emailSchema });
export const linkEmailVerifySchema = z.object({ email: emailSchema, code: codeSchema });
export const addPhoneStartSchema = phoneStartSchema;
export const addPhoneVerifySchema = z.object({ phone: phoneSchema, code: codeSchema });
export const refreshSchema = z.object({ refreshToken: z.string().min(20).max(4096) });
export const contactsMatchSchema = z.object({ phones: z.array(z.string().max(32)).max(5000) });

// ---- two-step verification, account, privacy, notifications ----
/** Six digits, like WhatsApp; never all the same digit or a straight run. */
export const pinSchema = z.string().regex(/^\d{6}$/, 'The PIN has 6 digits.')
  .refine((p) => !/^(\d)\1{5}$/.test(p) && !'0123456789'.includes(p) && !'9876543210'.includes(p), 'Pick a PIN that is harder to guess.');
export const setPinSchema = z.object({ pin: pinSchema, currentPin: z.string().regex(/^\d{6}$/).optional() });
export const pinCheckSchema = z.object({ pin: z.string().regex(/^\d{6}$/, 'The PIN has 6 digits.') });
export const pinSignInSchema = z.object({ pinToken: z.string().min(20).max(200), pin: z.string().regex(/^\d{6}$/, 'The PIN has 6 digits.') });
export const pinForgotSchema = z.object({ pinToken: z.string().min(20).max(200) });
export const pinResetSchema = z.object({ pinToken: z.string().min(20).max(200), code: codeSchema });
export const deleteAccountSchema = z.object({ code: codeSchema, reason: z.string().max(200).optional() });

const audience = z.enum(['everyone', 'contacts', 'nobody']);
export const privacySchema = z.object({
  lastSeen: audience.optional(), photo: audience.optional(), about: audience.optional(),
  groups: z.enum(['everyone', 'contacts']).optional(), readReceipts: z.boolean().optional(),
}).refine((v) => Object.values(v).some((x) => x !== undefined), 'Nothing to change.');
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use a time like 23:00.');
export const notificationsSchema = z.object({
  preview: z.boolean().optional(), groups: z.boolean().optional(),
  quietHours: z.object({ on: z.boolean(), from: hhmm, to: hhmm }).optional(),
  timeZone: z.string().max(64).refine((tz) => { try { new Intl.DateTimeFormat('en', { timeZone: tz }); return true; } catch { return false; } }, 'Unknown time zone.').optional(),
}).refine((v) => Object.values(v).some((x) => x !== undefined), 'Nothing to change.');
export const problemReportSchema = z.object({
  text: z.string().trim().min(10, 'Tell us a bit more (at least 10 characters).').max(2000),
  screenshotKey: z.string().max(512).optional(), userAgent: z.string().max(400).optional(), appVersion: z.string().max(40).optional(), page: z.string().max(200).optional(),
});

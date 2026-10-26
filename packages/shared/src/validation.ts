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

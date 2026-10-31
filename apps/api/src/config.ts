import { z } from 'zod';

const bool = z.enum(['0', '1', 'true', 'false']).transform((v) => v === '1' || v === 'true');
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(0).max(65535).default(4000),
  PUBLIC_URL: z.string().url().default('http://localhost:4000'),
  CORS_ORIGINS: z.string().default('http://localhost:3000'),
  MONGO_URI: z.string().min(1),
  MONGO_DB: z.string().min(1).default('yaychat'),
  /** Create indexes on the shared `users` collection at boot. Off in production: run `pnpm db:indexes` deliberately. */
  USERS_INDEXES_ON_BOOT: bool.default('true'),
  REDIS_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  ACCESS_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
  REFRESH_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(60),
  OTP_TTL_SECONDS: z.coerce.number().int().min(60).max(1800).default(600),
  OTP_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(5),
  /** Codes one IP address may request per hour (all numbers and emails together). */
  OTP_IP_PER_HOUR: z.coerce.number().int().min(1).max(100000).default(30),
  OTP_RESEND_SECONDS: z.coerce.number().int().min(0).max(300).default(30),
  SMS_DRIVER: z.enum(['dev', 'twilio']).default('dev'),
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_VERIFY_SID: z.string().optional(),
  EMAIL_DRIVER: z.enum(['dev', 'ses']).default('dev'),
  SES_REGION: z.string().optional(),
  SES_FROM: z.string().optional(),
  GOOGLE_DRIVER: z.enum(['dev', 'google']).default('dev'),
  GOOGLE_CLIENT_IDS: z.string().default(''),
  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  LOCAL_STORAGE_DIR: z.string().default('.data/storage'),
  S3_BUCKET: z.string().optional(),
  S3_REGION: z.string().optional(),
  SENTRY_DSN: z.string().optional(),
  /** dev: pushes are kept in Redis for tests. webpush: real Web Push with the VAPID keys below. */
  PUSH_DRIVER: z.enum(['dev', 'webpush']).default('dev'),
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().default('mailto:support@yays.app'),
  /** Tests only: accept a self-signed certificate from a stand-in push service. Refused in production. */
  PUSH_INSECURE_TLS: bool.default('false'),
  /** LiveKit, for voice and video calls. Without these, starting a call says calls aren't available. */
  LIVEKIT_URL: z.string().optional(),
  /** Where this server reaches LiveKit's API, if not the same host as LIVEKIT_URL. */
  LIVEKIT_API_URL: z.string().optional(),
  LIVEKIT_API_KEY: z.string().optional(),
  LIVEKIT_API_SECRET: z.string().optional(),
  /** How long a call rings before it counts as missed. */
  CALL_RING_SECONDS: z.coerce.number().int().min(2).max(120).default(45),
  /** Jack's AI. dev: answers without a model (development and tests). anthropic: Claude, with ANTHROPIC_API_KEY. */
  AI_DRIVER: z.enum(['dev', 'anthropic']).default('dev'),
  ANTHROPIC_API_KEY: z.string().optional(),
  AI_MODEL: z.string().default('claude-sonnet-5-5'),
  /** Indexx accounts (BTCY, Indexx Pay, EMMM). dev: a stand-in kept in this database. off: linking isn't offered. */
  INDEXX_DRIVER: z.enum(['dev', 'off']).default('dev'),
  TEST_OUTBOX: bool.default('false'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

export type Config = z.infer<typeof schema> & { corsOrigins: string[]; googleClientIds: string[]; version: string };

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid configuration:\n${lines}`);
  }
  const c = parsed.data;
  const problems: string[] = [];
  if (c.NODE_ENV === 'production') {
    if (c.SMS_DRIVER === 'dev') problems.push('SMS_DRIVER=dev is not allowed in production');
    if (c.EMAIL_DRIVER === 'dev') problems.push('EMAIL_DRIVER=dev is not allowed in production');
    if (c.GOOGLE_DRIVER === 'dev') problems.push('GOOGLE_DRIVER=dev is not allowed in production');
    if (c.STORAGE_DRIVER === 'local') problems.push('STORAGE_DRIVER=local is not allowed in production');
    if (c.TEST_OUTBOX) problems.push('TEST_OUTBOX must be off in production');
    if (c.PUSH_DRIVER === 'dev') problems.push('PUSH_DRIVER=dev is not allowed in production');
    if (c.PUSH_INSECURE_TLS) problems.push('PUSH_INSECURE_TLS must be off in production');
    if (c.AI_DRIVER === 'dev') problems.push('AI_DRIVER=dev is not allowed in production (use anthropic)');
    if (c.INDEXX_DRIVER === 'dev') problems.push('INDEXX_DRIVER=dev is not allowed in production (use off until the Indexx API is connected)');
  }
  if (c.SMS_DRIVER === 'twilio' && !(c.TWILIO_ACCOUNT_SID && c.TWILIO_AUTH_TOKEN && c.TWILIO_VERIFY_SID)) problems.push('SMS_DRIVER=twilio needs TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_VERIFY_SID');
  if (c.EMAIL_DRIVER === 'ses' && !(c.SES_REGION && c.SES_FROM)) problems.push('EMAIL_DRIVER=ses needs SES_REGION and SES_FROM');
  if (c.STORAGE_DRIVER === 's3' && !(c.S3_BUCKET && c.S3_REGION)) problems.push('STORAGE_DRIVER=s3 needs S3_BUCKET and S3_REGION');
  if (c.PUSH_DRIVER === 'webpush' && c.NODE_ENV === 'production' && !(c.VAPID_PUBLIC_KEY && c.VAPID_PRIVATE_KEY)) problems.push('PUSH_DRIVER=webpush needs VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY (npx web-push generate-vapid-keys)');
  if (c.LIVEKIT_URL && !(c.LIVEKIT_API_KEY && c.LIVEKIT_API_SECRET)) problems.push('LIVEKIT_URL needs LIVEKIT_API_KEY and LIVEKIT_API_SECRET');
  if (c.NODE_ENV === 'production' && c.LIVEKIT_API_SECRET && c.LIVEKIT_API_SECRET.length < 32) problems.push('LIVEKIT_API_SECRET must be at least 32 characters in production');
  if (c.AI_DRIVER === 'anthropic' && !c.ANTHROPIC_API_KEY) problems.push('AI_DRIVER=anthropic needs ANTHROPIC_API_KEY');
  if (c.GOOGLE_DRIVER === 'google' && !c.GOOGLE_CLIENT_IDS) problems.push('GOOGLE_DRIVER=google needs GOOGLE_CLIENT_IDS');
  if (problems.length) throw new Error(`Invalid configuration:\n  ${problems.join('\n  ')}`);
  return {
    ...c,
    corsOrigins: c.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean),
    googleClientIds: c.GOOGLE_CLIENT_IDS.split(',').map((s) => s.trim()).filter(Boolean),
    version: process.env.npm_package_version ?? '0.1.0',
  };
}

export const CONFIG = Symbol('CONFIG');

import { z } from 'zod';

const bool = z.enum(['0', '1', 'true', 'false']).transform((v) => v === '1' || v === 'true');
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(0).max(65535).default(4000),
  PUBLIC_URL: z.string().url().default('http://localhost:4000'),
  /** Sites allowed to call the API from a browser: the web app, and the website (its Ask Jack assistant). */
  CORS_ORIGINS: z.string().default('http://localhost:3000,http://localhost:3200'),
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
  /** Keys for sending email only. Without them, SES uses the server's AWS keys or IAM role (the same as S3). */
  SES_ACCESS_KEY_ID: z.string().optional(),
  SES_SECRET_ACCESS_KEY: z.string().optional(),
  GOOGLE_DRIVER: z.enum(['dev', 'google']).default('dev'),
  GOOGLE_CLIENT_IDS: z.string().default(''),
  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  LOCAL_STORAGE_DIR: z.string().default('.data/storage'),
  S3_BUCKET: z.string().optional(),
  S3_REGION: z.string().optional(),
  SENTRY_DSN: z.string().optional(),
  /** dev: pushes are kept in Redis for tests. webpush: real delivery (Web Push with the VAPID keys below, and phones with the keys after). */
  PUSH_DRIVER: z.enum(['dev', 'webpush']).default('dev'),
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().default('mailto:support@yays.app'),
  /** Tests only: accept a self-signed certificate from a stand-in push service. Refused in production. */
  PUSH_INSECURE_TLS: bool.default('false'),
  /**
   * Phones. Android: Firebase Cloud Messaging, with a Firebase service account (Firebase console › Project settings ›
   * Service accounts › Generate new private key): the JSON itself, or the path to the file. iPhone: Apple's push
   * service with an APNs auth key (.p8) from developer.apple.com › Keys. Without them, phones get no notifications
   * (with PUSH_DRIVER=dev they're recorded for tests, as for browsers).
   */
  FCM_SERVICE_ACCOUNT_JSON: z.string().optional(),
  FCM_SERVICE_ACCOUNT_FILE: z.string().optional(),
  /** Tests only: a stand-in for Google's push and sign-in addresses. */
  FCM_API_URL: z.string().url().default('https://fcm.googleapis.com'),
  APNS_KEY: z.string().optional(),
  APNS_KEY_FILE: z.string().optional(),
  APNS_KEY_ID: z.string().optional(),
  APNS_TEAM_ID: z.string().optional(),
  APNS_BUNDLE_ID: z.string().default('com.indexx.yaysapp'),
  /** Tests only: a stand-in for Apple's push service (otherwise api.push.apple.com, or the sandbox for debug builds). */
  APNS_HOST: z.string().url().optional(),
  /** The phone app's link scheme: Facebook sign-in started in the app comes back to yaysapp://… */
  APP_SCHEME: z.string().regex(/^[a-z][a-z0-9+.-]*$/).default('yaysapp'),
  /** LiveKit, for voice and video calls. Without these, starting a call says calls aren't available. */
  LIVEKIT_URL: z.string().optional(),
  /** Where this server reaches LiveKit's API, if not the same host as LIVEKIT_URL. */
  LIVEKIT_API_URL: z.string().optional(),
  LIVEKIT_API_KEY: z.string().optional(),
  LIVEKIT_API_SECRET: z.string().optional(),
  /** How long a call rings before it counts as missed. */
  CALL_RING_SECONDS: z.coerce.number().int().min(2).max(120).default(45),
  /**
   * Jack's AI (the light version inside YaysApp). Talking, documents and web answers:
   *   dev: sample answers without a model (development and tests); openrouter: OPENROUTER_API_KEY;
   *   openai: OPENAI_API_KEY; anthropic: ANTHROPIC_API_KEY. auto (the default): openrouter if its key is set,
   *   then openai, then dev.
   */
  AI_DRIVER: z.enum(['auto', 'dev', 'openrouter', 'openai', 'anthropic']).default('auto'),
  ANTHROPIC_API_KEY: z.string().optional(),
  OPENROUTER_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  /** The talking model. Empty: a sensible one for the driver (OpenRouter: openai/gpt-4o-mini; OpenAI: gpt-4o-mini; Anthropic: claude-sonnet-5-5). */
  AI_MODEL: z.string().optional(),
  /** Images: dev draws a plain sample picture; openai uses OPENAI_API_KEY. auto: openai if its key is set, else dev. */
  AI_IMAGE_DRIVER: z.enum(['auto', 'dev', 'openai', 'off']).default('auto'),
  /** Tried first; if this OpenAI account can't use it, newer and older GPT image models are tried in turn. */
  AI_IMAGE_MODEL: z.string().default('gpt-image-2'),
  /** How many pictures each image request makes (each counts toward the daily image limit). */
  AI_IMAGE_OPTIONS: z.coerce.number().int().min(1).max(4).default(1),
  AI_IMAGES_PER_DAY: z.coerce.number().int().min(0).max(200).default(5),
  /** Where "open the full Jack's AI" sends people for specialised work (browsing, files, video, code). */
  JACK_AI_URL: z.string().url().default('https://jackai.si'),
  OPENROUTER_BASE_URL: z.string().url().default('https://openrouter.ai/api/v1'),
  OPENAI_BASE_URL: z.string().url().default('https://api.openai.com/v1'),
  /**
   * Indexx sign-in, Explore cards and the wallet. live: the Indexx API at INDEXX_API_URL. dev: a stand-in that answers
   * like it, kept in this database. off: signing in to Indexx isn't offered.
   */
  INDEXX_DRIVER: z.enum(['live', 'dev', 'off']).default('dev'),
  /** Test: https://test.api.v1.indexx.ai/api/v1 · production: https://api.v1.indexx.ai/api/v1 */
  INDEXX_API_URL: z.string().url().default('https://test.api.v1.indexx.ai/api/v1'),
  /** Encrypts the Indexx login tokens kept for each person. Defaults to one made from JWT_SECRET. */
  INDEXX_TOKEN_SECRET: z.string().min(32).optional(),
  /** Facebook link and sign-in. dev: a stand-in page served by this API. facebook: real Facebook Login. off: not offered. */
  FACEBOOK_DRIVER: z.enum(['dev', 'facebook', 'off']).default('dev'),
  FACEBOOK_APP_ID: z.string().optional(),
  FACEBOOK_APP_SECRET: z.string().optional(),
  /** The web app's address, where Facebook sign-in and linking come back to. */
  WEB_URL: z.string().url().default('http://localhost:3000'),
  TEST_OUTBOX: bool.default('false'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

export type Config = z.infer<typeof schema> & { aiDriver: 'dev' | 'openrouter' | 'openai' | 'anthropic'; aiImageDriver: 'dev' | 'openai' | 'off'; corsOrigins: string[]; googleClientIds: string[]; version: string };

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
    if (c.FACEBOOK_DRIVER === 'dev') problems.push('FACEBOOK_DRIVER=dev is not allowed in production (use facebook, or off)');
    if (c.AI_DRIVER === 'dev') problems.push('AI_DRIVER=dev is not allowed in production (use openrouter, openai or anthropic)');
    if (c.INDEXX_DRIVER === 'dev') problems.push('INDEXX_DRIVER=dev is not allowed in production (use live, or off)');
  }
  if (c.SMS_DRIVER === 'twilio' && !(c.TWILIO_ACCOUNT_SID && c.TWILIO_AUTH_TOKEN && c.TWILIO_VERIFY_SID)) problems.push('SMS_DRIVER=twilio needs TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_VERIFY_SID');
  if (c.EMAIL_DRIVER === 'ses' && !(c.SES_REGION && c.SES_FROM)) problems.push('EMAIL_DRIVER=ses needs SES_REGION and SES_FROM');
  if (!c.SES_ACCESS_KEY_ID !== !c.SES_SECRET_ACCESS_KEY) problems.push('SES_ACCESS_KEY_ID and SES_SECRET_ACCESS_KEY go together: set both or neither');
  if (c.STORAGE_DRIVER === 's3' && !(c.S3_BUCKET && c.S3_REGION)) problems.push('STORAGE_DRIVER=s3 needs S3_BUCKET and S3_REGION');
  if (c.PUSH_DRIVER === 'webpush' && c.NODE_ENV === 'production' && !(c.VAPID_PUBLIC_KEY && c.VAPID_PRIVATE_KEY)) problems.push('PUSH_DRIVER=webpush needs VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY (npx web-push generate-vapid-keys)');
  if ((c.APNS_KEY || c.APNS_KEY_FILE) && !(c.APNS_KEY_ID && c.APNS_TEAM_ID)) problems.push('An APNs key needs APNS_KEY_ID and APNS_TEAM_ID');
  if (c.NODE_ENV === 'production' && (c.APNS_HOST || c.FCM_API_URL !== 'https://fcm.googleapis.com')) problems.push('APNS_HOST and FCM_API_URL are for tests only');
  if (c.LIVEKIT_URL && !(c.LIVEKIT_API_KEY && c.LIVEKIT_API_SECRET)) problems.push('LIVEKIT_URL needs LIVEKIT_API_KEY and LIVEKIT_API_SECRET');
  if (c.NODE_ENV === 'production' && c.LIVEKIT_API_SECRET && c.LIVEKIT_API_SECRET.length < 32) problems.push('LIVEKIT_API_SECRET must be at least 32 characters in production');
  if (c.FACEBOOK_DRIVER === 'facebook' && !(c.FACEBOOK_APP_ID && c.FACEBOOK_APP_SECRET)) problems.push('FACEBOOK_DRIVER=facebook needs FACEBOOK_APP_ID and FACEBOOK_APP_SECRET');
  if (c.AI_DRIVER === 'anthropic' && !c.ANTHROPIC_API_KEY) problems.push('AI_DRIVER=anthropic needs ANTHROPIC_API_KEY');
  if (c.AI_DRIVER === 'openrouter' && !c.OPENROUTER_API_KEY) problems.push('AI_DRIVER=openrouter needs OPENROUTER_API_KEY');
  if (c.AI_DRIVER === 'openai' && !c.OPENAI_API_KEY) problems.push('AI_DRIVER=openai needs OPENAI_API_KEY');
  if (c.AI_IMAGE_DRIVER === 'openai' && !c.OPENAI_API_KEY) problems.push('AI_IMAGE_DRIVER=openai needs OPENAI_API_KEY');
  const aiDriver = c.AI_DRIVER !== 'auto' ? c.AI_DRIVER : c.OPENROUTER_API_KEY ? 'openrouter' : c.OPENAI_API_KEY ? 'openai' : 'dev';
  const aiImageDriver = c.AI_IMAGE_DRIVER !== 'auto' ? c.AI_IMAGE_DRIVER : c.OPENAI_API_KEY ? 'openai' : 'dev';
  if (c.NODE_ENV === 'production' && c.AI_DRIVER === 'auto' && aiDriver === 'dev') problems.push('Jack\'s AI needs OPENROUTER_API_KEY or OPENAI_API_KEY in production');
  if (c.NODE_ENV === 'production' && aiImageDriver === 'dev') problems.push('Jack\'s AI images need OPENAI_API_KEY in production (or AI_IMAGE_DRIVER=off)');
  if (c.GOOGLE_DRIVER === 'google' && !c.GOOGLE_CLIENT_IDS) problems.push('GOOGLE_DRIVER=google needs GOOGLE_CLIENT_IDS');
  if (problems.length) throw new Error(`Invalid configuration:\n  ${problems.join('\n  ')}`);
  return {
    ...c,
    aiDriver: aiDriver as 'dev' | 'openrouter' | 'openai' | 'anthropic',
    aiImageDriver: aiImageDriver as 'dev' | 'openai' | 'off',
    corsOrigins: c.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean),
    googleClientIds: c.GOOGLE_CLIENT_IDS.split(',').map((s) => s.trim()).filter(Boolean),
    version: process.env.npm_package_version ?? '0.1.0',
  };
}

export const CONFIG = Symbol('CONFIG');

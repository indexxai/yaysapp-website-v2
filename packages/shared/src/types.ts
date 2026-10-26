export interface HealthReport {
  status: 'ok' | 'degraded';
  version: string;
  uptimeSeconds: number;
  checks: { mongo: CheckResult; redis: CheckResult; storage: CheckResult };
}
export interface CheckResult { ok: boolean; latencyMs?: number; error?: string }

export interface MeProfile {
  id: string;
  displayName: string;
  username: string | null;
  about: string;
  photoUrl: string | null;
  phone: string | null;
  email: string | null;
  hasGoogle: boolean;
  createdAt: string;
  /** True when the account existed in the old app before v2. */
  migrated: boolean;
  /** Steps the app still has to show before the chat list. */
  pending: Array<'link_email' | 'add_phone' | 'profile'>;
}

export interface PublicProfile { id: string; displayName: string; username: string | null; about: string; photoUrl: string | null }

export interface Tokens { accessToken: string; refreshToken: string; accessExpiresAt: string; sessionId: string }

export interface AuthResult {
  tokens: Tokens;
  me: MeProfile;
  /** true when this sign-in created a brand-new account. */
  isNew: boolean;
}

export interface CodeSent { sentTo: string; channel: 'sms' | 'whatsapp' | 'email'; expiresInSeconds: number; resendInSeconds: number }

export interface DeviceSession { id: string; name: string; platform: 'ios' | 'android' | 'web'; lastActiveAt: string; createdAt: string; current: boolean }

export interface ContactMatch { phone: string; user: PublicProfile }

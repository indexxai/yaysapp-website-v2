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
  /** A PIN is asked after the code when signing in. */
  twoStep: boolean;
  privacy: PrivacySettings;
  notifications: NotificationSettings;
  /** Look and feel, kept on the account so every device matches. */
  preferences: AppPreferences;
}

/** "contacts": people I have a direct chat with. */
export type Audience = 'everyone' | 'contacts' | 'nobody';
export interface PrivacySettings {
  lastSeen: Audience;
  photo: Audience;
  about: Audience;
  /** Who can add me to a group without an invite link. */
  groups: 'everyone' | 'contacts';
  /** Off: others don't see when I read, and I don't see when they read (direct chats only). */
  readReceipts: boolean;
  /** Calls from people who aren't my contacts don't ring; they show in call history as silenced. */
  silenceUnknown: boolean;
}
export const DEFAULT_PRIVACY: PrivacySettings = { lastSeen: 'everyone', photo: 'everyone', about: 'everyone', groups: 'everyone', readReceipts: true, silenceUnknown: false };

export interface NotificationSettings {
  /** Show the message text in notifications (off: only who it's from). */
  preview: boolean;
  /** Notifications for group messages. */
  groups: boolean;
  /** No notifications between these times (24h "HH:MM", in timeZone). */
  quietHours: { on: boolean; from: string; to: string };
  timeZone: string;
}
export interface AppPreferences {
  theme: 'system' | 'light' | 'dark';
  /** 1 (smallest) to 5 (largest); 3 is the default. */
  textSize: 1 | 2 | 3 | 4 | 5;
  /** Enter sends; off: Enter makes a new line and Ctrl/Cmd+Enter sends. */
  enterToSend: boolean;
  /** A soft sound for new messages while the app is open. */
  sound: boolean;
}
export const DEFAULT_APP_PREFS: AppPreferences = { theme: 'system', textSize: 3, enterToSend: true, sound: true };

export const DEFAULT_NOTIFICATIONS: NotificationSettings = { preview: true, groups: true, quietHours: { on: false, from: '23:00', to: '07:00' }, timeZone: 'UTC' };

/** Signing in to an account with two-step verification: the PIN comes next. */
export interface PinRequired { status: 'pin_required'; pinToken: string; via: 'phone' | 'email' | 'google' | 'facebook' }
export type SignInResult = AuthResult | PinRequired;
export const needsPin = (r: SignInResult | { status: string }): r is PinRequired => (r as PinRequired).status === 'pin_required';

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

export interface StorageReport {
  total: number;
  byKind: { image: number; video: number; voice: number; file: number };
  chats: Array<{ conversationId: string; name: string; kind: 'direct' | 'group'; bytes: number; counts: Partial<Record<'image' | 'video' | 'voice' | 'file', number>> }>;
}

// ---- linking a browser with a QR code (or its short code) ----
/** Shown on the device that wants to sign in. `qr` goes in the QR code; `code` is typed in instead when there's no camera. */
export interface LinkStart { pollId: string; qr: string; code: string; expiresAt: string }
export type LinkPoll = { status: 'waiting'; expiresAt: string } | { status: 'expired' } | ({ status: 'linked' } & AuthResult);
export interface LinkApproved { deviceName: string }

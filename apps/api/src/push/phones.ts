import { readFileSync } from 'fs';
import * as http2 from 'http2';
import { importPKCS8, SignJWT } from 'jose';
import { callUuid } from '@yays/shared';
import type { Config } from '../config';
import type { Logger } from '../common/logger';

// ---------------------------------------------------------------------------------------------------------------
// Notifications for the phone app: Firebase Cloud Messaging for Android, Apple's push service for iPhone.
// Both take the same payloads as Web Push (push.service.ts) and say 'gone' when the phone dropped its token.
// ---------------------------------------------------------------------------------------------------------------
export type PhonePayload =
  | { type: 'message'; conversationId: string; messageId: string; title: string; body: string; tag: string; url: string }
  | { type: 'read'; conversationId: string; tag: string }
  | { type: 'call'; callId: string; title: string; body: string; tag: string; url: string; media?: 'voice' | 'video'; caller?: string }
  | { type: 'call_end'; callId: string; tag: string };

/** How long each kind is worth delivering: a message for a day, a ring only while it rings, the rest only now. */
const ttl = (p: PhonePayload) => (p.type === 'message' ? 86400 : p.type === 'call' ? 45 : 60);
/** What the app needs when the notification is tapped (strings only: FCM's data values are strings). */
const data = (p: PhonePayload): Record<string, string> => {
  const d: Record<string, string> = { type: p.type, tag: p.tag };
  if ('conversationId' in p) d.conversationId = p.conversationId;
  if ('callId' in p) { d.callId = p.callId; d.uuid = callUuid(p.callId); }
  if (p.type === 'call') { d.media = p.media ?? 'voice'; d.caller = p.caller ?? p.title; d.title = p.title; d.body = p.body; }
  if (p.type === 'message') d.messageId = p.messageId;
  return d;
};

// ---- Android: Firebase Cloud Messaging (HTTP v1) ----
interface ServiceAccount { project_id: string; client_email: string; private_key: string; token_uri?: string }

export class FcmSender {
  private token: { value: string; until: number } | null = null;
  constructor(private readonly sa: ServiceAccount, private readonly apiUrl: string) {}

  static from(c: Config, log: Logger): FcmSender | null {
    const raw = c.FCM_SERVICE_ACCOUNT_JSON ?? (c.FCM_SERVICE_ACCOUNT_FILE ? safeRead(c.FCM_SERVICE_ACCOUNT_FILE, log) : undefined);
    if (!raw) return null;
    try {
      const sa = JSON.parse(raw) as ServiceAccount;
      if (!sa.project_id || !sa.client_email || !sa.private_key) throw new Error('missing fields');
      return new FcmSender(sa, c.FCM_API_URL.replace(/\/$/, ''));
    } catch (e) { log.error({ err: e }, 'FCM service account is not valid JSON with project_id, client_email and private_key: Android notifications are off'); return null; }
  }

  /** A Google OAuth token for FCM, from the service account; kept until shortly before it runs out. */
  private async accessToken() {
    if (this.token && this.token.until > Date.now()) return this.token.value;
    const aud = this.sa.token_uri ?? 'https://oauth2.googleapis.com/token';
    const now = Math.floor(Date.now() / 1000);
    const assertion = await new SignJWT({ scope: 'https://www.googleapis.com/auth/firebase.messaging' })
      .setProtectedHeader({ alg: 'RS256', typ: 'JWT' }).setIssuer(this.sa.client_email).setAudience(aud).setIssuedAt(now).setExpirationTime(now + 3600)
      .sign(await importPKCS8(this.sa.private_key, 'RS256'));
    const r = await fetch(aud, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }) });
    if (!r.ok) throw new Error(`FCM sign-in failed: ${r.status}`);
    const j = (await r.json()) as { access_token: string; expires_in?: number };
    this.token = { value: j.access_token, until: Date.now() + Math.max(60, (j.expires_in ?? 3600) - 300) * 1000 };
    return j.access_token;
  }

  /**
   * The FCM message for one payload. Messages show a notification; "read" and "call over" are silent. A ring is data
   * only, sent at high priority, so the app itself shows the full-screen incoming call (a plain notification can't).
   */
  static message(token: string, p: PhonePayload) {
    const shows = p.type === 'message';
    const urgent = shows || p.type === 'call';
    return {
      token, data: data(p),
      ...(shows ? { notification: { title: p.title, body: p.body } } : {}),
      android: {
        priority: urgent ? 'high' : 'normal', ttl: `${ttl(p)}s`,
        // A newer push for the same chat replaces one still waiting; on the phone, it replaces the notification.
        collapse_key: ('conversationId' in p ? p.conversationId : p.callId).slice(0, 64),
        ...(shows ? { notification: { channel_id: 'messages', tag: p.tag } } : {}),
      },
    };
  }

  async send(token: string, p: PhonePayload): Promise<'ok' | 'gone'> {
    const r = await fetch(`${this.apiUrl}/v1/projects/${encodeURIComponent(this.sa.project_id)}/messages:send`, {
      method: 'POST', headers: { authorization: `Bearer ${await this.accessToken()}`, 'content-type': 'application/json' },
      body: JSON.stringify({ message: FcmSender.message(token, p) }),
    });
    if (r.ok) return 'ok';
    const body = (await r.json().catch(() => ({}))) as { error?: { status?: string; details?: Array<{ errorCode?: string }> } };
    const code = body.error?.details?.find((d) => d.errorCode)?.errorCode ?? body.error?.status;
    // The app was uninstalled or the token replaced.
    if (r.status === 404 || code === 'UNREGISTERED') return 'gone';
    if (r.status === 401) this.token = null;
    throw new Error(`FCM ${r.status} ${code ?? ''}`.trim());
  }
}

// ---- iPhone: Apple Push Notification service (HTTP/2, token auth) ----
export class ApnsSender {
  private jwt: { value: string; until: number } | null = null;
  private sessions = new Map<string, http2.ClientHttp2Session>();
  constructor(private readonly key: string, private readonly keyId: string, private readonly teamId: string, private readonly topic: string, private readonly host?: string) {}

  static from(c: Config, log: Logger): ApnsSender | null {
    const key = c.APNS_KEY ?? (c.APNS_KEY_FILE ? safeRead(c.APNS_KEY_FILE, log) : undefined);
    if (!key || !c.APNS_KEY_ID || !c.APNS_TEAM_ID) return null;
    return new ApnsSender(key.replace(/\\n/g, '\n'), c.APNS_KEY_ID, c.APNS_TEAM_ID, c.APNS_BUNDLE_ID, c.APNS_HOST);
  }

  /** Apple wants a new token at most every 20 minutes and at least every hour. */
  private async token() {
    if (this.jwt && this.jwt.until > Date.now()) return this.jwt.value;
    const value = await new SignJWT({}).setProtectedHeader({ alg: 'ES256', kid: this.keyId }).setIssuer(this.teamId).setIssuedAt().sign(await importPKCS8(this.key, 'ES256'));
    this.jwt = { value, until: Date.now() + 40 * 60_000 };
    return value;
  }

  private session(origin: string) {
    const s = this.sessions.get(origin);
    if (s && !s.closed && !s.destroyed) return s;
    const n = http2.connect(origin);
    n.on('error', () => this.sessions.delete(origin));
    n.on('close', () => this.sessions.delete(origin));
    n.unref();
    this.sessions.set(origin, n);
    return n;
  }

  /** The APNs body and headers for one payload. Rings and messages alert; "read" and "call over" are background pushes. */
  static request(p: PhonePayload) {
    const shows = p.type === 'message' || p.type === 'call';
    const aps = shows
      ? { alert: { title: p.title, body: p.body }, sound: 'default', 'thread-id': 'conversationId' in p ? p.conversationId : p.callId, ...(p.type === 'call' ? { 'interruption-level': 'time-sensitive' } : {}) }
      : { 'content-available': 1 };
    return {
      headers: {
        'apns-push-type': shows ? 'alert' : 'background', 'apns-priority': shows ? '10' : '5',
        'apns-expiration': String(Math.floor(Date.now() / 1000) + ttl(p)), 'apns-collapse-id': p.tag.slice(0, 64),
      },
      body: { aps, ...data(p) },
    };
  }

  /**
   * A VoIP push (PushKit) for a ring or its end: it wakes the app, which must show the call on the phone's call screen
   * (CallKit) straight away. Only calls go this way; Apple stops VoIP pushes to apps that use them for anything else.
   */
  static voipRequest(p: Extract<PhonePayload, { type: 'call' | 'call_end' }>) {
    return {
      headers: { 'apns-push-type': 'voip', 'apns-priority': '10', 'apns-expiration': String(Math.floor(Date.now() / 1000) + ttl(p)) },
      body: { aps: {}, ...data(p) },
    };
  }

  async send(token: string, p: PhonePayload, sandbox: boolean, voip = false): Promise<'ok' | 'gone'> {
    const origin = this.host ?? (sandbox ? 'https://api.sandbox.push.apple.com' : 'https://api.push.apple.com');
    if (voip && p.type !== 'call' && p.type !== 'call_end') throw new Error('VoIP pushes are for calls only');
    const { headers, body } = voip ? ApnsSender.voipRequest(p as Extract<PhonePayload, { type: 'call' | 'call_end' }>) : ApnsSender.request(p);
    const topic = voip ? `${this.topic}.voip` : this.topic;
    const auth = await this.token();
    const { status, reason } = await new Promise<{ status: number; reason?: string }>((resolve, reject) => {
      const req = this.session(origin).request({ ':method': 'POST', ':path': `/3/device/${token}`, authorization: `bearer ${auth}`, 'apns-topic': topic, ...headers });
      let status = 0, text = '';
      req.setTimeout(10_000, () => { req.close(); reject(new Error('APNs timed out')); });
      req.on('response', (h) => { status = Number(h[':status']); });
      req.on('data', (c: Buffer) => { text += c.toString(); });
      req.on('end', () => { let reason: string | undefined; try { reason = (JSON.parse(text) as { reason?: string }).reason; } catch { /* empty body on success */ } resolve({ status, reason }); });
      req.on('error', reject);
      req.end(JSON.stringify(body));
    });
    if (status === 200) return 'ok';
    if (status === 410 || reason === 'BadDeviceToken' || reason === 'Unregistered' || reason === 'DeviceTokenNotForTopic') return 'gone';
    if (status === 403 && reason === 'ExpiredProviderToken') this.jwt = null;
    throw new Error(`APNs ${status} ${reason ?? ''}`.trim());
  }

  close() { for (const s of this.sessions.values()) s.close(); this.sessions.clear(); }
}

function safeRead(file: string, log: Logger) {
  try { return readFileSync(file, 'utf8'); } catch (e) { log.error({ err: e, file }, 'could not read push key file'); return undefined; }
}

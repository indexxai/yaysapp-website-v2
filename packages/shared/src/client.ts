import { ApiError, ErrorCode, type ApiErrorBody } from './errors';
import type { AuthResult, CodeSent, ContactMatch, DeviceSession, HealthReport, MeProfile, Tokens } from './types';

export interface TokenStore {
  get(): Tokens | null | Promise<Tokens | null>;
  set(tokens: Tokens | null): void | Promise<void>;
}

export interface DeviceInfo { deviceId: string; platform: 'ios' | 'android' | 'web'; name?: string; appVersion?: string }

export type PhoneVerifyResult =
  | ({ status: 'signed_in' } & AuthResult)
  | { status: 'email_required'; signupToken: string; phone: string };

export interface ClientOptions {
  baseUrl: string;
  tokens: TokenStore;
  device: DeviceInfo;
  fetch?: typeof fetch;
  /** Called when the session can't be refreshed any more, so the app can show sign-in. */
  onSignedOut?: () => void;
  timeoutMs?: number;
}

/** One typed client for web and mobile. Refreshes the access token once on 401 and retries. */
export class YaysClient {
  private refreshing: Promise<boolean> | null = null;
  private readonly f: typeof fetch;
  constructor(private readonly o: ClientOptions) {
    this.f = o.fetch ?? fetch.bind(globalThis);
  }

  // ---- low level ----
  async request<T>(method: string, path: string, body?: unknown, opts: { auth?: boolean; retry?: boolean } = {}): Promise<T> {
    const auth = opts.auth ?? true;
    const headers: Record<string, string> = { accept: 'application/json' };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (auth) {
      const t = await this.o.tokens.get();
      if (t) headers.authorization = `Bearer ${t.accessToken}`;
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.o.timeoutMs ?? 20000);
    let res: Response;
    try {
      res = await this.f(this.o.baseUrl.replace(/\/$/, '') + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: ctrl.signal });
    } catch (e) {
      throw new ApiError(0, ErrorCode.PROVIDER_UNAVAILABLE, ctrl.signal.aborted ? 'The server took too long to answer. Try again.' : 'No connection. Check your internet and try again.');
    } finally {
      clearTimeout(timer);
    }
    if (res.status === 401 && auth && opts.retry !== false) {
      if (await this.refresh()) return this.request<T>(method, path, body, { ...opts, retry: false });
    }
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    let json: unknown = undefined;
    try { json = text ? JSON.parse(text) : undefined; } catch { /* non-JSON error page */ }
    if (!res.ok) {
      const e = (json as ApiErrorBody | undefined)?.error;
      throw new ApiError(res.status, e?.code ?? ErrorCode.INTERNAL, e?.message ?? `Request failed (${res.status}).`, e?.details, e?.requestId);
    }
    return json as T;
  }

  /** Single-flight refresh: parallel 401s share one refresh call. */
  refresh(): Promise<boolean> {
    if (!this.refreshing) {
      this.refreshing = (async () => {
        const t = await this.o.tokens.get();
        if (!t) return false;
        try {
          const next = await this.request<Tokens>('POST', '/v1/auth/refresh', { refreshToken: t.refreshToken }, { auth: false });
          await this.o.tokens.set(next);
          return true;
        } catch (e) {
          if (e instanceof ApiError && e.status !== 0) { await this.o.tokens.set(null); this.o.onSignedOut?.(); }
          return false;
        }
      })().finally(() => { this.refreshing = null; });
    }
    return this.refreshing;
  }

  private async signedIn(r: AuthResult): Promise<AuthResult> { await this.o.tokens.set(r.tokens); return r; }

  // ---- endpoints ----
  health() { return this.request<HealthReport>('GET', '/v1/health', undefined, { auth: false }); }

  startPhone(phone: string, channel: 'sms' | 'whatsapp' = 'sms') { return this.request<CodeSent>('POST', '/v1/auth/phone/start', { phone, channel }, { auth: false }); }
  async verifyPhone(phone: string, code: string): Promise<PhoneVerifyResult> {
    const r = await this.request<PhoneVerifyResult>('POST', '/v1/auth/phone/verify', { phone, code, device: this.o.device }, { auth: false });
    if (r.status === 'signed_in') await this.o.tokens.set(r.tokens);
    return r;
  }
  startSignupEmail(signupToken: string, email: string) { return this.request<CodeSent>('POST', '/v1/auth/signup/email/start', { signupToken, email }, { auth: false }); }
  async verifySignupEmail(signupToken: string, email: string, code: string) {
    return this.signedIn(await this.request<AuthResult>('POST', '/v1/auth/signup/email/verify', { signupToken, email, code, device: this.o.device }, { auth: false }));
  }
  startEmail(email: string) { return this.request<CodeSent>('POST', '/v1/auth/email/start', { email }, { auth: false }); }
  async verifyEmail(email: string, code: string) {
    return this.signedIn(await this.request<AuthResult>('POST', '/v1/auth/email/verify', { email, code, device: this.o.device }, { auth: false }));
  }
  async google(idToken: string) {
    return this.signedIn(await this.request<AuthResult>('POST', '/v1/auth/google', { idToken, device: this.o.device }, { auth: false }));
  }
  async logout() {
    try { await this.request<void>('POST', '/v1/auth/logout', {}); } finally { await this.o.tokens.set(null); }
  }

  me() { return this.request<MeProfile>('GET', '/v1/me'); }
  updateMe(patch: { displayName?: string; username?: string; about?: string; photoKey?: string | null }) { return this.request<MeProfile>('PATCH', '/v1/me', patch); }
  checkUsername(username: string) { return this.request<{ available: boolean; reason?: string }>('GET', `/v1/me/username-available?u=${encodeURIComponent(username)}`); }
  startAddPhone(phone: string, channel: 'sms' | 'whatsapp' = 'sms') { return this.request<CodeSent>('POST', '/v1/me/phone/start', { phone, channel }); }
  verifyAddPhone(phone: string, code: string) { return this.request<MeProfile>('POST', '/v1/me/phone/verify', { phone, code }); }
  devices() { return this.request<DeviceSession[]>('GET', '/v1/me/devices'); }
  revokeDevice(id: string) { return this.request<void>('DELETE', `/v1/me/devices/${encodeURIComponent(id)}`); }
  revokeOtherDevices() { return this.request<{ revoked: number }>('POST', '/v1/me/devices/revoke-others', {}); }
  matchContacts(phones: string[]) { return this.request<ContactMatch[]>('POST', '/v1/contacts/match', { phones }); }
}

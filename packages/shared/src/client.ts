import { ApiError, ErrorCode, type ApiErrorBody } from './errors';
import type { AuthResult, CodeSent, ContactMatch, DeviceSession, HealthReport, MeProfile, PublicProfile, Tokens } from './types';
import type { AttachmentInput, AttachmentKind, ChatMessage, SearchResults, ConversationPage, ConversationSummary, GroupInfo, MessageInfo, StarredItem, GroupSettings, InvitePreview, JoinRequest, JoinResult, MemberReceipt, MessagePage, SendResult } from './chat';

export interface TokenStore {
  get(): Tokens | null | Promise<Tokens | null>;
  set(tokens: Tokens | null): void | Promise<void>;
}

export interface UploadTicket { key: string; uploadUrl: string; method: 'PUT'; headers: Record<string, string>; expiresAt: string }

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

  // ---- chats ----
  /** Finds a person by exact username (@name), phone number or email. */
  lookupUser(q: string) { return this.request<PublicProfile>('GET', `/v1/users/lookup?q=${encodeURIComponent(q)}`); }
  conversations(opts: { before?: string; limit?: number } = {}) {
    const q = new URLSearchParams();
    if (opts.before) q.set('before', opts.before);
    if (opts.limit) q.set('limit', String(opts.limit));
    const s = q.toString();
    return this.request<ConversationPage>('GET', `/v1/conversations${s ? `?${s}` : ''}`);
  }
  conversation(id: string) { return this.request<ConversationSummary>('GET', `/v1/conversations/${encodeURIComponent(id)}`); }
  openDirect(userId: string) { return this.request<ConversationSummary>('POST', '/v1/conversations/direct', { userId }); }
  messages(conversationId: string, opts: { before?: number; after?: number; limit?: number } = {}) {
    const q = new URLSearchParams();
    if (opts.before !== undefined) q.set('before', String(opts.before));
    if (opts.after !== undefined) q.set('after', String(opts.after));
    if (opts.limit) q.set('limit', String(opts.limit));
    const s = q.toString();
    return this.request<MessagePage>('GET', `/v1/conversations/${encodeURIComponent(conversationId)}/messages${s ? `?${s}` : ''}`);
  }
  sendMessage(conversationId: string, clientId: string, text: string, replyToId?: string, attachment?: AttachmentInput) {
    return this.request<SendResult>('POST', `/v1/conversations/${encodeURIComponent(conversationId)}/messages`, { clientId, text, ...(replyToId ? { replyToId } : {}), ...(attachment ? { attachment } : {}) });
  }
  /** A signed link to upload one file to. */
  uploadTicket(body: { purpose: 'media' | 'thumb' | 'avatar'; kind?: AttachmentKind; contentType: string; size: number; name?: string }) {
    return this.request<UploadTicket>('POST', '/v1/media/upload-url', body);
  }
  private msgUrl(c: string, m: string, tail = '') { return `/v1/conversations/${encodeURIComponent(c)}/messages/${encodeURIComponent(m)}${tail}`; }
  editMessage(c: string, m: string, text: string) { return this.request<ChatMessage>('PATCH', this.msgUrl(c, m), { text }); }
  deleteMessage(c: string, m: string, forWho: 'me' | 'everyone') { return this.request<ChatMessage | { hidden: true }>('DELETE', this.msgUrl(c, m, `?for=${forWho}`)); }
  react(c: string, m: string, emoji: string | null) { return emoji ? this.request<ChatMessage>('PUT', this.msgUrl(c, m, '/reaction'), { emoji }) : this.request<ChatMessage>('DELETE', this.msgUrl(c, m, '/reaction')); }
  pinMessage(c: string, m: string, on: boolean) { return this.request<ConversationSummary>(on ? 'POST' : 'DELETE', this.msgUrl(c, m, '/pin'), on ? {} : undefined); }
  starMessage(c: string, m: string, on: boolean) { return this.request<ChatMessage>(on ? 'PUT' : 'DELETE', this.msgUrl(c, m, '/star'), on ? {} : undefined); }
  messageInfo(c: string, m: string) { return this.request<MessageInfo>('GET', this.msgUrl(c, m, '/info')); }
  forward(c: string, m: string, body: { targets: Array<{ conversationId: string; clientId: string; commentClientId?: string }>; comment?: string }) {
    return this.request<Array<{ conversationId: string; ok: boolean; message?: ChatMessage; error?: string }>>('POST', this.msgUrl(c, m, '/forward'), body);
  }
  starred(before?: string) { return this.request<{ items: StarredItem[]; next: string | null }>('GET', `/v1/starred${before ? `?before=${encodeURIComponent(before)}` : ''}`); }
  markDelivered(conversationId: string, seq: number) { return this.request<MemberReceipt>('POST', `/v1/conversations/${encodeURIComponent(conversationId)}/delivered`, { seq }); }
  markRead(conversationId: string, seq: number) { return this.request<MemberReceipt>('POST', `/v1/conversations/${encodeURIComponent(conversationId)}/read`, { seq }); }
  /** Public profiles by id (names and photos for group members, past and present). */
  profiles(ids: string[]) { return this.request<PublicProfile[]>('GET', `/v1/users/profiles?ids=${ids.map(encodeURIComponent).join(',')}`); }

  /** Uploads a photo and returns its storage key (for a profile or group photo). */
  async uploadPhoto(file: Blob): Promise<string> {
    const t = await this.request<{ key: string; uploadUrl: string; headers: Record<string, string> }>('POST', '/v1/media/upload-url', { purpose: 'avatar', contentType: file.type, size: file.size });
    let r: Response;
    try { r = await this.f(t.uploadUrl, { method: 'PUT', headers: t.headers, body: file }); }
    catch { throw new ApiError(0, ErrorCode.PROVIDER_UNAVAILABLE, "The photo didn't upload. Check your connection and try again."); }
    if (!r.ok) throw new ApiError(r.status, ErrorCode.INTERNAL, "The photo didn't upload. Try again.");
    return t.key;
  }

  // ---- search ----
  search(q: string, type: 'all' | 'chats' | 'people' | 'messages' | 'files' = 'all', before?: string) {
    const p = new URLSearchParams({ q, type, ...(before ? { before } : {}) });
    return this.request<SearchResults>('GET', `/v1/search?${p}`);
  }
  searchInChat(conversationId: string, q: string) { return this.request<{ seqs: number[] }>('GET', `/v1/conversations/${encodeURIComponent(conversationId)}/search?q=${encodeURIComponent(q)}`); }

  // ---- groups ----
  createGroup(v: { name: string; memberIds: string[]; about?: string; settings?: { send?: 'all' | 'admins' } }) { return this.request<ConversationSummary>('POST', '/v1/groups', v); }
  groupInfo(id: string) { return this.request<GroupInfo>('GET', `/v1/groups/${encodeURIComponent(id)}`); }
  updateGroup(id: string, v: { name?: string; about?: string; photoKey?: string | null }) { return this.request<ConversationSummary>('PATCH', `/v1/groups/${encodeURIComponent(id)}`, v); }
  groupSettings(id: string, v: Partial<GroupSettings>) { return this.request<ConversationSummary>('PATCH', `/v1/groups/${encodeURIComponent(id)}/settings`, v); }
  addMembers(id: string, userIds: string[]) { return this.request<ConversationSummary>('POST', `/v1/groups/${encodeURIComponent(id)}/members`, { userIds }); }
  removeMember(id: string, userId: string) { return this.request<ConversationSummary>('DELETE', `/v1/groups/${encodeURIComponent(id)}/members/${encodeURIComponent(userId)}`); }
  setAdmin(id: string, userId: string, on: boolean) { return this.request<ConversationSummary>(on ? 'POST' : 'DELETE', `/v1/groups/${encodeURIComponent(id)}/admins/${encodeURIComponent(userId)}`); }
  leaveGroup(id: string) { return this.request<ConversationSummary>('POST', `/v1/groups/${encodeURIComponent(id)}/leave`, {}); }
  deleteGroup(id: string) { return this.request<void>('DELETE', `/v1/groups/${encodeURIComponent(id)}`); }
  resetInvite(id: string) { return this.request<{ inviteCode: string }>('POST', `/v1/groups/${encodeURIComponent(id)}/invite`, {}); }
  revokeInvite(id: string) { return this.request<void>('DELETE', `/v1/groups/${encodeURIComponent(id)}/invite`); }
  joinRequests(id: string) { return this.request<JoinRequest[]>('GET', `/v1/groups/${encodeURIComponent(id)}/requests`); }
  approveRequest(id: string, userId: string) { return this.request<ConversationSummary>('POST', `/v1/groups/${encodeURIComponent(id)}/requests/${encodeURIComponent(userId)}`, {}); }
  rejectRequest(id: string, userId: string) { return this.request<void>('DELETE', `/v1/groups/${encodeURIComponent(id)}/requests/${encodeURIComponent(userId)}`); }
  invitePreview(code: string) { return this.request<InvitePreview>('GET', `/v1/invites/${encodeURIComponent(code)}`); }
  joinInvite(code: string) { return this.request<JoinResult>('POST', `/v1/invites/${encodeURIComponent(code)}/join`, {}); }
  cancelJoinRequest(code: string) { return this.request<void>('DELETE', `/v1/invites/${encodeURIComponent(code)}/request`); }

  /** The current access token, refreshed first when it is about to expire. Used to open the real-time connection. */
  async accessToken(forceRefresh = false): Promise<string | null> {
    let t = await this.o.tokens.get();
    if (!t) return null;
    const expiresSoon = Date.parse(t.accessExpiresAt) - Date.now() < 30_000;
    if (forceRefresh || expiresSoon) { if (!(await this.refresh())) return null; t = await this.o.tokens.get(); }
    return t?.accessToken ?? null;
  }
  /** True while this device still holds tokens (they may need refreshing). */
  async hasSession() { return !!(await this.o.tokens.get()); }
  get baseUrl() { return this.o.baseUrl.replace(/\/$/, ''); }
}

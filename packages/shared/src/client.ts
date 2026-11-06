import { ApiError, ErrorCode, type ApiErrorBody } from './errors';
import type { LinkApproved, LinkPoll, LinkStart, AuthResult, CodeSent, ContactMatch, DeviceSession, HealthReport, MeProfile, NotificationSettings, AppPreferences, PinRequired, PrivacySettings, PublicProfile, SignInResult, StorageReport, Tokens } from './types';
import type { AiChat, AiChatSummary, AiMode, AiQuota, AiReply, AiSummary, BonusCampaign, BtcyView, CheckinStatus, EarnToday, IndexxLink, PaymentView, PointsHistoryPage, PointsSummary, PopupNow, ProductsView, ReferralSummary, SocialNetwork, SocialsView, SupportAnswer, SupportTicket, WalletTx, WalletView } from './phase2';
import type { CircleComment, CircleDiscover, CircleEvent, CircleFeed, CircleMemberRow, CirclePost, CirclePostInput, CircleReview, CircleView, CreateCircleInput, CreateEventInput, MyCircles, PostReportReason, RsvpStatus, UpdateCircleInput, UpdateEventInput } from './circles';
import type { CallHistoryPage, CallJoin, CallLink, CallLinkJoin, CallLinkPreview, CallMedia, CallView, AttachmentInput, AttachmentKind, ChatMessage, ChatOverview, CreatePollInput, CommunityInfo, CommunityInvitePreview, CommunityJoinResult, CommunityMember, CommunityReport, CommunitySummary, ChatPrefsInput, ReportInput, SharedPage, SharedTab, SearchResults, ConversationPage, ConversationSummary, GroupInfo, MessageInfo, StarredItem, GroupSettings, InvitePreview, JoinRequest, JoinResult, MemberReceipt, MessagePage, SendResult } from './chat';

export interface TokenStore {
  get(): Tokens | null | Promise<Tokens | null>;
  set(tokens: Tokens | null): void | Promise<void>;
}

export interface UploadTicket { key: string; uploadUrl: string; method: 'PUT'; headers: Record<string, string>; expiresAt: string }

export interface DeviceInfo { deviceId: string; platform: 'ios' | 'android' | 'web'; name?: string; appVersion?: string }

export type PhoneVerifyResult =
  | ({ status: 'signed_in' } & AuthResult)
  | { status: 'email_required'; signupToken: string; phone: string }
  | PinRequired;

export interface ClientOptions {
  baseUrl: string;
  tokens: TokenStore;
  device: DeviceInfo;
  fetch?: typeof fetch;
  /** Called when the session can't be refreshed any more, so the app can show sign-in. */
  onSignedOut?: () => void;
  timeoutMs?: number;
}

const timeZone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined; } catch { return undefined; } };

/** One typed client for web and mobile. Refreshes the access token once on 401 and retries. */
const c = encodeURIComponent;

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
    const tz = timeZone();
    if (tz) headers['x-time-zone'] = tz;
    let used: string | undefined;
    if (auth) {
      const t = await this.o.tokens.get();
      if (t) { headers.authorization = `Bearer ${t.accessToken}`; used = t.accessToken; }
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
      // Another request refreshed the tokens while this one was out: just try again with the new ones.
      const now = (await this.o.tokens.get())?.accessToken;
      if (now && now !== used) return this.request<T>(method, path, body, { ...opts, retry: false });
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

  /** Keeps the tokens when the sign-in finished; a PIN step returns without them. */
  private async signedIn<R extends SignInResult>(r: R): Promise<R> { if ('tokens' in r) await this.o.tokens.set(r.tokens); return r; }

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
    return this.signedIn(await this.request<SignInResult>('POST', '/v1/auth/signup/email/verify', { signupToken, email, code, device: this.o.device }, { auth: false }));
  }
  startEmail(email: string) { return this.request<CodeSent>('POST', '/v1/auth/email/start', { email }, { auth: false }); }
  async verifyEmail(email: string, code: string) {
    return this.signedIn(await this.request<SignInResult>('POST', '/v1/auth/email/verify', { email, code, device: this.o.device }, { auth: false }));
  }
  async google(idToken: string) {
    return this.signedIn(await this.request<SignInResult>('POST', '/v1/auth/google', { idToken, device: this.o.device }, { auth: false }));
  }
  /** Two-step verification: the PIN after the code. */
  async signInWithPin(pinToken: string, pin: string) { return this.signedIn(await this.request<AuthResult>('POST', '/v1/auth/pin', { pinToken, pin, device: this.o.device }, { auth: false })); }
  /** Forgot the PIN: a code goes to the account's other address (email if you used your phone, and the other way round). */
  forgotPin(pinToken: string) { return this.request<CodeSent>('POST', '/v1/auth/pin/forgot', { pinToken }, { auth: false }); }
  /** Turns two-step off and signs in. */
  async resetPin(pinToken: string, code: string) { return this.signedIn(await this.request<AuthResult>('POST', '/v1/auth/pin/reset', { pinToken, code }, { auth: false })); }
  // ---- linking with a QR code ----
  linkStart() { return this.request<LinkStart>('POST', '/v1/auth/link/start', { device: this.o.device }, { auth: false }); }
  /** Asks whether the code was scanned; once it was, this browser is signed in. */
  async linkPoll(pollId: string) {
    const r = await this.request<LinkPoll>('GET', `/v1/auth/link/${encodeURIComponent(pollId)}`, undefined, { auth: false });
    if (r.status === 'linked') await this.o.tokens.set(r.tokens);
    return r;
  }
  linkApprove(v: { qr: string } | { code: string }) { return this.request<LinkApproved>('POST', '/v1/auth/link/approve', v); }

  async logout() {
    try { await this.request<void>('POST', '/v1/auth/logout', {}); } finally { await this.o.tokens.set(null); }
  }

  me() { return this.request<MeProfile>('GET', '/v1/me'); }
  updateMe(patch: { displayName?: string; username?: string; about?: string; photoKey?: string | null }) { return this.request<MeProfile>('PATCH', '/v1/me', patch); }
  setPin(pin: string, currentPin?: string) { return this.request<MeProfile>('PUT', '/v1/me/two-step', { pin, ...(currentPin ? { currentPin } : {}) }); }
  removePin(pin: string) { return this.request<MeProfile>('DELETE', '/v1/me/two-step', { pin }); }
  setPrivacy(p: Partial<PrivacySettings>) { return this.request<MeProfile>('PUT', '/v1/me/privacy', p); }
  setNotifications(n: Partial<NotificationSettings>) { return this.request<MeProfile>('PUT', '/v1/me/notifications', n); }
  setPreferences(p: Partial<AppPreferences>) { return this.request<MeProfile>('PUT', '/v1/me/preferences', p); }
  /** Deleting the account: a code goes to the phone (or email) first. */
  startDeleteAccount() { return this.request<CodeSent>('POST', '/v1/me/delete/start', {}); }
  async deleteAccount(code: string, reason?: string) { await this.request<void>('POST', '/v1/me/delete', { code, ...(reason ? { reason } : {}) }); await this.o.tokens.set(null); }
  /** Everything YaysApp keeps about me, as JSON. */
  storageReport() { return this.request<StorageReport>('GET', '/v1/me/storage'); }
  /** Opens (or creates) the chat with YaysApp Support. */
  supportChat() { return this.request<ConversationSummary>('POST', '/v1/support/chat', {}); }
  reportProblem(r: { text: string; screenshotKey?: string; userAgent?: string; appVersion?: string; page?: string }) { return this.request<void>('POST', '/v1/support/problems', r); }
  /** "Delete chat": clears it and takes it off my list until someone writes again. */
  deleteChat(id: string) { return this.request<void>('DELETE', `/v1/conversations/${encodeURIComponent(id)}`); }
  exportData() { return this.request<Record<string, unknown>>('GET', '/v1/me/export'); }
  checkUsername(username: string) { return this.request<{ available: boolean; reason?: string }>('GET', `/v1/me/username-available?u=${encodeURIComponent(username)}`); }
  startAddPhone(phone: string, channel: 'sms' | 'whatsapp' = 'sms') { return this.request<CodeSent>('POST', '/v1/me/phone/start', { phone, channel }); }
  verifyAddPhone(phone: string, code: string) { return this.request<MeProfile>('POST', '/v1/me/phone/verify', { phone, code }); }
  startAddEmail(email: string) { return this.request<CodeSent>('POST', '/v1/me/email/start', { email }); }
  verifyAddEmail(email: string, code: string) { return this.request<MeProfile>('POST', '/v1/me/email/verify', { email, code }); }
  devices() { return this.request<DeviceSession[]>('GET', '/v1/me/devices'); }
  revokeDevice(id: string) { return this.request<void>('DELETE', `/v1/me/devices/${encodeURIComponent(id)}`); }
  revokeOtherDevices() { return this.request<{ revoked: number }>('POST', '/v1/me/devices/revoke-others', {}); }
  matchContacts(phones: string[]) { return this.request<ContactMatch[]>('POST', '/v1/contacts/match', { phones }); }

  // ---- chats ----
  /** Finds a person by exact username (@name), phone number or email. */
  lookupUser(q: string) { return this.request<PublicProfile>('GET', `/v1/users/lookup?q=${encodeURIComponent(q)}`); }
  conversations(opts: { before?: string; limit?: number; archived?: boolean } = {}) {
    const q = new URLSearchParams();
    if (opts.before) q.set('before', opts.before);
    if (opts.archived) q.set('archived', '1');
    if (opts.limit) q.set('limit', String(opts.limit));
    const s = q.toString();
    return this.request<ConversationPage>('GET', `/v1/conversations${s ? `?${s}` : ''}`);
  }
  conversation(id: string) { return this.request<ConversationSummary>('GET', `/v1/conversations/${encodeURIComponent(id)}`); }
  /** Mute, archive, pin or mark unread, for me only. */
  setChatPrefs(id: string, p: ChatPrefsInput) { return this.request<ConversationSummary>('PUT', `/v1/conversations/${encodeURIComponent(id)}/prefs`, p); }
  /** Removes every message so far from my view of this chat. */
  clearChat(id: string) { return this.request<ConversationSummary>('POST', `/v1/conversations/${encodeURIComponent(id)}/clear`, {}); }
  chatOverview(id: string) { return this.request<ChatOverview>('GET', `/v1/conversations/${encodeURIComponent(id)}/overview`); }
  sharedItems(id: string, tab: SharedTab, before?: number) { return this.request<SharedPage>('GET', `/v1/conversations/${encodeURIComponent(id)}/shared?tab=${tab}${before ? `&before=${before}` : ''}`); }
  block(userId: string) { return this.request<void>('POST', '/v1/blocks', { userId }); }
  unblock(userId: string) { return this.request<void>('DELETE', `/v1/blocks/${encodeURIComponent(userId)}`); }
  blocked() { return this.request<PublicProfile[]>('GET', '/v1/blocks'); }
  report(r: ReportInput) { return this.request<void>('POST', '/v1/reports', r); }
  openDirect(userId: string) { return this.request<ConversationSummary>('POST', '/v1/conversations/direct', { userId }); }
  messages(conversationId: string, opts: { before?: number; after?: number; limit?: number } = {}) {
    const q = new URLSearchParams();
    if (opts.before !== undefined) q.set('before', String(opts.before));
    if (opts.after !== undefined) q.set('after', String(opts.after));
    if (opts.limit) q.set('limit', String(opts.limit));
    const s = q.toString();
    return this.request<MessagePage>('GET', `/v1/conversations/${encodeURIComponent(conversationId)}/messages${s ? `?${s}` : ''}`);
  }
  sendMessage(conversationId: string, clientId: string, text: string, replyToId?: string, attachment?: AttachmentInput, mentions?: string[]) {
    return this.request<SendResult>('POST', `/v1/conversations/${encodeURIComponent(conversationId)}/messages`, { clientId, text, ...(replyToId ? { replyToId } : {}), ...(attachment ? { attachment } : {}), ...(mentions?.length ? { mentions } : {}) });
  }
  createPoll(conversationId: string, p: CreatePollInput) { return this.request<SendResult>('POST', `/v1/conversations/${encodeURIComponent(conversationId)}/polls`, p); }
  vote(c: string, m: string, options: string[]) { return this.request<ChatMessage>('PUT', `${this.msgUrl(c, m)}/vote`, { options }); }
  /** A signed link to upload one file to. */
  uploadTicket(body: { purpose: 'media' | 'thumb' | 'avatar'; kind?: AttachmentKind; contentType: string; size: number; name?: string }) {
    return this.request<UploadTicket>('POST', '/v1/media/upload-url', body);
  }
  private msgUrl(c: string, m: string, tail = '') { return `/v1/conversations/${encodeURIComponent(c)}/messages/${encodeURIComponent(m)}${tail}`; }
  editMessage(c: string, m: string, text: string, mentions?: string[]) { return this.request<ChatMessage>('PATCH', this.msgUrl(c, m), { text, ...(mentions ? { mentions } : {}) }); }
  deleteMessage(c: string, m: string, forWho: 'me' | 'everyone') { return this.request<ChatMessage | { hidden: true }>('DELETE', this.msgUrl(c, m, `?for=${forWho}`)); }
  react(c: string, m: string, emoji: string | null) { return emoji ? this.request<ChatMessage>('PUT', this.msgUrl(c, m, '/reaction'), { emoji }) : this.request<ChatMessage>('DELETE', this.msgUrl(c, m, '/reaction')); }
  pinMessage(c: string, m: string, on: boolean) { return this.request<ConversationSummary>(on ? 'POST' : 'DELETE', this.msgUrl(c, m, '/pin'), on ? {} : undefined); }
  starMessage(c: string, m: string, on: boolean) { return this.request<ChatMessage>(on ? 'PUT' : 'DELETE', this.msgUrl(c, m, '/star'), on ? {} : undefined); }
  messageInfo(c: string, m: string) { return this.request<MessageInfo>('GET', this.msgUrl(c, m, '/info')); }
  forward(c: string, m: string, body: { targets: Array<{ conversationId: string; clientId: string; commentClientId?: string }>; comment?: string }) {
    return this.request<Array<{ conversationId: string; ok: boolean; message?: ChatMessage; error?: string }>>('POST', this.msgUrl(c, m, '/forward'), body);
  }
  starred(before?: string, conversationId?: string) {
    const q = new URLSearchParams();
    if (before) q.set('before', before);
    if (conversationId) q.set('conversationId', conversationId);
    const s = q.toString();
    return this.request<{ items: StarredItem[]; next: string | null }>('GET', `/v1/starred${s ? `?${s}` : ''}`);
  }
  markDelivered(conversationId: string, seq: number) { return this.request<MemberReceipt>('POST', `/v1/conversations/${encodeURIComponent(conversationId)}/delivered`, { seq }); }
  markRead(conversationId: string, seq: number) { return this.request<MemberReceipt>('POST', `/v1/conversations/${encodeURIComponent(conversationId)}/read`, { seq }); }
  /** Public profiles by id (names and photos for group members, past and present). */
  profiles(ids: string[]) { return this.request<PublicProfile[]>('GET', `/v1/users/profiles?ids=${ids.map(encodeURIComponent).join(',')}`); }

  /** Uploads a photo and returns its storage key (for a profile or group photo). */
  /** A photo for a circle post (kept with media, not profile pictures). */
  uploadPostPhoto(file: Blob) { return this.uploadPhoto(file, 'media'); }
  async uploadPhoto(file: Blob, purpose: 'avatar' | 'media' = 'avatar'): Promise<string> {
    const t = await this.request<{ key: string; uploadUrl: string; headers: Record<string, string> }>('POST', '/v1/media/upload-url', purpose === 'avatar' ? { purpose, contentType: file.type, size: file.size } : { purpose, kind: 'image', contentType: file.type, size: file.size });
    let r: Response;
    try { r = await this.f(t.uploadUrl, { method: 'PUT', headers: t.headers, body: file }); }
    catch { throw new ApiError(0, ErrorCode.PROVIDER_UNAVAILABLE, "The photo didn't upload. Check your connection and try again."); }
    if (!r.ok) throw new ApiError(r.status, ErrorCode.INTERNAL, "The photo didn't upload. Try again.");
    return t.key;
  }

  // ---- calls ----
  startCall(conversationId: string, media: CallMedia) { return this.request<CallJoin>('POST', '/v1/calls', { conversationId, media }); }
  callHistory(q: { before?: string; filter?: 'all' | 'missed' | 'video'; conversationId?: string; limit?: number } = {}) {
    const qs = new URLSearchParams(Object.entries(q).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])).toString();
    return this.request<CallHistoryPage>('GET', `/v1/calls${qs ? `?${qs}` : ''}`);
  }
  liveCalls() { return this.request<CallView[]>('GET', '/v1/calls/live'); }
  callsSeen() { return this.request<void>('POST', '/v1/calls/seen', {}); }
  forgetCalls(ids: string[]) { return this.request<void>('POST', '/v1/calls/forget', { ids }); }
  call(id: string) { return this.request<CallView>('GET', `/v1/calls/${encodeURIComponent(id)}`); }
  acceptCall(id: string) { return this.request<CallJoin>('POST', `/v1/calls/${encodeURIComponent(id)}/accept`, {}); }
  declineCall(id: string) { return this.request<CallView>('POST', `/v1/calls/${encodeURIComponent(id)}/decline`, {}); }
  leaveCall(id: string) { return this.request<CallView>('POST', `/v1/calls/${encodeURIComponent(id)}/leave`, {}); }
  inviteToCall(id: string, userIds: string[]) { return this.request<CallView>('POST', `/v1/calls/${encodeURIComponent(id)}/invite`, { userIds }); }
  admitToCall(id: string, userId: string, allow: boolean) { return this.request<CallView>('POST', `/v1/calls/${encodeURIComponent(id)}/admit`, { userId, allow }); }
  createCallLink(v: { name?: string; media?: CallMedia; approve?: boolean }) { return this.request<CallLink>('POST', '/v1/call-links', v); }
  updateCallLink(code: string, v: { name?: string; media?: CallMedia; approve?: boolean }) { return this.request<CallLink>('PATCH', `/v1/call-links/${encodeURIComponent(code)}`, v); }
  callLinks() { return this.request<CallLink[]>('GET', '/v1/call-links'); }
  callLink(code: string) { return this.request<CallLinkPreview>('GET', `/v1/call-links/${encodeURIComponent(code)}`); }
  joinCallLink(code: string) { return this.request<CallLinkJoin>('POST', `/v1/call-links/${encodeURIComponent(code)}/join`, {}); }
  revokeCallLink(code: string) { return this.request<void>('DELETE', `/v1/call-links/${encodeURIComponent(code)}`); }

  // ---- communities ----
  communities() { return this.request<CommunitySummary[]>('GET', '/v1/communities'); }
  createCommunity(v: { name: string; about?: string; photoKey?: string | null; approveNew?: boolean; membersSuggest?: boolean; groupIds?: string[]; newGroups?: string[] }) { return this.request<CommunityInfo>('POST', '/v1/communities', v); }
  community(id: string) { return this.request<CommunityInfo>('GET', `/v1/communities/${encodeURIComponent(id)}`); }
  updateCommunity(id: string, v: { name?: string; about?: string; photoKey?: string | null; approveNew?: boolean; membersSuggest?: boolean }) { return this.request<CommunityInfo>('PATCH', `/v1/communities/${encodeURIComponent(id)}`, v); }
  leaveCommunity(id: string) { return this.request<void>('POST', `/v1/communities/${encodeURIComponent(id)}/leave`, {}); }
  addCommunityGroup(id: string, v: { groupId: string } | { name: string }) { return this.request<CommunityInfo>('POST', `/v1/communities/${encodeURIComponent(id)}/groups`, v); }
  removeCommunityGroup(id: string, gid: string) { return this.request<CommunityInfo>('DELETE', `/v1/communities/${encodeURIComponent(id)}/groups/${encodeURIComponent(gid)}`); }
  joinCommunityGroup(id: string, gid: string) { return this.request<JoinResult>('POST', `/v1/communities/${encodeURIComponent(id)}/groups/${encodeURIComponent(gid)}/join`, {}); }
  suggestCommunityGroup(id: string, gid: string) { return this.request<void>('POST', `/v1/communities/${encodeURIComponent(id)}/suggestions/${encodeURIComponent(gid)}`, {}); }
  approveSuggestion(id: string, gid: string) { return this.request<CommunityInfo>('POST', `/v1/communities/${encodeURIComponent(id)}/suggestions/${encodeURIComponent(gid)}/approve`, {}); }
  declineSuggestion(id: string, gid: string) { return this.request<void>('DELETE', `/v1/communities/${encodeURIComponent(id)}/suggestions/${encodeURIComponent(gid)}`); }
  communityMembers(id: string, before?: string) { return this.request<{ items: CommunityMember[]; next: string | null }>('GET', `/v1/communities/${encodeURIComponent(id)}/members${before ? `?before=${encodeURIComponent(before)}` : ''}`); }
  removeCommunityMember(id: string, uid: string) { return this.request<void>('DELETE', `/v1/communities/${encodeURIComponent(id)}/members/${encodeURIComponent(uid)}`); }
  setCommunityAdmin(id: string, uid: string, on: boolean) { return this.request<void>(on ? 'PUT' : 'DELETE', `/v1/communities/${encodeURIComponent(id)}/admins/${encodeURIComponent(uid)}`, on ? {} : undefined); }
  communityInvite(id: string) { return this.request<{ inviteCode: string }>('POST', `/v1/communities/${encodeURIComponent(id)}/invite`, {}); }
  revokeCommunityInvite(id: string) { return this.request<void>('DELETE', `/v1/communities/${encodeURIComponent(id)}/invite`); }
  previewCommunityInvite(code: string) { return this.request<CommunityInvitePreview>('GET', `/v1/community-invites/${encodeURIComponent(code)}`); }
  joinCommunity(code: string) { return this.request<CommunityJoinResult>('POST', `/v1/community-invites/${encodeURIComponent(code)}/join`, {}); }
  cancelCommunityRequest(code: string) { return this.request<void>('DELETE', `/v1/community-invites/${encodeURIComponent(code)}/request`); }
  communityRequests(id: string) { return this.request<JoinRequest[]>('GET', `/v1/communities/${encodeURIComponent(id)}/requests`); }
  approveCommunityRequest(id: string, uid: string | 'all') { return this.request<{ approved: number }>('POST', `/v1/communities/${encodeURIComponent(id)}/requests/${encodeURIComponent(uid)}/approve`, {}); }
  declineCommunityRequest(id: string, uid: string) { return this.request<void>('DELETE', `/v1/communities/${encodeURIComponent(id)}/requests/${encodeURIComponent(uid)}`); }
  communityReports(id: string) { return this.request<CommunityReport[]>('GET', `/v1/communities/${encodeURIComponent(id)}/reports`); }
  moderate(id: string, reportId: string, action: 'delete' | 'remove' | 'keep') { return this.request<void>('POST', `/v1/communities/${encodeURIComponent(id)}/reports/${encodeURIComponent(reportId)}`, { action }); }

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

  // ---- points, rewards and pop-ups ----
  points() { return this.request<PointsSummary>('GET', '/v1/rewards/points'); }
  pointsHistory(filter: 'all' | 'earned' | 'spent' | 'pending' = 'all', before?: string) { return this.request<PointsHistoryPage>('GET', `/v1/rewards/history?filter=${filter}${before ? `&before=${encodeURIComponent(before)}` : ''}`); }
  checkin() { return this.request<CheckinStatus>('GET', '/v1/rewards/checkin'); }
  claimCheckin() { return this.request<CheckinStatus>('POST', '/v1/rewards/checkin', {}); }
  earnToday() { return this.request<EarnToday>('GET', '/v1/rewards/today'); }
  referrals() { return this.request<ReferralSummary>('GET', '/v1/rewards/referrals'); }
  useReferralCode(code: string) { return this.request<{ ok: true; inviter: string }>('POST', '/v1/rewards/referrals/use', { code }); }
  bonuses() { return this.request<BonusCampaign[]>('GET', '/v1/rewards/bonuses'); }
  popupNow() { return this.request<PopupNow>('GET', '/v1/rewards/popup'); }
  dismissPopup(popup: 'checkin' | 'jack-daily' | 'btcy-weekly' | 'bonuses', forever = false) { return this.request<void>('POST', '/v1/rewards/popup/dismiss', { popup, forever }); }

  // ---- Indexx account, wallet, BTCY, products ----
  indexx() { return this.request<IndexxLink>('GET', '/v1/indexx'); }
  linkIndexx(email: string) { return this.request<IndexxLink>('POST', '/v1/indexx/link', { email }); }
  unlinkIndexx() { return this.request<IndexxLink>('DELETE', '/v1/indexx/link'); }
  wallet() { return this.request<WalletView>('GET', '/v1/wallet'); }
  walletActivity(filter: 'all' | 'pay' | 'points' = 'all') { return this.request<WalletTx[]>('GET', `/v1/wallet/activity?filter=${filter}`); }
  convertPoints(points: number) { return this.request<WalletView>('POST', '/v1/wallet/convert', { points }); }
  btcy() { return this.request<BtcyView>('GET', '/v1/btcy'); }
  keepMining() { return this.request<BtcyView>('POST', '/v1/btcy/mine', {}); }
  products() { return this.request<ProductsView>('GET', '/v1/products'); }

  // ---- pay in chat ----
  setPayPin(pin: string, currentPin?: string) { return this.request<{ hasPayPin: true }>('PUT', '/v1/pay/pin', { pin, ...(currentPin ? { currentPin } : {}) }); }
  requestMoney(v: { conversationId: string; amountCents: number; note: string; clientId: string }) { return this.request<PaymentView>('POST', '/v1/pay/requests', v); }
  sendMoney(v: { conversationId: string; amountCents: number; note: string; clientId: string; pin: string }) { return this.request<PaymentView>('POST', '/v1/pay/send', v); }
  payRequest(id: string, pin: string) { return this.request<PaymentView>('POST', `/v1/pay/${encodeURIComponent(id)}/pay`, { pin }); }
  declineRequest(id: string) { return this.request<PaymentView>('POST', `/v1/pay/${encodeURIComponent(id)}/decline`, {}); }

  // ---- Jack's AI ----
  aiChats() { return this.request<AiChatSummary[]>('GET', '/v1/ai/chats'); }
  aiChat(id: string) { return this.request<AiChat>('GET', `/v1/ai/chats/${encodeURIComponent(id)}`); }
  aiAsk(chatId: string | null, text: string, mode: AiMode = 'chat') { return this.request<AiReply>('POST', chatId ? `/v1/ai/chats/${encodeURIComponent(chatId)}/messages` : '/v1/ai/chats', { text, mode }); }
  aiUpdateChat(id: string, v: { title?: string; saved?: boolean }) { return this.request<AiChatSummary>('PATCH', `/v1/ai/chats/${encodeURIComponent(id)}`, v); }
  aiDeleteChat(id: string) { return this.request<void>('DELETE', `/v1/ai/chats/${encodeURIComponent(id)}`); }
  aiQuota() { return this.request<AiQuota>('GET', '/v1/ai/quota'); }
  aiBuyMessages() { return this.request<AiQuota>('POST', '/v1/ai/quota/extra', {}); }
  aiConsent(conversationId: string) { return this.request<{ consent: boolean }>('GET', `/v1/ai/consent/${encodeURIComponent(conversationId)}`); }
  aiSetConsent(conversationId: string, on: boolean) { return this.request<{ consent: boolean }>(on ? 'PUT' : 'DELETE', `/v1/ai/consent/${encodeURIComponent(conversationId)}`, on ? {} : undefined); }
  aiSummarize(conversationId: string) { return this.request<AiSummary>('POST', '/v1/ai/summarize', { conversationId }); }
  siteAsk(messages: Array<{ role: 'user' | 'assistant'; text: string }>) { return this.request<{ text: string }>('POST', '/v1/site/ask', { messages }, { auth: false }); }
  siteLead(v: { name: string; email: string; question: string; consent: true }) { return this.request<void>('POST', '/v1/site/leads', v, { auth: false }); }

  // ---- support desk, socials ----
  supportAsk(question: string) { return this.request<SupportAnswer>('POST', '/v1/support/ask', { question }); }
  supportTicket(question: string, answer: string) { return this.request<SupportTicket>('POST', '/v1/support/tickets', { question, answer }); }
  socials() { return this.request<SocialsView>('GET', '/v1/me/socials'); }
  setSocial(network: SocialNetwork, handle: string) { return this.request<SocialsView>('PUT', `/v1/me/socials/${network}`, { network, handle }); }
  removeSocial(network: SocialNetwork) { return this.request<SocialsView>('DELETE', `/v1/me/socials/${network}`); }
  socialVisibility(visibility: 'everyone' | 'contacts' | 'nobody') { return this.request<SocialsView>('PUT', '/v1/me/socials', { visibility }); }
  /** Where to send the browser to link Facebook (Facebook's own page, or the dev stand-in). */
  linkFacebook(login: boolean) { return this.request<{ url: string }>('POST', '/v1/me/socials/facebook/start', { login }); }
  facebookLogin(on: boolean) { return this.request<SocialsView>('PUT', '/v1/me/socials/facebook/login', { on }); }
  unlinkFacebook() { return this.request<SocialsView>('DELETE', '/v1/me/socials/facebook'); }
  /** Sign in with Facebook: where to send the browser. It comes back to /sign-in with a ticket. */
  facebookSignInStart() { return this.request<{ url: string }>('POST', '/v1/auth/facebook/start', { device: this.o.device }, { auth: false }); }
  async facebookSignIn(ticket: string) { return this.signedIn(await this.request<SignInResult>('POST', '/v1/auth/facebook/finish', { ticket }, { auth: false })); }
  userSocials(userId: string) { return this.request<SocialsView>('GET', `/v1/users/${encodeURIComponent(userId)}/socials`); }

  // ---- circles ----
  myCircles() { return this.request<MyCircles>('GET', '/v1/circles'); }
  discoverCircles(q = '', category = '') { const p = new URLSearchParams(); if (q) p.set('q', q); if (category) p.set('category', category); const s = p.toString(); return this.request<CircleDiscover>('GET', `/v1/circles/discover${s ? `?${s}` : ''}`); }
  createCircle(v: CreateCircleInput) { return this.request<CircleView>('POST', '/v1/circles', v); }
  circle(id: string) { return this.request<CircleView>('GET', `/v1/circles/${c(id)}`); }
  updateCircle(id: string, v: UpdateCircleInput) { return this.request<CircleView>('PATCH', `/v1/circles/${c(id)}`, v); }
  deleteCircle(id: string) { return this.request<void>('DELETE', `/v1/circles/${c(id)}`); }
  joinCircle(id: string, answer?: string) { return this.request<CircleView>('POST', `/v1/circles/${c(id)}/join`, answer ? { answer } : {}); }
  cancelCircleRequest(id: string) { return this.request<CircleView>('DELETE', `/v1/circles/${c(id)}/request`); }
  leaveCircle(id: string) { return this.request<void>('POST', `/v1/circles/${c(id)}/leave`, {}); }
  setCircleOwner(id: string, userId: string) { return this.request<CircleView>('POST', `/v1/circles/${c(id)}/owner`, { userId }); }
  circleMembers(id: string) { return this.request<CircleMemberRow[]>('GET', `/v1/circles/${c(id)}/members`); }
  muteCircleMember(id: string, userId: string, days: number, reason = '') { return this.request<void>('PUT', `/v1/circles/${c(id)}/mutes/${c(userId)}`, { days, reason }); }
  unmuteCircleMember(id: string, userId: string) { return this.request<void>('DELETE', `/v1/circles/${c(id)}/mutes/${c(userId)}`); }
  removeCircleMember(id: string, userId: string, reason = '') { return this.request<void>('POST', `/v1/circles/${c(id)}/members/${c(userId)}/remove`, { reason }); }
  circleFeed(id: string, before?: string) { return this.request<CircleFeed>('GET', `/v1/circles/${c(id)}/posts${before ? `?before=${encodeURIComponent(before)}` : ''}`); }
  createCirclePost(id: string, v: CirclePostInput) { return this.request<CirclePost>('POST', `/v1/circles/${c(id)}/posts`, v); }
  circlePost(id: string) { return this.request<CirclePost>('GET', `/v1/circle-posts/${c(id)}`); }
  editCirclePost(id: string, text: string) { return this.request<CirclePost>('PATCH', `/v1/circle-posts/${c(id)}`, { text }); }
  deleteCirclePost(id: string) { return this.request<void>('DELETE', `/v1/circle-posts/${c(id)}`); }
  likeCirclePost(id: string, on: boolean) { return this.request<CirclePost>(on ? 'PUT' : 'DELETE', `/v1/circle-posts/${c(id)}/like`); }
  pinCirclePost(id: string, on: boolean) { return this.request<CirclePost>(on ? 'PUT' : 'DELETE', `/v1/circle-posts/${c(id)}/pin`); }
  approveCirclePost(id: string) { return this.request<CirclePost>('POST', `/v1/circle-posts/${c(id)}/approve`, {}); }
  removeCirclePost(id: string, reason = '') { return this.request<CirclePost>('POST', `/v1/circle-posts/${c(id)}/remove`, { reason }); }
  reportCirclePost(id: string, reason: PostReportReason, block = false) { return this.request<void>('POST', `/v1/circle-posts/${c(id)}/report`, { reason, block }); }
  circleComments(postId: string) { return this.request<CircleComment[]>('GET', `/v1/circle-posts/${c(postId)}/comments`); }
  commentOnCirclePost(postId: string, text: string, parentId?: string) { return this.request<CircleComment>('POST', `/v1/circle-posts/${c(postId)}/comments`, { text, ...(parentId ? { parentId } : {}) }); }
  deleteCircleComment(id: string) { return this.request<void>('DELETE', `/v1/circle-comments/${c(id)}`); }
  markCircleAnswer(id: string, on: boolean) { return this.request<CircleComment>(on ? 'PUT' : 'DELETE', `/v1/circle-comments/${c(id)}/answer`); }
  circleReview(id: string) { return this.request<CircleReview>('GET', `/v1/circles/${c(id)}/review`); }
  settleCircleReport(circleId: string, reportId: string, action: 'remove' | 'keep', reason = '') { return this.request<void>('POST', `/v1/circles/${c(circleId)}/review/${c(reportId)}`, { action, reason }); }
  circleEvents(id: string, past = false) { return this.request<CircleEvent[]>('GET', `/v1/circles/${c(id)}/events${past ? '?past=1' : ''}`); }
  createCircleEvent(id: string, v: CreateEventInput) { return this.request<CircleEvent>('POST', `/v1/circles/${c(id)}/events`, v); }
  circleEvent(id: string) { return this.request<CircleEvent>('GET', `/v1/circle-events/${c(id)}`); }
  updateCircleEvent(id: string, v: UpdateEventInput) { return this.request<CircleEvent>('PATCH', `/v1/circle-events/${c(id)}`, v); }
  cancelCircleEvent(id: string, note = '') { return this.request<CircleEvent>('POST', `/v1/circle-events/${c(id)}/cancel`, { note }); }
  rsvp(id: string, status: Extract<RsvpStatus, 'going' | 'interested' | 'not_going'>) { return this.request<CircleEvent>('PUT', `/v1/circle-events/${c(id)}/rsvp`, { status }); }
  leaveWaitlist(id: string) { return this.request<CircleEvent>('DELETE', `/v1/circle-events/${c(id)}/rsvp`); }
  confirmSeat(id: string) { return this.request<CircleEvent>('POST', `/v1/circle-events/${c(id)}/confirm`, {}); }
  ackEventChange(id: string) { return this.request<CircleEvent>('POST', `/v1/circle-events/${c(id)}/ack`, {}); }
  rateEvent(id: string, stars: number) { return this.request<CircleEvent>('PUT', `/v1/circle-events/${c(id)}/rating`, { stars }); }
  eventQuestions(id: string) { return this.request<CircleComment[]>('GET', `/v1/circle-events/${c(id)}/questions`); }
  askEventQuestion(id: string, text: string, parentId?: string) { return this.request<CircleComment>('POST', `/v1/circle-events/${c(id)}/questions`, { text, ...(parentId ? { parentId } : {}) }); }

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

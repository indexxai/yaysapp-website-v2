import { randomBytes } from 'crypto';
import type Redis from 'ioredis';
import { ObjectId, type Collection } from 'mongodb';
import type { DeviceInput } from './sessions';
import { AppError } from '../common/app-error';
import type { Config } from '../config';
import type { Logger } from '../common/logger';
import { isDuplicate, type UserDoc } from '../users/users.repo';

export interface FacebookIdentity { id: string; name: string; photoUrl: string | null }
export interface FacebookProvider {
  readonly available: boolean;
  /** Facebook's own page where the person confirms. */
  authUrl(state: string, redirectUri: string): string;
  /** The code Facebook sent back, turned into who the person is. */
  exchange(code: string, redirectUri: string): Promise<FacebookIdentity>;
}

const GRAPH = 'https://graph.facebook.com/v21.0';

/** Facebook Login (OAuth): only public_profile is asked for, so no posting, friends or email. */
export class RealFacebook implements FacebookProvider {
  readonly available = true;
  constructor(private readonly c: Config, private readonly log: Logger, private readonly f: typeof fetch = fetch) {}
  authUrl(state: string, redirectUri: string) {
    const q = new URLSearchParams({ client_id: this.c.FACEBOOK_APP_ID!, redirect_uri: redirectUri, state, response_type: 'code', scope: 'public_profile' });
    return `https://www.facebook.com/v21.0/dialog/oauth?${q}`;
  }
  async exchange(code: string, redirectUri: string): Promise<FacebookIdentity> {
    const tq = new URLSearchParams({ client_id: this.c.FACEBOOK_APP_ID!, client_secret: this.c.FACEBOOK_APP_SECRET!, redirect_uri: redirectUri, code });
    const t = await this.f(`${GRAPH}/oauth/access_token?${tq}`);
    if (!t.ok) { this.log.warn({ status: t.status }, 'facebook code exchange failed'); throw AppError.unauthenticated('Facebook didn’t confirm. Try again.'); }
    const { access_token } = (await t.json()) as { access_token: string };
    const me = await this.f(`${GRAPH}/me?${new URLSearchParams({ fields: 'id,name,picture.type(large)', access_token })}`);
    if (!me.ok) throw AppError.unauthenticated('Facebook didn’t share your profile. Try again.');
    const p = (await me.json()) as { id: string; name?: string; picture?: { data?: { url?: string; is_silhouette?: boolean } } };
    return { id: p.id, name: p.name ?? 'Facebook user', photoUrl: p.picture?.data && !p.picture.data.is_silhouette ? p.picture.data.url ?? null : null };
  }
}

/**
 * Development and tests: a stand-in for Facebook's page, served by this API, where you type a name.
 * The same name always gives the same Facebook id. Refused in production.
 */
export class DevFacebook implements FacebookProvider {
  readonly available = true;
  constructor(private readonly publicUrl: string) {}
  authUrl(state: string) { return `${this.publicUrl.replace(/\/$/, '')}/v1/oauth/facebook/dev?state=${encodeURIComponent(state)}`; }
  async exchange(code: string): Promise<FacebookIdentity> {
    if (!code.startsWith('dev:')) throw AppError.unauthenticated('Facebook didn’t confirm. Try again.');
    const name = code.slice(4).trim().slice(0, 60) || 'Facebook user';
    return { id: `dev-${Buffer.from(name.toLowerCase()).toString('hex').slice(0, 24)}`, name, photoUrl: null };
  }
}

export const offFacebook: FacebookProvider = {
  available: false,
  authUrl: () => { throw AppError.validation('Facebook isn’t set up on this server yet.'); },
  exchange: async () => { throw AppError.validation('Facebook isn’t set up on this server yet.'); },
};

export function createFacebook(c: Config, log: Logger): FacebookProvider {
  return c.FACEBOOK_DRIVER === 'facebook' ? new RealFacebook(c, log) : c.FACEBOOK_DRIVER === 'dev' ? new DevFacebook(c.PUBLIC_URL) : offFacebook;
}

export interface FacebookFields { facebook?: { id: string; name: string; photoUrl: string | null; login: boolean; linkedAt: Date } }
type Pending = { purpose: 'link'; uid: string; login: boolean } | { purpose: 'login'; device: DeviceInput };
const STATE_SECONDS = 600, TICKET_SECONDS = 120;

/**
 * Linking Facebook to an account, and signing in with it. Facebook never creates an account: every account
 * starts with a verified phone number, and Facebook works once it's linked.
 */
export class FacebookService {
  constructor(private readonly fb: FacebookProvider, private readonly users: Collection<UserDoc>, private readonly redis: Redis, private readonly c: Config) {}
  get available() { return this.fb.available; }
  private callbackUrl() { return `${this.c.PUBLIC_URL.replace(/\/$/, '')}/v1/oauth/facebook/callback`; }
  private web(path: string) { return `${this.c.WEB_URL.replace(/\/$/, '')}${path}`; }

  private async begin(p: Pending) {
    const state = randomBytes(24).toString('base64url');
    await this.redis.set(`fb:s:${state}`, JSON.stringify(p), 'EX', STATE_SECONDS);
    return { url: this.fb.authUrl(state, this.callbackUrl()) };
  }
  startLink(me: ObjectId, login: boolean) { if (!this.fb.available) throw AppError.validation('Facebook isn’t set up on this server yet.'); return this.begin({ purpose: 'link', uid: me.toHexString(), login }); }
  startLogin(device: DeviceInput) { if (!this.fb.available) throw AppError.validation('Facebook sign-in isn’t set up on this server yet.'); return this.begin({ purpose: 'login', device }); }

  /** Facebook sent the browser back here. Returns where the browser goes next, in the web app. */
  async callback(q: { state?: string; code?: string; error?: string }): Promise<string> {
    const raw = q.state ? await this.redis.getdel(`fb:s:${q.state}`) : null;
    if (!raw) return this.web('/sign-in?fb=expired');
    const p = JSON.parse(raw) as Pending;
    const back = (k: string, extra = '') => this.web(`${p.purpose === 'link' ? '/settings/socials' : '/sign-in'}?fb=${k}${extra}`);
    if (q.error || !q.code) return back('cancelled');
    let who: FacebookIdentity;
    try { who = await this.fb.exchange(q.code, this.callbackUrl()); } catch { return back('error'); }
    if (p.purpose === 'link') {
      const me = new ObjectId(p.uid);
      const other = await this.users.findOne({ 'yc.facebook.id': who.id, _id: { $ne: me } } as Record<string, unknown>, { projection: { _id: 1 } });
      if (other) return back('taken');
      try { await this.users.updateOne({ _id: me }, { $set: { 'yc.facebook': { id: who.id, name: who.name, photoUrl: who.photoUrl, login: p.login, linkedAt: new Date() } } }); }
      catch (e) { if (isDuplicate(e)) return back('taken'); throw e; }
      return back('linked');
    }
    const u = await this.users.findOne({ 'yc.facebook.id': who.id, 'yc.facebook.login': true, 'yc.deletedAt': { $exists: false } } as Record<string, unknown>, { projection: { _id: 1 } });
    if (!u) return back('not_linked', `&fb_name=${encodeURIComponent(who.name)}`);
    const ticket = randomBytes(24).toString('base64url');
    await this.redis.set(`fb:t:${ticket}`, JSON.stringify({ uid: u._id.toHexString(), device: p.device }), 'EX', TICKET_SECONDS);
    return this.web(`/sign-in?fb_ticket=${ticket}`);
  }

  /** The web app trades the one-time ticket for a session (or the PIN step). */
  async takeTicket(ticket: string): Promise<{ user: UserDoc; device: DeviceInput }> {
    const raw = await this.redis.getdel(`fb:t:${ticket}`);
    if (!raw) throw AppError.unauthenticated('That Facebook sign-in expired. Try again.');
    const t = JSON.parse(raw) as { uid: string; device: DeviceInput };
    const user = await this.users.findOne({ _id: new ObjectId(t.uid) });
    if (!user || !(user.yc as FacebookFields | undefined)?.facebook?.login) throw AppError.unauthenticated('Facebook sign-in is off for this account.');
    return { user, device: t.device };
  }

  async setLogin(me: ObjectId, on: boolean) {
    const r = await this.users.updateOne({ _id: me, 'yc.facebook.id': { $exists: true } } as Record<string, unknown>, { $set: { 'yc.facebook.login': on } });
    if (!r.matchedCount) throw AppError.validation('Link Facebook first.');
  }
  async unlink(me: ObjectId) { await this.users.updateOne({ _id: me }, { $unset: { 'yc.facebook': '' } }); }
}
export const FACEBOOK = Symbol('FACEBOOK');

/** The stand-in Facebook page (development only). Plain HTML, no scripts. */
export function devFacebookPage(state: string, callback: string) {
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Facebook (development stand-in)</title>
<style>body{margin:0;font:15px/1.4 Helvetica,Arial,sans-serif;background:#f0f2f5;color:#1c1e21;display:grid;place-items:center;min-height:100vh}main{width:min(400px,92vw);background:#fff;border-radius:12px;box-shadow:0 2px 12px rgba(0,0,0,.12);padding:28px;display:flex;flex-direction:column;gap:14px;text-align:center}
.tag{align-self:center;padding:4px 10px;border-radius:999px;background:#fff3cd;color:#7a5b00;font-size:12px;font-weight:700}h1{margin:0;font-size:20px}input{font:16px Helvetica,Arial;padding:12px;border:1px solid #ccd0d5;border-radius:8px}button{font:700 16px Helvetica,Arial;padding:12px;border:0;border-radius:8px;background:#1877f2;color:#fff;cursor:pointer}a{color:#65676b}</style></head>
<body><main><span class="tag">Development stand-in · not the real Facebook</span><h1>YaysApp is asking for your name and profile picture</h1>
<form method="get" action="${esc(callback)}" style="display:flex;flex-direction:column;gap:12px"><input type="hidden" name="state" value="${esc(state)}"><label style="text-align:left;font-size:13px;color:#65676b">Your Facebook name<input name="dev_name" value="Sara Ahmed" required style="display:block;width:100%;box-sizing:border-box;margin-top:4px"></label><button type="submit">Continue</button></form>
<a href="${esc(callback)}?state=${encodeURIComponent(state)}&error=access_denied">Cancel</a></main></body></html>`;
}

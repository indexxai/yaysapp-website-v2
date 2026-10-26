import { OAuth2Client } from 'google-auth-library';
import { AppError } from '../common/app-error';
import type { Config } from '../config';

export interface GoogleIdentity { sub: string; email: string; name?: string; picture?: string }
export interface GoogleVerifier { verify(idToken: string): Promise<GoogleIdentity> }

export class RealGoogleVerifier implements GoogleVerifier {
  private client = new OAuth2Client();
  constructor(private readonly audiences: string[]) {}
  async verify(idToken: string) {
    let p;
    try { p = (await this.client.verifyIdToken({ idToken, audience: this.audiences })).getPayload(); }
    catch { throw AppError.unauthenticated('Google sign-in failed. Try again.'); }
    if (!p?.sub || !p.email) throw AppError.unauthenticated('Google did not share an email address.');
    if (!p.email_verified) throw AppError.unauthenticated('Your Google email is not verified.');
    return { sub: p.sub, email: p.email.toLowerCase(), name: p.name, picture: p.picture };
  }
}

/** Dev/test: accepts `dev.<base64url JSON>` tokens so flows can be tested without Google. Refused in production by config. */
export class DevGoogleVerifier implements GoogleVerifier {
  async verify(idToken: string) {
    if (!idToken.startsWith('dev.')) throw AppError.unauthenticated('Google sign-in failed. Try again.');
    let p: { sub?: string; email?: string; email_verified?: boolean; name?: string };
    try { p = JSON.parse(Buffer.from(idToken.slice(4), 'base64url').toString()); } catch { throw AppError.unauthenticated('Google sign-in failed. Try again.'); }
    if (!p.sub || !p.email) throw AppError.unauthenticated('Google did not share an email address.');
    if (p.email_verified === false) throw AppError.unauthenticated('Your Google email is not verified.');
    return { sub: p.sub, email: p.email.toLowerCase(), name: p.name };
  }
}
export const GOOGLE = Symbol('GOOGLE');
export const createGoogleVerifier = (c: Config): GoogleVerifier => c.GOOGLE_DRIVER === 'google' ? new RealGoogleVerifier(c.googleClientIds) : new DevGoogleVerifier();

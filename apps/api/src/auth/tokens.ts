import { createHash, randomBytes } from 'crypto';
import { SignJWT, jwtVerify, errors } from 'jose';
import { AppError } from '../common/app-error';

export interface AccessClaims { sub: string; sid: string }
export interface SignupClaims { phone: string; jti: string }

export class TokenService {
  private key: Uint8Array;
  constructor(secret: string, private readonly accessTtl: number) { this.key = new TextEncoder().encode(secret); }

  async access(userId: string, sid: string) {
    const exp = Math.floor(Date.now() / 1000) + this.accessTtl;
    const token = await new SignJWT({ sid, typ: 'access' }).setProtectedHeader({ alg: 'HS256' }).setSubject(userId).setIssuedAt().setExpirationTime(exp).sign(this.key);
    return { token, expiresAt: new Date(exp * 1000).toISOString() };
  }
  async verifyAccess(token: string): Promise<AccessClaims> {
    try {
      const { payload } = await jwtVerify(token, this.key, { algorithms: ['HS256'] });
      if (payload.typ !== 'access' || typeof payload.sub !== 'string' || typeof payload.sid !== 'string') throw AppError.unauthenticated();
      return { sub: payload.sub, sid: payload.sid };
    } catch (e) {
      if (e instanceof AppError) throw e;
      throw AppError.unauthenticated(e instanceof errors.JWTExpired ? 'Your session expired. Signing you in again.' : 'Please sign in again.');
    }
  }
  /** Proves a phone number was verified, for the 15 minutes it takes to add an email. */
  async signup(phone: string) {
    const jti = randomBytes(12).toString('base64url');
    return new SignJWT({ phone, typ: 'signup' }).setProtectedHeader({ alg: 'HS256' }).setJti(jti).setIssuedAt().setExpirationTime('15m').sign(this.key);
  }
  async verifySignup(token: string): Promise<SignupClaims> {
    try {
      const { payload } = await jwtVerify(token, this.key, { algorithms: ['HS256'] });
      if (payload.typ !== 'signup' || typeof payload.phone !== 'string' || !payload.jti) throw new Error('wrong type');
      return { phone: payload.phone, jti: payload.jti };
    } catch {
      throw AppError.unauthenticated('This sign-up step expired. Enter your phone number again.');
    }
  }
  static refreshSecret() { return randomBytes(32).toString('base64url'); }
  static hash(v: string) { return createHash('sha256').update(v).digest('base64url'); }
}
export const TOKENS = Symbol('TOKENS');

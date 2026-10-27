import { CanActivate, ExecutionContext, Inject, Injectable, createParamDecorator } from '@nestjs/common';
import { ObjectId } from 'mongodb';
import { ErrorCode } from '@yays/shared';
import { AppError } from '../common/app-error';
import { USERS, type UsersRepo } from '../users/users.repo';
import { SESSIONS, type SessionService } from './sessions';
import { TOKENS, type TokenService } from './tokens';

export interface AuthCtx { userId: ObjectId; sid: string }

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(@Inject(TOKENS) private tokens: TokenService, @Inject(SESSIONS) private sessions: SessionService, @Inject(USERS) private users: UsersRepo) {}
  async canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest<{ headers: Record<string, string | undefined>; auth?: AuthCtx }>();
    const h = req.headers.authorization ?? '';
    const m = /^Bearer\s+(\S+)$/i.exec(h);
    if (!m) throw AppError.unauthenticated();
    const claims = await this.tokens.verifyAccess(m[1]);
    await this.sessions.assertActive(claims.sid);
    if (!ObjectId.isValid(claims.sub)) throw AppError.unauthenticated();
    const userId = new ObjectId(claims.sub);
    const u = await this.users.col.findOne({ _id: userId }, { projection: { 'yc.disabledAt': 1 } });
    if (!u) throw AppError.unauthenticated();
    if (u.yc?.disabledAt) throw new AppError(403, ErrorCode.ACCOUNT_DISABLED, 'This account is turned off. Contact support.');
    req.auth = { userId, sid: claims.sid };
    void this.sessions.touch(claims.sid).catch(() => undefined);
    return true;
  }
}

export const Auth = createParamDecorator((_d: unknown, ctx: ExecutionContext): AuthCtx => ctx.switchToHttp().getRequest<{ auth: AuthCtx }>().auth);

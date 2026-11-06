import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { addEmailStartSchema, addEmailVerifySchema, addPhoneStartSchema, addPhoneVerifySchema, deleteAccountSchema, ErrorCode, notificationsSchema, pinCheckSchema, preferencesSchema, type AppPreferences, privacySchema, profileSchema, setPinSchema, USERNAME_RE } from '@yays/shared';
import { AppError } from '../common/app-error';
import { parse } from '../common/zod';
import { Auth, AuthGuard, type AuthCtx } from '../auth/auth.guard';
import { AUTH, type AuthService } from '../auth/auth.service';
import { SESSIONS, type SessionService } from '../auth/sessions';
import { RATE_LIMITER } from '../infra/tokens';
import type { RateLimiter } from '../infra/rate-limit';
import type { Db } from 'mongodb';
import { C, DB } from '../infra/mongo';
import { STORAGE, type Storage } from '../infra/storage';
import { isDuplicate, toMe, USERS, type UsersRepo } from './users.repo';
import { ACCOUNT, type AccountService } from './account.service';

/** Names people might confuse with staff or the brand. */
const RESERVED = new Set(['admin', 'administrator', 'support', 'help', 'yaysapp', 'yays', 'indexx', 'jack', 'jacks.ai', 'official', 'staff', 'moderator', 'system', 'security', 'root', 'null', 'undefined', 'me']);
const AVATAR_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const AVATAR_MAX = 5 * 1024 * 1024;

@Controller('v1/me')
@UseGuards(AuthGuard)
export class MeController {
  constructor(@Inject(USERS) private users: UsersRepo, @Inject(STORAGE) private storage: Storage, @Inject(AUTH) private auth: AuthService,
    @Inject(SESSIONS) private sessions: SessionService, @Inject(RATE_LIMITER) private limiter: RateLimiter, @Inject(ACCOUNT) private account: AccountService,
    @Inject(DB) private db: Db) {}
  private photo = (k: string) => this.storage.downloadUrl(k);

  @Get()
  async me(@Auth() a: AuthCtx) {
    const u = await this.users.byId(a.userId);
    if (!u) throw AppError.unauthenticated();
    return toMe(u, this.photo);
  }

  @Get('username-available')
  async usernameAvailable(@Auth() a: AuthCtx, @Query('u') raw = '') {
    const u = raw.trim().toLowerCase();
    if (!USERNAME_RE.test(u)) return { available: false, reason: 'Use 3–30 letters, numbers, dots or underscores.' };
    if (RESERVED.has(u)) return { available: false, reason: 'That username is reserved.' };
    await this.limiter.hit(`uname:${a.userId}`, 60, 60);
    return (await this.users.usernameFree(u, a.userId)) ? { available: true } : { available: false, reason: 'That username is taken.' };
  }

  @Patch()
  async update(@Auth() a: AuthCtx, @Body() b: unknown) {
    const v = parse(profileSchema, b);
    if (v.username !== undefined) {
      if (RESERVED.has(v.username)) throw AppError.validation('That username is reserved.', { fields: { username: 'That username is reserved.' } });
      if (!(await this.users.usernameFree(v.username, a.userId))) throw AppError.conflict('That username is taken.', ErrorCode.CONFLICT, { fields: { username: 'That username is taken.' } });
    }
    if (v.photoKey) {
      // Only photos this user uploaded, in the avatar folder, of an allowed type and size.
      if (!v.photoKey.startsWith(`avatars/${a.userId.toHexString()}/`)) throw AppError.forbidden('That photo was not uploaded by you.');
      const obj = await this.storage.head(v.photoKey);
      if (!obj) throw AppError.validation('The photo upload did not finish. Try again.');
      if (obj.size > AVATAR_MAX || !AVATAR_TYPES.has(obj.contentType)) throw AppError.validation('Photos must be JPG, PNG or WebP and under 5 MB.');
    }
    const set: Record<string, unknown> = {};
    if (v.displayName !== undefined) set.displayName = v.displayName;
    if (v.username !== undefined) set.username = v.username;
    if (v.about !== undefined) set.about = v.about;
    if (v.photoKey !== undefined) set.photoKey = v.photoKey;
    const before = v.photoKey !== undefined ? (await this.users.byId(a.userId))?.yc?.photoKey ?? null : null;
    try {
      const u = await this.users.setYc(a.userId, set);
      if (before && before !== v.photoKey) void this.dropOldPhoto(a.userId.toHexString(), before);
      return toMe(u!, this.photo);
    } catch (e) {
      if (isDuplicate(e, 'username')) throw AppError.conflict('That username is taken.', ErrorCode.CONFLICT, { fields: { username: 'That username is taken.' } });
      throw e;
    }
  }

  /** A replaced or removed profile photo is deleted from storage, unless the same file is also a group or circle photo. Best effort. */
  private async dropOldPhoto(me: string, key: string) {
    if (!key.startsWith(`avatars/${me}/`)) return;
    try {
      const used = (await this.db.collection(C.conversations).countDocuments({ photoKey: key }, { limit: 1 })) + (await this.db.collection(C.communities).countDocuments({ photoKey: key }, { limit: 1 }));
      if (!used) await this.storage.remove(key);
    } catch { /* an orphaned file is harmless */ }
  }

  @Post('phone/start') @HttpCode(200)
  startPhone(@Auth() a: AuthCtx, @Body() b: unknown, @Req() r: Request) { const v = parse(addPhoneStartSchema, b); return this.auth.startAddPhone(a.userId, v.phone, v.channel, r.ip ?? 'unknown'); }

  @Post('phone/verify') @HttpCode(200)
  async verifyPhone(@Auth() a: AuthCtx, @Body() b: unknown) { const v = parse(addPhoneVerifySchema, b); return toMe(await this.auth.verifyAddPhone(a.userId, v.phone, v.code), this.photo); }

  @Post('email/start') @HttpCode(200)
  startEmail(@Auth() a: AuthCtx, @Body() b: unknown, @Req() r: Request) { return this.auth.startAddEmail(a.userId, parse(addEmailStartSchema, b).email, r.ip ?? 'unknown'); }

  @Post('email/verify') @HttpCode(200)
  async verifyEmail(@Auth() a: AuthCtx, @Body() b: unknown) { const v = parse(addEmailVerifySchema, b); return toMe(await this.auth.verifyAddEmail(a.userId, v.email, v.code), this.photo); }

  @Get('devices')
  devices(@Auth() a: AuthCtx) { return this.sessions.list(a.userId, a.sid); }

  @Delete('devices/:id') @HttpCode(204)
  async revoke(@Auth() a: AuthCtx, @Param('id') id: string) {
    if (!/^[a-f0-9]{32}$/.test(id)) throw AppError.notFound('That device is not signed in.');
    await this.sessions.revokeOwn(a.userId, id);
  }

  @Post('devices/revoke-others') @HttpCode(200)
  async revokeOthers(@Auth() a: AuthCtx) { return { revoked: await this.sessions.revokeOthers(a.userId, a.sid) }; }

  @Put('two-step')
  setPin(@Auth() a: AuthCtx, @Body() b: unknown) { const v = parse(setPinSchema, b); return this.account.setPin(a.userId, v.pin, v.currentPin); }

  @Delete('two-step')
  removePin(@Auth() a: AuthCtx, @Body() b: unknown) { return this.account.removePin(a.userId, parse(pinCheckSchema, b).pin); }

  @Put('privacy')
  privacy(@Auth() a: AuthCtx, @Body() b: unknown) { return this.account.setPrivacy(a.userId, parse(privacySchema, b)); }

  @Put('notifications')
  notifications(@Auth() a: AuthCtx, @Body() b: unknown) { return this.account.setNotifications(a.userId, parse(notificationsSchema, b)); }

  @Put('preferences')
  preferences(@Auth() a: AuthCtx, @Body() b: unknown) { return this.account.setPreferences(a.userId, parse(preferencesSchema, b) as Partial<AppPreferences>); }

  @Post('delete/start') @HttpCode(200)
  startDelete(@Auth() a: AuthCtx, @Req() r: Request) { return this.account.startDelete(a.userId, r.ip ?? 'unknown'); }

  @Post('delete') @HttpCode(204)
  async remove(@Auth() a: AuthCtx, @Body() b: unknown) { const v = parse(deleteAccountSchema, b); await this.account.delete(a.userId, v.code, v.reason); }

  @Get('export')
  async exportData(@Auth() a: AuthCtx) {
    await this.limiter.hit(`export:${a.userId}`, 5, 3600, 'You can download your data a few times an hour. Try again later.');
    return this.account.export(a.userId);
  }
}

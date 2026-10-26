import { Body, Controller, HttpCode, Inject, Post, UseGuards } from '@nestjs/common';
import { contactsMatchSchema, normalizePhone, type ContactMatch } from '@yays/shared';
import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js/max';
import { parse } from '../common/zod';
import { Auth, AuthGuard, type AuthCtx } from '../auth/auth.guard';
import { RATE_LIMITER } from '../infra/tokens';
import type { RateLimiter } from '../infra/rate-limit';
import { STORAGE, type Storage } from '../infra/storage';
import { toPublic, USERS, type UsersRepo } from '../users/users.repo';

@Controller('v1/contacts')
@UseGuards(AuthGuard)
export class ContactsController {
  constructor(@Inject(USERS) private users: UsersRepo, @Inject(STORAGE) private storage: Storage, @Inject(RATE_LIMITER) private limiter: RateLimiter) {}

  /** Phone book in, YaysApp users out. Local numbers are read in the caller's own country. */
  @Post('match') @HttpCode(200)
  async match(@Auth() a: AuthCtx, @Body() b: unknown): Promise<ContactMatch[]> {
    const { phones } = parse(contactsMatchSchema, b);
    await this.limiter.hit(`contacts:${a.userId}`, 20, 3600, 'Contacts were synced many times in the last hour. Try again later.');
    const me = await this.users.byId(a.userId);
    const country = (me?.yc?.phoneE164 && parsePhoneNumberFromString(me.yc.phoneE164)?.country) || 'PK';
    const wanted = new Map<string, string>(); // E.164 -> as typed
    for (const raw of phones) { const n = normalizePhone(raw, country as CountryCode); if (n && n !== me?.yc?.phoneE164 && !wanted.has(n)) wanted.set(n, raw); }
    if (!wanted.size) return [];
    const found = await this.users.col.find({ 'yc.phoneE164': { $in: [...wanted.keys()] }, 'yc.disabledAt': { $exists: false } }).toArray();
    const photo = (k: string) => this.storage.downloadUrl(k);
    return Promise.all(found.map(async (u) => ({ phone: u.yc!.phoneE164!, user: await toPublic(u, photo) })));
  }
}

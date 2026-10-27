import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { ObjectId } from 'mongodb';
import { normalizeEmail, normalizePhone, openDirectSchema, receiptSchema, sendMessageSchema, USERNAME_RE, type PublicProfile } from '@yays/shared';
import { AppError } from '../common/app-error';
import { parse } from '../common/zod';
import { Auth, AuthGuard, type AuthCtx } from '../auth/auth.guard';
import { RATE_LIMITER } from '../infra/tokens';
import type { RateLimiter } from '../infra/rate-limit';
import { STORAGE, type Storage } from '../infra/storage';
import { toPublic, USERS, type UserDoc, type UsersRepo } from '../users/users.repo';
import { CHAT, type ChatService } from './chat.service';

const intParam = z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const listQuery = z.object({ before: z.string().max(64).optional(), limit: z.coerce.number().int().min(1).max(100).default(50), archived: z.enum(['0', '1']).optional() });
const messagesQuery = z.object({ before: intParam.optional(), after: intParam.optional(), limit: z.coerce.number().int().min(1).max(100).default(50) })
  .refine((q) => q.before === undefined || q.after === undefined, { message: 'Use before or after, not both.' });

/** Sending limit per person: generous for real typing, stops scripts flooding a chat. */
export const SEND_LIMIT = { count: 120, windowSeconds: 60 };

@Controller('v1/conversations')
@UseGuards(AuthGuard)
export class ChatController {
  constructor(@Inject(CHAT) private chat: ChatService, @Inject(RATE_LIMITER) private limiter: RateLimiter) {}

  @Get()
  list(@Auth() a: AuthCtx, @Query() q: unknown) { const v = parse(listQuery, q); return this.chat.list(a.userId, v.before, v.limit, v.archived === '1'); }

  @Post('direct') @HttpCode(200)
  open(@Auth() a: AuthCtx, @Body() b: unknown) { return this.chat.openDirect(a.userId, parse(openDirectSchema, b).userId); }

  @Get(':id')
  one(@Auth() a: AuthCtx, @Param('id') id: string) { return this.chat.one(a.userId, id); }

  @Get(':id/messages')
  messages(@Auth() a: AuthCtx, @Param('id') id: string, @Query() q: unknown) { return this.chat.messages(a.userId, id, parse(messagesQuery, q)); }

  @Post(':id/messages') @HttpCode(200)
  async send(@Auth() a: AuthCtx, @Param('id') id: string, @Body() b: unknown) {
    const v = parse(sendMessageSchema, b);
    await this.limiter.hit(`send:${a.userId}`, SEND_LIMIT.count, SEND_LIMIT.windowSeconds, 'You are sending messages too fast. Wait a moment.');
    return this.chat.send(a.userId, id, v.clientId, v.text, { replyToId: v.replyToId, attachment: v.attachment });
  }

  @Post(':id/delivered') @HttpCode(200)
  delivered(@Auth() a: AuthCtx, @Param('id') id: string, @Body() b: unknown) { return this.chat.receipt(a.userId, id, 'delivered', parse(receiptSchema, b).seq); }

  @Post(':id/read') @HttpCode(200)
  read(@Auth() a: AuthCtx, @Param('id') id: string, @Body() b: unknown) { return this.chat.receipt(a.userId, id, 'read', parse(receiptSchema, b).seq); }
}

@Controller('v1/users')
@UseGuards(AuthGuard)
export class PeopleController {
  constructor(@Inject(USERS) private users: UsersRepo, @Inject(STORAGE) private storage: Storage, @Inject(RATE_LIMITER) private limiter: RateLimiter, @Inject(CHAT) private chat: ChatService) {}

  /** Names and photos for people already known by id (group members, senders). Ids are random, so this can't be used to browse. */
  @Get('profiles')
  async profiles(@Auth() a: AuthCtx, @Query('ids') raw = ''): Promise<PublicProfile[]> {
    const ids = [...new Set(String(raw).split(',').map((x) => x.trim().toLowerCase()).filter(Boolean))];
    if (!ids.length) return [];
    if (ids.length > 100) throw AppError.validation('Ask for up to 100 people at a time.');
    if (ids.some((x) => !/^[a-f0-9]{24}$/.test(x))) throw AppError.validation('Not a valid id.');
    await this.limiter.hit(`profiles:${a.userId}`, 120, 60);
    const docs = await this.users.col.find({ _id: { $in: ids.map((x) => new ObjectId(x)) } }).toArray();
    return [...(await this.chat.profilesFor(a.userId, docs)).values()];
  }

  /** Exact match only (username, phone or email), so the directory can't be browsed. */
  @Get('lookup')
  async lookup(@Auth() a: AuthCtx, @Query('q') raw = ''): Promise<PublicProfile> {
    const q = String(raw).trim();
    if (!q || q.length > 254) throw AppError.validation('Type a username, phone number or email.');
    await this.limiter.hit(`lookup:${a.userId}`, 30, 60, 'Too many searches. Wait a minute and try again.');
    let u: UserDoc | null = null;
    const email = q.includes('@') && !q.startsWith('@') ? normalizeEmail(q) : null;
    const uname = q.replace(/^@/, '').toLowerCase();
    const phone = /^[+\d][\d\s()-]{5,}$/.test(q) ? normalizePhone(q) : null;
    if (email) u = await this.users.byEmail(email);
    else if (phone) u = await this.users.byPhone(phone);
    else if (USERNAME_RE.test(uname)) u = await this.users.col.findOne({ 'yc.username': uname });
    else throw AppError.validation('Type a username, phone number or email.');
    if (!u || u.yc?.disabledAt) throw AppError.notFound('No one on YaysApp matches that.');
    if (u._id.equals(a.userId)) throw AppError.validation("That's you.");
    return this.chat.profileFor(a.userId, u);
  }
}

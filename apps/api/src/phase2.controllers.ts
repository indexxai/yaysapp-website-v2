import { Body, Controller, Delete, Get, HttpCode, Inject, Ip, Param, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ObjectId, type Collection } from 'mongodb';
import {
  aiAskSchema, aiChatPatchSchema, convertSchema, dismissPopupSchema, leadSchema, linkIndexxSchema, payPinSchema, payRequestSchema, paySendSchema, referralCodeSchema,
  siteAskSchema, socialSchema, socialUrl, socialVisibilitySchema, supportAskSchema, supportTicketSchema, SOCIAL_NETWORKS,
  type SocialNetwork, type SocialsView,
} from '@yays/shared';
import { z } from 'zod';
import { parse } from './common/zod';
import { AppError } from './common/app-error';
import { Auth, AuthGuard, type AuthCtx } from './auth/auth.guard';
import { RATE_LIMITER } from './infra/tokens';
import type { RateLimiter } from './infra/rate-limit';
import { USERS, type UsersRepo, type UserDoc } from './users/users.repo';
import { CHAT, type ChatService } from './chat/chat.service';
import { REWARDS, type RewardsService } from './rewards/rewards.service';
import { Tz } from './rewards/days';
import { INDEXX_SERVICE, type IndexxService } from './indexx/indexx.service';
import { PAYMENTS, type PaymentsService } from './pay/payments.service';
import { AI, type AiService } from './ai/ai.service';
import type { FacebookFields } from './auth/facebook';

const filterOf = <T extends string>(v: unknown, allowed: readonly T[], d: T): T => (allowed.includes(v as T) ? (v as T) : d);

@Controller('v1/rewards')
@UseGuards(AuthGuard)
export class RewardsController {
  constructor(@Inject(REWARDS) private r: RewardsService, @Inject(RATE_LIMITER) private limiter: RateLimiter) {}
  @Get('points') points(@Auth() a: AuthCtx, @Tz() tz: string | null) { return this.r.summary(a.userId, tz); }
  @Get('history') history(@Auth() a: AuthCtx, @Query('filter') f?: string, @Query('before') before?: string) { return this.r.history(a.userId, filterOf(f, ['all', 'earned', 'spent', 'pending'] as const, 'all'), before); }
  @Get('checkin') checkin(@Auth() a: AuthCtx, @Tz() tz: string | null) { return this.r.checkinStatus(a.userId, tz); }
  @Post('checkin') @HttpCode(200) claim(@Auth() a: AuthCtx, @Tz() tz: string | null) { return this.r.claimCheckin(a.userId, tz); }
  @Get('today') today(@Auth() a: AuthCtx, @Tz() tz: string | null) { return this.r.today(a.userId, tz); }
  @Get('referrals') referrals(@Auth() a: AuthCtx) { return this.r.referralSummary(a.userId); }
  @Post('referrals/use') @HttpCode(200)
  async useCode(@Auth() a: AuthCtx, @Body() b: unknown) {
    await this.limiter.hit(`refuse:${a.userId}`, 10, 3600);
    return this.r.useCode(a.userId, parse(referralCodeSchema, b).code);
  }
  @Get('bonuses') bonuses(@Auth() a: AuthCtx, @Tz() tz: string | null) { return this.r.bonuses(a.userId, tz); }
  @Get('popup') popup(@Auth() a: AuthCtx, @Tz() tz: string | null) { return this.r.popupNow(a.userId, tz); }
  @Post('popup/dismiss') @HttpCode(204)
  async dismiss(@Auth() a: AuthCtx, @Tz() tz: string | null, @Body() b: unknown) { const v = parse(dismissPopupSchema, b); await this.r.dismiss(a.userId, tz, v.popup, v.forever); }
}

@Controller('v1')
@UseGuards(AuthGuard)
export class IndexxController {
  constructor(@Inject(INDEXX_SERVICE) private x: IndexxService, @Inject(RATE_LIMITER) private limiter: RateLimiter) {}
  @Get('indexx') status(@Auth() a: AuthCtx) { return this.x.status(a.userId); }
  @Post('indexx/link') @HttpCode(200)
  async link(@Auth() a: AuthCtx, @Body() b: unknown) {
    await this.limiter.hit(`indexx:${a.userId}`, 10, 3600, 'Too many tries. Try again later.');
    return this.x.linkAccount(a.userId, parse(linkIndexxSchema, b).email);
  }
  @Delete('indexx/link') unlink(@Auth() a: AuthCtx) { return this.x.unlink(a.userId); }
  @Get('wallet') wallet(@Auth() a: AuthCtx, @Tz() tz: string | null) { return this.x.wallet(a.userId, tz); }
  @Get('wallet/activity') activity(@Auth() a: AuthCtx, @Query('filter') f?: string) { return this.x.activity(a.userId, filterOf(f, ['all', 'pay', 'points'] as const, 'all')); }
  @Post('wallet/convert') @HttpCode(200)
  async convert(@Auth() a: AuthCtx, @Tz() tz: string | null, @Body() b: unknown) {
    await this.limiter.hit(`convert:${a.userId}`, 10, 3600);
    return this.x.convert(a.userId, tz, parse(convertSchema, b).points);
  }
  @Get('btcy') btcy(@Auth() a: AuthCtx, @Tz() tz: string | null) { return this.x.btcy(a.userId, tz); }
  @Post('btcy/mine') @HttpCode(200) mine(@Auth() a: AuthCtx, @Tz() tz: string | null) { return this.x.mine(a.userId, tz); }
  @Get('products') products(@Auth() a: AuthCtx) { return this.x.products(a.userId); }
}

@Controller('v1/pay')
@UseGuards(AuthGuard)
export class PayController {
  constructor(@Inject(PAYMENTS) private p: PaymentsService) {}
  @Put('pin') pin(@Auth() a: AuthCtx, @Body() b: unknown) { const v = parse(payPinSchema, b); return this.p.setPin(a.userId, v.pin, v.currentPin); }
  @Post('requests') @HttpCode(200) request(@Auth() a: AuthCtx, @Body() b: unknown) { return this.p.request(a.userId, parse(payRequestSchema, b)); }
  @Post('send') @HttpCode(200) send(@Auth() a: AuthCtx, @Body() b: unknown) { return this.p.send(a.userId, parse(paySendSchema, b)); }
  @Post(':id/pay') @HttpCode(200) pay(@Auth() a: AuthCtx, @Param('id') id: string, @Body() b: unknown) { return this.p.pay(a.userId, id, parse(z.object({ pin: z.string() }), b).pin); }
  @Post(':id/decline') @HttpCode(200) decline(@Auth() a: AuthCtx, @Param('id') id: string) { return this.p.decline(a.userId, id); }
}

@Controller('v1/ai')
@UseGuards(AuthGuard)
export class AiController {
  constructor(@Inject(AI) private ai: AiService, @Inject(RATE_LIMITER) private limiter: RateLimiter) {}
  private async slow(a: AuthCtx) { await this.limiter.hit(`ai:${a.userId}`, 12, 60, 'Slow down a little. Try again in a minute.'); }
  @Get('chats') list(@Auth() a: AuthCtx) { return this.ai.list(a.userId); }
  @Post('chats') @HttpCode(200) async start(@Auth() a: AuthCtx, @Body() b: unknown) { await this.slow(a); const v = parse(aiAskSchema, b); return this.ai.ask(a.userId, null, v.text, v.mode); }
  @Get('chats/:id') get(@Auth() a: AuthCtx, @Param('id') id: string) { return this.ai.get(a.userId, id); }
  @Post('chats/:id/messages') @HttpCode(200) async ask(@Auth() a: AuthCtx, @Param('id') id: string, @Body() b: unknown) { await this.slow(a); const v = parse(aiAskSchema, b); return this.ai.ask(a.userId, id, v.text, v.mode); }
  @Patch('chats/:id') patch(@Auth() a: AuthCtx, @Param('id') id: string, @Body() b: unknown) { return this.ai.patch(a.userId, id, parse(aiChatPatchSchema, b)); }
  @Delete('chats/:id') @HttpCode(204) async remove(@Auth() a: AuthCtx, @Param('id') id: string) { await this.ai.remove(a.userId, id); }
  @Get('quota') quota(@Auth() a: AuthCtx) { return this.ai.quota(a.userId); }
  @Post('quota/extra') @HttpCode(200) extra(@Auth() a: AuthCtx) { return this.ai.buyMessages(a.userId); }
  @Get('consent/:conv') consent(@Auth() a: AuthCtx, @Param('conv') c: string) { return this.ai.hasConsent(a.userId, c); }
  @Put('consent/:conv') allow(@Auth() a: AuthCtx, @Param('conv') c: string) { return this.ai.setConsent(a.userId, c, true); }
  @Delete('consent/:conv') deny(@Auth() a: AuthCtx, @Param('conv') c: string) { return this.ai.setConsent(a.userId, c, false); }
  @Post('summarize') @HttpCode(200)
  async summarize(@Auth() a: AuthCtx, @Body() b: unknown) { await this.slow(a); return this.ai.summarize(a.userId, parse(z.object({ conversationId: z.string().min(1) }), b).conversationId); }
}

/** The website's Ask Jack box: no account needed, so it is limited by address. */
@Controller('v1/site')
export class SiteController {
  constructor(@Inject(AI) private ai: AiService, @Inject(RATE_LIMITER) private limiter: RateLimiter) {}
  @Post('ask') @HttpCode(200)
  async ask(@Ip() ip: string, @Body() b: unknown) {
    await this.limiter.hit(`site:${ip}`, 20, 3600, 'You’ve asked a lot of questions. Leave your email and our team will reply.');
    return this.ai.siteAsk(parse(siteAskSchema, b).messages);
  }
  @Post('leads') @HttpCode(204)
  async lead(@Ip() ip: string, @Body() b: unknown) {
    await this.limiter.hit(`lead:${ip}`, 5, 3600);
    const v = parse(leadSchema, b);
    await this.ai.lead({ name: v.name, email: v.email, question: v.question }, ip);
  }
}

@Controller('v1/support')
@UseGuards(AuthGuard)
export class SupportDeskController {
  constructor(@Inject(AI) private ai: AiService, @Inject(RATE_LIMITER) private limiter: RateLimiter) {}
  @Post('ask') @HttpCode(200)
  async ask(@Auth() a: AuthCtx, @Body() b: unknown) { await this.limiter.hit(`supask:${a.userId}`, 20, 3600); return this.ai.supportAsk(a.userId, parse(supportAskSchema, b).question); }
  @Post('tickets') @HttpCode(200)
  async ticket(@Auth() a: AuthCtx, @Body() b: unknown) { await this.limiter.hit(`ticket:${a.userId}`, 5, 3600, 'You’ve opened several tickets. We’ll reply in the Support chat.'); const v = parse(supportTicketSchema, b); return this.ai.ticket(a.userId, v.question, v.answer); }
}

type SocialFields = { socials?: Partial<Record<SocialNetwork, string>>; socialsVisibility?: SocialsView['visibility'] } & FacebookFields;
/** Facebook (confirmed through Facebook) first, then the usernames people typed in. */
const socialsOf = (u: UserDoc | null): SocialsView => {
  const y = (u?.yc ?? {}) as SocialFields;
  const fb = y.facebook ? [{ network: 'facebook' as const, handle: y.facebook.name, url: null, verified: true }] : [];
  return { links: [...fb, ...SOCIAL_NETWORKS.filter((n) => y.socials?.[n]).map((n) => ({ network: n, handle: y.socials![n]!, url: socialUrl(n, y.socials![n]!), verified: false }))], visibility: y.socialsVisibility ?? 'everyone' };
};
export type SocialsViewFn = (me: ObjectId) => Promise<SocialsView>;
export const SOCIALS_VIEW = Symbol('SOCIALS_VIEW');
/** My own socials, with my Facebook link details. */
export const mySocials = (col: Collection<UserDoc>, fbAvailable: boolean): SocialsViewFn => async (me) => {
  const u = await col.findOne({ _id: me });
  const f = (u?.yc as FacebookFields | undefined)?.facebook;
  return { ...socialsOf(u), facebook: f ? { name: f.name, photoUrl: f.photoUrl, login: f.login, linkedAt: f.linkedAt.toISOString() } : null, facebookAvailable: fbAvailable };
};

/** Social accounts shown on someone's profile. */
@Controller('v1')
@UseGuards(AuthGuard)
export class SocialsController {
  private col: Collection<UserDoc>;
  constructor(@Inject(USERS) users: UsersRepo, @Inject(CHAT) private chat: ChatService, @Inject(SOCIALS_VIEW) private mine: SocialsViewFn) { this.col = users.col; }
  private me(id: ObjectId) { return this.mine(id); }
  @Get('me/socials') get(@Auth() a: AuthCtx) { return this.me(a.userId); }
  @Put('me/socials/:network')
  async set(@Auth() a: AuthCtx, @Param('network') n: string, @Body() b: unknown) {
    const v = parse(socialSchema, { ...(b as object), network: n });
    await this.col.updateOne({ _id: a.userId }, { $set: { [`yc.socials.${v.network}`]: v.handle.startsWith('@') ? v.handle : `@${v.handle}` } });
    return this.me(a.userId);
  }
  @Delete('me/socials/:network')
  async remove(@Auth() a: AuthCtx, @Param('network') n: string) {
    const network = parse(z.enum(SOCIAL_NETWORKS), n);
    await this.col.updateOne({ _id: a.userId }, { $unset: { [`yc.socials.${network}`]: '' } });
    return this.me(a.userId);
  }
  @Put('me/socials')
  async visibility(@Auth() a: AuthCtx, @Body() b: unknown) {
    await this.col.updateOne({ _id: a.userId }, { $set: { 'yc.socialsVisibility': parse(socialVisibilitySchema, b).visibility } });
    return this.me(a.userId);
  }
  @Get('users/:id/socials')
  async of(@Auth() a: AuthCtx, @Param('id') id: string) {
    if (!ObjectId.isValid(id)) throw AppError.notFound();
    const owner = new ObjectId(id);
    const s = socialsOf(await this.col.findOne({ _id: owner, 'yc.deletedAt': { $exists: false } }));
    if (owner.equals(a.userId)) return s;
    const blocked = await this.chat.blockedEitherWay(a.userId, [owner]);
    const shown = !blocked.size && (s.visibility === 'everyone' || (s.visibility === 'contacts' && (await this.chat.contactsOf(owner, [a.userId])).size > 0));
    return shown ? s : { links: [], visibility: s.visibility };
  }
}

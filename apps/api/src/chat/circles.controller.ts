import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import {
  cancelEventSchema, circlePostSchema, commentSchema, createCircleSchema, createEventSchema, editPostSchema, joinCircleSchema, muteSchema, newOwnerSchema,
  rateEventSchema, removeMemberSchema, removePostSchema, reportPostSchema, rsvpSchema, settleReportSchema, updateCircleSchema, updateEventSchema,
} from '@yays/shared';
import { parse } from '../common/zod';
import { Auth, AuthGuard, type AuthCtx } from '../auth/auth.guard';
import { RATE_LIMITER } from '../infra/tokens';
import type { RateLimiter } from '../infra/rate-limit';
import { CIRCLES, type CirclesService } from './circles.service';

@Controller('v1/circles')
@UseGuards(AuthGuard)
export class CirclesController {
  constructor(@Inject(CIRCLES) private s: CirclesService, @Inject(RATE_LIMITER) private limiter: RateLimiter) {}

  @Get() mine(@Auth() a: AuthCtx) { return this.s.mine(a.userId); }
  @Get('discover') async discover(@Auth() a: AuthCtx, @Query('q') q?: string, @Query('category') category?: string) {
    await this.limiter.hit(`circles:find:${a.userId}`, 120, 60);
    return this.s.discover(a.userId, (q ?? '').slice(0, 100), category ?? '');
  }
  @Post() @HttpCode(200) async create(@Auth() a: AuthCtx, @Body() b: unknown) {
    await this.limiter.hit(`community:new:${a.userId}`, 10, 3600, 'You have made several circles. Try again later.');
    return this.s.create(a.userId, parse(createCircleSchema, b));
  }
  @Get(':id') get(@Auth() a: AuthCtx, @Param('id') id: string) { return this.s.get(a.userId, id); }
  @Patch(':id') update(@Auth() a: AuthCtx, @Param('id') id: string, @Body() b: unknown) { return this.s.update(a.userId, id, parse(updateCircleSchema, b)); }
  @Delete(':id') @HttpCode(204) async remove(@Auth() a: AuthCtx, @Param('id') id: string) { await this.s.remove(a.userId, id); }
  @Post(':id/join') @HttpCode(200) async join(@Auth() a: AuthCtx, @Param('id') id: string, @Body() b: unknown) {
    await this.limiter.hit(`circles:join:${a.userId}`, 60, 3600, 'You have joined a lot of circles. Try again later.');
    return this.s.join(a.userId, id, parse(joinCircleSchema, b ?? {}).answer);
  }
  @Delete(':id/request') cancel(@Auth() a: AuthCtx, @Param('id') id: string) { return this.s.cancelRequest(a.userId, id); }
  @Post(':id/leave') @HttpCode(204) async leave(@Auth() a: AuthCtx, @Param('id') id: string) { await this.s.leave(a.userId, id); }
  @Post(':id/owner') @HttpCode(200) owner(@Auth() a: AuthCtx, @Param('id') id: string, @Body() b: unknown) { return this.s.setOwner(a.userId, id, parse(newOwnerSchema, b).userId); }
  @Get(':id/members') members(@Auth() a: AuthCtx, @Param('id') id: string) { return this.s.membersOf(a.userId, id); }
  @Post(':id/members/:uid/remove') @HttpCode(204) async removeMember(@Auth() a: AuthCtx, @Param('id') id: string, @Param('uid') uid: string, @Body() b: unknown) { await this.s.removeMember(a.userId, id, uid, parse(removeMemberSchema, b ?? {}).reason); }
  @Put(':id/mutes/:uid') @HttpCode(204) async mute(@Auth() a: AuthCtx, @Param('id') id: string, @Param('uid') uid: string, @Body() b: unknown) { const v = parse(muteSchema, b); await this.s.mute(a.userId, id, uid, v.days, v.reason); }
  @Delete(':id/mutes/:uid') @HttpCode(204) async unmute(@Auth() a: AuthCtx, @Param('id') id: string, @Param('uid') uid: string) { await this.s.unmute(a.userId, id, uid); }

  @Get(':id/posts') feed(@Auth() a: AuthCtx, @Param('id') id: string, @Query('before') before?: string) { return this.s.feed(a.userId, id, before); }
  @Post(':id/posts') @HttpCode(200) async post(@Auth() a: AuthCtx, @Param('id') id: string, @Body() b: unknown) {
    const v = parse(circlePostSchema, b);
    await this.limiter.hit(`circles:post:${a.userId}`, 30, 3600, 'You have posted a lot in the last hour. Try again later.');
    return this.s.createPost(a.userId, id, v);
  }
  @Get(':id/review') review(@Auth() a: AuthCtx, @Param('id') id: string) { return this.s.review(a.userId, id); }
  @Post(':id/review/:pid') @HttpCode(204) async settle(@Auth() a: AuthCtx, @Param('id') id: string, @Param('pid') pid: string, @Body() b: unknown) { const v = parse(settleReportSchema, b); await this.s.settle(a.userId, id, pid, v.action, v.reason); }

  @Get(':id/events') events(@Auth() a: AuthCtx, @Param('id') id: string, @Query('past') past?: string) { return this.s.eventsOf(a.userId, id, past === '1'); }
  @Post(':id/events') @HttpCode(200) async newEvent(@Auth() a: AuthCtx, @Param('id') id: string, @Body() b: unknown) {
    const v = parse(createEventSchema, b);
    await this.limiter.hit(`circles:event:${a.userId}`, 20, 86400, 'You have made several events today. Try again tomorrow.');
    return this.s.createEvent(a.userId, id, v);
  }
}

@Controller('v1/circle-posts')
@UseGuards(AuthGuard)
export class CirclePostsController {
  constructor(@Inject(CIRCLES) private s: CirclesService, @Inject(RATE_LIMITER) private limiter: RateLimiter) {}
  @Get(':id') get(@Auth() a: AuthCtx, @Param('id') id: string) { return this.s.getPost(a.userId, id); }
  @Patch(':id') edit(@Auth() a: AuthCtx, @Param('id') id: string, @Body() b: unknown) { return this.s.editPost(a.userId, id, parse(editPostSchema, b).text); }
  @Delete(':id') @HttpCode(204) async del(@Auth() a: AuthCtx, @Param('id') id: string) { await this.s.deletePost(a.userId, id); }
  @Put(':id/like') like(@Auth() a: AuthCtx, @Param('id') id: string) { return this.s.like(a.userId, id, true); }
  @Delete(':id/like') unlike(@Auth() a: AuthCtx, @Param('id') id: string) { return this.s.like(a.userId, id, false); }
  @Put(':id/pin') pin(@Auth() a: AuthCtx, @Param('id') id: string) { return this.s.pin(a.userId, id, true); }
  @Delete(':id/pin') unpin(@Auth() a: AuthCtx, @Param('id') id: string) { return this.s.pin(a.userId, id, false); }
  @Post(':id/approve') @HttpCode(200) approve(@Auth() a: AuthCtx, @Param('id') id: string) { return this.s.approve(a.userId, id); }
  @Post(':id/remove') @HttpCode(200) takeDown(@Auth() a: AuthCtx, @Param('id') id: string, @Body() b: unknown) { return this.s.takeDown(a.userId, id, parse(removePostSchema, b ?? {}).reason); }
  @Post(':id/report') @HttpCode(204) async report(@Auth() a: AuthCtx, @Param('id') id: string, @Body() b: unknown) {
    await this.limiter.hit(`circles:report:${a.userId}`, 30, 3600, 'You have sent a lot of reports. Try again later.');
    await this.s.report(a.userId, id, parse(reportPostSchema, b));
  }
  @Get(':id/comments') comments(@Auth() a: AuthCtx, @Param('id') id: string) { return this.s.commentsOn(a.userId, id); }
  @Post(':id/comments') @HttpCode(200) async comment(@Auth() a: AuthCtx, @Param('id') id: string, @Body() b: unknown) {
    const v = parse(commentSchema, b);
    await this.limiter.hit(`circles:comment:${a.userId}`, 120, 3600, 'You have commented a lot in the last hour. Try again later.');
    return this.s.comment(a.userId, id, v.text, v.parentId);
  }
}

@Controller('v1/circle-comments')
@UseGuards(AuthGuard)
export class CircleCommentsController {
  constructor(@Inject(CIRCLES) private s: CirclesService) {}
  @Delete(':id') @HttpCode(204) async del(@Auth() a: AuthCtx, @Param('id') id: string) { await this.s.deleteComment(a.userId, id); }
  @Put(':id/answer') answer(@Auth() a: AuthCtx, @Param('id') id: string) { return this.s.markAnswer(a.userId, id, true); }
  @Delete(':id/answer') unanswer(@Auth() a: AuthCtx, @Param('id') id: string) { return this.s.markAnswer(a.userId, id, false); }
}

@Controller('v1/circle-events')
@UseGuards(AuthGuard)
export class CircleEventsController {
  constructor(@Inject(CIRCLES) private s: CirclesService, @Inject(RATE_LIMITER) private limiter: RateLimiter) {}
  @Get(':id') get(@Auth() a: AuthCtx, @Param('id') id: string) { return this.s.getEvent(a.userId, id); }
  @Patch(':id') update(@Auth() a: AuthCtx, @Param('id') id: string, @Body() b: unknown) { return this.s.updateEvent(a.userId, id, parse(updateEventSchema, b)); }
  @Post(':id/cancel') @HttpCode(200) cancel(@Auth() a: AuthCtx, @Param('id') id: string, @Body() b: unknown) { return this.s.cancelEvent(a.userId, id, parse(cancelEventSchema, b ?? {}).note); }
  @Put(':id/rsvp') rsvp(@Auth() a: AuthCtx, @Param('id') id: string, @Body() b: unknown) { return this.s.rsvp(a.userId, id, parse(rsvpSchema, b).status); }
  @Delete(':id/rsvp') leaveWaitlist(@Auth() a: AuthCtx, @Param('id') id: string) { return this.s.leaveWaitlist(a.userId, id); }
  @Post(':id/confirm') @HttpCode(200) confirm(@Auth() a: AuthCtx, @Param('id') id: string) { return this.s.confirmSeat(a.userId, id); }
  @Post(':id/ack') @HttpCode(200) ack(@Auth() a: AuthCtx, @Param('id') id: string) { return this.s.ackChange(a.userId, id); }
  @Put(':id/rating') rate(@Auth() a: AuthCtx, @Param('id') id: string, @Body() b: unknown) { return this.s.rate(a.userId, id, parse(rateEventSchema, b).stars); }
  @Get(':id/questions') questions(@Auth() a: AuthCtx, @Param('id') id: string) { return this.s.questions(a.userId, id); }
  @Post(':id/questions') @HttpCode(200) async ask(@Auth() a: AuthCtx, @Param('id') id: string, @Body() b: unknown) {
    const v = parse(commentSchema, b);
    await this.limiter.hit(`circles:comment:${a.userId}`, 120, 3600, 'You have commented a lot in the last hour. Try again later.');
    return this.s.ask(a.userId, id, v.text, v.parentId);
  }
}

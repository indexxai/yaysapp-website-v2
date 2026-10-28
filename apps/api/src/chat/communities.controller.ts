import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import { communityGroupSchema, createCommunitySchema, inviteCodeSchema, moderateSchema, updateCommunitySchema } from '@yays/shared';
import { parse } from '../common/zod';
import { Auth, AuthGuard, type AuthCtx } from '../auth/auth.guard';
import { RATE_LIMITER } from '../infra/tokens';
import type { RateLimiter } from '../infra/rate-limit';
import { COMMUNITIES, type CommunitiesService } from './communities.service';

@Controller('v1/communities')
@UseGuards(AuthGuard)
export class CommunitiesController {
  constructor(@Inject(COMMUNITIES) private s: CommunitiesService, @Inject(RATE_LIMITER) private limiter: RateLimiter) {}

  @Get() list(@Auth() a: AuthCtx) { return this.s.list(a.userId); }
  @Post() @HttpCode(200)
  async create(@Auth() a: AuthCtx, @Body() b: unknown) {
    await this.limiter.hit(`community:new:${a.userId}`, 10, 3600, 'You have made several communities. Try again later.');
    return this.s.create(a.userId, parse(createCommunitySchema, b));
  }
  @Get(':id') info(@Auth() a: AuthCtx, @Param('id') id: string) { return this.s.info(a.userId, id); }
  @Patch(':id') update(@Auth() a: AuthCtx, @Param('id') id: string, @Body() b: unknown) { return this.s.update(a.userId, id, parse(updateCommunitySchema, b)); }
  @Post(':id/leave') @HttpCode(204) async leave(@Auth() a: AuthCtx, @Param('id') id: string) { await this.s.leave(a.userId, id); }

  @Post(':id/groups') @HttpCode(200) addGroup(@Auth() a: AuthCtx, @Param('id') id: string, @Body() b: unknown) { return this.s.addGroup(a.userId, id, parse(communityGroupSchema, b)); }
  @Delete(':id/groups/:gid') removeGroup(@Auth() a: AuthCtx, @Param('id') id: string, @Param('gid') gid: string) { return this.s.removeGroup(a.userId, id, gid); }
  @Post(':id/groups/:gid/join') @HttpCode(200) joinGroup(@Auth() a: AuthCtx, @Param('id') id: string, @Param('gid') gid: string) { return this.s.joinGroup(a.userId, id, gid); }
  @Post(':id/suggestions/:gid') @HttpCode(204) async suggest(@Auth() a: AuthCtx, @Param('id') id: string, @Param('gid') gid: string) { await this.s.suggest(a.userId, id, gid); }
  @Post(':id/suggestions/:gid/approve') @HttpCode(200) approveSuggestion(@Auth() a: AuthCtx, @Param('id') id: string, @Param('gid') gid: string) { return this.s.approveSuggestion(a.userId, id, gid); }
  @Delete(':id/suggestions/:gid') @HttpCode(204) async declineSuggestion(@Auth() a: AuthCtx, @Param('id') id: string, @Param('gid') gid: string) { await this.s.declineSuggestion(a.userId, id, gid); }

  @Get(':id/members') members(@Auth() a: AuthCtx, @Param('id') id: string, @Query('before') before?: string) { return this.s.listMembers(a.userId, id, before); }
  @Delete(':id/members/:uid') @HttpCode(204) async remove(@Auth() a: AuthCtx, @Param('id') id: string, @Param('uid') uid: string) { await this.s.removeMember(a.userId, id, uid); }
  @Put(':id/admins/:uid') @HttpCode(204) async admin(@Auth() a: AuthCtx, @Param('id') id: string, @Param('uid') uid: string) { await this.s.setAdmin(a.userId, id, uid, true); }
  @Delete(':id/admins/:uid') @HttpCode(204) async unadmin(@Auth() a: AuthCtx, @Param('id') id: string, @Param('uid') uid: string) { await this.s.setAdmin(a.userId, id, uid, false); }

  @Post(':id/invite') @HttpCode(200) invite(@Auth() a: AuthCtx, @Param('id') id: string) { return this.s.resetInvite(a.userId, id); }
  @Delete(':id/invite') @HttpCode(204) async uninvite(@Auth() a: AuthCtx, @Param('id') id: string) { await this.s.revokeInvite(a.userId, id); }
  @Get(':id/requests') requests(@Auth() a: AuthCtx, @Param('id') id: string) { return this.s.listRequests(a.userId, id); }
  @Post(':id/requests/:uid/approve') @HttpCode(200) approve(@Auth() a: AuthCtx, @Param('id') id: string, @Param('uid') uid: string) { return this.s.approve(a.userId, id, uid === 'all' ? 'all' : uid); }
  @Delete(':id/requests/:uid') @HttpCode(204) async decline(@Auth() a: AuthCtx, @Param('id') id: string, @Param('uid') uid: string) { await this.s.decline(a.userId, id, uid); }

  @Get(':id/reports') reports(@Auth() a: AuthCtx, @Param('id') id: string) { return this.s.reportsFor(a.userId, id); }
  @Post(':id/reports/:rid') @HttpCode(204) async moderate(@Auth() a: AuthCtx, @Param('id') id: string, @Param('rid') rid: string, @Body() b: unknown) { await this.s.moderate(a.userId, id, rid, parse(moderateSchema, b).action); }
}

@Controller('v1/community-invites')
@UseGuards(AuthGuard)
export class CommunityInvitesController {
  constructor(@Inject(COMMUNITIES) private s: CommunitiesService, @Inject(RATE_LIMITER) private limiter: RateLimiter) {}
  @Get(':code') async preview(@Auth() a: AuthCtx, @Param('code') code: string) {
    await this.limiter.hit(`cinvite:${a.userId}`, 60, 60);
    return this.s.preview(a.userId, parse(inviteCodeSchema, code));
  }
  @Post(':code/join') @HttpCode(200) join(@Auth() a: AuthCtx, @Param('code') code: string) { return this.s.join(a.userId, parse(inviteCodeSchema, code)); }
  @Delete(':code/request') @HttpCode(204) async cancel(@Auth() a: AuthCtx, @Param('code') code: string) { await this.s.cancelRequest(a.userId, parse(inviteCodeSchema, code)); }
}

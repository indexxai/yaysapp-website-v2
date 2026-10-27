import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { addMembersSchema, createGroupSchema, groupSettingsSchema, inviteCodeSchema, objectIdSchema, updateGroupSchema } from '@yays/shared';
import { parse } from '../common/zod';
import { AppError } from '../common/app-error';
import { Auth, AuthGuard, type AuthCtx } from '../auth/auth.guard';
import { RATE_LIMITER } from '../infra/tokens';
import type { RateLimiter } from '../infra/rate-limit';
import { GROUPS, type GroupsService } from './groups.service';

const userParam = (v: string) => { const r = objectIdSchema.safeParse(v); if (!r.success) throw AppError.notFound('That person is not in this group.'); return r.data; };
const codeParam = (v: string) => { const r = inviteCodeSchema.safeParse(v); if (!r.success) throw AppError.notFound('This invite link was reset or doesn’t exist. Ask for a new one.'); return r.data; };

@Controller('v1/groups')
@UseGuards(AuthGuard)
export class GroupsController {
  constructor(@Inject(GROUPS) private groups: GroupsService, @Inject(RATE_LIMITER) private limiter: RateLimiter) {}

  @Post() @HttpCode(200)
  async create(@Auth() a: AuthCtx, @Body() b: unknown) {
    const v = parse(createGroupSchema, b);
    await this.limiter.hit(`group:create:${a.userId}`, 30, 3600, 'You have made a lot of groups in the last hour. Try again later.');
    return this.groups.create(a.userId, v);
  }

  @Get(':id') info(@Auth() a: AuthCtx, @Param('id') id: string) { return this.groups.info(a.userId, id); }
  @Patch(':id') update(@Auth() a: AuthCtx, @Param('id') id: string, @Body() b: unknown) { return this.groups.update(a.userId, id, parse(updateGroupSchema, b)); }
  @Patch(':id/settings') settings(@Auth() a: AuthCtx, @Param('id') id: string, @Body() b: unknown) { return this.groups.setSettings(a.userId, id, parse(groupSettingsSchema, b)); }
  @Post(':id/members') @HttpCode(200) add(@Auth() a: AuthCtx, @Param('id') id: string, @Body() b: unknown) { return this.groups.addMembers(a.userId, id, parse(addMembersSchema, b).userIds); }
  @Delete(':id/members/:userId') remove(@Auth() a: AuthCtx, @Param('id') id: string, @Param('userId') u: string) { return this.groups.removeMember(a.userId, id, userParam(u)); }
  @Post(':id/admins/:userId') @HttpCode(200) makeAdmin(@Auth() a: AuthCtx, @Param('id') id: string, @Param('userId') u: string) { return this.groups.setAdmin(a.userId, id, userParam(u), true); }
  @Delete(':id/admins/:userId') dismissAdmin(@Auth() a: AuthCtx, @Param('id') id: string, @Param('userId') u: string) { return this.groups.setAdmin(a.userId, id, userParam(u), false); }
  @Post(':id/leave') @HttpCode(200) leave(@Auth() a: AuthCtx, @Param('id') id: string) { return this.groups.leave(a.userId, id); }
  @Delete(':id') @HttpCode(204) hide(@Auth() a: AuthCtx, @Param('id') id: string) { return this.groups.hide(a.userId, id); }

  @Post(':id/invite') @HttpCode(200) resetInvite(@Auth() a: AuthCtx, @Param('id') id: string) { return this.groups.resetInvite(a.userId, id); }
  @Delete(':id/invite') @HttpCode(204) revokeInvite(@Auth() a: AuthCtx, @Param('id') id: string) { return this.groups.revokeInvite(a.userId, id); }
  @Get(':id/requests') requests(@Auth() a: AuthCtx, @Param('id') id: string) { return this.groups.listRequests(a.userId, id); }
  @Post(':id/requests/:userId') @HttpCode(200) approve(@Auth() a: AuthCtx, @Param('id') id: string, @Param('userId') u: string) { return this.groups.approve(a.userId, id, userParam(u)); }
  @Delete(':id/requests/:userId') @HttpCode(204) reject(@Auth() a: AuthCtx, @Param('id') id: string, @Param('userId') u: string) { return this.groups.reject(a.userId, id, userParam(u)); }
}

@Controller('v1/invites')
@UseGuards(AuthGuard)
export class InvitesController {
  constructor(@Inject(GROUPS) private groups: GroupsService, @Inject(RATE_LIMITER) private limiter: RateLimiter) {}
  @Get(':code') async preview(@Auth() a: AuthCtx, @Param('code') code: string) {
    await this.limiter.hit(`invite:${a.userId}`, 60, 3600, 'Too many invite links opened. Try again later.');
    return this.groups.preview(a.userId, codeParam(code));
  }
  @Post(':code/join') @HttpCode(200) join(@Auth() a: AuthCtx, @Param('code') code: string) { return this.groups.join(a.userId, codeParam(code)); }
  @Delete(':code/request') @HttpCode(204) cancel(@Auth() a: AuthCtx, @Param('code') code: string) { return this.groups.cancelRequest(a.userId, codeParam(code)); }
}

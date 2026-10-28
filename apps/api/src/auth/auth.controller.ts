import { Body, Controller, Get, HttpCode, Inject, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { emailStartSchema, emailVerifySchema, googleSchema, phoneStartSchema, phoneVerifySchema, refreshSchema, emailSchema, codeSchema, deviceSchema, pinForgotSchema, pinResetSchema, pinSignInSchema, linkStartSchema, linkApproveSchema } from '@yays/shared';
import { z } from 'zod';
import { parse } from '../common/zod';
import { Auth, AuthGuard, type AuthCtx } from './auth.guard';
import { AUTH, type AuthService } from './auth.service';
import { SESSIONS, type SessionService } from './sessions';
import { RATE_LIMITER } from '../infra/tokens';
import type { RateLimiter } from '../infra/rate-limit';

const signupStart = z.object({ signupToken: z.string().min(20).max(2048), email: emailSchema });
const signupVerify = z.object({ signupToken: z.string().min(20).max(2048), email: emailSchema, code: codeSchema, device: deviceSchema });
const ipOf = (r: Request) => r.ip ?? 'unknown';

@Controller('v1/auth')
export class AuthController {
  constructor(@Inject(AUTH) private auth: AuthService, @Inject(SESSIONS) private sessions: SessionService, @Inject(RATE_LIMITER) private limiter: RateLimiter) {}

  @Post('phone/start') @HttpCode(200)
  startPhone(@Body() b: unknown, @Req() r: Request) { const v = parse(phoneStartSchema, b); return this.auth.startPhone(v.phone, v.channel, ipOf(r)); }

  @Post('phone/verify') @HttpCode(200)
  verifyPhone(@Body() b: unknown, @Req() r: Request) { const v = parse(phoneVerifySchema, b); return this.auth.verifyPhone(v.phone, v.code, v.device, ipOf(r)); }

  @Post('signup/email/start') @HttpCode(200)
  signupStart(@Body() b: unknown, @Req() r: Request) { const v = parse(signupStart, b); return this.auth.startSignupEmail(v.signupToken, v.email, ipOf(r)); }

  @Post('signup/email/verify') @HttpCode(200)
  signupVerify(@Body() b: unknown, @Req() r: Request) { const v = parse(signupVerify, b); return this.auth.verifySignupEmail(v.signupToken, v.email, v.code, v.device, ipOf(r)); }

  @Post('email/start') @HttpCode(200)
  startEmail(@Body() b: unknown, @Req() r: Request) { const v = parse(emailStartSchema, b); return this.auth.startEmail(v.email, ipOf(r)); }

  @Post('email/verify') @HttpCode(200)
  verifyEmail(@Body() b: unknown, @Req() r: Request) { const v = parse(emailVerifySchema, b); return this.auth.verifyEmail(v.email, v.code, v.device, ipOf(r)); }

  @Post('google') @HttpCode(200)
  google(@Body() b: unknown, @Req() r: Request) { const v = parse(googleSchema, b); return this.auth.google(v.idToken, v.device, ipOf(r)); }

  @Post('pin') @HttpCode(200)
  pin(@Body() b: unknown) { const v = parse(pinSignInSchema, b); return this.auth.verifyPin(v.pinToken, v.pin); }

  @Post('pin/forgot') @HttpCode(200)
  pinForgot(@Body() b: unknown, @Req() r: Request) { return this.auth.forgotPin(parse(pinForgotSchema, b).pinToken, ipOf(r)); }

  @Post('pin/reset') @HttpCode(200)
  pinReset(@Body() b: unknown) { const v = parse(pinResetSchema, b); return this.auth.resetPin(v.pinToken, v.code); }

  @Post('link/start') @HttpCode(200)
  async linkStart(@Body() b: unknown, @Req() r: Request) {
    await this.limiter.hit(`link:start:${ipOf(r)}`, 60, 3600, 'Too many codes. Wait a few minutes and try again.');
    return this.auth.linkStart(parse(linkStartSchema, b).device, ipOf(r));
  }
  @Get('link/:pollId') linkPoll(@Param('pollId') id: string) { return this.auth.linkPoll(id); }
  @Post('link/approve') @HttpCode(200) @UseGuards(AuthGuard)
  async linkApprove(@Auth() a: AuthCtx, @Body() b: unknown) {
    await this.limiter.hit(`link:approve:${a.userId}`, 10, 600, 'Too many tries. Wait a few minutes and try again.');
    return this.auth.linkApprove(a.userId, parse(linkApproveSchema, b));
  }

  @Post('refresh') @HttpCode(200)
  refresh(@Body() b: unknown) { return this.sessions.refresh(parse(refreshSchema, b).refreshToken); }

  @Post('logout') @HttpCode(204) @UseGuards(AuthGuard)
  async logout(@Auth() a: AuthCtx) { await this.sessions.revoke(a.sid, 'logout'); }
}

import { Body, Controller, HttpCode, Inject, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { emailStartSchema, emailVerifySchema, googleSchema, phoneStartSchema, phoneVerifySchema, refreshSchema, emailSchema, codeSchema, deviceSchema } from '@yays/shared';
import { z } from 'zod';
import { parse } from '../common/zod';
import { Auth, AuthGuard, type AuthCtx } from './auth.guard';
import { AUTH, type AuthService } from './auth.service';
import { SESSIONS, type SessionService } from './sessions';

const signupStart = z.object({ signupToken: z.string().min(20).max(2048), email: emailSchema });
const signupVerify = z.object({ signupToken: z.string().min(20).max(2048), email: emailSchema, code: codeSchema, device: deviceSchema });
const ipOf = (r: Request) => r.ip ?? 'unknown';

@Controller('v1/auth')
export class AuthController {
  constructor(@Inject(AUTH) private auth: AuthService, @Inject(SESSIONS) private sessions: SessionService) {}

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

  @Post('refresh') @HttpCode(200)
  refresh(@Body() b: unknown) { return this.sessions.refresh(parse(refreshSchema, b).refreshToken); }

  @Post('logout') @HttpCode(204) @UseGuards(AuthGuard)
  async logout(@Auth() a: AuthCtx) { await this.sessions.revoke(a.sid, 'logout'); }
}

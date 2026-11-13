import { Body, Controller, Delete, Get, HttpCode, Inject, Post, Put, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { deviceSchema, facebookFinishSchema, facebookLoginSchema, facebookStartSchema } from '@yays/shared';
import { z } from 'zod';
import { parse } from '../common/zod';
import { AppError } from '../common/app-error';
import { CONFIG, type Config } from '../config';
import { RATE_LIMITER } from '../infra/tokens';
import type { RateLimiter } from '../infra/rate-limit';
import { Auth, AuthGuard, type AuthCtx } from './auth.guard';
import { AUTH, type AuthService } from './auth.service';
import { devFacebookPage, FACEBOOK, type FacebookService } from './facebook';
import { SOCIALS_VIEW, type SocialsViewFn } from '../phase2.controllers';

const ipOf = (r: Request) => r.ip ?? 'unknown';

/** Facebook: link it to my account, use it to sign in, and the page Facebook sends the browser back to. */
@Controller('v1')
export class FacebookController {
  constructor(
    @Inject(FACEBOOK) private fb: FacebookService, @Inject(AUTH) private auth: AuthService, @Inject(RATE_LIMITER) private limiter: RateLimiter,
    @Inject(CONFIG) private c: Config, @Inject(SOCIALS_VIEW) private view: SocialsViewFn,
  ) {}

  @Post('me/socials/facebook/start') @HttpCode(200) @UseGuards(AuthGuard)
  async startLink(@Auth() a: AuthCtx, @Body() b: unknown) {
    await this.limiter.hit(`fblink:${a.userId}`, 10, 3600);
    const v = parse(facebookStartSchema, b);
    return this.fb.startLink(a.userId, v.login, v.returnTo === 'app');
  }
  @Put('me/socials/facebook/login') @UseGuards(AuthGuard)
  async login(@Auth() a: AuthCtx, @Body() b: unknown) { await this.fb.setLogin(a.userId, parse(facebookLoginSchema, b).on); return this.view(a.userId); }
  @Delete('me/socials/facebook') @UseGuards(AuthGuard)
  async unlink(@Auth() a: AuthCtx) { await this.fb.unlink(a.userId); return this.view(a.userId); }

  @Post('auth/facebook/start') @HttpCode(200)
  async startLogin(@Body() b: unknown, @Req() r: Request) {
    await this.limiter.hit(`fbstart:${ipOf(r)}`, 30, 3600);
    const v = parse(z.object({ device: deviceSchema, returnTo: z.enum(['web', 'app']).default('web') }), b);
    return this.fb.startLogin(v.device, v.returnTo === 'app');
  }
  @Post('auth/facebook/finish') @HttpCode(200)
  async finish(@Body() b: unknown, @Req() r: Request) {
    const t = await this.fb.takeTicket(parse(facebookFinishSchema, b).ticket);
    return this.auth.facebookSignIn(t.user, t.device, ipOf(r));
  }

  @Get('oauth/facebook/callback')
  async callback(@Query() q: Record<string, string | undefined>, @Res() res: Response) {
    const code = q.code ?? (this.c.FACEBOOK_DRIVER === 'dev' && q.dev_name !== undefined ? `dev:${q.dev_name}` : undefined);
    res.redirect(302, await this.fb.callback({ state: q.state, code, error: q.error }));
  }
  @Get('oauth/facebook/dev')
  dev(@Query('state') state: string, @Res() res: Response) {
    if (this.c.FACEBOOK_DRIVER !== 'dev' || !state) throw AppError.notFound();
    // Its form goes to the callback, which sends the browser on to the web app: allow that hop.
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; form-action *; base-uri 'none'; frame-ancestors 'none'");
    res.type('html').send(devFacebookPage(state, `${this.c.PUBLIC_URL.replace(/\/$/, '')}/v1/oauth/facebook/callback`));
  }
}

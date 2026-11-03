import { DynamicModule, Module, type Provider } from '@nestjs/common';
import type Redis from 'ioredis';
import type { Db, MongoClient } from 'mongodb';
import { CONFIG, type Config } from './config';
import { LOGGER, type Logger } from './common/logger';
import { DB, MONGO_CLIENT } from './infra/mongo';
import { REDIS } from './infra/redis';
import { RateLimiter } from './infra/rate-limit';
import { RATE_LIMITER } from './infra/tokens';
import { STORAGE, type Storage } from './infra/storage';
import { HealthController } from './health/health.controller';
import { AuthController } from './auth/auth.controller';
import { AuthGuard } from './auth/auth.guard';
import { AUTH, AuthService } from './auth/auth.service';
import { createGoogleVerifier, GOOGLE } from './auth/google';
import { OTP, OtpService } from './auth/otp.service';
import { createSenders, OUTBOX } from './auth/senders';
import { SESSIONS, SessionService } from './auth/sessions';
import { TOKENS, TokenService } from './auth/tokens';
import { MeController } from './users/me.controller';
import { USERS, UsersRepo } from './users/users.repo';
import { ContactsController } from './contacts/contacts.controller';
import { MediaController } from './media/media.controller';
import { TestController } from './testing/test.controller';
import { CHAT, ChatService } from './chat/chat.service';
import { ChatController, PeopleController } from './chat/chat.controller';
import { GROUPS, GroupsService } from './chat/groups.service';
import { GroupsController, InvitesController } from './chat/groups.controller';
import { MESSAGES, MessagesService } from './chat/messages.service';
import { PUSH, PushService } from './push/push.service';
import { SEARCH, SearchService } from './chat/search.service';
import { SearchController } from './chat/search.controller';
import { CHAT_PREFS, ChatPrefsService } from './chat/prefs.service';
import { SAFETY, SafetyService } from './chat/safety.service';
import { ChatPrefsController } from './chat/prefs.controller';
import { ACCOUNT, AccountService } from './users/account.service';
import { COMMUNITIES, CommunitiesService } from './chat/communities.service';
import { CIRCLES, CirclesService } from './chat/circles.service';
import { CircleCommentsController, CircleEventsController, CirclePostsController, CirclesController } from './chat/circles.controller';
import { CommunitiesController, CommunityInvitesController } from './chat/communities.controller';
import { SUPPORT, SupportService } from './users/support.service';
import { SupportController } from './users/support.controller';
import { PushController } from './push/push.controller';
import { CALLS, CallsService } from './calls/calls.service';
import { CallsController, LiveKitWebhookController } from './calls/calls.controller';
import { MessageActionsController, PollsController, StarredController } from './chat/messages.controller';
import { REWARDS, RewardsService } from './rewards/rewards.service';
import { DevIndexx, INDEXX, offIndexx } from './indexx/indexx.provider';
import { INDEXX_SERVICE, IndexxService } from './indexx/indexx.service';
import { PAYMENTS, PaymentsService } from './pay/payments.service';
import { AI_PROVIDER, createAiProvider } from './ai/ai.provider';
import { AI, AiService } from './ai/ai.service';
import { FacebookController } from './auth/facebook.controller';
import { createFacebook, FACEBOOK, FacebookService } from './auth/facebook';
import { AiController, IndexxController, SOCIALS_VIEW, mySocials, PayController, RewardsController, SiteController, SocialsController, SupportDeskController } from './phase2.controllers';

export interface Infra { config: Config; log: Logger; mongo: MongoClient; db: Db; redis: Redis; storage: Storage }

@Module({})
export class AppModule {
  static register(i: Infra): DynamicModule {
    const { config: c, log, db, redis, storage } = i;
    const senders = createSenders(c, redis, log);
    const limiter = new RateLimiter(redis);
    const tokens = new TokenService(c.JWT_SECRET, c.ACCESS_TTL_SECONDS);
    const users = new UsersRepo(db);
    const sessions = new SessionService(db, redis, tokens, c);
    const otp = new OtpService(redis, c, limiter, senders.phone, senders.email);
    const google = createGoogleVerifier(c);
    const auth = new AuthService(users, otp, sessions, tokens, google, storage, redis);
    const chat = new ChatService(i.mongo, db, storage);
    const groups = new GroupsService(chat, db);
    const messages = new MessagesService(chat);
    const push = new PushService(db, redis, c, log);
    const search = new SearchService(chat);
    const chatPrefs = new ChatPrefsService(chat);
    const safety = new SafetyService(chat);
    const support = new SupportService(users, chat, db);
    const communities = new CommunitiesService(chat, groups, db);
    const account = new AccountService(users, otp, sessions, chat, groups, chatPrefs, push, storage, limiter, db);
    const circles = new CirclesService(chat, communities, safety, db);
    account.leaveCommunities = async (id) => { await communities.leaveAll(id); await circles.forget(id); };
    const calls = new CallsService(chat, push, db, c, log);
    const rewards = new RewardsService(i.mongo, db);
    const indexxProvider = c.INDEXX_DRIVER === 'dev' ? new DevIndexx(db) : offIndexx;
    const indexx = new IndexxService(indexxProvider, db, rewards);
    rewards.indexx = indexx;
    const payments = new PaymentsService(chat, indexx, limiter, db);
    indexx.payments = payments;
    const facebook = new FacebookService(createFacebook(c, log), users.col, redis, c);
    const aiProvider = createAiProvider(c, log);
    const ai = new AiService(aiProvider, db, redis, chat, rewards);
    ai.support = support;
    // Points for activity and referrals; never in the way of the message itself.
    circles.onPost = (u) => { void rewards.onCirclePost(u).catch((e) => log.warn({ err: e }, 'points for a circle post failed')); };
    chat.onSent = (u, conv) => { void rewards.onMessage(u, !!(conv as { communityId?: unknown }).communityId).catch((e) => log.warn({ err: e }, 'points for a message failed')); };
    const providers: Provider[] = [
      { provide: CONFIG, useValue: c }, { provide: LOGGER, useValue: log },
      { provide: MONGO_CLIENT, useValue: i.mongo }, { provide: DB, useValue: db }, { provide: REDIS, useValue: redis },
      { provide: STORAGE, useValue: storage }, { provide: RATE_LIMITER, useValue: limiter }, { provide: OUTBOX, useValue: senders.outbox },
      { provide: TOKENS, useValue: tokens }, { provide: USERS, useValue: users }, { provide: SESSIONS, useValue: sessions },
      { provide: OTP, useValue: otp }, { provide: GOOGLE, useValue: google }, { provide: AUTH, useValue: auth }, { provide: CHAT, useValue: chat }, { provide: GROUPS, useValue: groups }, { provide: MESSAGES, useValue: messages }, { provide: PUSH, useValue: push }, { provide: SEARCH, useValue: search }, { provide: CHAT_PREFS, useValue: chatPrefs }, { provide: SAFETY, useValue: safety }, { provide: ACCOUNT, useValue: account }, { provide: SUPPORT, useValue: support }, { provide: COMMUNITIES, useValue: communities }, { provide: CIRCLES, useValue: circles }, { provide: CALLS, useValue: calls },
      { provide: REWARDS, useValue: rewards }, { provide: INDEXX, useValue: indexxProvider }, { provide: INDEXX_SERVICE, useValue: indexx }, { provide: PAYMENTS, useValue: payments }, { provide: AI_PROVIDER, useValue: aiProvider }, { provide: AI, useValue: ai }, { provide: FACEBOOK, useValue: facebook }, { provide: SOCIALS_VIEW, useValue: mySocials(users.col, facebook.available) },
      AuthGuard,
    ];
    const controllers: DynamicModule['controllers'] = [HealthController, AuthController, MeController, ContactsController, MediaController, ChatController, PeopleController, GroupsController, InvitesController, MessageActionsController, StarredController, PollsController, PushController, SearchController, ChatPrefsController, SupportController, CommunitiesController, CommunityInvitesController, CirclesController, CirclePostsController, CircleCommentsController, CircleEventsController, CallsController, LiveKitWebhookController, RewardsController, IndexxController, PayController, AiController, SiteController, SupportDeskController, FacebookController, SocialsController];
    if (c.TEST_OUTBOX && c.NODE_ENV !== 'production') controllers.push(TestController);
    return { module: AppModule, providers, controllers };
  }
}

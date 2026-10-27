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
import { PushController } from './push/push.controller';
import { MessageActionsController, StarredController } from './chat/messages.controller';

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
    const providers: Provider[] = [
      { provide: CONFIG, useValue: c }, { provide: LOGGER, useValue: log },
      { provide: MONGO_CLIENT, useValue: i.mongo }, { provide: DB, useValue: db }, { provide: REDIS, useValue: redis },
      { provide: STORAGE, useValue: storage }, { provide: RATE_LIMITER, useValue: limiter }, { provide: OUTBOX, useValue: senders.outbox },
      { provide: TOKENS, useValue: tokens }, { provide: USERS, useValue: users }, { provide: SESSIONS, useValue: sessions },
      { provide: OTP, useValue: otp }, { provide: GOOGLE, useValue: google }, { provide: AUTH, useValue: auth }, { provide: CHAT, useValue: chat }, { provide: GROUPS, useValue: groups }, { provide: MESSAGES, useValue: messages }, { provide: PUSH, useValue: push }, { provide: SEARCH, useValue: search }, { provide: CHAT_PREFS, useValue: chatPrefs }, { provide: SAFETY, useValue: safety },
      AuthGuard,
    ];
    const controllers: DynamicModule['controllers'] = [HealthController, AuthController, MeController, ContactsController, MediaController, ChatController, PeopleController, GroupsController, InvitesController, MessageActionsController, StarredController, PushController, SearchController, ChatPrefsController];
    if (c.TEST_OUTBOX && c.NODE_ENV !== 'production') controllers.push(TestController);
    return { module: AppModule, providers, controllers };
  }
}

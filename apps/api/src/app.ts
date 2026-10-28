import { ACCOUNT, type AccountService } from './users/account.service';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import * as Sentry from '@sentry/node';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import { randomUUID } from 'crypto';
import { loadConfig, type Config } from './config';
import { createLogger } from './common/logger';
import { AllExceptionsFilter } from './common/exception.filter';
import { connectMongo, ensureIndexes } from './infra/mongo';
import { connectRedis } from './infra/redis';
import { createStorage } from './infra/storage';
import { AppModule } from './app.module';
import { SESSIONS, type SessionService } from './auth/sessions';
import { TOKENS, type TokenService } from './auth/tokens';
import { CHAT, type ChatService } from './chat/chat.service';
import { RateLimiter } from './infra/rate-limit';
import { C } from './infra/mongo';
import { Realtime } from './realtime/realtime';
import { PUSH, type PushService } from './push/push.service';
import { CALLS, type CallsService } from './calls/calls.service';

export async function createApp(env: Record<string, string | undefined> = process.env) {
  const config: Config = loadConfig(env);
  const log = createLogger(config.LOG_LEVEL);
  if (config.SENTRY_DSN) Sentry.init({ dsn: config.SENTRY_DSN, environment: config.NODE_ENV, release: config.version });
  const mongo = await connectMongo(config);
  const db = mongo.db(config.MONGO_DB);
  await ensureIndexes(db, config, log);
  const redis = connectRedis(config.REDIS_URL);
  const storage = createStorage(config);

  const app = await NestFactory.create<NestExpressApplication>(AppModule.register({ config, log, mongo, db, redis, storage }), { logger: config.LOG_LEVEL === 'silent' ? false : ['error', 'warn'], bodyParser: false });
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(pinoHttp({ logger: log, genReqId: (req, res) => { const id = (req.headers['x-request-id'] as string) || randomUUID(); res.setHeader('x-request-id', id); return id; }, autoLogging: config.LOG_LEVEL !== 'silent' }));
  app.useBodyParser('json', { limit: '256kb' });
  // LiveKit webhooks are checked against the exact bytes sent.
  app.useBodyParser('raw', { type: 'application/webhook+json', limit: '64kb' });
  app.enableCors({ origin: config.corsOrigins, credentials: false, exposedHeaders: ['x-request-id', 'retry-after'] });
  app.useGlobalFilters(new AllExceptionsFilter(log));

  const sessions = app.get<SessionService>(SESSIONS), chat = app.get<ChatService>(CHAT);
  const push = app.get<PushService>(PUSH);
  const realtime = new Realtime({ config, log, redis, sessions, chat, push, tokens: app.get<TokenService>(TOKENS), limiter: new RateLimiter(redis), users: db.collection(C.users) });
  realtime.attach(app.getHttpServer());
  // Live events go to sockets; new messages also go to notifications for people who aren't looking.
  chat.events = {
    messageCreated: (users, m) => { realtime.messageCreated(users, m); void chat.convs.findOne({ _id: chat.parseId(m.conversationId) }).then((c) => { if (c) push.messageCreated(c, m, users); }); },
    receiptChanged: (...a) => realtime.receiptChanged(...a),
    conversationChanged: (...a) => realtime.conversationChanged(...a),
    blocked: (...a) => realtime.blocked(...a),
  };
  chat.msgEvents = realtime;
  app.get<AccountService>(ACCOUNT).onPrivacyChanged = (u) => realtime.privacyChanged(u);
  chat.onRead = (u, conv) => push.read(u, conv);
  const calls = app.get<CallsService>(CALLS);
  calls.events = { call: (u, ev, call) => realtime.callEvent(u, ev, call) };
  sessions.onRevoked = (sid) => { realtime.kickSession(sid); void push.forgetSession(sid).catch(() => undefined); };

  /** Stops sockets and HTTP, then the database and Redis connections, so the process can exit. */
  const shutdown = async () => {
    calls.close();
    await realtime.close().catch(() => undefined);
    await app.close().catch(() => undefined);
    await mongo.close(true).catch(() => undefined);
    redis.disconnect();
  };
  return { app, config, db, redis, log, realtime, shutdown };
}

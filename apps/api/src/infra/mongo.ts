import { Db, MongoClient, MongoServerError, type CreateIndexesOptions, type IndexSpecification } from 'mongodb';
import type { Config } from '../config';
import type { Logger } from '../common/logger';

export const MONGO_CLIENT = Symbol('MONGO_CLIENT');
export const DB = Symbol('DB');

export async function connectMongo(c: Config): Promise<MongoClient> {
  const client = new MongoClient(c.MONGO_URI, { serverSelectionTimeoutMS: 10000, appName: 'yaysapp-v2-api', retryWrites: true });
  await client.connect();
  return client;
}

/** Collections owned by v2. The old app's collections are never written. */
export const C = {
  users: 'users', // shared with BTCY and the old app: v2 only adds fields under `yc`
  sessions: 'yc_sessions',
  conversations: 'yc_conversations',
  messages: 'yc_messages',
  receipts: 'yc_receipts',
  joinRequests: 'yc_join_requests',
  stars: 'yc_stars',
  pushSubs: 'yc_push_subscriptions',
  chatPrefs: 'yc_chat_prefs',
  blocks: 'yc_blocks',
  reports: 'yc_reports',
  accountDeletions: 'yc_account_deletions',
  problemReports: 'yc_problem_reports',
  communities: 'yc_communities',
  communityMembers: 'yc_community_members',
  communityRequests: 'yc_community_requests',
  communitySuggestions: 'yc_community_suggestions',
  calls: 'yc_calls',
  callLinks: 'yc_call_links',
  points: 'yc_points',
  pointsLedger: 'yc_points_ledger',
  activity: 'yc_activity',
  checkins: 'yc_checkins',
  referrals: 'yc_referrals',
  popups: 'yc_popups',
  payments: 'yc_payments',
  aiChats: 'yc_ai_chats',
  aiMessages: 'yc_ai_messages',
  aiConsent: 'yc_ai_consent',
  leads: 'yc_leads',
  supportTickets: 'yc_support_tickets',
} as const;

const isIndexConflict = (e: unknown) => e instanceof MongoServerError && [85, 86].includes(Number(e.code ?? 0)); // IndexOptionsConflict / IndexKeySpecsConflict

export async function ensureIndexes(db: Db, c: Config, log: Logger) {
  const sessions = db.collection(C.sessions);
  await sessions.createIndexes([
    { key: { userId: 1, revokedAt: 1 }, name: 'user_active' },
    { key: { userId: 1, deviceId: 1 }, name: 'user_device' },
    { key: { expiresAt: 1 }, name: 'expires_ttl', expireAfterSeconds: 0 },
  ]);
  await db.collection(C.conversations).createIndexes([
    { key: { members: 1, lastAt: -1, _id: -1 }, name: 'member_recent' },
    { key: { directKey: 1 }, name: 'direct_pair_unique', unique: true, partialFilterExpression: { directKey: { $type: 'string' } } },
    { key: { former: 1, lastAt: -1, _id: -1 }, name: 'former_recent' },
    { key: { inviteCode: 1 }, name: 'invite_code_unique', unique: true, partialFilterExpression: { inviteCode: { $type: 'string' } } },
  ]);
  await db.collection(C.pushSubs).createIndexes([{ key: { userId: 1 }, name: 'user' }, { key: { sid: 1 }, name: 'session' }]);
  await db.collection(C.chatPrefs).createIndexes([{ key: { userId: 1 }, name: 'user' }, { key: { userId: 1, archived: 1 }, name: 'user_archived' }, { key: { userId: 1, pinnedAt: -1 }, name: 'user_pinned' }]);
  await db.collection(C.communities).createIndexes([{ key: { inviteCode: 1 }, name: 'invite', unique: true, partialFilterExpression: { inviteCode: { $type: 'string' } } }]);
  await db.collection(C.communityMembers).createIndexes([{ key: { userId: 1, joinedAt: -1 }, name: 'user' }, { key: { communityId: 1, joinedAt: 1 }, name: 'community' }]);
  await db.collection(C.communityRequests).createIndexes([{ key: { communityId: 1, createdAt: 1 }, name: 'community' }]);
  await db.collection(C.conversations).createIndex({ communityId: 1 }, { name: 'community', partialFilterExpression: { communityId: { $type: 'objectId' } } });
  await db.collection(C.calls).createIndexes([{ key: { 'parts.userId': 1, createdAt: -1 }, name: 'part_recent' }, { key: { convId: 1, status: 1 }, name: 'conv_status' }, { key: { linkCode: 1, status: 1 }, name: 'link_status' }]);
  await db.collection(C.callLinks).createIndexes([{ key: { createdBy: 1, createdAt: -1 }, name: 'creator' }]);
  await db.collection(C.blocks).createIndexes([{ key: { by: 1, at: -1 }, name: 'by' }]);
  await db.collection(C.reports).createIndexes([{ key: { at: -1 }, name: 'recent' }, { key: { targetUserId: 1, at: -1 }, name: 'target' }, { key: { convId: 1, status: 1, at: -1 }, name: 'conv_open' }]);
  await db.collection(C.messages).createIndex({ convId: 1, 'attachment.kind': 1, seq: -1 }, { name: 'conv_media', partialFilterExpression: { type: 'media' } });
  await db.collection(C.stars).createIndexes([{ key: { userId: 1, at: -1 }, name: 'user_recent' }, { key: { userId: 1, msgId: 1 }, name: 'user_msg' }]);
  await db.collection(C.joinRequests).createIndexes([{ key: { convId: 1, createdAt: 1 }, name: 'conv_time' }]);
  await db.collection(C.messages).createIndexes([
    { key: { convId: 1, seq: 1 }, name: 'conv_seq_unique', unique: true },
    { key: { senderId: 1, clientId: 1 }, name: 'sender_client_unique', unique: true },
  ]);
  await db.collection(C.receipts).createIndexes([{ key: { convId: 1 }, name: 'conv' }]);
  await db.collection(C.pointsLedger).createIndexes([
    { key: { userId: 1, key: 1 }, name: 'user_key_unique', unique: true },
    { key: { userId: 1, _id: -1 }, name: 'user_recent' },
    { key: { userId: 1, day: 1, capped: 1 }, name: 'user_day' },
    { key: { userId: 1, week: 1 }, name: 'user_week' },
  ]);
  await db.collection(C.referrals).createIndexes([{ key: { inviterId: 1, at: -1 }, name: 'inviter' }]);
  await db.collection(C.payments).createIndexes([
    { key: { fromId: 1, _id: -1 }, name: 'from' }, { key: { toId: 1, _id: -1 }, name: 'to' },
    { key: { fromId: 1, clientId: 1 }, name: 'from_client' }, { key: { toId: 1, clientId: 1 }, name: 'to_client' },
  ]);
  await db.collection(C.aiChats).createIndexes([{ key: { userId: 1, updatedAt: -1 }, name: 'user_recent' }]);
  await db.collection(C.aiMessages).createIndexes([{ key: { chatId: 1, _id: 1 }, name: 'chat' }]);
  await db.collection(C.supportTickets).createIndexes([{ key: { number: 1 }, name: 'number', unique: true }, { key: { userId: 1, at: -1 }, name: 'user' }]);
  if (!c.USERS_INDEXES_ON_BOOT) return;
  // Partial indexes only touch documents that have the v2 field, so existing BTCY users are unaffected.
  const users = db.collection(C.users);
  const specs: Array<{ key: IndexSpecification } & CreateIndexesOptions & { name: string }> = [
    { key: { 'yc.phoneE164': 1 }, name: 'yc_phone_unique', unique: true, partialFilterExpression: { 'yc.phoneE164': { $type: 'string' } } },
    { key: { 'yc.emailLower': 1 }, name: 'yc_email_unique', unique: true, partialFilterExpression: { 'yc.emailLower': { $type: 'string' } } },
    { key: { 'yc.googleSub': 1 }, name: 'yc_google_unique', unique: true, partialFilterExpression: { 'yc.googleSub': { $type: 'string' } } },
    { key: { 'yc.username': 1 }, name: 'yc_username_unique', unique: true, partialFilterExpression: { 'yc.username': { $type: 'string' } } },
    { key: { email: 1 }, name: 'email_1' },
    { key: { 'yc.facebook.id': 1 }, name: 'yc_facebook_unique', unique: true, partialFilterExpression: { 'yc.facebook.id': { $type: 'string' } } },
    { key: { 'yc.refCode': 1 }, name: 'yc_refcode_unique', unique: true, partialFilterExpression: { 'yc.refCode': { $type: 'string' } } },
    { key: { 'yc.indexx.account': 1 }, name: 'yc_indexx_account', partialFilterExpression: { 'yc.indexx.account': { $type: 'string' } } },
  ];
  for (const s of specs) {
    try { const { key, ...opts } = s; await users.createIndex(key, opts); }
    catch (e) { if (isIndexConflict(e)) log.warn({ index: s.name }, 'users index already exists with other options; left as is'); else throw e; }
  }
}

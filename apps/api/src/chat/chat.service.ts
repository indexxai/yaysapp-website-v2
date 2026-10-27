import { MongoServerError, ObjectId, type ClientSession, type Collection, type Db, type MongoClient } from 'mongodb';
import {
  DEFAULT_GROUP_SETTINGS,
  type ChatMessage, type ConversationPage, type ConversationSummary, type GroupMeta, type GroupSettings, type MemberReceipt, type MessagePage, type PinnedMessage, type PublicProfile, type ReplyPreview, type SendResult, type SystemEvent,
} from '@yays/shared';
import { AppError } from '../common/app-error';
import { C } from '../infra/mongo';
import type { Storage } from '../infra/storage';
import { displayNameOf, toPublic, type UserDoc } from '../users/users.repo';

export interface ConversationDoc {
  _id: ObjectId;
  kind: 'direct' | 'group';
  members: ObjectId[];
  /** `<smaller id>:<larger id>` for direct chats, so each pair has exactly one. */
  directKey?: string;
  /** Last message number handed out. Messages are numbered 1, 2, 3… inside a transaction, so there are no gaps. */
  seq: number;
  lastMessageId?: ObjectId;
  lastAt: Date;
  createdAt: Date;
  createdBy: ObjectId;
  // ---- groups ----
  name?: string;
  about?: string;
  photoKey?: string | null;
  admins?: ObjectId[];
  /** People who left or were removed. They keep read-only access to the history up to then. */
  former?: ObjectId[];
  ownerId?: ObjectId;
  settings?: GroupSettings;
  inviteCode?: string | null;
  /** Pinned messages, newest last. */
  pins?: Array<{ msgId: ObjectId; seq: number; by: ObjectId; at: Date }>;
}
export interface MessageDoc {
  _id: ObjectId;
  convId: ObjectId;
  seq: number;
  senderId: ObjectId;
  clientId: string;
  type: 'text' | 'system';
  text: string;
  system?: SystemEvent;
  createdAt: Date;
  replyToId?: ObjectId;
  forwarded?: boolean;
  editedAt?: Date;
  /** Deleted for everyone. The text is cleared when this is set. */
  deletedAt?: Date;
  deletedBy?: ObjectId;
  reactions?: Array<{ u: ObjectId; e: string; at: Date }>;
  /** People who deleted it for themselves. */
  hiddenFor?: ObjectId[];
}
/**
 * One row per person per conversation: how far they have received and read, and which part of the history they
 * can see (fromSeq: joined after this message; leftSeq: left at this message).
 */
export interface ReceiptDoc {
  _id: string; convId: ObjectId; userId: ObjectId; deliveredSeq: number; readSeq: number; updatedAt: Date; fromSeq?: number; leftSeq?: number;
  /** When the read / delivered point moved, so message info can say "read at 11:47". Last 300 moves. */
  readMarks?: Array<{ s: number; t: Date }>;
  deliveredMarks?: Array<{ s: number; t: Date }>;
}

/** What the real-time layer needs to hear about. Kept as an interface so the service has no socket code in it. */
export interface ChatEvents {
  messageCreated(userIds: ObjectId[], message: ChatMessage): void;
  receiptChanged(members: ObjectId[], conversationId: string, userId: string, r: MemberReceipt): void;
  conversationChanged(userIds: ObjectId[], conversationId: string): void;
}
const noEvents: ChatEvents = { messageCreated() {}, receiptChanged() {}, conversationChanged() {} };

const UNREAD_CAP = 100;
const MAX_SEQ = Number.MAX_SAFE_INTEGER;
export const rKey = (conv: ObjectId, user: ObjectId) => `${conv.toHexString()}:${user.toHexString()}`;
export const isDup = (e: unknown) => e instanceof MongoServerError && e.code === 11000;
export const has = (list: ObjectId[] | undefined, id: ObjectId) => !!list?.some((x) => x.equals(id));
const DELETED: PublicProfile = { id: '', displayName: 'Deleted account', username: null, about: '', photoUrl: null };

export interface MessageEvents {
  messageUpdated(userIds: ObjectId[], message: ChatMessage): void;
  mine(userId: ObjectId, p: { conversationId: string; messageId: string; hidden?: boolean; starred?: boolean }): void;
}

export const replyPreview = (t: MessageDoc): ReplyPreview => ({
  id: t._id.toHexString(), seq: t.seq, senderId: t.senderId.toHexString(), type: t.type, deleted: !!t.deletedAt,
  text: t.deletedAt ? '' : t.text.length > 200 ? `${t.text.slice(0, 200)}…` : t.text,
});

/** A message as apps see it. Deleted messages lose their text, reactions and quote. */
export function toMessage(m: MessageDoc, replies?: Map<string, MessageDoc>, viewer?: { id: ObjectId; starred: Set<string> }): ChatMessage {
  const out: ChatMessage = {
    id: m._id.toHexString(), conversationId: m.convId.toHexString(), seq: m.seq, senderId: m.senderId.toHexString(), clientId: m.clientId,
    type: m.type, text: m.deletedAt ? '' : m.text, ...(m.system ? { system: m.system } : {}), createdAt: m.createdAt.toISOString(),
  };
  if (m.forwarded) out.forwarded = true;
  if (m.editedAt && !m.deletedAt) out.editedAt = m.editedAt.toISOString();
  const hiddenForViewer = viewer && has(m.hiddenFor, viewer.id);
  if (m.deletedAt || hiddenForViewer) { out.deleted = true; out.text = ''; return out; }
  if (m.replyToId) { const t = replies?.get(m.replyToId.toHexString()); out.replyTo = t ? replyPreview(t) : null; }
  if (m.reactions?.length) {
    const r: Record<string, string[]> = {};
    for (const x of [...m.reactions].sort((a, b) => a.at.getTime() - b.at.getTime())) (r[x.e] ??= []).push(x.u.toHexString());
    out.reactions = r;
  }
  if (viewer) out.starred = viewer.starred.has(m._id.toHexString());
  return out;
}

export interface StarDoc { _id: string; userId: ObjectId; msgId: ObjectId; convId: ObjectId; at: Date }

/** What one person may see of a conversation. */
export interface Access { c: ConversationDoc; member: boolean; fromSeq: number; untilSeq: number }

export class ChatService {
  readonly convs: Collection<ConversationDoc>;
  readonly msgs: Collection<MessageDoc>;
  readonly receipts: Collection<ReceiptDoc>;
  readonly users: Collection<UserDoc>;
  events: ChatEvents = noEvents;
  msgEvents: MessageEvents = { messageUpdated() {}, mine() {} };
  readonly stars: Collection<StarDoc>;

  constructor(readonly client: MongoClient, db: Db, readonly storage: Storage) {
    this.stars = db.collection(C.stars);
    this.convs = db.collection(C.conversations);
    this.msgs = db.collection(C.messages);
    this.receipts = db.collection(C.receipts);
    this.users = db.collection(C.users);
  }

  parseId(convId: string | ObjectId) {
    if (typeof convId !== 'string') return convId;
    if (!/^[a-f0-9]{24}$/i.test(convId)) throw AppError.notFound('Chat not found.');
    return new ObjectId(convId);
  }

  /** The conversation, only if this user is in it now. Anything else is "not found", so ids can't be probed. */
  async memberConv(convId: string | ObjectId, userId: ObjectId, session?: ClientSession) {
    const c = await this.convs.findOne({ _id: this.parseId(convId), members: userId }, { session });
    if (!c) throw AppError.notFound('Chat not found.');
    return c;
  }

  /** Members, and former members for the history they were there for. */
  async access(convId: string | ObjectId, me: ObjectId): Promise<Access> {
    const c = await this.convs.findOne({ _id: this.parseId(convId), $or: [{ members: me }, { former: me }] });
    if (!c) throw AppError.notFound('Chat not found.');
    const member = has(c.members, me);
    const r = await this.receipts.findOne({ _id: rKey(c._id, me) });
    return { c, member, fromSeq: r?.fromSeq ?? 0, untilSeq: member ? MAX_SEQ : Math.min(r?.leftSeq ?? 0, c.seq) };
  }

  /** Runs `fn` in a snapshot transaction, retried on write conflicts. */
  async tx<T>(fn: (s: ClientSession) => Promise<T>): Promise<T> {
    const session = this.client.startSession();
    try {
      let out!: T;
      await session.withTransaction(async () => { out = await fn(session); }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } });
      return out;
    } finally { await session.endSession(); }
  }

  /**
   * Adds the next message number to the conversation together with `update` (member changes, settings…),
   * and stores a system message for it. Call inside a transaction.
   */
  async appendSystem(s: ClientSession, convId: ObjectId, actor: ObjectId, event: SystemEvent, update: Record<string, Record<string, unknown>> = {}, filter: Record<string, unknown> = {}) {
    const now = new Date();
    const id = new ObjectId();
    const c = await this.convs.findOneAndUpdate(
      { _id: convId, ...filter },
      { ...update, $inc: { seq: 1, ...(update.$inc ?? {}) }, $set: { lastAt: now, lastMessageId: id, ...(update.$set ?? {}) } },
      { session: s, returnDocument: 'after' },
    );
    if (!c) throw AppError.notFound('Chat not found.');
    const m: MessageDoc = { _id: id, convId, seq: c.seq, senderId: actor, clientId: `sys-${id.toHexString()}`, type: 'system', text: '', system: event, createdAt: now };
    await this.msgs.insertOne(m, { session: s });
    await this.receipts.updateOne({ _id: rKey(convId, actor) }, { $max: { deliveredSeq: c.seq, readSeq: c.seq }, $set: { updatedAt: now }, $setOnInsert: { convId, userId: actor } }, { upsert: true, session: s });
    return { c, m };
  }

  /** Finds or starts the one direct chat between two people. Safe to call twice at once from both sides. */
  async openDirect(me: ObjectId, otherId: string): Promise<ConversationSummary> {
    const other = new ObjectId(otherId);
    if (other.equals(me)) throw AppError.validation("You can't start a chat with yourself.");
    const peer = await this.users.findOne({ _id: other });
    if (!peer || peer.yc?.disabledAt) throw AppError.notFound('That person is not on YaysApp.');
    const [a, b] = [me.toHexString(), other.toHexString()].sort();
    const directKey = `${a}:${b}`;
    const now = new Date();
    try {
      await this.convs.updateOne(
        { directKey },
        { $setOnInsert: { _id: new ObjectId(), kind: 'direct', members: [new ObjectId(a), new ObjectId(b)], directKey, seq: 0, lastAt: now, createdAt: now, createdBy: me } },
        { upsert: true },
      );
    } catch (e) { if (!isDup(e)) throw e; /* the other side created it a moment ago */ }
    const conv = await this.convs.findOne({ directKey });
    return (await this.summaries(me, [conv!]))[0];
  }

  async list(me: ObjectId, before: string | undefined, limit: number): Promise<ConversationPage> {
    const filter: Record<string, unknown> = { $or: [{ members: me }, { former: me }], seq: { $gt: 0 } };
    if (before) {
      const m = /^(\d{1,15})_([a-f0-9]{24})$/.exec(before);
      if (!m) throw AppError.validation('That page link is not valid.');
      const at = new Date(Number(m[1])), id = new ObjectId(m[2]);
      filter.$and = [{ $or: [{ lastAt: { $lt: at } }, { lastAt: at, _id: { $lt: id } }] }];
    }
    const rows = await this.convs.find(filter).sort({ lastAt: -1, _id: -1 }).limit(limit + 1).toArray();
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    return { items: await this.summaries(me, page), next: rows.length > limit && last ? `${last.lastAt.getTime()}_${last._id.toHexString()}` : null };
  }

  async one(me: ObjectId, convId: string): Promise<ConversationSummary> {
    return (await this.summaries(me, [(await this.access(convId, me)).c]))[0];
  }

  photo = (k: string) => this.storage.downloadUrl(k);
  isAdmin(c: ConversationDoc, u: ObjectId) { return has(c.admins, u); }
  settingsOf(c: ConversationDoc): GroupSettings { return { ...DEFAULT_GROUP_SETTINGS, ...(c.settings ?? {}) }; }
  /** Admins may always; members when the group allows everyone. */
  may(c: ConversationDoc, u: ObjectId, what: 'editInfo' | 'send' | 'addMembers' | 'pin') {
    if (c.kind === 'direct') return has(c.members, u);
    return has(c.members, u) && (this.isAdmin(c, u) || this.settingsOf(c)[what] === 'all');
  }

  async groupMeta(c: ConversationDoc, me: ObjectId): Promise<GroupMeta> {
    return {
      name: c.name ?? 'Group', about: c.about ?? '', photoUrl: c.photoKey ? await this.photo(c.photoKey) : null, memberCount: c.members.length,
      role: !has(c.members, me) ? 'former' : this.isAdmin(c, me) ? 'admin' : 'member',
      ownerId: (c.ownerId ?? c.createdBy).toHexString(), adminIds: (c.admins ?? []).map((a) => a.toHexString()), settings: this.settingsOf(c),
    };
  }

  /** Builds what the chat list shows: the other person or group, last message, unread count and everyone's ticks. */
  async summaries(me: ObjectId, convs: ConversationDoc[]): Promise<ConversationSummary[]> {
    if (!convs.length) return [];
    const ids = convs.map((c) => c._id);
    const mine = new Map((await this.receipts.find({ _id: { $in: ids.map((i) => rKey(i, me)) } }).toArray()).map((r) => [r.convId.toHexString(), r]));
    const visibleLast = (c: ConversationDoc) => (has(c.members, me) ? c.seq : Math.min(mine.get(c._id.toHexString())?.leftSeq ?? 0, c.seq));
    // Former members see the last message from before they left.
    const lastMsgs = await Promise.all(convs.map((c) => (has(c.members, me) || !c.seq ? (c.lastMessageId ? this.msgs.findOne({ _id: c.lastMessageId }) : null) : this.msgs.findOne({ convId: c._id, seq: visibleLast(c) }))));
    const peerIds = convs.filter((c) => c.kind === 'direct').map((c) => c.members.find((m) => !m.equals(me))).filter((x): x is ObjectId => !!x);
    const senderIds = lastMsgs.map((m) => m?.senderId).filter((x): x is ObjectId => !!x);
    const people = await this.users.find({ _id: { $in: [...peerIds, ...senderIds] } }).toArray();
    const byId = new Map(people.map((u) => [u._id.toHexString(), u]));
    const recs = await this.receipts.find({ convId: { $in: ids } }).toArray();
    return Promise.all(convs.map(async (c, i) => {
      const member = has(c.members, me);
      const receipts: Record<string, MemberReceipt> = {};
      for (const m of c.members) receipts[m.toHexString()] = { deliveredSeq: 0, readSeq: 0 };
      for (const r of recs) if (r.convId.equals(c._id) && receipts[r.userId.toHexString()]) receipts[r.userId.toHexString()] = { deliveredSeq: Math.max(r.deliveredSeq, r.readSeq), readSeq: r.readSeq };
      const my = mine.get(c._id.toHexString());
      if (!member) receipts[me.toHexString()] = { deliveredSeq: my?.deliveredSeq ?? 0, readSeq: my?.readSeq ?? 0 };
      const lastSeq = visibleLast(c);
      const readFrom = Math.max(my?.readSeq ?? 0, my?.fromSeq ?? 0);
      const unread = lastSeq > readFrom ? await this.msgs.countDocuments({ convId: c._id, seq: { $gt: readFrom, $lte: lastSeq }, senderId: { $ne: me } }, { limit: UNREAD_CAP }) : 0;
      const last = lastMsgs[i];
      const peerId = c.kind === 'direct' ? c.members.find((m) => !m.equals(me)) : undefined;
      const peerDoc = peerId ? byId.get(peerId.toHexString()) : undefined;
      const sender = last ? byId.get(last.senderId.toHexString()) : undefined;
      return {
        id: c._id.toHexString(), kind: c.kind,
        peer: peerId ? (peerDoc ? await toPublic(peerDoc, this.photo) : { ...DELETED, id: peerId.toHexString() }) : null,
        group: c.kind === 'group' ? await this.groupMeta(c, me) : null,
        canSend: member && this.may(c, me, 'send'),
        memberIds: c.members.map((m) => m.toHexString()), lastSeq, lastMessage: last && last.seq > (my?.fromSeq ?? 0) ? toMessage(last, undefined, { id: me, starred: new Set() }) : null, unread, receipts,
        lastSenderName: last ? (last.senderId.equals(me) ? 'You' : sender ? displayNameOf(sender) : DELETED.displayName) : null,
        pins: await this.pinsOf(c),
        lastActivityAt: (member ? c.lastAt : last?.createdAt ?? c.lastAt).toISOString(),
      };
    }));
  }

  /** Turns stored messages into what one person sees: quotes resolved, their stars, their deletions. */
  async present(rows: MessageDoc[], viewer?: ObjectId): Promise<ChatMessage[]> {
    const replyIds = [...new Set(rows.map((m) => m.replyToId?.toHexString()).filter((x): x is string => !!x))];
    const replies = new Map(replyIds.length ? (await this.msgs.find({ _id: { $in: replyIds.map((x) => new ObjectId(x)) } }).toArray()).map((t) => [t._id.toHexString(), t]) : []);
    const starred = new Set(viewer && rows.length ? (await this.stars.find({ userId: viewer, msgId: { $in: rows.map((m) => m._id) } }, { projection: { msgId: 1 } }).toArray()).map((x) => x.msgId.toHexString()) : []);
    return rows.map((m) => toMessage(m, replies, viewer ? { id: viewer, starred } : undefined));
  }

  async messages(me: ObjectId, convId: string, q: { before?: number; after?: number; limit: number }): Promise<MessagePage> {
    const { c, fromSeq, untilSeq } = await this.access(convId, me);
    // Messages I deleted for myself are left out entirely.
    const range = (extra: Record<string, number>) => ({ convId: c._id, seq: { $gt: fromSeq, $lte: untilSeq, ...extra }, hiddenFor: { $ne: me } });
    if (q.after !== undefined) {
      // Catching up after being offline: oldest first from the point the device already has.
      const rows = await this.msgs.find(range({ $gt: Math.max(q.after, fromSeq) })).sort({ seq: 1 }).limit(q.limit + 1).toArray();
      return { items: await this.present(rows.slice(0, q.limit), me), hasMore: rows.length > q.limit };
    }
    const rows = await this.msgs.find(q.before !== undefined ? range({ $lt: q.before }) : range({})).sort({ seq: -1 }).limit(q.limit + 1).toArray();
    return { items: await this.present(rows.slice(0, q.limit).reverse(), me), hasMore: rows.length > q.limit };
  }

  /**
   * Stores a message exactly once. The number, the message and the sender's own receipt are written in one
   * transaction, so a retry with the same clientId returns the first copy and the numbers have no gaps.
   */
  async send(me: ObjectId, convId: string, clientId: string, text: string, opts: { replyToId?: string; forwarded?: boolean } = {}): Promise<SendResult> {
    const existing = await this.msgs.findOne({ senderId: me, clientId });
    if (existing) return this.duplicate(existing, convId, me);
    const pre = await this.memberConv(convId, me);
    if (!this.may(pre, me, 'send')) throw AppError.forbidden('Only admins can send messages in this group.');
    let replyToId: ObjectId | undefined;
    if (opts.replyToId) {
      const t = await this.msgs.findOne({ _id: new ObjectId(opts.replyToId), convId: pre._id });
      const from = (await this.receipts.findOne({ _id: rKey(pre._id, me) }))?.fromSeq ?? 0;
      if (!t || t.seq <= from || has(t.hiddenFor, me)) throw AppError.validation('The message you’re replying to isn’t in this chat.');
      if (t.type === 'system') throw AppError.validation('You can’t reply to that.');
      if (t.deletedAt) throw AppError.validation('You can’t reply to a deleted message.');
      replyToId = t._id;
    }
    let created: MessageDoc | null = null;
    let conv: ConversationDoc | null = null;
    try {
      await this.tx(async (session) => {
        created = null; conv = null;
        const again = await this.msgs.findOne({ senderId: me, clientId }, { session });
        if (again) { created = again; return; }
        const now = new Date();
        const id = new ObjectId();
        const c = await this.convs.findOneAndUpdate({ _id: pre._id, members: me }, { $inc: { seq: 1 }, $set: { lastAt: now, lastMessageId: id } }, { session, returnDocument: 'after' });
        if (!c) throw AppError.notFound('Chat not found.');
        const m: MessageDoc = { _id: id, convId: c._id, seq: c.seq, senderId: me, clientId, type: 'text', text, createdAt: now, ...(replyToId ? { replyToId } : {}), ...(opts.forwarded ? { forwarded: true } : {}) };
        await this.msgs.insertOne(m, { session });
        await this.receipts.updateOne({ _id: rKey(c._id, me) }, { $max: { deliveredSeq: c.seq, readSeq: c.seq }, $set: { updatedAt: now }, $setOnInsert: { convId: c._id, userId: me } }, { upsert: true, session });
        created = m; conv = c;
      });
    } catch (e) {
      if (isDup(e)) { const first = await this.msgs.findOne({ senderId: me, clientId }); if (first) return this.duplicate(first, convId, me); }
      throw e;
    }
    const m = created as MessageDoc | null, c = conv as ConversationDoc | null;
    if (!m) throw new Error('send finished without a message');
    if (!c) return this.duplicate(m, convId, me);
    const [message] = await this.present([m]);
    this.events.messageCreated(c.members, message);
    this.events.receiptChanged(c.members, message.conversationId, me.toHexString(), { deliveredSeq: m.seq, readSeq: m.seq });
    return { message, duplicate: false };
  }

  private async duplicate(m: MessageDoc, convId: string, me: ObjectId): Promise<SendResult> {
    // The same clientId used for a different chat is a client bug, not a retry.
    if (m.convId.toHexString() !== convId.toLowerCase()) throw AppError.conflict('That message id was already used in another chat.');
    return { message: (await this.present([m]))[0], duplicate: true };
  }

  /** Moves this person's delivered/read point forward, never back, and never past what they can see. */
  async receipt(me: ObjectId, convId: string, kind: 'delivered' | 'read', seq: number): Promise<MemberReceipt> {
    const { c, member, untilSeq } = await this.access(convId, me);
    const upTo = Math.min(seq, c.seq, untilSeq);
    const $max: Record<string, number> = kind === 'read' ? { readSeq: upTo, deliveredSeq: upTo } : { deliveredSeq: upTo };
    const before = await this.receipts.findOneAndUpdate(
      { _id: rKey(c._id, me) },
      { $max, $set: { updatedAt: new Date() }, $setOnInsert: { convId: c._id, userId: me, ...(kind === 'delivered' ? { readSeq: 0 } : {}) } },
      { upsert: true, returnDocument: 'before' },
    );
    const pr = before?.readSeq ?? 0, pd = Math.max(before?.deliveredSeq ?? 0, pr);
    const next = { readSeq: Math.max(pr, kind === 'read' ? upTo : 0), deliveredSeq: Math.max(pd, upTo) };
    if (next.readSeq !== pr || next.deliveredSeq !== pd) {
      const now = new Date();
      const push: Record<string, unknown> = {};
      if (next.readSeq !== pr) push.readMarks = { $each: [{ s: next.readSeq, t: now }], $slice: -300 };
      if (next.deliveredSeq !== pd) push.deliveredMarks = { $each: [{ s: next.deliveredSeq, t: now }], $slice: -300 };
      await this.receipts.updateOne({ _id: rKey(c._id, me) }, { $push: push } as never);
      // A former member's reading only matters to their own devices.
      this.events.receiptChanged(member ? c.members : [me], c._id.toHexString(), me.toHexString(), next);
    }
    return next;
  }

  async pinsOf(c: ConversationDoc): Promise<PinnedMessage[]> {
    if (!c.pins?.length) return [];
    const docs = new Map((await this.msgs.find({ _id: { $in: c.pins.map((p) => p.msgId) } }).toArray()).map((m) => [m._id.toHexString(), m]));
    return [...c.pins].reverse().map((p) => {
      const m = docs.get(p.msgId.toHexString());
      return { messageId: p.msgId.toHexString(), seq: p.seq, senderId: m?.senderId.toHexString() ?? '', text: m && !m.deletedAt ? m.text.slice(0, 200) : '', pinnedBy: p.by.toHexString(), pinnedAt: p.at.toISOString() };
    });
  }

  /** User ids that share at least one chat with me, out of the ones asked about. */
  async sharesChatWith(me: ObjectId, ids: ObjectId[]): Promise<Set<string>> {
    if (!ids.length) return new Set();
    const rows = await this.convs.find({ members: { $all: [me], $in: ids } }, { projection: { members: 1 } }).toArray();
    const wanted = new Set(ids.map((i) => i.toHexString()));
    const out = new Set<string>();
    for (const r of rows) for (const m of r.members) { const h = m.toHexString(); if (wanted.has(h)) out.add(h); }
    return out;
  }
}
export const CHAT = Symbol('CHAT');

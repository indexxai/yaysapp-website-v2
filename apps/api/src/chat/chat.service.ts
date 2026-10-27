import { MongoServerError, ObjectId, type ClientSession, type Collection, type Db, type MongoClient } from 'mongodb';
import type { ChatMessage, ConversationPage, ConversationSummary, MemberReceipt, MessagePage, SendResult } from '@yays/shared';
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
}
export interface MessageDoc {
  _id: ObjectId;
  convId: ObjectId;
  seq: number;
  senderId: ObjectId;
  clientId: string;
  type: 'text';
  text: string;
  createdAt: Date;
}
/** One row per member per conversation: how far they have received and read. */
export interface ReceiptDoc { _id: string; convId: ObjectId; userId: ObjectId; deliveredSeq: number; readSeq: number; updatedAt: Date }

/** What the real-time layer needs to hear about. Kept as an interface so the service has no socket code in it. */
export interface ChatEvents {
  messageCreated(members: ObjectId[], message: ChatMessage): void;
  receiptChanged(members: ObjectId[], conversationId: string, userId: string, r: MemberReceipt): void;
}
const noEvents: ChatEvents = { messageCreated() {}, receiptChanged() {} };

const UNREAD_CAP = 100;
const rKey = (conv: ObjectId, user: ObjectId) => `${conv.toHexString()}:${user.toHexString()}`;
const isDup = (e: unknown) => e instanceof MongoServerError && e.code === 11000;

export function toMessage(m: MessageDoc): ChatMessage {
  return { id: m._id.toHexString(), conversationId: m.convId.toHexString(), seq: m.seq, senderId: m.senderId.toHexString(), clientId: m.clientId, type: m.type, text: m.text, createdAt: m.createdAt.toISOString() };
}

export class ChatService {
  readonly convs: Collection<ConversationDoc>;
  readonly msgs: Collection<MessageDoc>;
  readonly receipts: Collection<ReceiptDoc>;
  private readonly users: Collection<UserDoc>;
  events: ChatEvents = noEvents;

  constructor(private readonly client: MongoClient, db: Db, private readonly storage: Storage) {
    this.convs = db.collection(C.conversations);
    this.msgs = db.collection(C.messages);
    this.receipts = db.collection(C.receipts);
    this.users = db.collection(C.users);
  }

  /** The conversation, only if this user is in it. Anything else is "not found", so ids can't be probed. */
  parseId(convId: string | ObjectId) {
    if (typeof convId !== 'string') return convId;
    if (!/^[a-f0-9]{24}$/i.test(convId)) throw AppError.notFound('Chat not found.');
    return new ObjectId(convId);
  }

  async memberConv(convId: string | ObjectId, userId: ObjectId, session?: ClientSession) {
    const c = await this.convs.findOne({ _id: this.parseId(convId), members: userId }, { session });
    if (!c) throw AppError.notFound('Chat not found.');
    return c;
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
    const filter: Record<string, unknown> = { members: me, seq: { $gt: 0 } };
    if (before) {
      const m = /^(\d{1,15})_([a-f0-9]{24})$/.exec(before);
      if (!m) throw AppError.validation('That page link is not valid.');
      const at = new Date(Number(m[1])), id = new ObjectId(m[2]);
      filter.$or = [{ lastAt: { $lt: at } }, { lastAt: at, _id: { $lt: id } }];
    }
    const rows = await this.convs.find(filter).sort({ lastAt: -1, _id: -1 }).limit(limit + 1).toArray();
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    return { items: await this.summaries(me, page), next: rows.length > limit && last ? `${last.lastAt.getTime()}_${last._id.toHexString()}` : null };
  }

  async one(me: ObjectId, convId: string): Promise<ConversationSummary> {
    return (await this.summaries(me, [await this.memberConv(convId, me)]))[0];
  }

  /** Builds what the chat list shows: the other person, last message, unread count and everyone's ticks. */
  async summaries(me: ObjectId, convs: ConversationDoc[]): Promise<ConversationSummary[]> {
    if (!convs.length) return [];
    const ids = convs.map((c) => c._id);
    const peerIds = convs.filter((c) => c.kind === 'direct').map((c) => c.members.find((m) => !m.equals(me))).filter((x): x is ObjectId => !!x);
    const lastIds = convs.map((c) => c.lastMessageId).filter((x): x is ObjectId => !!x);
    const [peers, lasts, recs] = await Promise.all([
      peerIds.length ? this.users.find({ _id: { $in: peerIds } }).toArray() : Promise.resolve([] as UserDoc[]),
      lastIds.length ? this.msgs.find({ _id: { $in: lastIds } }).toArray() : Promise.resolve([] as MessageDoc[]),
      this.receipts.find({ convId: { $in: ids } }).toArray(),
    ]);
    const photo = (k: string) => this.storage.downloadUrl(k);
    const peerById = new Map(await Promise.all(peers.map(async (u) => [u._id.toHexString(), await toPublic(u, photo)] as const)));
    const lastById = new Map(lasts.map((m) => [m._id.toHexString(), m]));
    return Promise.all(convs.map(async (c) => {
      const receipts: Record<string, MemberReceipt> = {};
      for (const m of c.members) receipts[m.toHexString()] = { deliveredSeq: 0, readSeq: 0 };
      for (const r of recs) if (r.convId.equals(c._id) && receipts[r.userId.toHexString()]) receipts[r.userId.toHexString()] = { deliveredSeq: Math.max(r.deliveredSeq, r.readSeq), readSeq: r.readSeq };
      const myRead = receipts[me.toHexString()]?.readSeq ?? 0;
      const unread = c.seq > myRead ? await this.msgs.countDocuments({ convId: c._id, seq: { $gt: myRead }, senderId: { $ne: me } }, { limit: UNREAD_CAP }) : 0;
      const peerId = c.kind === 'direct' ? c.members.find((m) => !m.equals(me)) : undefined;
      const last = c.lastMessageId ? lastById.get(c.lastMessageId.toHexString()) : undefined;
      return {
        id: c._id.toHexString(), kind: c.kind,
        peer: peerId ? peerById.get(peerId.toHexString()) ?? { id: peerId.toHexString(), displayName: 'Deleted account', username: null, about: '', photoUrl: null } : null,
        memberIds: c.members.map((m) => m.toHexString()), lastSeq: c.seq, lastMessage: last ? toMessage(last) : null, unread, receipts,
        lastActivityAt: c.lastAt.toISOString(),
      };
    }));
  }

  async messages(me: ObjectId, convId: string, q: { before?: number; after?: number; limit: number }): Promise<MessagePage> {
    const c = await this.memberConv(convId, me);
    if (q.after !== undefined) {
      // Catching up after being offline: oldest first from the point the device already has.
      const rows = await this.msgs.find({ convId: c._id, seq: { $gt: q.after } }).sort({ seq: 1 }).limit(q.limit + 1).toArray();
      return { items: rows.slice(0, q.limit).map(toMessage), hasMore: rows.length > q.limit };
    }
    const filter = q.before !== undefined ? { convId: c._id, seq: { $lt: q.before } } : { convId: c._id };
    const rows = await this.msgs.find(filter).sort({ seq: -1 }).limit(q.limit + 1).toArray();
    return { items: rows.slice(0, q.limit).reverse().map(toMessage), hasMore: rows.length > q.limit };
  }

  /**
   * Stores a message exactly once. The number, the message and the sender's own receipt are written in one
   * transaction, so a retry with the same clientId returns the first copy and the numbers have no gaps.
   */
  async send(me: ObjectId, convId: string, clientId: string, text: string): Promise<SendResult> {
    const existing = await this.msgs.findOne({ senderId: me, clientId });
    if (existing) return this.duplicate(existing, convId);
    const session = this.client.startSession();
    let created: MessageDoc | null = null;
    let conv: ConversationDoc | null = null;
    try {
      await session.withTransaction(async () => {
        created = null;
        const again = await this.msgs.findOne({ senderId: me, clientId }, { session });
        if (again) { created = again; conv = null; return; }
        const now = new Date();
        const id = new ObjectId();
        const c = await this.convs.findOneAndUpdate(
          { _id: this.parseId(convId), members: me },
          { $inc: { seq: 1 }, $set: { lastAt: now, lastMessageId: id } },
          { session, returnDocument: 'after' },
        );
        if (!c) throw AppError.notFound('Chat not found.');
        const m: MessageDoc = { _id: id, convId: c._id, seq: c.seq, senderId: me, clientId, type: 'text', text, createdAt: now };
        await this.msgs.insertOne(m, { session });
        await this.receipts.updateOne(
          { _id: rKey(c._id, me) },
          { $max: { deliveredSeq: c.seq, readSeq: c.seq }, $set: { updatedAt: now }, $setOnInsert: { convId: c._id, userId: me } },
          { upsert: true, session },
        );
        created = m; conv = c;
      }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } });
    } catch (e) {
      if (isDup(e)) { const first = await this.msgs.findOne({ senderId: me, clientId }); if (first) return this.duplicate(first, convId); }
      throw e;
    } finally {
      await session.endSession();
    }
    const m = created as MessageDoc | null, c = conv as ConversationDoc | null;
    if (!m) throw new Error('send finished without a message');
    if (!c) return this.duplicate(m, convId);
    const message = toMessage(m);
    this.events.messageCreated(c.members, message);
    this.events.receiptChanged(c.members, message.conversationId, me.toHexString(), { deliveredSeq: m.seq, readSeq: m.seq });
    return { message, duplicate: false };
  }

  private duplicate(m: MessageDoc, convId: string): SendResult {
    // The same clientId used for a different chat is a client bug, not a retry.
    if (m.convId.toHexString() !== convId.toLowerCase()) throw AppError.conflict('That message id was already used in another chat.');
    return { message: toMessage(m), duplicate: true };
  }

  /** Moves this member's delivered/read point forward, never back, and never past the last message. */
  async receipt(me: ObjectId, convId: string, kind: 'delivered' | 'read', seq: number): Promise<MemberReceipt> {
    const c = await this.memberConv(convId, me);
    const upTo = Math.min(seq, c.seq);
    const $max: Record<string, number> = kind === 'read' ? { readSeq: upTo, deliveredSeq: upTo } : { deliveredSeq: upTo };
    const before = await this.receipts.findOneAndUpdate(
      { _id: rKey(c._id, me) },
      { $max, $set: { updatedAt: new Date() }, $setOnInsert: { convId: c._id, userId: me, ...(kind === 'delivered' ? { readSeq: 0 } : {}) } },
      { upsert: true, returnDocument: 'before' },
    );
    const pr = before?.readSeq ?? 0, pd = Math.max(before?.deliveredSeq ?? 0, pr);
    const next = { readSeq: Math.max(pr, kind === 'read' ? upTo : 0), deliveredSeq: Math.max(pd, upTo) };
    if (next.readSeq !== pr || next.deliveredSeq !== pd) {
      this.events.receiptChanged(c.members, c._id.toHexString(), me.toHexString(), next);
    }
    return next;
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

  displayName(u: UserDoc) { return displayNameOf(u); }
}
export const CHAT = Symbol('CHAT');

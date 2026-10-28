import { MongoServerError, ObjectId, type ClientSession, type Collection, type Db, type MongoClient } from 'mongodb';
import {
  DEFAULT_GROUP_SETTINGS, MAX_VOICE_MS, messagePreview, MEDIA_LIMITS, MEDIA_TYPES, baseMime, formatBytes,
  type Attachment, type AttachmentInput, type AttachmentKind,
  type ChatMessage, type PollView, type ConversationPage, type ConversationSummary, type GroupMeta, type GroupSettings, type MemberReceipt, type MessagePage, type PinnedMessage, type PublicProfile, type ReplyPreview, type SendResult, type SystemEvent,
} from '@yays/shared';
import { AppError } from '../common/app-error';
import { C } from '../infra/mongo';
import { KEY_RE, type Storage } from '../infra/storage';
import { displayNameOf, privacyOf, toPublic, type UserDoc } from '../users/users.repo';

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
  type: 'text' | 'system' | 'media' | 'poll';
  /** The text, a caption, or a poll's question. */
  text: string;
  system?: SystemEvent;
  /** @mentioned members. */
  mentions?: ObjectId[];
  poll?: { question: string; options: Array<{ id: string; text: string }>; multi: boolean; anonymous: boolean };
  /** One entry per voter: the options they picked. */
  votes?: Array<{ u: ObjectId; o: string[]; at: Date }>;
  attachment?: StoredAttachment;
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
  /** Sent to someone who blocked the sender: never delivered to them (also in hiddenFor). */
  heldFrom?: ObjectId;
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
  /** `by` blocked `target`: they stop seeing each other online. */
  blocked(by: ObjectId, target: ObjectId): void;
}
const noEvents: ChatEvents = { messageCreated() {}, receiptChanged() {}, conversationChanged() {}, blocked() {} };

const UNREAD_CAP = 100;
const MAX_SEQ = Number.MAX_SAFE_INTEGER;
/** Whether a privacy setting lets someone see something. */
export const sees = (a: 'everyone' | 'contacts' | 'nobody', isContact: boolean) => a === 'everyone' || (a === 'contacts' && isContact);
export const rKey = (conv: ObjectId, user: ObjectId) => `${conv.toHexString()}:${user.toHexString()}`;
export const isDup = (e: unknown) => e instanceof MongoServerError && e.code === 11000;
export const has = (list: ObjectId[] | undefined, id: ObjectId) => !!list?.some((x) => x.equals(id));
const DELETED: PublicProfile = { id: '', displayName: 'Deleted account', username: null, about: '', photoUrl: null };

export interface MessageEvents {
  messageUpdated(userIds: ObjectId[], message: ChatMessage): void;
  mine(userId: ObjectId, p: { conversationId: string; messageId: string; hidden?: boolean; starred?: boolean; votes?: string[] }): void;
}

/** Stored on the message. Links are made fresh when it is read. */
export interface StoredAttachment { kind: AttachmentKind; key: string; thumbKey?: string; name: string; size: number; mime: string; width?: number; height?: number; durationMs?: number; waveform?: number[] }
/** Download links for a set of messages: key → url. */
export type Urls = Map<string, string>;

export const replyPreview = (t: MessageDoc, urls?: Urls): ReplyPreview => ({
  id: t._id.toHexString(), seq: t.seq, senderId: t.senderId.toHexString(), type: t.type, deleted: !!t.deletedAt,
  text: t.deletedAt ? '' : t.text.length > 200 ? `${t.text.slice(0, 200)}…` : t.text,
  ...(t.attachment && !t.deletedAt ? { attachment: { kind: t.attachment.kind, name: t.attachment.name, thumbUrl: t.attachment.thumbKey ? urls?.get(t.attachment.thumbKey) ?? null : null, ...(t.attachment.durationMs !== undefined ? { durationMs: t.attachment.durationMs } : {}) } } : {}),
});

function toAttachment(a: StoredAttachment, urls?: Urls): Attachment {
  return {
    kind: a.kind, url: urls?.get(a.key) ?? '', thumbUrl: a.thumbKey ? urls?.get(a.thumbKey) ?? null : null, name: a.name, size: a.size, mime: a.mime,
    ...(a.width ? { width: a.width, height: a.height } : {}), ...(a.durationMs !== undefined ? { durationMs: a.durationMs } : {}), ...(a.waveform ? { waveform: a.waveform } : {}),
  };
}

/** Counts per option; who voted unless the poll hides it; my picks when it's me asking. */
export function pollView(m: MessageDoc, viewer?: ObjectId): PollView {
  const p = m.poll!;
  const votes = m.votes ?? [];
  const mine = viewer ? votes.find((v) => v.u.equals(viewer))?.o : undefined;
  return {
    question: p.question, multi: p.multi, anonymous: p.anonymous, voterCount: votes.length,
    options: p.options.map((o) => {
      const who = votes.filter((v) => v.o.includes(o.id)).sort((a, b) => a.at.getTime() - b.at.getTime());
      return { id: o.id, text: o.text, votes: who.length, ...(p.anonymous ? {} : { voters: who.map((v) => v.u.toHexString()) }) };
    }),
    ...(viewer ? { myVotes: mine ?? [] } : {}),
  };
}

/** A message as apps see it. Deleted messages lose their text, reactions and quote. */
export function toMessage(m: MessageDoc, replies?: Map<string, MessageDoc>, viewer?: { id: ObjectId; starred: Set<string> }, urls?: Urls): ChatMessage {
  const out: ChatMessage = {
    id: m._id.toHexString(), conversationId: m.convId.toHexString(), seq: m.seq, senderId: m.senderId.toHexString(), clientId: m.clientId,
    type: m.type, text: m.deletedAt ? '' : m.text, ...(m.system ? { system: m.system } : {}), createdAt: m.createdAt.toISOString(),
  };
  if (m.forwarded) out.forwarded = true;
  if (m.editedAt && !m.deletedAt) out.editedAt = m.editedAt.toISOString();
  const hiddenForViewer = viewer && has(m.hiddenFor, viewer.id);
  if (m.deletedAt || hiddenForViewer) { out.deleted = true; out.text = ''; return out; }
  if (m.attachment) out.attachment = toAttachment(m.attachment, urls);
  if (m.replyToId) { const t = replies?.get(m.replyToId.toHexString()); out.replyTo = t ? replyPreview(t, urls) : null; }
  if (m.reactions?.length) {
    const r: Record<string, string[]> = {};
    for (const x of [...m.reactions].sort((a, b) => a.at.getTime() - b.at.getTime())) (r[x.e] ??= []).push(x.u.toHexString());
    out.reactions = r;
  }
  if (viewer) out.starred = viewer.starred.has(m._id.toHexString());
  if (m.heldFrom && viewer?.id.equals(m.senderId)) out.held = true;
  if (m.mentions?.length) out.mentions = m.mentions.map((u) => u.toHexString());
  if (m.poll) out.poll = pollView(m, viewer?.id);
  return out;
}

/** Per person per chat: muted, archived, pinned to the top. */
export interface ChatPrefDoc {
  _id: string; convId: ObjectId; userId: ObjectId; mutedUntil?: Date | null; archived?: boolean; pinnedAt?: Date | null; markedUnread?: boolean; updatedAt: Date;
  /** "Delete chat": hidden from my list until a message newer than this arrives. */
  deletedSeq?: number;
}
/** `by` blocked `target`. _id is `by:target`. */
export interface BlockDoc { _id: string; by: ObjectId; target: ObjectId; at: Date }

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
  /** Called when someone's read point moves (to clear notifications on their other devices). */
  onRead: (userId: ObjectId, conversationId: string) => void = () => undefined;
  readonly stars: Collection<StarDoc>;
  readonly prefs: Collection<ChatPrefDoc>;
  readonly blocks: Collection<BlockDoc>;

  constructor(readonly client: MongoClient, readonly db: Db, readonly storage: Storage) {
    this.blocks = db.collection(C.blocks);
    this.stars = db.collection(C.stars);
    this.prefs = db.collection(C.chatPrefs);
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

  /** Of these people, the ones where either side blocked the other. */
  async blockedEitherWay(me: ObjectId, ids: ObjectId[]): Promise<Set<string>> {
    if (!ids.length) return new Set();
    const rows = await this.blocks.find({ $or: [{ by: me, target: { $in: ids } }, { target: me, by: { $in: ids } }] }).toArray();
    return new Set(rows.map((b) => (b.by.equals(me) ? b.target : b.by).toHexString()));
  }
  /** Of these people, the ones I have a direct chat with that has messages ("my contacts" in privacy settings). */
  async contactsOf(me: ObjectId, ids: ObjectId[]): Promise<Set<string>> {
    if (!ids.length) return new Set();
    const keys = ids.filter((i) => !i.equals(me)).map((i) => [me.toHexString(), i.toHexString()].sort().join(':'));
    const rows = await this.convs.find({ directKey: { $in: keys }, seq: { $gt: 0 } }, { projection: { members: 1 } }).toArray();
    return new Set(rows.flatMap((c) => c.members.filter((m) => !m.equals(me)).map((m) => m.toHexString())));
  }
  /** Profiles as `viewer` may see them: photo and about follow each person's privacy settings. */
  async profilesFor(viewer: ObjectId, docs: UserDoc[]): Promise<Map<string, PublicProfile>> {
    const contacts = await this.contactsOf(viewer, docs.map((d) => d._id));
    const out = new Map<string, PublicProfile>();
    for (const d of docs) {
      const p = await toPublic(d, this.photo);
      if (!d._id.equals(viewer)) {
        const pv = privacyOf(d), c = contacts.has(d._id.toHexString());
        if (!sees(pv.photo, c)) p.photoUrl = null;
        if (!sees(pv.about, c)) p.about = '';
      }
      out.set(p.id, p);
    }
    return out;
  }
  async profileFor(viewer: ObjectId, doc: UserDoc) { return (await this.profilesFor(viewer, [doc])).get(doc._id.toHexString())!; }
  /** In a direct chat, read receipts show only when both people have them on. */
  async receiptsShared(a: ObjectId, b: ObjectId) {
    const docs = await this.users.find({ _id: { $in: [a, b] } }, { projection: { 'yc.privacy': 1 } }).toArray();
    return docs.every((d) => privacyOf(d).readReceipts);
  }

  async blockState(me: ObjectId, other: ObjectId) {
    const rows = await this.blocks.find({ _id: { $in: [`${me.toHexString()}:${other.toHexString()}`, `${other.toHexString()}:${me.toHexString()}`] } }).toArray();
    return { iBlocked: rows.some((b) => b.by.equals(me)), theyBlocked: rows.some((b) => b.target.equals(me)) };
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

  async list(me: ObjectId, before: string | undefined, limit: number, archivedOnly = false): Promise<ConversationPage> {
    const archivedIds = (await this.prefs.find({ userId: me, archived: true }, { projection: { convId: 1 } }).limit(5000).toArray()).map((p) => p.convId);
    // Chats I deleted stay out of the list until something new is said in them.
    const deleted = await this.prefs.find({ userId: me, deletedSeq: { $exists: true } }, { projection: { convId: 1, deletedSeq: 1 } }).limit(5000).toArray();
    let hiddenIds: ObjectId[] = [];
    if (deleted.length) {
      const seqs = new Map((await this.convs.find({ _id: { $in: deleted.map((d) => d.convId) } }, { projection: { seq: 1 } }).toArray()).map((c) => [c._id.toHexString(), c.seq]));
      hiddenIds = deleted.filter((d) => (seqs.get(d.convId.toHexString()) ?? 0) <= (d.deletedSeq ?? 0)).map((d) => d.convId);
    }
    const filter: Record<string, unknown> = { $or: [{ members: me }, { former: me }], seq: { $gt: 0 }, _id: archivedOnly ? { $in: archivedIds, $nin: hiddenIds } : { $nin: [...archivedIds, ...hiddenIds] } };
    if (before) {
      const m = /^(\d{1,15})_([a-f0-9]{24})$/.exec(before);
      if (!m) throw AppError.validation('That page link is not valid.');
      const at = new Date(Number(m[1])), id = new ObjectId(m[2]);
      filter.$and = [{ $or: [{ lastAt: { $lt: at } }, { lastAt: at, _id: { $lt: id } }] }];
    }
    const rows = await this.convs.find(filter).sort({ lastAt: -1, _id: -1 }).limit(limit + 1).toArray();
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    const out: ConversationPage = { items: [], next: rows.length > limit && last ? `${last.lastAt.getTime()}_${last._id.toHexString()}` : null };
    if (!before && !archivedOnly) {
      // Pinned chats come with the first page wherever they'd fall by date.
      const pinned = (await this.prefs.find({ userId: me, pinnedAt: { $ne: null } }).toArray()).map((p) => p.convId).filter((id) => !page.some((c) => c._id.equals(id)));
      if (pinned.length) page.push(...await this.convs.find({ _id: { $in: pinned }, $or: [{ members: me }, { former: me }], seq: { $gt: 0 } }).toArray());
      out.archived = { count: 0, unread: 0 };
      if (archivedIds.length) {
        const arch = await this.convs.find({ _id: { $in: archivedIds }, $or: [{ members: me }, { former: me }], seq: { $gt: 0 } }).limit(500).toArray();
        out.archived = { count: arch.length, unread: (await this.summaries(me, arch)).filter((c) => c.unread > 0 || c.markedUnread).length };
      }
    }
    out.items = await this.summaries(me, page);
    return out;
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
    const lastMsgs = await Promise.all(convs.map(async (c) => {
      const m = has(c.members, me) || !c.seq ? (c.lastMessageId ? await this.msgs.findOne({ _id: c.lastMessageId }) : null) : await this.msgs.findOne({ convId: c._id, seq: visibleLast(c) });
      // A message I can't see (deleted for me, or from someone I blocked): show the one before it.
      if (m && has(m.hiddenFor, me)) return this.msgs.findOne({ convId: c._id, seq: { $lte: m.seq }, hiddenFor: { $ne: me } }, { sort: { seq: -1 } });
      return m;
    }));
    const peerIds = convs.filter((c) => c.kind === 'direct').map((c) => c.members.find((m) => !m.equals(me))).filter((x): x is ObjectId => !!x);
    const senderIds = lastMsgs.map((m) => m?.senderId).filter((x): x is ObjectId => !!x);
    const people = await this.users.find({ _id: { $in: [...peerIds, ...senderIds] } }).toArray();
    const byId = new Map(people.map((u) => [u._id.toHexString(), u]));
    const recs = await this.receipts.find({ convId: { $in: ids } }).toArray();
    const prefs = new Map((await this.prefs.find({ _id: { $in: ids.map((i) => rKey(i, me)) } }).toArray()).map((p) => [p.convId.toHexString(), p]));
    const blocks = await this.blocks.find({ $or: [{ by: me, target: { $in: peerIds } }, { target: me, by: { $in: peerIds } }] }).toArray();
    const profiles = await this.profilesFor(me, people.filter((u) => peerIds.some((p) => p.equals(u._id))));
    const meDoc = await this.users.findOne({ _id: me }, { projection: { 'yc.privacy': 1 } });
    const myReceipts = meDoc ? privacyOf(meDoc).readReceipts : true;
    return Promise.all(convs.map(async (c, i) => {
      const pref = prefs.get(c._id.toHexString());
      const member = has(c.members, me);
      const receipts: Record<string, MemberReceipt> = {};
      for (const m of c.members) receipts[m.toHexString()] = { deliveredSeq: 0, readSeq: 0 };
      for (const r of recs) if (r.convId.equals(c._id) && receipts[r.userId.toHexString()]) receipts[r.userId.toHexString()] = { deliveredSeq: Math.max(r.deliveredSeq, r.readSeq), readSeq: r.readSeq };
      const my = mine.get(c._id.toHexString());
      if (!member) receipts[me.toHexString()] = { deliveredSeq: my?.deliveredSeq ?? 0, readSeq: my?.readSeq ?? 0 };
      const lastSeq = visibleLast(c);
      const readFrom = Math.max(my?.readSeq ?? 0, my?.fromSeq ?? 0);
      const unread = lastSeq > readFrom ? await this.msgs.countDocuments({ convId: c._id, seq: { $gt: readFrom, $lte: lastSeq }, senderId: { $ne: me }, hiddenFor: { $ne: me } }, { limit: UNREAD_CAP }) : 0;
      const mentioned = unread > 0 && c.kind === 'group' && !!(await this.msgs.findOne({ convId: c._id, seq: { $gt: readFrom, $lte: lastSeq }, mentions: me, deletedAt: { $exists: false } }, { projection: { _id: 1 } }));
      const last = lastMsgs[i];
      const peerId = c.kind === 'direct' ? c.members.find((m) => !m.equals(me)) : undefined;
      const peerDoc = peerId ? byId.get(peerId.toHexString()) : undefined;
      const sender = last ? byId.get(last.senderId.toHexString()) : undefined;
      const iBlocked = !!peerId && blocks.some((b) => b.by.equals(me) && b.target.equals(peerId));
      const theyBlocked = !!peerId && blocks.some((b) => b.target.equals(me) && b.by.equals(peerId));
      let peer: PublicProfile | null = peerId ? (peerDoc ? profiles.get(peerId.toHexString()) ?? await toPublic(peerDoc, this.photo) : { ...DELETED, id: peerId.toHexString() }) : null;
      // Read receipts off on either side: the other person's reading shows as delivered.
      if (peerId && peerDoc && (!myReceipts || !privacyOf(peerDoc).readReceipts)) {
        const r = receipts[peerId.toHexString()];
        if (r) receipts[peerId.toHexString()] = { deliveredSeq: Math.max(r.deliveredSeq, r.readSeq), readSeq: 0 };
      }
      // Someone who blocked me doesn't share their photo or about with me.
      if (peer && theyBlocked) peer = { ...peer, photoUrl: null, about: '' };
      const fromSeq = my?.fromSeq ?? 0;
      return {
        id: c._id.toHexString(), kind: c.kind,
        peer,
        group: c.kind === 'group' ? await this.groupMeta(c, me) : null,
        canSend: member && this.may(c, me, 'send') && !iBlocked,
        memberIds: c.members.map((m) => m.toHexString()), lastSeq, lastMessage: last && last.seq > (my?.fromSeq ?? 0) ? toMessage(last, undefined, { id: me, starred: new Set() }, await this.urlsFor([last])) : null, unread, receipts,
        lastSenderName: last ? (last.senderId.equals(me) ? 'You' : sender ? displayNameOf(sender) : DELETED.displayName) : null,
        pins: (await this.pinsOf(c)).filter((p) => p.seq > fromSeq && p.seq <= lastSeq),
        mutedUntil: pref?.mutedUntil && pref.mutedUntil.getTime() > Date.now() ? pref.mutedUntil.toISOString() : null,
        archived: !!pref?.archived, pinnedAt: pref?.pinnedAt ? pref.pinnedAt.toISOString() : null,
        markedUnread: !!pref?.markedUnread, blocked: iBlocked, visibleFrom: fromSeq, ...(mentioned ? { mentioned: true } : {}),
        ...(pref?.deletedSeq !== undefined && pref.deletedSeq >= c.seq ? { hidden: true } : {}),
        lastActivityAt: (member && !(last && c.lastMessageId && !last._id.equals(c.lastMessageId)) ? c.lastAt : last?.createdAt ?? c.lastAt).toISOString(),
      };
    }));
  }

  /** Turns stored messages into what one person sees: quotes resolved, their stars, their deletions. */
  async present(rows: MessageDoc[], viewer?: ObjectId): Promise<ChatMessage[]> {
    const replyIds = [...new Set(rows.map((m) => m.replyToId?.toHexString()).filter((x): x is string => !!x))];
    const replies = new Map(replyIds.length ? (await this.msgs.find({ _id: { $in: replyIds.map((x) => new ObjectId(x)) } }).toArray()).map((t) => [t._id.toHexString(), t]) : []);
    const starred = new Set(viewer && rows.length ? (await this.stars.find({ userId: viewer, msgId: { $in: rows.map((m) => m._id) } }, { projection: { msgId: 1 } }).toArray()).map((x) => x.msgId.toHexString()) : []);
    const urls = await this.urlsFor([...rows, ...replies.values()]);
    return rows.map((m) => toMessage(m, replies, viewer ? { id: viewer, starred } : undefined, urls));
  }

  /** Signed links for every attachment (and preview) in these messages. Files download under their own name. */
  async urlsFor(rows: MessageDoc[]): Promise<Urls> {
    const urls: Urls = new Map();
    await Promise.all(rows.filter((m) => m.attachment && !m.deletedAt).flatMap((m) => {
      const a = m.attachment!;
      const jobs = [this.storage.downloadUrl(a.key, a.kind === 'file' ? { filename: a.name } : {}).then((u) => { urls.set(a.key, u); })];
      if (a.thumbKey) jobs.push(this.storage.downloadUrl(a.thumbKey).then((u) => { urls.set(a.thumbKey!, u); }));
      return jobs;
    }));
    return urls;
  }

  /** Checks an uploaded file before it goes on a message: mine, really there, the right type and size. */
  async checkAttachment(me: ObjectId, a: AttachmentInput): Promise<StoredAttachment> {
    const mine = `media/${me.toHexString()}/`;
    if (!KEY_RE.test(a.key) || !a.key.startsWith(mine)) throw AppError.forbidden('That file was not uploaded by you.');
    const obj = await this.storage.head(a.key);
    if (!obj) throw AppError.validation('The upload did not finish. Try again.');
    const mime = baseMime(obj.contentType);
    if (obj.size > MEDIA_LIMITS[a.kind]) throw AppError.validation(`That file is ${formatBytes(obj.size)}. The limit is ${formatBytes(MEDIA_LIMITS[a.kind])}.`);
    if (a.kind !== 'file' && !MEDIA_TYPES[a.kind].includes(mime)) throw AppError.validation('That file type doesn’t match what was sent.');
    if (a.kind === 'voice' && (a.durationMs ?? 0) > MAX_VOICE_MS) throw AppError.validation('Voice messages can be up to 15 minutes.');
    let thumbKey: string | undefined;
    if (a.thumbKey) {
      if (!KEY_RE.test(a.thumbKey) || !a.thumbKey.startsWith(`thumbs/${me.toHexString()}/`)) throw AppError.forbidden('That preview was not uploaded by you.');
      const t = await this.storage.head(a.thumbKey);
      if (!t || t.size > MEDIA_LIMITS.thumb || !t.contentType.startsWith('image/')) throw AppError.validation('The preview image is not valid.');
      thumbKey = a.thumbKey;
    }
    const name = (a.name ?? '').replace(/[\u0000-\u001f\\/]/g, '_').trim().slice(0, 200) || (a.kind === 'voice' ? 'Voice message' : a.kind === 'image' ? 'Photo' : a.kind === 'video' ? 'Video' : 'File');
    return {
      kind: a.kind, key: a.key, name, size: obj.size, mime, ...(thumbKey ? { thumbKey } : {}),
      ...(a.width && a.height && (a.kind === 'image' || a.kind === 'video') ? { width: a.width, height: a.height } : {}),
      ...(a.durationMs !== undefined && (a.kind === 'video' || a.kind === 'voice') ? { durationMs: a.durationMs } : {}),
      ...(a.waveform && a.kind === 'voice' ? { waveform: a.waveform } : {}),
    };
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
  async send(me: ObjectId, convId: string, clientId: string, text: string, opts: { replyToId?: string; forwarded?: boolean; attachment?: AttachmentInput; trustedAttachment?: StoredAttachment; mentions?: string[]; poll?: { options: string[]; multi: boolean; anonymous: boolean } } = {}): Promise<SendResult> {
    const existing = await this.msgs.findOne({ senderId: me, clientId });
    if (existing) return this.duplicate(existing, convId, me);
    const pre = await this.memberConv(convId, me);
    if (!this.may(pre, me, 'send')) throw AppError.forbidden('Only admins can send messages in this group.');
    // Direct chats and blocking: I can't write to someone I blocked; if they blocked me, my message is
    // kept (one tick, as usual) but never reaches them, and they aren't told.
    let hiddenFrom: ObjectId | undefined;
    if (pre.kind === 'direct') {
      const peer = pre.members.find((m) => !m.equals(me));
      if (peer) {
        const b = await this.blockState(me, peer);
        if (b.iBlocked) throw AppError.forbidden('You blocked this person. Unblock them to send a message.');
        if (b.theyBlocked) hiddenFrom = peer;
        const p = await this.users.findOne({ _id: peer }, { projection: { 'yc.deletedAt': 1, 'yc.disabledAt': 1 } });
        if (!p || p.yc?.deletedAt || p.yc?.disabledAt) throw AppError.forbidden('This account no longer exists.');
      }
    }
    // Forwarding reuses the original file as it is; anything else is checked.
    const attachment = opts.trustedAttachment ?? (opts.attachment ? await this.checkAttachment(me, opts.attachment) : undefined);
    let replyToId: ObjectId | undefined;
    if (opts.replyToId) {
      const t = await this.msgs.findOne({ _id: new ObjectId(opts.replyToId), convId: pre._id });
      const from = (await this.receipts.findOne({ _id: rKey(pre._id, me) }))?.fromSeq ?? 0;
      if (!t || t.seq <= from || has(t.hiddenFor, me)) throw AppError.validation('The message you’re replying to isn’t in this chat.');
      if (t.type === 'system') throw AppError.validation('You can’t reply to that.');
      if (t.deletedAt) throw AppError.validation('You can’t reply to a deleted message.');
      replyToId = t._id;
    }
    const mentions = this.cleanMentions(pre, me, text, opts.mentions);
    const poll = opts.poll ? { question: text, options: opts.poll.options.map((t, i) => ({ id: (i + 1).toString(36), text: t })), multi: opts.poll.multi, anonymous: opts.poll.anonymous } : undefined;
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
        const m: MessageDoc = { _id: id, convId: c._id, seq: c.seq, senderId: me, clientId, type: poll ? 'poll' : attachment ? 'media' : 'text', text, createdAt: now, ...(attachment ? { attachment } : {}), ...(mentions.length ? { mentions } : {}), ...(poll ? { poll, votes: [] } : {}), ...(replyToId ? { replyToId } : {}), ...(opts.forwarded ? { forwarded: true } : {}), ...(hiddenFrom ? { hiddenFor: [hiddenFrom], heldFrom: hiddenFrom } : {}) };
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
    if (hiddenFrom) message.held = true; // only the sender's own devices get this message
    const to = hiddenFrom ? c.members.filter((x) => !x.equals(hiddenFrom!)) : c.members;
    this.events.messageCreated(to, message);
    this.events.receiptChanged(to, message.conversationId, me.toHexString(), { deliveredSeq: m.seq, readSeq: m.seq });
    return { message, duplicate: false };
  }

  /** Mentions only count in groups, for people in the group now, named in the text. */
  cleanMentions(c: ConversationDoc, me: ObjectId, text: string, ids?: string[]): ObjectId[] {
    if (!ids?.length || c.kind !== 'group' || !text.includes('@')) return [];
    const out: ObjectId[] = [];
    for (const id of new Set(ids.map((x) => x.toLowerCase()))) {
      const u = c.members.find((m) => m.toHexString() === id);
      if (u && !u.equals(me)) out.push(u);
    }
    return out;
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
    // Opening a chat I marked unread clears the mark.
    if (kind === 'read' && (await this.prefs.updateOne({ _id: rKey(c._id, me), markedUnread: true }, { $unset: { markedUnread: '' }, $set: { updatedAt: new Date() } })).modifiedCount) {
      this.events.conversationChanged([me], c._id.toHexString());
    }
    const next = { readSeq: Math.max(pr, kind === 'read' ? upTo : 0), deliveredSeq: Math.max(pd, upTo) };
    if (next.readSeq !== pr || next.deliveredSeq !== pd) {
      const now = new Date();
      const push: Record<string, unknown> = {};
      if (next.readSeq !== pr) push.readMarks = { $each: [{ s: next.readSeq, t: now }], $slice: -300 };
      if (next.deliveredSeq !== pd) push.deliveredMarks = { $each: [{ s: next.deliveredSeq, t: now }], $slice: -300 };
      await this.receipts.updateOne({ _id: rKey(c._id, me) }, { $push: push } as never);
      if (next.readSeq !== pr) this.onRead(me, c._id.toHexString());
      // A former member's reading only matters to their own devices.
      const peer = c.kind === 'direct' ? c.members.find((m) => !m.equals(me)) : undefined;
      if (member && peer && !(await this.receiptsShared(me, peer))) {
        this.events.receiptChanged([me], c._id.toHexString(), me.toHexString(), next);
        this.events.receiptChanged([peer], c._id.toHexString(), me.toHexString(), { deliveredSeq: Math.max(next.deliveredSeq, next.readSeq), readSeq: 0 });
      } else this.events.receiptChanged(member ? c.members : [me], c._id.toHexString(), me.toHexString(), next);
    }
    return next;
  }

  async pinsOf(c: ConversationDoc): Promise<PinnedMessage[]> {
    if (!c.pins?.length) return [];
    const docs = new Map((await this.msgs.find({ _id: { $in: c.pins.map((p) => p.msgId) } }).toArray()).map((m) => [m._id.toHexString(), m]));
    return [...c.pins].reverse().map((p) => {
      const m = docs.get(p.msgId.toHexString());
      return { messageId: p.msgId.toHexString(), seq: p.seq, senderId: m?.senderId.toHexString() ?? '', text: m && !m.deletedAt ? messagePreview({ text: m.text, attachment: m.attachment }).slice(0, 200) : '', pinnedBy: p.by.toHexString(), pinnedAt: p.at.toISOString() };
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

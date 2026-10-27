import { ObjectId } from 'mongodb';
import type { ChatMessage, PublicProfile, SearchChat, SearchMessage, SearchResults } from '@yays/shared';
import { AppError } from '../common/app-error';
import { USERNAME_RE } from '@yays/shared';
import { displayNameOf, toPublic, type UserDoc } from '../users/users.repo';
import { has, rKey, type ChatService, type ConversationDoc, type MessageDoc } from './chat.service';

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const MAX_COUNT = 100;

/**
 * Searches only what this person can see: their chats, the people in them, and messages from the part of each
 * chat they were in, minus anything deleted. Matching is "contains", ignoring case, so it works for any language.
 */
export class SearchService {
  constructor(private readonly chat: ChatService) {}

  /** My chats with the slice of history I can see in each. */
  private async myChats(me: ObjectId) {
    const convs = await this.chat.convs.find({ $or: [{ members: me }, { former: me }] }).toArray();
    const recs = new Map((await this.chat.receipts.find({ _id: { $in: convs.map((c) => rKey(c._id, me)) } }).toArray()).map((r) => [r.convId.toHexString(), r]));
    return convs.map((c) => {
      const r = recs.get(c._id.toHexString());
      return { c, from: r?.fromSeq ?? 0, until: has(c.members, me) ? Number.MAX_SAFE_INTEGER : r?.leftSeq ?? 0 };
    });
  }

  /** Messages (or files) matching q, newest first, from what I can see. */
  private async findMessages(me: ObjectId, chats: Array<{ c: ConversationDoc; from: number; until: number }>, q: string, opts: { files: boolean; limit: number; beforeId?: ObjectId; withCount: boolean }) {
    if (!chats.length) return { rows: [] as MessageDoc[], total: 0 };
    const re = { $regex: escapeRe(q), $options: 'i' };
    const visible = chats.map(({ c, from, until }) => ({ convId: c._id, seq: { $gt: from, $lte: until } }));
    const filter: Record<string, unknown> = {
      $and: [{ $or: visible }, opts.files ? { 'attachment.name': re, type: 'media' } : { text: re, type: { $in: ['text', 'media'] } }],
      deletedAt: { $exists: false }, hiddenFor: { $ne: me },
      ...(opts.beforeId ? { _id: { $lt: opts.beforeId } } : {}),
    };
    const [rows, total] = await Promise.all([
      this.chat.msgs.find(filter).sort({ _id: -1 }).limit(opts.limit).maxTimeMS(5000).toArray(),
      opts.withCount ? this.chat.msgs.countDocuments(filter, { limit: MAX_COUNT, maxTimeMS: 5000 }) : Promise.resolve(0),
    ]);
    return { rows, total };
  }

  async search(me: ObjectId, raw: string, type: 'all' | 'chats' | 'people' | 'messages' | 'files', before?: string): Promise<SearchResults> {
    const q = raw.trim().replace(/\s+/g, ' ');
    if (q.length < 2) throw AppError.validation('Type at least 2 characters.');
    if (q.length > 100) throw AppError.validation('That search is too long.');
    const chats = await this.myChats(me);
    const want = (t: string) => type === 'all' || type === t;
    const beforeId = before && /^[a-f0-9]{24}$/.test(before) ? new ObjectId(before) : undefined;
    const term = q.replace(/^@/, '');
    const re = new RegExp(escapeRe(term), 'i');

    // People I share a chat with, by name or username.
    const memberIds = [...new Set(chats.flatMap(({ c }) => c.members.map((m) => m.toHexString())))].filter((x) => x !== me.toHexString()).slice(0, 5000).map((x) => new ObjectId(x));
    const nameRe = { $regex: escapeRe(term), $options: 'i' };
    const matchedPeople = want('people') || want('chats')
      ? await this.chat.users.find({ _id: { $in: memberIds }, 'yc.disabledAt': { $exists: false }, $or: [{ 'yc.displayName': nameRe }, { firstName: nameRe }, { lastName: nameRe }, { 'yc.username': nameRe }, { username: nameRe }] }).limit(50).toArray()
      : [];

    const out: SearchResults = { query: q, chats: [], people: [], messages: [], files: [], counts: { messages: 0, files: 0 }, next: null };

    if (want('chats')) {
      const peopleIds = new Set(matchedPeople.map((u) => u._id.toHexString()));
      const hits = chats.filter(({ c }) => (c.kind === 'group' ? re.test(c.name ?? '') : c.seq > 0 && c.members.some((m) => !m.equals(me) && peopleIds.has(m.toHexString()))));
      const peers = new Map(matchedPeople.map((u) => [u._id.toHexString(), u]));
      out.chats = await Promise.all(hits.sort((a, b) => b.c.lastAt.getTime() - a.c.lastAt.getTime()).slice(0, type === 'all' ? 5 : 50).map(async ({ c }) => {
        const peer = c.kind === 'direct' ? peers.get(c.members.find((m) => !m.equals(me))!.toHexString()) : undefined;
        return this.chatRef(c, me, peer);
      }));
    }

    if (want('people')) {
      const seen = await this.chat.profilesFor(me, matchedPeople.slice(0, type === 'all' ? 5 : 50));
      const list: Array<PublicProfile & { stranger: boolean }> = [...seen.values()].map((p) => ({ ...p, stranger: false }));
      // An exact username finds someone I don't share a chat with yet.
      const uname = term.toLowerCase();
      if (USERNAME_RE.test(uname) && !list.some((p) => p.username === uname)) {
        const u = await this.chat.users.findOne({ 'yc.username': uname, 'yc.disabledAt': { $exists: false } });
        if (u && !u._id.equals(me)) list.push({ ...(await this.chat.profileFor(me, u)), stranger: !memberIds.some((m) => m.equals(u._id)) });
      }
      out.people = list;
    }

    if (want('messages')) {
      const r = await this.findMessages(me, chats, q, { files: false, limit: type === 'all' ? 20 : 40, beforeId, withCount: !beforeId });
      out.messages = await this.describe(me, r.rows, chats);
      out.counts.messages = r.total;
      if (type === 'messages' && r.rows.length === 40) out.next = r.rows[r.rows.length - 1]._id.toHexString();
    }
    if (want('files')) {
      const r = await this.findMessages(me, chats, q, { files: true, limit: type === 'all' ? 5 : 40, beforeId, withCount: !beforeId });
      out.files = await this.describe(me, r.rows, chats);
      out.counts.files = r.total;
      if (type === 'files' && r.rows.length === 40) out.next = r.rows[r.rows.length - 1]._id.toHexString();
    }
    return out;
  }

  /** Every match in one chat, oldest first, for "Result 3 of 6" (up to 500). */
  async inChat(me: ObjectId, convId: string, raw: string): Promise<{ seqs: number[] }> {
    const q = raw.trim();
    if (q.length < 2) throw AppError.validation('Type at least 2 characters.');
    const a = await this.chat.access(convId, me);
    const rows = await this.chat.msgs.find({
      convId: a.c._id, seq: { $gt: a.fromSeq, $lte: a.untilSeq }, deletedAt: { $exists: false }, hiddenFor: { $ne: me },
      $or: [{ text: { $regex: escapeRe(q), $options: 'i' } }, { 'attachment.name': { $regex: escapeRe(q), $options: 'i' } }], type: { $in: ['text', 'media'] },
    }, { projection: { seq: 1 } }).sort({ seq: 1 }).limit(500).toArray();
    return { seqs: rows.map((r) => r.seq) };
  }

  private async chatRef(c: ConversationDoc, me: ObjectId, peer?: UserDoc): Promise<SearchChat> {
    if (c.kind === 'group') return { id: c._id.toHexString(), kind: 'group', name: c.name ?? 'Group', photoUrl: c.photoKey ? await this.chat.photo(c.photoKey) : null, memberCount: c.members.length };
    let p = peer;
    if (!p) { const id = c.members.find((m) => !m.equals(me)); p = id ? (await this.chat.users.findOne({ _id: id })) ?? undefined : undefined; }
    return { id: c._id.toHexString(), kind: 'direct', name: p ? displayNameOf(p) : 'Deleted account', photoUrl: p ? (await this.chat.profileFor(me, p)).photoUrl : null, memberCount: 2 };
  }

  private async describe(me: ObjectId, rows: MessageDoc[], chats: Array<{ c: ConversationDoc }>): Promise<SearchMessage[]> {
    if (!rows.length) return [];
    const byId = new Map(chats.map(({ c }) => [c._id.toHexString(), c]));
    const msgs: ChatMessage[] = await this.chat.present(rows, me);
    const senders = new Map((await this.chat.users.find({ _id: { $in: [...new Set(rows.map((r) => r.senderId.toHexString()))].map((x) => new ObjectId(x)) } }).toArray()).map((u) => [u._id.toHexString(), displayNameOf(u)]));
    const refs = new Map<string, SearchChat>();
    for (const id of new Set(rows.map((r) => r.convId.toHexString()))) refs.set(id, await this.chatRef(byId.get(id)!, me));
    return msgs.map((m) => ({ message: m, chat: refs.get(m.conversationId)!, senderName: m.senderId === me.toHexString() ? 'You' : senders.get(m.senderId) ?? 'Deleted account' }));
  }
}
export const SEARCH = Symbol('SEARCH');

import { ObjectId } from 'mongodb';
import { MAX_PINNED_CHATS, type ChatOverview, type ConversationSummary, type MuteFor, type SharedPage, type SharedTab } from '@yays/shared';
import { AppError } from '../common/app-error';
import { rKey, type ChatService, type MessageDoc } from './chat.service';

const MUTE_MS: Record<MuteFor, number> = { '8h': 8 * 3600_000, '1w': 7 * 24 * 3600_000, always: 0 };
/** "Always" is stored as a date far ahead, so one comparison covers every case. */
const FOREVER = new Date('9999-12-31T00:00:00Z');
const LINK_RE = { $regex: 'https?://|www\\.', $options: 'i' };
const SHARED_PAGE = 60;

/** My own settings for a chat (mute, archive, pin, unread), clearing it, and what its info panel shows. */
export class ChatPrefsService {
  constructor(private readonly chat: ChatService) {}

  async set(me: ObjectId, convId: string, v: { mute?: MuteFor | 'off'; archived?: boolean; pinned?: boolean; unread?: boolean }): Promise<ConversationSummary> {
    const { c } = await this.chat.access(convId, me);
    const $set: Record<string, unknown> = { updatedAt: new Date() };
    const $unset: Record<string, ''> = {};
    if (v.mute !== undefined) $set.mutedUntil = v.mute === 'off' ? null : v.mute === 'always' ? FOREVER : new Date(Date.now() + MUTE_MS[v.mute]);
    if (v.pinned === true) {
      const pinned = await this.chat.prefs.countDocuments({ userId: me, pinnedAt: { $ne: null }, convId: { $ne: c._id } });
      if (pinned >= MAX_PINNED_CHATS) throw AppError.conflict(`You can pin up to ${MAX_PINNED_CHATS} chats. Unpin one first.`);
      $set.pinnedAt = new Date();
      $set.archived = false; // a pinned chat sits at the top, not in the archive
    } else if (v.pinned === false) $set.pinnedAt = null;
    if (v.archived === true) { $set.archived = true; $set.pinnedAt = null; }
    else if (v.archived === false) $set.archived = false;
    if (v.unread === true) $set.markedUnread = true;
    else if (v.unread === false) $unset.markedUnread = '';
    await this.chat.prefs.updateOne({ _id: rKey(c._id, me) }, { $set, ...(Object.keys($unset).length ? { $unset } : {}), $setOnInsert: { convId: c._id, userId: me } }, { upsert: true });
    // Marking read by hand also moves the read point, so the other side sees blue ticks as usual.
    if (v.unread === false) await this.chat.receipt(me, convId, 'read', Number.MAX_SAFE_INTEGER);
    this.chat.events.conversationChanged([me], c._id.toHexString());
    return this.chat.one(me, convId);
  }

  /** Hides every message so far, for me only. New ones show as usual. */
  async clear(me: ObjectId, convId: string): Promise<ConversationSummary> {
    const { c, untilSeq } = await this.chat.access(convId, me);
    const upTo = Math.min(c.seq, untilSeq);
    await this.chat.receipts.updateOne({ _id: rKey(c._id, me) }, { $max: { fromSeq: upTo, readSeq: upTo, deliveredSeq: upTo }, $set: { updatedAt: new Date() }, $setOnInsert: { convId: c._id, userId: me } }, { upsert: true });
    await this.chat.prefs.updateOne({ _id: rKey(c._id, me) }, { $unset: { markedUnread: '' } });
    this.chat.events.conversationChanged([me], c._id.toHexString());
    return this.chat.one(me, convId);
  }

  /** "Delete chat": clears it and takes it off my list until someone writes again. */
  async deleteChat(me: ObjectId, convId: string): Promise<void> {
    const { c } = await this.chat.access(convId, me);
    if (c.kind === 'group' && c.members.some((m) => m.equals(me))) throw AppError.validation('Leave the group first, then delete it.');
    await this.clear(me, convId);
    await this.chat.prefs.updateOne({ _id: rKey(c._id, me) }, { $set: { deletedSeq: c.seq, pinnedAt: null, archived: false, updatedAt: new Date() }, $setOnInsert: { convId: c._id, userId: me } }, { upsert: true });
    this.chat.events.conversationChanged([me], c._id.toHexString());
  }

  private filter(tab: SharedTab, convId: ObjectId, me: ObjectId, from: number, until: number, before?: number): Record<string, unknown> {
    const base = { convId, seq: { $gt: from, $lte: until, ...(before ? { $lt: before } : {}) }, deletedAt: { $exists: false }, hiddenFor: { $ne: me } };
    if (tab === 'media') return { ...base, type: 'media', 'attachment.kind': { $in: ['image', 'video'] } };
    if (tab === 'docs') return { ...base, type: 'media', 'attachment.kind': 'file' };
    return { ...base, type: { $in: ['text', 'media'] }, text: LINK_RE };
  }

  async shared(me: ObjectId, convId: string, tab: SharedTab, before?: number): Promise<SharedPage> {
    const { c, fromSeq, untilSeq } = await this.chat.access(convId, me);
    const rows = await this.chat.msgs.find(this.filter(tab, c._id, me, fromSeq, untilSeq, before)).sort({ seq: -1 }).limit(SHARED_PAGE + 1).maxTimeMS(5000).toArray();
    const page = rows.slice(0, SHARED_PAGE);
    return { items: await this.chat.present(page, me), next: rows.length > SHARED_PAGE ? page[page.length - 1].seq : null };
  }

  async overview(me: ObjectId, convId: string): Promise<ChatOverview> {
    const { c, fromSeq, untilSeq } = await this.chat.access(convId, me);
    const count = (tab: SharedTab) => this.chat.msgs.countDocuments(this.filter(tab, c._id, me, fromSeq, untilSeq), { limit: 10_000, maxTimeMS: 5000 });
    const [media, docs, links, starred, recent] = await Promise.all([
      count('media'), count('docs'), count('links'),
      this.chat.stars.countDocuments({ userId: me, convId: c._id }),
      this.chat.msgs.find(this.filter('media', c._id, me, fromSeq, untilSeq)).sort({ seq: -1 }).limit(8).toArray(),
    ]);
    let commonGroups: ChatOverview['commonGroups'] = [];
    let blocked = false;
    const peer = c.kind === 'direct' ? c.members.find((m) => !m.equals(me)) : undefined;
    if (peer) {
      const groups = await this.chat.convs.find({ kind: 'group', members: { $all: [me, peer] } }).sort({ lastAt: -1 }).limit(20).toArray();
      commonGroups = await Promise.all(groups.map(async (g) => ({ id: g._id.toHexString(), name: g.name ?? 'Group', photoUrl: g.photoKey ? await this.chat.photo(g.photoKey) : null, memberCount: g.members.length })));
      blocked = (await this.chat.blockState(me, peer)).iBlocked;
    }
    return { counts: { media, docs, links, starred }, recentMedia: await this.chat.present(recent as MessageDoc[], me), commonGroups, blocked };
  }
}
export const CHAT_PREFS = Symbol('CHAT_PREFS');

import { ObjectId } from 'mongodb';
import {
  DELETE_FOR_EVERYONE_MINUTES, EDIT_WINDOW_MINUTES, MAX_PINS,
  type ChatMessage, type MessageInfo, type PublicProfile, type ReceiptDetail, type SendResult, type StarredItem,
} from '@yays/shared';
import { AppError } from '../common/app-error';
import { displayNameOf, toPublic } from '../users/users.repo';
import { has, rKey, toMessage, type ChatService, type ConversationDoc, type MessageDoc, type ReceiptDoc } from './chat.service';

const minutesSince = (d: Date) => (Date.now() - d.getTime()) / 60000;
const objId = (s: string) => { if (!/^[a-f0-9]{24}$/i.test(s)) throw AppError.notFound('Message not found.'); return new ObjectId(s); };
/** When a person's read/delivered point first reached `seq`. */
const reachedAt = (marks: Array<{ s: number; t: Date }> | undefined, seq: number, fallback: Date) => marks?.find((x) => x.s >= seq)?.t ?? fallback;

export type ForwardResult = Array<{ conversationId: string; ok: true; message: ChatMessage } | { conversationId: string; ok: false; error: string }>;

/** Reply, react, forward, edit, delete, pin, star and message info. Plain sending lives in ChatService. */
export class MessagesService {
  constructor(private readonly chat: ChatService) {}

  /** A message this person can see: in the chat, after they joined, not deleted by them. */
  private async visible(me: ObjectId, convId: string, msgId: string, memberOnly = true) {
    const a = await this.chat.access(convId, me);
    if (memberOnly && !a.member) throw AppError.notFound('Chat not found.');
    const m = await this.chat.msgs.findOne({ _id: objId(msgId), convId: a.c._id });
    if (!m || m.seq <= a.fromSeq || m.seq > a.untilSeq || has(m.hiddenFor, me)) throw AppError.notFound('Message not found.');
    return { ...a, m };
  }
  private async broadcast(c: ConversationDoc, m: MessageDoc) {
    const [msg] = await this.chat.present([m]);
    this.chat.msgEvents.messageUpdated(c.members, msg);
  }
  private async mine(me: ObjectId, id: ObjectId): Promise<ChatMessage> {
    const m = await this.chat.msgs.findOne({ _id: id });
    return (await this.chat.present([m!], me))[0];
  }

  async edit(me: ObjectId, convId: string, msgId: string, text: string): Promise<ChatMessage> {
    const { c, m } = await this.visible(me, convId, msgId);
    if (!m.senderId.equals(me)) throw AppError.forbidden('You can only edit your own messages.');
    if (m.type !== 'text' || m.deletedAt) throw AppError.validation('That message can’t be edited.');
    if (m.forwarded) throw AppError.validation('Forwarded messages can’t be edited.');
    if (minutesSince(m.createdAt) > EDIT_WINDOW_MINUTES) throw AppError.conflict(`Messages can be edited for ${EDIT_WINDOW_MINUTES} minutes after sending.`);
    if (text === m.text) return this.mine(me, m._id);
    const updated = await this.chat.msgs.findOneAndUpdate({ _id: m._id, deletedAt: { $exists: false } }, { $set: { text, editedAt: new Date() } }, { returnDocument: 'after' });
    if (!updated) throw AppError.validation('That message can’t be edited.');
    await this.broadcast(c, updated);
    return this.mine(me, m._id);
  }

  /** Senders within the time limit; group admins for anyone's message, any time. */
  async deleteForEveryone(me: ObjectId, convId: string, msgId: string): Promise<ChatMessage> {
    const { c, m } = await this.visible(me, convId, msgId);
    if (m.type === 'system') throw AppError.validation('That can’t be deleted.');
    if (m.deletedAt) return this.mine(me, m._id);
    const own = m.senderId.equals(me);
    const asAdmin = c.kind === 'group' && this.chat.isAdmin(c, me) && !own;
    if (!own && !asAdmin) throw AppError.forbidden('You can only delete your own messages for everyone.');
    if (own && minutesSince(m.createdAt) > DELETE_FOR_EVERYONE_MINUTES) throw AppError.conflict(`Messages can be deleted for everyone for ${DELETE_FOR_EVERYONE_MINUTES} minutes after sending. You can still delete it for yourself.`);
    const updated = await this.chat.msgs.findOneAndUpdate({ _id: m._id }, { $set: { deletedAt: new Date(), deletedBy: me, text: '', reactions: [] } }, { returnDocument: 'after' });
    // A deleted message can't stay pinned.
    if (c.pins?.some((p) => p.msgId.equals(m._id))) {
      await this.chat.convs.updateOne({ _id: c._id }, { $pull: { pins: { msgId: m._id } } });
      this.chat.events.conversationChanged(c.members, c._id.toHexString());
    }
    await this.broadcast(c, updated!);
    return this.mine(me, m._id);
  }

  /** Hides a message from my own devices only. Works for former members too. */
  async deleteForMe(me: ObjectId, convId: string, msgId: string) {
    const { m } = await this.visible(me, convId, msgId, false);
    await this.chat.msgs.updateOne({ _id: m._id }, { $addToSet: { hiddenFor: me } });
    await this.chat.stars.deleteOne({ _id: rKey(me, m._id) });
    this.chat.msgEvents.mine(me, { conversationId: m.convId.toHexString(), messageId: m._id.toHexString(), hidden: true });
  }

  /** One reaction per person per message; a new one replaces the old. */
  async react(me: ObjectId, convId: string, msgId: string, emoji: string | null): Promise<ChatMessage> {
    const { c, m } = await this.visible(me, convId, msgId);
    if (m.type === 'system' || m.deletedAt) throw AppError.validation('You can’t react to that.');
    const keep = { $filter: { input: { $ifNull: ['$reactions', []] }, cond: { $ne: ['$$this.u', me] } } };
    const updated = await this.chat.msgs.findOneAndUpdate({ _id: m._id }, [{ $set: { reactions: emoji ? { $concatArrays: [keep, [{ u: me, e: emoji, at: new Date() }]] } : keep } }], { returnDocument: 'after' });
    await this.broadcast(c, updated!);
    return this.mine(me, m._id);
  }

  async pin(me: ObjectId, convId: string, msgId: string, on: boolean) {
    const { c, m } = await this.visible(me, convId, msgId);
    if (!this.chat.may(c, me, 'pin')) throw AppError.forbidden('Only admins can pin messages in this group.');
    if (on && (m.type !== 'text' || m.deletedAt)) throw AppError.validation('That message can’t be pinned.');
    const pinned = !!c.pins?.some((p) => p.msgId.equals(m._id));
    if (pinned === on) return this.chat.one(me, convId);
    const r = await this.chat.tx(async (s) => {
      const fresh = await this.chat.convs.findOne({ _id: c._id }, { session: s });
      const rest = (fresh?.pins ?? []).filter((p) => !p.msgId.equals(m._id));
      // Pinning a fourth replaces the oldest.
      const pins = on ? [...rest, { msgId: m._id, seq: m.seq, by: me, at: new Date() }].slice(-MAX_PINS) : rest;
      return this.chat.appendSystem(s, c._id, me, { kind: on ? 'pinned' : 'unpinned', messageId: m._id.toHexString(), seq: m.seq }, { $set: { pins } }, { members: me });
    });
    this.chat.events.messageCreated(r.c.members, toMessage(r.m));
    this.chat.events.conversationChanged(r.c.members, r.c._id.toHexString());
    return this.chat.one(me, convId);
  }

  async star(me: ObjectId, convId: string, msgId: string, on: boolean): Promise<ChatMessage> {
    const { m } = await this.visible(me, convId, msgId, false);
    if (on) {
      if (m.type === 'system' || m.deletedAt) throw AppError.validation('That message can’t be starred.');
      await this.chat.stars.updateOne({ _id: rKey(me, m._id) }, { $setOnInsert: { userId: me, msgId: m._id, convId: m.convId, at: new Date() } }, { upsert: true });
    } else await this.chat.stars.deleteOne({ _id: rKey(me, m._id) });
    this.chat.msgEvents.mine(me, { conversationId: m.convId.toHexString(), messageId: m._id.toHexString(), starred: on });
    return this.mine(me, m._id);
  }

  /** Who has read and received my message, and when. People who joined after it aren't listed. */
  async info(me: ObjectId, convId: string, msgId: string): Promise<MessageInfo> {
    const { c, m } = await this.visible(me, convId, msgId, false);
    if (!m.senderId.equals(me) || m.type !== 'text') throw AppError.forbidden('You can only see details for your own messages.');
    const others = c.members.filter((u) => !u.equals(me));
    const recs = new Map((await this.chat.receipts.find({ _id: { $in: others.map((u) => rKey(c._id, u)) } }).toArray()).map((r) => [r.userId.toHexString(), r as ReceiptDoc]));
    const people = new Map((await this.chat.users.find({ _id: { $in: others } }).toArray()).map((u) => [u._id.toHexString(), u]));
    const profile = async (u: ObjectId): Promise<PublicProfile> => { const d = people.get(u.toHexString()); return d ? toPublic(d, this.chat.photo) : { id: u.toHexString(), displayName: 'Deleted account', username: null, about: '', photoUrl: null }; };
    const readBy: ReceiptDetail[] = [], deliveredTo: ReceiptDetail[] = [], waiting: PublicProfile[] = [];
    for (const u of others) {
      const r = recs.get(u.toHexString());
      if ((r?.fromSeq ?? 0) >= m.seq) continue;
      if (r && r.readSeq >= m.seq) readBy.push({ user: await profile(u), at: reachedAt(r.readMarks, m.seq, r.updatedAt).toISOString() });
      else if (r && r.deliveredSeq >= m.seq) deliveredTo.push({ user: await profile(u), at: reachedAt(r.deliveredMarks, m.seq, r.updatedAt).toISOString() });
      else waiting.push(await profile(u));
    }
    const byTime = (a: ReceiptDetail, b: ReceiptDetail) => a.at.localeCompare(b.at);
    return { messageId: m._id.toHexString(), readBy: readBy.sort(byTime), deliveredTo: deliveredTo.sort(byTime), waiting };
  }

  /** Copies a message's text into up to 5 chats, each marked forwarded, with an optional note after it. */
  async forward(me: ObjectId, convId: string, msgId: string, v: { targets: Array<{ conversationId: string; clientId: string; commentClientId?: string }>; comment?: string }): Promise<ForwardResult> {
    const { m } = await this.visible(me, convId, msgId, false);
    if (m.type !== 'text' || m.deletedAt) throw AppError.validation('That message can’t be forwarded.');
    const seen = new Set<string>();
    const out: ForwardResult = [];
    for (const t of v.targets) {
      if (seen.has(t.conversationId)) continue;
      seen.add(t.conversationId);
      try {
        const r: SendResult = await this.chat.send(me, t.conversationId, t.clientId, m.text, { forwarded: true });
        if (v.comment && t.commentClientId) await this.chat.send(me, t.conversationId, t.commentClientId, v.comment);
        out.push({ conversationId: t.conversationId, ok: true, message: r.message });
      } catch (e) {
        out.push({ conversationId: t.conversationId, ok: false, error: e instanceof AppError ? e.message : 'Could not send.' });
      }
    }
    return out;
  }

  async starred(me: ObjectId, before?: string, limit = 50): Promise<{ items: StarredItem[]; next: string | null }> {
    const filter: Record<string, unknown> = { userId: me };
    if (before) { const t = Number(before); if (!Number.isFinite(t)) throw AppError.validation('That page link is not valid.'); filter.at = { $lt: new Date(t) }; }
    const rows = await this.chat.stars.find(filter).sort({ at: -1 }).limit(limit + 1).toArray();
    const page = rows.slice(0, limit);
    const msgs = new Map((await this.chat.msgs.find({ _id: { $in: page.map((r) => r.msgId) } }).toArray()).map((x) => [x._id.toHexString(), x]));
    const convs = new Map((await this.chat.convs.find({ _id: { $in: [...new Set(page.map((r) => r.convId.toHexString()))].map((x) => new ObjectId(x)) }, $or: [{ members: me }, { former: me }] }).toArray()).map((c) => [c._id.toHexString(), c]));
    const peerIds = [...convs.values()].filter((c) => c.kind === 'direct').map((c) => c.members.find((u) => !u.equals(me))).filter((x): x is ObjectId => !!x);
    const peers = new Map((await this.chat.users.find({ _id: { $in: peerIds } }).toArray()).map((u) => [u._id.toHexString(), displayNameOf(u)]));
    const items: StarredItem[] = [];
    for (const r of page) {
      const msg = msgs.get(r.msgId.toHexString());
      const c = convs.get(r.convId.toHexString());
      if (!msg || !c || msg.deletedAt || has(msg.hiddenFor, me)) continue;
      const peer = c.kind === 'direct' ? c.members.find((u) => !u.equals(me)) : undefined;
      items.push({ message: (await this.chat.present([msg], me))[0], conversationId: c._id.toHexString(), conversationName: c.kind === 'group' ? c.name ?? 'Group' : peers.get(peer?.toHexString() ?? '') ?? 'Deleted account', starredAt: r.at.toISOString() });
    }
    const last = page[page.length - 1];
    return { items, next: rows.length > limit && last ? String(last.at.getTime()) : null };
  }
}
export const MESSAGES = Symbol('MESSAGES');

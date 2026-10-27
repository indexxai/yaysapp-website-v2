import { randomUUID } from 'crypto';
import { ObjectId, type Db } from 'mongodb';
import type { ConversationSummary } from '@yays/shared';
import { AppError } from '../common/app-error';
import { C } from '../infra/mongo';
import { KEY_RE } from '../infra/storage';
import type { ChatService } from '../chat/chat.service';
import type { UsersRepo } from './users.repo';

const SUPPORT_USERNAME = 'yaysapp';
const WELCOME = 'Hi! This is YaysApp Support. Tell us what’s going on and we’ll reply in this chat.';

/** "Contact us" (a chat with the support account), problem reports, and how much media each chat holds. */
export class SupportService {
  constructor(private readonly users: UsersRepo, private readonly chat: ChatService, private readonly db: Db) {}

  /** The support account, made the first time someone asks. Its username is reserved, so nobody else can take it. */
  private async supportUser() {
    const found = await this.users.col.findOne({ 'yc.username': SUPPORT_USERNAME });
    if (found) return found;
    try {
      const u = await this.users.create({ displayName: 'YaysApp Support' });
      return (await this.users.setYc(u._id, { username: SUPPORT_USERNAME, about: 'Official YaysApp help. We reply here.' }))!;
    } catch {
      return (await this.users.col.findOne({ 'yc.username': SUPPORT_USERNAME }))!;
    }
  }

  async openChat(me: ObjectId): Promise<ConversationSummary> {
    const s = await this.supportUser();
    if (s._id.equals(me)) throw AppError.validation('This is the support account.');
    const c = await this.chat.openDirect(me, s._id.toHexString());
    if (c.lastSeq === 0) { await this.chat.send(s._id, c.id, randomUUID(), WELCOME); return this.chat.one(me, c.id); }
    return c;
  }

  async problem(me: ObjectId, v: { text: string; screenshotKey?: string; userAgent?: string; appVersion?: string; page?: string }) {
    if (v.screenshotKey && (!KEY_RE.test(v.screenshotKey) || !v.screenshotKey.startsWith(`media/${me.toHexString()}/`))) throw AppError.forbidden('That screenshot was not uploaded by you.');
    await this.db.collection(C.problemReports).insertOne({ userId: me, text: v.text.trim(), ...(v.screenshotKey ? { screenshotKey: v.screenshotKey } : {}), userAgent: v.userAgent?.slice(0, 300), appVersion: v.appVersion?.slice(0, 40), page: v.page?.slice(0, 200), at: new Date(), status: 'open' });
  }

  /** Space taken by photos, videos, voice and files in each of my chats, biggest first. */
  async storage(me: ObjectId) {
    const convs = await this.chat.convs.find({ $or: [{ members: me }, { former: me }] }, { projection: { _id: 1 } }).toArray();
    if (!convs.length) return { total: 0, byKind: { image: 0, video: 0, voice: 0, file: 0 }, chats: [] };
    const rows = await this.chat.msgs.aggregate<{ _id: { c: ObjectId; k: string }; bytes: number; n: number }>([
      { $match: { convId: { $in: convs.map((c) => c._id) }, type: 'media', deletedAt: { $exists: false }, hiddenFor: { $ne: me } } },
      { $group: { _id: { c: '$convId', k: '$attachment.kind' }, bytes: { $sum: '$attachment.size' }, n: { $sum: 1 } } },
    ], { maxTimeMS: 10_000 }).toArray();
    const byKind: Record<'image' | 'video' | 'voice' | 'file', number> = { image: 0, video: 0, voice: 0, file: 0 };
    const per = new Map<string, { bytes: number; counts: Record<string, number> }>();
    for (const r of rows) {
      byKind[r._id.k as keyof typeof byKind] = (byKind[r._id.k as keyof typeof byKind] ?? 0) + r.bytes;
      const e = per.get(r._id.c.toHexString()) ?? { bytes: 0, counts: {} };
      e.bytes += r.bytes; e.counts[r._id.k] = (e.counts[r._id.k] ?? 0) + r.n;
      per.set(r._id.c.toHexString(), e);
    }
    const top = [...per.entries()].sort((a, b) => b[1].bytes - a[1].bytes).slice(0, 10);
    const summaries = await this.chat.summaries(me, await this.chat.convs.find({ _id: { $in: top.map(([id]) => new ObjectId(id)) } }).toArray());
    const name = (id: string) => { const s = summaries.find((x) => x.id === id); return s?.group?.name ?? s?.peer?.displayName ?? 'Chat'; };
    return {
      total: Object.values(byKind).reduce((a, b) => a + b, 0), byKind,
      chats: top.map(([id, e]) => ({ conversationId: id, name: name(id), kind: summaries.find((x) => x.id === id)?.kind ?? 'direct', bytes: e.bytes, counts: e.counts })),
    };
  }
}
export const SUPPORT = Symbol('SUPPORT');

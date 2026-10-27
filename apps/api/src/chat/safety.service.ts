import { ObjectId } from 'mongodb';
import type { PublicProfile, ReportReason } from '@yays/shared';
import { AppError } from '../common/app-error';
import { C } from '../infra/mongo';
import { toPublic } from '../users/users.repo';
import { has, type ChatService } from './chat.service';

export interface ReportDoc {
  _id: ObjectId; by: ObjectId; targetUserId?: ObjectId; convId?: ObjectId; reason: ReportReason; note?: string;
  /** The last few messages from them (or from the group) that the reporter could see, kept as they were. */
  evidence: Array<{ id: ObjectId; senderId: ObjectId; seq: number; text: string; type: string; attachmentKey?: string; at: Date }>;
  at: Date; status: 'open';
}
const EVIDENCE = 5;
const MAX_BLOCKS = 5000;

/** Blocking people and reporting people or groups. */
export class SafetyService {
  constructor(private readonly chat: ChatService) {}
  get reports() { return this.chat.db.collection<ReportDoc>(C.reports); }

  async block(me: ObjectId, userId: string) {
    const target = new ObjectId(userId);
    if (target.equals(me)) throw AppError.validation("You can't block yourself.");
    if (!(await this.chat.users.findOne({ _id: target }, { projection: { _id: 1 } }))) throw AppError.notFound('That person is not on YaysApp.');
    if (await this.chat.blocks.countDocuments({ by: me }) >= MAX_BLOCKS) throw AppError.conflict('You have blocked too many people.');
    await this.chat.blocks.updateOne({ _id: `${me.toHexString()}:${userId}` }, { $setOnInsert: { by: me, target, at: new Date() } }, { upsert: true });
    this.chat.events.blocked(me, target);
    await this.changed(me, target);
  }

  async unblock(me: ObjectId, userId: string) {
    const target = new ObjectId(userId);
    await this.chat.blocks.deleteOne({ _id: `${me.toHexString()}:${userId}` });
    await this.changed(me, target);
  }

  async list(me: ObjectId): Promise<PublicProfile[]> {
    const rows = await this.chat.blocks.find({ by: me }).sort({ at: -1 }).limit(MAX_BLOCKS).toArray();
    const users = new Map((await this.chat.users.find({ _id: { $in: rows.map((r) => r.target) } }).toArray()).map((u) => [u._id.toHexString(), u]));
    const seen = await this.chat.profilesFor(me, [...users.values()]);
    return Promise.all(rows.map(async (r) => { const u = users.get(r.target.toHexString()); return u ? seen.get(u._id.toHexString())! : { id: r.target.toHexString(), displayName: 'Deleted account', username: null, about: '', photoUrl: null }; }));
  }

  /** My devices refresh our direct chat (the composer locks or unlocks). They aren't told anything. */
  private async changed(me: ObjectId, target: ObjectId) {
    const [a, b] = [me.toHexString(), target.toHexString()].sort();
    const c = await this.chat.convs.findOne({ directKey: `${a}:${b}` }, { projection: { _id: 1 } });
    if (c) this.chat.events.conversationChanged([me], c._id.toHexString());
  }

  /**
   * Reports a person (optionally in a chat we share) or a group. The last few messages I could see from them
   * go with it, so moderators see what happened even if they are deleted later.
   */
  async report(me: ObjectId, v: { userId?: string; conversationId?: string; reason: ReportReason; note?: string; block?: boolean }) {
    let convId: ObjectId | undefined;
    let range = { from: 0, until: 0 };
    if (v.conversationId) {
      const a = await this.chat.access(v.conversationId, me);
      convId = a.c._id; range = { from: a.fromSeq, until: a.untilSeq };
      if (v.userId && !has(a.c.members, new ObjectId(v.userId)) && !has(a.c.former, new ObjectId(v.userId))) throw AppError.validation('That person is not in this chat.');
    }
    const target = v.userId ? new ObjectId(v.userId) : undefined;
    if (target?.equals(me)) throw AppError.validation("You can't report yourself.");
    if (target && !(await this.chat.users.findOne({ _id: target }, { projection: { _id: 1 } }))) throw AppError.notFound('That person is not on YaysApp.');
    if (!convId && target) {
      // Reporting a person without naming a chat: use our direct chat if there is one.
      const [a, b] = [me.toHexString(), target.toHexString()].sort();
      const c = await this.chat.convs.findOne({ directKey: `${a}:${b}` });
      if (c) { convId = c._id; range = { from: (await this.chat.access(c._id, me)).fromSeq, until: Number.MAX_SAFE_INTEGER }; }
    }
    const evidence = convId ? await this.chat.msgs.find({
      convId, seq: { $gt: range.from, $lte: range.until }, type: { $in: ['text', 'media'] }, ...(target ? { senderId: target } : { senderId: { $ne: me } }),
    }).sort({ seq: -1 }).limit(EVIDENCE).toArray() : [];
    await this.reports.insertOne({
      _id: new ObjectId(), by: me, ...(target ? { targetUserId: target } : {}), ...(convId ? { convId } : {}), reason: v.reason, ...(v.note ? { note: v.note.trim() } : {}),
      evidence: evidence.map((m) => ({ id: m._id, senderId: m.senderId, seq: m.seq, text: m.text, type: m.type, ...(m.attachment ? { attachmentKey: m.attachment.key } : {}), at: m.createdAt })),
      at: new Date(), status: 'open',
    });
    if (v.block && target) await this.block(me, target.toHexString());
  }
}
export const SAFETY = Symbol('SAFETY');

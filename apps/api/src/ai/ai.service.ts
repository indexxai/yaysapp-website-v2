import { randomInt } from 'crypto';
import { ObjectId, type Collection, type Db } from 'mongodb';
import type Redis from 'ioredis';
import { AI_EXTRA, AI_FREE_PER_DAY, type AiChat, type AiChatSummary, type AiDocument, type AiMessage, type AiMode, type AiQuota, type AiReply, type AiSource, type AiSummary, type SupportAnswer, type SupportTicket } from '@yays/shared';
import { AppError } from '../common/app-error';
import { C } from '../infra/mongo';
import { has, type ChatService } from '../chat/chat.service';
import { displayNameOf, type UserDoc } from '../users/users.repo';
import type { RewardsService } from '../rewards/rewards.service';
import type { SupportService } from '../users/support.service';
import type { AiProvider, AiTurn } from './ai.provider';

interface AiChatDoc { _id: ObjectId; userId: ObjectId; title: string; saved: boolean; mode: AiMode; createdAt: Date; updatedAt: Date; document?: AiDocument }
interface AiMsgDoc { _id: ObjectId; chatId: ObjectId; userId: ObjectId; role: 'user' | 'assistant'; text: string; mode: AiMode; at: Date; sources?: AiSource[]; document?: AiDocument }

const JACK = `You are Jack's AI, the assistant inside YaysApp, a chat app from Indexx. Be warm, brief and practical. Use plain words.
YaysApp: chats, groups, communities, calls; INEX (the Indexx coin) is earned for daily check-ins, activity and inviting friends, and can be converted to BTCY Nuggets.
Indexx products: BTCY (mining Nuggets), EMMM (prediction markets), ShoperPal (shopping deals), ReHuman (wellness), Wall Street Indexx (markets).
Never give personalised financial or investment advice. Never ask for passwords, card numbers or PINs.`;
const DOC = `${JACK}
The person wants a document. Reply in exactly this shape: one short sentence to the person, then a line containing only ---DOCUMENT---, then the whole document in Markdown starting with "# " and its title. Use [PLACEHOLDER] for facts you don't know. When a current document is given, return the whole updated document.`;
const SEARCH = `${JACK}
Search the web for anything current. Say when forecasts or prices may change. Keep the answer short.`;
const SUMMARY = `SUMMARY. Summarise this group chat for someone catching up, in 2 to 4 short sentences: decisions, plans, times, and anything asked of them. Use first names. No preamble.`;
const SITE = `You are Jack's AI on the YaysApp website. Answer questions about YaysApp and INEX in 1 to 3 short sentences.
YaysApp is a free chat app for phones and browsers: chats, groups, communities, voice and video calls. People earn INEX, the Indexx coin, for daily check-ins, chatting, posting in communities and inviting friends; points convert to BTCY Nuggets.
For business plans, pricing for companies, partnerships or anything you don't know, say you don't have the details and suggest leaving an email so the team can reply. Never invent prices or dates.`;
const SUPPORT = `You are YaysApp Support's first answer. Answer the person's problem in 2 to 4 short sentences, using these facts:
- Daily check-ins reset at midnight in the person's time zone; missing a day restarts the 7-day streak at day 1.
- INEX for activity stops at 200 a day. Referral INEX stays pending until the friend verifies their phone number and sends a first message.
- One tick: sent; two ticks: delivered; orange ticks: read. Notifications: Settings › Notifications and the browser's own site settings.
- Two-step PIN forgotten: choose Forgot PIN on the PIN screen; a code goes to the other address.
- Payments use USDXX in a linked Indexx account; payments can't be cancelled once sent.
If you can't solve it, say a person from the team can look at it.`;

/** Jack's AI: private conversations, documents, web answers, chat summaries, and the first answer at Support. */
export class AiService {
  readonly chats: Collection<AiChatDoc>;
  readonly msgs: Collection<AiMsgDoc>;
  readonly consent: Collection<{ _id: string; userId: ObjectId; convId: ObjectId; at: Date }>;
  readonly users: Collection<UserDoc>;
  support?: SupportService;
  constructor(private readonly ai: AiProvider, private readonly db: Db, private readonly redis: Redis, private readonly chat: ChatService, private readonly rewards: RewardsService) {
    this.chats = db.collection(C.aiChats);
    this.msgs = db.collection(C.aiMessages);
    this.consent = db.collection(C.aiConsent);
    this.users = db.collection(C.users);
  }

  /* ------------------------------------------------------------ daily messages */

  async quota(me: ObjectId): Promise<AiQuota> {
    const d = await this.rewards.dayStart(me);
    const [used, extra] = await this.redis.mget(`ai:q:${me.toHexString()}:${d.day}`, `ai:x:${me.toHexString()}:${d.day}`);
    return { used: Number(used ?? 0), limit: AI_FREE_PER_DAY + Number(extra ?? 0), resetsAt: d.next.toISOString(), extraCost: AI_EXTRA.cost, extraMessages: AI_EXTRA.messages };
  }

  /** Takes one of today's messages, or says none are left. Give it back with `refund` if the answer fails. */
  private async take(me: ObjectId) {
    const d = await this.rewards.dayStart(me);
    const key = `ai:q:${me.toHexString()}:${d.day}`;
    const n = await this.redis.incr(key);
    if (n === 1) await this.redis.expire(key, 2 * 86400);
    const extra = Number(await this.redis.get(`ai:x:${me.toHexString()}:${d.day}`) ?? 0);
    if (n > AI_FREE_PER_DAY + extra) {
      await this.redis.decr(key);
      throw AppError.conflict(`You’ve used today’s ${AI_FREE_PER_DAY + extra} messages. They reset at midnight, or use ${AI_EXTRA.cost} INEX for ${AI_EXTRA.messages} more.`, undefined, { quota: true });
    }
    return async () => { await this.redis.decr(key); };
  }

  async buyMessages(me: ObjectId): Promise<AiQuota> {
    const d = await this.rewards.dayStart(me);
    const paid = await this.rewards.award(me, d.tz, { key: `ai-extra:${d.day}:${Date.now()}`, kind: 'ai_extra', title: 'More Jack’s AI messages', sub: `${AI_EXTRA.messages} extra messages today`, amount: -AI_EXTRA.cost });
    if (!paid) throw AppError.validation('That didn’t go through. Try again.');
    const key = `ai:x:${me.toHexString()}:${d.day}`;
    await this.redis.incrby(key, AI_EXTRA.messages);
    await this.redis.expire(key, 2 * 86400);
    return this.quota(me);
  }

  /* ------------------------------------------------------------ conversations */

  private summary(c: AiChatDoc): AiChatSummary { return { id: c._id.toHexString(), title: c.title, saved: c.saved, mode: c.mode, updatedAt: c.updatedAt.toISOString() }; }
  private message(m: AiMsgDoc): AiMessage { return { id: m._id.toHexString(), role: m.role, text: m.text, at: m.at.toISOString(), mode: m.mode, ...(m.sources?.length ? { sources: m.sources } : {}), ...(m.document ? { document: m.document } : {}) }; }

  private async own(me: ObjectId, id: string) {
    const c = ObjectId.isValid(id) ? await this.chats.findOne({ _id: new ObjectId(id), userId: me }) : null;
    if (!c) throw AppError.notFound('Conversation not found.');
    return c;
  }

  async list(me: ObjectId) { return (await this.chats.find({ userId: me }).sort({ updatedAt: -1 }).limit(100).toArray()).map((c) => this.summary(c)); }

  async get(me: ObjectId, id: string): Promise<AiChat> {
    const c = await this.own(me, id);
    const msgs = await this.msgs.find({ chatId: c._id }).sort({ _id: 1 }).limit(200).toArray();
    return { ...this.summary(c), messages: msgs.map((m) => this.message(m)), quota: await this.quota(me), document: c.document ?? null };
  }

  async patch(me: ObjectId, id: string, v: { title?: string; saved?: boolean }) {
    const c = await this.own(me, id);
    const r = await this.chats.findOneAndUpdate({ _id: c._id }, { $set: { ...(v.title ? { title: v.title } : {}), ...(v.saved !== undefined ? { saved: v.saved } : {}) } }, { returnDocument: 'after' });
    return this.summary(r!);
  }

  async remove(me: ObjectId, id: string) {
    const c = await this.own(me, id);
    await this.msgs.deleteMany({ chatId: c._id });
    await this.chats.deleteOne({ _id: c._id });
  }

  async ask(me: ObjectId, chatId: string | null, text: string, mode: AiMode): Promise<AiReply> {
    let c = chatId ? await this.own(me, chatId) : null;
    const refund = await this.take(me);
    const history = c ? (await this.msgs.find({ chatId: c._id }).sort({ _id: -1 }).limit(20).toArray()).reverse() : [];
    const turns: AiTurn[] = history.map((m) => ({ role: m.role, text: m.role === 'assistant' && m.document ? `${m.text}\n(document v${m.document.version}: ${m.document.title})` : m.text }));
    const doc = mode === 'document' ? c?.document : undefined;
    turns.push({ role: 'user', text: doc ? `Current document:\n${doc.markdown}\n\nChange request: ${text}` : text });
    let out;
    try { out = await this.ai.complete({ system: mode === 'document' ? DOC : mode === 'search' ? SEARCH : JACK, turns, search: mode === 'search', maxTokens: mode === 'document' ? 4000 : 1500 }); }
    catch (e) { await refund(); throw e; }
    let answer = out.text, document: AiDocument | undefined;
    if (mode === 'document') {
      const [note, body] = out.text.split(/\n?---DOCUMENT---\n?/);
      if (body?.trim()) {
        const title = /^#\s+(.+)$/m.exec(body)?.[1]?.trim().slice(0, 80) ?? 'Document';
        document = { title, markdown: body.trim(), version: (doc?.version ?? 0) + 1 };
        answer = note?.trim() || 'Done. It’s open on the right.';
      }
    }
    const now = new Date();
    if (!c) {
      c = { _id: new ObjectId(), userId: me, title: text.replace(/\s+/g, ' ').slice(0, 60), saved: false, mode, createdAt: now, updatedAt: now };
      await this.chats.insertOne(c);
    }
    const user: AiMsgDoc = { _id: new ObjectId(), chatId: c._id, userId: me, role: 'user', text, mode, at: now };
    const bot: AiMsgDoc = { _id: new ObjectId(), chatId: c._id, userId: me, role: 'assistant', text: answer, mode, at: new Date(), ...(out.sources.length ? { sources: out.sources } : {}), ...(document ? { document } : {}) };
    await this.msgs.insertMany([user, bot]);
    const next = await this.chats.findOneAndUpdate({ _id: c._id }, { $set: { updatedAt: bot.at, mode, ...(document ? { document } : {}) } }, { returnDocument: 'after' });
    void this.rewards.onAiQuestion(me).catch(() => undefined);
    return { chat: this.summary(next!), user: this.message(user), assistant: this.message(bot), quota: await this.quota(me) };
  }

  /* ------------------------------------------------------------ inside a chat */

  async hasConsent(me: ObjectId, convId: string) { await this.chat.access(convId, me); return { consent: !!(await this.consent.findOne({ _id: `${me.toHexString()}:${convId.toLowerCase()}` })) }; }
  async setConsent(me: ObjectId, convId: string, on: boolean) {
    const { c } = await this.chat.access(convId, me);
    const _id = `${me.toHexString()}:${c._id.toHexString()}`;
    if (on) await this.consent.updateOne({ _id }, { $set: { userId: me, convId: c._id, at: new Date() } }, { upsert: true });
    else await this.consent.deleteOne({ _id });
    return { consent: on };
  }

  /** The last 200 text messages I can see in this chat, summarised. Only after I said yes for this chat. */
  async summarize(me: ObjectId, convId: string): Promise<AiSummary> {
    const { c, fromSeq: from, untilSeq } = await this.chat.access(convId, me);
    if (!(await this.consent.findOne({ _id: `${me.toHexString()}:${c._id.toHexString()}` }))) throw AppError.forbidden('Allow Jack’s AI to read this chat first.');
    const rows = (await this.chat.msgs.find({ convId: c._id, type: 'text', deletedAt: { $exists: false }, seq: { $gt: from, $lte: untilSeq }, payment: { $exists: false } }).sort({ seq: -1 }).limit(200).toArray())
      .filter((m) => !has(m.hiddenFor, me)).reverse();
    if (!rows.length) throw AppError.validation('There’s nothing to summarise yet.');
    const people = new Map((await this.users.find({ _id: { $in: [...new Set(rows.map((r) => r.senderId.toHexString()))].map((x) => new ObjectId(x)) } }).toArray()).map((u) => [u._id.toHexString(), u._id.equals(me) ? 'Me' : displayNameOf(u).split(/\s+/)[0]!]));
    const transcript = rows.map((m) => `[${m.createdAt.toISOString().slice(0, 16)}] ${people.get(m.senderId.toHexString()) ?? 'Someone'}: ${m.text.slice(0, 500)}`).join('\n');
    const refund = await this.take(me);
    let out;
    try { out = await this.ai.complete({ system: SUMMARY, turns: [{ role: 'user', text: transcript }], maxTokens: 400 }); }
    catch (e) { await refund(); throw e; }
    void this.rewards.onAiSummary(me).catch(() => undefined);
    return { conversationId: c._id.toHexString(), text: out.text, count: rows.length, at: new Date().toISOString() };
  }

  /* ------------------------------------------------------------ website and support */

  async siteAsk(messages: AiTurn[]) {
    const out = await this.ai.complete({ system: SITE, turns: messages, maxTokens: 300 });
    return { text: out.text };
  }

  async lead(v: { name: string; email: string; question: string }, ip: string) {
    await this.db.collection(C.leads).insertOne({ ...v, ip, at: new Date(), status: 'new' });
  }

  async supportAsk(me: ObjectId, question: string): Promise<SupportAnswer> {
    try { return { answer: (await this.ai.complete({ system: SUPPORT, turns: [{ role: 'user', text: question }], maxTokens: 400 })).text, ai: true }; }
    catch { return { answer: 'Jack’s AI can’t answer just now. A person from our team can look at it.', ai: false }; }
  }

  /** "Talk to a person": a ticket number, and the whole question and answer in the Support chat so nobody repeats themselves. */
  async ticket(me: ObjectId, question: string, answer: string): Promise<SupportTicket> {
    if (!this.support) throw new Error('support not wired');
    const number = `YS-${randomInt(10000, 99999)}`;
    const conv = await this.support.openChat(me);
    await this.db.collection(C.supportTickets).insertOne({ number, userId: me, convId: new ObjectId(conv.id), question, answer, status: 'open', at: new Date() });
    await this.chat.send(me, conv.id, `ticket-${number}`, `${question}${answer ? `\n\nJack’s AI said: ${answer}` : ''}`);
    await this.support.say(conv.id, `Ticket #${number} created. Our team sees this whole conversation, so you won’t need to repeat yourself. We’ll reply here.`);
    return { number, conversationId: conv.id };
  }
}
export const AI = Symbol('AI');

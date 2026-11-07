import { randomBytes, randomInt } from 'crypto';
import { ObjectId, type Collection, type Db } from 'mongodb';
import type Redis from 'ioredis';
import { AI_EXTRA, AI_FREE_PER_DAY, docHtml, type AiChat, type AiHandoff, type AiImage, type AiInfo, type AiChatSummary, type AiDocument, type AiMessage, type AiMode, type AiQuota, type AiReply, type AiSource, type AiSummary, type SupportAnswer, type SupportTicket } from '@yays/shared';
import { AppError } from '../common/app-error';
import { C } from '../infra/mongo';
import { has, type ChatService } from '../chat/chat.service';
import { displayNameOf, type UserDoc } from '../users/users.repo';
import type { RewardsService } from '../rewards/rewards.service';
import type { SupportService } from '../users/support.service';
import type { AiProvider, AiTurn } from './ai.provider';
import type { ImageProvider, MadeImage } from './ai.images';
import type { Storage } from '../infra/storage';
import type { StoredAttachment } from '../chat/chat.service';

interface AiChatDoc { _id: ObjectId; userId: ObjectId; title: string; saved: boolean; mode: AiMode; createdAt: Date; updatedAt: Date; document?: AiDocument }
interface StoredImage { n: number; key: string; width: number; height: number; size: number }
interface AiMsgDoc {
  _id: ObjectId; chatId: ObjectId; userId: ObjectId; role: 'user' | 'assistant'; text: string; mode: AiMode; at: Date;
  sources?: AiSource[]; document?: AiDocument; images?: StoredImage[]; handoff?: boolean; editOf?: { messageId: ObjectId; n: number };
  /** Picture files also sent into a chat: kept when this conversation is deleted. */
  sharedKeys?: string[];
}
export interface AiOptions { imagesPerDay: number; imageOptions: number; fullJackUrl: string }

/** "Draw a cat", "make me a poster…": a picture, even if Image wasn't chosen. */
const ASKS_FOR_PICTURE = /^(please\s+|can you\s+|could you\s+)?(draw|generate|create|make|design|paint|sketch)\b.{0,60}\b(image|picture|photo|poster|logo|illustration|drawing|sticker|wallpaper|artwork|banner|flyer|avatar)s?\b/i;

const JACK = `You are Jack's AI, the assistant inside YaysApp, a chat app from Indexx. Be warm, brief and practical. Use plain words.
YaysApp: chats, groups, communities, calls; INEX (the Indexx coin) is earned for daily check-ins, activity and inviting friends, and can be withdrawn 1:1 to the Indexx Exchange INEX wallet (at least 25 INEX) from Wallet.
Indexx products: BTCY (mining Nuggets), EMMM (prediction markets), ShoperPal (shopping deals), ReHuman (wellness), Wall Street Indexx (markets).
Never give personalised financial or investment advice. Never ask for passwords, card numbers or PINs.
You are the light version of Jack's AI: you talk, write documents and make pictures. The full Jack's AI does specialised work: using websites and filling in forms or bookings, reading and analysing files people upload, spreadsheets, videos, music, running code and long research reports. When someone asks for that kind of work, say in one or two sentences what the full Jack's AI can do for them, then end with a line containing only ---JACK---. Don't pretend to do it yourself.
If someone asks for a picture, tell them to choose Image below the message box.`;
const DOC = `${JACK}
The person wants a document. Reply in exactly this shape: one short sentence to the person, then a line containing only ---DOCUMENT---, then the whole document in Markdown starting with "# " and its title. Use [PLACEHOLDER] for facts you don't know. When a current document is given, return the whole updated document.`;
const SEARCH = `${JACK}
Search the web for anything current. Say when forecasts or prices may change. Keep the answer short.`;
const SUMMARY = `SUMMARY. Summarise this group chat for someone catching up, in 2 to 4 short sentences: decisions, plans, times, and anything asked of them. Use first names. No preamble.`;
const SITE = `You are Jack's AI on the YaysApp website. Answer questions about YaysApp and INEX in 1 to 3 short sentences.
YaysApp is a free chat app for phones and browsers: chats, groups, communities, voice and video calls. People earn INEX, the Indexx coin, for daily check-ins, chatting, posting in communities and inviting friends; INEX can be withdrawn to the Indexx Exchange INEX wallet.
For business plans, pricing for companies, partnerships or anything you don't know, say you don't have the details and suggest leaving an email so the team can reply. Never invent prices or dates.`;
const SUPPORT = `You are YaysApp Support's first answer. Answer the person's problem in 2 to 4 short sentences, using these facts:
- Daily check-ins reset at midnight in the person's time zone; missing a day restarts the 7-day streak at day 1.
- INEX for activity stops at 200 a day. Referral INEX stays pending until the friend verifies their phone number and sends a first message.
- One tick: sent; two ticks: delivered; orange ticks: read. Notifications: Settings › Notifications and the browser's own site settings.
- Two-step PIN forgotten: choose Forgot PIN on the PIN screen; a code goes to the other address.
If you can't solve it, say a person from the team can look at it.`;

/** Jack's AI: private conversations, documents, web answers, chat summaries, and the first answer at Support. */
export class AiService {
  readonly chats: Collection<AiChatDoc>;
  readonly msgs: Collection<AiMsgDoc>;
  readonly consent: Collection<{ _id: string; userId: ObjectId; convId: ObjectId; at: Date }>;
  readonly users: Collection<UserDoc>;
  support?: SupportService;
  constructor(private readonly ai: AiProvider, private readonly db: Db, private readonly redis: Redis, private readonly chat: ChatService, private readonly rewards: RewardsService,
    private readonly storage: Storage, private readonly images: ImageProvider | null, private readonly opts: AiOptions) {
    this.chats = db.collection(C.aiChats);
    this.msgs = db.collection(C.aiMessages);
    this.consent = db.collection(C.aiConsent);
    this.users = db.collection(C.users);
  }

  /* ------------------------------------------------------------ daily messages */

  async quota(me: ObjectId): Promise<AiQuota> {
    const d = await this.rewards.dayStart(me);
    const [used, extra] = await this.redis.mget(`ai:q:${me.toHexString()}:${d.day}`, `ai:x:${me.toHexString()}:${d.day}`);
    const img = Number(await this.redis.get(`ai:img:${me.toHexString()}:${d.day}`) ?? 0);
    return {
      used: Number(used ?? 0), limit: AI_FREE_PER_DAY + Number(extra ?? 0), resetsAt: d.next.toISOString(), extraCost: AI_EXTRA.cost, extraMessages: AI_EXTRA.messages,
      images: { used: img, limit: this.images ? this.opts.imagesPerDay : 0, perRequest: this.opts.imageOptions },
    };
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

  /** Takes `n` of today's pictures, or says there aren't enough left. */
  private async takeImages(me: ObjectId, n: number) {
    if (!this.images || this.opts.imagesPerDay === 0) throw AppError.conflict('Pictures aren’t available right now.');
    const d = await this.rewards.dayStart(me);
    const key = `ai:img:${me.toHexString()}:${d.day}`;
    const total = await this.redis.incrby(key, n);
    if (total === n) await this.redis.expire(key, 2 * 86400);
    if (total > this.opts.imagesPerDay) {
      await this.redis.decrby(key, n);
      const left = Math.max(0, this.opts.imagesPerDay - (total - n));
      throw AppError.conflict(left ? `You have ${left} picture${left === 1 ? '' : 's'} left today and this needs ${n}. They reset at midnight.` : `You’ve made today’s ${this.opts.imagesPerDay} pictures. They reset at midnight.`, undefined, { imageQuota: true });
    }
    return async () => { await this.redis.decrby(key, n); };
  }

  info(): AiInfo {
    return { model: this.ai.model, images: !!this.images && this.opts.imagesPerDay > 0, search: this.ai.canSearch, demo: this.ai.name === 'dev', fullJackUrl: this.opts.fullJackUrl };
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
  private handoff(): AiHandoff { return { url: this.opts.fullJackUrl, label: 'Open the full Jack’s AI' }; }
  private async message(m: AiMsgDoc): Promise<AiMessage> {
    const images: AiImage[] | undefined = m.images?.length ? await Promise.all(m.images.map(async (i) => ({ n: i.n, url: await this.storage.downloadUrl(i.key), width: i.width, height: i.height }))) : undefined;
    return {
      id: m._id.toHexString(), role: m.role, text: m.text, at: m.at.toISOString(), mode: m.mode,
      ...(m.sources?.length ? { sources: m.sources } : {}), ...(m.document ? { document: m.document } : {}),
      ...(images ? { images } : {}), ...(m.handoff ? { handoff: this.handoff() } : {}),
      ...(m.editOf ? { editOf: { messageId: m.editOf.messageId.toHexString(), n: m.editOf.n } } : {}),
    };
  }

  private async own(me: ObjectId, id: string) {
    const c = ObjectId.isValid(id) ? await this.chats.findOne({ _id: new ObjectId(id), userId: me }) : null;
    if (!c) throw AppError.notFound('Conversation not found.');
    return c;
  }

  async list(me: ObjectId) { return (await this.chats.find({ userId: me }).sort({ updatedAt: -1 }).limit(100).toArray()).map((c) => this.summary(c)); }

  async get(me: ObjectId, id: string): Promise<AiChat> {
    const c = await this.own(me, id);
    const msgs = await this.msgs.find({ chatId: c._id }).sort({ _id: 1 }).limit(200).toArray();
    return { ...this.summary(c), messages: await Promise.all(msgs.map((m) => this.message(m))), quota: await this.quota(me), document: c.document ?? null };
  }

  async patch(me: ObjectId, id: string, v: { title?: string; saved?: boolean }) {
    const c = await this.own(me, id);
    const r = await this.chats.findOneAndUpdate({ _id: c._id }, { $set: { ...(v.title ? { title: v.title } : {}), ...(v.saved !== undefined ? { saved: v.saved } : {}) } }, { returnDocument: 'after' });
    return this.summary(r!);
  }

  async remove(me: ObjectId, id: string) {
    const c = await this.own(me, id);
    const files = (await this.msgs.find({ chatId: c._id, images: { $exists: true } }).toArray()).flatMap((m) => (m.images ?? []).map((i) => i.key).filter((k) => !m.sharedKeys?.includes(k)));
    await this.msgs.deleteMany({ chatId: c._id });
    await this.chats.deleteOne({ _id: c._id });
    await Promise.all(files.map((k) => this.storage.remove(k).catch(() => undefined)));
  }

  async ask(me: ObjectId, chatId: string | null, text: string, mode: AiMode, editOf?: { messageId: string; n: number }): Promise<AiReply> {
    let c = chatId ? await this.own(me, chatId) : null;
    if (editOf || mode === 'image' || (mode === 'chat' && ASKS_FOR_PICTURE.test(text))) return this.askImage(me, c, text, editOf);
    const refund = await this.take(me);
    const history = c ? (await this.msgs.find({ chatId: c._id }).sort({ _id: -1 }).limit(20).toArray()).reverse() : [];
    const turns: AiTurn[] = history.map((m) => ({ role: m.role, text: m.role === 'assistant' && m.document ? `${m.text}\n(document v${m.document.version}: ${m.document.title})` : m.images?.length ? `${m.text}\n(${m.images.length} picture${m.images.length === 1 ? '' : 's'} made)` : m.text }));
    const doc = mode === 'document' ? c?.document : undefined;
    turns.push({ role: 'user', text: doc ? `Current document:\n${doc.markdown}\n\nChange request: ${text}` : text });
    let out;
    try { out = await this.ai.complete({ system: mode === 'document' ? DOC : mode === 'search' ? SEARCH : JACK, turns, search: mode === 'search', maxTokens: mode === 'document' ? 4000 : 1500 }); }
    catch (e) { await refund(); throw e; }
    let answer = out.text, document: AiDocument | undefined, handoff = false;
    if (/\n?---JACK---\s*$/.test(answer)) { handoff = true; answer = answer.replace(/\n?---JACK---\s*$/, '').trim() || 'The full Jack’s AI can do this for you.'; }
    if (mode === 'document' && !handoff) {
      const [note, body] = answer.split(/\n?---DOCUMENT---\n?/);
      if (body?.trim()) {
        const title = /^#\s+(.+)$/m.exec(body)?.[1]?.trim().slice(0, 80) ?? 'Document';
        document = { title, markdown: body.trim(), version: (doc?.version ?? 0) + 1 };
        answer = note?.trim() || 'Done. It’s open on the right.';
      }
    }
    return this.save(me, c, text, mode, { text: answer, ...(out.sources.length ? { sources: out.sources } : {}), ...(document ? { document } : {}), ...(handoff ? { handoff } : {}) });
  }

  /** New pictures, or a change to one made earlier in this conversation. Failures don't use up today's pictures. */
  private async askImage(me: ObjectId, c: AiChatDoc | null, text: string, editOf?: { messageId: string; n: number }): Promise<AiReply> {
    if (!this.images) throw AppError.conflict('Pictures aren’t available right now.');
    let source: StoredImage | undefined;
    if (editOf) {
      const from = c ? await this.msgs.findOne({ _id: new ObjectId(editOf.messageId), chatId: c._id, userId: me }) : null;
      source = from?.images?.find((i) => i.n === editOf.n);
      if (!source) throw AppError.notFound('That picture isn’t in this conversation.');
    }
    const n = source ? 1 : this.opts.imageOptions;
    const refund = await this.takeImages(me, n);
    let made: MadeImage[];
    try {
      if (source) {
        const file = await this.storage.get(source.key);
        if (!file) throw AppError.notFound('That picture is no longer available.');
        made = [await this.images.edit({ prompt: text, image: file.data, mime: file.contentType })];
      } else made = await this.images.generate({ prompt: text, n });
    } catch (e) { await refund(); throw e; }
    // Ids in order: the question, then the answer.
    const userMsgId = new ObjectId(), botId = new ObjectId();
    const stored: StoredImage[] = await Promise.all(made.map(async (m, i) => {
      // Stored under random names (the storage only accepts that shape); the reply keeps the list.
      const key = `ai/${me.toHexString()}/img-${randomBytes(9).toString('base64url')}.png`;
      await this.storage.put(key, m.png, 'image/png');
      return { n: i + 1, key, width: m.width, height: m.height, size: m.png.length };
    }));
    const answer = source ? `Here’s number ${editOf!.n} with your change.` : stored.length > 1 ? `Here are ${stored.length} options. Tap one to see it big, or ask me to change one by its number.` : 'Here it is.';
    return this.save(me, c, text, 'image', { text: answer, images: stored }, { userMsgId, botId, ...(source ? { editOf: { messageId: new ObjectId(editOf!.messageId), n: editOf!.n } } : {}) });
  }

  private async save(me: ObjectId, c: AiChatDoc | null, text: string, mode: AiMode, reply: Pick<AiMsgDoc, 'text'> & Partial<Pick<AiMsgDoc, 'sources' | 'document' | 'images' | 'handoff'>>, o: { userMsgId?: ObjectId; botId?: ObjectId; editOf?: AiMsgDoc['editOf'] } = {}): Promise<AiReply> {
    const now = new Date();
    if (!c) {
      c = { _id: new ObjectId(), userId: me, title: text.replace(/\s+/g, ' ').slice(0, 60), saved: false, mode, createdAt: now, updatedAt: now };
      await this.chats.insertOne(c);
    }
    const user: AiMsgDoc = { _id: o.userMsgId ?? new ObjectId(), chatId: c._id, userId: me, role: 'user', text, mode, at: now, ...(o.editOf ? { editOf: o.editOf } : {}) };
    const bot: AiMsgDoc = { _id: o.botId ?? new ObjectId(), chatId: c._id, userId: me, role: 'assistant', mode, at: new Date(), ...reply };
    await this.msgs.insertMany([user, bot]);
    const next = await this.chats.findOneAndUpdate({ _id: c._id }, { $set: { updatedAt: bot.at, mode, ...(reply.document ? { document: reply.document } : {}) } }, { returnDocument: 'after' });
    void this.rewards.onAiQuestion(me).catch(() => undefined);
    return { chat: this.summary(next!), user: await this.message(user), assistant: await this.message(bot), quota: await this.quota(me) };
  }

  /** Sends a picture (n) or the document from one of Jack's replies into a YaysApp chat, as a normal photo or file. */
  async share(me: ObjectId, messageId: string, v: { conversationId: string; n?: number; caption: string }) {
    const m = ObjectId.isValid(messageId) ? await this.msgs.findOne({ _id: new ObjectId(messageId), userId: me, role: 'assistant' }) : null;
    if (!m) throw AppError.notFound('That reply isn’t there any more.');
    let att: StoredAttachment, caption: string;
    if (v.n !== undefined) {
      const img = m.images?.find((i) => i.n === v.n);
      if (!img) throw AppError.notFound('That picture isn’t in this reply.');
      att = { kind: 'image', key: img.key, name: `jacks-ai-${v.n}.png`, size: img.size, mime: 'image/png', width: img.width, height: img.height };
      caption = v.caption || 'Made with Jack’s AI';
    } else if (m.document) {
      const name = `${m.document.title.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'Document'}.doc`;
      const data = Buffer.from(`\ufeff${docHtml(m.document.title, m.document.markdown)}`);
      const key = `ai/${me.toHexString()}/doc-${randomBytes(9).toString('base64url')}.doc`;
      await this.storage.put(key, data, 'application/msword');
      att = { kind: 'file', key, name, size: data.length, mime: 'application/msword' };
      caption = v.caption || `${m.document.title} · made with Jack’s AI`;
    } else throw AppError.validation('There’s no picture or document in this reply to send.');
    // Throws if I can't post in that chat (not a member, blocked, admins only…).
    const r = await this.chat.send(me, v.conversationId, `ai-${m._id.toHexString()}-${v.n ?? 'doc'}-${Date.now()}`, caption, { trustedAttachment: att });
    if (att.kind === 'image') await this.msgs.updateOne({ _id: m._id }, { $addToSet: { sharedKeys: att.key } });
    return { messageId: r.message.id, conversationId: r.message.conversationId };
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
    const rows = (await this.chat.msgs.find({ convId: c._id, type: 'text', deletedAt: { $exists: false }, seq: { $gt: from, $lte: untilSeq } }).sort({ seq: -1 }).limit(200).toArray())
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

import { randomInt } from 'crypto';
import { ObjectId, type Collection, type Db } from 'mongodb';
import { ErrorCode, PAY_LIMITS, type PaymentView, type WalletTx } from '@yays/shared';
import { AppError } from '../common/app-error';
import { C } from '../infra/mongo';
import type { RateLimiter } from '../infra/rate-limit';
import { hashPin, pinMatches } from '../auth/auth.service';
import { isDup, type ChatService, type ConversationDoc, type PaymentSnap } from '../chat/chat.service';
import { displayNameOf, type UserDoc } from '../users/users.repo';
import type { IndexxService } from '../indexx/indexx.service';

interface PaymentDoc extends PaymentSnap { _id: ObjectId; convId: ObjectId; msgId: ObjectId; clientId: string; createdAt: Date; settledAt?: Date }

const usd = (c: number) => `$${(c / 100).toFixed(2)}`;
const WEAK = new Set(['000000', '111111', '123456', '654321', '121212', '222222', '333333', '444444', '555555', '666666', '777777', '888888', '999999', '112233']);

/**
 * Pay in chat: USDXX moves between the two people's Indexx Pay accounts. YaysApp keeps the record and shows it
 * in the chat as a card; the money itself is only ever moved by Indexx.
 */
export class PaymentsService {
  readonly col: Collection<PaymentDoc>;
  readonly users: Collection<UserDoc>;
  constructor(private readonly chat: ChatService, private readonly indexx: IndexxService, private readonly limiter: RateLimiter, db: Db) {
    this.col = db.collection(C.payments);
    this.users = db.collection(C.users);
  }

  async setPin(me: ObjectId, pin: string, current?: string) {
    if (WEAK.has(pin)) throw AppError.validation('That PIN is too easy to guess. Pick another.');
    const u = await this.users.findOne({ _id: me }, { projection: { 'yc.payPin': 1 } });
    const old = (u?.yc as { payPin?: { hash: string; salt: string } } | undefined)?.payPin;
    if (old) await this.checkPin(me, current ?? '', 'Enter your current payment PIN to change it.');
    await this.users.updateOne({ _id: me }, { $set: { 'yc.payPin': await hashPin(pin) } });
    return { hasPayPin: true as const };
  }

  private async checkPin(me: ObjectId, pin: string, missing = 'Set a payment PIN first.') {
    const u = await this.users.findOne({ _id: me }, { projection: { 'yc.payPin': 1 } });
    const stored = (u?.yc as { payPin?: { hash: string; salt: string } } | undefined)?.payPin;
    if (!stored) throw new AppError(400, ErrorCode.VALIDATION, missing, { needPin: true });
    await this.limiter.hit(`paypin:${me.toHexString()}`, 5, 900, 'Too many wrong PINs. Wait 15 minutes and try again.');
    if (!/^\d{6}$/.test(pin) || !(await pinMatches(pin, stored))) throw AppError.validation('Wrong payment PIN.');
    await this.limiter.reset(`paypin:${me.toHexString()}`);
  }

  /** Money only goes between two people in a direct chat. */
  private async peerOf(me: ObjectId, convId: string): Promise<{ c: ConversationDoc; peer: UserDoc }> {
    const c = await this.chat.memberConv(convId, me);
    if (c.kind !== 'direct') throw AppError.validation('Payments work in one-to-one chats.');
    const peerId = c.members.find((m) => !m.equals(me));
    const peer = peerId ? await this.users.findOne({ _id: peerId }) : null;
    if (!peer || peer.yc?.deletedAt) throw AppError.forbidden('This account no longer exists.');
    const b = await this.chat.blockState(me, peer._id);
    if (b.iBlocked || b.theyBlocked) throw AppError.forbidden('You can’t send money to this person.');
    return { c, peer };
  }

  private async accounts(payer: ObjectId, payee: UserDoc) {
    const [from, to] = await Promise.all([this.indexx.accountOf(payer), this.indexx.accountOf(payee._id)]);
    if (!from) throw AppError.validation('Link your Indexx account to pay with USDXX (Settings › Indexx account).');
    if (!to) throw AppError.validation(`${displayNameOf(payee).split(/\s+/)[0]} hasn’t linked an Indexx account yet, so they can’t receive USDXX.`);
    return { from, to };
  }

  private snap(d: PaymentDoc): PaymentView {
    const status = d.status === 'waiting' && d.expiresAt && d.expiresAt < new Date() ? 'expired' : d.status;
    return { id: d._id.toHexString(), kind: d.kind, fromId: d.fromId.toHexString(), toId: d.toId.toHexString(), amountCents: d.amountCents, note: d.note, status, ref: d.ref, expiresAt: d.expiresAt?.toISOString() ?? null };
  }

  private ref() { return `YP-${randomInt(10000, 99999)}`; }
  private fallback(kind: 'request' | 'payment', cents: number, note: string) { return `${kind === 'request' ? 'Payment request' : 'Payment'}: ${usd(cents)} USDXX${note ? ` · ${note}` : ''}`; }

  async request(me: ObjectId, v: { conversationId: string; amountCents: number; note: string; clientId: string }): Promise<PaymentView> {
    const dup = await this.col.findOne({ toId: me, clientId: v.clientId });
    if (dup) return this.snap(dup);
    const { c, peer } = await this.peerOf(me, v.conversationId);
    if (!(await this.indexx.accountOf(me))) throw AppError.validation('Link your Indexx account to receive USDXX (Settings › Indexx account).');
    await this.limiter.hit(`payreq:${me.toHexString()}`, 20, 3600, 'You’ve sent a lot of requests. Try again later.');
    const id = new ObjectId();
    const snap: PaymentSnap = { id, kind: 'request', fromId: peer._id, toId: me, amountCents: v.amountCents, note: v.note, status: 'waiting', ref: this.ref(), expiresAt: new Date(Date.now() + PAY_LIMITS.requestDays * 86400_000) };
    const sent = await this.chat.send(me, c._id.toHexString(), v.clientId, this.fallback('request', v.amountCents, v.note), { payment: snap });
    const doc: PaymentDoc = { ...snap, _id: id, convId: c._id, msgId: new ObjectId(sent.message.id), createdAt: new Date(), clientId: v.clientId };
    try { await this.col.insertOne(doc); } catch (e) { if (!isDup(e)) throw e; }
    return this.snap(doc);
  }

  async send(me: ObjectId, v: { conversationId: string; amountCents: number; note: string; clientId: string; pin: string }): Promise<PaymentView> {
    const dup = await this.col.findOne({ fromId: me, clientId: v.clientId });
    if (dup) return this.snap(dup);
    const { c, peer } = await this.peerOf(me, v.conversationId);
    const acc = await this.accounts(me, peer);
    await this.checkPin(me, v.pin);
    const id = new ObjectId(), ref = this.ref();
    // The same clientId always means the same transfer, so a retry never pays twice.
    await this.indexx.provider.transfer(acc.from, acc.to, v.amountCents, `yays-${me.toHexString()}-${v.clientId}`);
    const snap: PaymentSnap = { id, kind: 'payment', fromId: me, toId: peer._id, amountCents: v.amountCents, note: v.note, status: 'sent', ref, expiresAt: null };
    const sent = await this.chat.send(me, c._id.toHexString(), v.clientId, this.fallback('payment', v.amountCents, v.note), { payment: snap });
    const doc: PaymentDoc = { ...snap, _id: id, convId: c._id, msgId: new ObjectId(sent.message.id), createdAt: new Date(), settledAt: new Date(), clientId: v.clientId };
    await this.col.insertOne(doc);
    return this.snap(doc);
  }

  private async update(d: PaymentDoc, status: PaymentDoc['status']) {
    const next = await this.col.findOneAndUpdate({ _id: d._id, status: d.status }, { $set: { status, ...(status === 'paid' ? { settledAt: new Date() } : {}) } }, { returnDocument: 'after' });
    if (!next) throw AppError.conflict('This request changed meanwhile. Refresh and try again.');
    const m = await this.chat.msgs.findOneAndUpdate({ _id: d.msgId }, { $set: { 'payment.status': status } }, { returnDocument: 'after' });
    const c = await this.chat.convs.findOne({ _id: d.convId });
    if (m && c) { const [msg] = await this.chat.present([m]); this.chat.msgEvents.messageUpdated(c.members, msg); }
    return this.snap(next);
  }

  private async mineToPay(me: ObjectId, id: string) {
    if (!ObjectId.isValid(id)) throw AppError.notFound('Request not found.');
    const d = await this.col.findOne({ _id: new ObjectId(id), kind: 'request' });
    if (!d || (!d.fromId.equals(me) && !d.toId.equals(me))) throw AppError.notFound('Request not found.');
    if (d.status === 'waiting' && d.expiresAt && d.expiresAt < new Date()) { await this.update(d, 'expired'); throw AppError.conflict('This request expired. Ask them to send a new one.'); }
    if (d.status !== 'waiting') throw AppError.conflict(d.status === 'paid' ? 'This request is already paid.' : `This request was ${d.status}.`);
    return d;
  }

  async pay(me: ObjectId, id: string, pin: string): Promise<PaymentView> {
    const d = await this.mineToPay(me, id);
    if (!d.fromId.equals(me)) throw AppError.forbidden('Only the person asked can pay this request.');
    const payee = await this.users.findOne({ _id: d.toId });
    if (!payee) throw AppError.forbidden('This account no longer exists.');
    const acc = await this.accounts(me, payee);
    await this.checkPin(me, pin);
    await this.indexx.provider.transfer(acc.from, acc.to, d.amountCents, `yays-${d._id.toHexString()}`);
    return this.update(d, 'paid');
  }

  /** The person asked declines, or the person asking cancels. */
  async decline(me: ObjectId, id: string): Promise<PaymentView> {
    const d = await this.mineToPay(me, id);
    return this.update(d, 'declined');
  }

  async activity(me: ObjectId): Promise<WalletTx[]> {
    const rows = await this.col.find({ $or: [{ fromId: me }, { toId: me }] }).sort({ _id: -1 }).limit(40).toArray();
    const ids = [...new Set(rows.flatMap((r) => [r.fromId, r.toId].map((x) => x.toHexString())))].map((x) => new ObjectId(x));
    const people = new Map((await this.users.find({ _id: { $in: ids } }).toArray()).map((u) => [u._id.toHexString(), displayNameOf(u).split(/\s+/)[0]!]));
    return rows.map((r): WalletTx => {
      const out = r.fromId.equals(me), other = people.get((out ? r.toId : r.fromId).toHexString()) ?? 'Someone';
      const st = r.status === 'waiting' && r.expiresAt && r.expiresAt < new Date() ? 'expired' : r.status;
      const base = { id: r._id.toHexString(), at: (r.settledAt ?? r.createdAt).toISOString(), amount: r.amountCents, unit: 'USDXX' as const, sub: r.note || 'USDXX' };
      if (r.kind === 'payment') return { ...base, kind: 'payment', direction: out ? 'out' : 'in', title: out ? `Sent to ${other}` : `${other} paid you`, status: out ? 'sent' : 'received' };
      // A request: `fromId` is the person asked to pay.
      if (st === 'paid') return { ...base, kind: 'request', direction: out ? 'out' : 'in', title: out ? `Paid ${other}` : `${other} paid you`, status: out ? 'sent' : 'received' };
      return { ...base, kind: 'request', direction: out ? 'out' : 'in', title: out ? `${other} asked you` : `Request to ${other}`, status: st === 'waiting' ? 'waiting' : st === 'declined' ? 'declined' : 'expired' };
    });
  }
}
export const PAYMENTS = Symbol('PAYMENTS');

import { randomBytes } from 'crypto';
import { ObjectId, type Collection, type Db } from 'mongodb';
import { AccessToken, RoomServiceClient, WebhookReceiver } from 'livekit-server-sdk';
import {
  CALL_LIMITS, ErrorCode,
  type CallHistoryItem, type CallHistoryPage, type CallJoin, type CallKind, type CallLink, type CallLinkJoin, type CallLinkPreview,
  type CallMedia, type CallOutcome, type CallPartState, type CallStatus, type CallView, type PublicProfile,
} from '@yays/shared';
import { AppError } from '../common/app-error';
import type { Logger } from '../common/logger';
import type { Config } from '../config';
import { C } from '../infra/mongo';
import { has, type ChatService, type ConversationDoc } from '../chat/chat.service';
import { displayNameOf, privacyOf, type UserDoc } from '../users/users.repo';
import { prefKey, type PushService } from '../push/push.service';

export interface CallPart { userId: ObjectId; state: CallPartState; invitedAt: Date; joinedAt?: Date; leftAt?: Date; everJoined?: boolean }
export interface CallDoc {
  _id: ObjectId; kind: CallKind; media: CallMedia; status: CallStatus;
  convId?: ObjectId; linkCode?: string; title?: string;
  createdBy: ObjectId; hosts: ObjectId[]; createdAt: Date; startedAt?: Date; endedAt?: Date; outcome?: CallOutcome;
  parts: CallPart[];
  /** People whose ring was silenced (an unknown caller): their history says "Silenced", not "Missed". */
  silenced?: ObjectId[];
}
export interface CallLinkDoc { _id: string; createdBy: ObjectId; name: string; media: CallMedia; approve: boolean; createdAt: Date; revokedAt?: Date }

/** Live events for calls; the socket layer sends them to every device of each person. */
export interface CallEvents { call(userId: ObjectId, event: 'call:ring' | 'call:update', call: CallView): void }

const RINGABLE: CallPartState[] = ['ringing', 'invited', 'silenced', 'missed', 'left', 'declined', 'busy', 'admitted'];
const newLinkCode = () => {
  const A = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return [...randomBytes(10)].map((b) => A[b % A.length]).join('');
};

/**
 * Voice and video calls. This service decides who is rung, who may join and when a call is over; the audio and
 * video go through LiveKit, which this server only hands short-lived room tokens for.
 */
export class CallsService {
  readonly calls: Collection<CallDoc>;
  readonly links: Collection<CallLinkDoc>;
  events: CallEvents = { call() {} };
  private timers = new Map<string, NodeJS.Timeout>();
  private rooms?: RoomServiceClient;
  private receiver?: WebhookReceiver;

  constructor(private readonly chat: ChatService, private readonly push: PushService, db: Db, private readonly c: Config, private readonly log: Logger) {
    this.calls = db.collection(C.calls);
    this.links = db.collection(C.callLinks);
    if (c.LIVEKIT_API_KEY && c.LIVEKIT_API_SECRET) {
      const api = c.LIVEKIT_API_URL || (c.LIVEKIT_URL ?? '').replace(/^ws/, 'http');
      if (api) this.rooms = new RoomServiceClient(api, c.LIVEKIT_API_KEY, c.LIVEKIT_API_SECRET);
      this.receiver = new WebhookReceiver(c.LIVEKIT_API_KEY, c.LIVEKIT_API_SECRET);
    }
  }

  private ready() {
    if (!this.c.LIVEKIT_URL || !this.c.LIVEKIT_API_KEY || !this.c.LIVEKIT_API_SECRET) throw new AppError(503, ErrorCode.PROVIDER_UNAVAILABLE, "Calls aren't available right now. Try again later.");
  }
  private parse(id: string) {
    if (!/^[a-f0-9]{24}$/i.test(id)) throw AppError.notFound('Call not found.');
    return new ObjectId(id);
  }
  /** The call, only for someone who is (or was) part of it. */
  private async mine(id: string, me: ObjectId) {
    const doc = await this.calls.findOne({ _id: this.parse(id), 'parts.userId': me });
    if (!doc) throw AppError.notFound('Call not found.');
    return this.expire(doc);
  }
  private part(doc: CallDoc, u: ObjectId) { return doc.parts.find((p) => p.userId.equals(u)); }
  private joined(doc: CallDoc) { return doc.parts.filter((p) => p.state === 'joined'); }

  // ---- views ----
  async views(doc: CallDoc, viewers: ObjectId[]): Promise<Map<string, CallView>> {
    const ids = doc.parts.map((p) => p.userId);
    const users = await this.chat.users.find({ _id: { $in: ids } }).toArray();
    const conv = doc.convId ? await this.chat.convs.findOne({ _id: doc.convId }, { projection: { name: 1, photoKey: 1, kind: 1 } }) : null;
    const groupPhoto = conv?.photoKey ? await this.chat.photo(conv.photoKey).catch(() => null) : null;
    const out = new Map<string, CallView>();
    for (const v of viewers) {
      const profiles = await this.chat.profilesFor(v, users);
      const prof = (id: ObjectId): PublicProfile => profiles.get(id.toHexString()) ?? { id: id.toHexString(), displayName: 'Deleted account', username: null, about: '', photoUrl: null };
      let title = doc.title ?? '', photoUrl: string | null = null;
      if (doc.kind === 'direct') { const other = doc.parts.find((p) => !p.userId.equals(v)); if (other) { const p = prof(other.userId); title = p.displayName; photoUrl = p.photoUrl; } }
      else if (doc.kind === 'group') { title = conv?.name ?? 'Group'; photoUrl = groupPhoto; }
      else if (!title) title = `${prof(doc.createdBy).displayName.split(' ')[0]}’s call`;
      // People waiting at a call link are only shown to its hosts; a silenced ring isn't shown to the caller as ringing.
      const isHost = has(doc.hosts, v);
      const parts = doc.parts.filter((p) => isHost || p.userId.equals(v) || !['waiting', 'denied'].includes(p.state));
      out.set(v.toHexString(), {
        id: doc._id.toHexString(), kind: doc.kind, media: doc.media, status: doc.status,
        conversationId: doc.convId?.toHexString() ?? null, title, photoUrl,
        createdBy: doc.createdBy.toHexString(), createdAt: doc.createdAt.toISOString(),
        startedAt: doc.startedAt?.toISOString() ?? null, endedAt: doc.endedAt?.toISOString() ?? null, outcome: doc.outcome ?? null,
        participants: parts.map((p) => {
          const pr = prof(p.userId);
          const state: CallPartState = p.state === 'silenced' && !p.userId.equals(v) ? 'ringing' : p.state;
          return { userId: pr.id, name: pr.displayName, photoUrl: pr.photoUrl, state, joinedAt: p.joinedAt?.toISOString() ?? null };
        }),
        hostIds: doc.hosts.map((h) => h.toHexString()), linkCode: doc.linkCode ?? null,
      });
    }
    return out;
  }
  async view(doc: CallDoc, viewer: ObjectId) { return (await this.views(doc, [viewer])).get(viewer.toHexString())!; }

  /** Tells everyone in the call (but not people silently rung) what changed. */
  private async broadcast(doc: CallDoc, extra: { ring?: ObjectId[] } = {}) {
    const ring = new Set((extra.ring ?? []).map((r) => r.toHexString()));
    const to = doc.parts.filter((p) => doc.status === 'ended' || p.state !== 'silenced').map((p) => p.userId);
    const views = await this.views(doc, to);
    for (const u of to) this.events.call(u, ring.has(u.toHexString()) ? 'call:ring' : 'call:update', views.get(u.toHexString())!);
  }

  private async token(doc: CallDoc, me: ObjectId): Promise<CallJoin> {
    this.ready();
    const u = await this.chat.users.findOne({ _id: me });
    const at = new AccessToken(this.c.LIVEKIT_API_KEY!, this.c.LIVEKIT_API_SECRET!, { identity: me.toHexString(), name: u ? displayNameOf(u) : 'Someone', ttl: '6h' });
    at.addGrant({ room: doc._id.toHexString(), roomJoin: true, canPublish: true, canSubscribe: true, canPublishData: true });
    return { call: await this.view(doc, me), url: this.c.LIVEKIT_URL!, token: await at.toJwt() };
  }

  /** True when this person is on another call right now. */
  private async busy(u: ObjectId, except?: ObjectId) {
    return !!(await this.calls.findOne({ status: { $ne: 'ended' }, parts: { $elemMatch: { userId: u, state: 'joined' } }, ...(except ? { _id: { $ne: except } } : {}) }, { projection: { _id: 1 } }));
  }

  // ---- starting and answering ----
  async start(me: ObjectId, convId: string, media: CallMedia): Promise<CallJoin> {
    this.ready();
    const c = await this.chat.memberConv(convId, me);
    if (c.kind === 'group' && (c as ConversationDoc & { announcements?: boolean }).announcements) throw AppError.forbidden("Calls aren't available in announcement groups.");
    if (c.kind === 'group' && !this.chat.may(c, me, 'send')) throw AppError.forbidden('Only admins can start calls in this group.');
    // A group call already going on: join it instead of starting another.
    const live = await this.calls.findOne({ convId: c._id, status: { $ne: 'ended' } });
    if (live && (await this.expire(live)).status !== 'ended') {
      if (c.kind === 'group' || this.part(live, me)) return this.accept(me, live._id.toHexString());
      throw AppError.conflict('They are on a call. Try again in a moment.');
    }
    const others = c.members.filter((m) => !m.equals(me));
    if (c.kind === 'direct') {
      const other = others[0];
      if (!other) throw AppError.forbidden("You can't call this chat.");
      const peer = await this.chat.users.findOne({ _id: other });
      if (!peer || peer.yc?.disabledAt || peer.yc?.deletedAt) throw AppError.forbidden('This person is not on YaysApp any more.');
      const { iBlocked, theyBlocked } = await this.chat.blockState(me, other);
      if (iBlocked) throw AppError.forbidden('Unblock this contact to call them.');
      if (theyBlocked) throw AppError.forbidden("You can't call this person.");
    }
    await this.leaveOthers(me);
    const now = new Date();
    const states = await this.ringStates(me, c, others);
    const doc: CallDoc = {
      _id: new ObjectId(), kind: c.kind, media, status: 'ringing', convId: c._id, createdBy: me, hosts: [me], createdAt: now,
      parts: [{ userId: me, state: 'joined', invitedAt: now, joinedAt: now, everJoined: true }, ...others.map((u) => ({ userId: u, state: states.get(u.toHexString()) ?? 'invited', invitedAt: now }))],
      silenced: others.filter((u) => states.get(u.toHexString()) === 'silenced'),
    };
    // Someone already on a call can't be rung (direct calls only; a group call just skips them).
    if (c.kind === 'direct' && others[0] && doc.parts[1]!.state === 'ringing' && await this.busy(others[0])) doc.parts[1]!.state = 'busy';
    await this.calls.insertOne(doc);
    const ring = doc.parts.filter((p) => p.state === 'ringing').map((p) => p.userId);
    if (c.kind === 'direct' && doc.parts[1]?.state === 'busy') {
      const ended = await this.finish(doc._id, 'busy');
      return this.token(ended ?? doc, me);
    }
    await this.broadcast(doc, { ring });
    this.ringPush(doc, ring);
    this.armTimer(doc._id);
    if (c.kind === 'group') this.chat.events.conversationChanged(c.members, c._id.toHexString());
    return this.token(doc, me);
  }

  /** Who gets rung: muted groups and very big groups don't ring; unknown callers can be silenced. */
  private async ringStates(me: ObjectId, c: ConversationDoc, others: ObjectId[]) {
    const out = new Map<string, CallPartState>();
    const docs = await this.chat.users.find({ _id: { $in: others } }, { projection: { 'yc.privacy': 1 } }).toArray();
    const prefs = c.kind === 'group' ? await this.push.prefs.find({ _id: { $in: others.map((u) => prefKey(c._id, u)) } }).toArray() : [];
    const contacts = new Map<string, boolean>();
    for (const d of docs) contacts.set(d._id.toHexString(), (await this.chat.contactsOf(d._id, [me])).has(me.toHexString()));
    for (const u of others) {
      const id = u.toHexString();
      const d = docs.find((x) => x._id.equals(u));
      if (c.kind === 'group' && (c.members.length > CALL_LIMITS.participants || prefs.some((p) => p.userId.equals(u) && p.mutedUntil && p.mutedUntil.getTime() > Date.now()))) { out.set(id, 'invited'); continue; }
      if (d && privacyOf(d as UserDoc).silenceUnknown && !contacts.get(id)) { out.set(id, 'silenced'); continue; }
      out.set(id, 'ringing');
    }
    return out;
  }

  private ringPush(doc: CallDoc, ring: ObjectId[]) {
    if (!ring.length) return;
    void (async () => {
      const views = await this.views(doc, ring);
      const caller = await this.chat.users.findOne({ _id: doc.createdBy });
      for (const u of ring) {
        const v = views.get(u.toHexString())!;
        await this.push.callRing(u, {
          type: 'call', callId: v.id, tag: `call:${v.id}`, url: `/calls?answer=${v.id}`,
          title: v.title, body: `${doc.kind === 'group' ? `${caller ? displayNameOf(caller).split(' ')[0] : 'Someone'} · ` : ''}Incoming ${doc.media} call`,
        });
      }
    })().catch((e) => this.log.warn({ err: e }, 'call push failed'));
  }

  private armTimer(id: ObjectId) {
    const key = id.toHexString();
    clearTimeout(this.timers.get(key));
    const t = setTimeout(() => {
      this.timers.delete(key);
      void this.calls.findOne({ _id: id }).then((d) => d && this.expire(d, true)).catch((e) => this.log.warn({ err: e }, 'call timeout failed'));
    }, this.c.CALL_RING_SECONDS * 1000 + 50);
    t.unref?.();
    this.timers.set(key, t);
  }

  /** Rings that went unanswered become missed calls; a direct call nobody answered ends. Safe to call any time. */
  private async expire(doc: CallDoc, fromTimer = false): Promise<CallDoc> {
    if (doc.status === 'ended') return doc;
    const cutoff = new Date(Date.now() - this.c.CALL_RING_SECONDS * 1000);
    const stale = doc.parts.filter((p) => (p.state === 'ringing' || p.state === 'silenced') && p.invitedAt <= cutoff);
    if (!stale.length && !fromTimer) return doc;
    if (stale.length) {
      await this.calls.updateOne({ _id: doc._id }, { $set: { 'parts.$[p].state': 'missed' } }, { arrayFilters: [{ 'p.state': { $in: ['ringing', 'silenced'] }, 'p.invitedAt': { $lte: cutoff } }] });
    }
    const fresh = (await this.calls.findOne({ _id: doc._id }))!;
    if (fresh.status !== 'ended' && this.joined(fresh).length <= 1 && !fresh.parts.some((p) => p.state === 'ringing' || p.state === 'silenced' || p.state === 'waiting')) {
      // Nobody else came: the caller is alone.
      if (fresh.kind === 'direct' || (!fresh.startedAt && fresh.kind === 'group')) return (await this.finish(fresh._id, 'missed')) ?? fresh;
    }
    if (stale.length) await this.broadcast(fresh);
    return fresh;
  }

  async accept(me: ObjectId, id: string): Promise<CallJoin> {
    this.ready();
    let doc = await this.mine(id, me);
    if (doc.status === 'ended') throw new AppError(410, ErrorCode.CONFLICT, 'This call has ended.');
    const p = this.part(doc, me)!;
    if (p.state === 'joined') return this.token(doc, me); // another device of mine, or a reconnect
    if (doc.kind === 'link' && !['admitted'].includes(p.state)) throw AppError.forbidden('Wait for the host to let you in.');
    if (!RINGABLE.includes(p.state)) throw AppError.forbidden("You can't join this call.");
    if (doc.kind === 'group') {
      const c = await this.chat.convs.findOne({ _id: doc.convId, members: me });
      if (!c) throw AppError.forbidden('You are no longer in this group.');
    }
    if (this.joined(doc).length >= CALL_LIMITS.participants) throw AppError.conflict(`This call is full (${CALL_LIMITS.participants} people).`);
    await this.leaveOthers(me, doc._id);
    const now = new Date();
    const r = await this.calls.findOneAndUpdate(
      { _id: doc._id, status: { $ne: 'ended' }, parts: { $elemMatch: { userId: me, state: { $in: RINGABLE } } } },
      { $set: { 'parts.$.state': 'joined', 'parts.$.joinedAt': now, 'parts.$.everJoined': true, status: 'active' }, $unset: { 'parts.$.leftAt': '' } },
      { returnDocument: 'after' },
    );
    if (!r) { doc = await this.mine(id, me); if (doc.status === 'ended') throw new AppError(410, ErrorCode.CONFLICT, 'This call has ended.'); return this.token(doc, me); }
    doc = r;
    if (!doc.startedAt && this.joined(doc).length >= 2) doc = (await this.calls.findOneAndUpdate({ _id: doc._id, startedAt: { $exists: false } }, { $set: { startedAt: now } }, { returnDocument: 'after' })) ?? doc;
    await this.broadcast(doc);
    if (doc.convId && doc.kind === 'group') this.convChanged(doc);
    return this.token(doc, me);
  }

  async decline(me: ObjectId, id: string) {
    const doc = await this.mine(id, me);
    if (doc.status === 'ended') return this.view(doc, me);
    const r = await this.calls.findOneAndUpdate({ _id: doc._id, parts: { $elemMatch: { userId: me, state: { $in: ['ringing', 'silenced', 'invited'] } } } }, { $set: { 'parts.$.state': 'declined' } }, { returnDocument: 'after' });
    if (!r) return this.view(doc, me);
    if (r.kind === 'direct' && !r.startedAt) return this.view((await this.finish(r._id, 'declined')) ?? r, me);
    const after = await this.settle(r);
    return this.view(after, me);
  }

  async leave(me: ObjectId, id: string) {
    const doc = await this.mine(id, me);
    if (doc.status === 'ended') return this.view(doc, me);
    const now = new Date();
    const r = await this.calls.findOneAndUpdate(
      { _id: doc._id, parts: { $elemMatch: { userId: me, state: { $in: ['joined', 'waiting', 'admitted'] } } } },
      { $set: { 'parts.$.state': 'left', 'parts.$.leftAt': now } }, { returnDocument: 'after' },
    );
    if (!r) return this.view(doc, me);
    // A direct call ends when either side hangs up.
    if (r.kind === 'direct') return this.view((await this.finish(r._id, r.startedAt ? 'completed' : 'missed')) ?? r, me);
    return this.view(await this.settle(r), me);
  }

  /** After someone leaves or declines a group or link call: it ends once nobody is left on it. */
  private async settle(doc: CallDoc) {
    const joined = this.joined(doc);
    const waiting = doc.parts.some((p) => p.state === 'waiting');
    if (!joined.length && !(doc.kind === 'link' && waiting)) return (await this.finish(doc._id, doc.startedAt ? 'completed' : 'cancelled')) ?? doc;
    // The caller alone on a group call nobody answered, with no one still being rung: over.
    if (doc.kind === 'group' && !doc.startedAt && joined.length === 1 && !doc.parts.some((p) => p.state === 'ringing' || p.state === 'silenced')) return (await this.finish(doc._id, 'missed')) ?? doc;
    await this.broadcast(doc);
    if (doc.kind === 'group') this.convChanged(doc);
    return doc;
  }

  /** Ends the call once (whoever gets here first), records it in the chat and closes the media room. */
  private async finish(id: ObjectId, why: CallOutcome): Promise<CallDoc | null> {
    const now = new Date();
    const before = await this.calls.findOne({ _id: id });
    if (!before || before.status === 'ended') return before;
    const outcome: CallOutcome = before.startedAt ? 'completed' : why === 'completed' ? (before.kind === 'direct' ? 'missed' : 'cancelled') : why;
    const doc = await this.calls.findOneAndUpdate(
      { _id: id, status: { $ne: 'ended' } },
      { $set: { status: 'ended', endedAt: now, outcome, 'parts.$[r].state': 'missed', 'parts.$[j].state': 'left', 'parts.$[j].leftAt': now, 'parts.$[w].state': 'denied' } },
      { returnDocument: 'after', arrayFilters: [{ 'r.state': { $in: ['ringing', 'silenced'] } }, { 'j.state': 'joined' }, { 'w.state': { $in: ['waiting', 'admitted'] } }] },
    );
    if (!doc) return this.calls.findOne({ _id: id });
    clearTimeout(this.timers.get(id.toHexString())); this.timers.delete(id.toHexString());
    await this.broadcast(doc);
    if (doc.convId) {
      const durationSec = doc.startedAt ? Math.round((now.getTime() - doc.startedAt.getTime()) / 1000) : 0;
      await this.chat.tx(async (s) => {
        const { c, m } = await this.chat.appendSystem(s, doc.convId!, doc.createdBy, { kind: 'call', callId: id.toHexString(), media: doc.media, outcome, durationSec, group: doc.kind === 'group' });
        return { c, m };
      }).then(async ({ c, m }) => {
        const [msg] = await this.chat.present([m]);
        this.chat.events.messageCreated(c.members, msg!);
        this.chat.events.conversationChanged(c.members, c._id.toHexString());
      }).catch((e) => this.log.warn({ err: e }, 'call message failed'));
    }
    this.push.callEnded(doc.parts.filter((p) => p.state === 'missed' || p.state === 'declined').map((p) => p.userId), id.toHexString());
    void this.rooms?.deleteRoom(id.toHexString()).catch(() => undefined);
    return doc;
  }

  private convChanged(doc: CallDoc) {
    void this.chat.convs.findOne({ _id: doc.convId }, { projection: { members: 1 } }).then((c) => { if (c) this.chat.events.conversationChanged(c.members, c._id.toHexString()); });
  }

  /** Starting or answering a call hangs up any other call I'm on. */
  private async leaveOthers(me: ObjectId, except?: ObjectId) {
    const others = await this.calls.find({ status: { $ne: 'ended' }, parts: { $elemMatch: { userId: me, state: 'joined' } }, ...(except ? { _id: { $ne: except } } : {}) }).toArray();
    for (const o of others) await this.leave(me, o._id.toHexString());
  }

  /** Ring more people into a group call (members of the group only). */
  async invite(me: ObjectId, id: string, userIds: string[]) {
    const doc = await this.mine(id, me);
    if (doc.status === 'ended') throw new AppError(410, ErrorCode.CONFLICT, 'This call has ended.');
    if (this.part(doc, me)?.state !== 'joined') throw AppError.forbidden('Join the call first.');
    if (doc.kind !== 'group') throw AppError.forbidden('Only group calls can add people. Share a call link instead.');
    const c = await this.chat.convs.findOne({ _id: doc.convId });
    const want = userIds.map((u) => new ObjectId(u)).filter((u) => c && has(c.members, u) && !u.equals(me));
    const ring = want.filter((u) => { const p = this.part(doc, u); return !p || (p.state !== 'joined'); });
    if (!ring.length) return this.view(doc, me);
    const now = new Date();
    for (const u of ring) {
      const res = await this.calls.updateOne({ _id: doc._id, 'parts.userId': u }, { $set: { 'parts.$.state': 'ringing', 'parts.$.invitedAt': now } });
      if (!res.matchedCount) await this.calls.updateOne({ _id: doc._id }, { $push: { parts: { userId: u, state: 'ringing', invitedAt: now } } });
    }
    const after = (await this.calls.findOne({ _id: doc._id }))!;
    await this.broadcast(after, { ring });
    this.ringPush(after, ring);
    this.armTimer(after._id);
    return this.view(after, me);
  }

  async get(me: ObjectId, id: string) { return this.view(await this.mine(id, me), me); }

  /** Calls ringing me or that I'm on now, for a device that just connected. */
  async live(me: ObjectId): Promise<CallView[]> {
    const docs = await this.calls.find({ status: { $ne: 'ended' }, parts: { $elemMatch: { userId: me, state: { $in: ['ringing', 'joined', 'waiting', 'admitted'] } } } }).sort({ createdAt: -1 }).limit(5).toArray();
    const out: CallView[] = [];
    for (const d of docs) { const e = await this.expire(d); if (e.status !== 'ended') out.push(await this.view(e, me)); }
    // Hosts also get calls where someone is waiting to be let in.
    const hosting = await this.calls.find({ status: { $ne: 'ended' }, hosts: me, 'parts.state': 'waiting' }).limit(5).toArray();
    for (const d of hosting) if (!out.some((o) => o.id === d._id.toHexString())) out.push(await this.view(d, me));
    return out;
  }

  // ---- history ----
  private historyItem(doc: CallDoc, me: ObjectId, v: { title: string; photoUrl: string | null }): CallHistoryItem {
    const p = this.part(doc, me);
    const out = doc.createdBy.equals(me);
    let result: CallHistoryItem['result'];
    if (doc.status !== 'ended') result = 'live';
    else if (out) result = doc.kind === 'link' ? 'answered' : doc.outcome === 'completed' ? 'answered' : doc.outcome === 'declined' ? 'declined' : doc.outcome === 'busy' ? 'busy' : doc.outcome === 'cancelled' ? 'cancelled' : 'no_answer';
    else if (p?.everJoined) result = 'answered';
    else if (p?.state === 'declined') result = 'declined';
    else if (doc.silenced?.some((x) => x.equals(me))) result = 'silenced';
    else result = 'missed';
    const end = doc.endedAt ?? new Date();
    const from = doc.kind === 'direct' ? doc.startedAt : p?.joinedAt && doc.startedAt ? new Date(Math.max(p.joinedAt.getTime(), doc.startedAt.getTime())) : p?.joinedAt;
    const durationSec = result === 'answered' && from ? Math.max(0, Math.round(((p?.leftAt && doc.kind !== 'direct' ? p.leftAt : end).getTime() - from.getTime()) / 1000)) : 0;
    const other = doc.kind === 'direct' ? doc.parts.find((x) => !x.userId.equals(me)) : undefined;
    return {
      id: doc._id.toHexString(), kind: doc.kind, media: doc.media, conversationId: doc.convId?.toHexString() ?? null,
      title: v.title, photoUrl: v.photoUrl, peerId: other?.userId.toHexString() ?? null,
      direction: out ? 'out' : 'in', result, durationSec, at: doc.createdAt.toISOString(),
    };
  }

  async history(me: ObjectId, q: { before?: string; filter?: 'all' | 'missed' | 'video'; conversationId?: string; limit?: number }): Promise<CallHistoryPage> {
    const limit = Math.min(q.limit ?? 50, 100);
    const filter: Record<string, unknown> = { 'parts.userId': me, parts: { $not: { $elemMatch: { userId: me, state: { $in: ['waiting', 'denied'] } } } } };
    if (q.before) { const d = new Date(q.before); if (!isNaN(d.getTime())) filter.createdAt = { $lt: d }; }
    if (q.conversationId) filter.convId = this.chat.parseId(q.conversationId);
    if (q.filter === 'video') filter.media = 'video';
    if (q.filter === 'missed') { filter.createdBy = { $ne: me }; filter.silenced = { $ne: me }; filter.parts = { $elemMatch: { userId: me, state: 'missed', everJoined: { $ne: true } } }; }
    // Deleting a chat or clearing it doesn't remove call history (as on WhatsApp).
    const docs = await this.calls.find(filter).sort({ createdAt: -1 }).limit(limit + 1).toArray();
    const page = docs.slice(0, limit);
    const items: CallHistoryItem[] = [];
    for (const d0 of page) { const d = await this.expire(d0); const v = await this.view(d, me); items.push(this.historyItem(d, me, v)); }
    const u = await this.chat.users.findOne({ _id: me }, { projection: { 'yc.callsSeenAt': 1 } });
    const seen = (u?.yc as { callsSeenAt?: Date } | undefined)?.callsSeenAt ?? new Date(0);
    const missed = await this.calls.countDocuments({ createdBy: { $ne: me }, status: 'ended', silenced: { $ne: me }, createdAt: { $gt: seen }, parts: { $elemMatch: { userId: me, state: 'missed', everJoined: { $ne: true } } } }, { limit: 99 });
    return { items, next: docs.length > limit ? page[page.length - 1]!.createdAt.toISOString() : null, missed };
  }
  async seen(me: ObjectId) { await this.chat.users.updateOne({ _id: me }, { $set: { 'yc.callsSeenAt': new Date() } }); }

  /** Takes calls out of my history. */
  async forget(me: ObjectId, ids: string[]) {
    await this.calls.updateMany({ _id: { $in: ids.map((i) => this.parse(i)) }, status: 'ended' }, { $pull: { parts: { userId: me } } });
  }

  // ---- call links ----
  private linkView(l: CallLinkDoc): CallLink { return { code: l._id, name: l.name, media: l.media, approve: l.approve, url: `/call/${l._id}`, createdAt: l.createdAt.toISOString() }; }
  async createLink(me: ObjectId, v: { name: string; media: CallMedia; approve: boolean }): Promise<CallLink> {
    const doc: CallLinkDoc = { _id: newLinkCode(), createdBy: me, name: v.name, media: v.media, approve: v.approve, createdAt: new Date() };
    await this.links.insertOne(doc);
    return this.linkView(doc);
  }
  async updateLink(me: ObjectId, code: string, v: { name?: string; media?: CallMedia; approve?: boolean }): Promise<CallLink> {
    const set = Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined));
    const l = await this.links.findOneAndUpdate({ _id: code, createdBy: me, revokedAt: { $exists: false } }, { $set: set }, { returnDocument: 'after' });
    if (!l) throw AppError.notFound('Call link not found.');
    return this.linkView(l);
  }
  async myLinks(me: ObjectId) { return (await this.links.find({ createdBy: me, revokedAt: { $exists: false } }).sort({ createdAt: -1 }).limit(20).toArray()).map((l) => this.linkView(l)); }
  async revokeLink(me: ObjectId, code: string) {
    const r = await this.links.updateOne({ _id: code, createdBy: me }, { $set: { revokedAt: new Date() } });
    if (!r.matchedCount) throw AppError.notFound('Call link not found.');
  }
  private async link(code: string) {
    const l = /^[A-Za-z0-9]{6,20}$/.test(code) ? await this.links.findOne({ _id: code }) : null;
    if (!l || l.revokedAt) throw AppError.notFound('This call link was reset or doesn’t exist.');
    return l;
  }
  async linkPreview(me: ObjectId, code: string): Promise<CallLinkPreview> {
    const l = await this.link(code);
    const host = await this.chat.users.findOne({ _id: l.createdBy });
    const live = await this.calls.findOne({ linkCode: code, status: { $ne: 'ended' } });
    return {
      code, name: l.name || `${host ? displayNameOf(host).split(' ')[0] : 'Someone'}’s call`, media: l.media,
      host: host ? await this.chat.profileFor(me, host) : { id: l.createdBy.toHexString(), displayName: 'Deleted account', username: null, about: '', photoUrl: null },
      live: !!live, count: live ? this.joined(live).length : 0, mine: l.createdBy.equals(me),
    };
  }

  /** Joining by link: the host and their contacts go straight in; with approval on, others wait to be let in. */
  async joinLink(me: ObjectId, code: string): Promise<CallLinkJoin> {
    this.ready();
    const l = await this.link(code);
    if (!l.createdBy.equals(me)) {
      const { iBlocked, theyBlocked } = await this.chat.blockState(me, l.createdBy);
      if (iBlocked || theyBlocked) throw AppError.forbidden("You can't join this call.");
    }
    const now = new Date();
    let doc = await this.calls.findOne({ linkCode: code, status: { $ne: 'ended' } });
    if (!doc) {
      const fresh: CallDoc = { _id: new ObjectId(), kind: 'link', media: l.media, status: 'ringing', linkCode: code, title: l.name || undefined, createdBy: l.createdBy, hosts: [l.createdBy], createdAt: now, parts: [] };
      try { await this.calls.insertOne(fresh); doc = fresh; } catch { doc = await this.calls.findOne({ linkCode: code, status: { $ne: 'ended' } }); }
      if (!doc) throw AppError.conflict('Try again.');
    }
    const p = this.part(doc, me);
    if (p?.state === 'denied') return { status: 'denied' };
    const goesIn = has(doc.hosts, me) || !l.approve || p?.state === 'admitted' || p?.state === 'joined' || p?.everJoined || (await this.chat.contactsOf(me, [l.createdBy])).has(l.createdBy.toHexString());
    if (!p) await this.calls.updateOne({ _id: doc._id, 'parts.userId': { $ne: me } }, { $push: { parts: { userId: me, state: goesIn ? 'admitted' : 'waiting', invitedAt: now } } });
    else if (goesIn && p.state !== 'joined') await this.calls.updateOne({ _id: doc._id, 'parts.userId': me }, { $set: { 'parts.$.state': 'admitted' } });
    else if (!goesIn && p.state !== 'waiting') await this.calls.updateOne({ _id: doc._id, 'parts.userId': me }, { $set: { 'parts.$.state': 'waiting', 'parts.$.invitedAt': now } });
    doc = (await this.calls.findOne({ _id: doc._id }))!;
    if (!goesIn) {
      await this.broadcast(doc);
      // The host hears about it even if they aren't on the call yet.
      if (!this.part(doc, l.createdBy)) this.events.call(l.createdBy, 'call:update', await this.view(doc, l.createdBy));
      return { status: 'waiting', call: await this.view(doc, me) };
    }
    return { status: 'joined', ...(await this.accept(me, doc._id.toHexString())) };
  }

  async admit(me: ObjectId, id: string, userId: string, allow: boolean) {
    const doc = await this.calls.findOne({ _id: this.parse(id), hosts: me });
    if (!doc) throw AppError.notFound('Call not found.');
    const u = new ObjectId(userId);
    const r = await this.calls.findOneAndUpdate({ _id: doc._id, parts: { $elemMatch: { userId: u, state: 'waiting' } } }, { $set: { 'parts.$.state': allow ? 'admitted' : 'denied' } }, { returnDocument: 'after' });
    const after = r ?? doc;
    await this.broadcast(after);
    if (!this.part(after, me)) this.events.call(me, 'call:update', await this.view(after, me));
    if (!allow && r) await this.settle(r);
    return this.view(after, me);
  }

  // ---- LiveKit webhooks: notices people whose tab closed without hanging up ----
  async webhook(body: string, auth: string | undefined) {
    if (!this.receiver) throw AppError.notFound();
    let ev;
    try { ev = await this.receiver.receive(body, auth); } catch { throw AppError.unauthenticated('Bad signature.'); }
    const room = ev.room?.name ?? '';
    if (!/^[a-f0-9]{24}$/.test(room)) return;
    const identity = ev.participant?.identity ?? '';
    if (ev.event === 'participant_left' && /^[a-f0-9]{24}$/.test(identity)) {
      const u = new ObjectId(identity);
      const doc = await this.calls.findOne({ _id: new ObjectId(room), parts: { $elemMatch: { userId: u, state: 'joined' } } });
      // Joined again within a moment (a reload): LiveKit's "left" for the old connection doesn't count.
      // Joined again (a reload, another device): LiveKit's "left" for the old connection doesn't count.
      if (doc && !(await this.stillInRoom(room, identity))) await this.leave(u, room);
    }
    if (ev.event === 'room_finished') {
      const doc = await this.calls.findOne({ _id: new ObjectId(room), status: 'active' });
      if (doc && this.joined(doc).length) for (const p of this.joined(doc)) await this.leave(p.userId, room);
    }
  }

  private async stillInRoom(room: string, identity: string) {
    try { return (await this.rooms?.listParticipants(room))?.some((p) => p.identity === identity) ?? false; } catch { return false; }
  }

  close() { for (const t of this.timers.values()) clearTimeout(t); this.timers.clear(); }
}

export const CALLS = Symbol('CALLS');

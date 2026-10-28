import { randomBytes } from 'crypto';
import { ObjectId, type ClientSession, type Collection, type Db } from 'mongodb';
import {
  DEFAULT_GROUP_SETTINGS, MAX_GROUP_MEMBERS, listNames,
  type ConversationSummary, type GroupInfo, type GroupSettings, type InvitePreview, type JoinRequest, type JoinResult, type SystemEvent,
} from '@yays/shared';
import { AppError } from '../common/app-error';
import { C } from '../infra/mongo';
import { toMessage, has, rKey, type ChatService, type ConversationDoc, type MessageDoc } from './chat.service';
import { displayNameOf, privacyOf, toPublic, type UserDoc } from '../users/users.repo';

export interface JoinRequestDoc { _id: string; convId: ObjectId; userId: ObjectId; createdAt: Date }

const PHOTO_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
/** 16 characters from a 56-letter alphabet: about 93 bits, so links can't be guessed. */
const newInviteCode = () => [...randomBytes(16)].map((b) => ALPHABET[b % ALPHABET.length]).join('');
const ids = (xs: ObjectId[]) => xs.map((x) => x.toHexString());

/** Everything about groups except plain messaging, which ChatService already does. */
export class GroupsService {
  private readonly requests: Collection<JoinRequestDoc>;
  constructor(private readonly chat: ChatService, db: Db) { this.requests = db.collection(C.joinRequests); }

  private async group(convId: string, me: ObjectId) {
    const c = await this.chat.memberConv(convId, me);
    if (c.kind !== 'group') throw AppError.notFound('Group not found.');
    return c;
  }
  /** The announcements group's members follow the community; nobody manages them here. */
  private notAnnouncements(c: ConversationDoc) {
    if (c.announcements) throw AppError.validation('This is the community’s announcements group. People join and leave it with the community.');
  }
  private requireAdmin(c: ConversationDoc, me: ObjectId) { if (!this.chat.isAdmin(c, me)) throw AppError.forbidden('Only group admins can do that.'); }

  /** People who exist, aren't turned off, and aren't me. Unknown ids are refused rather than silently dropped. */
  private async realPeople(me: ObjectId, raw: string[]) {
    const wanted = [...new Set(raw.map((x) => x.toLowerCase()))].filter((x) => x !== me.toHexString()).map((x) => new ObjectId(x));
    if (!wanted.length) return [];
    const found = await this.chat.users.find({ _id: { $in: wanted }, 'yc.disabledAt': { $exists: false } }).toArray();
    if (found.length !== wanted.length) throw AppError.validation('Some of the people you picked are not on YaysApp.');
    // People who only let their contacts add them to groups.
    const picky = found.filter((u) => privacyOf(u).groups === 'contacts');
    if (picky.length) {
      const contacts = await this.chat.contactsOf(me, picky.map((u) => u._id));
      const no = picky.filter((u) => !contacts.has(u._id.toHexString()));
      if (no.length) throw AppError.forbidden(`${listNames(no.map(displayNameOf))} can only be added by people they chat with. Send them the invite link instead.`);
    }
    return wanted;
  }

  /** Sends the new system message to everyone affected, and tells their apps the group changed. */
  private announce(c: ConversationDoc, m: MessageDoc | null, alsoTell: ObjectId[] = []) {
    const everyone = [...c.members, ...alsoTell];
    if (m) this.chat.events.messageCreated(everyone, toMessage(m));
    this.chat.events.conversationChanged(everyone, c._id.toHexString());
  }

  private async summary(c: ConversationDoc, me: ObjectId): Promise<ConversationSummary> { return (await this.chat.summaries(me, [c]))[0]; }

  async create(me: ObjectId, v: { name: string; about?: string; memberIds: string[]; settings?: { send?: 'all' | 'admins' } }): Promise<ConversationSummary> {
    const others = await this.realPeople(me, v.memberIds);
    if (!others.length) throw AppError.validation('Add at least one person to the group.');
    const now = new Date();
    const id = new ObjectId();
    const members = [me, ...others];
    const settings: GroupSettings = { ...DEFAULT_GROUP_SETTINGS, ...(v.settings?.send ? { send: v.settings.send } : {}) };
    const { c, m } = await this.chat.tx(async (s) => {
      await this.chat.convs.insertOne({ _id: id, kind: 'group', members, admins: [me], former: [], ownerId: me, name: v.name, about: v.about ?? '', photoKey: null, settings, inviteCode: null, seq: 0, lastAt: now, createdAt: now, createdBy: me }, { session: s });
      // Everyone starts from the first message (the "created" line), so it counts as unread for the people added.
      await this.chat.receipts.insertMany(members.map((u) => ({ _id: rKey(id, u), convId: id, userId: u, deliveredSeq: 0, readSeq: 0, fromSeq: 0, updatedAt: now })), { session: s });
      return this.chat.appendSystem(s, id, me, { kind: 'created', name: v.name });
    });
    this.announce(c, m);
    return this.summary(c, me);
  }

  async info(me: ObjectId, convId: string): Promise<GroupInfo> {
    const { c, member } = await this.chat.access(convId, me);
    if (c.kind !== 'group') throw AppError.notFound('Group not found.');
    // Community announcements can have thousands of members: admins first, then the first few hundred.
    const shown = c.announcements ? [...(c.admins ?? []), ...c.members.filter((u) => !has(c.admins, u))].slice(0, 300) : c.members;
    const people = await this.chat.users.find({ _id: { $in: shown } }).toArray();
    const byId = new Map(people.map((u) => [u._id.toHexString(), u]));
    const owner = c.ownerId ?? c.createdBy;
    const seen = await this.chat.profilesFor(me, people);
    const members = await Promise.all(shown.map(async (u) => {
      const doc = byId.get(u.toHexString());
      const p = doc ? seen.get(u.toHexString())! : { id: u.toHexString(), displayName: 'Deleted account', username: null, about: '', photoUrl: null };
      return { ...p, admin: this.chat.isAdmin(c, u), owner: u.equals(owner) };
    }));
    // Admins first, then by name; me first of all.
    members.sort((a, b) => Number(b.id === me.toHexString()) - Number(a.id === me.toHexString()) || Number(b.admin) - Number(a.admin) || a.displayName.localeCompare(b.displayName));
    const meta = await this.chat.groupMeta(c, me);
    return {
      ...meta, id: c._id.toHexString(), members,
      inviteCode: member && this.chat.may(c, me, 'addMembers') ? c.inviteCode ?? null : null,
      createdAt: c.createdAt.toISOString(),
      pendingRequests: member && this.chat.isAdmin(c, me) ? await this.requests.countDocuments({ convId: c._id }) : 0,
    };
  }

  async update(me: ObjectId, convId: string, v: { name?: string; about?: string; photoKey?: string | null }): Promise<ConversationSummary> {
    const c0 = await this.group(convId, me);
    if (!this.chat.may(c0, me, 'editInfo')) throw AppError.forbidden('Only admins can change this group’s name, photo and description.');
    if (v.photoKey) {
      if (!v.photoKey.startsWith(`avatars/${me.toHexString()}/`)) throw AppError.forbidden('That photo was not uploaded by you.');
      const obj = await this.chat.storage.head(v.photoKey);
      if (!obj) throw AppError.validation('The photo upload did not finish. Try again.');
      if (obj.size > 5 * 1024 * 1024 || !PHOTO_TYPES.has(obj.contentType)) throw AppError.validation('Photos must be JPG, PNG or WebP and under 5 MB.');
    }
    // One system line per kind of change, in a single transaction.
    const events: Array<[SystemEvent, Record<string, unknown>]> = [];
    if (v.name !== undefined && v.name !== c0.name) events.push([{ kind: 'renamed', name: v.name }, { name: v.name }]);
    if (v.about !== undefined && v.about !== (c0.about ?? '')) events.push([{ kind: 'about' }, { about: v.about }]);
    if (v.photoKey !== undefined && v.photoKey !== (c0.photoKey ?? null)) events.push([{ kind: 'photo', removed: v.photoKey === null }, { photoKey: v.photoKey }]);
    if (!events.length) return this.summary(c0, me);
    const out = await this.chat.tx(async (s) => {
      const made: MessageDoc[] = [];
      let c = c0;
      for (const [ev, set] of events) { const r = await this.chat.appendSystem(s, c0._id, me, ev, { $set: set }, { members: me }); c = r.c; made.push(r.m); }
      return { c, made };
    });
    for (const m of out.made) this.chat.events.messageCreated(out.c.members, toMessage(m));
    this.chat.events.conversationChanged(out.c.members, out.c._id.toHexString());
    return this.summary(out.c, me);
  }

  async setSettings(me: ObjectId, convId: string, changes: Partial<GroupSettings>): Promise<ConversationSummary> {
    const c0 = await this.group(convId, me);
    this.notAnnouncements(c0);
    this.requireAdmin(c0, me);
    const cur = this.chat.settingsOf(c0);
    const diff: Partial<GroupSettings> = {};
    for (const [k, v] of Object.entries(changes) as Array<[keyof GroupSettings, never]>) if (v !== undefined && cur[k] !== v) (diff as Record<string, unknown>)[k] = v;
    if (!Object.keys(diff).length) return this.summary(c0, me);
    const { c, m } = await this.chat.tx((s) => this.chat.appendSystem(s, c0._id, me, { kind: 'settings', changes: diff }, { $set: { settings: { ...cur, ...diff } } }, { admins: me }));
    // Turning approvals off lets everyone waiting in.
    if (diff.approveNew === false) for (const r of await this.requests.find({ convId: c._id }).toArray()) await this.approve(me, convId, r.userId.toHexString()).catch(() => undefined);
    this.announce(c, m);
    return this.summary(await this.chat.convs.findOne({ _id: c._id }) ?? c, me);
  }

  /** Adds people (or brings back former members). Admins, or everyone when the group allows it. */
  async addMembers(me: ObjectId, convId: string, raw: string[]): Promise<ConversationSummary> {
    const c0 = await this.group(convId, me);
    this.notAnnouncements(c0);
    if (!this.chat.may(c0, me, 'addMembers')) throw AppError.forbidden('Only admins can add people to this group.');
    const people = (await this.realPeople(me, raw)).filter((u) => !has(c0.members, u));
    if (!people.length) throw AppError.validation('Everyone you picked is already in the group.');
    return this.addPeople(me, c0, people, { kind: 'added', userIds: ids(people) }, me);
  }

  async addPeople(me: ObjectId, c0: ConversationDoc, people: ObjectId[], event: SystemEvent, actor: ObjectId, max = MAX_GROUP_MEMBERS) {
    const { c, m } = await this.chat.tx(async (s) => {
      const fresh = await this.chat.convs.findOne({ _id: c0._id }, { session: s });
      if (!fresh) throw AppError.notFound('Group not found.');
      const adding = people.filter((u) => !has(fresh.members, u));
      if (!adding.length) throw AppError.conflict('Already in the group.');
      if (fresh.members.length + adding.length > max) throw AppError.conflict(`A group can have up to ${max} members. This would make ${fresh.members.length + adding.length}.`);
      const r = await this.chat.appendSystem(s, c0._id, actor, event, { $addToSet: { members: { $each: adding } }, $pull: { former: { $in: adding } } });
      await this.startFrom(s, c0._id, adding, r.c.seq - 1, actor, r.c.seq);
      await this.requests.deleteMany({ convId: c0._id, userId: { $in: adding } }, { session: s });
      return r;
    });
    this.announce(c, m);
    return this.summary(c, me);
  }

  /** New and returning members see the group from the line that added them; nothing older. */
  private async startFrom(s: ClientSession, convId: ObjectId, users: ObjectId[], fromSeq: number, actor: ObjectId, seq: number) {
    const now = new Date();
    for (const u of users) {
      // Someone who joined by themselves has already seen their own "joined" line.
      const read = u.equals(actor) ? seq : fromSeq;
      await this.chat.receipts.updateOne({ _id: rKey(convId, u) },
        { $set: { fromSeq, deliveredSeq: read, readSeq: read, updatedAt: now }, $unset: { leftSeq: '' }, $setOnInsert: { convId, userId: u } }, { upsert: true, session: s });
    }
  }

  async removeMember(me: ObjectId, convId: string, userId: string): Promise<ConversationSummary> {
    const c0 = await this.group(convId, me);
    this.notAnnouncements(c0);
    this.requireAdmin(c0, me);
    const target = new ObjectId(userId);
    if (target.equals(me)) throw AppError.validation('To leave the group, use Leave group.');
    if (!has(c0.members, target)) throw AppError.notFound('That person is not in this group.');
    if (target.equals(c0.ownerId ?? c0.createdBy)) throw AppError.forbidden('The person who created the group can’t be removed.');
    return this.takeOut(me, c0, target, { kind: 'removed', userIds: [userId.toLowerCase()] }, me);
  }

  async leave(me: ObjectId, convId: string): Promise<ConversationSummary> {
    const c0 = await this.group(convId, me);
    if (c0.announcements) throw AppError.validation('To leave the announcements group, leave the community.');
    return this.takeOut(me, c0, me, { kind: 'left' }, me);
  }

  /** Moves someone from members to former members; if the last admin goes, the longest-standing member takes over. */
  async takeOut(me: ObjectId, c0: ConversationDoc, target: ObjectId, event: SystemEvent, actor: ObjectId) {
    const { c, m, promoted } = await this.chat.tx(async (s) => {
      const fresh = await this.chat.convs.findOne({ _id: c0._id, members: target }, { session: s });
      if (!fresh) throw AppError.notFound('That person is not in this group.');
      const remaining = fresh.members.filter((u) => !u.equals(target));
      const adminsLeft = (fresh.admins ?? []).filter((a) => !a.equals(target) && has(remaining, a));
      const promote = !adminsLeft.length && remaining.length ? remaining[0] : null;
      const r = await this.chat.appendSystem(s, c0._id, actor, event, {
        $pull: { members: target, admins: target },
        $addToSet: { former: target },
      }, { members: target });
      await this.chat.receipts.updateOne({ _id: rKey(c0._id, target) }, { $set: { leftSeq: r.c.seq, updatedAt: new Date() }, $setOnInsert: { convId: c0._id, userId: target, deliveredSeq: 0, readSeq: 0 } }, { upsert: true, session: s });
      if (!promote) return { ...r, promoted: null };
      const p = await this.chat.appendSystem(s, c0._id, promote, { kind: 'admin', userId: promote.toHexString(), on: true }, { $addToSet: { admins: promote } });
      return { c: p.c, m: r.m, promoted: p.m };
    });
    this.announce(c, m, [target]);
    if (promoted) this.chat.events.messageCreated(c.members, toMessage(promoted));
    return this.summary(c, me);
  }

  async setAdmin(me: ObjectId, convId: string, userId: string, on: boolean): Promise<ConversationSummary> {
    const c0 = await this.group(convId, me);
    if (c0.announcements) throw AppError.validation('Admins of the announcements group are the community’s admins.');
    this.requireAdmin(c0, me);
    const target = new ObjectId(userId);
    if (!has(c0.members, target)) throw AppError.notFound('That person is not in this group.');
    if (this.chat.isAdmin(c0, target) === on) return this.summary(c0, me);
    if (!on && target.equals(c0.ownerId ?? c0.createdBy)) throw AppError.forbidden('The person who created the group stays an admin.');
    if (!on && target.equals(me) && (c0.admins ?? []).length <= 1) throw AppError.conflict('A group needs at least one admin. Make someone else an admin first.');
    const { c, m } = await this.chat.tx((s) => this.chat.appendSystem(s, c0._id, me, { kind: 'admin', userId: userId.toLowerCase(), on }, on ? { $addToSet: { admins: target } } : { $pull: { admins: target } }, { admins: me, members: target }));
    this.announce(c, m);
    return this.summary(c, me);
  }

  /** Former members can remove the group from their list. Members have to leave first. */
  async hide(me: ObjectId, convId: string) {
    const c = await this.chat.convs.findOne({ _id: this.chat.parseId(convId), former: me });
    if (!c) {
      if (await this.chat.convs.findOne({ _id: this.chat.parseId(convId), members: me })) throw AppError.conflict('Leave the group before deleting it.');
      throw AppError.notFound('Group not found.');
    }
    await this.chat.convs.updateOne({ _id: c._id }, { $pull: { former: me } });
    await this.chat.receipts.deleteOne({ _id: rKey(c._id, me) });
    this.chat.events.conversationChanged([me], c._id.toHexString());
  }

  // ---------------- invite links ----------------
  async resetInvite(me: ObjectId, convId: string): Promise<{ inviteCode: string }> {
    const c0 = await this.group(convId, me);
    this.notAnnouncements(c0);
    if (!this.chat.may(c0, me, 'addMembers')) throw AppError.forbidden('Only admins can share an invite link for this group.');
    const code = newInviteCode();
    const hadOne = !!c0.inviteCode;
    if (hadOne) {
      const { c, m } = await this.chat.tx((s) => this.chat.appendSystem(s, c0._id, me, { kind: 'invite_reset' }, { $set: { inviteCode: code } }));
      this.announce(c, m);
    } else {
      await this.chat.convs.updateOne({ _id: c0._id }, { $set: { inviteCode: code } });
      this.chat.events.conversationChanged(c0.members, c0._id.toHexString());
    }
    return { inviteCode: code };
  }

  async revokeInvite(me: ObjectId, convId: string) {
    const c0 = await this.group(convId, me);
    if (!this.chat.may(c0, me, 'addMembers')) throw AppError.forbidden('Only admins can turn off the invite link.');
    await this.chat.convs.updateOne({ _id: c0._id }, { $set: { inviteCode: null } });
    this.chat.events.conversationChanged(c0.members, c0._id.toHexString());
  }

  private async byCode(code: string) {
    const c = await this.chat.convs.findOne({ inviteCode: code, kind: 'group' });
    if (!c) throw AppError.notFound('This invite link was reset or doesn’t exist. Ask for a new one.');
    return c;
  }

  async preview(me: ObjectId, code: string): Promise<InvitePreview> {
    const c = await this.byCode(code);
    const meta = await this.chat.groupMeta(c, me);
    return {
      code, conversationId: c._id.toHexString(), name: meta.name, about: meta.about, photoUrl: meta.photoUrl, memberCount: meta.memberCount,
      alreadyMember: has(c.members, me), needsApproval: this.chat.settingsOf(c).approveNew,
      requested: !!(await this.requests.findOne({ _id: rKey(c._id, me) })),
    };
  }

  async join(me: ObjectId, code: string): Promise<JoinResult> {
    const c = await this.byCode(code);
    if (has(c.members, me)) return { status: 'joined', conversation: await this.summary(c, me) };
    if (c.members.length >= MAX_GROUP_MEMBERS) throw AppError.conflict('This group is full.');
    if (this.chat.settingsOf(c).approveNew) {
      await this.requests.updateOne({ _id: rKey(c._id, me) }, { $setOnInsert: { convId: c._id, userId: me, createdAt: new Date() } }, { upsert: true });
      this.chat.events.conversationChanged(c.admins ?? [], c._id.toHexString());
      return { status: 'requested' };
    }
    return { status: 'joined', conversation: await this.addPeople(me, c, [me], { kind: 'joined', via: 'link' }, me) };
  }

  /** A community member joining one of its groups: straight in, or a request when the group wants approval. */
  async joinFromCommunity(me: ObjectId, c: ConversationDoc): Promise<JoinResult> {
    if (has(c.members, me)) return { status: 'joined', conversation: await this.summary(c, me) };
    if (c.members.length >= MAX_GROUP_MEMBERS) throw AppError.conflict('This group is full.');
    if (this.chat.settingsOf(c).approveNew) {
      await this.requests.updateOne({ _id: rKey(c._id, me) }, { $setOnInsert: { convId: c._id, userId: me, createdAt: new Date() } }, { upsert: true });
      this.chat.events.conversationChanged(c.admins ?? [], c._id.toHexString());
      return { status: 'requested' };
    }
    return { status: 'joined', conversation: await this.addPeople(me, c, [me], { kind: 'joined', via: 'community' }, me) };
  }
  hasRequest(convId: ObjectId, u: ObjectId) { return this.requests.findOne({ _id: rKey(convId, u) }).then((r) => !!r); }

  async cancelRequest(me: ObjectId, code: string) {
    const c = await this.byCode(code);
    await this.requests.deleteOne({ _id: rKey(c._id, me) });
    this.chat.events.conversationChanged(c.admins ?? [], c._id.toHexString());
  }

  async listRequests(me: ObjectId, convId: string): Promise<JoinRequest[]> {
    const c = await this.group(convId, me);
    this.requireAdmin(c, me);
    const rows = await this.requests.find({ convId: c._id }).sort({ createdAt: 1 }).limit(500).toArray();
    const people = new Map((await this.chat.users.find({ _id: { $in: rows.map((r) => r.userId) } }).toArray()).map((u) => [u._id.toHexString(), u]));
    const out: JoinRequest[] = [];
    for (const r of rows) { const u = people.get(r.userId.toHexString()); if (u && !u.yc?.disabledAt) out.push({ user: await this.chat.profileFor(me, u), requestedAt: r.createdAt.toISOString() }); }
    return out;
  }

  async approve(me: ObjectId, convId: string, userId: string): Promise<ConversationSummary> {
    const c = await this.group(convId, me);
    this.requireAdmin(c, me);
    const u = new ObjectId(userId);
    if (!(await this.requests.findOne({ _id: rKey(c._id, u) }))) throw AppError.notFound('That request was already handled.');
    if (has(c.members, u)) { await this.requests.deleteOne({ _id: rKey(c._id, u) }); return this.summary(c, me); }
    return this.addPeople(me, c, [u], { kind: 'joined', via: 'request' }, u);
  }

  async reject(me: ObjectId, convId: string, userId: string) {
    const c = await this.group(convId, me);
    this.requireAdmin(c, me);
    const r = await this.requests.deleteOne({ _id: rKey(c._id, new ObjectId(userId)) });
    if (!r.deletedCount) throw AppError.notFound('That request was already handled.');
    this.chat.events.conversationChanged(c.admins ?? [], c._id.toHexString());
  }
}
export const GROUPS = Symbol('GROUPS');
export type { UserDoc };

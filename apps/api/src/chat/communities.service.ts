import { randomBytes } from 'crypto';
import { ObjectId, type Collection, type Db } from 'mongodb';
import {
  COMMUNITY_LIMITS, DEFAULT_GROUP_SETTINGS, MAX_GROUP_MEMBERS,
  type CommunityGroup, type CommunityInfo, type CommunityInvitePreview, type CommunityJoinResult, type CommunityMember, type CommunityReport, type CommunitySettings, type CommunitySummary, type JoinRequest, type JoinResult,
} from '@yays/shared';
import { AppError } from '../common/app-error';
import { C } from '../infra/mongo';
import { KEY_RE } from '../infra/storage';
import { has, rKey, toMessage, type ChatService, type ConversationDoc } from './chat.service';
import type { GroupsService } from './groups.service';
import type { ReportDoc } from './safety.service';

export interface CommunityDoc {
  _id: ObjectId; name: string; about: string; photoKey: string | null;
  ownerId: ObjectId; admins: ObjectId[]; settings: CommunitySettings;
  inviteCode: string | null; announcementsId: ObjectId; memberCount: number;
  createdAt: Date; createdBy: ObjectId;
}
interface MemberDoc { _id: string; communityId: ObjectId; userId: ObjectId; joinedAt: Date }
interface RequestDoc { _id: string; communityId: ObjectId; userId: ObjectId; createdAt: Date }
interface SuggestionDoc { _id: string; communityId: ObjectId; groupId: ObjectId; by: ObjectId; at: Date }

const key = (c: ObjectId, u: ObjectId) => `${c.toHexString()}:${u.toHexString()}`;
const newInviteCode = () => randomBytes(16).toString('base64url').replace(/[-_]/g, '').slice(0, 22);

/**
 * Communities: a set of groups with shared members and an announcements group only admins post in.
 * Members join the community (by invite link, maybe with approval) and then any of its groups.
 */
export class CommunitiesService {
  readonly comms: Collection<CommunityDoc>;
  readonly members: Collection<MemberDoc>;
  readonly requests: Collection<RequestDoc>;
  readonly suggestions: Collection<SuggestionDoc>;
  constructor(private readonly chat: ChatService, private readonly groups: GroupsService, private readonly db: Db) {
    this.comms = db.collection(C.communities);
    this.members = db.collection(C.communityMembers);
    this.requests = db.collection(C.communityRequests);
    this.suggestions = db.collection(C.communitySuggestions);
  }
  private get reports() { return this.db.collection<ReportDoc>(C.reports); }

  private parseId(id: string) {
    if (!/^[a-f0-9]{24}$/i.test(id)) throw AppError.notFound('Community not found.');
    return new ObjectId(id);
  }
  /** A community I'm in (anything else is "not found"). */
  private async mine(id: string, me: ObjectId, adminOnly = false) {
    const cid = this.parseId(id);
    const [c, m] = await Promise.all([this.comms.findOne({ _id: cid }), this.members.findOne({ _id: key(cid, me) })]);
    if (!c || !m) throw AppError.notFound('Community not found.');
    const admin = has(c.admins, me);
    if (adminOnly && !admin) throw AppError.forbidden('Only community admins can do that.');
    return { c, admin };
  }
  private async checkPhoto(me: ObjectId, photoKey: string | null | undefined) {
    if (!photoKey) return;
    if (!KEY_RE.test(photoKey) || !photoKey.startsWith(`avatars/${me.toHexString()}/`)) throw AppError.forbidden('That photo was not uploaded by you.');
    const obj = await this.chat.storage.head(photoKey);
    if (!obj) throw AppError.validation('The photo upload did not finish. Try again.');
    if (obj.size > 5 * 1024 * 1024 || !['image/jpeg', 'image/png', 'image/webp'].includes(obj.contentType)) throw AppError.validation('Photos must be JPG, PNG or WebP and under 5 MB.');
  }
  private groupCount(cid: ObjectId) { return this.chat.convs.countDocuments({ communityId: cid, announcements: { $ne: true } }); }

  // ---------------- create, list, read ----------------
  async create(me: ObjectId, v: { name: string; about?: string; photoKey?: string | null; approveNew: boolean; membersSuggest: boolean; groupIds: string[]; newGroups: string[] }): Promise<CommunityInfo> {
    await this.checkPhoto(me, v.photoKey);
    if (v.groupIds.length + v.newGroups.length > COMMUNITY_LIMITS.groups) throw AppError.validation(`A community can have up to ${COMMUNITY_LIMITS.groups} groups.`);
    const linking = await Promise.all(v.groupIds.map((g) => this.linkable(me, g)));
    const now = new Date();
    const cid = new ObjectId(), annId = new ObjectId();
    await this.chat.tx(async (s) => {
      await this.comms.insertOne({ _id: cid, name: v.name, about: v.about ?? '', photoKey: v.photoKey ?? null, ownerId: me, admins: [me], settings: { approveNew: v.approveNew, membersSuggest: v.membersSuggest }, inviteCode: null, announcementsId: annId, memberCount: 1, createdAt: now, createdBy: me }, { session: s });
      await this.members.insertOne({ _id: key(cid, me), communityId: cid, userId: me, joinedAt: now }, { session: s });
      await this.chat.convs.insertOne({
        _id: annId, kind: 'group', members: [me], admins: [me], former: [], ownerId: me, name: 'Announcements', about: '', photoKey: null,
        settings: { ...DEFAULT_GROUP_SETTINGS, send: 'admins', editInfo: 'admins', addMembers: 'admins', pin: 'admins' }, inviteCode: null,
        seq: 0, lastAt: now, createdAt: now, createdBy: me, communityId: cid, announcements: true,
      }, { session: s });
      await this.chat.receipts.insertOne({ _id: rKey(annId, me), convId: annId, userId: me, deliveredSeq: 0, readSeq: 0, fromSeq: 0, updatedAt: now }, { session: s });
      await this.chat.appendSystem(s, annId, me, { kind: 'created', name: v.name });
    });
    for (const g of linking) await this.link(me, cid, v.name, g);
    for (const name of v.newGroups) await this.newGroup(me, cid, name);
    this.chat.events.conversationChanged([me], annId.toHexString());
    return this.info(me, cid.toHexString());
  }

  async list(me: ObjectId): Promise<CommunitySummary[]> {
    const rows = await this.members.find({ userId: me }).sort({ joinedAt: -1 }).limit(200).toArray();
    const comms = await this.comms.find({ _id: { $in: rows.map((r) => r.communityId) } }).toArray();
    return Promise.all(rows.map((r) => comms.find((c) => c._id.equals(r.communityId))).filter((c): c is CommunityDoc => !!c).map((c) => this.summary(me, c)));
  }

  private async summary(me: ObjectId, c: CommunityDoc): Promise<CommunitySummary> {
    const myGroups = await this.chat.convs.find({ communityId: c._id, members: me }).toArray();
    const sums = await this.chat.summaries(me, myGroups);
    return {
      id: c._id.toHexString(), name: c.name, about: c.about, photoUrl: c.photoKey ? await this.chat.photo(c.photoKey) : null,
      memberCount: c.memberCount, groupCount: await this.groupCount(c._id), role: has(c.admins, me) ? 'admin' : 'member',
      unreadChats: sums.filter((x) => x.unread > 0).length,
    };
  }

  private async groupView(me: ObjectId, g: ConversationDoc): Promise<CommunityGroup> {
    const settings = this.chat.settingsOf(g);
    return {
      id: g._id.toHexString(), name: g.name ?? 'Group', photoUrl: g.photoKey ? await this.chat.photo(g.photoKey) : null, memberCount: g.members.length,
      joined: has(g.members, me), full: !g.announcements && g.members.length >= MAX_GROUP_MEMBERS, needsApproval: !g.announcements && settings.approveNew,
      requested: !has(g.members, me) && (await this.groups.hasRequest(g._id, me)), announcements: !!g.announcements,
    };
  }

  async info(me: ObjectId, id: string): Promise<CommunityInfo> {
    const { c, admin } = await this.mine(id, me);
    const groups = await this.chat.convs.find({ communityId: c._id }).sort({ announcements: -1, lastAt: -1 }).toArray();
    const sugg = admin ? await this.suggestions.find({ communityId: c._id }).sort({ at: 1 }).toArray() : [];
    const suggGroups = sugg.length ? await this.chat.convs.find({ _id: { $in: sugg.map((s) => s.groupId) } }).toArray() : [];
    const people = sugg.length ? await this.chat.profilesFor(me, await this.chat.users.find({ _id: { $in: sugg.map((s) => s.by) } }).toArray()) : new Map();
    return {
      ...(await this.summary(me, c)),
      ownerId: c.ownerId.toHexString(), settings: c.settings, inviteCode: admin ? c.inviteCode : null, announcementsId: c.announcementsId.toHexString(),
      groups: await Promise.all(groups.map((g) => this.groupView(me, g))),
      pendingRequests: admin ? await this.requests.countDocuments({ communityId: c._id }) : 0,
      suggestions: (await Promise.all(sugg.map(async (s) => {
        const g = suggGroups.find((x) => x._id.equals(s.groupId));
        const by = people.get(s.by.toHexString());
        return g && by ? { group: await this.groupView(me, g), by, at: s.at.toISOString() } : null;
      }))).filter((x): x is NonNullable<typeof x> => !!x),
      limits: { members: COMMUNITY_LIMITS.members, groups: COMMUNITY_LIMITS.groups },
    };
  }

  async update(me: ObjectId, id: string, v: { name?: string; about?: string; photoKey?: string | null; approveNew?: boolean; membersSuggest?: boolean }): Promise<CommunityInfo> {
    const { c } = await this.mine(id, me, true);
    await this.checkPhoto(me, v.photoKey);
    const $set: Record<string, unknown> = {};
    if (v.name !== undefined) $set.name = v.name;
    if (v.about !== undefined) $set.about = v.about;
    if (v.photoKey !== undefined) $set.photoKey = v.photoKey;
    if (v.approveNew !== undefined) $set['settings.approveNew'] = v.approveNew;
    if (v.membersSuggest !== undefined) $set['settings.membersSuggest'] = v.membersSuggest;
    await this.comms.updateOne({ _id: c._id }, { $set });
    // Group headers show the community's name.
    if (v.name !== undefined) await this.tellGroups(c._id);
    return this.info(me, id);
  }
  private async tellGroups(cid: ObjectId) {
    for (const g of await this.chat.convs.find({ communityId: cid }, { projection: { members: 1 } }).toArray()) this.chat.events.conversationChanged(g.members, g._id.toHexString());
  }

  // ---------------- groups ----------------
  /** A group I'm an admin of that isn't in a community yet. */
  private async linkable(me: ObjectId, gid: string) {
    const g = await this.chat.convs.findOne({ _id: this.chat.parseId(gid), kind: 'group', members: me });
    if (!g) throw AppError.notFound('Group not found.');
    if (!this.chat.isAdmin(g, me)) throw AppError.forbidden(`Only admins of “${g.name}” can add it to a community.`);
    if (g.communityId) throw AppError.conflict(`“${g.name}” is already in a community.`);
    return g;
  }
  private async link(actor: ObjectId, cid: ObjectId, name: string, g: ConversationDoc) {
    const { c, m } = await this.chat.tx((s) => this.chat.appendSystem(s, g._id, actor, { kind: 'community', name, added: true }, { $set: { communityId: cid } }, { communityId: null }));
    this.chat.events.messageCreated(c.members, toMessage(m));
    this.chat.events.conversationChanged(c.members, c._id.toHexString());
  }
  private async newGroup(me: ObjectId, cid: ObjectId, name: string) {
    const now = new Date(), id = new ObjectId();
    await this.chat.tx(async (s) => {
      await this.chat.convs.insertOne({ _id: id, kind: 'group', members: [me], admins: [me], former: [], ownerId: me, name, about: '', photoKey: null, settings: { ...DEFAULT_GROUP_SETTINGS }, inviteCode: null, seq: 0, lastAt: now, createdAt: now, createdBy: me, communityId: cid }, { session: s });
      await this.chat.receipts.insertOne({ _id: rKey(id, me), convId: id, userId: me, deliveredSeq: 0, readSeq: 0, fromSeq: 0, updatedAt: now }, { session: s });
      await this.chat.appendSystem(s, id, me, { kind: 'created', name });
    });
    this.chat.events.conversationChanged([me], id.toHexString());
    return id;
  }

  async addGroup(me: ObjectId, id: string, v: { groupId: string } | { name: string }): Promise<CommunityInfo> {
    const { c } = await this.mine(id, me, true);
    if (await this.groupCount(c._id) >= COMMUNITY_LIMITS.groups) throw AppError.conflict(`A community can have up to ${COMMUNITY_LIMITS.groups} groups.`);
    if ('groupId' in v) await this.link(me, c._id, c.name, await this.linkable(me, v.groupId));
    else await this.newGroup(me, c._id, v.name);
    if ('groupId' in v) await this.suggestions.deleteOne({ _id: key(c._id, new ObjectId(v.groupId)) });
    return this.info(me, id);
  }

  async removeGroup(me: ObjectId, id: string, gid: string): Promise<CommunityInfo> {
    const { c } = await this.mine(id, me, true);
    const g = await this.chat.convs.findOne({ _id: this.chat.parseId(gid), communityId: c._id });
    if (!g) throw AppError.notFound('That group isn’t in this community.');
    if (g.announcements) throw AppError.validation('The announcements group can’t be removed.');
    const r = await this.chat.tx((s) => this.chat.appendSystem(s, g._id, me, { kind: 'community', name: c.name, added: false }, { $set: { communityId: null } }));
    this.chat.events.messageCreated(r.c.members, toMessage(r.m));
    this.chat.events.conversationChanged(r.c.members, g._id.toHexString());
    return this.info(me, id);
  }

  async joinGroup(me: ObjectId, id: string, gid: string): Promise<JoinResult> {
    const { c } = await this.mine(id, me);
    const g = await this.chat.convs.findOne({ _id: this.chat.parseId(gid), communityId: c._id });
    if (!g) throw AppError.notFound('That group isn’t in this community.');
    return this.groups.joinFromCommunity(me, g);
  }

  /** Members can put forward a group they run, when the community allows it. Admins decide. */
  async suggest(me: ObjectId, id: string, gid: string) {
    const { c, admin } = await this.mine(id, me);
    if (admin) { await this.addGroup(me, id, { groupId: gid }); return; }
    if (!c.settings.membersSuggest) throw AppError.forbidden('This community doesn’t take group suggestions.');
    const g = await this.linkable(me, gid);
    await this.suggestions.updateOne({ _id: key(c._id, g._id) }, { $setOnInsert: { communityId: c._id, groupId: g._id, by: me, at: new Date() } }, { upsert: true });
  }
  async declineSuggestion(me: ObjectId, id: string, gid: string) {
    const { c } = await this.mine(id, me, true);
    await this.suggestions.deleteOne({ _id: key(c._id, this.chat.parseId(gid)) });
  }
  /** Approving a suggestion links the group in (the person who suggested it is its admin). */
  async approveSuggestion(me: ObjectId, id: string, gid: string): Promise<CommunityInfo> {
    const { c } = await this.mine(id, me, true);
    const s = await this.suggestions.findOne({ _id: key(c._id, this.chat.parseId(gid)) });
    if (!s) throw AppError.notFound('That suggestion was already handled.');
    const g = await this.chat.convs.findOne({ _id: s.groupId, kind: 'group' });
    await this.suggestions.deleteOne({ _id: s._id });
    if (!g || g.communityId) throw AppError.conflict('That group can’t be added any more.');
    if (await this.groupCount(c._id) >= COMMUNITY_LIMITS.groups) throw AppError.conflict(`A community can have up to ${COMMUNITY_LIMITS.groups} groups.`);
    await this.link(me, c._id, c.name, g);
    return this.info(me, id);
  }

  // ---------------- members ----------------
  /** Joining the community puts you in its announcements group, quietly (no "joined" line for thousands of people). */
  private async addMember(c: CommunityDoc, u: ObjectId) {
    if (c.memberCount >= COMMUNITY_LIMITS.members) throw AppError.conflict('This community is full.');
    try { await this.members.insertOne({ _id: key(c._id, u), communityId: c._id, userId: u, joinedAt: new Date() }); }
    catch { return; } // already in
    await this.comms.updateOne({ _id: c._id }, { $inc: { memberCount: 1 } });
    await this.requests.deleteOne({ _id: key(c._id, u) });
    const ann = await this.chat.convs.findOneAndUpdate({ _id: c.announcementsId }, { $addToSet: { members: u }, $pull: { former: u } }, { returnDocument: 'after' });
    if (ann) {
      await this.chat.receipts.updateOne({ _id: rKey(ann._id, u) }, { $set: { fromSeq: ann.seq, deliveredSeq: ann.seq, readSeq: ann.seq, updatedAt: new Date() }, $unset: { leftSeq: '' }, $setOnInsert: { convId: ann._id, userId: u } }, { upsert: true });
      this.chat.events.conversationChanged([u], ann._id.toHexString());
    }
  }

  /** Out of the community and every one of its groups. The last admin hands over to the longest-standing member. */
  private async takeOutMember(c: CommunityDoc, u: ObjectId, actor: ObjectId) {
    for (const g of await this.chat.convs.find({ communityId: c._id, members: u }).toArray()) {
      if (g.announcements) {
        const ann = await this.chat.convs.findOneAndUpdate({ _id: g._id }, { $pull: { members: u, admins: u }, $addToSet: { former: u } }, { returnDocument: 'after' });
        if (ann) await this.chat.receipts.updateOne({ _id: rKey(ann._id, u) }, { $set: { leftSeq: ann.seq, updatedAt: new Date() } });
        this.chat.events.conversationChanged([u], g._id.toHexString());
      } else {
        await this.groups.takeOut(actor, g, u, u.equals(actor) ? { kind: 'left' } : { kind: 'removed', userIds: [u.toHexString()] }, actor).catch(() => undefined);
      }
    }
    await this.members.deleteOne({ _id: key(c._id, u) });
    let admins = c.admins.filter((a) => !a.equals(u));
    let owner = c.ownerId;
    const next = await this.members.find({ communityId: c._id }).sort({ joinedAt: 1 }).limit(1).toArray();
    if (!admins.length && next[0]) admins = [next[0].userId];
    if (owner.equals(u) && admins[0]) owner = admins[0];
    await this.comms.updateOne({ _id: c._id }, { $inc: { memberCount: -1 }, $set: { admins, ownerId: owner } });
    await this.chat.convs.updateOne({ _id: c.announcementsId }, { $set: { admins, ownerId: owner } });
  }

  /** Deleting an account: out of every community. */
  async leaveAll(me: ObjectId) {
    for (const m of await this.members.find({ userId: me }).toArray()) {
      const c = await this.comms.findOne({ _id: m.communityId });
      if (c) await this.takeOutMember(c, me, me);
    }
  }

  async leave(me: ObjectId, id: string) {
    const { c } = await this.mine(id, me);
    await this.takeOutMember(c, me, me);
  }

  async listMembers(me: ObjectId, id: string, before?: string): Promise<{ items: CommunityMember[]; next: string | null }> {
    const { c } = await this.mine(id, me);
    const filter: Record<string, unknown> = { communityId: c._id };
    if (before) { const t = Number(before); if (!Number.isFinite(t)) throw AppError.validation('That page link is not valid.'); filter.joinedAt = { $gt: new Date(t) }; }
    const rows = await this.members.find(filter).sort({ joinedAt: 1 }).limit(101).toArray();
    const page = rows.slice(0, 100);
    const seen = await this.chat.profilesFor(me, await this.chat.users.find({ _id: { $in: page.map((r) => r.userId) } }).toArray());
    return {
      items: page.map((r) => { const p = seen.get(r.userId.toHexString()); return p ? { ...p, admin: has(c.admins, r.userId), owner: c.ownerId.equals(r.userId), joinedAt: r.joinedAt.toISOString() } : null; }).filter((x): x is CommunityMember => !!x),
      next: rows.length > 100 ? String(page[page.length - 1].joinedAt.getTime()) : null,
    };
  }

  async removeMember(me: ObjectId, id: string, uid: string) {
    const { c } = await this.mine(id, me, true);
    const u = this.chat.parseId(uid);
    if (u.equals(me)) throw AppError.validation('To leave, use Exit community.');
    if (u.equals(c.ownerId)) throw AppError.forbidden('The person who created the community can’t be removed.');
    if (!(await this.members.findOne({ _id: key(c._id, u) }))) throw AppError.notFound('That person isn’t in this community.');
    await this.takeOutMember(c, u, me);
  }

  async setAdmin(me: ObjectId, id: string, uid: string, on: boolean) {
    const { c } = await this.mine(id, me, true);
    const u = this.chat.parseId(uid);
    if (!(await this.members.findOne({ _id: key(c._id, u) }))) throw AppError.notFound('That person isn’t in this community.');
    if (!on && u.equals(c.ownerId)) throw AppError.forbidden('The person who created the community stays an admin.');
    if (!on && c.admins.length <= 1 && has(c.admins, u)) throw AppError.conflict('A community needs at least one admin.');
    const update = on ? { $addToSet: { admins: u } } : { $pull: { admins: u } };
    await this.comms.updateOne({ _id: c._id }, update);
    // Community admins run the announcements group.
    const ann = await this.chat.convs.findOneAndUpdate({ _id: c.announcementsId }, update, { returnDocument: 'after' });
    if (ann) this.chat.events.conversationChanged([u], ann._id.toHexString());
  }

  // ---------------- invite links and requests ----------------
  async resetInvite(me: ObjectId, id: string) {
    const { c } = await this.mine(id, me, true);
    const inviteCode = newInviteCode();
    await this.comms.updateOne({ _id: c._id }, { $set: { inviteCode } });
    return { inviteCode };
  }
  async revokeInvite(me: ObjectId, id: string) {
    const { c } = await this.mine(id, me, true);
    await this.comms.updateOne({ _id: c._id }, { $set: { inviteCode: null } });
  }
  private async byCode(code: string) {
    const c = await this.comms.findOne({ inviteCode: code });
    if (!c) throw AppError.notFound('This invite link was reset or doesn’t exist. Ask for a new one.');
    return c;
  }
  async preview(me: ObjectId, code: string): Promise<CommunityInvitePreview> {
    const c = await this.byCode(code);
    return {
      code, id: c._id.toHexString(), name: c.name, about: c.about, photoUrl: c.photoKey ? await this.chat.photo(c.photoKey) : null,
      memberCount: c.memberCount, groupCount: await this.groupCount(c._id),
      alreadyMember: !!(await this.members.findOne({ _id: key(c._id, me) })), needsApproval: c.settings.approveNew,
      requested: !!(await this.requests.findOne({ _id: key(c._id, me) })),
    };
  }
  async join(me: ObjectId, code: string): Promise<CommunityJoinResult> {
    const c = await this.byCode(code);
    if (await this.members.findOne({ _id: key(c._id, me) })) return { status: 'joined', community: await this.info(me, c._id.toHexString()) };
    if (c.settings.approveNew) {
      await this.requests.updateOne({ _id: key(c._id, me) }, { $setOnInsert: { communityId: c._id, userId: me, createdAt: new Date() } }, { upsert: true });
      return { status: 'requested' };
    }
    await this.addMember(c, me);
    return { status: 'joined', community: await this.info(me, c._id.toHexString()) };
  }
  async cancelRequest(me: ObjectId, code: string) {
    const c = await this.byCode(code);
    await this.requests.deleteOne({ _id: key(c._id, me) });
  }
  async listRequests(me: ObjectId, id: string): Promise<JoinRequest[]> {
    const { c } = await this.mine(id, me, true);
    const rows = await this.requests.find({ communityId: c._id }).sort({ createdAt: 1 }).limit(500).toArray();
    const seen = await this.chat.profilesFor(me, await this.chat.users.find({ _id: { $in: rows.map((r) => r.userId) }, 'yc.disabledAt': { $exists: false } }).toArray());
    return rows.map((r) => { const p = seen.get(r.userId.toHexString()); return p ? { user: p, requestedAt: r.createdAt.toISOString() } : null; }).filter((x): x is JoinRequest => !!x);
  }
  async approve(me: ObjectId, id: string, uid: string | 'all') {
    const { c } = await this.mine(id, me, true);
    const rows = uid === 'all' ? await this.requests.find({ communityId: c._id }).limit(500).toArray() : await this.requests.find({ _id: key(c._id, this.chat.parseId(uid)) }).toArray();
    if (!rows.length && uid !== 'all') throw AppError.notFound('That request was already handled.');
    let fresh = c;
    for (const r of rows) { await this.addMember(fresh, r.userId); fresh = (await this.comms.findOne({ _id: c._id }))!; }
    return { approved: rows.length };
  }
  async decline(me: ObjectId, id: string, uid: string) {
    const { c } = await this.mine(id, me, true);
    const r = await this.requests.deleteOne({ _id: key(c._id, this.chat.parseId(uid)) });
    if (!r.deletedCount) throw AppError.notFound('That request was already handled.');
  }

  // ---------------- moderation (w23) ----------------
  /** Open reports about messages in this community's groups, one card per message (or per person when no message was named). */
  async reportsFor(me: ObjectId, id: string): Promise<CommunityReport[]> {
    const { c } = await this.mine(id, me, true);
    const groups = await this.chat.convs.find({ communityId: c._id }, { projection: { name: 1, announcements: 1 } }).toArray();
    const rows = await this.reports.find({ convId: { $in: groups.map((g) => g._id) }, status: 'open' }).sort({ at: -1 }).limit(500).toArray();
    const cards = new Map<string, { ids: ObjectId[]; r: ReportDoc; n: number }>();
    for (const r of rows) {
      const k = r.messageId ? r.messageId.toHexString() : `${r.convId!.toHexString()}:${r.targetUserId?.toHexString() ?? 'group'}`;
      const cur = cards.get(k);
      if (cur) { cur.n++; cur.ids.push(r._id); } else cards.set(k, { ids: [r._id], r, n: 1 });
    }
    const msgIds = [...cards.values()].map((x) => x.r.messageId ?? x.r.evidence[0]?.id).filter((x): x is ObjectId => !!x);
    const msgs = new Map((await this.chat.msgs.find({ _id: { $in: msgIds } }).toArray()).map((m) => [m._id.toHexString(), m]));
    const senders = await this.chat.profilesFor(me, await this.chat.users.find({ _id: { $in: [...cards.values()].map((x) => x.r.targetUserId).filter((x): x is ObjectId => !!x) } }).toArray());
    const out: CommunityReport[] = [];
    for (const { r, n } of cards.values()) {
      const g = groups.find((x) => x._id.equals(r.convId!));
      const mid = r.messageId ?? r.evidence[0]?.id;
      const m = mid ? msgs.get(mid.toHexString()) : undefined;
      out.push({
        id: r._id.toHexString(), reason: r.reason, reports: n, at: r.at.toISOString(),
        chat: { id: r.convId!.toHexString(), name: g?.announcements ? 'Announcements' : g?.name ?? 'Group' },
        sender: r.targetUserId ? senders.get(r.targetUserId.toHexString()) ?? null : null,
        message: m ? (await this.chat.present([m]))[0] : null,
      });
    }
    return out;
  }

  /** Delete the message for everyone, remove the person from the community, or keep it. The person is never told who reported. */
  async moderate(me: ObjectId, id: string, reportId: string, action: 'delete' | 'remove' | 'keep') {
    const { c } = await this.mine(id, me, true);
    const r = await this.reports.findOne({ _id: this.chat.parseId(reportId), status: 'open' });
    const g = r?.convId ? await this.chat.convs.findOne({ _id: r.convId, communityId: c._id }) : null;
    if (!r || !g) throw AppError.notFound('That report was already handled.');
    const mid = r.messageId ?? r.evidence[0]?.id;
    if (action === 'delete' && mid) {
      const m = await this.chat.msgs.findOneAndUpdate({ _id: mid, convId: g._id, deletedAt: { $exists: false } }, { $set: { deletedAt: new Date(), deletedBy: me, text: '', reactions: [] }, $unset: { poll: '', votes: '', mentions: '' } }, { returnDocument: 'after' });
      if (m) this.chat.msgEvents.messageUpdated(g.members, (await this.chat.present([m]))[0]);
    }
    if (action === 'remove' && r.targetUserId) {
      if (r.targetUserId.equals(c.ownerId)) throw AppError.forbidden('The person who created the community can’t be removed.');
      if (await this.members.findOne({ _id: key(c._id, r.targetUserId) })) await this.takeOutMember(c, r.targetUserId, me);
    }
    // Every open report about the same message (or person in that chat) is settled together.
    const same = r.messageId ? { messageId: r.messageId } : { convId: r.convId, targetUserId: r.targetUserId ?? { $exists: false } };
    await this.reports.updateMany({ ...same, status: 'open' }, { $set: { status: 'closed', handled: { by: me, action, at: new Date() } } });
  }
}
export const COMMUNITIES = Symbol('COMMUNITIES');

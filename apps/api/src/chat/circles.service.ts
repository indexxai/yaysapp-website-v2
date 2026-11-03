import { ObjectId, type Collection, type Db, type Filter } from 'mongodb';
import {
  CIRCLE_CATEGORIES, CIRCLE_TIMES, claimsOfficial, looksLikeOfficial, moneySchemeMatches,
  type CircleAccess, type CircleAuthor, type CircleCard, type CircleCategory, type CircleComment, type CircleDiscover, type CircleEvent, type CircleEventMini,
  type CircleFeed, type CircleMemberRow, type CirclePost, type CircleReview, type CircleRole, type CircleView, type CircleVisibility, type EventMode, type MyCircles,
  type PostReportReason, type PostStatus, type PublicProfile, type RsvpStatus,
} from '@yays/shared';
import { AppError } from '../common/app-error';
import { C } from '../infra/mongo';
import { KEY_RE } from '../infra/storage';
import { has, type ChatService } from './chat.service';
import type { CommunitiesService, CommunityDoc } from './communities.service';
import type { SafetyService } from './safety.service';

/* Circle settings live on the community document. Old communities have none of them: private, unlisted. */
export interface CircleFields { visibility?: CircleVisibility; official?: boolean; category?: CircleCategory; listed?: boolean; rules?: string[]; joinQuestion?: string | null; postApproval?: boolean }
type Circle = CommunityDoc & CircleFields;

interface PostDoc {
  _id: ObjectId; circleId: ObjectId; authorId: ObjectId; text: string; photoKeys: string[];
  status: PostStatus; removedReason?: string; pinnedAt: Date | null; likeCount: number; commentCount: number;
  answerId: ObjectId | null; flagged: boolean; createdAt: Date; editedAt: Date | null;
}
interface CommentDoc { _id: ObjectId; circleId: ObjectId; postId?: ObjectId; eventId?: ObjectId; authorId: ObjectId; text: string; parentId: ObjectId | null; answer: boolean; createdAt: Date }
interface ReportDoc { _id: string; circleId: ObjectId; postId: ObjectId; reporterId: ObjectId; targetUserId: ObjectId; reason: PostReportReason; note: string; at: Date; status: 'open' | 'closed'; handled?: { by: ObjectId; action: string; at: Date } }
interface MuteDoc { _id: string; circleId: ObjectId; userId: ObjectId; until: Date; reason: string; by: ObjectId }
/** "No" to a request, or removed: no asking again until `until`. */
export interface BarDoc { _id: string; circleId: ObjectId; userId: ObjectId; kind: 'declined' | 'removed'; until: Date; reason: string; at: Date }
interface EventDoc {
  _id: ObjectId; circleId: ObjectId; hostId: ObjectId; title: string; about: string; startsAt: Date; endsAt: Date; timeZone: string;
  mode: EventMode; place: string; onlineUrl: string | null; seats: number | null; status: 'scheduled' | 'cancelled'; cancelNote: string | null;
  change: { at: Date; was: { startsAt?: Date; endsAt?: Date; place?: string } } | null;
  recordingUrl: string | null; slidesUrl: string | null; createdAt: Date;
}
interface RsvpDoc { _id: string; eventId: ObjectId; userId: ObjectId; status: RsvpStatus; at: Date; ackAt: Date; offerUntil?: Date; rating?: number }

const key = (a: ObjectId, b: ObjectId) => `${a.toHexString()}:${b.toHexString()}`;
const DAY = 86400_000;
const ESC = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const PAGE = 20;
const IMAGE = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

const vis = (c: Circle): CircleVisibility => c.visibility ?? 'private';
const cat = (c: Circle): CircleCategory => c.category ?? 'other';

function levenshtein(a: string, b: string) {
  const d = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = d[0]!; d[0] = i;
    for (let j = 1; j <= b.length; j++) { const t = d[j]!; d[j] = Math.min(d[j]! + 1, d[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = t; }
  }
  return d[b.length]!;
}

/**
 * Circles: communities with a feed of posts, events, rules and simple moderation.
 * The chats inside a circle are its community groups, handled by CommunitiesService.
 */
export class CirclesService {
  readonly posts: Collection<PostDoc>;
  readonly comments: Collection<CommentDoc>;
  readonly likes: Collection<{ _id: string; postId: ObjectId; userId: ObjectId; at: Date }>;
  readonly reports: Collection<ReportDoc>;
  readonly mutes: Collection<MuteDoc>;
  readonly bars: Collection<BarDoc>;
  readonly events: Collection<EventDoc>;
  readonly rsvps: Collection<RsvpDoc>;
  /** Points for posting; set by the app module, never in the way of the post. */
  onPost: (author: ObjectId) => void = () => undefined;
  constructor(private readonly chat: ChatService, private readonly comm: CommunitiesService, private readonly safety: SafetyService, db: Db) {
    this.posts = db.collection(C.circlePosts);
    this.comments = db.collection(C.circleComments);
    this.likes = db.collection(C.circleLikes);
    this.reports = db.collection(C.circleReports);
    this.mutes = db.collection(C.circleMutes);
    this.bars = db.collection(C.circleBars);
    this.events = db.collection(C.circleEvents);
    this.rsvps = db.collection(C.circleRsvps);
  }
  private get circles() { return this.comm.comms as unknown as Collection<Circle>; }

  // ---------------------------------------------------------------- access
  private parseId(id: string, what = 'Circle') {
    if (!/^[a-f0-9]{24}$/i.test(id)) throw AppError.notFound(`${what} not found.`);
    return new ObjectId(id);
  }
  private async membership(c: Circle, me: ObjectId) { return this.comm.members.findOne({ _id: key(c._id, me) }); }
  private async officialNames() { return (await this.circles.find({ official: true }, { projection: { name: 1 } }).toArray()).map((x) => x.name); }

  /** Who I am to this circle. Hidden circles (private, unlisted) are "not found" unless I have a reason to see them. */
  async load(id: string, me: ObjectId) {
    const c = await this.circles.findOne({ _id: this.parseId(id) });
    if (!c) throw AppError.notFound('This circle isn’t available.');
    const [m, bar, req] = await Promise.all([this.membership(c, me), this.bars.findOne({ _id: key(c._id, me), until: { $gt: new Date() } }), this.liveRequest(c, me)]);
    const admin = !!m && has(c.admins, me);
    let access: CircleAccess = m ? (admin ? 'admin' : 'member') : bar ? bar.kind : req ? 'requested' : 'visitor';
    if (!m && !bar && !req && vis(c) === 'private' && !c.listed) throw AppError.notFound('This circle isn’t available.');
    if (access === 'declined' && req) access = 'requested';
    const canRead = !!m || (vis(c) === 'public' && access !== 'removed');
    return { c, m, admin, access, canRead, bar, req };
  }
  private async readable(id: string, me: ObjectId) {
    const x = await this.load(id, me);
    if (!x.canRead) throw AppError.forbidden(x.access === 'removed' ? 'You were removed from this circle.' : 'Only members can see this circle’s posts.');
    return x;
  }
  private async member(id: string, me: ObjectId, adminOnly = false) {
    const x = await this.load(id, me);
    if (!x.m) throw AppError.forbidden('Join the circle first.');
    if (adminOnly && !x.admin) throw AppError.forbidden('Only the circle’s owners can do that.');
    return x;
  }
  private async notMuted(c: Circle, me: ObjectId) {
    const mu = await this.mutes.findOne({ _id: key(c._id, me), until: { $gt: new Date() } });
    if (mu) throw AppError.forbidden(`You can’t post or comment here until ${mu.until.toUTCString().slice(0, 16)}.`);
  }
  /** A request less than a week old (older ones lapse). */
  private async liveRequest(c: Circle, me: ObjectId) {
    const r = await this.comm.requests.findOne({ _id: key(c._id, me) }) as { createdAt: Date; answer?: string } | null;
    if (!r) return null;
    if (r.createdAt.getTime() < Date.now() - CIRCLE_TIMES.requestDays * DAY) { await this.comm.requests.deleteOne({ _id: key(c._id, me) }); return null; }
    return r;
  }

  // ---------------------------------------------------------------- views
  private roleOf(c: Circle, u: ObjectId): CircleRole { return c.ownerId.equals(u) ? 'owner' : has(c.admins, u) ? 'admin' : 'member'; }
  private async authors(me: ObjectId, c: Circle, ids: ObjectId[]): Promise<Map<string, CircleAuthor>> {
    const uniq = [...new Map(ids.map((i) => [i.toHexString(), i])).values()];
    const seen = await this.chat.profilesFor(me, await this.chat.users.find({ _id: { $in: uniq } }).toArray());
    const out = new Map<string, CircleAuthor>();
    for (const u of uniq) {
      const p = seen.get(u.toHexString()) ?? { id: u.toHexString(), displayName: 'Deleted account', username: null, about: '', photoUrl: null };
      const role = this.roleOf(c, u);
      out.set(u.toHexString(), { ...p, role, official: !!c.official && role !== 'member' });
    }
    return out;
  }

  private async view(me: ObjectId, x: Awaited<ReturnType<CirclesService['load']>>): Promise<CircleView> {
    const { c } = x;
    const staff = [c.ownerId, ...c.admins.filter((a) => !a.equals(c.ownerId))].slice(0, 6);
    const owners = await this.authors(me, c, staff);
    const mute = x.m ? await this.mutes.findOne({ _id: key(c._id, me), until: { $gt: new Date() } }) : null;
    const pendingReview = x.admin ? (await this.posts.countDocuments({ circleId: c._id, status: 'pending' })) + (await this.reports.distinct('postId', { circleId: c._id, status: 'open' })).length : 0;
    return {
      id: c._id.toHexString(), name: c.name, about: c.about, photoUrl: c.photoKey ? await this.chat.photo(c.photoKey) : null, memberCount: c.memberCount,
      visibility: vis(c), official: !!c.official, category: cat(c), listed: !!c.listed, rules: c.rules ?? [], joinQuestion: c.joinQuestion ?? null, postApproval: !!c.postApproval,
      owners: staff.map((s) => owners.get(s.toHexString())!).filter(Boolean), ownerId: c.ownerId.toHexString(), createdAt: c.createdAt.toISOString(),
      access: x.access, isOwner: c.ownerId.equals(me), canRead: x.canRead,
      lookalike: !c.official && looksLikeOfficial(c.name, await this.officialNames()),
      request: x.req ? { at: x.req.createdAt.toISOString(), expiresAt: new Date(x.req.createdAt.getTime() + CIRCLE_TIMES.requestDays * DAY).toISOString(), answer: x.req.answer ?? '' } : null,
      declinedUntil: x.bar?.kind === 'declined' ? x.bar.until.toISOString() : null,
      removed: x.bar?.kind === 'removed' ? { at: x.bar.at.toISOString(), until: x.bar.until.toISOString(), reason: x.bar.reason } : null,
      muted: mute ? { until: mute.until.toISOString(), reason: mute.reason } : null,
      pendingReview,
      upcomingEvents: x.canRead ? await this.events.countDocuments({ circleId: c._id, status: 'scheduled', endsAt: { $gte: new Date() } }) : 0,
      chatCount: await this.chat.convs.countDocuments({ communityId: c._id }),
    };
  }

  async get(me: ObjectId, id: string) { return this.view(me, await this.load(id, me)); }

  private async cards(me: ObjectId, list: Circle[]): Promise<CircleCard[]> {
    if (!list.length) return [];
    const ids = list.map((c) => c._id);
    const [mems, reqs, official] = await Promise.all([
      this.comm.members.find({ _id: { $in: ids.map((i) => key(i, me)) } }).toArray() as Promise<Array<{ _id: string; communityId: ObjectId; seenAt?: Date; joinedAt: Date }>>,
      this.comm.requests.find({ _id: { $in: ids.map((i) => key(i, me)) }, createdAt: { $gt: new Date(Date.now() - CIRCLE_TIMES.requestDays * DAY) } }).toArray(),
      this.officialNames(),
    ]);
    const next = await this.nextEvents(me, ids);
    return Promise.all(list.map(async (c) => {
      const m = mems.find((x) => x.communityId.equals(c._id));
      const newPosts = m ? await this.posts.countDocuments({ circleId: c._id, status: 'live', authorId: { $ne: me }, createdAt: { $gt: m.seenAt ?? m.joinedAt } }, { limit: 99 }) : 0;
      return {
        id: c._id.toHexString(), name: c.name, about: c.about, photoUrl: c.photoKey ? await this.chat.photo(c.photoKey) : null, memberCount: c.memberCount,
        visibility: vis(c), official: !!c.official, category: cat(c),
        role: m ? (has(c.admins, me) ? 'admin' : 'member') : null,
        requested: reqs.some((r) => r.communityId.equals(c._id)),
        lookalike: !c.official && looksLikeOfficial(c.name, official),
        newPosts, nextEvent: next.get(c._id.toHexString()) ?? null,
      };
    }));
  }

  async mine(me: ObjectId): Promise<MyCircles> {
    const rows = await this.comm.members.find({ userId: me }).sort({ joinedAt: -1 }).limit(200).toArray();
    const byId = new Map((await this.circles.find({ _id: { $in: rows.map((r) => r.communityId) } }).toArray()).map((c) => [c._id.toHexString(), c]));
    const list = rows.map((r) => byId.get(r.communityId.toHexString())).filter((c): c is Circle => !!c);
    // Mine: events I said yes or maybe to, in any circle I'm in.
    const mineRs = await this.rsvps.find({ userId: me, status: { $in: ['going', 'interested', 'waitlist', 'offered'] } }).toArray();
    const evs = await this.events.find({ _id: { $in: mineRs.map((r) => r.eventId) }, circleId: { $in: list.map((c) => c._id) }, status: 'scheduled', endsAt: { $gte: new Date() } }).sort({ startsAt: 1 }).limit(5).toArray();
    return { circles: await this.cards(me, list), upcoming: await this.minis(me, evs) };
  }

  async discover(me: ObjectId, q = '', category = ''): Promise<CircleDiscover> {
    const filter: Filter<Circle> = { listed: true };
    if (category && (CIRCLE_CATEGORIES as readonly string[]).includes(category)) filter.category = category as CircleCategory;
    const words = q.toLowerCase().replace(/[^\p{L}\p{N}\s&]/gu, ' ').split(/\s+/).filter(Boolean).slice(0, 6);
    if (words.length) filter.$and = words.map((w) => ({ $or: [{ name: { $regex: ESC(w), $options: 'i' } }, { about: { $regex: ESC(w), $options: 'i' } }] }));
    const list = await this.circles.find(filter).sort({ official: -1, memberCount: -1, _id: 1 }).limit(40).toArray();
    let didYouMean: string | null = null;
    if (words.length && !list.length) {
      const vocab = new Set<string>();
      for (const c of await this.circles.find({ listed: true }, { projection: { name: 1, about: 1 } }).limit(500).toArray()) for (const w of `${c.name} ${c.about}`.toLowerCase().split(/[^\p{L}\p{N}]+/u)) if (w.length >= 3) vocab.add(w);
      let changed = false;
      const fixed = words.map((w) => {
        if (vocab.has(w) || w.length < 4) return w;
        let best = w, bd = 3;
        for (const v of vocab) { if (Math.abs(v.length - w.length) > 2) continue; const d = levenshtein(w, v); if (d < bd) { bd = d; best = v; } }
        if (best !== w) changed = true;
        return best;
      });
      if (changed) didYouMean = fixed.join(' ');
    }
    const cards = await this.cards(me, list);
    const browsing = !words.length && !category;
    const featured = browsing ? cards.find((x) => x.official) ?? null : null;
    let featuredEvent: CircleEventMini | null = null;
    if (browsing) {
      const pub = await this.circles.find({ listed: true, visibility: 'public' }, { projection: { _id: 1 } }).limit(500).toArray();
      const ev = await this.events.find({ circleId: { $in: pub.map((p) => p._id) }, status: 'scheduled', startsAt: { $gte: new Date() } }).sort({ startsAt: 1 }).limit(20).toArray();
      const minis = await this.minis(me, ev);
      featuredEvent = minis.sort((a, b) => b.going - a.going)[0] ?? null;
    }
    return { items: featured ? cards.filter((x) => x.id !== featured.id) : cards, featured, featuredEvent, didYouMean };
  }

  // ---------------------------------------------------------------- create, settings, join, leave
  private checkName(name: string, official: boolean) {
    if (!official && claimsOfficial(name)) throw AppError.validation('Only circles YaysApp has checked can call themselves “official”. Pick another name.');
  }
  async create(me: ObjectId, v: { name: string; about: string; photoKey?: string | null; visibility: CircleVisibility; category: CircleCategory; listed: boolean; rules: string[]; joinQuestion?: string | null; postApproval: boolean }): Promise<CircleView> {
    this.checkName(v.name, false);
    const info = await this.comm.create(me, { name: v.name, about: v.about, photoKey: v.photoKey ?? null, approveNew: v.visibility === 'private', membersSuggest: false, groupIds: [], newGroups: [] });
    const extra: CircleFields = { visibility: v.visibility, category: v.category, listed: v.listed, rules: v.rules, joinQuestion: v.visibility === 'private' ? v.joinQuestion || null : null, postApproval: v.postApproval, official: false };
    await this.circles.updateOne({ _id: new ObjectId(info.id) }, { $set: extra });
    return this.get(me, info.id);
  }

  async update(me: ObjectId, id: string, v: { name?: string; about?: string; photoKey?: string | null; visibility?: CircleVisibility; category?: CircleCategory; listed?: boolean; rules?: string[]; joinQuestion?: string | null; postApproval?: boolean }) {
    const { c } = await this.member(id, me, true);
    if (v.name !== undefined) this.checkName(v.name, !!c.official);
    if (v.name !== undefined || v.about !== undefined || v.photoKey !== undefined || v.visibility !== undefined) {
      await this.comm.update(me, id, { name: v.name, about: v.about, photoKey: v.photoKey, approveNew: v.visibility === undefined ? undefined : v.visibility === 'private' });
    }
    const $set: Record<string, unknown> = {};
    for (const k of ['visibility', 'category', 'listed', 'rules', 'joinQuestion', 'postApproval'] as const) if (v[k] !== undefined) $set[k] = v[k];
    if (Object.keys($set).length) await this.circles.updateOne({ _id: c._id }, { $set });
    return this.get(me, id);
  }

  /** Public: in at once. Private: a request with the owners' question answered. */
  async join(me: ObjectId, id: string, answer?: string): Promise<CircleView> {
    const x = await this.load(id, me);
    if (x.m) return this.view(me, x);
    if (x.bar) throw AppError.forbidden(x.bar.kind === 'removed' ? 'You were removed from this circle. You can ask to join again later.' : 'The owners said no. You can ask again later.');
    const c = x.c;
    if (vis(c) === 'private') {
      if (c.joinQuestion && !answer?.trim()) throw AppError.validation('Answer the owners’ question first.');
      await this.comm.requests.updateOne({ _id: key(c._id, me) }, { $set: { communityId: c._id, userId: me, createdAt: new Date(), answer: answer?.trim() ?? '' } }, { upsert: true });
    } else {
      await this.comm.addMemberPublic(c, me);
    }
    return this.get(me, id);
  }
  async cancelRequest(me: ObjectId, id: string) {
    const { c } = await this.load(id, me);
    await this.comm.requests.deleteOne({ _id: key(c._id, me) });
    return this.get(me, id);
  }
  /** The only owner can't just leave: they pick someone first (another admin takes over automatically). */
  async leave(me: ObjectId, id: string) {
    const { c } = await this.member(id, me);
    if (c.ownerId.equals(me) && c.memberCount > 1 && !c.admins.some((a) => !a.equals(me))) throw AppError.conflict('Pick a new owner before you leave.');
    await this.comm.leave(me, id);
  }
  async setOwner(me: ObjectId, id: string, uid: string) {
    const { c } = await this.member(id, me);
    if (!c.ownerId.equals(me)) throw AppError.forbidden('Only the owner can hand the circle over.');
    const u = this.parseId(uid, 'Person');
    if (u.equals(me)) throw AppError.validation('You already own it.');
    if (!(await this.membership(c, u))) throw AppError.notFound('That person isn’t in this circle.');
    await this.circles.updateOne({ _id: c._id }, { $set: { ownerId: u }, $addToSet: { admins: u } });
    await this.chat.convs.updateOne({ _id: c.announcementsId }, { $set: { ownerId: u }, $addToSet: { admins: u } });
    return this.get(me, id);
  }
  /** Owner only. Its chats stay as ordinary groups. */
  async remove(me: ObjectId, id: string) {
    const { c } = await this.member(id, me);
    if (!c.ownerId.equals(me)) throw AppError.forbidden('Only the owner can delete the circle.');
    const evIds = (await this.events.find({ circleId: c._id }, { projection: { _id: 1 } }).toArray()).map((e) => e._id);
    const postIds = (await this.posts.find({ circleId: c._id }, { projection: { _id: 1 } }).toArray()).map((p) => p._id);
    const groups = await this.chat.convs.find({ communityId: c._id }, { projection: { members: 1 } }).toArray();
    await this.chat.convs.updateMany({ communityId: c._id }, { $unset: { communityId: '', announcements: '' } });
    await Promise.all([
      this.posts.deleteMany({ circleId: c._id }), this.comments.deleteMany({ circleId: c._id }), this.likes.deleteMany({ postId: { $in: postIds } }),
      this.reports.deleteMany({ circleId: c._id }), this.mutes.deleteMany({ circleId: c._id }), this.bars.deleteMany({ circleId: c._id }),
      this.events.deleteMany({ circleId: c._id }), this.rsvps.deleteMany({ eventId: { $in: evIds } }),
      this.comm.members.deleteMany({ communityId: c._id }), this.comm.requests.deleteMany({ communityId: c._id }), this.comm.suggestions.deleteMany({ communityId: c._id }),
    ]);
    await this.circles.deleteOne({ _id: c._id });
    for (const g of groups) this.chat.events.conversationChanged(g.members, g._id.toHexString());
  }

  async membersOf(me: ObjectId, id: string): Promise<CircleMemberRow[]> {
    const { c } = await this.member(id, me);
    const rows = await this.comm.members.find({ communityId: c._id }).sort({ joinedAt: 1 }).limit(500).toArray();
    const people = await this.authors(me, c, rows.map((r) => r.userId));
    const mutes = await this.mutes.find({ circleId: c._id, until: { $gt: new Date() } }).toArray();
    const order: Record<CircleRole, number> = { owner: 0, admin: 1, member: 2 };
    return rows.map((r) => { const p = people.get(r.userId.toHexString())!; const mu = mutes.find((x) => x.userId.equals(r.userId)); return { ...p, joinedAt: r.joinedAt.toISOString(), mutedUntil: mu ? mu.until.toISOString() : null }; })
      .map(({ official: _o, ...rest }) => rest).sort((a, b) => order[a.role] - order[b.role]);
  }
  async mute(me: ObjectId, id: string, uid: string, days: number, reason: string) {
    const { c } = await this.member(id, me, true);
    const u = this.parseId(uid, 'Person');
    if (has(c.admins, u)) throw AppError.forbidden('Owners can’t be muted.');
    if (!(await this.membership(c, u))) throw AppError.notFound('That person isn’t in this circle.');
    await this.mutes.updateOne({ _id: key(c._id, u) }, { $set: { circleId: c._id, userId: u, until: new Date(Date.now() + days * DAY), reason, by: me } }, { upsert: true });
  }
  async unmute(me: ObjectId, id: string, uid: string) {
    const { c } = await this.member(id, me, true);
    await this.mutes.deleteOne({ _id: key(c._id, this.parseId(uid, 'Person')) });
  }
  /** Removed people can't see the circle or ask back in for a while; they're told why. */
  async removeMember(me: ObjectId, id: string, uid: string, reason: string) {
    const { c } = await this.member(id, me, true);
    await this.comm.removeMember(me, id, uid);
    await this.bars.updateOne({ _id: key(c._id, new ObjectId(uid)) }, { $set: { reason } });
  }

  // ---------------------------------------------------------------- posts
  private async checkPhotos(me: ObjectId, keys: string[]) {
    for (const k of keys) {
      if (!KEY_RE.test(k) || !k.startsWith(`media/${me.toHexString()}/`)) throw AppError.forbidden('That photo was not uploaded by you.');
      const o = await this.chat.storage.head(k);
      if (!o) throw AppError.validation('A photo didn’t finish uploading. Try again.');
      if (!IMAGE.includes(o.contentType)) throw AppError.validation('Only photos can be added to posts.');
    }
  }
  private flagCheck(text: string) {
    const m = moneySchemeMatches(text);
    if (m.length) throw AppError.validation('This looks like an investment offer. Circles don’t allow promising profits or asking people for money.', { reason: 'money_scheme', matches: m });
  }

  private async present(me: ObjectId, c: Circle, docs: PostDoc[], admin: boolean): Promise<CirclePost[]> {
    if (!docs.length) return [];
    const ids = docs.map((d) => d._id);
    const [authors, liked, reported, blocked, answers] = await Promise.all([
      this.authors(me, c, docs.map((d) => d.authorId)),
      this.likes.find({ _id: { $in: ids.map((i) => key(i, me)) } }).toArray(),
      this.reports.find({ reporterId: me, postId: { $in: ids }, status: 'open' }).toArray(),
      this.chat.blockedEitherWay(me, docs.map((d) => d.authorId)),
      this.comments.find({ _id: { $in: docs.map((d) => d.answerId).filter((x): x is ObjectId => !!x) } }).toArray(),
    ]);
    const answerBy = await this.authors(me, c, answers.map((a) => a.authorId));
    return Promise.all(docs.map(async (d) => {
      const hidden = blocked.has(d.authorId.toHexString()) ? 'blocked' as const : reported.some((r) => r.postId.equals(d._id)) ? 'reported' as const : null;
      const a = d.answerId ? answers.find((x) => x._id.equals(d.answerId!)) : undefined;
      const showText = hidden !== 'blocked' && (d.status !== 'removed' || d.authorId.equals(me) || admin);
      return {
        id: d._id.toHexString(), circleId: c._id.toHexString(), author: authors.get(d.authorId.toHexString())!,
        text: showText ? d.text : '', photos: showText ? await Promise.all(d.photoKeys.map((k) => this.chat.photo(k))) : [],
        createdAt: d.createdAt.toISOString(), editedAt: d.editedAt?.toISOString() ?? null,
        status: d.status, removedReason: d.status === 'removed' ? d.removedReason ?? '' : null,
        pinned: !!d.pinnedAt, likes: d.likeCount, liked: liked.some((l) => l._id === key(d._id, me)), comments: d.commentCount, mine: d.authorId.equals(me),
        answer: a ? { by: answerBy.get(a.authorId.toHexString())?.displayName ?? 'Owner', text: a.text } : null,
        hidden,
      };
    }));
  }

  /** Newest first, pinned posts on top of the first page. I also see my own posts waiting for approval or taken down. */
  async feed(me: ObjectId, id: string, before?: string): Promise<CircleFeed> {
    const { c, m, admin } = await this.readable(id, me);
    const vis: Filter<PostDoc> = { circleId: c._id, $or: [{ status: 'live' }, { authorId: me, status: { $in: ['pending', 'removed'] } }] };
    const filter: Filter<PostDoc> = { ...vis };
    let pinned: PostDoc[] = [];
    if (before) {
      const [t, pid] = before.split('_');
      if (!t || !pid || !Number.isFinite(Number(t)) || !/^[a-f0-9]{24}$/.test(pid)) throw AppError.validation('That page link is not valid.');
      const at = new Date(Number(t));
      filter.$and = [{ $or: [{ createdAt: { $lt: at } }, { createdAt: at, _id: { $lt: new ObjectId(pid) } }] }, { pinnedAt: null }];
    } else {
      pinned = await this.posts.find({ ...vis, pinnedAt: { $ne: null }, status: 'live' }).sort({ pinnedAt: -1 }).limit(3).toArray();
      filter._id = { $nin: pinned.map((p) => p._id) };
      if (m) await this.comm.members.updateOne({ _id: m._id }, { $set: { seenAt: new Date() } });
    }
    const rows = await this.posts.find(filter).sort({ createdAt: -1, _id: -1 }).limit(PAGE + 1).toArray();
    const page = rows.slice(0, PAGE);
    const last = page[page.length - 1];
    return { items: await this.present(me, c, [...pinned, ...page], admin), next: rows.length > PAGE && last ? `${last.createdAt.getTime()}_${last._id.toHexString()}` : null };
  }

  async createPost(me: ObjectId, id: string, v: { text: string; photoKeys: string[]; send: 'normal' | 'review' }) {
    const { c, admin } = await this.member(id, me);
    await this.notMuted(c, me);
    await this.checkPhotos(me, v.photoKeys);
    const flagged = moneySchemeMatches(v.text).length > 0;
    if (flagged && v.send !== 'review') this.flagCheck(v.text);
    const status: PostStatus = flagged || (c.postApproval && !admin) ? 'pending' : 'live';
    const now = new Date();
    const d: PostDoc = { _id: new ObjectId(), circleId: c._id, authorId: me, text: v.text, photoKeys: v.photoKeys, status, pinnedAt: null, likeCount: 0, commentCount: 0, answerId: null, flagged, createdAt: now, editedAt: null };
    await this.posts.insertOne(d);
    if (status === 'live') { await this.comm.members.updateOne({ _id: key(c._id, me) }, { $set: { seenAt: now } }); this.onPost(me); }
    return (await this.present(me, c, [d], admin))[0]!;
  }

  private async postCtx(me: ObjectId, pid: string, needMember = false) {
    const p = await this.posts.findOne({ _id: this.parseId(pid, 'Post') });
    if (!p) throw AppError.notFound('That post was deleted.');
    const x = needMember ? await this.member(p.circleId.toHexString(), me) : await this.readable(p.circleId.toHexString(), me);
    if (p.status !== 'live' && !p.authorId.equals(me) && !x.admin) throw AppError.notFound('That post was deleted.');
    return { p, ...x };
  }
  async getPost(me: ObjectId, pid: string) { const { p, c, admin } = await this.postCtx(me, pid); return (await this.present(me, c, [p], admin))[0]!; }
  async editPost(me: ObjectId, pid: string, text: string) {
    const { p, c, admin } = await this.postCtx(me, pid, true);
    if (!p.authorId.equals(me)) throw AppError.forbidden('You can only edit your own posts.');
    if (p.status === 'removed') throw AppError.forbidden('This post was removed by the owners.');
    await this.notMuted(c, me);
    this.flagCheck(text);
    const d = await this.posts.findOneAndUpdate({ _id: p._id }, { $set: { text, editedAt: new Date() } }, { returnDocument: 'after' });
    return (await this.present(me, c, [d!], admin))[0]!;
  }
  async deletePost(me: ObjectId, pid: string) {
    const { p, admin } = await this.postCtx(me, pid);
    if (!p.authorId.equals(me) && !admin) throw AppError.forbidden('You can only delete your own posts.');
    await Promise.all([this.posts.deleteOne({ _id: p._id }), this.comments.deleteMany({ postId: p._id }), this.likes.deleteMany({ postId: p._id }), this.reports.deleteMany({ postId: p._id })]);
  }
  async like(me: ObjectId, pid: string, on: boolean) {
    const { p, c, admin } = await this.postCtx(me, pid, true);
    if (p.status !== 'live') throw AppError.conflict('You can like this once it’s posted.');
    if (on) {
      const r = await this.likes.updateOne({ _id: key(p._id, me) }, { $setOnInsert: { postId: p._id, userId: me, at: new Date() } }, { upsert: true });
      if (r.upsertedCount) await this.posts.updateOne({ _id: p._id }, { $inc: { likeCount: 1 } });
    } else {
      const r = await this.likes.deleteOne({ _id: key(p._id, me) });
      if (r.deletedCount) await this.posts.updateOne({ _id: p._id }, { $inc: { likeCount: -1 } });
    }
    return (await this.present(me, c, [(await this.posts.findOne({ _id: p._id }))!], admin))[0]!;
  }
  async pin(me: ObjectId, pid: string, on: boolean) {
    const { p, c, admin } = await this.postCtx(me, pid, true);
    if (!admin) throw AppError.forbidden('Only the circle’s owners can pin posts.');
    if (on && p.status !== 'live') throw AppError.conflict('Only posted posts can be pinned.');
    if (on && (await this.posts.countDocuments({ circleId: c._id, pinnedAt: { $ne: null }, _id: { $ne: p._id } })) >= 3) throw AppError.conflict('Up to 3 posts can be pinned. Unpin one first.');
    await this.posts.updateOne({ _id: p._id }, { $set: { pinnedAt: on ? new Date() : null } });
    return (await this.present(me, c, [(await this.posts.findOne({ _id: p._id }))!], admin))[0]!;
  }
  async approve(me: ObjectId, pid: string) {
    const { p, c, admin } = await this.postCtx(me, pid, true);
    if (!admin) throw AppError.forbidden('Only the circle’s owners can approve posts.');
    if (p.status !== 'pending') throw AppError.conflict('That post was already handled.');
    // Approved posts go to the top of the feed, as if posted now.
    await this.posts.updateOne({ _id: p._id }, { $set: { status: 'live', createdAt: new Date() } });
    this.onPost(p.authorId);
    return (await this.present(me, c, [(await this.posts.findOne({ _id: p._id }))!], admin))[0]!;
  }
  async takeDown(me: ObjectId, pid: string, reason: string) {
    const { p, c, admin } = await this.postCtx(me, pid, true);
    if (!admin) throw AppError.forbidden('Only the circle’s owners can remove posts.');
    await this.posts.updateOne({ _id: p._id }, { $set: { status: 'removed', removedReason: reason, pinnedAt: null } });
    await this.reports.updateMany({ postId: p._id, status: 'open' }, { $set: { status: 'closed', handled: { by: me, action: 'remove', at: new Date() } } });
    return (await this.present(me, c, [(await this.posts.findOne({ _id: p._id }))!], admin))[0]!;
  }
  /** Hidden for me until the owners decide. The author is never told who reported. */
  async report(me: ObjectId, pid: string, v: { reason: PostReportReason; note?: string; block: boolean }) {
    const { p, c } = await this.postCtx(me, pid);
    if (p.authorId.equals(me)) throw AppError.validation('You can’t report your own post.');
    await this.reports.updateOne({ _id: key(p._id, me) }, { $set: { circleId: c._id, postId: p._id, reporterId: me, targetUserId: p.authorId, reason: v.reason, note: v.note ?? '', at: new Date(), status: 'open' } }, { upsert: true });
    if (v.block) await this.safety.block(me, p.authorId.toHexString()).catch(() => undefined);
  }
  async review(me: ObjectId, id: string): Promise<CircleReview> {
    const { c } = await this.member(id, me, true);
    const pending = await this.posts.find({ circleId: c._id, status: 'pending' }).sort({ createdAt: 1 }).limit(100).toArray();
    const open = await this.reports.find({ circleId: c._id, status: 'open' }).sort({ at: -1 }).limit(500).toArray();
    const byPost = new Map<string, ReportDoc[]>();
    for (const r of open) byPost.set(r.postId.toHexString(), [...(byPost.get(r.postId.toHexString()) ?? []), r]);
    const reportedPosts = await this.posts.find({ _id: { $in: [...byPost.keys()].map((k) => new ObjectId(k)) } }).toArray();
    // Owners see the post itself, not the reporters' placeholders.
    const shown = await this.present(c.ownerId, c, reportedPosts, true);
    return {
      pending: await this.present(me, c, pending, true),
      reports: reportedPosts.map((p, i) => { const rs = byPost.get(p._id.toHexString())!; return { id: p._id.toHexString(), post: { ...shown[i]!, hidden: null }, reason: rs[0]!.reason, reports: rs.length, at: rs[0]!.at.toISOString() }; }),
    };
  }
  async settle(me: ObjectId, id: string, postId: string, action: 'remove' | 'keep', reason: string) {
    const { c } = await this.member(id, me, true);
    const pid = this.parseId(postId, 'Report');
    if (!(await this.reports.findOne({ postId: pid, circleId: c._id, status: 'open' }))) throw AppError.notFound('That report was already handled.');
    if (action === 'remove') await this.takeDown(me, postId, reason);
    else await this.reports.updateMany({ postId: pid, status: 'open' }, { $set: { status: 'closed', handled: { by: me, action, at: new Date() } } });
  }

  // ---------------------------------------------------------------- comments (posts and event questions)
  private async presentComments(me: ObjectId, c: Circle, docs: CommentDoc[]): Promise<CircleComment[]> {
    const [authors, blocked] = await Promise.all([this.authors(me, c, docs.map((d) => d.authorId)), this.chat.blockedEitherWay(me, docs.map((d) => d.authorId))]);
    return docs.map((d) => {
      const b = blocked.has(d.authorId.toHexString());
      return { id: d._id.toHexString(), author: authors.get(d.authorId.toHexString())!, text: b ? '' : d.text, createdAt: d.createdAt.toISOString(), parentId: d.parentId?.toHexString() ?? null, answer: d.answer, mine: d.authorId.equals(me), hidden: b ? 'blocked' : null };
    });
  }
  async commentsOn(me: ObjectId, pid: string) {
    const { p, c } = await this.postCtx(me, pid);
    return this.presentComments(me, c, await this.comments.find({ postId: p._id }).sort({ createdAt: 1 }).limit(500).toArray());
  }
  async comment(me: ObjectId, pid: string, text: string, parentId?: string) {
    const { p, c } = await this.postCtx(me, pid, true);
    if (p.status !== 'live') throw AppError.conflict('You can comment once it’s posted.');
    await this.notMuted(c, me);
    this.flagCheck(text);
    const parent = await this.parentOf({ postId: p._id }, parentId);
    const d: CommentDoc = { _id: new ObjectId(), circleId: c._id, postId: p._id, authorId: me, text, parentId: parent, answer: false, createdAt: new Date() };
    await this.comments.insertOne(d);
    await this.posts.updateOne({ _id: p._id }, { $inc: { commentCount: 1 } });
    return (await this.presentComments(me, c, [d]))[0]!;
  }
  /** Replies are one level deep: a reply to a reply hangs off the same top comment. */
  private async parentOf(on: Filter<CommentDoc>, parentId?: string) {
    if (!parentId) return null;
    const par = await this.comments.findOne({ ...on, _id: this.parseId(parentId, 'Comment') });
    if (!par) throw AppError.notFound('That comment was deleted.');
    return par.parentId ?? par._id;
  }
  async deleteComment(me: ObjectId, cid: string) {
    const d = await this.comments.findOne({ _id: this.parseId(cid, 'Comment') });
    if (!d) throw AppError.notFound('That comment was deleted.');
    const { admin } = await this.load(d.circleId.toHexString(), me);
    if (!d.authorId.equals(me) && !admin) throw AppError.forbidden('You can only delete your own comments.');
    const gone = await this.comments.deleteMany({ $or: [{ _id: d._id }, { parentId: d._id }] });
    if (d.postId) await this.posts.updateOne({ _id: d.postId }, { $inc: { commentCount: -gone.deletedCount }, ...(d.answer ? { $set: { answerId: null } } : {}) });
  }
  /** Owners mark the comment that answers a question; it shows under the post in the feed. */
  async markAnswer(me: ObjectId, cid: string, on: boolean) {
    const d = await this.comments.findOne({ _id: this.parseId(cid, 'Comment') });
    if (!d) throw AppError.notFound('That comment was deleted.');
    const { c, admin } = await this.member(d.circleId.toHexString(), me);
    if (!admin) throw AppError.forbidden('Only the circle’s owners can mark answers.');
    const scope: Filter<CommentDoc> = d.postId ? { postId: d.postId } : { eventId: d.eventId };
    await this.comments.updateMany({ ...scope, answer: true }, { $set: { answer: false } });
    if (on) await this.comments.updateOne({ _id: d._id }, { $set: { answer: true } });
    if (d.postId) await this.posts.updateOne({ _id: d.postId }, { $set: { answerId: on ? d._id : null } });
    return (await this.presentComments(me, c, [(await this.comments.findOne({ _id: d._id }))!]))[0]!;
  }

  // ---------------------------------------------------------------- events
  private async counts(e: EventDoc) {
    const rows = await this.rsvps.aggregate<{ _id: RsvpStatus; n: number }>([{ $match: { eventId: e._id } }, { $group: { _id: '$status', n: { $sum: 1 } } }]).toArray();
    const n = (s: RsvpStatus) => rows.find((r) => r._id === s)?.n ?? 0;
    return { going: n('going'), interested: n('interested'), waitlist: n('waitlist'), offered: n('offered') };
  }
  /** Lapsed seat offers go back to "interested"; free seats go to the waitlist in order. */
  private async settleSeats(e: EventDoc) {
    const now = new Date();
    await this.rsvps.updateMany({ eventId: e._id, status: 'offered', offerUntil: { $lte: now } }, { $set: { status: 'interested', at: now }, $unset: { offerUntil: '' } });
    if (e.seats === null || e.status !== 'scheduled' || e.endsAt < now) return;
    const k = await this.counts(e);
    let free = e.seats - k.going - k.offered;
    if (free <= 0) return;
    for (const r of await this.rsvps.find({ eventId: e._id, status: 'waitlist' }).sort({ at: 1, _id: 1 }).limit(free).toArray()) {
      await this.rsvps.updateOne({ _id: r._id, status: 'waitlist' }, { $set: { status: 'offered', offerUntil: new Date(now.getTime() + CIRCLE_TIMES.offerHours * 3600_000) } });
      if (--free <= 0) break;
    }
  }
  private async eventCtx(me: ObjectId, eid: string) {
    const e = await this.events.findOne({ _id: this.parseId(eid, 'Event') });
    if (!e) throw AppError.notFound('This event isn’t available.');
    const x = await this.readable(e.circleId.toHexString(), me);
    await this.settleSeats(e);
    return { e, ...x };
  }
  private async presentEvent(me: ObjectId, c: Circle, e: EventDoc, admin: boolean): Promise<CircleEvent> {
    const now = new Date();
    const [k, mine, previewRows, host, q, ratings] = await Promise.all([
      this.counts(e), this.rsvps.findOne({ _id: key(e._id, me) }),
      this.rsvps.find({ eventId: e._id, status: 'going' }).sort({ at: 1 }).limit(5).toArray(),
      this.authors(me, c, [e.hostId]), this.comments.countDocuments({ eventId: e._id, parentId: null }),
      this.rsvps.aggregate<{ avg: number; n: number }>([{ $match: { eventId: e._id, rating: { $exists: true } } }, { $group: { _id: null, avg: { $avg: '$rating' }, n: { $sum: 1 } } }]).toArray(),
    ]);
    const people = await this.chat.profilesFor(me, await this.chat.users.find({ _id: { $in: previewRows.map((r) => r.userId) } }).toArray());
    const ended = e.endsAt < now;
    const canManage = admin || e.hostId.equals(me);
    let pos: number | null = null;
    if (mine?.status === 'waitlist') pos = 1 + await this.rsvps.countDocuments({ eventId: e._id, status: 'waitlist', $or: [{ at: { $lt: mine.at } }, { at: mine.at, _id: { $lt: mine._id } }] });
    const seeLink = canManage || mine?.status === 'going';
    return {
      id: e._id.toHexString(), circle: { id: c._id.toHexString(), name: c.name, official: !!c.official },
      title: e.title, about: e.about, startsAt: e.startsAt.toISOString(), endsAt: e.endsAt.toISOString(), timeZone: e.timeZone,
      mode: e.mode, place: e.place, onlineUrl: seeLink && e.status === 'scheduled' ? e.onlineUrl : null, hasOnlineLink: !!e.onlineUrl,
      host: host.get(e.hostId.toHexString())!,
      status: e.status === 'cancelled' ? 'cancelled' : ended ? 'ended' : 'scheduled', cancelNote: e.status === 'cancelled' ? e.cancelNote ?? '' : null,
      change: e.change ? { at: e.change.at.toISOString(), was: { ...(e.change.was.startsAt ? { startsAt: e.change.was.startsAt.toISOString() } : {}), ...(e.change.was.endsAt ? { endsAt: e.change.was.endsAt.toISOString() } : {}), ...(e.change.was.place !== undefined ? { place: e.change.was.place } : {}) } } : null,
      needsAck: !!(e.change && mine && ['going', 'interested', 'waitlist', 'offered'].includes(mine.status) && mine.ackAt < e.change.at && e.status === 'scheduled' && !ended),
      seats: e.seats, going: k.going, interested: k.interested, waitlist: k.waitlist,
      myRsvp: mine?.status ?? null, waitlistPos: pos, offerUntil: mine?.status === 'offered' && mine.offerUntil ? mine.offerUntil.toISOString() : null,
      goingPreview: previewRows.map((r) => people.get(r.userId.toHexString())).filter((p): p is PublicProfile => !!p),
      recordingUrl: e.recordingUrl, slidesUrl: e.slidesUrl,
      rating: ended ? { average: ratings[0] ? Math.round(ratings[0].avg * 10) / 10 : 0, count: ratings[0]?.n ?? 0, mine: mine?.rating ?? null } : null,
      questions: q, canManage,
    };
  }
  private async minis(me: ObjectId, evs: EventDoc[]): Promise<CircleEventMini[]> {
    if (!evs.length) return [];
    const circles = new Map((await this.circles.find({ _id: { $in: evs.map((e) => e.circleId) } }, { projection: { name: 1 } }).toArray()).map((c) => [c._id.toHexString(), c]));
    const mine = await this.rsvps.find({ _id: { $in: evs.map((e) => key(e._id, me)) } }).toArray();
    return Promise.all(evs.map(async (e) => ({
      id: e._id.toHexString(), title: e.title, startsAt: e.startsAt.toISOString(), timeZone: e.timeZone, mode: e.mode, place: e.place,
      going: await this.rsvps.countDocuments({ eventId: e._id, status: 'going' }), myRsvp: mine.find((r) => r.eventId.equals(e._id))?.status ?? null,
      cancelled: e.status === 'cancelled', circle: { id: e.circleId.toHexString(), name: circles.get(e.circleId.toHexString())?.name ?? '' },
    })));
  }
  private async nextEvents(me: ObjectId, circleIds: ObjectId[]) {
    const evs = await this.events.aggregate<EventDoc>([
      { $match: { circleId: { $in: circleIds }, status: 'scheduled', startsAt: { $gte: new Date() } } },
      { $sort: { startsAt: 1 } }, { $group: { _id: '$circleId', e: { $first: '$$ROOT' } } }, { $replaceRoot: { newRoot: '$e' } },
    ]).toArray();
    const minis = await this.minis(me, evs);
    return new Map(minis.map((m) => [m.circle.id, m]));
  }

  async eventsOf(me: ObjectId, id: string, past: boolean) {
    const { c, admin } = await this.readable(id, me);
    const now = new Date();
    const rows = past
      ? await this.events.find({ circleId: c._id, endsAt: { $lt: now } }).sort({ startsAt: -1 }).limit(20).toArray()
      : await this.events.find({ circleId: c._id, endsAt: { $gte: now } }).sort({ startsAt: 1 }).limit(50).toArray();
    for (const e of rows) await this.settleSeats(e);
    return Promise.all(rows.map((e) => this.presentEvent(me, c, e, admin)));
  }
  async createEvent(me: ObjectId, id: string, v: { title: string; about: string; startsAt: string; endsAt: string; timeZone: string; mode: EventMode; place: string; onlineUrl: string | null; seats: number | null }) {
    const { c, admin } = await this.member(id, me);
    await this.notMuted(c, me);
    this.flagCheck(`${v.title}\n${v.about}`);
    const now = new Date();
    const e: EventDoc = {
      _id: new ObjectId(), circleId: c._id, hostId: me, title: v.title, about: v.about, startsAt: new Date(v.startsAt), endsAt: new Date(v.endsAt), timeZone: v.timeZone,
      mode: v.mode, place: v.mode === 'online' ? '' : v.place, onlineUrl: v.mode === 'in_person' ? null : v.onlineUrl, seats: v.seats, status: 'scheduled', cancelNote: null,
      change: null, recordingUrl: null, slidesUrl: null, createdAt: now,
    };
    await this.events.insertOne(e);
    // The host is going.
    await this.rsvps.insertOne({ _id: key(e._id, me), eventId: e._id, userId: me, status: 'going', at: now, ackAt: now });
    return this.presentEvent(me, c, e, admin);
  }
  async getEvent(me: ObjectId, eid: string) { const { e, c, admin } = await this.eventCtx(me, eid); return this.presentEvent(me, c, e, admin); }
  private async managed(me: ObjectId, eid: string) {
    const x = await this.eventCtx(me, eid);
    if (!x.admin && !x.e.hostId.equals(me)) throw AppError.forbidden('Only the host or the circle’s owners can change this event.');
    return x;
  }
  /** Moving the time or place is recorded, so people going see what changed and are asked again. */
  async updateEvent(me: ObjectId, eid: string, v: { title?: string; about?: string; startsAt?: string; endsAt?: string; timeZone?: string; mode?: EventMode; place?: string; onlineUrl?: string | null; seats?: number | null; recordingUrl?: string | null; slidesUrl?: string | null }) {
    const { e, c, admin } = await this.managed(me, eid);
    if (e.status === 'cancelled') throw AppError.conflict('This event was cancelled.');
    if (v.title !== undefined || v.about !== undefined) this.flagCheck(`${v.title ?? ''}\n${v.about ?? ''}`);
    const startsAt = v.startsAt ? new Date(v.startsAt) : e.startsAt, endsAt = v.endsAt ? new Date(v.endsAt) : e.endsAt;
    if (endsAt <= startsAt) throw AppError.validation('The end must be after the start.');
    const mode = v.mode ?? e.mode;
    const place = v.place ?? e.place;
    if (mode !== 'online' && !place) throw AppError.validation('Say where it is.');
    const was: { startsAt?: Date; endsAt?: Date; place?: string } = {};
    if (startsAt.getTime() !== e.startsAt.getTime()) was.startsAt = e.startsAt;
    if (endsAt.getTime() !== e.endsAt.getTime()) was.endsAt = e.endsAt;
    if (place !== e.place) was.place = e.place;
    const $set: Partial<EventDoc> = { startsAt, endsAt, mode, place: mode === 'online' ? '' : place };
    for (const k of ['title', 'about', 'timeZone', 'onlineUrl', 'seats', 'recordingUrl', 'slidesUrl'] as const) if (v[k] !== undefined) ($set as Record<string, unknown>)[k] = v[k];
    if (Object.keys(was).length && e.endsAt > new Date()) $set.change = { at: new Date(), was };
    await this.events.updateOne({ _id: e._id }, { $set });
    const fresh = (await this.events.findOne({ _id: e._id }))!;
    await this.settleSeats(fresh);
    return this.presentEvent(me, c, fresh, admin);
  }
  async cancelEvent(me: ObjectId, eid: string, note: string) {
    const { e, c, admin } = await this.managed(me, eid);
    if (e.endsAt < new Date()) throw AppError.conflict('This event already ended.');
    await this.events.updateOne({ _id: e._id }, { $set: { status: 'cancelled', cancelNote: note } });
    return this.presentEvent(me, c, (await this.events.findOne({ _id: e._id }))!, admin);
  }
  private open(e: EventDoc) {
    if (e.status === 'cancelled') throw AppError.conflict('This event was cancelled.');
    if (e.endsAt < new Date()) throw AppError.conflict('This event already ended.');
  }
  /** Going when there's a seat, else the waitlist. Giving up a seat offers it to the next person waiting. */
  async rsvp(me: ObjectId, eid: string, status: 'going' | 'interested' | 'not_going') {
    const { e, c, admin, m } = await this.eventCtx(me, eid);
    if (!m) throw AppError.forbidden('Join the circle to reply to its events.');
    this.open(e);
    const now = new Date();
    const cur = await this.rsvps.findOne({ _id: key(e._id, me) });
    let next: RsvpStatus = status;
    if (status === 'going' && cur?.status !== 'going') {
      if (cur?.status === 'offered') next = 'going';
      else if (e.seats !== null) { const k = await this.counts(e); if (k.going + k.offered >= e.seats) next = 'waitlist'; }
      if (cur?.status === 'waitlist' && next === 'waitlist') return this.presentEvent(me, c, e, admin);
    }
    await this.rsvps.updateOne({ _id: key(e._id, me) }, { $set: { eventId: e._id, userId: me, status: next, at: cur && next === cur.status ? cur.at : now, ackAt: now }, $unset: { offerUntil: '' } }, { upsert: true });
    await this.settleSeats(e);
    return this.presentEvent(me, c, e, admin);
  }
  async leaveWaitlist(me: ObjectId, eid: string) {
    const { e, c, admin } = await this.eventCtx(me, eid);
    await this.rsvps.deleteOne({ _id: key(e._id, me), status: { $in: ['waitlist', 'offered'] } });
    await this.settleSeats(e);
    return this.presentEvent(me, c, e, admin);
  }
  async confirmSeat(me: ObjectId, eid: string) {
    const { e, c, admin } = await this.eventCtx(me, eid);
    this.open(e);
    const r = await this.rsvps.updateOne({ _id: key(e._id, me), status: 'offered', offerUntil: { $gt: new Date() } }, { $set: { status: 'going', ackAt: new Date() }, $unset: { offerUntil: '' } });
    if (!r.modifiedCount) throw AppError.conflict('That seat offer ended. You can join the waitlist again.');
    return this.presentEvent(me, c, e, admin);
  }
  async ackChange(me: ObjectId, eid: string) {
    const { e, c, admin } = await this.eventCtx(me, eid);
    await this.rsvps.updateOne({ _id: key(e._id, me) }, { $set: { ackAt: new Date() } });
    return this.presentEvent(me, c, e, admin);
  }
  async rate(me: ObjectId, eid: string, stars: number) {
    const { e, c, admin } = await this.eventCtx(me, eid);
    if (e.endsAt > new Date() || e.status === 'cancelled') throw AppError.conflict('You can rate it after it ends.');
    const r = await this.rsvps.updateOne({ _id: key(e._id, me), status: 'going' }, { $set: { rating: stars } });
    if (!r.matchedCount) throw AppError.forbidden('Only people who went can rate it.');
    return this.presentEvent(me, c, e, admin);
  }
  async questions(me: ObjectId, eid: string) {
    const { e, c } = await this.eventCtx(me, eid);
    return this.presentComments(me, c, await this.comments.find({ eventId: e._id }).sort({ createdAt: 1 }).limit(500).toArray());
  }
  async ask(me: ObjectId, eid: string, text: string, parentId?: string) {
    const { e, c, m } = await this.eventCtx(me, eid);
    if (!m) throw AppError.forbidden('Join the circle to ask a question.');
    await this.notMuted(c, me);
    this.flagCheck(text);
    const d: CommentDoc = { _id: new ObjectId(), circleId: c._id, eventId: e._id, authorId: me, text, parentId: await this.parentOf({ eventId: e._id }, parentId), answer: false, createdAt: new Date() };
    await this.comments.insertOne(d);
    return (await this.presentComments(me, c, [d]))[0]!;
  }

  /** Deleting an account: their posts, comments, likes and replies go. */
  async forget(me: ObjectId) {
    const posts = await this.posts.find({ authorId: me }, { projection: { _id: 1 } }).toArray();
    await Promise.all([
      this.comments.deleteMany({ $or: [{ authorId: me }, { postId: { $in: posts.map((p) => p._id) } }] }),
      this.likes.deleteMany({ $or: [{ userId: me }, { postId: { $in: posts.map((p) => p._id) } }] }),
      this.reports.deleteMany({ $or: [{ reporterId: me }, { targetUserId: me }] }),
      this.rsvps.deleteMany({ userId: me }), this.mutes.deleteMany({ userId: me }), this.bars.deleteMany({ userId: me }),
    ]);
    await this.posts.deleteMany({ authorId: me });
  }
}
export const CIRCLES = Symbol('CIRCLES');

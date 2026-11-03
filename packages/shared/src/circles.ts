import { z } from 'zod';
import { COMMUNITY_LIMITS, objectIdSchema } from './chat';
import type { PublicProfile } from './types';

/*
 * Yays Circle: a community with a feed, events and its group chats.
 * Circles are communities underneath (same id, members, admins and groups), with a few more settings.
 */

export const CIRCLE_CATEGORIES = ['crypto', 'ai', 'local', 'wellness', 'sports', 'other'] as const;
export type CircleCategory = (typeof CIRCLE_CATEGORIES)[number];
export const CIRCLE_CATEGORY_LABEL: Record<CircleCategory, string> = { crypto: 'Crypto', ai: 'AI and tech', local: 'Local', wellness: 'Wellness', sports: 'Sports', other: 'Other' };

export const CIRCLE_LIMITS = {
  post: 3000, comment: 1000, photos: 4, rules: 10, rule: 200, question: 200, answer: 500,
  eventTitle: 120, eventAbout: 3000, place: 200, seats: 5000, cancelNote: 500,
} as const;
/** How long things last. */
export const CIRCLE_TIMES = {
  /** A join request nobody answers ends after this many days. */
  requestDays: 7,
  /** After a "no" or being removed, you can ask again after this many days. */
  rejoinDays: 30,
  /** A waitlist seat is held this many hours for you to confirm. */
  offerHours: 12,
  /** Mutes are 1 to 30 days. */
  maxMuteDays: 30,
} as const;

export type CircleVisibility = 'public' | 'private';
/** What I am to a circle. Visitors can see a public circle's feed and events; a private one shows only About. */
export type CircleAccess = 'admin' | 'member' | 'visitor' | 'requested' | 'declined' | 'removed';
export type CircleRole = 'owner' | 'admin' | 'member';

export interface CircleEventMini { id: string; title: string; startsAt: string; timeZone: string; mode: EventMode; place: string; going: number; myRsvp: RsvpStatus | null; cancelled: boolean; circle: { id: string; name: string } }

/** A circle in lists: mine, Discover, search. */
export interface CircleCard {
  id: string; name: string; about: string; photoUrl: string | null; memberCount: number;
  visibility: CircleVisibility; official: boolean; category: CircleCategory;
  /** null: not a member. */
  role: 'admin' | 'member' | null;
  requested: boolean;
  /** Not official, but the name looks like an official circle's (or says "official"). */
  lookalike: boolean;
  /** Posts since I last opened it (members only). */
  newPosts: number;
  nextEvent: CircleEventMini | null;
}
export interface CircleDiscover { items: CircleCard[]; featured: CircleCard | null; featuredEvent: CircleEventMini | null; didYouMean: string | null }
export interface MyCircles { circles: CircleCard[]; upcoming: CircleEventMini[] }

export interface CircleOwnerInfo extends PublicProfile { role: CircleRole }
export interface CircleView {
  id: string; name: string; about: string; photoUrl: string | null; memberCount: number;
  visibility: CircleVisibility; official: boolean; category: CircleCategory; listed: boolean;
  rules: string[]; joinQuestion: string | null; postApproval: boolean;
  owners: CircleOwnerInfo[]; ownerId: string; createdAt: string;
  access: CircleAccess;
  isOwner: boolean;
  /** Members, and anyone for public circles. */
  canRead: boolean;
  lookalike: boolean;
  request: { at: string; expiresAt: string; answer: string } | null;
  /** After a "no": when you can ask again. */
  declinedUntil: string | null;
  removed: { at: string; until: string; reason: string } | null;
  muted: { until: string; reason: string } | null;
  /** Admins: posts waiting and open reports. */
  pendingReview: number;
  upcomingEvents: number;
  chatCount: number;
}

export interface CircleAuthor extends PublicProfile { role: CircleRole; official: boolean }
export type PostStatus = 'live' | 'pending' | 'removed';
export interface CirclePost {
  id: string; circleId: string;
  author: CircleAuthor;
  text: string; photos: string[];
  createdAt: string; editedAt: string | null;
  status: PostStatus;
  removedReason: string | null;
  pinned: boolean; likes: number; liked: boolean; comments: number; mine: boolean;
  /** The best answer from an owner/admin, for questions. */
  answer: { by: string; text: string } | null;
  /** Shown as a placeholder: I reported it (until it's handled) or I blocked the author. */
  hidden: 'reported' | 'blocked' | null;
}
export interface CircleFeed { items: CirclePost[]; next: string | null }
export interface CircleComment {
  id: string; author: CircleAuthor; text: string; createdAt: string;
  parentId: string | null; answer: boolean; mine: boolean; hidden: 'blocked' | null;
}

export type EventMode = 'in_person' | 'online' | 'both';
export type RsvpStatus = 'going' | 'interested' | 'not_going' | 'waitlist' | 'offered';
export type EventStatus = 'scheduled' | 'cancelled' | 'ended';
export interface CircleEvent {
  id: string; circle: { id: string; name: string; official: boolean };
  title: string; about: string; startsAt: string; endsAt: string; timeZone: string;
  mode: EventMode; place: string;
  /** Only for people going (and admins). */
  onlineUrl: string | null;
  hasOnlineLink: boolean;
  host: CircleAuthor;
  status: EventStatus;
  cancelNote: string | null;
  /** The latest change to time or place, and what it was before. */
  change: { at: string; was: { startsAt?: string; endsAt?: string; place?: string } } | null;
  /** The change happened after I said Going/Interested, and I haven't answered "still going?". */
  needsAck: boolean;
  seats: number | null; going: number; interested: number; waitlist: number;
  myRsvp: RsvpStatus | null;
  /** 1-based place in the queue. */
  waitlistPos: number | null;
  offerUntil: string | null;
  goingPreview: PublicProfile[];
  recordingUrl: string | null; slidesUrl: string | null;
  rating: { average: number; count: number; mine: number | null } | null;
  questions: number;
  canManage: boolean;
}
export interface CircleReview {
  pending: CirclePost[];
  reports: Array<{ id: string; post: CirclePost; reason: PostReportReason; reports: number; at: string }>;
}
export interface CircleMemberRow extends PublicProfile { role: CircleRole; joinedAt: string; mutedUntil: string | null }

/* ----------------------------------------------------------- money-scheme check */

const SCHEME: RegExp[] = [
  /\bguarantee(?:d|s)?\s+(?:\d+(?:\.\d+)?\s*%\s*)?(?:daily\s+|weekly\s+|monthly\s+)?(?:profits?|returns?|income|earnings?)\b/gi,
  /\b\d+(?:\.\d+)?\s*%\s*(?:daily|per\s+day|a\s+day|weekly|per\s+week|a\s+week)(?:\s+(?:profits?|returns?))?/gi,
  /\b(?:dm|message|inbox|whatsapp|text)\s+me\s+(?:now\s+)?(?:to\s+)?(?:invest|join|earn|get\s+rich)\b/gi,
  /\bsend\s+(?:me\s+)?\d+(?:\.\d+)?\s*(?:btc|usdt|eth|bnb|crypto|dollars?|rupees?|\$)/gi,
  /\bsend\s+(?:me\s+)?(?:your\s+)?(?:btc|usdt|eth|bnb|money|crypto|funds?|payment)\s+(?:to\s+(?:me|join|this|my)|and\s+(?:get|earn|receive))\b/gi,
  /\b\d+\s*x\s+(?:signals?|returns?|profits?|gains?)\b/gi,
  /\bvip\s+(?:signals?|group|channel)\b/gi,
  /\bdouble\s+your\s+(?:money|btc|crypto|investment|coins?)\b/gi,
  /\b(?:risk[-\s]?free|no[-\s]?risk|zero[-\s]?risk)\s+(?:profits?|returns?|investment|trading)\b/gi,
  /\binvestment\s+(?:plan|scheme|package)s?\b/gi,
];
export interface SchemeMatch { start: number; end: number; text: string }
/** Parts of a post that look like promising profits or asking for money. Circles don't allow those. */
export function moneySchemeMatches(text: string): SchemeMatch[] {
  const out: SchemeMatch[] = [];
  for (const re of SCHEME) {
    re.lastIndex = 0;
    for (let m = re.exec(text); m; m = re.exec(text)) out.push({ start: m.index, end: m.index + m[0].length, text: m[0] });
  }
  out.sort((a, b) => a.start - b.start);
  // Merge overlaps so the text can be marked in one pass.
  const merged: SchemeMatch[] = [];
  for (const m of out) {
    const last = merged[merged.length - 1];
    if (last && m.start <= last.end) { last.end = Math.max(last.end, m.end); last.text = text.slice(last.start, last.end); } else merged.push({ ...m });
  }
  return merged;
}

/** "Official" belongs to circles YaysApp has checked. */
export const claimsOfficial = (name: string) => /\bofficial\b/i.test(name);
const squash = (s: string) => s.toLowerCase().replace(/\bcircle\b/g, '').replace(/[^a-z0-9]+/g, '');
/** A circle that isn't official but whose name says it is, or contains an official circle's name. */
export function looksLikeOfficial(name: string, officialNames: string[]) {
  if (claimsOfficial(name)) return true;
  const n = squash(name);
  return officialNames.some((o) => { const s = squash(o); return s.length >= 4 && n.includes(s); });
}

/* ------------------------------------------------------------------ schemas */

const oneLine = (max: number, empty: string) => z.string().transform((v) => v.replace(/\s+/g, ' ').trim()).pipe(z.string().min(1, empty).max(max, `That’s too long (up to ${max} characters).`));
const body = (max: number) => z.string().transform((v) => v.replace(/\u0000/g, '').replace(/\n{3,}/g, '\n\n').trim()).pipe(z.string().max(max, `That’s too long (up to ${max} characters).`));
const circleName = oneLine(COMMUNITY_LIMITS.name, 'Give the circle a name.');
const rules = z.array(oneLine(CIRCLE_LIMITS.rule, 'A rule can’t be empty.')).max(CIRCLE_LIMITS.rules, `Up to ${CIRCLE_LIMITS.rules} rules.`);
const question = z.string().transform((v) => v.replace(/\s+/g, ' ').trim()).pipe(z.string().max(CIRCLE_LIMITS.question)).nullable();

export const createCircleSchema = z.object({
  name: circleName,
  about: body(COMMUNITY_LIMITS.about).default(''),
  photoKey: z.string().max(512).nullable().optional(),
  visibility: z.enum(['public', 'private']).default('public'),
  category: z.enum(CIRCLE_CATEGORIES).default('other'),
  listed: z.boolean().default(true),
  rules: rules.default([]),
  joinQuestion: question.optional(),
  postApproval: z.boolean().default(false),
});
export type CreateCircleInput = z.input<typeof createCircleSchema>;
export const updateCircleSchema = z.object({
  name: circleName.optional(), about: body(COMMUNITY_LIMITS.about).optional(), photoKey: z.string().max(512).nullable().optional(),
  visibility: z.enum(['public', 'private']).optional(), category: z.enum(CIRCLE_CATEGORIES).optional(), listed: z.boolean().optional(),
  rules: rules.optional(), joinQuestion: question.optional(), postApproval: z.boolean().optional(),
}).refine((v) => Object.values(v).some((x) => x !== undefined), 'Nothing to change.');
export type UpdateCircleInput = z.input<typeof updateCircleSchema>;

export const joinCircleSchema = z.object({ answer: body(CIRCLE_LIMITS.answer).optional() });
export const circlePostSchema = z.object({
  text: body(CIRCLE_LIMITS.post).default(''),
  photoKeys: z.array(z.string().max(512)).max(CIRCLE_LIMITS.photos, `Up to ${CIRCLE_LIMITS.photos} photos.`).default([]),
  /** "review": I saw the money-scheme warning and want the owners to decide. */
  send: z.enum(['normal', 'review']).default('normal'),
}).refine((v) => v.text.length > 0 || v.photoKeys.length > 0, 'Write something or add a photo.');
export type CirclePostInput = z.input<typeof circlePostSchema>;
export const editPostSchema = z.object({ text: body(CIRCLE_LIMITS.post).pipe(z.string().min(1, 'Write something.')) });
export const commentSchema = z.object({ text: body(CIRCLE_LIMITS.comment).pipe(z.string().min(1, 'Write a comment.')), parentId: objectIdSchema.optional() });
export const POST_REPORT_REASONS = ['spam', 'impersonation', 'scam', 'harassment', 'other'] as const;
export type PostReportReason = (typeof POST_REPORT_REASONS)[number];
export const POST_REPORT_LABEL: Record<PostReportReason, [string, string]> = {
  spam: ['Spam', 'Ads, repeated posts, link farms'],
  impersonation: ['Pretending to be someone', 'Fake “official” accounts or staff'],
  scam: ['Misleading promotion', 'Investment schemes, guaranteed returns, asking for money'],
  harassment: ['Harassment or hate', 'Targeting a person or group'],
  other: ['Something else', 'Tell the circle owners'],
};
export const reportPostSchema = z.object({ reason: z.enum(POST_REPORT_REASONS), note: body(500).optional(), block: z.boolean().default(false) });
export const removePostSchema = z.object({ reason: body(300).default('') });
export const settleReportSchema = z.object({ action: z.enum(['remove', 'keep']), reason: body(300).default('') });
export const muteSchema = z.object({ days: z.number().int().min(1).max(CIRCLE_TIMES.maxMuteDays), reason: body(300).default('') });
export const removeMemberSchema = z.object({ reason: body(300).default('') });
export const newOwnerSchema = z.object({ userId: objectIdSchema });

const iso = z.string().refine((v) => !Number.isNaN(Date.parse(v)), 'Not a valid date.');
const url = z.string().trim().max(500).url('That doesn’t look like a link.').refine((v) => /^https?:\/\//i.test(v), 'Links must start with http:// or https://.');
const tz = z.string().max(64).refine((v) => { try { new Intl.DateTimeFormat('en', { timeZone: v }); return true; } catch { return false; } }, 'Unknown time zone.');
const eventFields = {
  title: oneLine(CIRCLE_LIMITS.eventTitle, 'Give the event a name.'),
  about: body(CIRCLE_LIMITS.eventAbout).default(''),
  startsAt: iso, endsAt: iso, timeZone: tz,
  mode: z.enum(['in_person', 'online', 'both']),
  place: z.string().transform((v) => v.replace(/\s+/g, ' ').trim()).pipe(z.string().max(CIRCLE_LIMITS.place)).default(''),
  onlineUrl: url.nullable().default(null),
  seats: z.number().int().min(1).max(CIRCLE_LIMITS.seats).nullable().default(null),
};
const eventChecks = (v: { startsAt?: string; endsAt?: string; mode?: EventMode; place?: string; onlineUrl?: string | null }, ctx: z.RefinementCtx) => {
  if (v.startsAt && v.endsAt && Date.parse(v.endsAt) <= Date.parse(v.startsAt)) ctx.addIssue({ code: 'custom', path: ['endsAt'], message: 'The end must be after the start.' });
  if (v.mode && v.mode !== 'online' && v.place !== undefined && !v.place) ctx.addIssue({ code: 'custom', path: ['place'], message: 'Say where it is.' });
  if (v.mode && v.mode !== 'in_person' && v.onlineUrl === null) ctx.addIssue({ code: 'custom', path: ['onlineUrl'], message: 'Add the online link.' });
};
export const createEventSchema = z.object(eventFields).superRefine((v, ctx) => {
  eventChecks(v, ctx);
  if (Date.parse(v.startsAt) < Date.now() - 60_000) ctx.addIssue({ code: 'custom', path: ['startsAt'], message: 'Pick a time in the future.' });
});
export type CreateEventInput = z.input<typeof createEventSchema>;
export const updateEventSchema = z.object({
  title: eventFields.title.optional(), about: body(CIRCLE_LIMITS.eventAbout).optional(),
  startsAt: iso.optional(), endsAt: iso.optional(), timeZone: tz.optional(), mode: z.enum(['in_person', 'online', 'both']).optional(),
  place: z.string().transform((v) => v.replace(/\s+/g, ' ').trim()).pipe(z.string().max(CIRCLE_LIMITS.place)).optional(),
  onlineUrl: url.nullable().optional(), seats: z.number().int().min(1).max(CIRCLE_LIMITS.seats).nullable().optional(),
  recordingUrl: url.nullable().optional(), slidesUrl: url.nullable().optional(),
}).superRefine(eventChecks).refine((v) => Object.values(v).some((x) => x !== undefined), 'Nothing to change.');
export type UpdateEventInput = z.input<typeof updateEventSchema>;
export const cancelEventSchema = z.object({ note: body(CIRCLE_LIMITS.cancelNote).default('') });
export const rsvpSchema = z.object({ status: z.enum(['going', 'interested', 'not_going']) });
export const rateEventSchema = z.object({ stars: z.number().int().min(1).max(5) });

import { z } from 'zod';

/* ------------------------------------------------------------------ points */

/** One week of daily check-ins: day 1 … day 7. Missing a day starts again at day 1. */
export const CHECKIN_POINTS = [10, 10, 15, 15, 20, 20, 50] as const;
/** Points from everyday activity (messages, posts, questions, check-ins) stop at this many a day. */
export const DAILY_POINTS_CAP = 200;
/** Inviter's reward when a friend joins with their code, verifies a phone number and sends a first message. */
export const REFERRAL_POINTS = 100;
/** Points → BTCY Nuggets. */
export const CONVERT = { pointsPerNugget: 100, min: 500, dailyMax: 5000 } as const;

export interface PointsSummary {
  balance: number;
  /** Waiting for something to happen (a friend verifying their number). */
  pending: number;
  earnedToday: number;
  earnedThisWeek: number;
  /** Everyday activity counted toward today's cap. */
  capUsed: number;
  cap: number;
}

export type CheckinDayState = 'done' | 'today' | 'claimed' | 'upcoming';
export interface CheckinStatus {
  /** Days in a row so far, counting today once claimed. */
  streak: number;
  claimedToday: boolean;
  /** 1–7: where today sits in the week. */
  dayOfWeek: number;
  todayPoints: number;
  tomorrowPoints: number;
  days: Array<{ day: number; points: number; state: CheckinDayState }>;
  balance: number;
}

export interface EarnTask { id: 'messages' | 'post' | 'ask_jack'; title: string; icon: string; done: number; of: number; points: number; completed: boolean }
export interface EarnToday { tasks: EarnTask[]; capUsed: number; cap: number }

export type PointsStatus = 'done' | 'pending' | 'reversed';
export interface PointsEntry {
  id: string;
  kind: 'checkin' | 'activity' | 'referral' | 'bonus' | 'convert' | 'ai_extra' | 'reversal';
  title: string;
  sub: string;
  /** Positive when earned, negative when spent. */
  amount: number;
  status: PointsStatus;
  at: string;
}
export interface PointsHistoryPage { items: PointsEntry[]; next: string | null }

export interface ReferralFriend { name: string; photoUrl: string | null; status: 'pending' | 'rewarded' | 'not_eligible'; sub: string; at: string }
export interface ReferralSummary { code: string; invited: number; joined: number; pending: number; pointsEarned: number; friends: ReferralFriend[] }

/* ------------------------------------------------------------------ bonus pop-ups */

export type BonusId = 'jack-daily' | 'btcy-weekly';
export interface BonusTask { id: string; title: string; icon: string; done: number; of: number; points: number; completed: boolean }
export interface BonusCampaign {
  id: BonusId;
  product: 'jack' | 'btcy';
  eyebrow: string;
  /** Total points on offer. */
  points: number;
  /** All tasks must be done before anything is paid (otherwise each task pays on its own). */
  allRequired: boolean;
  endsAt: string;
  tasks: BonusTask[];
  /** Points already paid in this period. */
  paid: number;
  /** Everything done and paid. */
  complete: boolean;
  /** Needs a linked Indexx account to count (BTCY). */
  needsLink: boolean;
}

/** What to show when the app opens: one pop-up at a time, at most once a day each. */
export type PopupNow =
  | { kind: 'checkin'; checkin: CheckinStatus }
  | { kind: 'bonus'; bonus: BonusCampaign }
  | { kind: 'none' };

export const dismissPopupSchema = z.object({
  popup: z.enum(['checkin', 'jack-daily', 'btcy-weekly', 'bonuses']),
  /** "Don't show this on web" for the check-in pop-up. */
  forever: z.boolean().optional(),
});

/* ------------------------------------------------------------------ Indexx account, wallet, BTCY */

export interface IndexxLink { linked: boolean; email: string | null; linkedAt: string | null; available: boolean }

export interface WalletView {
  points: number;
  linked: boolean;
  /** Null when no Indexx account is linked. Nuggets have 4 decimals. */
  nuggets: number | null;
  /** USDXX in cents. */
  usdxxCents: number | null;
  exchangeUsdCents: number | null;
  syncedAt: string | null;
  convert: { pointsPerNugget: number; min: number; dailyMax: number; usedToday: number };
}

export type WalletTxStatus = 'done' | 'failed';
/** Wallet activity: INEX converted to BTCY Nuggets. */
export interface WalletTx {
  id: string;
  kind: 'convert';
  direction: 'in' | 'out';
  title: string;
  sub: string;
  at: string;
  status: WalletTxStatus;
  /** In 1/10000 of a Nugget. */
  amount: number;
  unit: 'NUGGET';
}

export interface BtcyView {
  linked: boolean;
  mining: { active: boolean; endsAt: string | null; nuggets: number; perHour: number; last7: Array<{ day: string; amount: number }>; streak: number; best: number };
  tokens: number;
  boostPct: number;
  team: Array<{ name: string; joinedAt: string; mining: boolean; lastActiveAt: string | null }>;
}

export interface ProductsView {
  linked: boolean;
  emmm: { handle: string | null; open: number; settledThisMonth: number; markets: Array<{ question: string; closes: string; side: 'yes' | 'no' | 'pending' }>; trendingError: boolean } | null;
}

export const convertSchema = z.object({ points: z.number().int().positive() });
export const linkIndexxSchema = z.object({ email: z.string().trim().email('Enter the email of your Indexx account.') });

/* ------------------------------------------------------------------ Jack's AI */

export type AiMode = 'chat' | 'search' | 'document' | 'image';
export interface AiSource { n: number; title: string; url: string; domain: string; quote: string }
export interface AiDocument { title: string; markdown: string; version: number }
/** A picture Jack made. `n` is its number in the reply (1, 2…), used for "edit number 1". */
export interface AiImage { n: number; url: string; width: number; height: number }
/** Work the light Jack's AI doesn't do here (browsing, files, video, code…): a link to the full Jack's AI. */
export interface AiHandoff { url: string; label: string }
export interface AiMessage {
  id: string; role: 'user' | 'assistant'; text: string; at: string; mode: AiMode;
  sources?: AiSource[]; document?: AiDocument; images?: AiImage[]; handoff?: AiHandoff;
  /** On a request to change a picture: which one (message id and number). */
  editOf?: { messageId: string; n: number };
}
export interface AiChatSummary { id: string; title: string; saved: boolean; mode: AiMode; updatedAt: string }
export interface AiQuota {
  used: number; limit: number; resetsAt: string; extraCost: number; extraMessages: number;
  /** Pictures today (separate from messages); same reset time. */
  images: { used: number; limit: number; perRequest: number };
}
export interface AiChat { id: string; title: string; saved: boolean; mode: AiMode; messages: AiMessage[]; quota: AiQuota; document: AiDocument | null }
export interface AiReply { chat: AiChatSummary; user: AiMessage; assistant: AiMessage; quota: AiQuota }
export interface AiSummary { conversationId: string; text: string; count: number; at: string }
/** What this server's Jack's AI can do right now. */
export interface AiInfo { model: string; images: boolean; search: boolean; demo: boolean; fullJackUrl: string }

export const AI_FREE_PER_DAY = 30;
export const AI_EXTRA = { cost: 50, messages: 10 } as const;
export const AI_MAX_INPUT = 4000;
export const aiAskSchema = z.object({
  text: z.string().trim().min(1, 'Type a question.').max(AI_MAX_INPUT, 'That message is too long.'),
  mode: z.enum(['chat', 'search', 'document', 'image']).default('chat'),
  /** Change a picture from earlier in this conversation. */
  editOf: z.object({ messageId: z.string().regex(/^[a-f0-9]{24}$/i), n: z.number().int().min(1).max(4) }).optional(),
});
/** Send something Jack made into a YaysApp chat: one picture (n), or the document. */
export const aiShareSchema = z.object({ conversationId: z.string().min(1), n: z.number().int().min(1).max(4).optional(), caption: z.string().trim().max(1000).default('') });
export const aiChatPatchSchema = z.object({ title: z.string().trim().min(1).max(80).optional(), saved: z.boolean().optional() });

export const siteAskSchema = z.object({ messages: z.array(z.object({ role: z.enum(['user', 'assistant']), text: z.string().trim().min(1).max(1000) })).min(1).max(12) });
export const leadSchema = z.object({ name: z.string().trim().min(1, 'Add your name.').max(80), email: z.string().trim().email('Add the rest of your email, like name@company.com'), question: z.string().trim().max(1000).default(''), consent: z.literal(true, { errorMap: () => ({ message: 'Tick the box so we can contact you.' }) }) });

/* ------------------------------------------------------------------ support desk */

export interface SupportAnswer { answer: string; ai: boolean }
export const supportAskSchema = z.object({ question: z.string().trim().min(3, 'Tell us a little more.').max(1000) });
export const supportTicketSchema = z.object({ question: z.string().trim().min(3).max(1000), answer: z.string().max(2000).default('') });
export interface SupportTicket { number: string; conversationId: string }

/* ------------------------------------------------------------------ socials */

export const SOCIAL_NETWORKS = ['x', 'instagram', 'tiktok', 'youtube', 'linkedin', 'telegram'] as const;
export type SocialNetwork = (typeof SOCIAL_NETWORKS)[number];
export interface SocialLink { network: SocialNetwork | 'facebook'; handle: string; url: string | null; /** Confirmed through the network's own sign-in. */ verified: boolean }
export interface FacebookLink { name: string; photoUrl: string | null; login: boolean; linkedAt: string }
export interface SocialsView {
  links: SocialLink[];
  visibility: 'everyone' | 'contacts' | 'nobody';
  /** Only in answers about me: my linked Facebook, if any. */
  facebook?: FacebookLink | null;
  /** Only in answers about me: whether Facebook linking is set up on this server. */
  facebookAvailable?: boolean;
}
export const facebookStartSchema = z.object({ login: z.boolean().default(true) });
export const facebookLoginSchema = z.object({ on: z.boolean() });
export const facebookFinishSchema = z.object({ ticket: z.string().min(16).max(128) });
export const socialSchema = z.object({ network: z.enum(SOCIAL_NETWORKS), handle: z.string().trim().min(1, 'Add your username.').max(60).regex(/^@?[A-Za-z0-9._-]+$/, 'Use just the username, like @sara.') });
export const socialVisibilitySchema = z.object({ visibility: z.enum(['everyone', 'contacts', 'nobody']) });
export const socialUrl = (n: SocialNetwork, handle: string) => {
  const h = handle.replace(/^@/, '');
  return { x: `https://x.com/${h}`, instagram: `https://instagram.com/${h}`, tiktok: `https://tiktok.com/@${h}`, youtube: `https://youtube.com/@${h}`, linkedin: `https://linkedin.com/in/${h}`, telegram: `https://t.me/${h}` }[n];
};

export const referralCodeSchema = z.object({ code: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{2,12}-[A-Z0-9]{3}$/, 'That code doesn’t look right. It looks like SARA-7K2.') });

import { z } from 'zod';

/* ------------------------------------------------------------------ points */

/** One week of daily check-ins: day 1 … day 7. Missing a day starts again at day 1. */
export const CHECKIN_POINTS = [10, 10, 15, 15, 20, 20, 50] as const;
/** Points from everyday activity (messages, posts, questions, check-ins) stop at this many a day. */
export const DAILY_POINTS_CAP = 200;
/** Inviter's reward when a friend joins with their code, verifies a phone number and sends a first message. */
export const REFERRAL_POINTS = 100;

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

/**
 * The person's Indexx sign-in. YaysApp keeps the Indexx login token on its server (never the password) and reads
 * BTCY, EMMM, ShoperPal, Wall Street and the wallet with it. `email` stays after a sign-in ends, to fill the form.
 */
export interface IndexxLink { linked: boolean; email: string | null; linkedAt: string | null; available: boolean }
export const indexxSignInSchema = z.object({
  email: z.string().trim().email('Enter the email of your Indexx account.'),
  password: z.string().min(1, 'Enter your Indexx password.').max(200),
});

/* The objects below are what the Indexx API returns (YaysApp Explore and Wallet APIs, 7 Nov 2026), passed on as
   they are. null means Indexx couldn't read that value right now: show a dash, not 0. */

export interface IndexxLinks { btcy: string; emmm: string; shoperpal: string; wallstreet: string; rehuman: string }
export const INDEXX_LINKS: IndexxLinks = {
  btcy: 'https://bitcoinyay.com', emmm: 'https://emmm.io', shoperpal: 'https://shoperpal.com',
  wallstreet: 'https://wallstreet.blockchain.indexx.ai', rehuman: 'https://rehumansystem.com',
};

export interface IndexxBtcy {
  mining: { active: boolean; speed: number | null; plan: string | null; endsInSeconds: number | null; streakDays: number | null; bestStreakDays: number | null };
  last7Days: { days: Array<{ date: string; label: string; nuggets: number | null }>; total: number | null };
  team: { members: number | null; miningNow: number | null };
  boost: { percent: number | null; multiplier: number | null };
  portfolio: { nuggets: number | null; tokens: number | null; totalMined: number | null };
  alchemy?: { currentUsd: number | null; targetUsd: number | null } | null;
  referrals?: { active: number | null; target: number | null } | null;
  station?: { unlocked: boolean } | null;
  ambassador?: { tier: string | null; nextTierAt: number | null } | null;
  watchEarn?: { watched: number | null; total: number | null; nuggetsToday: number | null } | null;
}

export type EmmmMarketStatus = 'open' | 'won' | 'lost';
export interface IndexxEmmm {
  openPositions: number | null;
  settledThisMonth: { count: number | null; payoutUsd: number | null } | null;
  markets: Array<{ marketSlug: string; title: string; outcome: string | null; status: EmmmMarketStatus; shares: number | null; currentValue: number | null; stakeUsd: number | null; payoutUsd: number | null; settledAt: string | null }>;
  eligibility?: { eligible: boolean; nuggetBalance: number | null; totalMined: number | null; maxBetNuggets: number | null; reason: string | null } | null;
  portfolio?: { value: number | null; cash: number | null; usdt: number | null } | null;
}

export interface ShoperPalPurchase { id: string; status: string; total: number | null; createdAt: string; items: Array<{ name: string; quantity: number; price: number | null }> }
export interface IndexxShoperPal {
  role: 'seller' | 'buyer';
  supplier: {
    plan: string | null; productsListed: number | null; productsLimit: number | null; ordersToday: number | null; pendingOrders: number | null; commission: string | null;
    aiCredits: { used: number | null; total: number | null; resetsInDays: number | null } | null;
    earnings: { grossEarned: number | null; totalEarned: number | null; pendingAmount: number | null; available: number | null } | null;
    boosts: { active: number | null; daysRemaining: number | null } | null;
  } | null;
  buyer: {
    monthSpend: number | null; orderCount: number | null; earnRate: string | null;
    nuggets: { released: number | null; pending: number | null; wallet: number | null; lifetime: number | null } | null;
    flash: { title: string; endsAt: string } | null;
    recentPurchases: ShoperPalPurchase[];
  } | null;
}

export interface IndexxWallStreet {
  holdings: { count: number; totalInvested: number | null; items: Array<{ campaignId: string; tokenSymbol: string; tokenName: string; amountInvested: number | null; tokensReceived: number | null; purchases: number | null; lastPurchasedAt: string | null }> };
  listings: { count: number; items: Array<{ campaignId: string; companyName: string; tokenSymbol: string; logo: string | null; status: string; verificationStatus: string | null; fundingGoal: number | null; raised: number | null; investors: number | null; deadline: string | null }> };
}

/** The Explore tab. Not signed in to Indexx: linked false, products null, links are the usual sites. */
export interface ExploreView {
  linked: boolean;
  links: IndexxLinks;
  btcy: IndexxBtcy | null;
  emmm: IndexxEmmm | null;
  shoperpal: IndexxShoperPal | null;
  wallstreet: IndexxWallStreet | null;
}
export type ExploreProduct = 'btcy' | 'emmm' | 'shoperpal' | 'wallstreet';

export interface ExchangeAsset { symbol: string; network: string | null; balance: number; price: number | null; usd: number | null }
/** The four wallet cards. Dollars, not cents. */
export interface WalletView {
  linked: boolean;
  inex: { balance: number | null; source: string } | null;
  nuggets: { balance: number | null; source: string } | null;
  usdxx: { balance: number | null; usd: number | null; source: string } | null;
  /** null: the exchange wallet couldn't be read. totalUsd 0: nothing held. */
  exchange: { totalUsd: number | null; assets: ExchangeAsset[]; partial: boolean; readOnly: boolean } | null;
}

export interface WithdrawQuote {
  amount: number; balance: number; minimum: number;
  /** null: no daily limit. */
  dailyMax: number | null; usedToday: number; remainingToday: number | null;
  destination: string; eligible: boolean; reason: string | null;
}
export type WithdrawStatus = 'completed' | 'failed' | 'processing';
export interface Withdrawal { id: string; status: WithdrawStatus; amount: number; balance: number; network: string | null; createdAt: string; duplicate: boolean }
export interface WithdrawalsPage { items: Withdrawal[]; hasMore: boolean }
export const withdrawSchema = z.object({
  amount: z.number().int('Enter a whole number of INEX.').positive('Enter how much INEX to withdraw.'),
  idempotencyKey: z.string().min(8).max(100),
});

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
export const facebookStartSchema = z.object({ login: z.boolean().default(true), /** 'app': come back to the phone app (yaysapp://settings/facebook?…). */ returnTo: z.enum(['web', 'app']).default('web') });
export const facebookLoginSchema = z.object({ on: z.boolean() });
export const facebookFinishSchema = z.object({ ticket: z.string().min(16).max(128) });
export const socialSchema = z.object({ network: z.enum(SOCIAL_NETWORKS), handle: z.string().trim().min(1, 'Add your username.').max(60).regex(/^@?[A-Za-z0-9._-]+$/, 'Use just the username, like @sara.') });
export const socialVisibilitySchema = z.object({ visibility: z.enum(['everyone', 'contacts', 'nobody']) });
export const socialUrl = (n: SocialNetwork, handle: string) => {
  const h = handle.replace(/^@/, '');
  return { x: `https://x.com/${h}`, instagram: `https://instagram.com/${h}`, tiktok: `https://tiktok.com/@${h}`, youtube: `https://youtube.com/@${h}`, linkedin: `https://linkedin.com/in/${h}`, telegram: `https://t.me/${h}` }[n];
};

export const referralCodeSchema = z.object({ code: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{2,12}-[A-Z0-9]{3}$/, 'That code doesn’t look right. It looks like SARA-7K2.') });

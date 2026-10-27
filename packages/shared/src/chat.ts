import { z } from 'zod';
import type { PublicProfile } from './types';

/** Longest text message, counted in characters as people see them (emoji count once). */
export const MAX_TEXT = 4096;
export const textLength = (s: string) => [...s].length;

/** Things that happen in a group, shown as a centred line in the chat. The person who did it is the message's senderId. */
export type SystemEvent =
  | { kind: 'created'; name: string }
  | { kind: 'added'; userIds: string[] }
  | { kind: 'removed'; userIds: string[] }
  | { kind: 'left' }
  | { kind: 'joined'; via: 'link' | 'request' }
  | { kind: 'renamed'; name: string }
  | { kind: 'about' }
  | { kind: 'photo'; removed: boolean }
  | { kind: 'admin'; userId: string; on: boolean }
  | { kind: 'settings'; changes: Partial<GroupSettings> }
  | { kind: 'invite_reset' };

export interface ChatMessage {
  id: string;
  conversationId: string;
  /** Position in the conversation: 1, 2, 3… with no gaps. Order by this, never by time. */
  seq: number;
  senderId: string;
  /** Chosen by the sending device; sending the same clientId twice never makes two messages. */
  clientId: string;
  type: 'text' | 'system';
  text: string;
  system?: SystemEvent;
  createdAt: string;
}

/** Who may do what in a group. Admins can always do everything. */
export interface GroupSettings {
  editInfo: 'all' | 'admins';
  send: 'all' | 'admins';
  addMembers: 'all' | 'admins';
  pin: 'all' | 'admins';
  /** New people joining by link wait for an admin to approve them. */
  approveNew: boolean;
}
export const DEFAULT_GROUP_SETTINGS: GroupSettings = { editInfo: 'admins', send: 'all', addMembers: 'admins', pin: 'all', approveNew: false };
export const MAX_GROUP_MEMBERS = 1024;
export const MAX_GROUP_NAME = 100;
export const MAX_GROUP_ABOUT = 512;

export interface GroupMeta {
  name: string;
  about: string;
  photoUrl: string | null;
  memberCount: number;
  /** former: I left or was removed; the history up to then stays readable. */
  role: 'admin' | 'member' | 'former';
  ownerId: string;
  adminIds: string[];
  settings: GroupSettings;
}
export interface GroupMember extends PublicProfile { admin: boolean; owner: boolean }
export interface GroupInfo extends GroupMeta {
  id: string;
  members: GroupMember[];
  /** Only admins (or anyone allowed to add members) see the invite code. */
  inviteCode: string | null;
  createdAt: string;
  pendingRequests: number;
}
export interface InvitePreview { code: string; conversationId: string; name: string; about: string; photoUrl: string | null; memberCount: number; alreadyMember: boolean; needsApproval: boolean; requested: boolean }
export interface JoinRequest { user: PublicProfile; requestedAt: string }
export type JoinResult = { status: 'joined'; conversation: ConversationSummary } | { status: 'requested' };

export interface MemberReceipt { deliveredSeq: number; readSeq: number }

export interface ConversationSummary {
  id: string;
  kind: 'direct' | 'group';
  /** The other person in a direct chat. */
  peer: PublicProfile | null;
  /** Name, photo, my role and settings for a group. */
  group: GroupMeta | null;
  /** Whether I can write here right now (not a former member; not an admins-only group). */
  canSend: boolean;
  /** Display name of whoever sent the last message, for "Ali: see you" in group rows. */
  lastSenderName: string | null;
  memberIds: string[];
  lastSeq: number;
  lastMessage: ChatMessage | null;
  /** Messages from others after what I've read (stops counting at 100). */
  unread: number;
  /** How far each member has received and read. Mine included. */
  receipts: Record<string, MemberReceipt>;
  lastActivityAt: string;
}

export interface ConversationPage { items: ConversationSummary[]; next: string | null }
export interface MessagePage { items: ChatMessage[]; hasMore: boolean }
export interface SendResult { message: ChatMessage; duplicate: boolean }
export interface Presence { userId: string; online: boolean; lastSeenAt: string | null }

export type Tick = 'pending' | 'failed' | 'sent' | 'delivered' | 'read';

/** Ticks on my own message: read when every other member has read it, delivered when every other member's device has it. */
export function tickFor(message: Pick<ChatMessage, 'seq' | 'senderId'>, conv: Pick<ConversationSummary, 'receipts' | 'memberIds'>): Tick {
  const others = conv.memberIds.filter((m) => m !== message.senderId);
  if (!others.length) return 'sent';
  const r = others.map((m) => conv.receipts[m] ?? { deliveredSeq: 0, readSeq: 0 });
  if (r.every((x) => x.readSeq >= message.seq)) return 'read';
  if (r.every((x) => x.deliveredSeq >= message.seq || x.readSeq >= message.seq)) return 'delivered';
  return 'sent';
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const objectIdSchema = z.string().regex(/^[a-f0-9]{24}$/i, 'Not a valid id.').transform((s) => s.toLowerCase());
export const clientIdSchema = z.string().regex(UUID_RE, 'clientId must be a UUID.').transform((s) => s.toLowerCase());
export const messageTextSchema = z.string().transform((v, ctx) => {
  const t = v.replace(/\u0000/g, '').trim();
  if (!t) { ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'The message is empty.' }); return z.NEVER; }
  if (textLength(t) > MAX_TEXT) { ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Messages can be up to ${MAX_TEXT} characters.` }); return z.NEVER; }
  return t;
});
export const sendMessageSchema = z.object({ clientId: clientIdSchema, text: messageTextSchema });
export const socketSendSchema = sendMessageSchema.extend({ conversationId: objectIdSchema });
export const receiptSchema = z.object({ seq: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER) });
export const socketReceiptSchema = receiptSchema.extend({ conversationId: objectIdSchema });
export const typingSchema = z.object({ conversationId: objectIdSchema, on: z.boolean() });
export const presenceWatchSchema = z.object({ userIds: z.array(objectIdSchema).max(50) });
export const openDirectSchema = z.object({ userId: objectIdSchema });
const groupName = z.string().transform((v, ctx) => {
  const t = v.replace(/\s+/g, ' ').trim();
  if (!t) { ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Give the group a name.' }); return z.NEVER; }
  if (textLength(t) > MAX_GROUP_NAME) { ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Group names can be up to ${MAX_GROUP_NAME} characters.` }); return z.NEVER; }
  return t;
});
const groupAbout = z.string().transform((v, ctx) => {
  const t = v.trim();
  if (textLength(t) > MAX_GROUP_ABOUT) { ctx.addIssue({ code: z.ZodIssueCode.custom, message: `The description can be up to ${MAX_GROUP_ABOUT} characters.` }); return z.NEVER; }
  return t;
});
export const createGroupSchema = z.object({
  name: groupName,
  about: groupAbout.optional(),
  memberIds: z.array(objectIdSchema).max(MAX_GROUP_MEMBERS - 1, `A group can have up to ${MAX_GROUP_MEMBERS} members.`),
  settings: z.object({ send: z.enum(['all', 'admins']).optional() }).optional(),
});
export const updateGroupSchema = z.object({ name: groupName.optional(), about: groupAbout.optional(), photoKey: z.string().max(512).nullable().optional() })
  .refine((v) => v.name !== undefined || v.about !== undefined || v.photoKey !== undefined, { message: 'Nothing to change.' });
export const groupSettingsSchema = z.object({
  editInfo: z.enum(['all', 'admins']).optional(), send: z.enum(['all', 'admins']).optional(),
  addMembers: z.enum(['all', 'admins']).optional(), pin: z.enum(['all', 'admins']).optional(), approveNew: z.boolean().optional(),
}).refine((v) => Object.keys(v).length > 0, { message: 'Nothing to change.' });
export const addMembersSchema = z.object({ userIds: z.array(objectIdSchema).min(1, 'Pick at least one person.').max(MAX_GROUP_MEMBERS) });
export const inviteCodeSchema = z.string().regex(/^[A-Za-z0-9]{10,32}$/, 'That invite link is not valid.');

/** Server → client socket events. */
export interface ServerEvents {
  'msg:new': (p: { message: ChatMessage }) => void;
  receipt: (p: { conversationId: string; userId: string } & MemberReceipt) => void;
  typing: (p: { conversationId: string; userId: string; on: boolean }) => void;
  presence: (p: Presence) => void;
  /** Something about a chat changed (members, name, settings): fetch its summary again. */
  'conv:update': (p: { conversationId: string }) => void;
}
export type Ack<T> = { ok: true; data: T } | { ok: false; error: { status: number; code: string; message: string; details?: Record<string, unknown> } };
/** Client → server socket events. Every one answers through the acknowledgement callback. */
export interface ClientEvents {
  'msg:send': (p: { conversationId: string; clientId: string; text: string }, ack: (r: Ack<SendResult>) => void) => void;
  'receipt:delivered': (p: { conversationId: string; seq: number }, ack: (r: Ack<MemberReceipt>) => void) => void;
  'receipt:read': (p: { conversationId: string; seq: number }, ack: (r: Ack<MemberReceipt>) => void) => void;
  typing: (p: { conversationId: string; on: boolean }, ack?: (r: Ack<null>) => void) => void;
  'presence:watch': (p: { userIds: string[] }, ack: (r: Ack<Presence[]>) => void) => void;
}

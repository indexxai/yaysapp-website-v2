import { z } from 'zod';
import type { PublicProfile } from './types';

/** Longest text message, counted in characters as people see them (emoji count once). */
export const MAX_TEXT = 4096;
export const textLength = (s: string) => [...s].length;

export interface ChatMessage {
  id: string;
  conversationId: string;
  /** Position in the conversation: 1, 2, 3… with no gaps. Order by this, never by time. */
  seq: number;
  senderId: string;
  /** Chosen by the sending device; sending the same clientId twice never makes two messages. */
  clientId: string;
  type: 'text';
  text: string;
  createdAt: string;
}

export interface MemberReceipt { deliveredSeq: number; readSeq: number }

export interface ConversationSummary {
  id: string;
  kind: 'direct' | 'group';
  /** The other person in a direct chat. */
  peer: PublicProfile | null;
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

/** Server → client socket events. */
export interface ServerEvents {
  'msg:new': (p: { message: ChatMessage }) => void;
  receipt: (p: { conversationId: string; userId: string } & MemberReceipt) => void;
  typing: (p: { conversationId: string; userId: string; on: boolean }) => void;
  presence: (p: Presence) => void;
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

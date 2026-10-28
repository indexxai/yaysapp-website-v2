import { formatDuration, type AttachmentKind } from './chat';
import type { GroupSettings, SystemEvent } from './chat';
/** Times and dates as chats show them, in the device's own time zone. Same on web and mobile. */
const pad = (n: number) => String(n).padStart(2, '0');
export const clock = (iso: string) => { const d = new Date(iso); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
const daysAgo = (iso: string) => Math.round((startOfDay(new Date()) - startOfDay(new Date(iso))) / 86400000);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const shortDate = (d: Date) => `${d.getDate()} ${MONTHS[d.getMonth()]}${d.getFullYear() !== new Date().getFullYear() ? ` ${d.getFullYear()}` : ''}`;
/** Chat list: 14:05, Yesterday, Monday, 3 Oct. */
export function listTime(iso: string) { const n = daysAgo(iso); return n <= 0 ? clock(iso) : n === 1 ? 'Yesterday' : n < 7 ? DAYS[new Date(iso).getDay()] : shortDate(new Date(iso)); }
/** Separator between days inside a chat. */
export function dayLabel(iso: string) { const n = daysAgo(iso); return n <= 0 ? 'Today' : n === 1 ? 'Yesterday' : n < 7 ? DAYS[new Date(iso).getDay()] : shortDate(new Date(iso)); }
export function lastSeen(iso: string) { const n = daysAgo(iso); return n <= 0 ? `last seen today at ${clock(iso)}` : n === 1 ? `last seen yesterday at ${clock(iso)}` : `last seen ${shortDate(new Date(iso))}`; }


/** "Ali", "Ali and Sara", "Ali, Sara and Omar". */
export function listNames(names: string[]) {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

const SETTING_TEXT: Record<keyof GroupSettings, (v: string | boolean) => string> = {
  send: (v) => (v === 'admins' ? 'only admins can send messages' : 'all members can send messages'),
  editInfo: (v) => (v === 'admins' ? "only admins can edit this group's info" : "all members can edit this group's info"),
  addMembers: (v) => (v === 'admins' ? 'only admins can add members' : 'all members can add others'),
  pin: (v) => (v === 'admins' ? 'only admins can pin messages' : 'all members can pin messages'),
  approveNew: (v) => (v ? 'admins approve new members' : 'new members can join without approval'),
};

/**
 * The centred line for a group event. `name(id)` returns a display name, with "You" for the reader.
 * The actor is the message's sender.
 */
export function systemText(e: SystemEvent, actorId: string, name: (id: string) => string): string {
  const a = name(actorId);
  // "You" starts a sentence; anywhere else it is "you".
  const obj = (id: string) => { const n = name(id); return n === 'You' ? 'you' : n; };
  switch (e.kind) {
    case 'created': return `${a} created the group “${e.name}”`;
    case 'added': return `${a} added ${listNames(e.userIds.map(obj))}`;
    case 'removed': return `${a} removed ${listNames(e.userIds.map(obj))}`;
    case 'left': return `${a} left`;
    case 'joined': return e.via === 'link' ? `${a} joined using an invite link` : e.via === 'community' ? `${a} joined from the community` : `${a} joined`;
    case 'community': return e.added ? `${a} added this group to the community “${e.name}”` : `${a} removed this group from the community “${e.name}”`;
    case 'renamed': return `${a} changed the group name to “${e.name}”`;
    case 'about': return `${a} changed the group description`;
    case 'photo': return e.removed ? `${a} removed the group photo` : `${a} changed the group photo`;
    case 'admin': {
      const who = name(e.userId);
      if (e.userId === actorId) return e.on ? `${who === 'You' ? 'You are' : `${who} is`} now an admin` : `${who} stepped down as admin`;
      return e.on ? `${a} made ${obj(e.userId)} an admin` : `${a} dismissed ${obj(e.userId)} as admin`;
    }
    case 'settings': {
      const parts = (Object.entries(e.changes) as Array<[keyof GroupSettings, string | boolean]>).map(([k, v]) => SETTING_TEXT[k]?.(v)).filter(Boolean);
      return `${a} changed the group settings: ${parts.join('; ')}`;
    }
    case 'invite_reset': return `${a} reset the invite link`;
    case 'pinned': return `${a} pinned a message`;
    case 'unpinned': return `${a} unpinned a message`;
    default: return '';
  }
}

const ICON: Record<AttachmentKind, string> = { image: '📷', video: '🎥', voice: '🎤', file: '📄' };
/** "📷 Photo", "🎤 Voice message (0:12)", "📄 brand-guide.pdf". */
export function attachmentLabel(a: { kind: AttachmentKind; name: string; durationMs?: number }) {
  if (a.kind === 'image') return `${ICON.image} Photo`;
  if (a.kind === 'video') return `${ICON.video} Video`;
  if (a.kind === 'voice') return `${ICON.voice} Voice message${a.durationMs ? ` (${formatDuration(a.durationMs)})` : ''}`;
  return `${ICON.file} ${a.name}`;
}
/** One line for a chat list row, a quote or a pin. */
export function messagePreview(m: { text: string; deleted?: boolean; type?: string; attachment?: { kind: AttachmentKind; name: string; durationMs?: number } | null }) {
  if (m.deleted) return 'This message was deleted';
  if (m.type === 'poll') return `📊 ${m.text}`;
  if (m.attachment) return m.text ? `${ICON[m.attachment.kind]} ${m.text}` : attachmentLabel(m.attachment);
  return m.text;
}

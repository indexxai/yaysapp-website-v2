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

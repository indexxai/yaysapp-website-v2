import { createParamDecorator, type ExecutionContext } from '@nestjs/common';

/** A real IANA time zone, or UTC. Days (check-ins, daily limits) follow the person's own midnight. */
export function cleanTz(tz: unknown): string {
  if (typeof tz !== 'string' || !tz || tz.length > 64) return 'UTC';
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return tz; } catch { return 'UTC'; }
}

/** The time zone the app sent in X-Time-Zone (any request), or null. */
export const Tz = createParamDecorator((_d: unknown, ctx: ExecutionContext): string | null => {
  const h = ctx.switchToHttp().getRequest<{ headers: Record<string, string | undefined> }>().headers['x-time-zone'];
  return h ? cleanTz(h) : null;
});

const parts = (d: Date, tz: string) => {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  const o: Record<string, number> = {};
  for (const p of f.formatToParts(d)) if (p.type !== 'literal') o[p.type] = Number(p.value);
  return o as { year: number; month: number; day: number; hour: number; minute: number; second: number };
};

/** "2026-10-31" in that time zone. */
export function dayKey(d: Date, tz: string): string {
  const p = parts(d, tz);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}
/** The day before or after a day key. */
export function shiftDay(key: string, by: number): string {
  const d = new Date(`${key}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + by);
  return d.toISOString().slice(0, 10);
}
/** Monday of the week the day falls in. */
export function weekKey(d: Date, tz: string): string {
  const k = dayKey(d, tz);
  const wd = new Date(`${k}T12:00:00Z`).getUTCDay(); // 0 Sunday
  return shiftDay(k, -((wd + 6) % 7));
}
/** How far this zone is ahead of UTC at that moment, in minutes. */
function offsetMin(d: Date, tz: string) {
  const p = parts(d, tz);
  return Math.round((Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - d.getTime()) / 60000);
}
/** The moment a day key starts in that zone. */
export function startOf(key: string, tz: string): Date {
  const guess = new Date(`${key}T00:00:00Z`);
  const t = guess.getTime() - offsetMin(guess, tz) * 60000;
  // Once more, in case the offset differs at the real midnight (daylight saving).
  return new Date(guess.getTime() - offsetMin(new Date(t), tz) * 60000);
}
export const nextMidnight = (d: Date, tz: string) => startOf(shiftDay(dayKey(d, tz), 1), tz);
export const endOfWeek = (d: Date, tz: string) => startOf(shiftDay(weekKey(d, tz), 7), tz);

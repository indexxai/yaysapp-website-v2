import { API_URL } from './links';

/** Daily check-in rewards, day 1 to 7 (the same as the app: packages/shared CHECKIN_POINTS). */
export const CHECKIN_POINTS = [10, 10, 15, 15, 20, 20, 50] as const;

/** The Indexx products shown on the site (the same list as the app's Explore). */
export const PRODUCTS = [
  { id: 'btcy', name: 'BTCY', sub: 'Mining and Nuggets', logo: '/brand/products/btcy.png', live: true },
  { id: 'emmm', name: 'EMMM', sub: 'Prediction markets', logo: '/brand/products/emmm.png', live: true },
  { id: 'shoperpal', name: 'ShoperPal', sub: 'Shopping deals', logo: '/brand/products/shoperpal.png', live: true },
  { id: 'rehuman', name: 'ReHuman', sub: 'Wellness', logo: '/brand/products/rehuman.png', live: true },
  { id: 'wallstreet', name: 'Wall Street Indexx', sub: 'Markets', logo: '/brand/products/wallstreet.png', live: true },
  { id: 'academy', name: 'Academy', sub: 'Coming soon', logo: '/brand/products/academy.png', live: false },
] as const;

export class SiteError extends Error {}
async function post<T>(path: string, body: unknown): Promise<T> {
  let r: Response;
  try { r = await fetch(`${API_URL}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); }
  catch { throw new SiteError('Can’t reach YaysApp right now. Check your connection and try again.'); }
  const j = await r.json().catch(() => ({})) as { error?: { message?: string } } & T;
  if (!r.ok) throw new SiteError(j.error?.message ?? 'Something went wrong. Try again.');
  return j;
}
/** Ask Jack's AI about YaysApp (no account needed). */
export const siteAsk = (messages: Array<{ role: 'user' | 'assistant'; text: string }>) => post<{ text: string }>('/v1/site/ask', { messages });
/** Pass a question to the YaysApp team. */
export const siteLead = (v: { name: string; email: string; question: string; consent: true }) => post<void>('/v1/site/leads', v);

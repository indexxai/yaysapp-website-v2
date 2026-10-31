'use client';
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { ApiError } from '@yays/shared';
import { api } from './api';

/* ---- the points balance on the rail: one copy, refreshed when anything changes it ---- */
let balance: number | null = null;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
export function setBalance(n: number) { balance = n; emit(); }
export async function refreshBalance() { try { setBalance((await api().points()).balance); } catch { /* signed out or offline */ } }
export function useBalance() {
  const n = useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => balance, () => null);
  useEffect(() => { if (balance === null) void refreshBalance(); }, []);
  return n;
}

/* ---- loading any one thing from the API ---- */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const load = useCallback(async () => { try { setData(await fn()); setError(null); } catch (e) { setError(errText(e)); } }, deps);
  useEffect(() => { void load(); }, [load]);
  return { data, setData, error, reload: load };
}
export const errText = (e: unknown, fallback = 'Something went wrong. Try again.') => (e instanceof ApiError ? e.message : fallback);

/* ---- numbers ---- */
export const fmtPoints = (n: number) => n.toLocaleString('en-US');
export const fmtUsd = (cents: number) => `$${(Math.abs(cents) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const fmtNuggets = (n: number, dp = 2) => n.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: 4 });
export const pct = (done: number, of: number) => `${Math.round((Math.min(done, of) / Math.max(of, 1)) * 100)}%`;

/** "7h 12m", "4d 6h" or "12m" until a moment. */
export function timeLeft(iso: string, now = Date.now()) {
  const m = Math.max(0, Math.round((Date.parse(iso) - now) / 60000));
  const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mm = m % 60;
  return d ? `${d}d ${h}h` : h ? `${h}h ${mm}m` : `${mm}m`;
}
export function when(iso: string) {
  const d = new Date(iso), now = new Date();
  const y = new Date(now); y.setDate(now.getDate() - 1);
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === now.toDateString()) return `Today, ${time}`;
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  if (now.getTime() - d.getTime() < 6 * 86400_000) return d.toLocaleDateString([], { weekday: 'short' });
  return d.toLocaleDateString([], { day: 'numeric', month: 'short' });
}

/** A short progress bar (tasks, limits). */
export function Bar({ done, of, width }: { done: number; of: number; width?: number | string }) {
  return <span className="p2-bar" style={{ width }} role="progressbar" aria-valuemin={0} aria-valuemax={of} aria-valuenow={Math.min(done, of)}><span style={{ width: pct(done, of) }} /></span>;
}

/* ---- invite codes from links (?ref=SARA-7K2), kept until the person has an account ---- */
const REF_KEY = 'yays.ref';
export function rememberRef(code: string | null) { if (code && /^[A-Za-z0-9]{2,12}-[A-Za-z0-9]{3}$/.test(code)) try { localStorage.setItem(REF_KEY, code.toUpperCase()); } catch { /* private mode */ } }
/** After sign-in: tell the server who invited this person, once. */
export async function applyStoredRef() {
  let code: string | null = null;
  try { code = localStorage.getItem(REF_KEY); } catch { return; }
  if (!code) return;
  try { await api().useReferralCode(code); localStorage.removeItem(REF_KEY); }
  catch (e) { if (e instanceof ApiError && e.status >= 400 && e.status < 500) try { localStorage.removeItem(REF_KEY); } catch { /* ignore */ } }
}
export const inviteLink = (code: string) => `${typeof location !== 'undefined' ? location.origin : 'https://yaysapp.com'}/?ref=${encodeURIComponent(code)}`;

export const PRODUCTS = [
  { id: 'btcy', name: 'BTCY', sub: 'Mining and Nuggets', logo: '/brand/products/btcy.png', href: '/btcy' },
  { id: 'emmm', name: 'EMMM', sub: 'Prediction markets', logo: '/brand/products/emmm.png', href: '/products?tab=emmm' },
  { id: 'shoperpal', name: 'ShoperPal', sub: 'Shopping deals', logo: '/brand/products/shoperpal.png', href: '/products?tab=shoperpal' },
  { id: 'rehuman', name: 'ReHuman', sub: 'Wellness', logo: '/brand/products/rehuman.png', href: '/products?tab=rehuman' },
  { id: 'wallstreet', name: 'Wall Street Indexx', sub: 'Markets', logo: '/brand/products/wallstreet.png', href: '/products?tab=wallstreet' },
  { id: 'academy', name: 'Academy', sub: 'Coming soon', logo: '/brand/products/academy.png', href: null },
] as const;

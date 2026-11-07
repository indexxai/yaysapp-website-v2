'use client';
import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { OvalButton } from './ui';

/** Links from Explore add this, so the page they open can offer a way back to Explore. */
export const FROM_EXPLORE = 'from=explore';
export const fromExplore = (href: string) => `${href}${href.includes('?') ? '&' : '?'}${FROM_EXPLORE}`;

/**
 * The page's back button. Opened from Explore: back to Explore. Otherwise back to `to` (its usual parent),
 * or nothing when the page has no parent (it's in the side bar).
 */
export function BackButton(p: { to?: string; label?: string }) {
  return <Suspense fallback={p.to ? <Back href={p.to} label={p.label ?? 'Back'} /> : null}><Inner {...p} /></Suspense>;
}
function Inner({ to, label }: { to?: string; label?: string }) {
  const explore = useSearchParams().get('from') === 'explore';
  if (explore) return <Back href="/explore" label="Explore" />;
  return to ? <Back href={to} label={label ?? 'Back'} /> : null;
}
function Back({ href, label }: { href: string; label: string }) {
  return <OvalButton icon="arrow-left" label={label} size="sm" variant="ghost" href={href} />;
}

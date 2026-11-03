'use client';
import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { AppShell } from '@/components/app-shell';
import { CircleBgArt } from '@/components/circles/common';
import { EventPageBody } from '@/components/circles/events';
import { useMe } from '@/components/use-me';

export default function EventPage() { return <Suspense fallback={null}><Event /></Suspense>; }

/** W20 / p39: one event. */
function Event() {
  const { me } = useMe();
  const id = useSearchParams().get('id');
  return <AppShell me={me} bare><div className="cpage-wrap"><div className="cpage cpage--flush">{me && id && <EventPageBody key={id} id={id} me={me} />}</div><CircleBgArt name="trader" side="right" /></div></AppShell>;
}

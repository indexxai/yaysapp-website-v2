'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/app-shell';
import { CircleBgArt } from '@/components/circles/common';
import { CreateCircleDialog, Discover } from '@/components/circles/circle';
import { useMe } from '@/components/use-me';

/** W18 / p36: find circles and events. */
export default function DiscoverPage() {
  const { me } = useMe();
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  return (
    <AppShell me={me} bare>
      <div className="cpage-wrap"><div className="cpage">{me && <Discover onNew={() => setCreating(true)} />}</div><CircleBgArt name="explorer" side="right" /></div>
      {creating && <CreateCircleDialog onClose={() => setCreating(false)} onCreated={(id) => router.push(`/circles?id=${id}`)} />}
    </AppShell>
  );
}

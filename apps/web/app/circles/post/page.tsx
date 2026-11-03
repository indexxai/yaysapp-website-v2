'use client';
import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { AppShell } from '@/components/app-shell';
import { CircleBgArt } from '@/components/circles/common';
import { PostPageBody } from '@/components/circles/feed';
import { useMe } from '@/components/use-me';

export default function PostPage() { return <Suspense fallback={null}><Post /></Suspense>; }

/** p38: a post with its comments. */
function Post() {
  const { me } = useMe();
  const id = useSearchParams().get('id');
  return <AppShell me={me} bare><div className="cpage-wrap"><div className="cpage">{me && id && <PostPageBody key={id} id={id} me={me} />}</div><CircleBgArt name="reader" side="left" /></div></AppShell>;
}

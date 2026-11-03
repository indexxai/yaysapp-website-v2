'use client';
import { Suspense, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

export default function CommunitiesPage() { return <Suspense fallback={null}><Moved /></Suspense>; }

/** Communities are now Circles. Old links still work. */
function Moved() {
  const router = useRouter();
  const id = useSearchParams().get('id');
  useEffect(() => { router.replace(id ? `/circles?id=${encodeURIComponent(id)}&tab=chats` : '/circles'); }, [router, id]);
  return null;
}

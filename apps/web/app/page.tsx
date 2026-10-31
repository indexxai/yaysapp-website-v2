'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Landing } from '@/components/landing';
import { hasSession } from '@/lib/api';
import { rememberRef } from '@/lib/phase2';

/** Signed in: straight to chats. Everyone else sees the website (W7). An invite link (?ref=CODE) is kept for sign-up. */
export default function Home() {
  const router = useRouter();
  const [show, setShow] = useState(false);
  useEffect(() => {
    rememberRef(new URLSearchParams(location.search).get('ref'));
    if (hasSession()) router.replace('/chats'); else setShow(true);
  }, [router]);
  if (!show) return <main aria-busy="true" style={{ minHeight: '100vh', background: 'var(--ground)' }} />;
  return <Landing />;
}

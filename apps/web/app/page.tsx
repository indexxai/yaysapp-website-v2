'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Landing } from '@/components/landing';
import { hasSession } from '@/lib/api';
import { rememberRef } from '@/lib/phase2';

/**
 * Signed in: straight to chats. An invite link (?ref=CODE, also sent before invites pointed at /sign-in) goes to
 * sign-up with the code kept. Everyone else sees the website (W7).
 */
export default function Home() {
  const router = useRouter();
  const [show, setShow] = useState(false);
  useEffect(() => {
    const ref = new URLSearchParams(location.search).get('ref');
    rememberRef(ref);
    if (hasSession()) router.replace('/chats');
    else if (ref) router.replace(`/sign-in?ref=${encodeURIComponent(ref)}`);
    else setShow(true);
  }, [router]);
  if (!show) return <main aria-busy="true" style={{ minHeight: '100vh', background: 'var(--ground)' }} />;
  return <Landing />;
}

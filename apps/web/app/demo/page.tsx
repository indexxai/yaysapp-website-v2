'use client';
import { useEffect, useState } from 'react';
import { notFound, useRouter } from 'next/navigation';
import { AuthShell } from '@/components/auth-shell';
import { Banner } from '@/components/ui';

/**
 * Local demo only: `pnpm demo` prints a link to here with a signed-in session in the #fragment
 * (the fragment never reaches a server). This page saves it the way sign-in would and opens the chats.
 * Not part of production builds.
 */
export default function DemoSignIn() {
  if (process.env.NODE_ENV === 'production') notFound();
  return <Demo />;
}

function Demo() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    try {
      const raw = location.hash.slice(1);
      if (!raw) { setError('This link has no demo session in it. Run pnpm demo again and open the link it prints.'); return; }
      const json = atob(raw.replace(/-/g, '+').replace(/_/g, '/'));
      const { tokens, deviceId } = JSON.parse(json) as { tokens: unknown; deviceId?: string };
      for (const k of Object.keys(localStorage)) if (k.startsWith('yays.cache.') || k.startsWith('yays.outbox.')) localStorage.removeItem(k);
      sessionStorage.removeItem('yays.tokens');
      localStorage.setItem('yays.keep', '1');
      localStorage.setItem('yays.tokens', JSON.stringify(tokens));
      if (deviceId) localStorage.setItem('yays.device', deviceId);
      history.replaceState(null, '', '/demo');
      router.replace('/chats');
    } catch {
      setError('That demo link is damaged. Run pnpm demo again and open the link it prints.');
    }
  }, [router]);
  return (
    <AuthShell art="morning">
      <div><h1>Opening the demo…</h1><p className="lead">Signing you in as the demo account.</p></div>
      {error ? <Banner>{error}</Banner> : <span className="ys-spin" aria-label="Loading" />}
    </AuthShell>
  );
}

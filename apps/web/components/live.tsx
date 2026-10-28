'use client';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api, hasSession } from '@/lib/api';
import { ChatProvider } from '@/lib/chat';
import { CallLayer, CallsProvider } from './call';

/**
 * While signed in, one live connection serves every page: messages keep arriving and calls ring and stay
 * connected while you move between Chats, Calls and Settings.
 */
export function Live({ children }: { children: ReactNode }) {
  const path = usePathname();
  // init: before the browser knows whether it is signed in. Pages mount once, after this is settled.
  const [me, setMe] = useState<string | null | 'init'>('init');
  useEffect(() => {
    if (!hasSession()) { setMe(null); return; }
    if (me === null) { setMe('init'); return; } // just signed in
    if (me === 'init') void api().me().then((m) => setMe(m.id)).catch(() => setMe(null));
  }, [path, me]);
  // Pages send a signed-out browser to sign-in themselves (sometimes with a notice, like after deleting the
  // account); the live connection is dropped when that page change happens (the effect above), not before,
  // so the page isn't torn down mid-way.
  const signedOut = useCallback(() => undefined, []);
  if (me === 'init') return <div className="pane-center" style={{ minHeight: '100vh' }}><span className="ys-spin" aria-label="Loading" /></div>;
  if (!me) return <>{children}</>;
  return (
    <ChatProvider me={me} onSignedOut={signedOut}>
      <CallsProvider>
        {children}
        <CallLayer />
      </CallsProvider>
    </ChatProvider>
  );
}

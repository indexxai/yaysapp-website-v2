'use client';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { ApiError, type MeProfile } from '@yays/shared';
import { api, hasSession, onSignedOut } from '@/lib/api';

/** Loads the signed-in person; sends anyone signed out to /sign-in. */
export function useMe() {
  const router = useRouter();
  const [me, setMe] = useState<MeProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try { setMe(await api().me()); setError(null); }
    catch (e) { if (e instanceof ApiError && (e.status === 401 || e.status === 403)) router.replace('/sign-in'); else setError(e instanceof ApiError ? e.message : 'Could not load your profile.'); }
  }, [router]);
  useEffect(() => {
    if (!hasSession()) { router.replace('/sign-in'); return; }
    void load();
    return onSignedOut(() => router.replace('/sign-in'));
  }, [load, router]);
  return { me, setMe, error, reload: load };
}

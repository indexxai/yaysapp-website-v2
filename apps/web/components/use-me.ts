'use client';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { ApiError, type MeProfile } from '@yays/shared';
import { api, hasSession, onSignedOut } from '@/lib/api';
import { adoptPrefs } from '@/lib/prefs';

/** Loads the signed-in person; sends anyone signed out to /sign-in. */
export function useMe() {
  const router = useRouter();
  const [me, setMe] = useState<MeProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try { const m = await api().me(); adoptPrefs(m.preferences); setMe(m); setError(null); }
    catch (e) {
      // Signed out, turned off or deleted: forget this browser's session too, or sign-in would send it straight back.
      if (e instanceof ApiError && (e.status === 401 || e.status === 403)) { await api().logout().catch(() => undefined); router.replace('/sign-in'); }
      else setError(e instanceof ApiError ? e.message : 'Could not load your profile.'); }
  }, [router]);
  useEffect(() => {
    if (!hasSession()) { router.replace('/sign-in'); return; }
    void load();
    return onSignedOut(() => router.replace('/sign-in'));
  }, [load, router]);
  return { me, setMe, error, reload: load };
}

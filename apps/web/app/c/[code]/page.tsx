'use client';
import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ApiError, type CommunityInvitePreview } from '@yays/shared';
import { api } from '@/lib/api';
import { AppShell } from '@/components/app-shell';
import { CommunityMark } from '@/components/community';
import { Banner, OvalButton } from '@/components/ui';
import { useMe } from '@/components/use-me';

/** Opening a community invite link: see it, then join (or ask to). */
export default function CommunityInvite() {
  const { me } = useMe();
  const router = useRouter();
  const { code } = useParams<{ code: string }>();
  const [p, setP] = useState<CommunityInvitePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => api().previewCommunityInvite(code).then(setP, (e) => setError(e instanceof ApiError ? e.message : 'Could not open this invite.')), [code]);
  useEffect(() => { if (me) void load(); }, [me, load]);
  const act = async (fn: () => Promise<unknown>) => { setBusy(true); setError(null); try { await fn(); } catch (e) { setError(e instanceof ApiError ? e.message : 'That did not work. Try again.'); } finally { setBusy(false); } };
  return (
    <AppShell me={me}>
      <div className="join-card card" aria-label="Community invite">
        {error && <Banner>{error}</Banner>}
        {!p && !error && <span className="ys-spin" aria-label="Loading" />}
        {p && (
          <>
            <CommunityMark c={p} size={96} />
            <h1>{p.name}</h1>
            <span className="muted">Community · {p.memberCount.toLocaleString()} member{p.memberCount === 1 ? '' : 's'} · {p.groupCount} group{p.groupCount === 1 ? '' : 's'}</span>
            {p.about && <p>{p.about}</p>}
            {p.alreadyMember ? <OvalButton icon="people" label="Open community" size="lg" onClick={() => router.push(`/communities?id=${p.id}`)} />
              : p.requested ? (
                <>
                  <Banner tone="info">Your request was sent. An admin will let you in.</Banner>
                  <OvalButton icon="close" label="Cancel request" variant="ghost" loading={busy} onClick={() => void act(async () => { await api().cancelCommunityRequest(code); await load(); })} />
                </>
              ) : (
                <>
                  {p.needsApproval && <span className="muted">An admin approves new members.</span>}
                  <OvalButton icon={p.needsApproval ? 'person-add' : 'check'} label={p.needsApproval ? 'Ask to join' : 'Join community'} size="lg" loading={busy}
                    onClick={() => void act(async () => { const r = await api().joinCommunity(code); if (r.status === 'joined') router.push(`/communities?id=${r.community.id}`); else await load(); })} />
                </>
              )}
          </>
        )}
      </div>
    </AppShell>
  );
}

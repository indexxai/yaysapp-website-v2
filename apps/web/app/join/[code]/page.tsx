'use client';
import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ApiError, type InvitePreview } from '@yays/shared';
import { AppShell } from '@/components/app-shell';
import { Avatar, Banner, OvalButton } from '@/components/ui';
import { useMe } from '@/components/use-me';
import { ChatProvider, useEngine } from '@/lib/chat';

/** Opening a group invite link: see the group, then join (or ask to join). */
export default function JoinPage() {
  const { me } = useMe();
  const router = useRouter();
  const signedOut = useCallback(() => router.replace('/sign-in'), [router]);
  return (
    <AppShell me={me}>
      {me ? <ChatProvider me={me.id} onSignedOut={signedOut}><Join /></ChatProvider> : <div className="pane-center"><span className="ys-spin" aria-label="Loading" /></div>}
    </AppShell>
  );
}

function Join() {
  const engine = useEngine();
  const router = useRouter();
  const { code } = useParams<{ code: string }>();
  const [p, setP] = useState<InvitePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => engine.invitePreview(code).then(setP, (e) => setError(e instanceof ApiError ? e.message : 'Could not open this invite. Check your connection.')), [engine, code]);
  useEffect(() => { void load(); }, [load]);
  const act = async (fn: () => Promise<unknown>) => { setBusy(true); setError(null); try { await fn(); } catch (e) { setError(e instanceof ApiError ? e.message : 'That did not work. Try again.'); } finally { setBusy(false); } };
  return (
    <div className="join-card card" aria-label="Group invite">
      {error && <Banner>{error}</Banner>}
      {!p && !error && <span className="ys-spin" aria-label="Loading" />}
      {p && (
        <>
          <Avatar name={p.name} photoUrl={p.photoUrl} size={96} />
          <h1>{p.name}</h1>
          <span className="muted">Group · {p.memberCount} member{p.memberCount === 1 ? '' : 's'}</span>
          {p.about && <p>{p.about}</p>}
          {p.alreadyMember ? <OvalButton icon="chat" label="Open chat" size="lg" onClick={() => router.push(`/chats?c=${p.conversationId}`)} />
            : p.requested ? (
              <>
                <Banner tone="info">Your request was sent. An admin will let you in.</Banner>
                <OvalButton icon="close" label="Cancel request" variant="ghost" loading={busy} onClick={() => void act(async () => { await engine.cancelJoinRequest(code); await load(); })} />
              </>
            ) : (
              <>
                {p.needsApproval && <span className="muted">An admin approves new members.</span>}
                <OvalButton icon={p.needsApproval ? 'person-add' : 'check'} label={p.needsApproval ? 'Request to join' : 'Join group'} size="lg" loading={busy}
                  onClick={() => void act(async () => { const r = await engine.joinInvite(code); if (r.status === 'joined') router.push(`/chats?c=${r.conversation.id}`); else await load(); })} />
              </>
            )}
        </>
      )}
    </div>
  );
}

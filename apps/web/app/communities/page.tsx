'use client';
import { Suspense, useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { CommunitySummary } from '@yays/shared';
import { api } from '@/lib/api';
import { Icon } from '@/lib/icons';
import { AppShell } from '@/components/app-shell';
import { CommunityList, CommunityView, CreateCommunityDialog } from '@/components/community';
import { Banner, OvalButton } from '@/components/ui';
import { useMe } from '@/components/use-me';

export default function CommunitiesPage() { return <Suspense fallback={null}><Communities /></Suspense>; }

function Communities() {
  const { me, error } = useMe();
  const router = useRouter();
  const params = useSearchParams();
  const active = params.get('id');
  const [list, setList] = useState<CommunitySummary[] | null>(null);
  const [creating, setCreating] = useState(false);
  const load = useCallback(() => api().communities().then(setList, () => setList([])), []);
  useEffect(() => { if (me) void load(); }, [me, load]);
  const open = (id: string) => router.push(`/communities?id=${id}`);
  return (
    <AppShell me={me} bare>
      <div className={`chats${active ? ' chats--open' : ''}`}>
        <aside className="chats__list" aria-label="Your communities">
          <div className="chats__head">
            <h1>Communities</h1>
            <OvalButton icon="plus" label="New" size="sm" onClick={() => setCreating(true)} />
          </div>
          {error ? <Banner>{error}</Banner> : <CommunityList list={list} active={active} onOpen={open} onNew={() => setCreating(true)} />}
        </aside>
        <main className="chats__pane">
          {active && me ? <CommunityView key={active} id={active} onChanged={() => void load()} onLeft={() => { void load(); router.push('/communities'); }} /> : (
            <div className="pane-center pane-welcome">
              <span className="ys-oval ys-oval--wash" style={{ width: 96 }}><Icon name="people" size={40} /></span>
              <strong>Communities</strong>
              <span>Bring related groups together under one roof, with an announcements group that reaches every member.</span>
              <OvalButton icon="plus" label="New community" size="md" onClick={() => setCreating(true)} />
            </div>
          )}
        </main>
      </div>
      {creating && <CreateCommunityDialog onClose={() => setCreating(false)} onCreated={(id) => { setCreating(false); void load(); open(id); }} />}
    </AppShell>
  );
}

'use client';
import { Suspense, useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AppShell } from '@/components/app-shell';
import { ChatList, ConnectionNotice, Conversation, NewChat } from '@/components/chat';
import { GroupInfoPanel, NewGroup } from '@/components/group';
import { Attention, NotifyBanner } from '@/components/notify';
import { SearchPanel } from '@/components/search';
import { Banner, OvalButton } from '@/components/ui';
import { useMe } from '@/components/use-me';
import { ChatProvider, useChatState } from '@/lib/chat';
import { Icon } from '@/lib/icons';

export default function ChatsPage() {
  return <Suspense fallback={null}><Chats /></Suspense>;
}

function Chats() {
  const { me, error } = useMe();
  const router = useRouter();
  const signedOut = useCallback(() => router.replace('/sign-in'), [router]);
  if (!me) {
    return <AppShell me={null}><div className="pane-center">{error ? <Banner>{error}</Banner> : <span className="ys-spin" aria-label="Loading" />}</div></AppShell>;
  }
  return (
    <AppShell me={me} bare>
      <ChatProvider me={me.id} onSignedOut={signedOut}>
        <ChatsLayout name={me.displayName} migrated={me.migrated} />
      </ChatProvider>
    </AppShell>
  );
}

function ChatsLayout({ name, migrated }: { name: string; migrated: boolean }) {
  const router = useRouter();
  const params = useSearchParams();
  const active = params.get('c');
  const [panel, setPanel] = useState<'list' | 'chat' | 'group' | 'search'>('list');
  const jumpSeq = Number(params.get('m')) || undefined;
  const [info, setInfo] = useState(params.get('info') === '1');
  const s = useChatState();
  const open = useCallback((id: string) => { setPanel('list'); router.push(`/chats?c=${id}`); }, [router]);
  // From search: the results stay on the left so you can try the next one.
  const openFound = useCallback((id: string, seq?: number) => { router.push(`/chats?c=${id}${seq ? `&m=${seq}` : ''}`); }, [router]);
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPanel('search'); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const back = useCallback(() => { setInfo(false); router.push('/chats'); }, [router]);
  // Info only makes sense for an open group.
  const isGroup = !!active && s.conversations[active]?.kind === 'group';
  useEffect(() => { if (!isGroup) setInfo(false); }, [isGroup]);
  return (
    <div className={`chats${active ? ' chats--open' : ''}${info && isGroup ? ' chats--info' : ''}`}>
      <aside className="chats__list" aria-label="Chat list">
        {panel === 'chat' ? <NewChat onClose={() => setPanel('list')} onOpened={open} />
          : panel === 'group' ? <NewGroup onClose={() => setPanel('list')} onCreated={open} />
          : panel === 'search' ? <SearchPanel onClose={() => setPanel('list')} onOpen={openFound} />
          : (
            <>
              <div className="chats__head">
                <h1>Chats</h1>
                <div className="row" style={{ gap: 12 }}>
                  <OvalButton icon="edit" label="New chat" size="sm" onClick={() => setPanel('chat')} />
                  <OvalButton icon="people" label="New group" size="sm" variant="soft" onClick={() => setPanel('group')} />
                </div>
              </div>
              <button type="button" className="list-search" onClick={() => setPanel('search')} aria-label="Search chats, people and messages" aria-keyshortcuts="Control+K">
                <Icon name="search" size={18} /><span>Search chats, people and messages</span><kbd>Ctrl K</kbd>
              </button>
              <ConnectionNotice />
              <NotifyBanner />
              <ChatList activeId={active} onOpen={open} onNewChat={() => setPanel('chat')} />
            </>
          )}
      </aside>
      <main className="chats__pane">
        {active ? <Conversation id={active} jumpSeq={jumpSeq} onBack={back} onInfo={() => setInfo((v) => !v)} infoOpen={info} /> : (
          <div className="pane-center pane-welcome" data-testid="chats-ready">
            <span className="ys-oval ys-oval--wash" style={{ width: 96 }}><Icon name="chat" size={40} /></span>
            <strong>Welcome, {name}</strong>
            <span>{migrated ? 'Your account from the old YaysApp is connected.' : 'Your account is ready.'} Pick a chat on the left, or start a new one.</span>
          </div>
        )}
      </main>
      <Attention />
      {active && isGroup && info && <GroupInfoPanel id={active} onClose={() => setInfo(false)} onLeft={() => setInfo(false)} />}
    </div>
  );
}

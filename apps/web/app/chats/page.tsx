'use client';
import { Suspense, useCallback, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AppShell } from '@/components/app-shell';
import { ChatList, ConnectionNotice, Conversation, NewChat } from '@/components/chat';
import { Banner, OvalButton } from '@/components/ui';
import { useMe } from '@/components/use-me';
import { ChatProvider } from '@/lib/chat';
import { Icon } from '@/lib/icons';

export default function ChatsPage() {
  return <Suspense fallback={null}><Chats /></Suspense>;
}

function Chats() {
  const { me, error } = useMe();
  const router = useRouter();
  const active = useSearchParams().get('c');
  const [newChat, setNewChat] = useState(false);
  const signedOut = useCallback(() => router.replace('/sign-in'), [router]);
  const open = useCallback((id: string) => { setNewChat(false); router.push(`/chats?c=${id}`); }, [router]);
  const back = useCallback(() => router.push('/chats'), [router]);

  if (!me) {
    return <AppShell me={null}><div className="pane-center">{error ? <Banner>{error}</Banner> : <span className="ys-spin" aria-label="Loading" />}</div></AppShell>;
  }
  return (
    <AppShell me={me} bare>
      <ChatProvider me={me.id} onSignedOut={signedOut}>
        <div className={`chats${active ? ' chats--open' : ''}`}>
          <aside className="chats__list" aria-label="Chat list">
            {newChat ? <NewChat onClose={() => setNewChat(false)} onOpened={open} /> : (
              <>
                <div className="chats__head">
                  <h1>Chats</h1>
                  <OvalButton icon="edit" label="New chat" size="sm" onClick={() => setNewChat(true)} />
                </div>
                <ConnectionNotice />
                <ChatList activeId={active} onOpen={open} onNewChat={() => setNewChat(true)} />
              </>
            )}
          </aside>
          <main className="chats__pane">
            {active ? <Conversation id={active} onBack={back} /> : (
              <div className="pane-center pane-welcome" data-testid="chats-ready">
                <span className="ys-oval ys-oval--wash" style={{ width: 96 }}><Icon name="chat" size={40} /></span>
                <strong>Welcome, {me.displayName}</strong>
                <span>{me.migrated ? 'Your account from the old YaysApp is connected.' : 'Your account is ready.'} Pick a chat on the left, or start a new one.</span>
              </div>
            )}
          </main>
        </div>
      </ChatProvider>
    </AppShell>
  );
}

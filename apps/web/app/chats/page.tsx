'use client';
import { Suspense, useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AppShell } from '@/components/app-shell';
import { ArchivedList, ChatList, ConnectionNotice, Conversation, NewChat } from '@/components/chat';
import { ContactInfoPanel } from '@/components/contact';
import { GroupInfoPanel, NewGroup } from '@/components/group';
import { Attention, NotifyBanner } from '@/components/notify';
import { SearchPanel } from '@/components/search';
import { Banner, LineArt, OvalButton, shareInvite } from '@/components/ui';
import { useMe } from '@/components/use-me';
import { ChatProvider, useChatState, useEngine } from '@/lib/chat';
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

/** Shares a link to YaysApp (or copies it when the browser can't share). */
function InviteButton() {
  const [done, setDone] = useState(false);
  const invite = async () => { if (await shareInvite()) { setDone(true); setTimeout(() => setDone(false), 2000); } };
  return <OvalButton icon={done ? 'check' : 'person-add'} label={done ? 'Link copied' : 'Invite'} size="lg" variant="soft" onClick={() => void invite()} />;
}

function ChatsLayout({ name, migrated }: { name: string; migrated: boolean }) {
  const router = useRouter();
  const params = useSearchParams();
  const active = params.get('c');
  const [panel, setPanel] = useState<'list' | 'chat' | 'search' | 'archived'>('list');
  const [newGroup, setNewGroup] = useState(false);
  const [searchNonce, setSearchNonce] = useState(0);
  const jumpSeq = Number(params.get('m')) || undefined;
  const [info, setInfo] = useState(params.get('info') === '1');
  const s = useChatState();
  const engine = useEngine();
  const open = useCallback((id: string) => { setPanel('list'); router.push(`/chats?c=${id}`); }, [router]);
  // From search: the results stay on the left so you can try the next one.
  const openFound = useCallback((id: string, seq?: number) => { router.push(`/chats?c=${id}${seq ? `&m=${seq}&j=${Date.now()}` : ''}`); }, [router]);
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPanel('search'); return; }
      if (e.altKey && !e.ctrlKey && !e.metaKey && e.code === 'KeyN') { e.preventDefault(); setPanel('chat'); return; }
      if (e.altKey && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
        e.preventDefault();
        const st = engine.getState();
        const list = st.order.filter((id) => st.conversations[id] && !st.conversations[id]!.archived);
        if (!list.length) return;
        const cur = new URLSearchParams(window.location.search).get('c');
        const i = cur ? list.indexOf(cur) : -1;
        const next = list[Math.max(0, Math.min(list.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))] ?? list[0]!;
        router.push(`/chats?c=${next}`);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [engine, router]);
  const back = useCallback(() => { setInfo(false); router.push('/chats'); }, [router]);
  const kind = active ? s.conversations[active]?.kind : undefined;
  const isGroup = kind === 'group';
  useEffect(() => { if (!active) setInfo(false); }, [active]);
  return (
    <div className={`chats${active ? ' chats--open' : ''}${info && kind ? ' chats--info' : ''}`}>
      <aside className="chats__list" aria-label="Chat list">
        {panel === 'chat' ? <NewChat onClose={() => setPanel('list')} onOpened={open} />
          : panel === 'search' ? <SearchPanel onClose={() => setPanel('list')} onOpen={openFound} />
          : panel === 'archived' ? <ArchivedList activeId={active} onOpen={(id) => router.push(`/chats?c=${id}`)} onClose={() => setPanel('list')} />
          : (
            <>
              <div className="chats__head">
                <h1>Chats</h1>
                <div className="row" style={{ gap: 12 }}>
                  <OvalButton icon="edit" label="New chat" size="sm" onClick={() => setPanel('chat')} />
                  <OvalButton icon="people" label="New group" size="sm" variant="soft" onClick={() => setNewGroup(true)} />
                </div>
              </div>
              <button type="button" className="list-search" onClick={() => setPanel('search')} aria-label="Search chats, people and messages" aria-keyshortcuts="Control+K">
                <Icon name="search" size={18} /><span>Search chats, people and messages</span><kbd>Ctrl K</kbd>
              </button>
              <ConnectionNotice />
              <NotifyBanner />
              <ChatList activeId={active} onOpen={open} onNewChat={() => setPanel('chat')} onArchived={() => setPanel('archived')} />
            </>
          )}
      </aside>
      <main className="chats__pane">
        {active ? <Conversation id={active} jumpSeq={jumpSeq} jumpKey={params.get('j') ?? ''} searchNonce={searchNonce} onBack={back} onInfo={() => setInfo((v) => !v)} infoOpen={info} /> : (
          <div className="pane-center pane-welcome" data-testid="chats-ready">
            <span className="ys-feature__deco a" style={{ width: 520, top: -220, right: -160, opacity: 0.5 }} aria-hidden />
            <span className="ys-feature__deco c" style={{ width: 300, bottom: -120, left: -100, opacity: 0.5 }} aria-hidden />
            <div className="pane-welcome__body">
              <LineArt name="chat" width={230} className="pane-welcome__art" />
              <h2 className="pane-welcome__title">Pick a chat to start</h2>
              <p>Choose a conversation on the left, or start something new. Welcome, {name}. {migrated ? 'Your account from the old YaysApp is connected.' : 'Your account is ready.'}</p>
              <div className="row" style={{ gap: 28, marginTop: 6, justifyContent: 'center' }}>
                <OvalButton icon="edit" label="New chat" size="lg" onClick={() => setPanel('chat')} />
                <OvalButton icon="people" label="New group" size="lg" variant="soft" onClick={() => setNewGroup(true)} />
                <InviteButton />
              </div>
              <div className="shortcuts" aria-label="Keyboard shortcuts">
                <span><kbd>Ctrl</kbd> <kbd>K</kbd></span><span>Search</span>
                <span><kbd>Alt</kbd> <kbd>N</kbd></span><span>New chat</span>
                <span><kbd>Alt</kbd> <kbd>↑</kbd> <kbd>↓</kbd></span><span>Move between chats</span>
              </div>
            </div>
          </div>
        )}
      </main>
      <Attention />
      {newGroup && <NewGroup onClose={() => setNewGroup(false)} onCreated={(id) => { setNewGroup(false); open(id); }} />}
      {active && isGroup && info && <GroupInfoPanel id={active} onClose={() => setInfo(false)} onLeft={() => setInfo(false)} />}
      {active && kind === 'direct' && info && (
        <ContactInfoPanel id={active} onClose={() => setInfo(false)} onJump={(seq) => openFound(active, seq)} onSearch={() => { setSearchNonce((n) => n + 1); }} onOpenChat={(id) => { setInfo(false); open(id); }} />
      )}
    </div>
  );
}

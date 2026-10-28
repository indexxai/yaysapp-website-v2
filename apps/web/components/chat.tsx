'use client';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type MutableRefObject } from 'react';
import { ApiError, MAX_TEXT, listNames, messagePreview, systemText, textLength, tickFor, type ConversationSummary, type PublicProfile, type ThreadItem, type Tick } from '@yays/shared';
import { memberLine } from './group';
import { AttachDialog, MediaContent, MediaViewer, RecorderBar } from './media';
import { ActionBar, ActionsCtx, DeleteDialog, ForwardDialog, MessageInfoPanel, PinnedBar, Quote, Reactions, useActions, type Actions } from './message-actions';
import { Icon } from '@/lib/icons';
import { clock, dayLabel, lastSeen, listTime, useChatState, useEngine } from '@/lib/chat';
import { CallButtons, CallLine } from './call';
import { Avatar, Banner, OvalButton } from './ui';
import { InChatSearch } from './search';
import { BlockReportDialog, isMuted, MUTE_CHOICES } from './contact';
import { MessageText, PollContent, PollDialog } from './poll';
import { getPrefs } from '@/lib/prefs';
import { useRouter } from 'next/navigation';

const TICK_LABEL: Record<Tick, string> = { pending: 'Sending', failed: 'Not sent', sent: 'Sent', delivered: 'Delivered', read: 'Read' };

export function TickIcon({ tick, size = 14 }: { tick: Tick; size?: number }) {
  if (tick === 'pending') return <span className="tick" data-tick="pending"><Icon name="clock" size={size} title={TICK_LABEL.pending} /></span>;
  if (tick === 'failed') return <span className="tick tick--failed" data-tick="failed"><Icon name="alert" size={size} title={TICK_LABEL.failed} /></span>;
  return <span className={`tick tick--${tick}`} data-tick={tick}><Icon name={tick === 'sent' ? 'check' : 'check-double'} size={size} strokeWidth={tick === 'read' ? 2.6 : 1.8} title={TICK_LABEL[tick]} /></span>;
}

function Badge({ n, muted, marked }: { n: number; muted?: boolean; marked?: boolean }) {
  if (n <= 0) return marked ? <span className={`ys-oval ys-badge ys-badge--dot${muted ? ' ys-oval--sunken ys-badge--muted' : ' ys-oval--ember'}`} aria-label="Marked unread" /> : null;
  const label = n >= 100 ? '99+' : String(n);
  return <span className={`ys-oval ys-badge${muted ? ' ys-oval--sunken ys-badge--muted' : ' ys-oval--ember'}${label.length > 2 ? ' ys-badge--wide' : ''}`} aria-label={`${label} unread`}><span>{label}</span></span>;
}

/** Connection state shown above the list when it isn't plainly online. */
export function ConnectionNotice() {
  const s = useChatState();
  const waiting = s.outbox.filter((p) => p.status === 'pending').length;
  if (s.connection === 'online') return null;
  const noNet = typeof navigator !== 'undefined' && !navigator.onLine;
  const later = waiting ? `${waiting} message${waiting > 1 ? 's' : ''} will send when you're back online.` : 'Messages you send will go out when you’re back online.';
  if (s.connection === 'connecting' && !noNet) return <div className="conn-notice" role="status"><span className="ys-spin" aria-hidden /><span>Connecting…{waiting ? ` ${later}` : ''}</span></div>;
  return (
    <div className="conn-notice" role="status">
      <Icon name="alert-triangle" size={18} />
      <span><strong>{noNet ? 'No internet connection.' : 'Can’t reach YaysApp. Trying again…'}</strong> {later}</span>
    </div>
  );
}

// ---------------- chat list ----------------
type ListFilter = 'all' | 'unread' | 'groups' | 'communities';
const hasUnread = (c: ConversationSummary) => c.unread > 0 || !!c.markedUnread;

const SKELETON: Array<[string, string]> = [['60%', '80%'], ['45%', '70%'], ['70%', '55%'], ['50%', '85%'], ['65%', '60%'], ['40%', '75%'], ['55%', '65%']];
function ListSkeleton() {
  return (
    <div className="list-skeleton" aria-busy="true" role="status" aria-label="Loading chats">
      <div className="list-skeleton__label">Loading chats…</div>
      {SKELETON.map(([a, b], i) => (
        <div key={i} className="ys-row-item" aria-hidden style={{ cursor: 'default' }}>
          <span className="ys-oval ys-oval--sunken skeleton-pulse" style={{ width: 48 }} />
          <span className="ys-row-item__text" style={{ gap: 8 }}><span className="skeleton-line skeleton-pulse" style={{ width: a, height: 12 }} /><span className="skeleton-line skeleton-line--soft skeleton-pulse" style={{ width: b, height: 10 }} /></span>
        </div>
      ))}
    </div>
  );
}

export function ChatList({ activeId, onOpen, onNewChat, onArchived }: { activeId: string | null; onOpen: (id: string) => void; onNewChat: () => void; onArchived: () => void }) {
  const s = useChatState();
  const engine = useEngine();
  const [loadingMore, setLoadingMore] = useState(false);
  const [filter, setFilter] = useState<ListFilter>('all');
  const me = useMe();
  usePreviewNames();
  if (!s.listLoaded && !s.order.length) return <ListSkeleton />;
  const main = s.order.filter((id) => s.conversations[id] && !s.conversations[id].archived);
  const archived = s.order.filter((id) => s.conversations[id]?.archived);
  if (!main.length && !archived.length) {
    return (
      <div className="list-empty">
        <span className="ys-oval ys-oval--wash" style={{ width: 72 }}><Icon name="chats" size={30} /></span>
        <strong>No chats yet</strong>
        <span>Start one with anyone on YaysApp by their username, phone number or email.</span>
        <OvalButton icon="edit" label="New chat" size="md" onClick={onNewChat} />
      </div>
    );
  }
  const unreadCount = main.filter((id) => hasUnread(s.conversations[id])).length;
  const shown = main.filter((id) => { const c = s.conversations[id]; return filter === 'all' || (filter === 'unread' ? hasUnread(c) : filter === 'communities' ? !!c.group?.community : c.kind === 'group'); });
  const inCommunities = main.some((id) => !!s.conversations[id]?.group?.community);
  const archivedUnread = archived.filter((id) => hasUnread(s.conversations[id])).length;
  return (
    <>
      <div className="list-filters">
        <div className="ys-tabs" role="tablist" aria-label="Filter chats">
          {([['all', 'All'], ['unread', 'Unread'], ['groups', 'Groups'], ...(inCommunities ? [['communities', 'Communities']] : [])] as Array<[ListFilter, string]>).map(([f, label]) => (
            <button key={f} type="button" role="tab" className="ys-tab" aria-selected={filter === f} onClick={() => setFilter(f)}>
              {label}{f === 'unread' && unreadCount > 0 && <span className="search__count">{unreadCount}</span>}
            </button>
          ))}
        </div>
      </div>
      <nav aria-label="Chats" className="chat-rows">
        {filter === 'all' && archived.length > 0 && (
          <button type="button" className="ys-row-item archived-row" onClick={onArchived}>
            <span className="ys-oval ys-oval--sunken" style={{ width: 44 }}><Icon name="archive" size={18} /></span>
            <span className="ys-row-item__text"><span className="ys-row-item__title">Archived</span></span>
            <span className="archived-row__count" style={archivedUnread ? { color: 'var(--ember-ink)' } : undefined}>{archivedUnread || archived.length}</span>
          </button>
        )}
        {shown.map((id) => <ChatRow key={id} c={s.conversations[id]} me={me} active={id === activeId} typing={typingLabel(engine, s.conversations[id])} onOpen={onOpen} />)}
        {!shown.length && <div className="list-empty list-empty--small">{filter === 'unread' ? 'No unread chats.' : filter === 'groups' ? 'No groups yet.' : filter === 'communities' ? 'No community groups.' : 'All your chats are archived.'}</div>}
        {s.listNext && filter === 'all' && (
          <div style={{ padding: 16, display: 'flex', justifyContent: 'center' }}>
            <OvalButton icon="chevron-down" label="Older chats" size="sm" variant="ghost" loading={loadingMore} onClick={() => { setLoadingMore(true); void engine.loadList(true).finally(() => setLoadingMore(false)); }} />
          </div>
        )}
      </nav>
    </>
  );
}

/** Archived chats (m43). New messages don't bring them back to the list. */
export function ArchivedList({ activeId, onOpen, onClose }: { activeId: string | null; onOpen: (id: string) => void; onClose: () => void }) {
  const s = useChatState();
  const engine = useEngine();
  const me = useMe();
  usePreviewNames();
  useEffect(() => { void engine.loadArchived().catch(() => undefined); }, [engine]);
  const ids = s.order.filter((id) => s.conversations[id]?.archived);
  return (
    <section aria-label="Archived chats" className="search">
      <div className="pane-head">
        <OvalButton icon="arrow-left" label="Chats" size="sm" variant="ghost" onClick={onClose} />
        <h2>Archived</h2>
      </div>
      <p className="archived-note">These chats stay archived when new messages arrive. Unarchive one from its menu.</p>
      <nav aria-label="Archived" className="chat-rows">
        {ids.map((id) => <ChatRow key={id} c={s.conversations[id]} me={me} active={id === activeId} typing={typingLabel(engine, s.conversations[id])} onOpen={onOpen} />)}
        {!ids.length && <div className="list-empty list-empty--small">No archived chats.</div>}
      </nav>
    </section>
  );
}

/** Names for "Ali added Sara" previews in group rows. */
function usePreviewNames() {
  const s = useChatState();
  const engine = useEngine();
  useEffect(() => {
    const ids: string[] = [];
    for (const id of s.order) { const m = s.conversations[id]?.lastMessage; if (m?.system && (m.system.kind === 'added' || m.system.kind === 'removed')) ids.push(m.senderId, ...m.system.userIds); else if (m?.system?.kind === 'admin') ids.push(m.senderId, m.system.userId); }
    if (ids.length) engine.ensurePeople(ids);
  }, [engine, s.order, s.conversations]);
}

function useMe() { return useEngine().me; }
type Engine = ReturnType<typeof useEngine>;

/** "typing…" in a direct chat; "Sara is typing…" / "Sara and Omar are typing…" in a group. */
function typingLabel(engine: Engine, c: ConversationSummary | undefined): string | null {
  if (!c) return null;
  const who = engine.typingIn(c.id);
  if (!who.length) return null;
  if (c.kind === 'direct') return 'typing…';
  const names = who.map((u) => engine.nameOf(u).split(' ')[0]);
  return names.length > 2 ? `${names.length} people are typing…` : `${listNames(names)} ${names.length > 1 ? 'are' : 'is'} typing…`;
}
/** First name of a group message's sender, from what the engine knows or what the server last said. */
function senderFirst(engine: Engine, id: string, fallback: string | null) {
  const n = engine.nameOf(id);
  return (n === '…' ? fallback ?? '' : n).split(' ')[0];
}
export const chatName = (c: ConversationSummary) => c.group?.name ?? c.peer?.displayName ?? 'Chat';
const chatPhoto = (c: ConversationSummary) => c.group?.photoUrl ?? c.peer?.photoUrl ?? null;

function ChatRow({ c, me, active, typing, onOpen }: { c: ConversationSummary; me: string; active: boolean; typing: string | null; onOpen: (id: string) => void }) {
  const engine = useEngine();
  const [menu, setMenu] = useState(false);
  const name = chatName(c);
  const last = c.lastMessage;
  const mine = last?.senderId === me && last.type !== 'system';
  const muted = isMuted(c);
  const preview = !last ? '' : last.type === 'system' && last.system ? systemText(last.system, last.senderId, (u) => engine.nameOf(u) === '…' && u === last.senderId && c.lastSenderName ? c.lastSenderName : engine.nameOf(u))
    : c.kind === 'group' && !mine ? `${senderFirst(engine, last.senderId, c.lastSenderName)}: ${messagePreview(last)}` : messagePreview(last);
  return (
    <div className={`chat-row${menu ? ' chat-row--menu' : ''}`} onContextMenu={(e) => { e.preventDefault(); setMenu(true); }}>
      <a href={`/chats?c=${c.id}`} className="ys-row-item" aria-current={active ? 'true' : undefined} data-testid="chat-row"
        onClick={(e) => { if (e.metaKey || e.ctrlKey || e.shiftKey) return; e.preventDefault(); onOpen(c.id); }} style={{ textDecoration: 'none', color: 'inherit' }}>
        <Avatar name={name} photoUrl={chatPhoto(c)} size={48} />
        <span className="ys-row-item__text">
          <span className="ys-row-item__title">{name}</span>
          <span className="ys-row-item__sub" style={typing ? { color: 'var(--ember-ink)', fontWeight: 700 } : undefined}>
            {typing ?? <>{mine && last && <TickIcon tick={tickFor(last, c)} />} {preview}</>}
          </span>
        </span>
        <span className="ys-row-item__end">
          <span style={c.unread && !muted ? { color: 'var(--ember-ink)', fontWeight: 800 } : undefined}>{listTime(c.lastActivityAt)}</span>
          <span className="chat-row__icons">
            {muted && <Icon name="bell-off" size={14} title="Muted" />}
            {c.pinnedAt && <Icon name="pin" size={14} title="Pinned" />}
            {c.mentioned && <span className="ys-oval ys-oval--ember ys-badge" aria-label="You were mentioned"><span>@</span></span>}
            <Badge n={c.unread} muted={muted} marked={c.markedUnread} />
          </span>
        </span>
      </a>
      <span className="chat-row__more">
        <button type="button" className="icon-btn" aria-label={`Options for ${name}`} aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((v) => !v)}><Icon name="chevron-down" size={18} /></button>
        {menu && <ChatRowMenu c={c} active={active} onClose={() => setMenu(false)} />}
      </span>
    </div>
  );
}

/** Archive, mute, pin and mark unread, from a chat's row. */
function ChatRowMenu({ c, active, onClose }: { c: ConversationSummary; active: boolean; onClose: () => void }) {
  const engine = useEngine();
  const router = useRouter();
  const ref = useRef<HTMLSpanElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [muting, setMuting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('[role=menuitem]')?.focus();
    const away = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    const esc = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', away); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [onClose]);
  const set = (p: Parameters<typeof engine.setChatPrefs>[1]) => { setError(null); void engine.setChatPrefs(c.id, p).then(onClose, (e) => setError(e instanceof ApiError ? e.message : 'That did not work.')); };
  const muted = isMuted(c);
  const unread = hasUnread(c);
  return (
    <span className="menu menu--row" role="menu" ref={ref} aria-label="Chat options">
      {error && <span className="menu__error" role="alert">{error}</span>}
      {deleting ? (
        <>
          <span className="menu__error" style={{ color: 'var(--ink)' }}>Delete this chat? Its messages go from your devices only.</span>
          <button type="button" role="menuitem" className="danger" onClick={() => void engine.deleteChat(c.id).then(() => { onClose(); if (active) router.push('/chats'); }, (e) => setError(e instanceof ApiError ? e.message : 'That did not work.'))}><Icon name="trash" size={16} />Delete chat</button>
          <button type="button" role="menuitem" onClick={() => setDeleting(false)}>Cancel</button>
        </>
      ) : muting ? (
        <>
          {MUTE_CHOICES.map(([v, l]) => <button key={v} type="button" role="menuitem" onClick={() => set({ mute: v })}>Mute for {l.toLowerCase()}</button>)}
          <button type="button" role="menuitem" onClick={() => setMuting(false)}>Back</button>
        </>
      ) : (
        <>
          <button type="button" role="menuitem" onClick={() => set({ archived: !c.archived })}><Icon name="archive" size={16} />{c.archived ? 'Unarchive chat' : 'Archive chat'}</button>
          {muted ? <button type="button" role="menuitem" onClick={() => set({ mute: 'off' })}><Icon name="bell" size={16} />Unmute notifications</button>
            : <button type="button" role="menuitem" onClick={() => setMuting(true)}><Icon name="bell-off" size={16} />Mute notifications</button>}
          {!c.archived && <button type="button" role="menuitem" onClick={() => set({ pinned: !c.pinnedAt })}><Icon name="pin" size={16} />{c.pinnedAt ? 'Unpin chat' : 'Pin chat'}</button>}
          <button type="button" role="menuitem" onClick={() => set({ unread: !unread })}><Icon name="check-double" size={16} />{unread ? 'Mark as read' : 'Mark as unread'}</button>
          {c.kind === 'direct' && <button type="button" role="menuitem" className="danger" onClick={() => setDeleting(true)}><Icon name="trash" size={16} />Delete chat</button>}
        </>
      )}
    </span>
  );
}
// ---------------- new chat ----------------
export function NewChat({ onClose, onOpened }: { onClose: () => void; onOpened: (id: string) => void }) {
  const engine = useEngine();
  const [q, setQ] = useState('');
  const [found, setFound] = useState<PublicProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); }, []);
  const search = async (e: FormEvent) => {
    e.preventDefault();
    if (!q.trim()) { setError('Type a username, phone number or email.'); return; }
    setBusy(true); setError(null); setFound(null);
    try { setFound(await engine.lookup(q.trim())); }
    catch (err) { setError(err instanceof ApiError ? err.message : 'Search failed. Try again.'); }
    finally { setBusy(false); }
  };
  const start = async (p: PublicProfile) => {
    setBusy(true);
    try { const c = await engine.startDirect(p.id); onOpened(c.id); }
    catch (err) { setError(err instanceof ApiError ? err.message : 'Could not start the chat. Try again.'); setBusy(false); }
  };
  return (
    <section aria-label="New chat" className="new-chat">
      <div className="pane-head">
        <OvalButton icon="arrow-left" label="Back" size="sm" variant="ghost" onClick={onClose} />
        <h2>New chat</h2>
      </div>
      <form onSubmit={search} className="new-chat__form">
        <div className={`ys-field ys-field--pill${error ? ' ys-field--error' : ''}`} style={{ flex: 1 }}>
          <label htmlFor="find" className="ys-field__label">Find someone</label>
          <div className="ys-field__box">
            <Icon name="search" size={18} />
            <input ref={input} id="find" className="ys-input" value={q} onChange={(e) => { setQ(e.target.value); setError(null); }} placeholder="@username, phone or email" autoComplete="off" aria-describedby="find-hint" />
          </div>
          <span className="ys-field__hint" id="find-hint" role={error ? 'alert' : undefined}>{error ?? 'Exact matches only. Their phone and email stay private.'}</span>
        </div>
        <OvalButton type="submit" icon="search" label="Search" size="sm" variant="soft" loading={busy && !found} />
      </form>
      {found && (
        <button type="button" className="ys-row-item" onClick={() => void start(found)} disabled={busy} data-testid="lookup-result">
          <Avatar name={found.displayName} photoUrl={found.photoUrl} size={48} />
          <span className="ys-row-item__text">
            <span className="ys-row-item__title">{found.displayName}</span>
            <span className="ys-row-item__sub">{found.username ? `@${found.username}` : found.about || 'On YaysApp'}</span>
          </span>
          <span className="ys-tag ys-tag--ember">Message</span>
        </button>
      )}
    </section>
  );
}

// ---------------- conversation ----------------
export function Conversation({ id, onBack, onInfo, infoOpen, jumpSeq, jumpKey = '', searchNonce = 0 }: { id: string; onBack: () => void; onInfo?: () => void; infoOpen?: boolean; jumpSeq?: number; jumpKey?: string; searchNonce?: number }) {
  const engine = useEngine();
  const s = useChatState();
  const me = useMe();
  const c = s.conversations[id];
  const thread = s.threads[id];
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [retry, setRetry] = useState(0);
  const [replyTo, setReplyTo] = useState<ThreadItem | null>(null);
  const [editing, setEditing] = useState<ThreadItem | null>(null);
  const [forwarding, setForwarding] = useState<ThreadItem | null>(null);
  const [deleting, setDeleting] = useState<ThreadItem | null>(null);
  const [infoOf, setInfoOf] = useState<ThreadItem | null>(null);
  const [reportOf, setReportOf] = useState<ThreadItem | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [attachFiles, setAttachFiles] = useState<File[] | null>(null);
  const [viewerAt, setViewerAt] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [searching, setSearching] = useState(false);
  const jump = useRef<(seq: number) => void>(() => undefined);
  const jumped = useRef<string | null>(null);
  const actions = useMemo<Actions>(() => ({
    reply: (m) => { setEditing(null); setReplyTo(m); }, edit: (m) => { setReplyTo(null); setEditing(m); },
    forward: setForwarding, remove: setDeleting, info: setInfoOf, report: setReportOf, jumpTo: (seq) => jump.current(seq), error: setActionError,
  }), []);
  useEffect(() => { setReplyTo(null); setEditing(null); setForwarding(null); setDeleting(null); setInfoOf(null); setActionError(null); setNotice(null); setReportOf(null); setAttachFiles(null); setViewerAt(null); setSearching(false); }, [id]);
  useEffect(() => {
    setError(null);
    setNotFound(false);
    void engine.open(id).then(() => { if (engine.getState().conversations[id]?.kind === 'group') return engine.loadGroup(id); }).catch((e) => {
      const nf = e instanceof ApiError && e.status === 404;
      setNotFound(nf);
      setError(nf ? 'This chat does not exist or you are not in it.' : 'Could not load this chat. Check your connection and try again.');
    });
    return () => { if (engine.getState().active === id) void engine.open(null); };
  }, [engine, id, retry]);
  // Opened from a search result: go to that message once the thread is there.
  const loaded = !!thread?.loaded;
  useEffect(() => {
    const k = `${id}:${jumpSeq}:${jumpKey}`;
    if (!jumpSeq || !loaded || jumped.current === k) return;
    jumped.current = k;
    setTimeout(() => jump.current(jumpSeq), 30);
  }, [id, jumpSeq, jumpKey, loaded]);
  useEffect(() => { if (searchNonce) setSearching(true); }, [searchNonce]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const items = useMemo(() => engine.thread(id), [engine, id, thread, s.outbox, s.uploads, c]);

  if (error) return (
    <div className="pane-center">
      <div className="state-card" role="alert">
        <span className="ys-oval" style={{ width: 72, ['--ys-oval-fill' as string]: 'var(--danger-wash)', ['--ys-oval-ink' as string]: 'var(--danger-ink)' }}><Icon name="alert" size={30} /></span>
        <h2>{notFound ? 'Chat not found' : 'Couldn’t open this chat'}</h2>
        <p>{error}</p>
        <div className="row" style={{ gap: 26 }}>
          {!notFound && <OvalButton icon="refresh" label="Try again" onClick={() => setRetry((n) => n + 1)} />}
          <OvalButton icon="arrow-left" label="Back to chats" variant="ghost" onClick={onBack} />
        </div>
      </div>
    </div>
  );
  if (!c) return <div className="pane-center" aria-busy="true"><span className="ys-spin" aria-hidden /></div>;
  const peer = c.peer;
  const name = chatName(c);
  const typing = typingLabel(engine, c);
  const p = peer ? s.presence[peer.id] : undefined;
  const offline = s.connection !== 'online';
  const status = offline ? 'Waiting for network…' : typing ?? (c.kind === 'group' ? memberLine(s.groups[id], me, '') : p?.online ? 'online' : p?.lastSeenAt ? lastSeen(p.lastSeenAt) : peer?.username ? `@${peer.username}` : '');
  return (
    <ActionsCtx.Provider value={actions}>
    <section className={`convo${dragging ? ' convo--drop' : ''}`} aria-label={`Chat with ${name}`}
      onDragOver={(e) => { if (c.canSend && e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDragging(true); } }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setDragging(false); }}
      onDrop={(e) => { e.preventDefault(); setDragging(false); const fs = [...e.dataTransfer.files]; if (fs.length && c.canSend) setAttachFiles(fs); }}>
      <header className="convo__head">
        <span className="convo__back"><OvalButton icon="arrow-left" label="Chats" size="sm" variant="ghost" onClick={onBack} /></span>
        <button type="button" className="convo__whobtn" onClick={onInfo} disabled={!onInfo} aria-expanded={!!infoOpen} aria-label={c.kind === 'group' ? 'Group info' : 'Contact info'}>
          <Avatar name={name} photoUrl={chatPhoto(c)} size={44} online={!!p?.online} />
          <span className="convo__who">
            <strong>{name}</strong>
            <span data-testid="peer-status" style={offline ? { color: 'var(--warning-ink)', fontWeight: 700 } : typing ? { color: 'var(--ember-ink)', fontWeight: 700 } : undefined}>{status}</span>
          </span>
        </button>
        <CallButtons conversationId={id} canCall={c.canSend && !(c.kind === 'group' && c.group?.announcements)} live={c.call} />
        <OvalButton icon="search" label="Search" size="sm" variant={searching ? 'soft' : 'ghost'} onClick={() => setSearching((v) => !v)} />
        {onInfo && <OvalButton icon="info" label="Info" size="sm" variant={infoOpen ? 'soft' : 'ghost'} onClick={onInfo} />}
      </header>
      {searching && <InChatSearch convId={id} onJump={(seq) => jump.current(seq)} onClose={() => setSearching(false)} />}
      <PinnedBar c={c} />
      {actionError && <div className="convo__error"><Banner>{actionError}</Banner><button type="button" className="icon-btn" aria-label="Dismiss" onClick={() => setActionError(null)}><Icon name="close" size={16} /></button></div>}
      {notice && <div className="convo__error"><Banner tone="success">{notice}</Banner><button type="button" className="icon-btn" aria-label="Dismiss" onClick={() => setNotice(null)}><Icon name="close" size={16} /></button></div>}
      <Thread id={id} items={items} me={me} typing={!!typing} loading={!thread?.loaded} hasMore={!!thread?.hasMore} group={c.kind === 'group'} c={c} jump={jump} onOpenMedia={setViewerAt} />
      {c.canSend ? <Composer id={id} replyTo={replyTo} editing={editing} onDone={() => { setReplyTo(null); setEditing(null); }} onFiles={setAttachFiles} /> : <LockedComposer c={c} onGone={onBack} />}
      {dragging && <div className="drop-hint" aria-hidden><Icon name="upload" size={32} /> Drop files to send them to {name}</div>}
    </section>
    {attachFiles && <AttachDialog files={attachFiles} name={name} replyToId={replyTo?.id ?? undefined} onClose={() => setAttachFiles(null)} onAdded={() => setReplyTo(null)} />}
    {viewerAt && <MediaViewer items={items} start={viewerAt} onClose={() => setViewerAt(null)} />}
    {forwarding && <ForwardDialog m={forwarding} from={id} onClose={() => setForwarding(null)} />}
    {deleting && <DeleteDialog m={deleting} c={c} onClose={() => setDeleting(null)} />}
    {infoOf && <MessageInfoPanel convId={id} m={infoOf} onClose={() => setInfoOf(null)} />}
    {reportOf && <BlockReportDialog mode="report" c={c} message={reportOf} onClose={() => setReportOf(null)} onDone={(t) => { setReportOf(null); setActionError(null); setNotice(t); }} />}
    </ActionsCtx.Provider>
  );
}

function Thread({ id, items, me, typing, loading, hasMore, group, c, jump, onOpenMedia }: { id: string; items: ThreadItem[]; me: string; typing: boolean; loading: boolean; hasMore: boolean; group: boolean; c: ConversationSummary; jump: MutableRefObject<(seq: number) => void>; onOpenMedia: (key: string) => void }) {
  const engine = useEngine();
  const box = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const prevFirst = useRef<string | null>(null);
  const prevHeight = useRef(0);
  const [older, setOlder] = useState(false);
  const [olderFailed, setOlderFailed] = useState(false);
  const loadMore = () => { setOlder(true); setOlderFailed(false); void engine.loadOlder(id).catch(() => setOlderFailed(true)).finally(() => setOlder(false)); };
  useEffect(() => setOlderFailed(false), [id]);
  const s = useChatState();
  const waitingToSend = s.connection !== 'online' ? items.filter((m) => m.mine && m.tick === 'pending' && !m.upload).length : 0;
  // Stay pinned to the newest message unless the reader scrolled up; keep position when older ones load above.
  useLayoutEffect(() => {
    const el = box.current; if (!el) return;
    const first = items[0]?.key ?? null;
    if (prevFirst.current && first !== prevFirst.current && prevHeight.current && !stick.current) el.scrollTop += el.scrollHeight - prevHeight.current;
    else if (stick.current) el.scrollTop = el.scrollHeight;
    prevFirst.current = first; prevHeight.current = el.scrollHeight;
  }, [items, typing]);
  useEffect(() => { stick.current = true; prevFirst.current = null; }, [id]);
  // Scrolls to a message (a quote or a pin), loading older pages until it is there.
  jump.current = (seq: number) => {
    void (async () => {
      for (let i = 0; i < 20; i++) {
        const el = box.current?.querySelector<HTMLElement>(`[data-seq="${seq}"]`);
        if (el) { stick.current = false; el.scrollIntoView({ block: 'center' }); el.classList.add('msg--flash'); setTimeout(() => el.classList.remove('msg--flash'), 1600); return; }
        const t = engine.getState().threads[id];
        if (!t?.hasMore || (t.items[0]?.seq ?? 0) <= seq) return;
        await engine.loadOlder(id);
        await new Promise((r) => setTimeout(r, 50));
      }
    })();
  };
  const onScroll = () => {
    const el = box.current; if (!el) return;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (el.scrollTop < 60 && hasMore && !older && !loading && !olderFailed) loadMore();
  };
  let lastDay = '';
  return (
    <div className="convo__scroll" ref={box} onScroll={onScroll}>
      <div className="ys-thread convo__thread" role="log" aria-live="polite" aria-label="Messages">
        {(older || loading) && <span className="ys-spin" style={{ alignSelf: 'center' }} aria-label="Loading messages" />}
        {olderFailed && (
          <div className="state-card state-card--inline" role="alert">
            <span className="ys-oval" style={{ width: 56, ['--ys-oval-fill' as string]: 'var(--danger-wash)', ['--ys-oval-ink' as string]: 'var(--danger-ink)' }}><Icon name="alert" size={24} /></span>
            <h2>Couldn’t load older messages</h2>
            <p>Your newest messages are saved on this computer. Older ones load once you’re connected again.</p>
            <div className="row" style={{ gap: 26 }}><OvalButton icon="refresh" label="Try again" size="sm" onClick={loadMore} /><OvalButton icon="help" label="Get help" size="sm" variant="ghost" href="/settings/help" /></div>
          </div>
        )}
        {!loading && !items.length && <div className="day-sep">Say hello 👋</div>}
        {items.map((m, i) => {
          const day = dayLabel(m.createdAt);
          const sep = day !== lastDay; lastDay = day;
          const prev = items[i - 1];
          // In groups, others' messages carry the sender's name at the start of each run.
          const showName = group && m.type !== 'system' && m.senderId !== me && (sep || !prev || prev.type === 'system' || prev.senderId !== m.senderId);
          return (
            <div key={m.key} style={{ display: 'contents' }}>
              {sep && <div className="day-sep">{day}</div>}
              {m.type === 'system' && m.system?.kind === 'call'
                ? <CallLine e={m.system} mine={m.senderId === me} at={clock(m.createdAt)} conversationId={id} canCall={c.canSend} />
                : m.type === 'system' && m.system
                ? <div className="sys-line" data-testid="system-line">{systemText(m.system, m.senderId, (u) => engine.nameOf(u))}</div>
                : <Bubble m={m} mine={m.senderId === me} sender={showName ? engine.nameOf(m.senderId) : null} c={c} onOpenMedia={onOpenMedia} />}
            </div>
          );
        })}
        {waitingToSend > 0 && <span className="waiting-send" data-testid="waiting-to-send">Waiting to send · {waitingToSend} message{waitingToSend > 1 ? 's' : ''}</span>}
        {typing && <div className="ys-bubble ys-bubble--them typing-dots" aria-label="Typing"><span /><span /><span /></div>}
      </div>
    </div>
  );
}

function Bubble({ m, mine, sender, c, onOpenMedia }: { m: ThreadItem; mine: boolean; sender?: string | null; c: ConversationSummary; onOpenMedia: (key: string) => void }) {
  const engine = useEngine();
  const act = useActions();
  const failed = m.tick === 'failed';
  return (
    <div className={`msg ${mine ? 'msg--me' : 'msg--them'}`} data-testid="message" data-tick={m.tick ?? undefined} data-seq={m.seq ?? undefined}>
      <div className="msg__row">
      <div className={`ys-bubble ys-bubble--${mine ? 'me' : 'them'}${m.deleted ? ' ys-bubble--deleted' : ''}${m.attachment && !m.deleted ? ` ys-bubble--media ys-bubble--${m.attachment.kind}` : ''}`} style={(m.tick === 'pending' && !m.upload) || failed ? { opacity: m.upload ? 1 : 0.75 } : undefined}>
        {sender && <span className="msg__sender" style={{ color: senderColor(m.senderId) }}>{sender}</span>}
        {m.forwarded && !m.deleted && <span className="msg__fwd"><Icon name="forward" size={12} /> Forwarded</span>}
        {m.replyTo && !m.deleted && <Quote r={m.replyTo} onClick={() => act.jumpTo(m.replyTo!.seq)} />}
        {m.attachment && !m.deleted && <MediaContent m={m} onOpen={() => onOpenMedia(m.key)} />}
        {m.poll && !m.deleted ? <PollContent m={m} convId={c.id} canVote={c.kind === 'direct' ? !c.blocked : c.group?.role !== 'former'} />
          : (m.deleted || m.text) && <span className="msg__text">{m.deleted ? <em><Icon name="slash" size={14} /> {mine ? 'You deleted this message' : 'This message was deleted'}</em> : <MessageText m={m} me={engine.me} nameOf={(u) => engine.getState().groups[c.id]?.members.find((x) => x.id === u)?.displayName ?? engine.nameOf(u)} />}</span>}
        <span className="ys-bubble__meta">
          {m.starred && <Icon name="star" size={12} title="Starred" />}
          {m.editedAt && <span>Edited</span>}
          <span>{clock(m.createdAt)}</span>
          {mine && m.tick && !m.deleted && <TickIcon tick={m.tick} />}
        </span>
      </div>
      <ActionBar m={m} c={c} />
      </div>
      <Reactions m={m} c={c} />
      {failed && !m.upload && (
        <span className="msg__failed">
          <button type="button" onClick={() => void engine.retry(m.clientId)}><Icon name="refresh" size={14} /> Not sent. Retry</button>
          <button type="button" onClick={() => void engine.discard(m.clientId)}><Icon name="trash" size={14} /> Delete</button>
        </span>
      )}
    </div>
  );
}

/** Sender names get one of a few readable colours, the same for a person every time. */
const SENDER_COLORS = ['var(--ember-ink)', 'var(--info)', 'var(--success-ink)', 'var(--danger-ink)', 'var(--warning-ink)'];
function senderColor(id: string) { let h = 0; for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return SENDER_COLORS[h % SENDER_COLORS.length]; }

function LockedComposer({ c, onGone }: { c: ConversationSummary; onGone: () => void }) {
  const engine = useEngine();
  const former = c.group?.role === 'former';
  if (c.blocked && c.peer) {
    return (
      <div className="composer composer--locked" role="status">
        <span>You blocked {c.peer.displayName}.</span>
        <button type="button" className="link-btn" onClick={() => void engine.unblock(c.peer!.id)}>Unblock</button>
      </div>
    );
  }
  return (
    <div className="composer composer--locked" role="status">
      <span>{former ? 'You’re no longer in this group.' : 'Only admins can send messages.'}</span>
      {former && <button type="button" className="link-btn link-btn--danger" onClick={() => void engine.deleteGroup(c.id).then(onGone)}>Delete group</button>}
    </div>
  );
}

/** Group members whose name matches what's typed after "@" (any word of the name). */
function useMentionables(id: string) {
  const s = useChatState();
  const engine = useEngine();
  const g = s.groups[id];
  return useMemo(() => (g ? g.members.filter((m) => m.id !== engine.me).map((m) => ({ id: m.id, name: m.displayName, photoUrl: m.photoUrl })) : []), [g, engine.me]);
}

function Composer({ id, replyTo, editing, onDone, onFiles }: { id: string; replyTo: ThreadItem | null; editing: ThreadItem | null; onDone: () => void; onFiles: (f: File[]) => void }) {
  const engine = useEngine();
  const s = useChatState();
  const group = s.conversations[id]?.kind === 'group';
  const [recording, setRecording] = useState(false);
  const [attachMenu, setAttachMenu] = useState(false);
  const [polling, setPolling] = useState(false);
  const members = useMentionables(id);
  const [mention, setMention] = useState<{ start: number; query: string; at: number } | null>(null);
  const picked = useRef(new Map<string, string>());
  const fileInput = useRef<HTMLInputElement>(null);
  const drafts = useRef<Record<string, string>>({});
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const ta = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { setText(drafts.current[id] ?? ''); setError(null); ta.current?.focus(); }, [id]);
  // Editing puts the message's text in the box; leaving edit mode brings the draft back.
  useEffect(() => {
    picked.current = new Map((editing?.mentions ?? []).map((u) => [u, engine.nameOf(u)]));
    if (editing) setText(editing.text); else setText(drafts.current[id] ?? ''); ta.current?.focus();
  }, [editing, id, engine]);
  const matches = mention && group ? members.filter((m) => !mention.query || m.name.toLowerCase().split(/\s+/).some((w) => w.startsWith(mention.query.toLowerCase())) || m.name.toLowerCase().startsWith(mention.query.toLowerCase())).slice(0, 6) : [];
  /** "@" at the start of a word opens the member list; it follows what's typed after it. */
  const trackMention = (value: string, caret: number) => {
    if (!group) return;
    const before = value.slice(0, caret);
    const hit = /(^|\s)@([^\s@]{0,30})$/.exec(before);
    setMention(hit ? { start: caret - hit[2].length - 1, query: hit[2], at: 0 } : null);
  };
  const pickMention = (m: { id: string; name: string }) => {
    if (!mention) return;
    const el = ta.current;
    const caret = el?.selectionStart ?? text.length;
    const next = `${text.slice(0, mention.start)}@${m.name} ${text.slice(caret)}`;
    picked.current.set(m.id, m.name);
    setText(next); drafts.current[id] = next; setMention(null);
    const pos = mention.start + m.name.length + 2;
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(pos, pos); });
  };
  /** The people still named in the text when it's sent. */
  const mentionsIn = (t: string) => [...picked.current].filter(([, name]) => t.includes(`@${name}`)).map(([u]) => u);
  useEffect(() => { if (replyTo) ta.current?.focus(); }, [replyTo]);
  useLayoutEffect(() => { const el = ta.current; if (el) { el.style.height = 'auto'; el.style.height = `${Math.min(el.scrollHeight, 160)}px`; } }, [text]);
  const len = textLength(text.trim());
  const tooLong = len > MAX_TEXT;
  const submit = async () => {
    if (!text.trim() || tooLong) return;
    const t = text;
    if (editing) {
      try { await engine.editMessage(id, editing.id!, t, group ? mentionsIn(t) : undefined); onDone(); setText(drafts.current[id] ?? ''); }
      catch (e) { setError(e instanceof ApiError ? e.message : 'Could not save the edit. Check your connection.'); }
      return;
    }
    const mentions = group ? mentionsIn(t) : [];
    setText(''); drafts.current[id] = ''; picked.current.clear(); setMention(null);
    const reply = replyTo?.id ?? undefined;
    onDone();
    try { await engine.send(id, t, { replyToId: reply, mentions }); } catch (e) { setText(t); setError(e instanceof ApiError ? e.message : 'Could not send.'); }
  };
  // A screenshot pasted into the box opens the send sheet.
  const onPaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const fs = [...e.clipboardData.files];
    if (fs.length && !editing) { e.preventDefault(); onFiles(fs); }
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (mention && matches.length) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); const d = e.key === 'ArrowDown' ? 1 : -1; setMention({ ...mention, at: (mention.at + d + matches.length) % matches.length }); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pickMention(matches[mention.at] ?? matches[0]); return; }
      if (e.key === 'Escape') { e.preventDefault(); setMention(null); return; }
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && (getPrefs().enterToSend || e.ctrlKey || e.metaKey)) { e.preventDefault(); void submit(); }
    if (e.key === 'Escape' && (editing || replyTo)) { e.preventDefault(); onDone(); }
  };
  return (
    <>
    <form className="composer" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      {(replyTo || editing) && (
        <div className="composer__context" role="status">
          <span><strong>{editing ? 'Editing message' : `Replying to ${engine.nameOf((replyTo ?? editing)!.senderId)}`}</strong><br />
            <span className="muted">{editing ? 'You can edit for 15 minutes after sending · Esc to cancel' : replyTo!.text}</span></span>
          <button type="button" className="icon-btn" aria-label={editing ? 'Cancel edit' : 'Cancel reply'} onClick={() => { onDone(); }}><Icon name="close" size={18} /></button>
        </div>
      )}
      {(error || tooLong) && <span className="composer__error" role="alert">{tooLong ? `Messages can be up to ${MAX_TEXT} characters (${len} now).` : error}</span>}
      {recording ? <RecorderBar convId={id} replyToId={replyTo?.id ?? undefined} onDone={() => { setRecording(false); onDone(); }} /> : (
      <div className="composer__row">
        {!editing && (
          <span className="attach-wrap">
            <OvalButton icon="paperclip" label="Attach" size="sm" variant="ghost" aria-haspopup="menu" aria-expanded={attachMenu} onClick={() => setAttachMenu((v) => !v)} />
            {attachMenu && (
              <span className="menu menu--attach" role="menu" onMouseLeave={() => setAttachMenu(false)}>
                <button type="button" role="menuitem" onClick={() => { setAttachMenu(false); fileInput.current?.click(); }}><Icon name="image" size={16} />Photos, videos and files</button>
                <button type="button" role="menuitem" onClick={() => { setAttachMenu(false); setPolling(true); }}><Icon name="stats" size={16} />Poll</button>
              </span>
            )}
          </span>
        )}
        <input ref={fileInput} type="file" multiple hidden aria-label="Attach files" onChange={(e) => { const fs = [...(e.target.files ?? [])]; e.target.value = ''; if (fs.length) onFiles(fs); }} />
        <label htmlFor="composer" className="sr-only">Message</label>
        <span className="composer__box">
          <textarea id="composer" ref={ta} rows={1} value={text} placeholder="Message" maxLength={MAX_TEXT * 2 + 10}
            aria-autocomplete={group ? 'list' : undefined} aria-controls={matches.length ? 'mention-list' : undefined} aria-expanded={group ? matches.length > 0 : undefined}
            onChange={(e) => { setText(e.target.value); drafts.current[id] = e.target.value; setError(null); engine.typing(id, e.target.value.trim().length > 0); trackMention(e.target.value, e.target.selectionStart); }}
            onKeyDown={onKey} onPaste={onPaste} onBlur={() => { engine.typing(id, false); setTimeout(() => setMention(null), 150); }} />
          {matches.length > 0 && (
            <span id="mention-list" className="mention-list" role="listbox" aria-label="Mention a member">
              {matches.map((m, i) => (
                <button key={m.id} type="button" role="option" aria-label={m.name} aria-selected={i === mention!.at} onMouseDown={(e) => { e.preventDefault(); pickMention(m); }}>
                  <Avatar name={m.name} photoUrl={m.photoUrl} size={28} /><span>{m.name}</span>
                </button>
              ))}
            </span>
          )}
        </span>
        {!text.trim() && !editing
          ? <OvalButton icon="mic" label="Record" size="md" onClick={() => setRecording(true)} />
          : <OvalButton type="submit" icon={editing ? 'check' : 'send'} label={editing ? 'Save' : 'Send'} size="md" disabled={!text.trim() || tooLong} />}
      </div>)}
    </form>
    {polling && <PollDialog convId={id} name={chatName(s.conversations[id])} onClose={() => setPolling(false)} />}
    </>
  );
}

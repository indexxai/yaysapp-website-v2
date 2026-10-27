'use client';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type MutableRefObject } from 'react';
import { ApiError, MAX_TEXT, listNames, messagePreview, systemText, textLength, tickFor, type ConversationSummary, type PublicProfile, type ThreadItem, type Tick } from '@yays/shared';
import { memberLine } from './group';
import { AttachDialog, MediaContent, MediaViewer, RecorderBar } from './media';
import { ActionBar, ActionsCtx, DeleteDialog, ForwardDialog, MessageInfoPanel, PinnedBar, Quote, Reactions, useActions, type Actions } from './message-actions';
import { Icon } from '@/lib/icons';
import { clock, dayLabel, lastSeen, listTime, useChatState, useEngine } from '@/lib/chat';
import { Avatar, Banner, OvalButton } from './ui';
import { InChatSearch } from './search';

const TICK_LABEL: Record<Tick, string> = { pending: 'Sending', failed: 'Not sent', sent: 'Sent', delivered: 'Delivered', read: 'Read' };

export function TickIcon({ tick, size = 14 }: { tick: Tick; size?: number }) {
  if (tick === 'pending') return <span className="tick" data-tick="pending"><Icon name="clock" size={size} title={TICK_LABEL.pending} /></span>;
  if (tick === 'failed') return <span className="tick tick--failed" data-tick="failed"><Icon name="alert" size={size} title={TICK_LABEL.failed} /></span>;
  return <span className={`tick tick--${tick}`} data-tick={tick}><Icon name={tick === 'sent' ? 'check' : 'check-double'} size={size} strokeWidth={tick === 'read' ? 2.6 : 1.8} title={TICK_LABEL[tick]} /></span>;
}

function Badge({ n }: { n: number }) {
  if (n <= 0) return null;
  const label = n >= 100 ? '99+' : String(n);
  return <span className={`ys-oval ys-oval--ember ys-badge${label.length > 2 ? ' ys-badge--wide' : ''}`} aria-label={`${label} unread`}><span>{label}</span></span>;
}

/** Connection state shown above the list when it isn't plainly online. */
export function ConnectionNotice() {
  const s = useChatState();
  const waiting = s.outbox.filter((p) => p.status === 'pending').length;
  if (s.connection === 'online') return null;
  return (
    <div className="conn-notice" role="status">
      <span className="ys-spin" aria-hidden />
      <span>{s.connection === 'connecting' ? 'Connecting…' : 'Waiting for network.'}{waiting ? ` ${waiting} message${waiting > 1 ? 's' : ''} will send when you're back online.` : ''}</span>
    </div>
  );
}

// ---------------- chat list ----------------
export function ChatList({ activeId, onOpen, onNewChat }: { activeId: string | null; onOpen: (id: string) => void; onNewChat: () => void }) {
  const s = useChatState();
  const engine = useEngine();
  const [loadingMore, setLoadingMore] = useState(false);
  const me = useMe();
  // Names for "Ali added Sara" previews in group rows.
  useEffect(() => {
    const ids: string[] = [];
    for (const id of s.order) { const m = s.conversations[id]?.lastMessage; if (m?.system && (m.system.kind === 'added' || m.system.kind === 'removed')) ids.push(m.senderId, ...m.system.userIds); else if (m?.system?.kind === 'admin') ids.push(m.senderId, m.system.userId); }
    if (ids.length) engine.ensurePeople(ids);
  }, [engine, s.order, s.conversations]);
  if (!s.listLoaded) return <div className="list-empty" aria-busy="true"><span className="ys-spin" aria-hidden /> Loading chats…</div>;
  if (!s.order.length) {
    return (
      <div className="list-empty">
        <span className="ys-oval ys-oval--wash" style={{ width: 72 }}><Icon name="chats" size={30} /></span>
        <strong>No chats yet</strong>
        <span>Start one with anyone on YaysApp by their username, phone number or email.</span>
        <OvalButton icon="edit" label="New chat" size="md" onClick={onNewChat} />
      </div>
    );
  }
  return (
    <nav aria-label="Chats" className="chat-rows">
      {s.order.map((id) => <ChatRow key={id} c={s.conversations[id]} me={me} active={id === activeId} typing={typingLabel(engine, s.conversations[id])} onOpen={onOpen} />)}
      {s.listNext && (
        <div style={{ padding: 16, display: 'flex', justifyContent: 'center' }}>
          <OvalButton icon="chevron-down" label="Older chats" size="sm" variant="ghost" loading={loadingMore} onClick={() => { setLoadingMore(true); void engine.loadList(true).finally(() => setLoadingMore(false)); }} />
        </div>
      )}
    </nav>
  );
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
  const name = chatName(c);
  const last = c.lastMessage;
  const mine = last?.senderId === me && last.type !== 'system';
  const preview = !last ? '' : last.type === 'system' && last.system ? systemText(last.system, last.senderId, (u) => engine.nameOf(u) === '…' && u === last.senderId && c.lastSenderName ? c.lastSenderName : engine.nameOf(u))
    : c.kind === 'group' && !mine ? `${senderFirst(engine, last.senderId, c.lastSenderName)}: ${messagePreview(last)}` : messagePreview(last);
  return (
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
        <span style={c.unread ? { color: 'var(--ember-ink)', fontWeight: 800 } : undefined}>{listTime(c.lastActivityAt)}</span>
        <span style={{ minHeight: 20, display: 'flex' }}><Badge n={c.unread} /></span>
      </span>
    </a>
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
export function Conversation({ id, onBack, onInfo, infoOpen, jumpSeq }: { id: string; onBack: () => void; onInfo?: () => void; infoOpen?: boolean; jumpSeq?: number }) {
  const engine = useEngine();
  const s = useChatState();
  const me = useMe();
  const c = s.conversations[id];
  const thread = s.threads[id];
  const [error, setError] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<ThreadItem | null>(null);
  const [editing, setEditing] = useState<ThreadItem | null>(null);
  const [forwarding, setForwarding] = useState<ThreadItem | null>(null);
  const [deleting, setDeleting] = useState<ThreadItem | null>(null);
  const [infoOf, setInfoOf] = useState<ThreadItem | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [attachFiles, setAttachFiles] = useState<File[] | null>(null);
  const [viewerAt, setViewerAt] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [searching, setSearching] = useState(false);
  const jump = useRef<(seq: number) => void>(() => undefined);
  const jumped = useRef<string | null>(null);
  const actions = useMemo<Actions>(() => ({
    reply: (m) => { setEditing(null); setReplyTo(m); }, edit: (m) => { setReplyTo(null); setEditing(m); },
    forward: setForwarding, remove: setDeleting, info: setInfoOf, jumpTo: (seq) => jump.current(seq), error: setActionError,
  }), []);
  useEffect(() => { setReplyTo(null); setEditing(null); setForwarding(null); setDeleting(null); setInfoOf(null); setActionError(null); setAttachFiles(null); setViewerAt(null); setSearching(false); }, [id]);
  useEffect(() => {
    setError(null);
    void engine.open(id).then(() => { if (engine.getState().conversations[id]?.kind === 'group') return engine.loadGroup(id); }).catch((e) => setError(e instanceof ApiError && e.status === 404 ? 'This chat does not exist or you are not in it.' : 'Could not load this chat. Check your connection.'));
    return () => { if (engine.getState().active === id) void engine.open(null); };
  }, [engine, id]);
  // Opened from a search result: go to that message once the thread is there.
  const loaded = !!thread?.loaded;
  useEffect(() => {
    const k = `${id}:${jumpSeq}`;
    if (!jumpSeq || !loaded || jumped.current === k) return;
    jumped.current = k;
    setTimeout(() => jump.current(jumpSeq), 30);
  }, [id, jumpSeq, loaded]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const items = useMemo(() => engine.thread(id), [engine, id, thread, s.outbox, s.uploads, c]);

  if (error) return <div className="pane-center"><Banner>{error}</Banner><OvalButton icon="arrow-left" label="Back to chats" variant="ghost" onClick={onBack} /></div>;
  if (!c) return <div className="pane-center" aria-busy="true"><span className="ys-spin" aria-hidden /></div>;
  const peer = c.peer;
  const name = chatName(c);
  const typing = typingLabel(engine, c);
  const p = peer ? s.presence[peer.id] : undefined;
  const status = typing ?? (c.kind === 'group' ? memberLine(s.groups[id], me, '') : p?.online ? 'online' : p?.lastSeenAt ? lastSeen(p.lastSeenAt) : peer?.username ? `@${peer.username}` : '');
  return (
    <ActionsCtx.Provider value={actions}>
    <section className={`convo${dragging ? ' convo--drop' : ''}`} aria-label={`Chat with ${name}`}
      onDragOver={(e) => { if (c.canSend && e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDragging(true); } }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setDragging(false); }}
      onDrop={(e) => { e.preventDefault(); setDragging(false); const fs = [...e.dataTransfer.files]; if (fs.length && c.canSend) setAttachFiles(fs); }}>
      <header className="convo__head">
        <span className="convo__back"><OvalButton icon="arrow-left" label="Chats" size="sm" variant="ghost" onClick={onBack} /></span>
        <button type="button" className="convo__whobtn" onClick={onInfo} disabled={!onInfo || c.kind !== 'group'} aria-expanded={c.kind === 'group' ? !!infoOpen : undefined} aria-label={c.kind === 'group' ? 'Group info' : undefined}>
          <Avatar name={name} photoUrl={chatPhoto(c)} size={44} online={!!p?.online} />
          <span className="convo__who">
            <strong>{name}</strong>
            <span data-testid="peer-status" style={typing ? { color: 'var(--ember-ink)', fontWeight: 700 } : undefined}>{status}</span>
          </span>
        </button>
        <OvalButton icon="search" label="Search" size="sm" variant={searching ? 'soft' : 'ghost'} onClick={() => setSearching((v) => !v)} />
        {c.kind === 'group' && onInfo && <OvalButton icon="info" label="Info" size="sm" variant={infoOpen ? 'soft' : 'ghost'} onClick={onInfo} />}
      </header>
      {searching && <InChatSearch convId={id} onJump={(seq) => jump.current(seq)} onClose={() => setSearching(false)} />}
      <PinnedBar c={c} />
      {actionError && <div className="convo__error"><Banner>{actionError}</Banner><button type="button" className="icon-btn" aria-label="Dismiss" onClick={() => setActionError(null)}><Icon name="close" size={16} /></button></div>}
      <Thread id={id} items={items} me={me} typing={!!typing} loading={!thread?.loaded} hasMore={!!thread?.hasMore} group={c.kind === 'group'} c={c} jump={jump} onOpenMedia={setViewerAt} />
      {c.canSend ? <Composer id={id} replyTo={replyTo} editing={editing} onDone={() => { setReplyTo(null); setEditing(null); }} onFiles={setAttachFiles} /> : <LockedComposer c={c} onGone={onBack} />}
      {dragging && <div className="drop-hint" aria-hidden><Icon name="upload" size={32} /> Drop files to send them to {name}</div>}
    </section>
    {attachFiles && <AttachDialog files={attachFiles} name={name} replyToId={replyTo?.id ?? undefined} onClose={() => setAttachFiles(null)} onAdded={() => setReplyTo(null)} />}
    {viewerAt && <MediaViewer items={items} start={viewerAt} onClose={() => setViewerAt(null)} />}
    {forwarding && <ForwardDialog m={forwarding} from={id} onClose={() => setForwarding(null)} />}
    {deleting && <DeleteDialog m={deleting} c={c} onClose={() => setDeleting(null)} />}
    {infoOf && <MessageInfoPanel convId={id} m={infoOf} onClose={() => setInfoOf(null)} />}
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
    if (el.scrollTop < 60 && hasMore && !older && !loading) { setOlder(true); void engine.loadOlder(id).finally(() => setOlder(false)); }
  };
  let lastDay = '';
  return (
    <div className="convo__scroll" ref={box} onScroll={onScroll}>
      <div className="ys-thread convo__thread" role="log" aria-live="polite" aria-label="Messages">
        {(older || loading) && <span className="ys-spin" style={{ alignSelf: 'center' }} aria-label="Loading messages" />}
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
              {m.type === 'system' && m.system
                ? <div className="sys-line" data-testid="system-line">{systemText(m.system, m.senderId, (u) => engine.nameOf(u))}</div>
                : <Bubble m={m} mine={m.senderId === me} sender={showName ? engine.nameOf(m.senderId) : null} c={c} onOpenMedia={onOpenMedia} />}
            </div>
          );
        })}
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
        {(m.deleted || m.text) && <span className="msg__text">{m.deleted ? <em><Icon name="slash" size={14} /> {mine ? 'You deleted this message' : 'This message was deleted'}</em> : m.text}</span>}
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
  return (
    <div className="composer composer--locked" role="status">
      <span>{former ? 'You’re no longer in this group.' : 'Only admins can send messages.'}</span>
      {former && <button type="button" className="link-btn link-btn--danger" onClick={() => void engine.deleteGroup(c.id).then(onGone)}>Delete group</button>}
    </div>
  );
}

function Composer({ id, replyTo, editing, onDone, onFiles }: { id: string; replyTo: ThreadItem | null; editing: ThreadItem | null; onDone: () => void; onFiles: (f: File[]) => void }) {
  const engine = useEngine();
  const [recording, setRecording] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const drafts = useRef<Record<string, string>>({});
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const ta = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { setText(drafts.current[id] ?? ''); setError(null); ta.current?.focus(); }, [id]);
  // Editing puts the message's text in the box; leaving edit mode brings the draft back.
  useEffect(() => { if (editing) setText(editing.text); else setText(drafts.current[id] ?? ''); ta.current?.focus(); }, [editing, id]);
  useEffect(() => { if (replyTo) ta.current?.focus(); }, [replyTo]);
  useLayoutEffect(() => { const el = ta.current; if (el) { el.style.height = 'auto'; el.style.height = `${Math.min(el.scrollHeight, 160)}px`; } }, [text]);
  const len = textLength(text.trim());
  const tooLong = len > MAX_TEXT;
  const submit = async () => {
    if (!text.trim() || tooLong) return;
    const t = text;
    if (editing) {
      try { await engine.editMessage(id, editing.id!, t); onDone(); setText(drafts.current[id] ?? ''); }
      catch (e) { setError(e instanceof ApiError ? e.message : 'Could not save the edit. Check your connection.'); }
      return;
    }
    setText(''); drafts.current[id] = '';
    const reply = replyTo?.id ?? undefined;
    onDone();
    try { await engine.send(id, t, { replyToId: reply }); } catch (e) { setText(t); setError(e instanceof ApiError ? e.message : 'Could not send.'); }
  };
  // A screenshot pasted into the box opens the send sheet.
  const onPaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const fs = [...e.clipboardData.files];
    if (fs.length && !editing) { e.preventDefault(); onFiles(fs); }
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void submit(); }
    if (e.key === 'Escape' && (editing || replyTo)) { e.preventDefault(); onDone(); }
  };
  return (
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
        {!editing && <OvalButton icon="paperclip" label="Attach" size="sm" variant="ghost" onClick={() => fileInput.current?.click()} />}
        <input ref={fileInput} type="file" multiple hidden aria-label="Attach files" onChange={(e) => { const fs = [...(e.target.files ?? [])]; e.target.value = ''; if (fs.length) onFiles(fs); }} />
        <label htmlFor="composer" className="sr-only">Message</label>
        <textarea id="composer" ref={ta} rows={1} value={text} placeholder="Message" maxLength={MAX_TEXT * 2 + 10}
          onChange={(e) => { setText(e.target.value); drafts.current[id] = e.target.value; setError(null); engine.typing(id, e.target.value.trim().length > 0); }}
          onKeyDown={onKey} onPaste={onPaste} onBlur={() => engine.typing(id, false)} />
        {!text.trim() && !editing
          ? <OvalButton icon="mic" label="Record" size="md" onClick={() => setRecording(true)} />
          : <OvalButton type="submit" icon={editing ? 'check' : 'send'} label={editing ? 'Save' : 'Send'} size="md" disabled={!text.trim() || tooLong} />}
      </div>)}
    </form>
  );
}

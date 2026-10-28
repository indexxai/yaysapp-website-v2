'use client';
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { ApiError, messagePreview, DELETE_FOR_EVERYONE_MINUTES, EDIT_WINDOW_MINUTES, MAX_FORWARD_TARGETS, QUICK_REACTIONS, clock, type ConversationSummary, type MessageInfo, type ThreadItem } from '@yays/shared';
import { Icon, type IconName } from '@/lib/icons';
import { useChatState, useEngine } from '@/lib/chat';
import { Avatar, Banner, OvalButton } from './ui';

const minutesSince = (iso: string) => (Date.now() - Date.parse(iso)) / 60000;
export const canEdit = (m: ThreadItem) => m.mine && !!m.id && m.type === 'text' && !m.deleted && !m.forwarded && minutesSince(m.createdAt) <= EDIT_WINDOW_MINUTES;
export const canDeleteForEveryone = (m: ThreadItem, c: ConversationSummary) => !!m.id && !m.deleted && m.type !== 'system' && c.canSend !== undefined &&
  ((m.mine && minutesSince(m.createdAt) <= DELETE_FOR_EVERYONE_MINUTES) || (!m.mine && c.group?.role === 'admin'));

/** What the conversation is doing with a message: replying, editing, forwarding, deleting, or showing info. */
export interface Actions {
  reply(m: ThreadItem): void;
  edit(m: ThreadItem): void;
  forward(m: ThreadItem): void;
  remove(m: ThreadItem): void;
  info(m: ThreadItem): void;
  jumpTo(seq: number): void;
  error(msg: string): void;
}
export const ActionsCtx = createContext<Actions | null>(null);
export const useActions = () => useContext(ActionsCtx)!;
const errText = (e: unknown, f: string) => (e instanceof ApiError ? e.message : f);

/** Shows on hover / focus: react, reply, forward, more. */
export function ActionBar({ m, c }: { m: ThreadItem; c: ConversationSummary }) {
  const engine = useEngine();
  const act = useActions();
  const [open, setOpen] = useState<'react' | 'more' | null>(null);
  const [up, setUp] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  /** Opens the menu upwards when the chat has no room below the message. */
  const toggle = (what: 'react' | 'more') => {
    if (open === what) { setOpen(null); return; }
    const r = ref.current?.getBoundingClientRect();
    const box = ref.current?.closest('.convo__scroll')?.getBoundingClientRect();
    setUp(!!r && !!box && box.bottom - r.bottom < 300);
    setOpen(what);
  };
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(null); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(null); };
    document.addEventListener('mousedown', close); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [open]);
  if (!m.id || m.deleted || m.type === 'system') return null;
  const member = c.canSend || c.group?.role !== 'former';
  const myReaction = Object.entries(m.reactions ?? {}).find(([, us]) => us.includes(engine.me))?.[0];
  const pinned = c.pins.some((p) => p.messageId === m.id);
  const canPin = member && (c.kind === 'direct' || c.group?.role === 'admin' || c.group?.settings.pin === 'all');
  const run = (fn: () => Promise<unknown>, f: string) => { setOpen(null); void fn().catch((e) => act.error(errText(e, f))); };
  const items: Array<[IconName, string, () => void, boolean?]> = [
    ...(m.text ? [['copy', 'Copy', () => { void navigator.clipboard?.writeText(m.text).catch(() => undefined); setOpen(null); }] as [IconName, string, () => void]] : []),
    ...(m.attachment?.url ? [['download', 'Download', () => { setOpen(null); const l = document.createElement('a'); l.href = m.attachment!.url; l.download = m.attachment!.name; l.click(); }] as [IconName, string, () => void]] : []),
    ...(canEdit(m) ? [['edit', 'Edit', () => { setOpen(null); act.edit(m); }] as [IconName, string, () => void]] : []),
    ...(canPin ? [['pin', pinned ? 'Unpin' : 'Pin', () => run(() => engine.pin(c.id, m.id!, !pinned), 'Could not pin.')] as [IconName, string, () => void]] : []),
    ['star', m.starred ? 'Unstar' : 'Star', () => run(() => engine.star(c.id, m.id!, !m.starred), 'Could not star.')],
    ...(m.mine ? [['info', 'Message info', () => { setOpen(null); act.info(m); }] as [IconName, string, () => void]] : []),
    ['trash', 'Delete', () => { setOpen(null); act.remove(m); }, true],
  ];
  return (
    <span className="msg-actions" ref={ref} data-open={open ? 'true' : undefined}>
      {member && <button type="button" className="icon-btn" aria-label="React" aria-expanded={open === 'react'} onClick={() => toggle('react')}><Icon name="smile" size={16} /></button>}
      {member && c.canSend && <button type="button" className="icon-btn" aria-label="Reply" onClick={() => act.reply(m)}><Icon name="reply" size={16} /></button>}
      {m.type !== 'poll' && <button type="button" className="icon-btn" aria-label="Forward" onClick={() => act.forward(m)}><Icon name="forward" size={16} /></button>}
      <button type="button" className="icon-btn" aria-label="More actions" aria-expanded={open === 'more'} onClick={() => toggle('more')}><Icon name="more-horizontal" size={16} /></button>
      {open === 'react' && (
        <span className="react-pop" role="menu" aria-label="Reactions">
          {QUICK_REACTIONS.map((e) => (
            <button key={e} type="button" role="menuitem" aria-label={`React ${e}`} aria-pressed={myReaction === e}
              onClick={() => run(() => engine.react(c.id, m.id!, myReaction === e ? null : e), 'Could not react.')}>{e}</button>
          ))}
        </span>
      )}
      {open === 'more' && (
        <span className={`menu menu--msg${up ? ' menu--up' : ''}`} role="menu">
          {items.map(([icon, label, fn, danger]) => <button key={label} type="button" role="menuitem" className={danger ? 'danger' : undefined} onClick={fn}><Icon name={icon} size={16} /> {label}</button>)}
        </span>
      )}
    </span>
  );
}

/** "❤️ 2  👍 1" under a bubble. Clicking one adds or removes mine. */
export function Reactions({ m, c }: { m: ThreadItem; c: ConversationSummary }) {
  const engine = useEngine();
  const act = useActions();
  const list = Object.entries(m.reactions ?? {});
  if (!list.length || !m.id) return null;
  return (
    <span className="reactions">
      {list.map(([e, users]) => {
        const mine = users.includes(engine.me);
        const names = users.map((u) => engine.nameOf(u)).join(', ');
        return (
          <button key={e} type="button" className={`reaction${mine ? ' reaction--mine' : ''}`} title={names} aria-label={`${e} ${users.length}: ${names}`} aria-pressed={mine}
            disabled={!c.canSend && c.group?.role === 'former'}
            onClick={() => void engine.react(c.id, m.id!, mine ? null : e).catch((err) => act.error(errText(err, 'Could not react.')))}>
            {e} {users.length > 1 ? users.length : ''}
          </button>
        );
      })}
    </span>
  );
}

/** The quoted message inside a reply bubble. */
export function Quote({ r, onClick }: { r: NonNullable<ThreadItem['replyTo']>; onClick?: () => void }) {
  const engine = useEngine();
  return (
    <button type="button" className="quote" onClick={onClick} aria-label={`Replying to ${engine.nameOf(r.senderId)}`}>
      <span className="quote__body"><strong>{engine.nameOf(r.senderId)}</strong>
      <span>{messagePreview({ text: r.text, deleted: r.deleted, attachment: r.attachment })}</span></span>
      {r.attachment?.thumbUrl && !r.deleted && <img className="quote__thumb" src={r.attachment.thumbUrl} alt="" />}
    </button>
  );
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    box.current?.querySelector<HTMLElement>('input, button, textarea')?.focus();
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('keydown', esc); prev?.focus?.(); };
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} ref={box}>
        <div className="modal__head"><h2>{title}</h2><button type="button" className="icon-btn" aria-label="Close" onClick={onClose}><Icon name="close" size={20} /></button></div>
        {children}
      </div>
    </div>
  );
}

export function DeleteDialog({ m, c, onClose }: { m: ThreadItem; c: ConversationSummary; onClose: () => void }) {
  const engine = useEngine();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const go = async (fn: () => Promise<void>) => { setBusy(true); setError(null); try { await fn(); onClose(); } catch (e) { setError(errText(e, 'Could not delete.')); setBusy(false); } };
  const everyone = canDeleteForEveryone(m, c);
  return (
    <Modal title="Delete message?" onClose={onClose}>
      {error && <Banner>{error}</Banner>}
      <p className="muted" style={{ margin: 0 }}>{everyone ? (m.mine ? `You can delete it for everyone for ${DELETE_FOR_EVERYONE_MINUTES} minutes after sending.` : 'As an admin you can delete it for everyone in the group.') : 'This removes it from your devices only.'}</p>
      <div className="modal__actions">
        {everyone && <button type="button" className="btn btn--danger" disabled={busy} onClick={() => void go(() => engine.deleteForEveryone(c.id, m.id!))}>Delete for everyone</button>}
        <button type="button" className="btn" disabled={busy} onClick={() => void go(() => engine.deleteForMe(c.id, m.id!))}>Delete for me</button>
        <button type="button" className="btn btn--ghost" onClick={onClose}>Cancel</button>
      </div>
    </Modal>
  );
}

export function ForwardDialog({ m, from, onClose }: { m: ThreadItem; from: string; onClose: () => void }) {
  const engine = useEngine();
  const s = useChatState();
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const name = (c: ConversationSummary) => c.group?.name ?? c.peer?.displayName ?? 'Chat';
  const chats = s.order.map((id) => s.conversations[id]).filter((c) => c && c.group?.role !== 'former' && name(c).toLowerCase().includes(q.trim().toLowerCase()));
  const toggle = (id: string) => setPicked(picked.includes(id) ? picked.filter((x) => x !== id) : picked.length >= MAX_FORWARD_TARGETS ? picked : [...picked, id]);
  const send = async () => {
    setBusy(true); setError(null);
    try {
      const res = await engine.forward(from, m.id!, picked, note);
      const failed = res.filter((r) => !r.ok);
      if (failed.length) { setError(failed.map((f) => `${name(s.conversations[f.conversationId])}: ${f.error}`).join(' ')); setBusy(false); setPicked(failed.map((f) => f.conversationId)); return; }
      onClose();
    } catch (e) { setError(errText(e, 'Could not forward. Check your connection.')); setBusy(false); }
  };
  return (
    <Modal title="Forward to…" onClose={onClose}>
      <div className="fwd-preview"><Icon name="forward" size={16} /><span>{messagePreview(m)}</span></div>
      <div className="ys-field ys-field--pill"><label className="ys-field__label sr-only" htmlFor="fwdq">Search chats</label>
        <div className="ys-field__box"><Icon name="search" size={18} /><input id="fwdq" className="ys-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search chats" /></div></div>
      <div className="picker__list fwd-list" role="group" aria-label="Recent chats">
        {chats.map((c) => (
          <label key={c.id} className={`ys-row-item pick-row${!c.canSend ? ' pick-row--off' : ''}`}>
            <input type="checkbox" checked={picked.includes(c.id)} disabled={!c.canSend || (!picked.includes(c.id) && picked.length >= MAX_FORWARD_TARGETS)} onChange={() => toggle(c.id)} aria-label={name(c)} />
            <Avatar name={name(c)} photoUrl={c.group?.photoUrl ?? c.peer?.photoUrl} size={36} />
            <span className="ys-row-item__text"><span className="ys-row-item__title">{name(c)}</span><span className="ys-row-item__sub">{!c.canSend ? 'Only admins can send messages' : c.group ? `${c.group.memberCount} members` : c.peer?.username ? `@${c.peer.username}` : ''}</span></span>
          </label>
        ))}
      </div>
      {error && <Banner>{error}</Banner>}
      {picked.length > 0 && (
        <>
          <span className="muted">Sending to {picked.map((id) => name(s.conversations[id])).join(', ')}{picked.length >= MAX_FORWARD_TARGETS ? ` (up to ${MAX_FORWARD_TARGETS})` : ''}</span>
          <div className="ys-field"><label className="ys-field__label sr-only" htmlFor="fwdnote">Add a message</label>
            <div className="ys-field__box"><input id="fwdnote" className="ys-input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a message (optional)" /></div></div>
        </>
      )}
      <div className="modal__actions"><OvalButton icon="send" label="Forward" loading={busy} disabled={!picked.length} onClick={() => void send()} /></div>
    </Modal>
  );
}

export function MessageInfoPanel({ convId, m, onClose }: { convId: string; m: ThreadItem; onClose: () => void }) {
  const engine = useEngine();
  const [info, setInfo] = useState<MessageInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const s = useChatState();
  const c = s.conversations[convId];
  // Refresh when ticks move.
  useEffect(() => { void engine.messageInfo(convId, m.id!).then(setInfo, (e) => setError(errText(e, 'Could not load message info.'))); }, [engine, convId, m.id, c?.receipts]);
  const group = (label: string, icon: IconName, rows: Array<{ id: string; name: string; photo: string | null; at?: string }>) => (
    <section className="info-section" aria-label={label}>
      <h4 className="row" style={{ gap: 6 }}><Icon name={icon} size={16} /> {label}</h4>
      <div className="ys-list">
        {rows.length ? rows.map((r) => (
          <div key={r.id} className="ys-row-item"><Avatar name={r.name} photoUrl={r.photo} size={36} /><span className="ys-row-item__text"><span className="ys-row-item__title">{r.name}</span></span>{r.at && <span className="muted">{clock(r.at)}</span>}</div>
        )) : <span className="picker__empty">No one yet</span>}
      </div>
    </section>
  );
  return (
    <aside className="info-panel" aria-label="Message info">
      <div className="pane-head"><OvalButton icon="close" label="Close" size="sm" variant="ghost" onClick={onClose} /><h2>Message info</h2></div>
      <div className="info-panel__body">
        <div className="ys-bubble ys-bubble--me" style={{ alignSelf: 'flex-end', maxWidth: '100%' }}><span className="msg__text">{m.text}</span><span className="ys-bubble__meta"><span>{clock(m.createdAt)}</span></span></div>
        {error && <Banner>{error}</Banner>}
        {!info && !error && <span className="ys-spin" aria-label="Loading" />}
        {info && (
          <>
            {group(`Read by ${info.readBy.length}`, 'check-double', info.readBy.map((r) => ({ id: r.user.id, name: r.user.displayName, photo: r.user.photoUrl, at: r.at })))}
            {group(`Delivered to ${info.deliveredTo.length}`, 'check', info.deliveredTo.map((r) => ({ id: r.user.id, name: r.user.displayName, photo: r.user.photoUrl, at: r.at })))}
            {info.waiting.length > 0 && group(`Not delivered yet ${info.waiting.length}`, 'clock', info.waiting.map((p) => ({ id: p.id, name: p.displayName, photo: p.photoUrl })))}
          </>
        )}
      </div>
    </aside>
  );
}

/** The latest pinned message under the chat header; with more than one, clicking cycles through them. */
export function PinnedBar({ c }: { c: ConversationSummary }) {
  const engine = useEngine();
  const act = useActions();
  const [i, setI] = useState(0);
  if (!c.pins.length) return null;
  const p = c.pins[Math.min(i, c.pins.length - 1)];
  return (
    <button type="button" className="pinned-bar" aria-label={`Pinned message from ${engine.nameOf(p.senderId)}`} onClick={() => { act.jumpTo(p.seq); setI((i + 1) % c.pins.length); }}>
      <Icon name="pin" size={16} />
      <span><strong>Pinned{c.pins.length > 1 ? ` ${Math.min(i, c.pins.length - 1) + 1} of ${c.pins.length}` : ''}</strong> · {p.text || 'Message'}</span>
    </button>
  );
}

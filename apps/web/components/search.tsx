'use client';
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { ApiError, attachmentLabel, type SearchMessage, type SearchResults } from '@yays/shared';
import { Icon } from '@/lib/icons';
import { listTime, useEngine } from '@/lib/chat';
import { api } from '@/lib/api';
import { Avatar, Banner, OvalButton } from './ui';

type Tab = 'all' | 'chats' | 'people' | 'messages' | 'files';
const TABS: Array<[Tab, string]> = [['all', 'All'], ['chats', 'Chats'], ['people', 'People'], ['messages', 'Messages'], ['files', 'Files']];
const countLabel = (n: number) => (n >= 100 ? '99+' : String(n));

/** Shows the match in bold, with a little text either side so it reads in context. */
export function Highlight({ text, q, around = 28 }: { text: string; q: string; around?: number }) {
  const at = text.toLowerCase().indexOf(q.toLowerCase());
  if (!q || at < 0) return <>{text.length > around * 3 ? `${text.slice(0, around * 3)}…` : text}</>;
  const start = Math.max(0, at - around);
  const end = Math.min(text.length, at + q.length + around * 2);
  return <>{start > 0 && '…'}{text.slice(start, at)}<mark className="hit">{text.slice(at, at + q.length)}</mark>{text.slice(at + q.length, end)}{end < text.length && '…'}</>;
}

function useDebounced<T>(v: T, ms: number) {
  const [d, setD] = useState(v);
  useEffect(() => { const t = setTimeout(() => setD(v), ms); return () => clearTimeout(t); }, [v, ms]);
  return d;
}

/** Search across chats, people, messages and files (w18). Opening a message jumps to it in its chat. */
export function SearchPanel({ onClose, onOpen }: { onClose: () => void; onOpen: (convId: string, seq?: number) => void }) {
  const engine = useEngine();
  const [q, setQ] = useState('');
  const [tab, setTab] = useState<Tab>('all');
  const [res, setRes] = useState<SearchResults | null>(null);
  const [counts, setCounts] = useState<SearchResults['counts'] | null>(null);
  const [busy, setBusy] = useState(false);
  const [more, setMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const term = useDebounced(q.trim(), 250);
  useEffect(() => { input.current?.focus(); }, []);
  useEffect(() => {
    if (term.length < 2) { setRes(null); setCounts(null); setError(null); return; }
    let live = true;
    setBusy(true); setError(null);
    api().search(term, tab).then((r) => { if (!live) return; setRes(r); if (tab === 'all') setCounts(r.counts); })
      .catch((e) => { if (live) setError(e instanceof ApiError ? e.message : 'Search failed. Check your connection.'); })
      .finally(() => { if (live) setBusy(false); });
    return () => { live = false; };
  }, [term, tab]);
  const loadMore = async () => {
    if (!res?.next || (tab !== 'messages' && tab !== 'files')) return;
    setMore(true);
    try {
      const r = await api().search(term, tab, res.next);
      setRes({ ...res, messages: [...res.messages, ...r.messages], files: [...res.files, ...r.files], next: r.next });
    } catch { setError('Could not load more. Try again.'); } finally { setMore(false); }
  };
  const startWith = async (userId: string) => {
    try { const c = await engine.startDirect(userId); onOpen(c.id); } catch (e) { setError(e instanceof ApiError ? e.message : 'Could not open the chat.'); }
  };
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); if (q) setQ(''); else onClose(); } };
  const show = (t: Tab) => tab === 'all' || tab === t;
  const none = res && !res.chats.length && !res.people.length && !res.messages.length && !res.files.length;
  const hq = res?.query ?? term;

  return (
    <section aria-label="Search" className="search" onKeyDown={onKey}>
      <div className="search__bar">
        <OvalButton icon="arrow-left" label="Back" size="sm" variant="ghost" onClick={onClose} aria-label="Close search" />
        <div className="ys-field ys-field--pill" style={{ flex: 1 }}>
          <div className="ys-field__box">
            <Icon name="search" size={18} />
            <input ref={input} className="ys-input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search chats, people and messages" aria-label="Search chats, people and messages" maxLength={100} autoComplete="off" />
            {busy && <span className="ys-spin" aria-label="Searching" />}
          </div>
        </div>
      </div>
      <div className="search__tabs">
        <div className="ys-tabs" role="tablist" aria-label="Show">
          {TABS.map(([t, label]) => (
            <button key={t} type="button" role="tab" className="ys-tab" aria-selected={tab === t} onClick={() => setTab(t)}>
              {label}{counts && (t === 'messages' || t === 'files') && counts[t] > 0 ? <span className="search__count">{countLabel(counts[t])}</span> : null}
            </button>
          ))}
        </div>
      </div>
      <div className="search__results" aria-live="polite">
        {error && <div style={{ padding: '0 20px' }}><Banner>{error}</Banner></div>}
        {term.length < 2 && <p className="search__hint">Search your chats, the people in them, messages and files. Find anyone else by their exact @username.</p>}
        {none && !busy && <p className="search__hint" role="status">Nothing found for “{hq}”.</p>}
        {res && show('chats') && res.chats.length > 0 && (
          <Group title="Chats">
            {res.chats.map((c) => (
              <button key={c.id} type="button" className="ys-row-item" data-testid="search-chat" onClick={() => onOpen(c.id)}>
                <Avatar name={c.name} photoUrl={c.photoUrl} size={44} />
                <span className="ys-row-item__text"><span className="ys-row-item__title"><Highlight text={c.name} q={hq} /></span>
                  <span className="ys-row-item__sub">{c.kind === 'group' ? `Group · ${c.memberCount} members` : 'Chat'}</span></span>
              </button>
            ))}
          </Group>
        )}
        {res && show('people') && res.people.length > 0 && (
          <Group title="People">
            {res.people.map((p) => (
              <button key={p.id} type="button" className="ys-row-item" data-testid="search-person" onClick={() => void startWith(p.id)}>
                <Avatar name={p.displayName} photoUrl={p.photoUrl} size={44} />
                <span className="ys-row-item__text"><span className="ys-row-item__title"><Highlight text={p.displayName} q={hq} /></span>
                  <span className="ys-row-item__sub">{p.username ? `@${p.username}` : 'On YaysApp'}{p.stranger ? ' · not in your chats' : ''}</span></span>
                {p.stranger && <span className="ys-tag ys-tag--ember">Message</span>}
              </button>
            ))}
          </Group>
        )}
        {res && show('messages') && res.messages.length > 0 && (
          <Group title={`Messages${counts?.messages ? ` · ${countLabel(counts.messages)}` : ''}`}>
            {res.messages.map((m) => <MessageHit key={m.message.id} m={m} q={hq} onOpen={onOpen} />)}
          </Group>
        )}
        {res && show('files') && res.files.length > 0 && (
          <Group title="Files">
            {res.files.map((m) => (
              <button key={m.message.id} type="button" className="ys-row-item" data-testid="search-file" onClick={() => onOpen(m.chat.id, m.message.seq)}>
                <span className="ys-oval ys-oval--wash" style={{ width: 44 }}><Icon name="document" size={20} /></span>
                <span className="ys-row-item__text"><span className="ys-row-item__title"><Highlight text={m.message.attachment?.name ?? attachmentLabel(m.message.attachment!)} q={hq} /></span>
                  <span className="ys-row-item__sub">{m.chat.name} · {m.senderName}</span></span>
                <span className="ys-row-item__end">{listTime(m.message.createdAt)}</span>
              </button>
            ))}
          </Group>
        )}
        {res && tab === 'all' && (res.messages.length < (counts?.messages ?? 0)) && (
          <div className="search__more"><OvalButton icon="chevron-right" label="All messages" size="sm" variant="ghost" onClick={() => setTab('messages')} /></div>
        )}
        {res?.next && <div className="search__more"><OvalButton icon="chevron-down" label="More results" size="sm" variant="ghost" loading={more} onClick={() => void loadMore()} /></div>}
      </div>
    </section>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return <div role="group" aria-label={title}><h3 className="search__group">{title}</h3>{children}</div>;
}

function MessageHit({ m, q, onOpen }: { m: SearchMessage; q: string; onOpen: (c: string, seq?: number) => void }) {
  const text = m.message.text ?? (m.message.attachment ? attachmentLabel(m.message.attachment) : '');
  return (
    <button type="button" className="ys-row-item" data-testid="search-message" onClick={() => onOpen(m.chat.id, m.message.seq)}>
      <Avatar name={m.chat.name} photoUrl={m.chat.photoUrl} size={44} />
      <span className="ys-row-item__text">
        <span className="ys-row-item__title">{m.chat.name}</span>
        <span className="ys-row-item__sub search__snippet">{m.chat.kind === 'group' || m.senderName === 'You' ? `${m.senderName}: ` : ''}<Highlight text={text} q={q} /></span>
      </span>
      <span className="ys-row-item__end">{listTime(m.message.createdAt)}</span>
    </button>
  );
}

/** "Result 2 of 6" inside one chat. Enter / ↑ goes to older matches, Shift+Enter / ↓ to newer. */
export function InChatSearch({ convId, onJump, onClose }: { convId: string; onJump: (seq: number) => void; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [seqs, setSeqs] = useState<number[] | null>(null);
  const [at, setAt] = useState(0);
  const term = useDebounced(q.trim(), 300);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); }, []);
  useEffect(() => {
    if (term.length < 2) { setSeqs(null); return; }
    let live = true;
    api().searchInChat(convId, term).then((r) => {
      if (!live) return;
      setSeqs(r.seqs);
      if (r.seqs.length) { setAt(r.seqs.length - 1); onJump(r.seqs[r.seqs.length - 1]); }
    }).catch(() => { if (live) setSeqs([]); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [term, convId]);
  const go = (d: -1 | 1) => {
    if (!seqs?.length) return;
    const n = Math.min(seqs.length - 1, Math.max(0, at + d));
    setAt(n); onJump(seqs[n]);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); onClose(); }
    else if (e.key === 'Enter') { e.preventDefault(); go(e.shiftKey ? 1 : -1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); go(-1); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); go(1); }
  };
  const total = seqs?.length ?? 0;
  return (
    <div className="in-search" role="search" aria-label="Search in this chat">
      <Icon name="search" size={18} />
      <input ref={input} className="ys-input" type="search" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey} placeholder="Search in this chat" aria-label="Search in this chat" maxLength={100} />
      <span className="in-search__pos" role="status" data-testid="in-chat-result">
        {seqs === null ? '' : total ? `Result ${total - at} of ${total}${total >= 500 ? '+' : ''}` : 'No results'}
      </span>
      <button type="button" className="icon-btn" aria-label="Older result" disabled={!total || at === 0} onClick={() => go(-1)}><Icon name="chevron-up" size={18} /></button>
      <button type="button" className="icon-btn" aria-label="Newer result" disabled={!total || at === total - 1} onClick={() => go(1)}><Icon name="chevron-down" size={18} /></button>
      <button type="button" className="icon-btn" aria-label="Close search" onClick={onClose}><Icon name="close" size={18} /></button>
    </div>
  );
}

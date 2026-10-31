'use client';
import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ApiError, AI_MAX_INPUT, type AiChat, type AiChatSummary, type AiDocument, type AiMessage, type AiMode, type AiQuota } from '@yays/shared';
import { AppShell } from '@/components/app-shell';
import { Banner, LineArt, OvalButton } from '@/components/ui';
import { useMe } from '@/components/use-me';
import { api } from '@/lib/api';
import { Icon, type IconName } from '@/lib/icons';
import { downloadWord, mdToHtml, printPdf } from '@/lib/markdown';
import { errText, setBalance, timeLeft } from '@/lib/phase2';

export default function AiPage() { return <Suspense fallback={null}><Ai /></Suspense>; }

const MODES: Array<{ id: AiMode; label: string; icon: IconName; hint: string }> = [
  { id: 'chat', label: 'Chat', icon: 'chat', hint: 'Ask Jack anything…' },
  { id: 'search', label: 'Web search', icon: 'globe', hint: 'Ask about something current…' },
  { id: 'document', label: 'Document', icon: 'document', hint: 'Describe a document, or a change to it…' },
];
const SUGGEST = ['Give me 3 post ideas for my community', 'Translate “See you at 7” into Urdu', 'How do IndexxPoints work?', 'Write a one-page event proposal'];

function groupOf(c: AiChatSummary) {
  if (c.saved) return 'Saved';
  return new Date(c.updatedAt).toDateString() === new Date().toDateString() ? 'Today' : 'Earlier';
}

/** W2, W9, W12: Jack's AI conversations, documents and web answers with sources. */
function Ai() {
  const { me } = useMe();
  const router = useRouter();
  const id = useSearchParams().get('c');
  const [list, setList] = useState<AiChatSummary[] | null>(null);
  const [chat, setChat] = useState<AiChat | null>(null);
  const [quota, setQuota] = useState<AiQuota | null>(null);
  const [q, setQ] = useState('');
  const [text, setText] = useState('');
  const [mode, setMode] = useState<AiMode>('chat');
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [buying, setBuying] = useState(false);
  const thread = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { api().aiChats().then(setList).catch((e) => setError(errText(e))); api().aiQuota().then(setQuota).catch(() => undefined); }, []);
  useEffect(() => {
    setError(null);
    if (!id) { setChat(null); return; }
    let live = true;
    api().aiChat(id).then((c) => { if (live) { setChat(c); setQuota(c.quota); setMode(c.mode); } }).catch((e) => { if (live) setError(errText(e)); });
    return () => { live = false; };
  }, [id]);
  useEffect(() => { thread.current?.scrollTo({ top: thread.current.scrollHeight }); }, [chat?.messages.length, pending]);

  const out = !!quota && quota.used >= quota.limit;
  const send = async (t = text) => {
    const v = t.trim();
    if (!v || pending) return;
    setPending(v); setText(''); setError(null);
    try {
      const r = await api().aiAsk(chat?.id ?? null, v, mode);
      setQuota(r.quota);
      setList((l) => [r.chat, ...(l ?? []).filter((x) => x.id !== r.chat.id)]);
      setChat((c) => (c && c.id === r.chat.id
        ? { ...c, messages: [...c.messages, r.user, r.assistant], document: r.assistant.document ?? c.document, mode: r.chat.mode }
        : { ...r.chat, messages: [r.user, r.assistant], quota: r.quota, document: r.assistant.document ?? null }));
      if (!chat) router.replace(`/ai?c=${r.chat.id}`);
    } catch (e) {
      setText(v);
      setError(e instanceof ApiError && (e.details as { quota?: boolean } | undefined)?.quota ? null : errText(e));
      if (e instanceof ApiError && (e.details as { quota?: boolean } | undefined)?.quota) setQuota(await api().aiQuota().catch(() => quota));
    } finally { setPending(null); input.current?.focus(); }
  };
  const buy = async () => {
    setBuying(true); setError(null);
    try { setQuota(await api().aiBuyMessages()); void api().points().then((p) => setBalance(p.balance)); } catch (e) { setError(errText(e)); } finally { setBuying(false); }
  };
  const toggleSave = async () => {
    if (!chat) return;
    const s = await api().aiUpdateChat(chat.id, { saved: !chat.saved }).catch(() => null);
    if (s) { setChat({ ...chat, saved: s.saved }); setList((l) => l?.map((x) => (x.id === s.id ? s : x)) ?? null); }
  };
  const remove = async () => {
    if (!chat) return;
    await api().aiDeleteChat(chat.id).catch(() => undefined);
    setList((l) => l?.filter((x) => x.id !== chat.id) ?? null);
    router.replace('/ai');
  };

  const shown = useMemo(() => (list ?? []).filter((c) => !q.trim() || c.title.toLowerCase().includes(q.trim().toLowerCase())), [list, q]);
  const groups = ['Today', 'Saved', 'Earlier'].map((g) => [g, shown.filter((c) => groupOf(c) === g)] as const).filter(([, l]) => l.length);
  const lastSources = [...(chat?.messages ?? [])].reverse().find((m) => m.role === 'assistant')?.sources;
  const doc = chat?.document ?? null;
  const side = doc ? 'doc' : lastSources?.length ? 'sources' : null;

  return (
    <AppShell me={me} bare>
      <div className={`p2-ai${side ? ' p2-ai--side' : ''}`}>
        <aside className="p2-ai__list" aria-label="Conversations">
          <div className="chats__head"><h1>Jack’s AI</h1><OvalButton icon="plus" label="New chat" size="sm" onClick={() => { router.replace('/ai'); setMode('chat'); input.current?.focus(); }} /></div>
          <div className="ys-field ys-field--pill" style={{ margin: '0 16px 10px' }}><div className="ys-field__box"><Icon name="search" size={18} /><input className="ys-input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search conversations" aria-label="Search conversations" /></div></div>
          <nav className="p2-ai__convs">
            {groups.map(([g, l]) => (
              <div key={g}>
                <div className="p2-ai__group">{g}</div>
                {l.map((c) => (
                  <a key={c.id} href={`/ai?c=${c.id}`} onClick={(e) => { e.preventDefault(); router.replace(`/ai?c=${c.id}`); }} className="p2-ai__conv" aria-current={c.id === chat?.id ? 'page' : undefined}>
                    <Icon name={c.saved ? 'star' : c.mode === 'document' ? 'document' : c.mode === 'search' ? 'globe' : 'chat'} size={16} /><span>{c.title}</span>
                  </a>
                ))}
              </div>
            ))}
            {list && !list.length && <p className="muted p2-small" style={{ padding: '8px 20px' }}>Your conversations with Jack show here.</p>}
          </nav>
        </aside>

        <main className="p2-ai__main">
          <LineArt name="reader" height={340} opacity={0.12} className="p2-art p2-art--br" />
          <header className="p2-ai__head">
            <img src="/brand/jack.png" alt="" style={{ width: 28 }} />
            <strong>{chat?.title ?? 'New conversation'}</strong>
            {quota && <span className="p2-ai__quota" title={`Resets in ${timeLeft(quota.resetsAt)}`}><span className="p2-bar" style={{ width: 120 }}><span style={{ width: `${Math.min(100, Math.round((quota.used / quota.limit) * 100))}%` }} /></span>{quota.used} of {quota.limit} today</span>}
            {chat && <OvalButton icon="star" label={chat.saved ? 'Saved' : 'Save'} size="sm" variant={chat.saved ? 'soft' : 'ghost'} onClick={() => void toggleSave()} />}
            {chat && <OvalButton icon="trash" label="Delete" size="sm" variant="ghost" onClick={() => void remove()} />}
          </header>
          <div className="p2-ai__thread" ref={thread} aria-live="polite">
            {!chat && !pending && (
              <div className="p2-ai__hello">
                <img src="/brand/jack-bunny.png" alt="" />
                <h2>Hi{me ? `, ${me.displayName.split(/\s+/)[0]}` : ''}. What can I help with?</h2>
                <div className="chips">{SUGGEST.map((s) => <button key={s} type="button" className="chip p2-chip" onClick={() => { if (/proposal/i.test(s)) setMode('document'); void send(s); }}>{s}</button>)}</div>
              </div>
            )}
            {chat?.messages.map((m) => <Bubble key={m.id} m={m} />)}
            {pending && (<><div className="ys-bubble ys-bubble--me p2-ai__me">{pending}</div><div className="p2-ai__bot"><img src="/brand/jack.png" alt="" /><div className="p2-ai__working"><span className="ys-spin" aria-hidden />{mode === 'document' ? (doc ? 'Updating the document…' : 'Writing the document…') : mode === 'search' ? 'Searching the web…' : 'Thinking…'}</div></div></>)}
          </div>
          <div className="p2-ai__foot">
            {error && <Banner>{error}</Banner>}
            {out && quota ? (
              <div role="status" className="p2-ai__out">
                <span className="ys-oval ys-oval--ember" style={{ width: 44 }}><Icon name="clock" size={20} /></span>
                <span style={{ flex: 1 }}><strong>You’ve used today’s {quota.limit} messages.</strong><br /><span className="muted">They reset at midnight (in {timeLeft(quota.resetsAt)}). You can still read and copy past answers.</span></span>
                <OvalButton icon="star" label={`Use ${quota.extraCost} points`} size="sm" loading={buying} onClick={() => void buy()} />
              </div>
            ) : (
              <>
                <div className="ys-tabs p2-ai__modes" role="radiogroup" aria-label="Kind of answer">
                  {MODES.map((x) => <button key={x.id} type="button" role="radio" className="ys-tab" aria-checked={mode === x.id} aria-selected={mode === x.id} onClick={() => setMode(x.id)}><Icon name={x.icon} size={14} /> {x.label}</button>)}
                </div>
                <form className="p2-ai__compose" onSubmit={(e) => { e.preventDefault(); void send(); }}>
                  <textarea ref={input} className="p2-ai__input" rows={1} value={text} maxLength={AI_MAX_INPUT} placeholder={MODES.find((x) => x.id === mode)!.hint} aria-label="Message Jack" onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }} />
                  <OvalButton icon="send" label="Send" size="md" type="submit" disabled={!text.trim() || !!pending} />
                </form>
              </>
            )}
          </div>
        </main>

        {side === 'doc' && doc && <DocPanel doc={doc} />}
        {side === 'sources' && lastSources && (
          <aside className="p2-ai__side" aria-label="Sources">
            <h2>Sources</h2>
            {lastSources.map((s) => (
              <a key={s.n} href={s.url} target="_blank" rel="noopener noreferrer" className="p2-source">
                <span className="p2-source__top"><b>{s.n}</b><span>{s.domain}</span><Icon name="external" size={14} /></span>
                <strong>{s.title}</strong>
                {s.quote && <span className="muted">“{s.quote}”</span>}
              </a>
            ))}
          </aside>
        )}
      </div>
    </AppShell>
  );
}

function Bubble({ m }: { m: AiMessage }) {
  const [copied, setCopied] = useState(false);
  if (m.role === 'user') return <div className="ys-bubble ys-bubble--me p2-ai__me">{m.text}</div>;
  const copy = async () => { try { await navigator.clipboard.writeText(m.document ? m.document.markdown : m.text); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* no clipboard */ } };
  return (
    <div className="p2-ai__bot">
      <img src="/brand/jack.png" alt="Jack’s AI" />
      <div className="p2-ai__answer">
        {m.mode === 'search' && m.sources?.length ? <span className="p2-ai__searched"><Icon name="globe" size={14} />Searched the web · used {m.sources.length} source{m.sources.length === 1 ? '' : 's'}</span> : null}
        <div className="p2-md" dangerouslySetInnerHTML={{ __html: mdToHtml(m.text, m.sources) }} />
        {m.document && <div className="p2-ai__docchip"><span className="p2-ai__doctype">DOC</span><span className="p2-col"><strong>{m.document.title}</strong><span className="muted p2-xs">Version {m.document.version}</span></span></div>}
        {m.mode === 'search' && <span className="p2-ai__note"><Icon name="info" size={14} />Answers about current events can change. Check the sources.</span>}
        <div className="p2-ai__tools"><button type="button" aria-label={copied ? 'Copied' : 'Copy'} title={copied ? 'Copied' : 'Copy'} onClick={() => void copy()}><Icon name={copied ? 'check' : 'copy'} size={16} /></button></div>
      </div>
    </div>
  );
}

function DocPanel({ doc }: { doc: AiDocument }) {
  const [blocked, setBlocked] = useState(false);
  return (
    <aside className="p2-ai__side p2-ai__side--doc" aria-label="Document preview">
      <div className="p2-ai__dochead">
        <span className="p2-ai__doctype">DOC</span>
        <span className="p2-col" style={{ flex: 1, minWidth: 0 }}><strong>{doc.title}</strong><span className="muted p2-xs">Version {doc.version}</span></span>
      </div>
      <div className="row" style={{ gap: 18, padding: '0 18px 12px' }}>
        <OvalButton icon="download" label="Word" size="sm" variant="soft" onClick={() => downloadWord(doc.title, doc.markdown)} />
        <OvalButton icon="document" label="PDF" size="sm" variant="soft" onClick={() => setBlocked(!printPdf(doc.title, doc.markdown))} />
      </div>
      {blocked && <div style={{ padding: '0 18px' }}><Banner tone="warning">Your browser blocked the print window. Allow pop-ups for this site and try again.</Banner></div>}
      <div className="p2-ai__paper"><article className="p2-md p2-doc" dangerouslySetInnerHTML={{ __html: mdToHtml(doc.markdown) }} /></div>
    </aside>
  );
}

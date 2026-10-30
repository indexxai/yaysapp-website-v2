'use client';
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ApiError, callDuration, type CallHistoryItem, type CallLink, type CallMedia } from '@yays/shared';
import { AppShell } from '@/components/app-shell';
import { useCalls } from '@/components/call';
import { chatName } from '@/components/chat';
import { Modal } from '@/components/message-actions';
import { Switch } from '@/components/group';
import { Avatar, Banner, LineArt, OvalButton } from '@/components/ui';
import { useMe } from '@/components/use-me';
import { api } from '@/lib/api';
import { clock, dayLabel, lastSeen, useChatState, useEngine } from '@/lib/chat';
import { Icon, type IconName } from '@/lib/icons';

const errText = (e: unknown, f: string) => (e instanceof ApiError ? e.message : f);
type Filter = 'all' | 'missed' | 'video';

export default function CallsPage() {
  return <Suspense fallback={null}><Calls /></Suspense>;
}

function Calls() {
  const { me, error } = useMe();
  if (!me) return <AppShell me={null}><div className="pane-center">{error ? <Banner>{error}</Banner> : <span className="ys-spin" aria-label="Loading" />}</div></AppShell>;
  return <AppShell me={me} bare><CallsLayout /></AppShell>;
}

/** One row per run of calls with the same person and result on the same day: "Missed (2)". */
interface Row { key: string; first: CallHistoryItem; count: number; ids: string[] }
function group(items: CallHistoryItem[]): Row[] {
  const out: Row[] = [];
  for (const i of items) {
    const prev = out[out.length - 1];
    const same = prev && (prev.first.conversationId ?? prev.first.id) === (i.conversationId ?? i.id) && prev.first.result === i.result && prev.first.direction === i.direction && prev.first.media === i.media && dayLabel(prev.first.at) === dayLabel(i.at) && i.result !== 'answered';
    if (same) { prev.count++; prev.ids.push(i.id); } else out.push({ key: i.id, first: i, count: 1, ids: [i.id] });
  }
  return out;
}

function resultText(i: CallHistoryItem, count = 1) {
  const n = count > 1 ? ` (${count})` : '';
  switch (i.result) {
    case 'answered': return `${i.direction === 'out' ? 'Outgoing' : 'Incoming'} · ${callDuration(i.durationSec, true)}`;
    case 'missed': return `Missed${n}`;
    case 'silenced': return `Silenced · unknown caller${n}`;
    case 'declined': return `Declined${n}`;
    case 'no_answer': return `No answer${n}`;
    case 'busy': return `Busy${n}`;
    case 'cancelled': return `Cancelled${n}`;
    case 'live': return 'On a call now';
  }
}
const dirIcon = (i: CallHistoryItem): IconName => (i.result === 'missed' || i.result === 'silenced' ? 'call-missed' : i.direction === 'out' ? 'call-outgoing' : 'call-incoming');

function CallsLayout() {
  const engine = useEngine();
  const s = useChatState();
  const router = useRouter();
  const params = useSearchParams();
  const calls = useCalls();
  const [filter, setFilter] = useState<Filter>('all');
  const [items, setItems] = useState<CallHistoryItem[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<'new' | 'link' | null>(null);
  const selected = params.get('id');
  const load = useCallback(async (more?: string) => {
    try {
      const p = await api().callHistory({ filter, before: more });
      setItems((x) => (more && x ? [...x, ...p.items] : p.items)); setNext(p.next); setError(null);
    } catch (e) { setError(errText(e, 'Could not load your calls.')); }
  }, [filter]);
  useEffect(() => { setItems(null); void load(); }, [load]);
  // Opening call history counts as having seen missed calls.
  useEffect(() => { void engine.callsSeen(); }, [engine]);
  // A call ending (or a new one) refreshes the list.
  const endedKey = Object.values(s.calls).map((c) => `${c.id}:${c.status}`).join(',');
  useEffect(() => { if (endedKey) void load(); }, [endedKey, load]);
  const rows = useMemo(() => group(items ?? []), [items]);
  const missed = (items ?? []).filter((i) => i.result === 'missed').length;
  const sel = rows.find((r) => r.ids.includes(selected ?? ''))?.first ?? null;
  let lastDay = '';
  return (
    <div className={`chats calls${sel ? ' chats--open' : ''}`}>
      <aside className="chats__list" aria-label="Call history">
        <div className="calls__head">
          <h1>Calls</h1>
          <div style={{ display: 'flex', gap: 12 }}>
            <OvalButton icon="phone" label="New call" size="sm" variant="primary" onClick={() => setDialog('new')} />
            <OvalButton icon="link" label="Call link" size="sm" variant="soft" onClick={() => setDialog('link')} />
          </div>
        </div>
        <div className="list-filters">
          <div className="ys-tabs" role="tablist" aria-label="Filter calls">
            {([['all', 'All'], ['missed', 'Missed'], ['video', 'Video']] as Array<[Filter, string]>).map(([f, label]) => (
              <button key={f} type="button" role="tab" className="ys-tab" aria-selected={filter === f} onClick={() => setFilter(f)}>
                {label}{f === 'missed' && filter === 'all' && missed > 0 && <span className="search__count">{missed}</span>}
              </button>
            ))}
          </div>
        </div>
        {error && <div style={{ padding: '0 16px' }}><Banner>{error}</Banner></div>}
        <nav className="chat-rows" aria-label="Calls">
          {items === null && !error && <span className="ys-spin" style={{ margin: 24, alignSelf: 'center' }} aria-label="Loading calls" />}
          {items && !items.length && (
            <div className="calls__empty">
              <span className="ys-oval ys-oval--wash" style={{ width: 64 }}><Icon name="phone" size={26} /></span>
              <strong>{filter === 'missed' ? 'No missed calls' : filter === 'video' ? 'No video calls yet' : 'No calls yet'}</strong>
              <span className="muted">Start one from a chat, or make a call link to share.</span>
            </div>
          )}
          {rows.map((r) => {
            const i = r.first, day = dayLabel(i.at);
            const sep = day !== lastDay; lastDay = day;
            const red = i.result === 'missed';
            return (
              <div key={r.key} style={{ display: 'contents' }}>
                {sep && <div className="calls__day">{day}</div>}
                <div className="ys-row-item call-row" aria-current={sel?.id === i.id ? 'true' : undefined} data-testid="call-row">
                  <button type="button" className="call-row__open" onClick={() => router.push(`/calls?id=${i.id}`)} aria-label={`${i.title}, ${resultText(i, r.count)}, ${clock(i.at)}`}>
                    <Avatar name={i.title} photoUrl={i.photoUrl} size={44} group={i.kind === 'group'} />
                    <span className="ys-row-item__text">
                      <span className="ys-row-item__title" style={red ? { color: 'var(--danger-ink)' } : undefined}>{i.title}</span>
                      <span className="ys-row-item__sub" style={{ display: 'flex', alignItems: 'center', gap: 4, ...(red || i.result === 'silenced' ? { color: 'var(--danger-ink)' } : {}) }}><Icon name={dirIcon(i)} size={14} />{resultText(i, r.count)}</span>
                    </span>
                  </button>
                  <span className="call-row__end">
                    <span>{clock(i.at)}</span>
                    {i.conversationId && i.result !== 'live' && <button type="button" className="icon-btn" style={{ color: 'var(--ember-ink)' }} aria-label={`Call ${i.title} (${i.media})`} onClick={() => void calls.start(i.conversationId!, i.media).catch(() => undefined)}><Icon name={i.media === 'video' ? 'video' : 'phone'} size={18} /></button>}
                  </span>
                </div>
              </div>
            );
          })}
          {next && <OvalButton icon="clock" label="Show older calls" size="sm" variant="soft" style={{ margin: 12 }} onClick={() => void load(next)} />}
        </nav>
      </aside>
      <main className="chats__pane calls__main">
        {sel ? <CallDetail item={sel} onBack={() => router.push('/calls')} /> : <PermissionCard />}
      </main>
      {dialog === 'new' && <NewCallDialog onClose={() => setDialog(null)} />}
      {dialog === 'link' && <CallLinkDialog onClose={() => setDialog(null)} />}
      {s.connection === 'offline' && null}
    </div>
  );
}

function CallDetail({ item, onBack }: { item: CallHistoryItem; onBack: () => void }) {
  const s = useChatState();
  const calls = useCalls();
  const router = useRouter();
  const [list, setList] = useState<CallHistoryItem[] | null>(null);
  useEffect(() => {
    setList(null);
    if (!item.conversationId) { setList([item]); return; }
    void api().callHistory({ conversationId: item.conversationId, limit: 20 }).then((p) => setList(p.items)).catch(() => setList([item]));
  }, [item]);
  const c = item.conversationId ? s.conversations[item.conversationId] : undefined;
  const pres = item.peerId ? s.presence[item.peerId] : undefined;
  const sub = c?.kind === 'group' ? `${c.memberIds.length} member${c.memberIds.length === 1 ? '' : 's'}` : [c?.peer?.username ? `@${c.peer.username}` : null, pres?.online ? 'online' : pres?.lastSeenAt ? lastSeen(pres.lastSeenAt) : null].filter(Boolean).join(' · ');
  const canCall = !!item.conversationId && (c ? c.canSend : true);
  const start = (m: CallMedia) => { if (item.conversationId) void calls.start(item.conversationId, m).catch(() => undefined); };
  return (
    <div className="call-detail" role="region" aria-label={`Calls with ${item.title}`}>
      <span className="call-detail__back"><OvalButton icon="arrow-left" label="Calls" size="sm" variant="ghost" onClick={onBack} /></span>
      <span className="ys-feature__deco b" style={{ width: 420, top: -180, right: -140, opacity: 0.45 }} aria-hidden />
      <LineArt name={item.kind === 'group' ? 'hype' : 'reader'} height={260} opacity={0.08} className="call-detail__art" />
      <div className="call-detail__body">
        <Avatar name={item.title} photoUrl={item.photoUrl} size={96} online={!!pres?.online} group={item.kind === 'group'} />
        <h2>{item.title}</h2>
        {sub && <span className="muted" style={{ fontSize: 14 }}>{sub}</span>}
        <div style={{ display: 'flex', gap: 28, margin: '16px 0 8px' }}>
          <OvalButton icon="phone" label="Voice" size="lg" variant="primary" disabled={!canCall} onClick={() => start('voice')} />
          <OvalButton icon="video" label="Video" size="lg" variant="soft" disabled={!canCall} onClick={() => start('video')} />
          {item.conversationId && <OvalButton icon="chats" label="Message" size="lg" variant="soft" onClick={() => router.push(`/chats?c=${item.conversationId}`)} />}
        </div>
        <section className="call-detail__card">
          <h3>Call details</h3>
          {list === null && <span className="ys-spin" style={{ margin: 16 }} aria-label="Loading" />}
          {list?.map((i) => {
            const red = i.result === 'missed';
            const label = `${red ? 'Missed' : i.result === 'silenced' ? 'Silenced' : i.direction === 'out' ? 'Outgoing' : 'Incoming'} ${i.kind === 'group' ? 'group ' : ''}${i.media} call`;
            const detail = i.result === 'answered' ? callDuration(i.durationSec, true) : i.result === 'no_answer' ? 'No answer' : i.result === 'declined' ? 'Declined' : i.result === 'busy' ? 'Busy' : i.result === 'silenced' ? 'Unknown caller' : i.result === 'live' ? 'Now' : i.result === 'cancelled' ? 'Cancelled' : 'Not answered';
            return (
              <div key={i.id} className="ys-row-item" style={{ minHeight: 52, cursor: 'default' }} data-testid="call-detail-row">
                <span className="ys-oval" style={{ width: 36, ['--ys-oval-fill' as string]: red ? 'var(--sunken)' : 'var(--ember-wash)', ['--ys-oval-ink' as string]: red ? 'var(--danger-ink)' : 'var(--ember-ink)' }}><Icon name={i.media === 'video' ? 'video' : 'phone'} size={16} /></span>
                <span className="ys-row-item__text"><span className="ys-row-item__title" style={{ fontSize: 14, ...(red ? { color: 'var(--danger-ink)' } : {}) }}>{label}</span><span className="ys-row-item__sub">{detail}</span></span>
                <span className="muted" style={{ fontSize: 13 }}>{dayLabel(i.at) === 'Today' ? clock(i.at) : `${dayLabel(i.at)} ${clock(i.at)}`}</span>
              </div>
            );
          })}
        </section>
        <PermissionCard compact />
      </div>
    </div>
  );
}

/** Asks for microphone and camera ahead of the first call, so answering isn't held up by the browser's question. */
function PermissionCard({ compact }: { compact?: boolean }) {
  const [state, setState] = useState<'unknown' | 'granted' | 'denied' | 'prompt'>('unknown');
  useEffect(() => {
    let alive = true;
    const check = async () => {
      try {
        const [m, c] = await Promise.all([navigator.permissions.query({ name: 'microphone' as PermissionName }), navigator.permissions.query({ name: 'camera' as PermissionName })]);
        if (!alive) return;
        setState(m.state === 'granted' && c.state === 'granted' ? 'granted' : m.state === 'denied' || c.state === 'denied' ? 'denied' : 'prompt');
      } catch { if (alive) setState('prompt'); }
    };
    void check();
    return () => { alive = false; };
  }, []);
  const ask = async () => {
    try { const st = await navigator.mediaDevices.getUserMedia({ audio: true, video: true }); st.getTracks().forEach((t) => t.stop()); setState('granted'); } catch { setState('denied'); }
  };
  if (state === 'granted' || state === 'unknown') return compact ? null : (
    <div className="pane-center pane-welcome">
      <span className="ys-feature__deco a" style={{ width: 460, top: -200, left: -160, opacity: 0.5 }} aria-hidden />
      <div className="pane-welcome__body">
        <LineArt name="morning" width={150} />
        <h2 className="pane-welcome__title" style={{ fontSize: 24 }}>Pick a call to see its details</h2>
        <p>Or start a new call, or make a link anyone can join.</p>
      </div>
    </div>
  );
  const card = (
    <div className="perm-card">
      <LineArt name="selfie" width={58} opacity={0.7} style={{ flex: 'none' }} />
      <span style={{ flex: 1, fontSize: 13, lineHeight: '19px', color: 'var(--ink-soft)' }}>
        <strong style={{ color: 'var(--ink)' }}>{state === 'denied' ? 'Microphone and camera are blocked' : 'Allow microphone and camera'}</strong><br />
        {state === 'denied' ? 'Turn them on for this site in your browser’s settings (the icon next to the address).' : 'Your browser asks once. Without it, calls from this tab can’t start.'}
      </span>
      {state === 'prompt' && <OvalButton icon="mic" label="Allow" size="sm" variant="soft" onClick={() => void ask()} />}
    </div>
  );
  return compact ? card : <div className="pane-center" style={{ maxWidth: 560, margin: '0 auto' }}>{card}</div>;
}

function NewCallDialog({ onClose }: { onClose: () => void }) {
  const s = useChatState();
  const calls = useCalls();
  const [q, setQ] = useState('');
  const list = s.order.map((id) => s.conversations[id]!).filter((c) => c && c.canSend && !c.group?.announcements && chatName(c).toLowerCase().includes(q.trim().toLowerCase())).slice(0, 50);
  const go = (id: string, m: CallMedia) => { onClose(); void calls.start(id, m).catch(() => undefined); };
  return (
    <Modal title="New call" onClose={onClose}>
      <div className="ys-field__box" style={{ borderRadius: 999 }}><Icon name="search" size={18} /><input className="ys-input" style={{ border: 0, background: 'transparent', flex: 1 }} placeholder="Search chats" aria-label="Search chats" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      <div className="new-call__list">
        {!list.length && <p className="muted" style={{ margin: 8 }}>{q ? 'No chats match.' : 'Start a chat first, then call from here.'}</p>}
        {list.map((c) => (
          <div key={c.id} className="call-request" data-testid="new-call-row">
            <Avatar name={chatName(c)} photoUrl={c.group?.photoUrl ?? c.peer?.photoUrl ?? null} size={40} group={c.kind === 'group'} />
            <span style={{ flex: 1, minWidth: 0 }}><strong>{chatName(c)}</strong>{c.kind === 'group' && <span className="muted" style={{ display: 'block', fontSize: 12 }}>Group · {c.memberIds.length} member{c.memberIds.length === 1 ? '' : 's'}</span>}</span>
            <button type="button" className="icon-btn" style={{ color: 'var(--ember-ink)' }} aria-label={`Voice call ${chatName(c)}`} onClick={() => go(c.id, 'voice')}><Icon name="phone" size={20} /></button>
            <button type="button" className="icon-btn" style={{ color: 'var(--ember-ink)' }} aria-label={`Video call ${chatName(c)}`} onClick={() => go(c.id, 'video')}><Icon name="video" size={20} /></button>
          </div>
        ))}
      </div>
    </Modal>
  );
}

function CallLinkDialog({ onClose }: { onClose: () => void }) {
  const s = useChatState();
  const engine = useEngine();
  const calls = useCalls();
  const router = useRouter();
  const [link, setLink] = useState<CallLink | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [name, setName] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  useEffect(() => { void api().createCallLink({ media: 'video', approve: true }).then(setLink).catch((e) => setError(errText(e, 'Could not make a call link.'))); }, []);
  const full = link ? `${location.origin}${link.url}` : '';
  const update = (v: Partial<Pick<CallLink, 'name' | 'media' | 'approve'>>) => { if (!link) return; setLink({ ...link, ...v }); void api().updateCallLink(link.code, v).then(setLink).catch((e) => setError(errText(e, 'Could not save that.'))); };
  const copy = async () => { try { await navigator.clipboard.writeText(full); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { setError('Copy didn’t work. Select the link and copy it.'); } };
  const share = async () => { if (navigator.share) { try { await navigator.share({ title: link?.name || 'YaysApp call', url: full }); } catch { /* cancelled */ } } else await copy(); };
  const sendTo = (id: string) => { void engine.send(id, `Join my ${link?.media ?? 'video'} call on YaysApp: ${full}`); setSent(chatName(s.conversations[id]!)); setSending(false); };
  const join = async () => { if (!link) return; onClose(); try { await calls.joinLink(link.code); } catch { router.push(link.url); } };
  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal call-link" role="dialog" aria-modal="true" aria-labelledby="cl-t">
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <span className="ys-oval ys-oval--ember" style={{ width: 52 }}><Icon name="link" size={22} /></span>
            <span><h2 id="cl-t" style={{ margin: 0, font: '800 22px var(--font-display)' }}>{link ? 'Call link ready' : 'Making a call link…'}</h2><span className="muted" style={{ fontSize: 13 }}>Anyone with the link can ask to join.</span></span>
          </div>
          <span className="modal__close"><OvalButton icon="close" label="Close" size="sm" variant="soft" onClick={onClose} /></span>
        </div>
        {error && <Banner>{error}</Banner>}
        {sent && <Banner tone="success">Sent to {sent}.</Banner>}
        <div className="call-link__url">
          <input readOnly aria-label="Call link" value={full} onFocus={(e) => e.currentTarget.select()} />
          <button type="button" className="call-link__copy" onClick={() => void copy()} disabled={!link}><Icon name={copied ? 'check' : 'copy'} size={14} />{copied ? 'Copied' : 'Copy'}</button>
        </div>
        <div style={{ display: 'flex', gap: 10 }} role="radiogroup" aria-label="Call type">
          {(['video', 'voice'] as const).map((m) => (
            <button key={m} type="button" role="radio" aria-checked={link?.media === m} className={`call-link__type${link?.media === m ? ' call-link__type--on' : ''}`} onClick={() => update({ media: m })} disabled={!link}>
              <Icon name={m === 'video' ? 'video' : 'phone'} size={18} />{m === 'video' ? 'Video call' : 'Voice call'}
            </button>
          ))}
        </div>
        <section className="call-link__opts">
          <div style={{ padding: '4px 16px' }}><Switch on={!!link?.approve} disabled={!link} onChange={(v) => update({ approve: v })} label="Approve people before they join" hint="You’ll see a request for anyone who isn’t in your contacts." /></div>
          <label className="ys-row-item" style={{ minHeight: 48 }}>
            <span className="ys-row-item__text"><span className="ys-row-item__title" style={{ fontSize: 14 }}>Link name</span></span>
            <input className="ys-input call-link__name" placeholder="Optional" aria-label="Link name" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} onBlur={() => { if (link && name.trim() !== link.name) update({ name }); }} disabled={!link} />
          </label>
        </section>
        {sending && (
          <div className="new-call__list" aria-label="Send to">
            {s.order.slice(0, 30).map((id) => s.conversations[id]).filter((c) => c?.canSend).map((c) => (
              <button key={c!.id} type="button" className="ys-row-item" style={{ minHeight: 52 }} onClick={() => sendTo(c!.id)}><Avatar name={chatName(c!)} photoUrl={c!.group?.photoUrl ?? c!.peer?.photoUrl ?? null} size={32} group={c!.kind === 'group'} /><span className="ys-row-item__title">{chatName(c!)}</span></button>
            ))}
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'center', gap: 26, marginTop: 4 }}>
          <OvalButton icon="forward" label="Send in a chat" variant="soft" disabled={!link} onClick={() => setSending((v) => !v)} />
          <OvalButton icon="share" label="Share" variant="secondary" disabled={!link} onClick={() => void share()} />
          <OvalButton icon={link?.media === 'voice' ? 'phone' : 'video'} label="Join now" variant="primary" disabled={!link} onClick={() => void join()} />
        </div>
      </div>
    </div>
  );
}

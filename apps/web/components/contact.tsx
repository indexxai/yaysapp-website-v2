'use client';
import { useEffect, useMemo, useState } from 'react';
import { ApiError, REPORT_REASONS, type ChatMessage, type ChatOverview, type ConversationSummary, type MuteFor, type ReportReason, type SharedTab, type ThreadItem } from '@yays/shared';
import { Icon } from '@/lib/icons';
import { api } from '@/lib/api';
import { dayLabel, useChatState, useEngine } from '@/lib/chat';
import { ConfirmButton, Switch } from './group';
import { MediaViewer } from './media';
import { Modal } from './message-actions';
import { Avatar, Banner, OvalButton } from './ui';

const errText = (e: unknown, f: string) => (e instanceof ApiError ? e.message : f);
const REASON_LABEL: Record<ReportReason, string> = { spam: 'Spam', scam: 'Scam or fraud', harassment: 'Harassment', other: 'Something else' };

export const isMuted = (c: ConversationSummary) => !!c.mutedUntil && Date.parse(c.mutedUntil) > Date.now();
export function muteLabel(c: ConversationSummary) {
  if (!isMuted(c)) return 'On';
  const until = new Date(c.mutedUntil!);
  if (until.getUTCFullYear() >= 9999) return 'Muted always';
  return `Muted until ${dayLabel(c.mutedUntil!)}, ${until.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}
export const MUTE_CHOICES: Array<[MuteFor, string]> = [['8h', '8 hours'], ['1w', '1 week'], ['always', 'Always']];

/** Turns server messages into the shape the media viewer takes. */
const asItems = (ms: ChatMessage[], me: string): ThreadItem[] => ms.map((m) => ({
  key: m.clientId, id: m.id, mine: m.senderId === me, type: m.type, text: m.text, attachment: m.attachment, createdAt: m.createdAt, seq: m.seq, senderId: m.senderId, clientId: m.clientId, tick: null,
}));

/** Contact info for a direct chat (w15): profile, shared media, groups in common, mute, block, report, clear. */
export function ContactInfoPanel({ id, onClose, onJump, onSearch, onOpenChat }: { id: string; onClose: () => void; onJump: (seq: number) => void; onSearch: () => void; onOpenChat: (id: string) => void }) {
  const engine = useEngine();
  const s = useChatState();
  const c = s.conversations[id];
  const [o, setO] = useState<ChatOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [view, setView] = useState<'info' | 'shared'>('info');
  const [dialog, setDialog] = useState<'block' | 'report' | null>(null);
  const [viewer, setViewer] = useState<string | null>(null);
  const load = () => api().chatOverview(id).then(setO).catch((e) => setError(errText(e, 'Could not load contact info.')));
  useEffect(() => { setView('info'); }, [id]);
  // Fresh counts as messages come and go.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { const t = setTimeout(() => void load(), 300); return () => clearTimeout(t); }, [id, c?.blocked, c?.visibleFrom, c?.lastSeq]);
  if (!c?.peer) return null;
  const p = c.peer;
  const presence = s.presence[p.id];
  const run = async (fn: () => Promise<unknown>, ok?: string) => { setError(null); setNotice(null); try { await fn(); if (ok) setNotice(ok); } catch (e) { setError(errText(e, 'That did not work. Try again.')); } };
  if (view === 'shared') return <aside className="info-panel" aria-label="Media, links and docs"><SharedView id={id} name={p.displayName} onBack={() => setView('info')} onJump={onJump} /></aside>;
  const total = o ? o.counts.media + o.counts.docs + o.counts.links : 0;
  return (
    <aside className="info-panel" aria-label="Contact info">
      <div className="pane-head">
        <OvalButton icon="close" label="Close" size="sm" variant="ghost" onClick={onClose} />
        <h2>Contact info</h2>
      </div>
      <div className="info-panel__body">
        {error && <Banner>{error}</Banner>}
        {notice && <Banner tone="success">{notice}</Banner>}
        <div className="info-hero">
          <Avatar name={p.displayName} photoUrl={p.photoUrl} size={88} online={!!presence?.online} />
          <h3>{p.displayName}</h3>
          <span className="muted">{p.username ? `@${p.username}` : 'On YaysApp'}</span>
          <div className="row" style={{ gap: 22 }}>
            <OvalButton icon="search" label="Search" size="sm" variant="soft" onClick={onSearch} />
          </div>
        </div>
        {p.about && <section className="info-section"><h4>About</h4><p style={{ margin: 0 }}>{p.about}</p></section>}
        {c.blocked && <Banner tone="warning">You blocked {p.displayName}. They can’t call you or send you messages.</Banner>}

        <section className="info-section" aria-label="Media, links and docs">
          <button type="button" className="info-link" onClick={() => setView('shared')} disabled={!o}>
            <strong>Media, links and docs</strong><span className="info-link__count">{o ? total : ''}</span><Icon name="chevron-right" size={16} />
          </button>
          {o && o.recentMedia.length > 0 && (
            <div className="media-grid media-grid--4">
              {o.recentMedia.slice(0, 4).map((m, i) => (
                <button key={m.id} type="button" className="media-tile" aria-label={`Open ${m.attachment?.kind === 'video' ? 'video' : 'photo'} ${i + 1}`} onClick={() => setViewer(m.clientId)}>
                  <img src={m.attachment!.thumbUrl || m.attachment!.url} alt="" />
                  {m.attachment!.kind === 'video' && <span className="media-tile__badge"><Icon name="video" size={12} /></span>}
                </button>
              ))}
            </div>
          )}
          {o && !total && <span className="muted" style={{ fontSize: 13 }}>Nothing shared yet.</span>}
        </section>

        <section className="info-section">
          <a className="info-row" href={`/settings/starred?c=${id}`} style={{ textDecoration: 'none', cursor: 'pointer' }}><span className="ys-oval ys-oval--wash" style={{ width: 32 }}><Icon name="star" size={16} /></span><span className="info-row__text">Starred messages</span><span className="muted">{o?.counts.starred ?? ''}</span></a>
          <MuteRow c={c} run={run} />
          {c.pins.length > 0 && (
            <button type="button" className="info-row" onClick={() => onJump(c.pins[0].seq)}>
              <span className="ys-oval ys-oval--wash" style={{ width: 32 }}><Icon name="pin" size={16} /></span>
              <span className="info-row__text">Pinned messages<small>{c.pins[0].text}</small></span><span className="muted">{c.pins.length}</span>
            </button>
          )}
        </section>

        {o && o.commonGroups.length > 0 && (
          <section className="info-section" aria-label="Groups in common">
            <h4>{o.commonGroups.length} group{o.commonGroups.length === 1 ? '' : 's'} in common</h4>
            <div className="ys-list">
              {o.commonGroups.map((g) => (
                <button key={g.id} type="button" className="ys-row-item" onClick={() => onOpenChat(g.id)}>
                  <Avatar name={g.name} photoUrl={g.photoUrl} size={40} />
                  <span className="ys-row-item__text"><span className="ys-row-item__title">{g.name}</span><span className="ys-row-item__sub">{g.memberCount} members</span></span>
                </button>
              ))}
            </div>
          </section>
        )}

        <section className="info-section info-danger">
          <div className="row" style={{ gap: 18, flexWrap: 'wrap' }}>
            {c.blocked
              ? <OvalButton icon="block" label={`Unblock`} size="sm" variant="soft" onClick={() => void run(() => engine.unblock(p.id), `${p.displayName} is unblocked.`)} />
              : <OvalButton icon="block" label="Block" size="sm" variant="danger" onClick={() => setDialog('block')} />}
            <OvalButton icon="flag" label="Report" size="sm" variant="danger" onClick={() => setDialog('report')} />
            <ConfirmButton label="Clear chat" icon="trash" danger={false} confirm="Clear" question="Clear all messages in this chat? They stay for the other person." onConfirm={() => run(() => engine.clearChat(id), 'Chat cleared.')} />
          </div>
        </section>
      </div>
      {dialog && <BlockReportDialog mode={dialog} c={c} onClose={() => setDialog(null)} onDone={(t) => { setDialog(null); setNotice(t); }} />}
      {viewer && o && <MediaViewer items={asItems([...o.recentMedia].reverse(), engine.me)} start={viewer} onClose={() => setViewer(null)} />}
    </aside>
  );
}

/** Notifications for this chat: on, or muted for a while. */
export function MuteRow({ c, run }: { c: ConversationSummary; run: (fn: () => Promise<unknown>, ok?: string) => Promise<void> }) {
  const engine = useEngine();
  const muted = isMuted(c);
  return (
    <label className="info-row">
      <span className="ys-oval ys-oval--wash" style={{ width: 32 }}><Icon name={muted ? 'bell-off' : 'bell'} size={16} /></span>
      <span className="info-row__text">Notifications{muted && <small>{muteLabel(c)}</small>}</span>
      <select className="mini-select" aria-label="Notifications" value={muted ? 'muted' : 'off'}
        onChange={(e) => { const v = e.target.value as MuteFor | 'off'; void run(() => engine.setChatPrefs(c.id, { mute: v }), v === 'off' ? 'Notifications are on.' : 'Muted.'); }}>
        <option value="off">On</option>
        {muted && <option value="muted" disabled>Muted</option>}
        {MUTE_CHOICES.map(([v, l]) => <option key={v} value={v}>Mute for {l.toLowerCase()}</option>)}
      </select>
    </label>
  );
}

/** Block (m53) or report a person, or report a group. The other side is never told. */
export function BlockReportDialog({ mode, c, message, onClose, onDone }: { mode: 'block' | 'report'; c: ConversationSummary; message?: ThreadItem; onClose: () => void; onDone: (notice: string) => void }) {
  const engine = useEngine();
  // Reporting one message reports its sender.
  const person = message ? { id: message.senderId, displayName: engine.nameOf(message.senderId) } : c.kind === 'direct' ? c.peer : null;
  const name = message ? 'this message' : person?.displayName ?? c.group?.name ?? 'this chat';
  const who = person?.displayName ?? name;
  const [also, setAlso] = useState(mode === 'report' && !!person && !message);
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reporting = mode === 'report' || also;
  const go = async () => {
    if (reporting && !reason) { setError('Pick a reason for the report.'); return; }
    setBusy(true); setError(null);
    try {
      if (reporting) await engine.report({ ...(message?.id ? { messageId: message.id } : person ? { userId: person.id } : {}), conversationId: c.id, reason: reason!, block: !!person && (mode === 'block' || also) });
      else await engine.block(person!.id);
      if (reporting && person && (mode === 'block' || also)) await engine.block(person.id).catch(() => undefined);
      onDone(mode === 'block' ? (reporting ? `${who} is blocked and reported.` : `${who} is blocked.`) : also ? `Thanks. ${who} is reported and blocked.` : c.group?.community && message ? 'Thanks for reporting. The community’s admins will look at it.' : 'Thanks for reporting. Our team will look at it.');
    } catch (e) { setError(errText(e, 'That did not work. Try again.')); setBusy(false); }
  };
  return (
    <Modal title={mode === 'block' ? `Block ${name}?` : `Report ${name}?`} onClose={onClose}>
      {error && <Banner>{error}</Banner>}
      {mode === 'block' && (
        <ul className="bullets">
          <li><Icon name="block" size={18} />They can’t call you or send you messages.</li>
          <li><Icon name="eye-off" size={18} />They won’t see when you’re online or your photo.</li>
          <li><Icon name="bell-off" size={18} />They are not told that you blocked them.</li>
        </ul>
      )}
      <div className="report-box">
        {person && <Switch on={also} onChange={setAlso} label={mode === 'block' ? 'Also report to YaysApp' : `Also block ${who}`} />}
        {reporting && (
          <>
            <div role="radiogroup" aria-label="Reason" className="reason-chips">
              {REPORT_REASONS.map((r) => <button key={r} type="button" role="radio" aria-checked={reason === r} className="reason-chip" onClick={() => setReason(r)}>{REASON_LABEL[r]}</button>)}
            </div>
            <span className="muted" style={{ fontSize: 12, lineHeight: '17px' }}>{message ? 'This message is sent with your report.' : person ? `The last 5 messages from ${who} are sent with your report.` : 'The last 5 messages in this group are sent with your report.'} Nobody in the chat is told.</span>
          </>
        )}
      </div>
      <div className="modal__actions">
        <button type="button" className="btn btn--ghost" onClick={onClose}>Cancel</button>
        <button type="button" className="btn btn--danger" disabled={busy} onClick={() => void go()}>{mode === 'block' ? (also ? 'Block and report' : 'Block') : also ? 'Report and block' : 'Report'}</button>
      </div>
    </Modal>
  );
}

/** Media, docs and links shared in a chat (m39), newest first. */
function SharedView({ id, name, onBack, onJump }: { id: string; name: string; onBack: () => void; onJump: (seq: number) => void }) {
  const engine = useEngine();
  const [tab, setTab] = useState<SharedTab>('media');
  const [items, setItems] = useState<ChatMessage[] | null>(null);
  const [next, setNext] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [viewer, setViewer] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setItems(null); setError(null);
    api().sharedItems(id, tab).then((r) => { if (live) { setItems(r.items); setNext(r.next); } }).catch((e) => live && setError(errText(e, 'Could not load.')));
    return () => { live = false; };
  }, [id, tab]);
  const more = async () => { if (!next) return; const r = await api().sharedItems(id, tab, next); setItems((x) => [...(x ?? []), ...r.items]); setNext(r.next); };
  const months = useMemo(() => {
    const out: Array<[string, ChatMessage[]]> = [];
    for (const m of items ?? []) {
      const d = new Date(m.createdAt);
      const label = Date.now() - d.getTime() < 7 * 86400_000 ? 'This week' : d.toLocaleDateString([], { month: 'long', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
      const last = out[out.length - 1];
      if (last?.[0] === label) last[1].push(m); else out.push([label, [m]]);
    }
    return out;
  }, [items]);
  const linkOf = (t: string) => /(https?:\/\/[^\s]+|www\.[^\s]+)/i.exec(t)?.[1] ?? '';
  return (
    <>
      <div className="pane-head">
        <OvalButton icon="arrow-left" label={name.split(' ')[0]} size="sm" variant="ghost" onClick={onBack} />
        <h2>Media, links and docs</h2>
      </div>
      <div style={{ padding: '0 16px 10px' }}>
        <div className="ys-tabs" role="tablist" aria-label="Type">
          {(['media', 'docs', 'links'] as const).map((t) => <button key={t} type="button" role="tab" className="ys-tab" aria-selected={tab === t} onClick={() => setTab(t)}>{t === 'media' ? 'Media' : t === 'docs' ? 'Docs' : 'Links'}</button>)}
        </div>
      </div>
      <div className="info-panel__body" style={{ padding: '0 8px 24px', gap: 4 }}>
        {error && <Banner>{error}</Banner>}
        {!items && !error && <span className="ys-spin" style={{ alignSelf: 'center' }} aria-label="Loading" />}
        {items && !items.length && <p className="search__hint">No {tab === 'media' ? 'photos or videos' : tab} shared yet.</p>}
        {months.map(([label, ms]) => (
          <div key={label}>
            <h3 className="search__group" style={{ margin: '10px 8px 6px' }}>{label}</h3>
            {tab === 'media' ? (
              <div className="media-grid">
                {ms.map((m) => (
                  <button key={m.id} type="button" className="media-tile" data-testid="shared-media" aria-label={m.attachment!.name} onClick={() => setViewer(m.clientId)}>
                    <img src={m.attachment!.thumbUrl || m.attachment!.url} alt="" />
                    {m.attachment!.kind === 'video' && <span className="media-tile__badge"><Icon name="video" size={12} /></span>}
                  </button>
                ))}
              </div>
            ) : ms.map((m) => (
              <div key={m.id} className="ys-row-item" data-testid={`shared-${tab}`}>
                <span className="ys-oval ys-oval--wash" style={{ width: 40 }}><Icon name={tab === 'docs' ? 'document' : 'link'} size={18} /></span>
                <span className="ys-row-item__text">
                  {tab === 'docs'
                    ? <a className="ys-row-item__title" href={m.attachment!.url} download={m.attachment!.name}>{m.attachment!.name}</a>
                    : <a className="ys-row-item__title" href={linkOf(m.text).startsWith('http') ? linkOf(m.text) : `https://${linkOf(m.text)}`} target="_blank" rel="noopener noreferrer">{linkOf(m.text)}</a>}
                  <span className="ys-row-item__sub">{engine.nameOf(m.senderId)} · {dayLabel(m.createdAt)}</span>
                </span>
                <button type="button" className="icon-btn" aria-label="Show in chat" onClick={() => onJump(m.seq)}><Icon name="arrow-right" size={18} /></button>
              </div>
            ))}
          </div>
        ))}
        {next && <div className="search__more"><OvalButton icon="chevron-down" label="More" size="sm" variant="ghost" onClick={() => void more()} /></div>}
      </div>
      {viewer && items && <MediaViewer items={asItems([...items].reverse(), engine.me)} start={viewer} onClose={() => setViewer(null)} />}
    </>
  );
}

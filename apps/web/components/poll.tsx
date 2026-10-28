'use client';
import { useState, type FormEvent, type ReactNode } from 'react';
import { ApiError, POLL_LIMITS, type ThreadItem } from '@yays/shared';
import { Icon } from '@/lib/icons';
import { useEngine } from '@/lib/chat';
import { Switch } from './group';
import { Modal } from './message-actions';
import { Avatar, Banner } from './ui';

const errText = (e: unknown, f: string) => (e instanceof ApiError ? e.message : f);
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Message text with @mentions picked out (mine stand out more). */
export function MessageText({ m, me, nameOf }: { m: ThreadItem; me: string; nameOf: (id: string) => string }): ReactNode {
  if (!m.mentions?.length) return m.text;
  const names = new Map(m.mentions.map((id) => [`@${nameOf(id)}`.toLowerCase(), id]));
  const pats = [...names.keys()].filter((n) => n.length > 2).sort((a, b) => b.length - a.length).map(escapeRe);
  if (!pats.length) return m.text;
  const parts = m.text.split(new RegExp(`(${pats.join('|')})`, 'gi'));
  return parts.map((p, i) => {
    const id = names.get(p.toLowerCase());
    return id ? <span key={i} className={`mention${id === me ? ' mention--me' : ''}`} data-mention={id}>{p}</span> : p;
  });
}

/** A poll in a bubble: tap an option to vote (again to take it back), counts and bars, and who voted. */
export function PollContent({ m, convId, canVote }: { m: ThreadItem; convId: string; canVote: boolean }) {
  const engine = useEngine();
  const [error, setError] = useState<string | null>(null);
  const [showVotes, setShowVotes] = useState(false);
  const p = m.poll!;
  const mine = new Set(p.myVotes ?? []);
  const top = Math.max(1, ...p.options.map((o) => o.votes));
  const pick = (id: string) => {
    if (!canVote || !m.id) return;
    setError(null);
    const next = p.multi ? (mine.has(id) ? [...mine].filter((x) => x !== id) : [...mine, id]) : mine.has(id) ? [] : [id];
    void engine.vote(convId, m.id, next).catch((e) => setError(errText(e, 'Your vote didn’t go through. Try again.')));
  };
  return (
    <div className="poll" role="group" aria-label={`Poll: ${p.question}`}>
      <strong className="poll__q">{p.question}</strong>
      <span className="poll__hint">{p.multi ? 'Pick one or more' : 'Pick one'}{p.anonymous ? ' · votes are hidden' : ''}</span>
      {p.options.map((o) => (
        <button key={o.id} type="button" className="poll__opt" role={p.multi ? 'checkbox' : 'radio'} aria-checked={mine.has(o.id)} disabled={!canVote || !m.id} onClick={() => pick(o.id)}
          aria-label={`${o.text}, ${o.votes} vote${o.votes === 1 ? '' : 's'}`}>
          <span className={`poll__box${p.multi ? '' : ' poll__box--round'}`} aria-hidden>{mine.has(o.id) && <Icon name="check" size={12} strokeWidth={3} />}</span>
          <span className="poll__main">
            <span className="poll__row"><span>{o.text}</span><strong>{o.votes}</strong></span>
            <span className="poll__bar"><span style={{ width: `${(o.votes / top) * 100}%` }} /></span>
          </span>
        </button>
      ))}
      {error && <span className="poll__error" role="alert">{error}</span>}
      <span className="poll__foot">
        <span data-testid="poll-count">{p.voterCount === 0 ? 'No votes yet' : `${p.voterCount} ${p.voterCount === 1 ? 'person' : 'people'} voted`}</span>
        {!p.anonymous && p.voterCount > 0 && <button type="button" className="link-btn" onClick={() => setShowVotes(true)}>View votes</button>}
      </span>
      {showVotes && (
        <Modal title="Votes" onClose={() => setShowVotes(false)}>
          <strong>{p.question}</strong>
          {p.options.map((o) => (
            <section key={o.id} aria-label={o.text} className="info-section">
              <h4>{o.text} · {o.votes}</h4>
              {(o.voters ?? []).map((u) => <div key={u} className="row" style={{ gap: 10 }}><Avatar name={engine.nameOf(u)} size={28} /><span>{u === engine.me ? 'You' : engine.nameOf(u)}</span></div>)}
            </section>
          ))}
        </Modal>
      )}
    </div>
  );
}

/** m42: question, 2 to 12 options, one or several answers, hide who voted. */
export function PollDialog({ convId, name, onClose }: { convId: string; name: string; onClose: () => void }) {
  const engine = useEngine();
  const [q, setQ] = useState('');
  const [opts, setOpts] = useState(['', '']);
  const [multi, setMulti] = useState(false);
  const [anonymous, setAnonymous] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const filled = opts.map((o) => o.trim()).filter(Boolean);
  /** A box repeating an option above it. */
  const isDupe = (i: number) => { const v = opts[i].trim().toLowerCase(); return !!v && opts.slice(0, i).some((x) => x.trim().toLowerCase() === v); };
  const dupes = opts.some((_, i) => isDupe(i));
  const setOpt = (i: number, v: string) => {
    const next = [...opts]; next[i] = v;
    // There's always one empty box to type the next option into, up to the limit.
    while (next.length > 2 && !next[next.length - 1].trim() && !next[next.length - 2].trim()) next.pop();
    if (next[next.length - 1].trim() && next.length < POLL_LIMITS.maxOptions) next.push('');
    setOpts(next);
  };
  const remove = (i: number) => { const next = opts.filter((_, j) => j !== i); while (next.length < 2) next.push(''); setOpts(next); };
  const ok = q.trim() && filled.length >= 2 && !dupes;
  const send = async (e: FormEvent) => {
    e.preventDefault();
    if (!ok) return;
    setBusy(true); setError(null);
    try { await engine.createPoll(convId, { question: q, options: filled, multi, anonymous }); onClose(); }
    catch (err) { setError(errText(err, 'Could not send the poll. Check your connection.')); setBusy(false); }
  };
  return (
    <Modal title="New poll" onClose={onClose}>
      <span className="muted" style={{ marginTop: -10, fontSize: 13 }}>In {name}</span>
      {error && <Banner>{error}</Banner>}
      <form className="ys-col" style={{ padding: 0, gap: 12 }} onSubmit={send}>
        <div className="ys-field">
          <label className="ys-field__label" htmlFor="poll-q">Question</label>
          <div className="ys-field__box"><input id="poll-q" className="ys-input" value={q} maxLength={POLL_LIMITS.question} onChange={(e) => setQ(e.target.value)} autoFocus /><span className="muted" style={{ fontSize: 12 }}>{q.length}/{POLL_LIMITS.question}</span></div>
        </div>
        <span className="ys-field__label">Options</span>
        {opts.map((o, i) => (
          <div key={i} className={`ys-field${isDupe(i) ? ' ys-field--error' : ''}`}>
            <div className="ys-field__box">
              <input className="ys-input" value={o} maxLength={POLL_LIMITS.option} placeholder={i < 2 ? `Option ${i + 1}` : 'Add option'} aria-label={`Option ${i + 1}`} onChange={(e) => setOpt(i, e.target.value)} />
              {o && opts.length > 2 && <button type="button" className="icon-btn" aria-label={`Remove option ${i + 1}`} onClick={() => remove(i)}><Icon name="close" size={16} /></button>}
            </div>
            {isDupe(i) && <span className="ys-field__hint">This option is already in the poll.</span>}
          </div>
        ))}
        <span className="muted" style={{ fontSize: 12 }}>2 to {POLL_LIMITS.maxOptions} options.</span>
        <div className="report-box" style={{ padding: '0 14px' }}>
          <Switch on={multi} onChange={setMulti} label="Allow more than one answer" />
          <Switch on={anonymous} onChange={setAnonymous} label="Hide who voted" hint="Only counts are shown" />
        </div>
        <div className="modal__actions">
          <button type="button" className="btn btn--ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn--primary" disabled={!ok || busy}>Send poll</button>
        </div>
      </form>
    </Modal>
  );
}

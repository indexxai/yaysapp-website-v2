'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CIRCLE_LIMITS, POST_REPORT_LABEL, POST_REPORT_REASONS, moneySchemeMatches,
  type CircleComment, type CirclePost, type CircleView, type MeProfile, type PostReportReason, type SchemeMatch,
} from '@yays/shared';
import { api } from '@/lib/api';
import { Icon } from '@/lib/icons';
import { Modal } from '../message-actions';
import { Avatar, Banner, LineArt, OvalButton } from '../ui';
import { AuthorTags, Marked, Note, State, Tag, ago, dateShort, errText, offline } from './common';

/* ------------------------------------------------------------------ composer */

interface Draft { id: string; text: string; files: File[]; error: string }

/** p40 / W19: write a post. Money-scheme wording is caught before it goes (p49 / W23). Offline posts wait to be retried (p50). */
export function Composer({ c, me, onPosted, onFailed, onEvent }: { c: CircleView; me: MeProfile; onPosted: (p: CirclePost) => void; onFailed: (d: Draft) => void; onEvent: () => void }) {
  const [text, setText] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flagged, setFlagged] = useState<SchemeMatch[] | null>(null);
  const pick = useRef<HTMLInputElement>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const reset = () => { setText(''); setFiles([]); setFlagged(null); };
  const send = async (mode: 'normal' | 'review') => {
    const t = text.trim();
    if (!t && !files.length) return;
    if (mode === 'normal') { const m = moneySchemeMatches(t); if (m.length) { setFlagged(m); return; } }
    setBusy(true); setError(null);
    try {
      const photoKeys = await Promise.all(files.map((f) => api().uploadPostPhoto(f)));
      onPosted(await api().createCirclePost(c.id, { text: t, photoKeys, send: mode }));
      reset();
    } catch (e) {
      if (offline(e)) { onFailed({ id: crypto.randomUUID(), text: t, files, error: '' }); reset(); }
      else if ((e as { details?: { reason?: string; matches?: SchemeMatch[] } }).details?.reason === 'money_scheme') setFlagged((e as { details: { matches: SchemeMatch[] } }).details.matches);
      else setError(errText(e, 'Your post didn’t go. Try again.'));
    } finally { setBusy(false); }
  };
  const left = CIRCLE_LIMITS.post - text.length;
  return (
    <div className="ccompose" data-testid="composer">
      {error && <Banner>{error}</Banner>}
      <div className="ccompose__row">
        <Avatar name={me.displayName} photoUrl={me.photoUrl} size={40} />
        <textarea ref={area} className="ccompose__input" aria-label="Write a post" placeholder="Share an update or ask a question…" value={text} maxLength={CIRCLE_LIMITS.post}
          rows={text ? 3 : 1} onChange={(e) => setText(e.target.value)} />
      </div>
      {files.length > 0 && (
        <div className="cphotos cphotos--edit">
          {files.map((f, i) => (
            <span key={i} className="cphotos__item"><img src={URL.createObjectURL(f)} alt="" /><button type="button" className="cphotos__x" aria-label="Remove photo" onClick={() => setFiles(files.filter((_, j) => j !== i))}><Icon name="close" size={14} /></button></span>
          ))}
        </div>
      )}
      <div className="ccompose__tools">
        <input ref={pick} type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple hidden onChange={(e) => { const add = [...(e.target.files ?? [])].slice(0, CIRCLE_LIMITS.photos - files.length); setFiles([...files, ...add]); e.target.value = ''; }} />
        <OvalButton icon="image" label="Photo" size="sm" variant="ghost" disabled={files.length >= CIRCLE_LIMITS.photos} onClick={() => pick.current?.click()} />
        <OvalButton icon="calendar" label="Event" size="sm" variant="ghost" onClick={onEvent} />
        <span style={{ flex: 1 }} />
        {left < 200 && <span className="muted p2-small">{left}</span>}
        <OvalButton icon="send" label="Post" size="sm" loading={busy} disabled={!text.trim() && !files.length} onClick={() => void send('normal')} />
      </div>
      {flagged && (
        <Modal title="This looks like an investment offer" onClose={() => setFlagged(null)}>
          <span className="ys-oval cstate__oval cstate__oval--danger" style={{ width: 64, alignSelf: 'center' }}><Icon name="alert-triangle" size={28} /></span>
          <p className="cflag__text"><Marked text={text.trim()} marks={flagged} /></p>
          <Note icon="alert-triangle" tone="danger">Circles don’t allow promising profits or asking people for money. We marked the parts that look like that. Edit them, or send the post to the owners to decide.</Note>
          <div className="modal__actions">
            <OvalButton icon="send" label="Send to owners" size="md" variant="ghost" loading={busy} onClick={() => void send('review')} />
            <OvalButton icon="edit" label="Edit post" size="md" onClick={() => { setFlagged(null); area.current?.focus(); }} />
          </div>
          <p className="muted p2-small" style={{ margin: 0, textAlign: 'center' }}>If you send it, the owners decide. Repeated scam posts get people removed.</p>
        </Modal>
      )}
    </div>
  );
}

/** p50: a post that didn't go because the connection dropped. */
export function FailedPost({ d, me, onRetry, onEdit, onDelete }: { d: Draft; me: MeProfile; onRetry: () => void; onEdit: () => void; onDelete: () => void }) {
  return (
    <article className="cpost cpost--failed" data-testid="failed-post">
      <div className="cpost__head"><Avatar name={me.displayName} photoUrl={me.photoUrl} size={40} /><span className="cpost__who"><strong>{me.displayName}</strong><span className="cpost__err">{d.error || 'Didn’t post'}</span></span></div>
      <p className="cpost__text" style={{ opacity: 0.7 }}>{d.text}</p>
      <div className="row" style={{ gap: 18 }}>
        <OvalButton icon="refresh" label="Try again" size="sm" onClick={onRetry} />
        <OvalButton icon="edit" label="Edit" size="sm" variant="soft" onClick={onEdit} />
        <OvalButton icon="trash" label="Delete" size="sm" variant="ghost" onClick={onDelete} />
      </div>
    </article>
  );
}
export type { Draft };

/* ------------------------------------------------------------------ posts */

/** One post in the feed, or the placeholder that stands in for it (p51). */
export function PostCard({ p, c, onChange, onGone, full }: { p: CirclePost; c: CircleView; onChange: (p: CirclePost) => void; onGone: () => void; full?: boolean }) {
  const [show, setShow] = useState(false);
  const [menu, setMenu] = useState(false);
  const [dialog, setDialog] = useState<'report' | 'edit' | 'remove' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const admin = c.access === 'admin';
  const run = async (fn: () => Promise<CirclePost | void>) => { setError(null); setMenu(false); try { const r = await fn(); if (r) onChange(r); } catch (e) { setError(errText(e)); } };
  if (p.hidden === 'blocked') return <Gone icon="block" title="Post from someone you blocked" text={`You blocked ${p.author.displayName}, so their posts and comments are hidden.`} action={<a className="link-btn" href="/settings/privacy">Manage blocked people</a>} />;
  if (p.hidden === 'reported' && !show) return <Gone icon="eye-off" title="You reported this post" text="It’s hidden for you while the owners look at it." action={<button type="button" className="link-btn" onClick={() => setShow(true)}>Show anyway</button>} />;
  if (p.status === 'removed' && !p.mine && !admin) return null;
  const member = c.access === 'admin' || c.access === 'member';
  const link = `/circles/post?id=${p.id}`;
  return (
    <article className={`cpost${p.status === 'pending' ? ' cpost--pending' : ''}${p.status === 'removed' ? ' cpost--removed' : ''}`} data-testid="post" data-status={p.status}>
      {p.status === 'removed' && <Note icon="trash" tone="danger"><strong>Post removed by the owners.</strong> {p.removedReason || 'It broke the circle’s rules.'}{p.mine ? ' Only you can see it.' : ''}</Note>}
      <div className="cpost__head">
        <Avatar name={p.author.displayName} photoUrl={p.author.photoUrl} size={40} />
        <span className="cpost__who"><strong>{p.author.displayName}<AuthorTags a={p.author} /></strong><span>{p.pinned ? 'Pinned · ' : ''}{ago(p.createdAt)}{p.editedAt ? ' · edited' : ''}</span></span>
        {p.status === 'pending' && <Tag kind="warn" icon="clock">Waiting for approval</Tag>}
        {(member || p.mine) && (
          <span className="cmenu">
            <button type="button" className="icon-btn" aria-label="Post options" aria-expanded={menu} onClick={() => setMenu(!menu)}><Icon name="more-horizontal" size={18} /></button>
            {menu && (
              <span className="cmenu__list" role="menu">
                {admin && p.status === 'live' && <button type="button" role="menuitem" onClick={() => void run(() => api().pinCirclePost(p.id, !p.pinned))}><Icon name="pin" size={16} />{p.pinned ? 'Unpin' : 'Pin to top'}</button>}
                {p.mine && p.status !== 'removed' && <button type="button" role="menuitem" onClick={() => { setMenu(false); setDialog('edit'); }}><Icon name="edit" size={16} />Edit</button>}
                {(p.mine || admin) && <button type="button" role="menuitem" onClick={() => void run(async () => { await api().deleteCirclePost(p.id); onGone(); })}><Icon name="trash" size={16} />Delete</button>}
                {admin && !p.mine && p.status !== 'removed' && <button type="button" role="menuitem" onClick={() => { setMenu(false); setDialog('remove'); }}><Icon name="close" size={16} />Remove for breaking rules</button>}
                {!p.mine && <button type="button" role="menuitem" onClick={() => { setMenu(false); setDialog('report'); }}><Icon name="flag" size={16} />Report</button>}
              </span>
            )}
          </span>
        )}
      </div>
      {error && <Banner>{error}</Banner>}
      {p.text && <p className="cpost__text">{p.text}</p>}
      {p.photos.length > 0 && <div className={`cphotos cphotos--${Math.min(p.photos.length, 4)}`}>{p.photos.map((u, i) => <a key={i} href={u} target="_blank" rel="noopener noreferrer" className="cphotos__item"><img src={u} alt="" /></a>)}</div>}
      {p.status === 'pending' && p.mine && <span className="muted p2-small">Only you can see this until an owner approves it. Usually within a few hours.</span>}
      {p.answer && !full && <div className="canswer"><Icon name="check" size={16} /><span><strong>Answered by {p.answer.by}:</strong> {p.answer.text}</span></div>}
      {p.status === 'live' && (
        <div className="cpost__acts">
          <button type="button" className={`cact${p.liked ? ' cact--on' : ''}`} aria-pressed={p.liked} disabled={!member} onClick={() => void run(() => api().likeCirclePost(p.id, !p.liked))}><Icon name="heart" size={16} />{p.likes}</button>
          {full ? <span className="cact"><Icon name="chat" size={16} />{p.comments} comments</span> : <a className="cact" href={link}><Icon name="chat" size={16} />{p.comments} comments</a>}
          <button type="button" className="cact" style={{ marginLeft: 'auto' }} onClick={() => void navigator.clipboard?.writeText(`${location.origin}${link}`).then(() => setError(null))}><Icon name="share" size={16} />Copy link</button>
        </div>
      )}
      {dialog === 'report' && <ReportDialog p={p} onClose={() => setDialog(null)} onDone={(blocked) => { setDialog(null); onChange({ ...p, hidden: blocked ? 'blocked' : 'reported', text: blocked ? '' : p.text }); }} />}
      {dialog === 'edit' && <EditPost p={p} onClose={() => setDialog(null)} onSaved={(x) => { setDialog(null); onChange(x); }} />}
      {dialog === 'remove' && <RemovePost p={p} c={c} onClose={() => setDialog(null)} onDone={(x) => { setDialog(null); onChange(x); }} />}
    </article>
  );
}

function Gone({ icon, title, text, action }: { icon: 'block' | 'eye-off' | 'trash'; title: string; text: string; action?: React.ReactNode }) {
  return <article className="cpost cpost--gone" data-testid="post-placeholder"><Icon name={icon} size={20} /><span><strong>{title}</strong><br /><span className="muted">{text}</span>{action && <><br />{action}</>}</span></article>;
}

/** p42 → p52: why, then thanks. Blocking is offered alongside. */
function ReportDialog({ p, onClose, onDone }: { p: CirclePost; onClose: () => void; onDone: (blocked: boolean) => void }) {
  const [reason, setReason] = useState<PostReportReason | null>(null);
  const [block, setBlock] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const send = async () => { if (!reason) return; setBusy(true); setError(null); try { await api().reportCirclePost(p.id, reason, block); setSent(true); } catch (e) { setError(errText(e)); } finally { setBusy(false); } };
  if (sent) {
    return (
      <Modal title="Thanks, we got your report" onClose={() => onDone(block)}>
        <span className="ys-oval cstate__oval cstate__oval--success" style={{ width: 72, alignSelf: 'center' }}><Icon name="check" size={32} /></span>
        <p className="muted" style={{ margin: 0, textAlign: 'center', lineHeight: '21px' }}>The owners and YaysApp will look at it. {p.author.displayName} isn’t told who reported.</p>
        {block && <Note icon="block" tone="success">You blocked {p.author.displayName}. You won’t see their posts, comments or messages.</Note>}
        <div className="modal__actions">
          {block && <OvalButton icon="close" label="Unblock" size="md" variant="ghost" onClick={() => void api().unblock(p.author.id).then(() => setBlock(false))} />}
          <OvalButton icon="check" label="Done" size="md" onClick={() => onDone(block)} />
        </div>
      </Modal>
    );
  }
  return (
    <Modal title="Report this post" onClose={onClose} eyebrow={`The circle owners and YaysApp see your report. ${p.author.displayName} isn’t told who reported.`}>
      {error && <Banner>{error}</Banner>}
      <div role="radiogroup" aria-label="Why are you reporting it?" className="creasons">
        {POST_REPORT_REASONS.map((r) => (
          <label key={r} className="creason">
            <input type="radio" name="reason" checked={reason === r} onChange={() => setReason(r)} />
            <span><strong>{POST_REPORT_LABEL[r][0]}</strong><br /><span className="muted">{POST_REPORT_LABEL[r][1]}</span></span>
          </label>
        ))}
      </div>
      <label className="check-row"><input type="checkbox" checked={block} onChange={(e) => setBlock(e.target.checked)} /> Also block {p.author.displayName}</label>
      <div className="modal__actions"><OvalButton icon="flag" label="Send report" size="md" variant="danger" loading={busy} disabled={!reason} onClick={() => void send()} /></div>
    </Modal>
  );
}

function EditPost({ p, onClose, onSaved }: { p: CirclePost; onClose: () => void; onSaved: (p: CirclePost) => void }) {
  const [text, setText] = useState(p.text);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const marks = moneySchemeMatches(text);
  return (
    <Modal title="Edit post" onClose={onClose}>
      {error && <Banner>{error}</Banner>}
      <div className="ys-field"><div className="ys-field__box" style={{ alignItems: 'flex-start' }}><textarea className="ys-input" rows={5} aria-label="Post" value={text} maxLength={CIRCLE_LIMITS.post} onChange={(e) => setText(e.target.value)} /></div></div>
      {marks.length > 0 && <Note icon="alert-triangle" tone="danger">Take out “{marks.map((m) => m.text).join('”, “')}”. Circles don’t allow promising profits or asking for money.</Note>}
      <div className="modal__actions"><OvalButton icon="check" label="Save" size="md" loading={busy} disabled={!text.trim() || marks.length > 0} onClick={() => void (async () => { setBusy(true); setError(null); try { onSaved(await api().editCirclePost(p.id, text)); } catch (e) { setError(errText(e)); setBusy(false); } })()} /></div>
    </Modal>
  );
}

function RemovePost({ p, c, onClose, onDone }: { p: CirclePost; c: CircleView; onClose: () => void; onDone: (p: CirclePost) => void }) {
  const [reason, setReason] = useState(c.rules[1] ? `Rule 2: ${c.rules[1]}` : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal title="Remove this post" onClose={onClose} eyebrow={`${p.author.displayName} sees it was removed, and why.`}>
      {error && <Banner>{error}</Banner>}
      <div className="ys-field"><label className="ys-field__label" htmlFor="rm-why">Why</label><div className="ys-field__box"><select id="rm-why" className="ys-input" value={reason} onChange={(e) => setReason(e.target.value)}>
        {c.rules.map((r, i) => <option key={i} value={`Rule ${i + 1}: ${r}`}>Rule {i + 1}: {r}</option>)}
        <option value="Spam">Spam</option><option value="">Other</option>
      </select></div></div>
      <div className="modal__actions"><OvalButton icon="close" label="Remove post" size="md" variant="danger" loading={busy} onClick={() => void (async () => { setBusy(true); try { onDone(await api().removeCirclePost(p.id, reason)); } catch (e) { setError(errText(e)); setBusy(false); } })()} /></div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ feed tab */

export function FeedTab({ c, me, onEvent, onReload }: { c: CircleView; me: MeProfile; onEvent: () => void; onReload: () => void }) {
  const [items, setItems] = useState<CirclePost[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [online, setOnline] = useState(true);
  const load = useCallback(async () => { try { const f = await api().circleFeed(c.id); setItems(f.items); setNext(f.next); setError(null); } catch (e) { setError(errText(e, 'Couldn’t load the posts.')); } }, [c.id]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const up = () => setOnline(navigator.onLine);
    up(); window.addEventListener('online', up); window.addEventListener('offline', up);
    return () => { window.removeEventListener('online', up); window.removeEventListener('offline', up); };
  }, []);
  const member = c.access === 'admin' || c.access === 'member';
  const setPost = (p: CirclePost) => setItems((xs) => xs?.map((x) => (x.id === p.id ? p : x)) ?? null);
  const retry = async (d: Draft) => {
    setDrafts((ds) => ds.map((x) => (x.id === d.id ? { ...x, error: 'Posting…' } : x)));
    try {
      const photoKeys = await Promise.all(d.files.map((f) => api().uploadPostPhoto(f)));
      const p = await api().createCirclePost(c.id, { text: d.text, photoKeys });
      setDrafts((ds) => ds.filter((x) => x.id !== d.id)); setItems((xs) => [p, ...(xs ?? [])]);
    } catch (e) { setDrafts((ds) => ds.map((x) => (x.id === d.id ? { ...x, error: offline(e) ? 'Still offline' : errText(e) } : x))); }
  };
  const empty = items && !items.length && !drafts.length;
  return (
    <div className="cfeed">
      {!online && <div className="coffline" role="status"><Icon name="alert" size={16} />You’re offline. Showing what was saved.</div>}
      {error && <Banner>{error}</Banner>}
      {c.muted && (
        <section className="cnote cnote--warning cmuted" data-testid="muted">
          <span className="cnote__icon"><Icon name="volume-off" size={18} /></span>
          <div><strong>You can’t post or comment until {dateShort(c.muted.until)}</strong><br />{c.muted.reason ? `An owner muted you: ${c.muted.reason}. ` : 'An owner muted you. '}You can still read everything.</div>
        </section>
      )}
      {member && !c.muted && c.postApproval && c.access !== 'admin' && <Note icon="info">In this circle, owners check posts before everyone sees them.</Note>}
      {member && !c.muted && <Composer c={c} me={me} onPosted={(p) => { setItems((xs) => [p, ...(xs ?? [])]); if (p.status === 'pending') onReload(); }} onFailed={(d) => setDrafts((ds) => [d, ...ds])} onEvent={onEvent} />}
      {drafts.map((d) => (
        <FailedPost key={d.id} d={d} me={me} onRetry={() => void retry(d)} onDelete={() => setDrafts((ds) => ds.filter((x) => x.id !== d.id))}
          onEdit={() => { setDrafts((ds) => ds.filter((x) => x.id !== d.id)); void navigator.clipboard?.writeText(d.text).catch(() => undefined); }} />
      ))}
      {drafts.length > 0 && <span className="muted p2-small" style={{ textAlign: 'center' }}>Tap Try again when you’re back online.</span>}
      {!items && !error && <span className="ys-spin" aria-label="Loading" style={{ alignSelf: 'center' }} />}
      {empty && (c.access === 'admin' ? <OwnerStart c={c} /> : <State icon="chat" title="No posts yet" tone="plain">{member ? 'Be the first to share something.' : 'Join to share something.'}</State>)}
      {items?.map((p) => <PostCard key={p.id} p={p} c={c} onChange={setPost} onGone={() => setItems((xs) => xs?.filter((x) => x.id !== p.id) ?? null)} />)}
      {next && <div className="row center"><OvalButton icon="chevron-down" label="Older posts" size="sm" variant="soft" onClick={() => void api().circleFeed(c.id, next).then((f) => { setItems((xs) => [...(xs ?? []), ...f.items]); setNext(f.next); })} /></div>}
    </div>
  );
}

/** p47: a brand-new circle. */
function OwnerStart({ c }: { c: CircleView }) {
  const steps: Array<[boolean, string]> = [[!!c.about, 'Add a description'], [c.memberCount > 1, 'Invite people'], [false, 'Write the first post'], [c.rules.length > 0, 'Set circle rules']];
  const done = steps.filter((s) => s[0]).length;
  return (
    <div className="cstart">
      <State icon="sparkles" title="Your circle is ready">Nothing here yet. Invite people and write the first post so they have something to read.</State>
      <section className="ccard">
        <div className="ccard__head"><h3>Get started · {done} of {steps.length}</h3></div>
        {steps.map(([ok, t]) => <div key={t} className={`cstep${ok ? ' cstep--done' : ''}`}><span className="ys-oval"><Icon name={ok ? 'check' : 'plus'} size={14} /></span>{t}</div>)}
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ one post with comments (p38) */

export function Thread({ comments, c, onReply, onChanged, canAnswer, mutedOrVisitor }: { comments: CircleComment[]; c: CircleView; onReply: (to: CircleComment) => void; onChanged: () => void; canAnswer: boolean; mutedOrVisitor: boolean }) {
  const tops = comments.filter((x) => !x.parentId);
  const sorted = [...tops.filter((x) => x.answer), ...tops.filter((x) => !x.answer)];
  const one = (x: CircleComment, reply = false) => (
    <div key={x.id} className={`ccomment${reply ? ' ccomment--reply' : ''}`} data-testid="comment">
      <Avatar name={x.author.displayName} photoUrl={x.author.photoUrl} size={reply ? 28 : 32} />
      <div className="ccomment__body">
        <div className={`ccomment__bubble${x.answer ? ' ccomment__bubble--answer' : ''}`}>
          <strong>{x.author.displayName}<AuthorTags a={x.author} />{x.answer && <Tag kind="ok" icon="check">Answer</Tag>}</strong>
          <span>{x.hidden === 'blocked' ? <em className="muted">Hidden: you blocked this person.</em> : x.text}</span>
        </div>
        <span className="ccomment__meta">
          {ago(x.createdAt)}
          {!mutedOrVisitor && <button type="button" className="link-btn" onClick={() => onReply(x)}>Reply</button>}
          {canAnswer && !reply && <button type="button" className="link-btn" onClick={() => void api().markCircleAnswer(x.id, !x.answer).then(onChanged)}>{x.answer ? 'Unmark answer' : 'Mark as answer'}</button>}
          {(x.mine || c.access === 'admin') && <button type="button" className="link-btn link-btn--danger" onClick={() => void api().deleteCircleComment(x.id).then(onChanged)}>Delete</button>}
        </span>
      </div>
    </div>
  );
  return <div className="cthread">{sorted.map((t) => <div key={t.id}>{one(t)}{comments.filter((r) => r.parentId === t.id).map((r) => one(r, true))}</div>)}</div>;
}

export function CommentBox({ me, replyTo, onCancelReply, onSend, disabled, placeholder = 'Write a comment…' }: { me: MeProfile; replyTo: CircleComment | null; onCancelReply: () => void; onSend: (text: string) => Promise<void>; disabled?: string | null; placeholder?: string }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const marks = moneySchemeMatches(text);
  if (disabled) return <div className="ccomment-box ccomment-box--off"><Icon name="volume-off" size={16} />{disabled}</div>;
  const send = async () => { setBusy(true); setError(null); try { await onSend(text.trim()); setText(''); } catch (e) { setError(errText(e)); } finally { setBusy(false); } };
  return (
    <div className="ccomment-box">
      {error && <Banner>{error}</Banner>}
      {replyTo && <span className="ccomment-box__reply">Replying to {replyTo.author.displayName} <button type="button" className="link-btn" onClick={onCancelReply}>Cancel</button></span>}
      {marks.length > 0 && <Note icon="alert-triangle" tone="danger">Take out “{marks.map((m) => m.text).join('”, “')}”. Circles don’t allow promising profits or asking for money.</Note>}
      <div className="row" style={{ gap: 10, alignItems: 'center' }}>
        <Avatar name={me.displayName} photoUrl={me.photoUrl} size={32} />
        <input className="ys-input ccomment-box__input" aria-label={placeholder} placeholder={placeholder} value={text} maxLength={CIRCLE_LIMITS.comment} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && text.trim() && !marks.length) void send(); }} />
        <OvalButton icon="send" label="Send" size="sm" loading={busy} disabled={!text.trim() || marks.length > 0} onClick={() => void send()} />
      </div>
    </div>
  );
}

export function PostPageBody({ id, me }: { id: string; me: MeProfile }) {
  const [p, setP] = useState<CirclePost | null>(null);
  const [c, setC] = useState<CircleView | null>(null);
  const [comments, setComments] = useState<CircleComment[]>([]);
  const [replyTo, setReplyTo] = useState<CircleComment | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [gone, setGone] = useState(false);
  const load = useCallback(async () => {
    try {
      const post = await api().circlePost(id);
      const [circle, cs] = await Promise.all([api().circle(post.circleId), api().circleComments(id)]);
      setP(post); setC(circle); setComments(cs);
    } catch (e) { setError(errText(e, 'This post isn’t available.')); }
  }, [id]);
  useEffect(() => { void load(); }, [load]);
  if (gone) return <State icon="trash" title="Post deleted" actions={<OvalButton icon="arrow-left" label="Back to circles" size="lg" href="/circles" />} />;
  if (error) return <State icon="link" tone="plain" title="This post isn’t available" actions={<OvalButton icon="compass" label="Discover circles" size="lg" href="/circles/discover" />}>{error}</State>;
  if (!p || !c) return <span className="ys-spin" aria-label="Loading" />;
  const member = c.access === 'admin' || c.access === 'member';
  return (
    <div className="cpostpage">
      <div className="row" style={{ gap: 12, alignItems: 'center' }}><OvalButton icon="arrow-left" label={c.name} size="sm" variant="secondary" href={`/circles?id=${c.id}`} /></div>
      <PostCard p={p} c={c} full onChange={setP} onGone={() => setGone(true)} />
      <section className="ccard ccard--pad">
        {comments.length ? <Thread comments={comments} c={c} canAnswer={c.access === 'admin'} mutedOrVisitor={!member || !!c.muted} onReply={setReplyTo} onChanged={() => void load()} /> : <span className="muted">No comments yet.</span>}
      </section>
      {p.status === 'live' && (member
        ? <CommentBox me={me} replyTo={replyTo} onCancelReply={() => setReplyTo(null)} disabled={c.muted ? `You can comment again from ${dateShort(c.muted.until)}.` : null}
            onSend={async (t) => { await api().commentOnCirclePost(p.id, t, replyTo?.id); setReplyTo(null); await load(); }} />
        : <Note icon="info" tone="plain">Join {c.name} to comment. <a className="link-btn" href={`/circles?id=${c.id}`}>Open the circle</a></Note>)}
    </div>
  );
}

export { LineArt };

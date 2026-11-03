'use client';
import { useCallback, useEffect, useState } from 'react';
import { CIRCLE_TIMES, type CircleComment, type CircleEvent, type CircleView, type CreateEventInput, type EventMode, type MeProfile } from '@yays/shared';
import { api } from '@/lib/api';
import { Icon } from '@/lib/icons';
import { Switch } from '../group';
import { Modal } from '../message-actions';
import { Avatar, Banner, Field, LineArt, OvalButton } from '../ui';
import { CommentBox, Thread } from './feed';
import { DateBlock, Note, State, Tag, errText, longDay, shortDay, span, timeOf, tzName } from './common';

const where = (e: CircleEvent) => (e.mode === 'online' ? 'Online' : e.place);

/** A row in a circle's Events tab. */
export function EventRow({ e }: { e: CircleEvent }) {
  const mine = e.myRsvp === 'going' ? 'You’re going' : e.myRsvp === 'waitlist' ? `Waitlist #${e.waitlistPos}` : e.myRsvp === 'offered' ? 'A seat is waiting for you' : e.myRsvp === 'interested' ? 'Interested' : null;
  return (
    <a href={`/circles/event?id=${e.id}`} className="cevent-row" data-testid="event-row">
      <DateBlock iso={e.startsAt} tz={e.timeZone} />
      <span className="cevent-row__text">
        <strong>{e.title}</strong>
        <span>{shortDay(e.startsAt, e.timeZone)} · {timeOf(e.startsAt, e.timeZone)} {tzName(e.startsAt, e.timeZone)} · {where(e)}</span>
        <span className="cevent-row__tags">
          {e.status === 'cancelled' && <Tag kind="danger" icon="close">Cancelled</Tag>}
          {e.status === 'ended' && <Tag kind="muted" icon="check">Ended</Tag>}
          {e.status === 'scheduled' && e.seats !== null && e.going >= e.seats && <Tag kind="danger" icon="users">Full</Tag>}
          {e.needsAck && <Tag kind="warn" icon="alert">Changed</Tag>}
          {mine && <Tag kind="official">{mine}</Tag>}
          <span className="muted">{e.going} going</span>
        </span>
      </span>
      <Icon name="chevron-right" size={16} />
    </a>
  );
}

export function EventsTab({ c, onNew }: { c: CircleView; onNew: () => void }) {
  const [list, setList] = useState<CircleEvent[] | null>(null);
  const [past, setPast] = useState<CircleEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { void api().circleEvents(c.id).then(setList, (e) => setError(errText(e))); }, [c.id]);
  const member = c.access === 'admin' || c.access === 'member';
  return (
    <div className="cfeed">
      {error && <Banner>{error}</Banner>}
      {member && !c.muted && <div className="row" style={{ justifyContent: 'flex-end' }}><OvalButton icon="plus" label="New event" size="sm" onClick={onNew} /></div>}
      {!list && !error && <span className="ys-spin" aria-label="Loading" style={{ alignSelf: 'center' }} />}
      {list && !list.length && <State icon="calendar" tone="plain" title="No events coming up">{member ? 'Plan a meetup, a seminar or an online Q&A.' : 'Check back later.'}</State>}
      {list && list.length > 0 && <section className="ccard">{list.map((e) => <EventRow key={e.id} e={e} />)}</section>}
      {past === null ? <div className="row center"><button type="button" className="link-btn" onClick={() => void api().circleEvents(c.id, true).then(setPast)}>Show past events</button></div>
        : past.length ? <><h3 className="community__h">Past events</h3><section className="ccard">{past.map((e) => <EventRow key={e.id} e={e} />)}</section></> : <span className="muted p2-small" style={{ textAlign: 'center' }}>No past events.</span>}
    </div>
  );
}

/* ------------------------------------------------------------------ create / edit */

const toLocalInput = (iso: string, tz: string) => {
  try {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
    return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour === '24' ? '00' : p.hour}:${p.minute}` };
  } catch { return { date: iso.slice(0, 10), time: iso.slice(11, 16) }; }
};
/** A wall-clock time in a time zone → an instant. */
const fromLocal = (date: string, time: string, tz: string) => {
  const guess = new Date(`${date}T${time}:00Z`);
  const back = toLocalInput(guess.toISOString(), tz);
  const shown = new Date(`${back.date}T${back.time}:00Z`);
  return new Date(guess.getTime() - (shown.getTime() - guess.getTime())).toISOString();
};
const myTz = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

/** p41: details, where, seats. Editing the time or place tells people going (p56). */
export function EventForm({ c, e, onClose, onSaved }: { c: CircleView; e?: CircleEvent; onClose: () => void; onSaved: (e: CircleEvent) => void }) {
  const tz0 = e?.timeZone ?? myTz();
  const start0 = e ? toLocalInput(e.startsAt, tz0) : toLocalInput(new Date(Date.now() + 7 * 86400_000).toISOString(), tz0);
  const end0 = e ? toLocalInput(e.endsAt, tz0) : null;
  const [title, setTitle] = useState(e?.title ?? '');
  const [about, setAbout] = useState(e?.about ?? '');
  const [date, setDate] = useState(start0.date);
  const [from, setFrom] = useState(e ? start0.time : '18:00');
  const [to, setTo] = useState(end0?.time ?? '20:00');
  const [mode, setMode] = useState<EventMode>(e?.mode ?? 'in_person');
  const [place, setPlace] = useState(e?.place ?? '');
  const [link, setLink] = useState(e?.onlineUrl ?? '');
  const [limit, setLimit] = useState(e?.seats != null);
  const [seats, setSeats] = useState(String(e?.seats ?? 40));
  const [recording, setRecording] = useState(e?.recordingUrl ?? '');
  const [slides, setSlides] = useState(e?.slidesUrl ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ended = e?.status === 'ended';
  const save = async () => {
    setBusy(true); setError(null);
    try {
      const startsAt = fromLocal(date, from, tz0);
      let endsAt = fromLocal(date, to, tz0);
      if (Date.parse(endsAt) <= Date.parse(startsAt)) endsAt = new Date(Date.parse(endsAt) + 86400_000).toISOString(); // ends after midnight
      const body: CreateEventInput = { title, about, startsAt, endsAt, timeZone: tz0, mode, place: mode === 'online' ? '' : place, onlineUrl: mode === 'in_person' ? null : link.trim() || null, seats: limit ? Number(seats) || null : null };
      if (!e) onSaved(await api().createCircleEvent(c.id, body));
      else {
        const patch = ended ? { recordingUrl: recording.trim() || null, slidesUrl: slides.trim() || null } : { ...body, ...(e.hasOnlineLink && mode !== 'in_person' && !link.trim() ? { onlineUrl: undefined } : {}) };
        onSaved(await api().updateCircleEvent(e.id, patch));
      }
    } catch (x) { setError(errText(x)); setBusy(false); }
  };
  return (
    <Modal title={e ? (ended ? 'Recording and slides' : 'Edit event') : 'New event'} onClose={onClose} eyebrow={e ? undefined : `In ${c.name}. You’ll be the host.`}>
      {error && <Banner>{error}</Banner>}
      {!ended && (
        <>
          <Field id="ev-title" label="Event name"><input id="ev-title" className="ys-input" value={title} maxLength={120} onChange={(x) => setTitle(x.target.value)} placeholder="AI & Blockchain Seminar" /></Field>
          <div className="cform-3">
            <Field id="ev-date" label="Date"><input id="ev-date" type="date" className="ys-input" value={date} onChange={(x) => setDate(x.target.value)} /></Field>
            <Field id="ev-from" label="Starts"><input id="ev-from" type="time" className="ys-input" value={from} onChange={(x) => setFrom(x.target.value)} /></Field>
            <Field id="ev-to" label="Ends"><input id="ev-to" type="time" className="ys-input" value={to} onChange={(x) => setTo(x.target.value)} /></Field>
          </div>
          <span className="muted p2-small">Times are in {tz0.replace(/_/g, ' ')}.</span>
          <div className="chips" role="radiogroup" aria-label="Where">
            {([['in_person', 'location', 'In person'], ['online', 'video', 'Online'], ['both', 'users', 'Both']] as const).map(([m, ic, l]) => (
              <button key={m} type="button" role="radio" aria-checked={mode === m} className={`cchip${mode === m ? ' cchip--on' : ''}`} onClick={() => setMode(m)}><Icon name={ic} size={14} />{l}</button>
            ))}
          </div>
          {mode !== 'online' && <Field id="ev-place" label="Place"><input id="ev-place" className="ys-input" value={place} maxLength={200} onChange={(x) => setPlace(x.target.value)} placeholder="Downtown Library, Room 2, Salt Lake City" /></Field>}
          {mode !== 'in_person' && <Field id="ev-link" label="Online link" hint="Only people going see the link."><input id="ev-link" className="ys-input" value={link} onChange={(x) => setLink(x.target.value)} placeholder={e?.hasOnlineLink ? 'Leave empty to keep the current link' : 'https://meet.example.com/…'} /></Field>}
          <Field id="ev-about" label="About (optional)"><textarea id="ev-about" className="ys-input" rows={3} value={about} maxLength={3000} onChange={(x) => setAbout(x.target.value)} /></Field>
          <Switch label="Limit seats" hint={limit ? 'When it’s full, people join a waitlist.' : 'Off · anyone can tap Going'} on={limit} onChange={setLimit} />
          {limit && <Field id="ev-seats" label="Seats"><input id="ev-seats" type="number" min={1} max={5000} className="ys-input" value={seats} onChange={(x) => setSeats(x.target.value)} /></Field>}
          {e && <Note icon="info" tone="plain">Changing the time or place shows people going what changed and asks if they’re still coming.</Note>}
        </>
      )}
      {ended && (
        <>
          <Field id="ev-rec" label="Recording link"><input id="ev-rec" className="ys-input" value={recording} onChange={(x) => setRecording(x.target.value)} placeholder="https://…" /></Field>
          <Field id="ev-slides" label="Slides link"><input id="ev-slides" className="ys-input" value={slides} onChange={(x) => setSlides(x.target.value)} placeholder="https://…" /></Field>
        </>
      )}
      <div className="modal__actions"><OvalButton icon="check" label={e ? 'Save' : 'Create event'} size="md" loading={busy} disabled={!ended && !title.trim()} onClick={() => void save()} /></div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ the event page (p39, p55–p58, W20, W24) */

export function EventPageBody({ id, me }: { id: string; me: MeProfile }) {
  const [e, setE] = useState<CircleEvent | null>(null);
  const [c, setC] = useState<CircleView | null>(null);
  const [qs, setQs] = useState<CircleComment[]>([]);
  const [replyTo, setReplyTo] = useState<CircleComment | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState<string | null>(null);
  const [dialog, setDialog] = useState<'edit' | 'cancel' | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try {
      const ev = await api().circleEvent(id);
      const [circle, q] = await Promise.all([api().circle(ev.circle.id), api().eventQuestions(id)]);
      setE(ev); setC(circle); setQs(q);
    } catch (x) { setNotFound(errText(x, 'This event isn’t available.')); }
  }, [id]);
  useEffect(() => { void load(); }, [load]);
  const act = async (fn: () => Promise<CircleEvent>) => { setBusy(true); setError(null); try { setE(await fn()); } catch (x) { setError(errText(x)); } finally { setBusy(false); } };
  if (notFound) return <State icon="calendar" tone="plain" title="This event isn’t available" actions={<OvalButton icon="arrow-left" label="Back to circles" size="lg" href="/circles" />}>{notFound}</State>;
  if (!e || !c) return <span className="ys-spin" aria-label="Loading" />;
  const member = c.access === 'admin' || c.access === 'member';
  const full = e.seats !== null && e.going >= e.seats;
  const tz = e.timeZone;
  const money = c.category === 'crypto' || c.category === 'ai';
  return (
    <div className={`cevent${e.status === 'cancelled' ? ' cevent--cancelled' : ''}`}>
      <div className="cevent__banner">
        <span className="ys-feature__deco a" style={{ width: 400, top: -170, right: 120 }} aria-hidden />
        <LineArt name="lantern" height={190} ink="#ffffff" opacity={0.55} className="cevent__art" />
        <OvalButton icon="arrow-left" label="Back" size="sm" variant="secondary" href={`/circles?id=${c.id}&tab=events`} />
      </div>
      <div className="cevent__grid">
        <section className="ccard ccard--pad cevent__title">
            <DateBlock iso={e.startsAt} tz={tz} big />
            <span>
              <h1 className={e.status === 'cancelled' ? 'strike' : undefined}>{e.title}</h1>
              <span className="muted ctags"><a href={`/circles?id=${c.id}`} className="link-btn link-btn--inline">{c.name}</a> · hosted by {e.host.displayName}{e.host.official && <Tag kind="official" icon="shield-check">Official</Tag>}</span>
              <span className="ctags" style={{ marginTop: 6 }}>
                {e.status === 'cancelled' && <Tag kind="danger" icon="close">Cancelled</Tag>}
                {e.status === 'ended' && <Tag kind="muted" icon="check">Ended · {e.going} went</Tag>}
                {e.status === 'scheduled' && full && <Tag kind="danger" icon="users">Full · {e.going} of {e.seats} seats</Tag>}
                {e.status === 'scheduled' && e.seats !== null && !full && <Tag kind="muted" icon="users">{e.seats - e.going} of {e.seats} seats left</Tag>}
              </span>
            </span>
        </section>
        <div className="cevent__main">
          {error && <Banner>{error}</Banner>}
          {e.status === 'cancelled' && (
            <section className="ccard ccard--pad cevent__msg"><Avatar name={e.host.displayName} photoUrl={e.host.photoUrl} size={36} /><span><strong>Message from {e.host.displayName}</strong><br />{e.cancelNote || 'This event was cancelled.'}</span></section>
          )}
          {e.change && e.status === 'scheduled' && (
            <section className="cnote cnote--warning cchange" data-testid="event-changed">
              <span className="cnote__icon"><Icon name="alert" size={18} /></span>
              <div>
                <strong>The host changed this event</strong><br />
                {e.change.was.startsAt && <>Now {shortDay(e.startsAt, tz)}, {timeOf(e.startsAt, tz)} (was {shortDay(e.change.was.startsAt, tz)}, {timeOf(e.change.was.startsAt, tz)}). </>}
                {e.change.was.place !== undefined && <>Now at {e.place || 'online'} (was {e.change.was.place || 'online'}). </>}
                {e.needsAck && (
                  <span className="row" style={{ gap: 18, marginTop: 10 }}>
                    <strong style={{ alignSelf: 'center' }}>Still going?</strong>
                    <OvalButton icon="check" label="Yes, still going" size="sm" loading={busy} onClick={() => void act(() => api().ackEventChange(e.id))} />
                    <OvalButton icon="close" label="Can’t go now" size="sm" variant="ghost" onClick={() => void act(() => api().rsvp(e.id, 'not_going'))} />
                  </span>
                )}
              </div>
            </section>
          )}
          {e.status === 'ended' && (e.recordingUrl || e.slidesUrl) && (
            <section className="ccard">
              {e.recordingUrl && <a className="ys-row-item" href={e.recordingUrl} target="_blank" rel="noopener noreferrer"><span className="ys-oval ys-oval--ember" style={{ width: 40 }}><Icon name="play" size={18} /></span><span className="ys-row-item__text"><span className="ys-row-item__title">Recording</span><span className="ys-row-item__sub">Opens in a new tab</span></span><Icon name="chevron-right" size={16} /></a>}
              {e.slidesUrl && <a className="ys-row-item" href={e.slidesUrl} target="_blank" rel="noopener noreferrer"><span className="ys-oval ys-oval--wash" style={{ width: 40 }}><Icon name="file" size={18} /></span><span className="ys-row-item__text"><span className="ys-row-item__title">Slides</span><span className="ys-row-item__sub">Opens in a new tab</span></span><Icon name="download" size={16} /></a>}
            </section>
          )}
          {e.status === 'ended' && e.rating && (
            <section className="ccard ccard--pad" style={{ alignItems: 'center' }}>
              <strong>{e.myRsvp === 'going' ? 'How was it?' : 'Rating'}</strong>
              <span className="cstars" role={e.myRsvp === 'going' ? 'radiogroup' : undefined} aria-label="Rating">
                {[1, 2, 3, 4, 5].map((n) => {
                  const on = n <= (e.rating!.mine ?? Math.round(e.rating!.average));
                  return e.myRsvp === 'going'
                    ? <button key={n} type="button" role="radio" aria-checked={e.rating!.mine === n} aria-label={`${n} star${n > 1 ? 's' : ''}`} className={`cstar${on ? ' cstar--on' : ''}`} onClick={() => void act(() => api().rateEvent(e.id, n))}><Icon name="star" size={28} /></button>
                    : <span key={n} className={`cstar${on ? ' cstar--on' : ''}`}><Icon name="star" size={22} /></span>;
                })}
              </span>
              {e.rating.count > 0 && <span className="muted p2-small">{e.rating.average} from {e.rating.count} {e.rating.count === 1 ? 'person' : 'people'}</span>}
            </section>
          )}
          {e.about && <section className="ccard ccard--pad"><h3 className="ccard__h">About this event</h3><p className="cpost__text">{e.about}</p></section>}
          {money && e.status !== 'cancelled' && <Note icon="info">Educational event. Nothing here is investment advice, and no one may sell investments at it or in this circle.</Note>}
          <section className="ccard ccard--pad">
            <h3 className="ccard__h">Questions · {e.questions}</h3>
            {qs.length ? <Thread comments={qs} c={c} canAnswer={e.canManage || c.access === 'admin'} mutedOrVisitor={!member || !!c.muted} onReply={setReplyTo} onChanged={() => void load()} /> : <span className="muted">No questions yet.</span>}
            {member && e.status !== 'cancelled' && <CommentBox me={me} placeholder="Ask a question…" replyTo={replyTo} onCancelReply={() => setReplyTo(null)} disabled={c.muted ? 'You’re muted in this circle for now.' : null} onSend={async (t) => { await api().askEventQuestion(e.id, t, replyTo?.id); setReplyTo(null); await load(); }} />}
          </section>
        </div>
        <aside className="cevent__side">
          {e.status === 'scheduled' && <Rsvp e={e} member={member} c={c} busy={busy} act={act} />}
          <section className="ccard">
            <div className="cinfo"><span className="ys-oval ys-oval--wash"><Icon name="calendar" size={16} /></span><span><strong className={e.status === 'cancelled' ? 'strike' : undefined}>{longDay(e.startsAt, tz)}, {span(e.startsAt, e.endsAt, tz)}</strong><span>{e.status === 'cancelled' ? 'Cancelled' : `${tzName(e.startsAt, tz)} · ${tz.replace(/_/g, ' ')}`}</span></span></div>
            {e.mode !== 'online' && <div className="cinfo"><span className="ys-oval ys-oval--wash"><Icon name="location" size={16} /></span><span><strong>{e.place}</strong><a className="link-btn link-btn--inline" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(e.place)}`} target="_blank" rel="noopener noreferrer">Directions</a></span></div>}
            {e.mode !== 'in_person' && <div className="cinfo"><span className="ys-oval ys-oval--wash"><Icon name="video" size={16} /></span><span><strong>{e.mode === 'both' ? 'Also online' : 'Online'}</strong>{e.onlineUrl ? <a className="link-btn link-btn--inline" href={e.onlineUrl} target="_blank" rel="noopener noreferrer" data-testid="online-link">Join online</a> : <span>{e.status === 'cancelled' ? 'The link no longer works' : 'The link shows here once you tap Going'}</span>}</span></div>}
          </section>
          {e.goingPreview.length > 0 && (
            <div className="cgoing"><span className="cgoing__faces">{e.goingPreview.map((p) => <Avatar key={p.id} name={p.displayName} photoUrl={p.photoUrl} size={32} />)}</span><span className="muted"><strong style={{ color: 'var(--ink)' }}>{e.going} going</strong>{e.interested ? ` · ${e.interested} interested` : ''}</span></div>
          )}
          {e.canManage && e.status !== 'cancelled' && (
            <div className="row center" style={{ gap: 18 }}>
              <OvalButton icon="edit" label={e.status === 'ended' ? 'Add recording' : 'Edit'} size="sm" variant="soft" onClick={() => setDialog('edit')} />
              {e.status === 'scheduled' && <OvalButton icon="close" label="Cancel event" size="sm" variant="ghost" onClick={() => setDialog('cancel')} />}
            </div>
          )}
          {e.status === 'cancelled' && <div className="row center"><OvalButton icon="calendar" label="Other events" size="lg" variant="soft" href={`/circles?id=${c.id}&tab=events`} /></div>}
        </aside>
      </div>
      {dialog === 'edit' && <EventForm c={c} e={e} onClose={() => setDialog(null)} onSaved={(x) => { setDialog(null); setE(x); }} />}
      {dialog === 'cancel' && <CancelDialog e={e} onClose={() => setDialog(null)} onDone={(x) => { setDialog(null); setE(x); }} />}
    </div>
  );
}

function Rsvp({ e, c, member, busy, act }: { e: CircleEvent; c: CircleView; member: boolean; busy: boolean; act: (fn: () => Promise<CircleEvent>) => Promise<void> }) {
  if (!member) return <section className="ccard ccard--pad" style={{ alignItems: 'center', textAlign: 'center' }}><span className="muted">Join {c.name} to say you’re going.</span><OvalButton icon="arrow-left" label="Open the circle" size="sm" variant="soft" href={`/circles?id=${c.id}`} /></section>;
  if (e.myRsvp === 'waitlist') {
    return (
      <section className="ccard ccard--pad cwait" data-testid="waitlist">
        <span className="cwait__pos">#{e.waitlistPos}</span>
        <strong>You’re {ordinal(e.waitlistPos ?? 1)} on the waitlist</strong>
        <span className="muted p2-small">If someone can’t go, the next person gets their seat. You’ll have {CIRCLE_TIMES.offerHours} hours to confirm it here.</span>
        <OvalButton icon="close" label="Leave waitlist" size="sm" variant="ghost" loading={busy} onClick={() => void act(() => api().leaveWaitlist(e.id))} />
      </section>
    );
  }
  if (e.myRsvp === 'offered') {
    return (
      <section className="ccard ccard--pad cwait" data-testid="seat-offer">
        <span className="ys-oval cstate__oval cstate__oval--success" style={{ width: 56 }}><Icon name="check" size={24} /></span>
        <strong>A seat opened up for you</strong>
        <span className="muted p2-small">Confirm by {e.offerUntil ? new Date(e.offerUntil).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' }) : 'soon'}, or it goes to the next person.</span>
        <div className="row center" style={{ gap: 18 }}>
          <OvalButton icon="check" label="Confirm seat" size="md" loading={busy} onClick={() => void act(() => api().confirmSeat(e.id))} />
          <OvalButton icon="close" label="No thanks" size="md" variant="ghost" onClick={() => void act(() => api().leaveWaitlist(e.id))} />
        </div>
      </section>
    );
  }
  const full = e.seats !== null && e.going >= e.seats && e.myRsvp !== 'going';
  return (
    <section className="ccard ccard--pad" style={{ alignItems: 'center' }}>
      <div className="row center" style={{ gap: 18 }}>
        <OvalButton icon={full ? 'clock' : 'check'} label={e.myRsvp === 'going' ? 'Going' : full ? 'Join waitlist' : 'Going'} size="lg" variant={e.myRsvp === 'going' ? 'primary' : 'soft'} loading={busy} aria-pressed={e.myRsvp === 'going'} onClick={() => void act(() => api().rsvp(e.id, 'going'))} />
        <OvalButton icon="star" label="Interested" size="lg" variant={e.myRsvp === 'interested' ? 'primary' : 'soft'} aria-pressed={e.myRsvp === 'interested'} onClick={() => void act(() => api().rsvp(e.id, 'interested'))} />
        <OvalButton icon="close" label="Can’t go" size="lg" variant={e.myRsvp === 'not_going' ? 'secondary' : 'ghost'} aria-pressed={e.myRsvp === 'not_going'} onClick={() => void act(() => api().rsvp(e.id, 'not_going'))} />
      </div>
      {full && <span className="muted p2-small" style={{ textAlign: 'center' }}>All {e.seats} seats are taken{e.waitlist ? ` and ${e.waitlist} ${e.waitlist === 1 ? 'person is' : 'people are'} waiting` : ''}.</span>}
    </section>
  );
}
const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;

function CancelDialog({ e, onClose, onDone }: { e: CircleEvent; onClose: () => void; onDone: (e: CircleEvent) => void }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal title="Cancel this event?" onClose={onClose} eyebrow={`${e.going} going and ${e.interested} interested will see your message.`}>
      {error && <Banner>{error}</Banner>}
      <Field id="cx-note" label="Message to people going"><textarea id="cx-note" className="ys-input" rows={3} value={note} maxLength={500} onChange={(x) => setNote(x.target.value)} placeholder="Sorry, we need to move this. We’ll post a new date soon." /></Field>
      <div className="modal__actions"><OvalButton icon="close" label="Cancel event" size="md" variant="danger" loading={busy} onClick={() => void (async () => { setBusy(true); try { onDone(await api().cancelCircleEvent(e.id, note)); } catch (x) { setError(errText(x)); setBusy(false); } })()} /></div>
    </Modal>
  );
}

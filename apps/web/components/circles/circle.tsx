'use client';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  CIRCLE_CATEGORIES, CIRCLE_CATEGORY_LABEL, CIRCLE_LIMITS, CIRCLE_TIMES,
  type CircleCard, type CircleCategory, type CircleDiscover, type CircleEvent, type CircleMemberRow, type CircleReview, type CircleView, type MeProfile,
} from '@yays/shared';
import { api } from '@/lib/api';
import { Icon } from '@/lib/icons';
import { CommunityView } from '../community';
import { Switch } from '../group';
import { Modal } from '../message-actions';
import { Avatar, Banner, Field, LineArt, OvalButton } from '../ui';
import { CircleMark, CircleTags, DateBlock, EventMiniRow, Note, State, Tag, compact, dateShort, errText, plural } from './common';
import { EventForm, EventRow, EventsTab } from './events';
import { FeedTab, PostCard } from './feed';

/* ------------------------------------------------------------------ lists */

/** The left column: my circles (W19), with new-post counts. */
export function CircleList({ list, active }: { list: CircleCard[]; active: string | null }) {
  return (
    <nav aria-label="Your circles" className="chat-rows">
      {list.map((c) => (
        <a key={c.id} href={`/circles?id=${c.id}`} className="ys-row-item crow" aria-current={c.id === active ? 'true' : undefined} data-testid="circle-row">
          <CircleMark c={c} size={46} />
          <span className="ys-row-item__text"><span className="ys-row-item__title">{c.name}</span><span className="ys-row-item__sub"><CircleTags c={c} count={false} /> {compact(c.memberCount)}</span></span>
          {c.newPosts > 0 && <span className="ys-oval ys-oval--ember ys-badge" aria-label={`${c.newPosts} new posts`}><span>{c.newPosts}</span></span>}
        </a>
      ))}
    </nav>
  );
}

/** Join or ask to join from a list. Private circles open first, to answer the owners' question. */
export function JoinButton({ c, onJoined, size = 'sm' }: { c: CircleCard; onJoined: (c: CircleCard) => void; size?: 'sm' | 'md' }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (c.role) return <OvalButton icon="chevron-right" label="Open" size={size} variant="soft" href={`/circles?id=${c.id}`} />;
  if (c.requested) return <OvalButton icon="clock" label="Requested" size={size} variant="ghost" href={`/circles?id=${c.id}`} />;
  if (c.visibility === 'private') return <OvalButton icon="person-add" label="Request" size={size} variant="soft" onClick={() => router.push(`/circles?id=${c.id}`)} />;
  return (
    <span title={error ?? undefined}>
      <OvalButton icon="plus" label="Join" size={size} loading={busy} onClick={() => void (async () => {
        setBusy(true); setError(null);
        try { await api().joinCircle(c.id); onJoined({ ...c, role: 'member', memberCount: c.memberCount + 1 }); router.push(`/circles?id=${c.id}`); } catch (e) { setError(errText(e)); setBusy(false); }
      })()} />
    </span>
  );
}

function SuggestRow({ c, onJoined }: { c: CircleCard; onJoined: (c: CircleCard) => void }) {
  return (
    <div className="ys-row-item" style={{ cursor: 'default' }}>
      <CircleMark c={c} size={44} />
      <span className="ys-row-item__text"><span className="ys-row-item__title">{c.name}</span><span className="ys-row-item__sub"><CircleTags c={c} /></span></span>
      <JoinButton c={c} onJoined={onJoined} />
    </div>
  );
}

/** p43 / W21: no circles yet. */
export function NoCircles({ onNew }: { onNew: () => void }) {
  const [d, setD] = useState<CircleDiscover | null>(null);
  useEffect(() => { void api().discoverCircles().then(setD, () => undefined); }, []);
  const picks = d ? [...(d.featured ? [d.featured] : []), ...d.items].slice(0, 3) : [];
  return (
    <div className="cempty" data-testid="no-circles">
      <LineArt name="explorer" height={300} opacity={0.14} className="cempty__art" />
      <State icon="people" title="You’re not in any circles yet" actions={<><OvalButton icon="compass" label="Discover circles" size="lg" href="/circles/discover" /><OvalButton icon="plus" label="Start a circle" size="lg" variant="soft" onClick={onNew} /></>}>
        Circles are groups with a feed, events and chats. Join one you like, or start your own for friends, a club or your team.
      </State>
      {picks.length > 0 && <div className="cempty__picks">{picks.map((c) => <div key={c.id} className="ccard"><SuggestRow c={c} onJoined={() => undefined} /></div>)}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ discover (p36, p44, p61, W18) */

export function Discover({ onNew }: { onNew: () => void }) {
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<CircleCategory | ''>('');
  const [d, setD] = useState<CircleDiscover | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback((query: string, category: string) => api().discoverCircles(query.trim(), category).then((x) => { setD(x); setError(null); }, (e) => setError(errText(e))), []);
  useEffect(() => { const t = setTimeout(() => void run(q, cat), q ? 300 : 0); return () => clearTimeout(t); }, [q, cat, run]);
  const set = (c: CircleCard) => setD((x) => x && { ...x, items: x.items.map((y) => (y.id === c.id ? c : y)), featured: x.featured?.id === c.id ? c : x.featured });
  const empty = d && !d.items.length && !d.featured;
  return (
    <div className="cdisc">
      <div className="cdisc__head">
        <h1>Discover circles</h1>
        <div className="ys-field__box cdisc__search"><Icon name="search" size={18} /><input className="ys-input" aria-label="Search circles" placeholder="Search circles and events" value={q} onChange={(e) => setQ(e.target.value)} />{q && <button type="button" className="icon-btn" aria-label="Clear search" onClick={() => setQ('')}><Icon name="close" size={16} /></button>}</div>
        <OvalButton icon="plus" label="New circle" size="sm" onClick={onNew} />
      </div>
      <div className="chips" role="radiogroup" aria-label="Category">
        {(['', ...CIRCLE_CATEGORIES] as const).filter((x) => x !== 'other').map((x) => (
          <button key={x || 'all'} type="button" role="radio" aria-checked={cat === x} className={`cchip${cat === x ? ' cchip--on' : ''}`} onClick={() => setCat(x)}>{x ? CIRCLE_CATEGORY_LABEL[x] : 'All'}</button>
        ))}
      </div>
      {error && <Banner>{error}</Banner>}
      {!d && !error && <span className="ys-spin" aria-label="Loading" />}
      {d?.featuredEvent && (
        <a className="cfeatured-ev" href={`/circles/event?id=${d.featuredEvent.id}`}>
          <DateBlock iso={d.featuredEvent.startsAt} tz={d.featuredEvent.timeZone} big />
          <span style={{ flex: 1 }}><span className="caps">Featured event</span><br /><strong>{d.featuredEvent.title}</strong><br /><span className="muted">{d.featuredEvent.mode === 'online' ? 'Online' : d.featuredEvent.place} · {d.featuredEvent.going} going · {d.featuredEvent.circle.name}</span></span>
          <Icon name="chevron-right" size={18} />
        </a>
      )}
      {d?.featured && (
        <section className="cfeatured">
          <span className="ys-feature__deco a" style={{ width: 300, top: -140, right: -60 }} aria-hidden />
          <span className="caps">Featured</span>
          <div className="row" style={{ gap: 14, alignItems: 'center' }}><CircleMark c={d.featured} size={60} onBanner /><span style={{ flex: 1 }}><strong>{d.featured.name}</strong><br /><span>{d.featured.about}</span></span></div>
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}><span>{plural(d.featured.memberCount, 'member')}</span><JoinButton c={d.featured} onJoined={set} /></div>
        </section>
      )}
      {empty && (
        <div data-testid="no-results">
          <State icon="search" tone="plain" title="No circles found">{q ? <>Nothing matches “{q}”. Check the spelling, or try fewer words.</> : 'No circles here yet.'}</State>
          {d?.didYouMean && <div className="row center" style={{ gap: 8, alignItems: 'center' }}><span className="muted">Did you mean</span><button type="button" className="cchip cchip--soft" onClick={() => setQ(d.didYouMean!)}>{d.didYouMean}</button></div>}
          <section className="ccard ccard--pad cdisc__start"><span><strong>Can’t find it?</strong><br /><span className="muted">Start the circle yourself and invite people.</span></span><OvalButton icon="plus" label="Start" size="sm" onClick={onNew} /></section>
        </div>
      )}
      <div className="cgrid">
        {d?.items.map((c) => (
          <div key={c.id} className={`ccard ccard--pad ctile${c.lookalike ? ' ctile--warn' : ''}`} data-testid="circle-tile">
            <CircleMark c={c} size={54} />
            <strong className="ctile__name">{c.name}</strong>
            <CircleTags c={c} count={false} />
            <span className="muted ctile__about">{c.about || 'No description yet.'}</span>
            {c.lookalike && <Note icon="alert-triangle" tone="danger">This circle isn’t run by the team it names. Only circles YaysApp has checked get the Official badge, and staff never ask you to send money.</Note>}
            <span className="ctile__foot"><span className="muted">{plural(c.memberCount, 'member')}</span><JoinButton c={c} onJoined={set} /></span>
          </div>
        ))}
      </div>
      {d && d.items.some((c) => c.official || c.lookalike) && <p className="muted p2-small">Only circles YaysApp has checked get the orange Official badge. Staff never ask you to send money.</p>}
    </div>
  );
}

/* ------------------------------------------------------------------ one circle */

type TabKey = 'feed' | 'events' | 'chats' | 'members' | 'review' | 'about';

export function CircleHome({ id, me, tab: tab0, onChanged }: { id: string; me: MeProfile; tab?: string | null; onChanged: () => void }) {
  const router = useRouter();
  const [c, setC] = useState<CircleView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>((tab0 as TabKey) || 'feed');
  const [dialog, setDialog] = useState<'event' | 'leave' | 'edit' | null>(null);
  const [upcoming, setUpcoming] = useState<CircleEvent[]>([]);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try { const v = await api().circle(id); setC(v); setError(null); if (v.canRead) void api().circleEvents(id).then((x) => setUpcoming(x.filter((e) => e.status === 'scheduled').slice(0, 2)), () => undefined); }
    catch (e) { setError(errText(e, 'This circle isn’t available.')); }
  }, [id]);
  useEffect(() => { setC(null); void load(); }, [load]);
  if (error && !c) return <Unavailable />;
  if (!c) return <div className="pane-center"><span className="ys-spin" aria-label="Loading" /></div>;
  if (c.access === 'removed') return <Removed c={c} />;
  const member = c.access === 'admin' || c.access === 'member';
  const admin = c.access === 'admin';
  const join = async () => { setBusy(true); try { setC(await api().joinCircle(c.id)); onChanged(); } catch (e) { setError(errText(e)); } finally { setBusy(false); } };
  const tabs: Array<[TabKey, string]> = [
    ['feed', 'Feed'], ['events', c.upcomingEvents ? `Events · ${c.upcomingEvents}` : 'Events'],
    ...(member ? [['chats', c.chatCount ? `Chats · ${c.chatCount}` : 'Chats'] as [TabKey, string]] : []),
    ...(admin ? [['members', 'Members'] as [TabKey, string], ['review', c.pendingReview ? `Review · ${c.pendingReview}` : 'Review'] as [TabKey, string]] : []),
    ['about', 'About'],
  ];
  return (
    <section className="chome" aria-label={c.name}>
      <div className="chome__banner"><span className="ys-feature__deco a" style={{ width: 340, top: -150, right: 80 }} aria-hidden /><span className="chome__back"><OvalButton icon="arrow-left" label="Circles" size="sm" variant="secondary" href="/circles" /></span></div>
      <div className="chome__wrap">
        <div className="chome__head">
          <CircleMark c={c} size={84} onBanner />
          <span className="chome__title"><h2>{c.name}</h2><span className="muted"><CircleTags c={c} count={false} /> {plural(c.memberCount, 'member')}{c.owners[0] ? ` · owned by ${c.owners[0].displayName}` : ''}</span></span>
          {c.access === 'visitor' && c.visibility === 'public' && <OvalButton icon="plus" label="Join" size="md" loading={busy} onClick={() => void join()} />}
          {admin && <OvalButton icon="edit" label="Settings" size="sm" variant="soft" onClick={() => setTab('about')} />}
        </div>
        {c.lookalike && <Note icon="alert-triangle" tone="danger">This circle isn’t run by the team its name suggests. Only circles YaysApp has checked get the Official badge. Staff never ask you to send money.</Note>}
        {error && <Banner>{error}</Banner>}
        {!c.canRead ? <PrivateGate c={c} onChange={(v) => { setC(v); onChanged(); }} /> : (
          <>
            <div className="ctabs" role="tablist">
              {tabs.map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? 'on' : undefined} onClick={() => { setTab(k); router.replace(`/circles?id=${c.id}${k === 'feed' ? '' : `&tab=${k}`}`); }}>{l}</button>)}
            </div>
            <div className="chome__grid">
              <div className="chome__main">
                {tab === 'feed' && <FeedTab c={c} me={me} onEvent={() => setDialog('event')} onReload={() => void load()} />}
                {tab === 'events' && <EventsTab c={c} onNew={() => setDialog('event')} />}
                {tab === 'chats' && member && <CommunityView id={c.id} embedded onChanged={onChanged} onLeft={() => router.push('/circles')} />}
                {tab === 'members' && admin && <MembersTab c={c} me={me} />}
                {tab === 'review' && admin && <ReviewTab c={c} onChanged={() => void load()} />}
                {tab === 'about' && <AboutTab c={c} me={me} onChanged={(v) => { setC(v); onChanged(); }} onLeave={() => setDialog('leave')} onLeft={() => { onChanged(); router.push('/circles'); }} />}
              </div>
              <aside className="chome__side">
                <section className="ccard"><div className="ccard__head"><h3>Upcoming events</h3></div>{upcoming.length ? upcoming.map((e) => <EventMiniRow key={e.id} href={`/circles/event?id=${e.id}`} e={{ ...e, cancelled: false, circle: e.circle }} />) : <span className="muted ccard__empty">Nothing planned yet.</span>}</section>
                <section className="ccard ccard--pad"><h3 className="ccard__h">About</h3><span className="cpost__text" style={{ fontSize: 14 }}>{c.about || 'No description yet.'}</span><span className="muted p2-small">Owners: {c.owners.map((o) => o.displayName).join(' · ')}</span></section>
                {c.rules.length > 0 && <section className="ccard ccard--pad"><h3 className="ccard__h">Circle rules</h3><ol className="crules">{c.rules.map((r, i) => <li key={i}>{r}</li>)}</ol></section>}
              </aside>
            </div>
          </>
        )}
      </div>
      {dialog === 'event' && <EventForm c={c} onClose={() => setDialog(null)} onSaved={(e) => { setDialog(null); router.push(`/circles/event?id=${e.id}`); }} />}
      {dialog === 'leave' && <LeaveDialog c={c} me={me} onClose={() => setDialog(null)} onLeft={() => { onChanged(); router.push('/circles'); }} />}
    </section>
  );
}

/** p60: wrong link, deleted, or hidden. */
export function Unavailable() {
  return <div className="pane-center"><State icon="link" tone="plain" title="This circle isn’t available" actions={<OvalButton icon="compass" label="Discover circles" size="lg" href="/circles/discover" />}>The link may be wrong, or the circle was deleted or made hidden by its owners.</State></div>;
}

/** p54. */
function Removed({ c }: { c: CircleView }) {
  return (
    <div className="pane-center" data-testid="removed">
      <State icon="logout" tone="plain" title="You were removed from this circle" actions={<><OvalButton icon="chat" label="Contact support" size="lg" variant="soft" href="/settings/help" /><OvalButton icon="arrow-left" label="Back to Circles" size="lg" href="/circles" /></>}>
        An owner of {c.name} removed you on {dateShort(c.removed!.at)}{c.removed!.reason ? ` for breaking ${c.removed!.reason.replace(/^Rule/, 'rule')}` : ''}. You can’t see its posts, and you can ask to join again from {dateShort(c.removed!.until)}.
      </State>
      <Note icon="info" tone="plain">Think it’s a mistake? Contact YaysApp support. Your own past posts stay visible to members unless you delete them.</Note>
    </div>
  );
}

/** p45 / p46 / W22: a private circle seen from outside. */
function PrivateGate({ c, onChange }: { c: CircleView; onChange: (v: CircleView) => void }) {
  const [answer, setAnswer] = useState(c.request?.answer ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const act = async (fn: () => Promise<CircleView>) => { setBusy(true); setError(null); try { onChange(await fn()); } catch (e) { setError(errText(e)); } finally { setBusy(false); } };
  return (
    <div className="chome__grid">
      <div className="chome__main">
        {error && <Banner>{error}</Banner>}
        {c.access === 'requested' && c.request ? (
          <section className="ccard ccard--pad" data-testid="request-sent">
            <strong className="ccard__big">Request sent</strong>
            <div className="cstep cstep--done"><span className="ys-oval"><Icon name="check" size={14} /></span><span><strong>You asked to join</strong><br /><span className="muted">{dateShort(c.request.at)}</span></span></div>
            <div className="cstep"><span className="ys-oval"><Icon name="clock" size={14} /></span><span><strong>Owners review it</strong><br /><span className="muted">You’ll see the circle here once they say yes</span></span></div>
            <Note icon="info">If the owners don’t answer by {dateShort(c.request.expiresAt)}, the request ends and you can ask again.</Note>
            <div className="row center"><OvalButton icon="close" label="Cancel request" size="sm" variant="ghost" loading={busy} onClick={() => void act(() => api().cancelCircleRequest(c.id))} /></div>
          </section>
        ) : c.access === 'declined' ? (
          <section className="ccard ccard--pad" data-testid="request-declined">
            <State icon="lock" tone="plain" title="Request not accepted">The owners said no this time. You can ask again from {dateShort(c.declinedUntil!)}.</State>
          </section>
        ) : (
          <section className="ccard ccard--pad" data-testid="private-gate">
            <div className="row" style={{ gap: 12, alignItems: 'center' }}><span className="ys-oval ys-oval--wash" style={{ width: 48 }}><Icon name="lock" size={22} /></span><span><strong>This circle is private</strong><br /><span className="muted">Only members see posts, events and chats.</span></span></div>
            {c.joinQuestion && (
              <Field id="join-answer" label={`The owners ask: ${c.joinQuestion}`} hint={`Owners usually answer within a few days. If they don’t answer in ${CIRCLE_TIMES.requestDays} days, you can ask again.`}>
                <textarea id="join-answer" className="ys-input" rows={3} maxLength={CIRCLE_LIMITS.answer} value={answer} onChange={(e) => setAnswer(e.target.value)} />
              </Field>
            )}
            <div><OvalButton icon="person-add" label="Ask to join" size="lg" loading={busy} disabled={!!c.joinQuestion && !answer.trim()} onClick={() => void act(() => api().joinCircle(c.id, answer.trim() || undefined))} /></div>
          </section>
        )}
      </div>
      <aside className="chome__side">
        <section className="ccard ccard--pad"><h3 className="ccard__h">About</h3><span className="cpost__text" style={{ fontSize: 14 }}>{c.about || 'No description yet.'}</span><span className="muted p2-small">Owners: {c.owners.map((o) => o.displayName).join(' · ')}</span></section>
        {c.rules.length > 0 && <section className="ccard ccard--pad"><h3 className="ccard__h">Circle rules</h3><ol className="crules">{c.rules.map((r, i) => <li key={i}>{r}</li>)}</ol></section>}
      </aside>
    </div>
  );
}

/* ------------------------------------------------------------------ about and settings */

function AboutTab({ c, me, onChanged, onLeave, onLeft }: { c: CircleView; me: MeProfile; onChanged: (v: CircleView) => void; onLeave: () => void; onLeft: () => void }) {
  const admin = c.access === 'admin';
  const member = admin || c.access === 'member';
  const [edit, setEdit] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const leave = async () => {
    // The only owner picks someone first (p59).
    if (c.isOwner && c.memberCount > 1 && c.owners.filter((o) => o.role !== 'owner').length === 0) { onLeave(); return; }
    try { await api().leaveCircle(c.id); onLeft(); } catch (e) { setError(errText(e)); }
  };
  return (
    <div className="cfeed">
      {error && <Banner>{error}</Banner>}
      {edit && admin ? <CircleSettings c={c} onCancel={() => setEdit(false)} onSaved={(v) => { setEdit(false); onChanged(v); }} /> : (
        <section className="ccard ccard--pad">
          <div className="row" style={{ justifyContent: 'space-between' }}><h3 className="ccard__h">About</h3>{admin && <OvalButton icon="edit" label="Edit" size="sm" variant="soft" onClick={() => setEdit(true)} />}</div>
          <p className="cpost__text">{c.about || 'No description yet.'}</p>
          <span className="ctags"><CircleTags c={c} /><Tag kind="muted">{CIRCLE_CATEGORY_LABEL[c.category]}</Tag></span>
          {admin && <span className="muted p2-small">{c.listed ? 'Shown in Discover.' : 'Hidden from Discover.'} {c.postApproval ? 'Owners approve posts before they appear.' : 'Members’ posts appear straight away.'}{c.joinQuestion ? ` People asking to join answer: “${c.joinQuestion}”` : ''}</span>}
        </section>
      )}
      {c.rules.length > 0 && !edit && <section className="ccard ccard--pad"><h3 className="ccard__h">Circle rules</h3><ol className="crules">{c.rules.map((r, i) => <li key={i}>{r}</li>)}</ol></section>}
      <section className="ccard">
        <div className="ccard__head"><h3>Owners</h3></div>
        {c.owners.map((o) => <div key={o.id} className="ys-row-item" style={{ cursor: 'default' }}><Avatar name={o.displayName} photoUrl={o.photoUrl} size={40} /><span className="ys-row-item__text"><span className="ys-row-item__title">{o.displayName}{o.id === me.id ? ' (you)' : ''}</span><span className="ys-row-item__sub">{o.role === 'owner' ? 'Owner' : 'Admin'}</span></span></div>)}
      </section>
      <Note icon="shield-check" tone="plain">Your phone number and email are never shown to members. Report posts that ask for money or promise profits.</Note>
      {member && <div className="row center"><OvalButton icon="logout" label="Leave circle" size="md" variant="ghost" onClick={() => void leave()} /></div>}
    </div>
  );
}

function CircleSettings({ c, onCancel, onSaved }: { c: CircleView; onCancel: () => void; onSaved: (v: CircleView) => void }) {
  const [name, setName] = useState(c.name);
  const [about, setAbout] = useState(c.about);
  const [visibility, setVisibility] = useState(c.visibility);
  const [category, setCategory] = useState(c.category);
  const [listed, setListed] = useState(c.listed);
  const [postApproval, setPostApproval] = useState(c.postApproval);
  const [question, setQuestion] = useState(c.joinQuestion ?? '');
  const [rules, setRules] = useState(c.rules.join('\n'));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setBusy(true); setError(null);
    try { onSaved(await api().updateCircle(c.id, { name, about, visibility, category, listed, postApproval, joinQuestion: visibility === 'private' ? question.trim() || null : null, rules: rules.split('\n').map((r) => r.trim()).filter(Boolean) })); }
    catch (e) { setError(errText(e)); setBusy(false); }
  };
  return (
    <section className="ccard ccard--pad cform">
      <h3 className="ccard__h">Circle settings</h3>
      {error && <Banner>{error}</Banner>}
      <CircleFields {...{ name, setName, about, setAbout, visibility, setVisibility, category, setCategory, question, setQuestion, rules, setRules }} />
      <Switch label="Show in Discover" hint={listed ? 'Anyone can find it.' : visibility === 'private' ? 'Hidden: only people with an invite link can find it.' : 'Only people with the link can find it.'} on={listed} onChange={setListed} />
      <Switch label="Owners approve posts" hint="Members’ posts wait for an owner before everyone sees them." on={postApproval} onChange={setPostApproval} />
      <div className="row" style={{ gap: 18, justifyContent: 'flex-end' }}><OvalButton icon="close" label="Cancel" size="sm" variant="ghost" onClick={onCancel} /><OvalButton icon="check" label="Save" size="sm" loading={busy} onClick={() => void save()} /></div>
    </section>
  );
}

function CircleFields(p: { name: string; setName: (v: string) => void; about: string; setAbout: (v: string) => void; visibility: 'public' | 'private'; setVisibility: (v: 'public' | 'private') => void; category: CircleCategory; setCategory: (v: CircleCategory) => void; question: string; setQuestion: (v: string) => void; rules: string; setRules: (v: string) => void }) {
  return (
    <>
      <Field id="c-name" label="Name"><input id="c-name" className="ys-input" value={p.name} maxLength={100} onChange={(e) => p.setName(e.target.value)} placeholder="Lahore Runners" /></Field>
      <Field id="c-about" label="Description"><textarea id="c-about" className="ys-input" rows={3} value={p.about} maxLength={2048} onChange={(e) => p.setAbout(e.target.value)} placeholder="What is this circle for?" /></Field>
      <div className="chips" role="radiogroup" aria-label="Who can join">
        <button type="button" role="radio" aria-checked={p.visibility === 'public'} className={`cchip${p.visibility === 'public' ? ' cchip--on' : ''}`} onClick={() => p.setVisibility('public')}><Icon name="globe" size={14} />Public: anyone can join</button>
        <button type="button" role="radio" aria-checked={p.visibility === 'private'} className={`cchip${p.visibility === 'private' ? ' cchip--on' : ''}`} onClick={() => p.setVisibility('private')}><Icon name="lock" size={14} />Private: owners approve</button>
      </div>
      {p.visibility === 'private' && <Field id="c-q" label="Question for people asking to join (optional)"><input id="c-q" className="ys-input" value={p.question} maxLength={200} onChange={(e) => p.setQuestion(e.target.value)} placeholder="Why do you want to join?" /></Field>}
      <Field id="c-cat" label="Category"><select id="c-cat" className="ys-input" value={p.category} onChange={(e) => p.setCategory(e.target.value as CircleCategory)}>{CIRCLE_CATEGORIES.map((x) => <option key={x} value={x}>{CIRCLE_CATEGORY_LABEL[x]}</option>)}</select></Field>
      <Field id="c-rules" label="Rules (one per line)" hint={`Up to ${CIRCLE_LIMITS.rules}. Owners can point to a rule when they remove a post.`}><textarea id="c-rules" className="ys-input" rows={3} value={p.rules} onChange={(e) => p.setRules(e.target.value)} placeholder={'Be kind and on topic\nNo selling or asking for money'} /></Field>
    </>
  );
}

export function CreateCircleDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const [name, setName] = useState('');
  const [about, setAbout] = useState('');
  const [visibility, setVisibility] = useState<'public' | 'private'>('public');
  const [category, setCategory] = useState<CircleCategory>('other');
  const [question, setQuestion] = useState('');
  const [rules, setRules] = useState('Be kind and on topic\nNo selling or asking for money');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const create = async () => {
    setBusy(true); setError(null);
    try { const c = await api().createCircle({ name, about, visibility, category, joinQuestion: visibility === 'private' ? question.trim() || null : null, rules: rules.split('\n').map((r) => r.trim()).filter(Boolean) }); onCreated(c.id); }
    catch (e) { setError(errText(e)); setBusy(false); }
  };
  return (
    <Modal title="Start a circle" onClose={onClose} eyebrow="A feed, events and chats for your group. You’ll be the owner.">
      {error && <Banner>{error}</Banner>}
      <CircleFields {...{ name, setName, about, setAbout, visibility, setVisibility, category, setCategory, question, setQuestion, rules, setRules }} />
      <div className="modal__actions"><OvalButton icon="check" label="Create circle" size="md" loading={busy} disabled={!name.trim()} onClick={() => void create()} /></div>
    </Modal>
  );
}

/** p59: the only owner hands over before leaving, or deletes the circle. */
function LeaveDialog({ c, me, onClose, onLeft }: { c: CircleView; me: MeProfile; onClose: () => void; onLeft: () => void }) {
  const [people, setPeople] = useState<CircleMemberRow[] | null>(null);
  const [pick, setPick] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { void api().circleMembers(c.id).then((m) => { const others = m.filter((x) => x.id !== me.id); setPeople(others); setPick(others[0]?.id ?? null); }, (e) => setError(errText(e))); }, [c.id, me.id]);
  const run = async (fn: () => Promise<unknown>) => { setBusy(true); setError(null); try { await fn(); onLeft(); } catch (e) { setError(errText(e)); setBusy(false); } };
  return (
    <Modal title="Pick a new owner first" onClose={onClose} eyebrow="A circle always needs an owner. Choose who takes over, then you’ll leave.">
      {error && <Banner>{error}</Banner>}
      {!people ? <span className="ys-spin" aria-label="Loading" /> : (
        <div role="radiogroup" aria-label="New owner" className="creasons">
          {people.slice(0, 20).map((p) => (
            <label key={p.id} className="creason creason--person">
              <Avatar name={p.displayName} photoUrl={p.photoUrl} size={40} />
              <span style={{ flex: 1 }}><strong>{p.displayName}</strong><br /><span className="muted">{p.role === 'admin' ? 'Admin' : 'Member'} · joined {dateShort(p.joinedAt)}</span></span>
              <input type="radio" name="owner" checked={pick === p.id} onChange={() => setPick(p.id)} />
            </label>
          ))}
        </div>
      )}
      {confirmDelete ? (
        <Note icon="alert-triangle" tone="danger">Delete {c.name} for everyone? Posts and events go; its chats stay as ordinary groups. <button type="button" className="link-btn link-btn--danger" onClick={() => void run(() => api().deleteCircle(c.id))}>Delete it</button></Note>
      ) : null}
      <div className="modal__actions">
        <OvalButton icon="trash" label="Delete circle" size="md" variant="ghost" onClick={() => setConfirmDelete(true)} />
        <OvalButton icon="logout" label="Make owner and leave" size="md" variant="danger" loading={busy} disabled={!pick} onClick={() => void run(async () => { await api().setCircleOwner(c.id, pick!); await api().leaveCircle(c.id); })} />
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ admin tabs */

function MembersTab({ c, me }: { c: CircleView; me: MeProfile }) {
  const [rows, setRows] = useState<CircleMemberRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [act, setAct] = useState<{ kind: 'mute' | 'remove'; p: CircleMemberRow } | null>(null);
  const load = useCallback(() => api().circleMembers(c.id).then(setRows, (e) => setError(errText(e))), [c.id]);
  useEffect(() => { void load(); }, [load]);
  return (
    <div className="cfeed">
      {error && <Banner>{error}</Banner>}
      <section className="ccard">
        <div className="ccard__head"><h3>{plural(c.memberCount, 'member')}</h3></div>
        {!rows ? <span className="ys-spin" aria-label="Loading" /> : rows.map((p) => (
          <div key={p.id} className="ys-row-item" style={{ cursor: 'default' }} data-testid="member-row">
            <Avatar name={p.displayName} photoUrl={p.photoUrl} size={40} />
            <span className="ys-row-item__text"><span className="ys-row-item__title">{p.displayName}{p.id === me.id ? ' (you)' : ''}</span><span className="ys-row-item__sub">{p.role === 'owner' ? 'Owner' : p.role === 'admin' ? 'Admin' : `Joined ${dateShort(p.joinedAt)}`}{p.mutedUntil ? ` · Muted until ${dateShort(p.mutedUntil)}` : ''}</span></span>
            {p.role === 'member' && (
              <span className="row" style={{ gap: 14 }}>
                {p.mutedUntil ? <OvalButton icon="bell" label="Unmute" size="sm" variant="soft" onClick={() => void api().unmuteCircleMember(c.id, p.id).then(load)} /> : <OvalButton icon="volume-off" label="Mute" size="sm" variant="soft" onClick={() => setAct({ kind: 'mute', p })} />}
                <OvalButton icon="logout" label="Remove" size="sm" variant="ghost" onClick={() => setAct({ kind: 'remove', p })} />
              </span>
            )}
          </div>
        ))}
      </section>
      {act && <ModerateDialog c={c} kind={act.kind} p={act.p} onClose={() => setAct(null)} onDone={() => { setAct(null); void load(); }} />}
    </div>
  );
}

function ModerateDialog({ c, kind, p, onClose, onDone }: { c: CircleView; kind: 'mute' | 'remove'; p: CircleMemberRow; onClose: () => void; onDone: () => void }) {
  const [days, setDays] = useState(7);
  const [reason, setReason] = useState(c.rules[0] ? `Rule 1: ${c.rules[0]}` : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const go = async () => { setBusy(true); setError(null); try { if (kind === 'mute') await api().muteCircleMember(c.id, p.id, days, reason); else await api().removeCircleMember(c.id, p.id, reason); onDone(); } catch (e) { setError(errText(e)); setBusy(false); } };
  return (
    <Modal title={kind === 'mute' ? `Mute ${p.displayName}` : `Remove ${p.displayName}`} onClose={onClose}
      eyebrow={kind === 'mute' ? 'They can still read, but can’t post or comment until then.' : `They can’t see the circle or ask to join again for ${CIRCLE_TIMES.rejoinDays} days. They’re told the reason.`}>
      {error && <Banner>{error}</Banner>}
      {kind === 'mute' && <Field id="m-days" label="For"><select id="m-days" className="ys-input" value={days} onChange={(e) => setDays(Number(e.target.value))}>{[1, 3, 7, 14, 30].map((d) => <option key={d} value={d}>{plural(d, 'day')}</option>)}</select></Field>}
      <Field id="m-why" label="Reason they see"><input id="m-why" className="ys-input" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} placeholder="Repeated off-topic posts" /></Field>
      <div className="modal__actions"><OvalButton icon={kind === 'mute' ? 'volume-off' : 'logout'} label={kind === 'mute' ? 'Mute' : 'Remove'} size="md" variant="danger" loading={busy} onClick={() => void go()} /></div>
    </Modal>
  );
}

function ReviewTab({ c, onChanged }: { c: CircleView; onChanged: () => void }) {
  const [r, setR] = useState<CircleReview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => api().circleReview(c.id).then(setR, (e) => setError(errText(e))), [c.id]);
  useEffect(() => { void load(); }, [load]);
  const run = async (fn: () => Promise<unknown>) => { setError(null); try { await fn(); await load(); onChanged(); } catch (e) { setError(errText(e)); } };
  const reason = c.rules[1] ? `Rule 2: ${c.rules[1]}` : '';
  if (!r) return error ? <Banner>{error}</Banner> : <span className="ys-spin" aria-label="Loading" />;
  return (
    <div className="cfeed">
      {error && <Banner>{error}</Banner>}
      {!r.pending.length && !r.reports.length && <State icon="check" tone="success" title="Nothing to review">Posts waiting for approval and reported posts show up here.</State>}
      {r.pending.length > 0 && <h3 className="community__h">Waiting for approval · {r.pending.length}</h3>}
      {r.pending.map((p) => (
        <div key={p.id} className="creview">
          <PostCard p={p} c={c} onChange={() => void load()} onGone={() => void load()} />
          <div className="row" style={{ gap: 18, justifyContent: 'flex-end' }}>
            <OvalButton icon="close" label="Remove" size="sm" variant="ghost" onClick={() => void run(() => api().removeCirclePost(p.id, reason))} />
            <OvalButton icon="check" label="Approve" size="sm" onClick={() => void run(() => api().approveCirclePost(p.id))} />
          </div>
        </div>
      ))}
      {r.reports.length > 0 && <h3 className="community__h">Reported · {r.reports.length}</h3>}
      {r.reports.map((x) => (
        <div key={x.id} className="creview">
          <Note icon="flag" tone="danger"><strong>{plural(x.reports, 'report')}</strong> · mostly “{x.reason === 'scam' ? 'misleading promotion' : x.reason}”</Note>
          <PostCard p={x.post} c={c} onChange={() => void load()} onGone={() => void load()} />
          <div className="row" style={{ gap: 18, justifyContent: 'flex-end' }}>
            <OvalButton icon="check" label="Keep" size="sm" variant="soft" onClick={() => void run(() => api().settleCircleReport(c.id, x.id, 'keep'))} />
            <OvalButton icon="close" label="Remove post" size="sm" variant="danger" onClick={() => void run(() => api().settleCircleReport(c.id, x.id, 'remove', reason))} />
          </div>
        </div>
      ))}
    </div>
  );
}

export { EventRow };

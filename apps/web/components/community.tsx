'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ApiError, COMMUNITY_LIMITS, type CommunityGroup, type CommunityInfo, type CommunityMember, type CommunityReport, type CommunitySummary, type ConversationSummary, type JoinRequest } from '@yays/shared';
import { api } from '@/lib/api';
import { Icon } from '@/lib/icons';
import { listTime } from '@/lib/chat';
import { ConfirmButton, Switch } from './group';
import { Modal } from './message-actions';
import { LineArt, Avatar, Banner, OvalButton, PhotoPick, artFor } from './ui';

const BANNER_ART = ['hype', 'skater', 'trader', 'explorer', 'coins', 'snap'] as const;

const errText = (e: unknown, f = 'That did not work. Try again.') => (e instanceof ApiError ? e.message : f);
const plural = (n: number, w: string) => (w === 'person' ? `${n.toLocaleString()} ${n === 1 ? 'person' : 'people'}` : `${n.toLocaleString()} ${w}${n === 1 ? '' : 's'}`);

/** The community's picture, or its first letter on its own colour. */
export function CommunityMark({ c, size, onBanner }: { c: { id: string; name: string; photoUrl: string | null }; size: number; onBanner?: boolean }) {
  if (onBanner && !c.photoUrl) return <span className="ys-oval" aria-hidden style={{ width: size, '--ys-oval-fill': '#ffffff', '--ys-oval-ink': 'var(--ember-ink)', font: `800 ${Math.round(size * 0.36)}px var(--font-display)` } as React.CSSProperties}>{c.name.charAt(0).toUpperCase()}</span>;
  if (c.photoUrl) return <span className="ys-oval" style={{ width: size, overflow: 'hidden' }}><img src={c.photoUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /></span>;
  return <span className="ys-oval" aria-hidden style={{ width: size, '--ys-oval-fill': 'var(--ember)', '--ys-oval-ink': '#fff', font: `800 ${Math.round(size * 0.36)}px var(--font-display)` } as React.CSSProperties}>{c.name.charAt(0).toUpperCase()}</span>;
}

export function CommunityList({ list, active, onOpen, onNew }: { list: CommunitySummary[] | null; active: string | null; onOpen: (id: string) => void; onNew: () => void }) {
  if (!list) return <div className="list-empty" aria-busy="true"><span className="ys-spin" aria-hidden /> Loading…</div>;
  if (!list.length) {
    return (
      <div className="list-empty">
        <LineArt name="explorer" width={90} />
        <strong>No communities yet</strong>
        <span>Bring related groups together, with announcements that reach everyone.</span>
        <OvalButton icon="plus" label="New community" size="md" onClick={onNew} />
      </div>
    );
  }
  return (
    <nav aria-label="Communities" className="chat-rows">
      {list.map((c) => (
        <a key={c.id} href={`/communities?id=${c.id}`} className="ys-row-item" aria-current={c.id === active ? 'true' : undefined} data-testid="community-row" style={{ textDecoration: 'none', color: 'inherit' }}
          onClick={(e) => { if (e.metaKey || e.ctrlKey) return; e.preventDefault(); onOpen(c.id); }}>
          <CommunityMark c={c} size={48} />
          <span className="ys-row-item__text"><span className="ys-row-item__title">{c.name}</span><span className="ys-row-item__sub">{plural(c.groupCount, 'group')} · {plural(c.memberCount, 'member')}</span></span>
          {c.unreadChats > 0 && <span className="ys-oval ys-oval--ember ys-badge" aria-label={`${c.unreadChats} unread`}><span>{c.unreadChats}</span></span>}
        </a>
      ))}
    </nav>
  );
}

/** One community (w07): announcements, my groups, other groups, about and capacity. Admins can manage it (w23). */
export function CommunityView({ id, onChanged, onLeft }: { id: string; onChanged: () => void; onLeft: () => void }) {
  const router = useRouter();
  const [c, setC] = useState<CommunityInfo | null>(null);
  const [chats, setChats] = useState<Record<string, ConversationSummary>>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dialog, setDialog] = useState<'invite' | 'add' | 'suggest' | null>(null);
  const [managing, setManaging] = useState(false);
  const load = useCallback(async () => {
    try {
      const info = await api().community(id);
      setC(info);
      // Last message for each group I'm in.
      const mine = info.groups.filter((g) => g.joined);
      const sums = await Promise.all(mine.map((g) => api().conversation(g.id).catch(() => null)));
      setChats(Object.fromEntries(sums.filter((x): x is ConversationSummary => !!x).map((x) => [x.id, x])));
    } catch (e) { setError(errText(e, 'Could not load the community.')); }
  }, [id]);
  useEffect(() => { setC(null); setError(null); setNotice(null); setManaging(false); void load(); }, [load]);
  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    setError(null); setNotice(null);
    try { await fn(); if (ok) setNotice(ok); await load(); onChanged(); } catch (e) { setError(errText(e)); }
  };
  if (!c) return <div className="pane-center">{error ? <Banner>{error}</Banner> : <span className="ys-spin" aria-label="Loading" />}</div>;
  const admin = c.role === 'admin';
  if (managing && admin) return <ManageCommunity c={c} onBack={() => { setManaging(false); void load(); onChanged(); }} />;
  const ann = c.groups.find((g) => g.announcements);
  const joined = c.groups.filter((g) => !g.announcements && g.joined);
  const others = c.groups.filter((g) => !g.announcements && !g.joined);
  const annChat = ann ? chats[ann.id] : undefined;
  const join = (g: CommunityGroup) => run(async () => {
    const r = await api().joinCommunityGroup(c.id, g.id);
    if (r.status === 'joined') router.push(`/chats?c=${g.id}`);
  }, g.needsApproval ? `Asked to join ${g.name}. An admin will let you in.` : undefined);
  return (
    <section className="community" aria-label={c.name}>
      <div className="community__hero">
        <span className="ys-feature__deco a" style={{ width: 380, top: -170, right: 120 }} aria-hidden />
        <LineArt name={artFor(c.id, BANNER_ART)} height={150} ink="#ffffff" opacity={0.85} className="community__art" />
        <span className="convo__back" style={{ marginBottom: 10 }}><OvalButton icon="arrow-left" label="Communities" size="sm" variant="soft" href="/communities" /></span>
        <div className="row" style={{ gap: 18 }}>
          <span className="community__mark"><CommunityMark c={c} size={72} onBanner /></span>
          <div>
            <h2>{c.name}</h2>
            <span>Community · {plural(c.memberCount, 'member')} · {plural(c.groupCount, 'group')}</span>
          </div>
        </div>
        <div className="row" style={{ gap: 22, marginTop: 18 }}>
          {admin && <OvalButton icon="link" label="Invite" size="sm" variant="soft" onClick={() => setDialog('invite')} />}
          {admin && <OvalButton icon="plus" label="Add group" size="sm" variant="soft" onClick={() => setDialog('add')} />}
          {!admin && c.settings.membersSuggest && <OvalButton icon="plus" label="Suggest a group" size="sm" variant="soft" onClick={() => setDialog('suggest')} />}
          {admin && <OvalButton icon="settings" label="Manage" size="sm" variant="soft" onClick={() => setManaging(true)} />}
        </div>
      </div>
      <div className="community__body">
        <div className="community__main">
          {error && <Banner>{error}</Banner>}
          {notice && <Banner tone="success">{notice}</Banner>}
          {admin && c.pendingRequests > 0 && <Banner tone="info">{plural(c.pendingRequests, 'person')} asked to join. <button type="button" className="link-btn" onClick={() => setManaging(true)}>Review</button></Banner>}
          {ann && (
            <Link href={`/chats?c=${ann.id}`} className="community__ann" data-testid="announcements">
              <span className="ys-oval ys-oval--ember" style={{ width: 48 }}><Icon name="megaphone" size={20} /></span>
              <span className="community__ann-text"><strong>Announcements</strong><span>{annChat?.lastMessage?.text ? `${annChat.lastSenderName ?? ''}: ${annChat.lastMessage.text}` : admin ? 'Post updates everyone in the community sees.' : 'Only admins post here.'}</span></span>
              <span className="community__ann-end">{annChat?.lastActivityAt && <span>{listTime(annChat.lastActivityAt)}</span>}{annChat && annChat.unread > 0 && <span className="ys-oval ys-oval--ember ys-badge"><span>{annChat.unread}</span></span>}</span>
            </Link>
          )}
          <h3 className="community__h">Groups you’re in</h3>
          {!joined.length && <p className="muted" style={{ margin: 0, fontSize: 14 }}>You haven’t joined any groups here yet.</p>}
          {joined.map((g) => {
            const s = chats[g.id];
            return (
              <Link key={g.id} href={`/chats?c=${g.id}`} className="ys-row-item community__group" data-testid="community-group">
                <Avatar name={g.name} photoUrl={g.photoUrl} size={44} group />
                <span className="ys-row-item__text"><span className="ys-row-item__title">{g.name}</span><span className="ys-row-item__sub">{s?.lastMessage?.text ? `${s.lastSenderName ?? ''}: ${s.lastMessage.text}` : plural(g.memberCount, 'member')}</span></span>
                <span className="ys-row-item__end">{s && <span>{listTime(s.lastActivityAt)}</span>}{s && s.unread > 0 && <span className="ys-oval ys-oval--ember ys-badge"><span>{s.unread}</span></span>}</span>
              </Link>
            );
          })}
          {others.length > 0 && <h3 className="community__h">Other groups in this community</h3>}
          {others.map((g) => (
            <div key={g.id} className="ys-row-item community__group" style={{ cursor: 'default' }} data-testid="community-other">
              <Avatar name={g.name} photoUrl={g.photoUrl} size={44} group />
              <span className="ys-row-item__text"><span className="ys-row-item__title">{g.name}</span>
                <span className="ys-row-item__sub">{plural(g.memberCount, 'member')}{g.full ? ' · Full' : g.needsApproval ? ' · Admin approves joins' : ''}</span></span>
              {g.full ? <span className="ys-tag">Full</span>
                : g.requested ? <span className="ys-tag">Requested</span>
                : <OvalButton icon={g.needsApproval ? 'person-add' : 'plus'} label={g.needsApproval ? 'Ask to join' : 'Join'} size="sm" variant="soft" onClick={() => void join(g)} />}
            </div>
          ))}
        </div>
        <aside className="community__side" aria-label="About this community">
          <section className="set-card set-card--pad"><h3 style={{ margin: 0, font: '700 15px var(--font-display)' }}>About</h3><p className="muted" style={{ margin: 0, fontSize: 13, lineHeight: '20px', whiteSpace: 'pre-wrap' }}>{c.about || 'No description yet.'}</p></section>
          <section className="set-card set-card--pad" aria-label="Capacity">
            <h3 style={{ margin: 0, font: '700 15px var(--font-display)' }}>Capacity</h3>
            <Meter label="Members" n={c.memberCount} max={c.limits.members} />
            <Meter label="Groups" n={c.groupCount} max={c.limits.groups} />
          </section>
          <section className="set-card set-card--pad"><h3 style={{ margin: 0, font: '700 15px var(--font-display)' }}>Privacy</h3><span className="muted" style={{ fontSize: 13, lineHeight: '19px' }}>Your phone number and email are never shown to members.</span></section>
          <div className="row center"><ConfirmButton label="Exit community" confirm="Exit" question={`Exit ${c.name}? You’ll leave all its groups.`} onConfirm={() => run(async () => { await api().leaveCommunity(c.id); onLeft(); })} /></div>
        </aside>
      </div>
      {dialog === 'invite' && <InviteDialog c={c} onClose={() => setDialog(null)} onChanged={() => void load()} />}
      {(dialog === 'add' || dialog === 'suggest') && <AddGroupDialog c={c} suggest={dialog === 'suggest'} onClose={() => setDialog(null)} onDone={(t) => { setDialog(null); setNotice(t); void load(); onChanged(); }} />}
    </section>
  );
}

function Meter({ label, n, max }: { label: string; n: number; max: number }) {
  return (
    <div className="meter">
      <div className="row" style={{ justifyContent: 'space-between', fontSize: 13 }}><span>{label}</span><strong>{n.toLocaleString()} / {max.toLocaleString()}</strong></div>
      <span className="poll__bar" role="meter" aria-label={label} aria-valuenow={n} aria-valuemin={0} aria-valuemax={max}><span style={{ width: `${Math.min(100, (n / max) * 100)}%` }} /></span>
    </div>
  );
}

function InviteDialog({ c, onClose, onChanged }: { c: CommunityInfo; onClose: () => void; onChanged: () => void }) {
  const [code, setCode] = useState(c.inviteCode);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const link = code ? `${window.location.origin}/c/${code}` : '';
  useEffect(() => { if (!code) void api().communityInvite(c.id).then((r) => { setCode(r.inviteCode); onChanged(); }, (e) => setError(errText(e))); }, [c.id, code, onChanged]);
  return (
    <Modal title="Invite to the community" onClose={onClose}>
      {error && <Banner>{error}</Banner>}
      <p className="muted" style={{ margin: 0, fontSize: 14 }}>Anyone with this link can {c.settings.approveNew ? 'ask to join. An admin approves them.' : 'join the community and its announcements.'}</p>
      <div className="ys-field"><div className="ys-field__box"><input className="ys-input" readOnly value={link} aria-label="Invite link" onFocus={(e) => e.target.select()} /></div></div>
      <div className="modal__actions">
        <OvalButton icon="refresh" label="Reset link" size="sm" variant="soft" onClick={() => void api().communityInvite(c.id).then((r) => { setCode(r.inviteCode); onChanged(); })} />
        <OvalButton icon={copied ? 'check' : 'copy'} label={copied ? 'Copied' : 'Copy link'} size="sm" variant="primary" disabled={!link} onClick={() => { void navigator.clipboard?.writeText(link).then(() => setCopied(true), () => undefined); }} />
      </div>
    </Modal>
  );
}

/** Admins: bring in a group they run, or start a new one. Members: suggest a group they run. */
function AddGroupDialog({ c, suggest, onClose, onDone }: { c: CommunityInfo; suggest: boolean; onClose: () => void; onDone: (notice: string) => void }) {
  const [mine, setMine] = useState<ConversationSummary[] | null>(null);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { void api().conversations({ limit: 100 }).then((r) => setMine(r.items.filter((x) => x.kind === 'group' && x.group?.role === 'admin' && !x.group.community)), () => setMine([])); }, []);
  const run = async (fn: () => Promise<unknown>, ok: string) => { setBusy(true); setError(null); try { await fn(); onDone(ok); } catch (e) { setError(errText(e)); setBusy(false); } };
  return (
    <Modal title={suggest ? 'Suggest a group' : 'Add a group'} onClose={onClose}>
      {error && <Banner>{error}</Banner>}
      {!suggest && (
        <form className="new-chat__form" style={{ padding: 0 }} onSubmit={(e: FormEvent) => { e.preventDefault(); if (name.trim()) void run(() => api().addCommunityGroup(c.id, { name: name.trim() }), `${name.trim()} was created.`); }}>
          <div className="ys-field" style={{ flex: 1 }}><label className="ys-field__label" htmlFor="new-cg">New group</label><div className="ys-field__box"><input id="new-cg" className="ys-input" value={name} maxLength={100} onChange={(e) => setName(e.target.value)} placeholder="Group name" /></div></div>
          <OvalButton type="submit" icon="plus" label="Create" size="sm" variant="soft" loading={busy} disabled={!name.trim()} />
        </form>
      )}
      <h4 style={{ margin: 0, font: '700 14px var(--font-display)' }}>{suggest ? 'Groups you run' : 'Or bring in a group you run'}</h4>
      {mine === null ? <span className="ys-spin" aria-label="Loading" /> : !mine.length ? <p className="muted" style={{ margin: 0, fontSize: 14 }}>You don’t run any groups that aren’t in a community.</p> : (
        <div className="ys-list">
          {mine.map((g) => (
            <div key={g.id} className="ys-row-item" style={{ cursor: 'default' }}>
              <Avatar name={g.group!.name} photoUrl={g.group!.photoUrl} size={40} group />
              <span className="ys-row-item__text"><span className="ys-row-item__title">{g.group!.name}</span><span className="ys-row-item__sub">{plural(g.group!.memberCount, 'member')}</span></span>
              <OvalButton icon="plus" label={suggest ? 'Suggest' : 'Add'} size="sm" variant="soft" loading={busy}
                onClick={() => void run(() => (suggest ? api().suggestCommunityGroup(c.id, g.id) : api().addCommunityGroup(c.id, { groupId: g.id })), suggest ? `Suggested ${g.group!.name}. An admin will decide.` : `${g.group!.name} is now in ${c.name}.`)} />
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}

/** w22: details first, then which groups to bring in or create. */
export function CreateCommunityDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const [step, setStep] = useState<1 | 2>(1);
  const [name, setName] = useState('');
  const [about, setAbout] = useState('');
  const [photo, setPhoto] = useState<{ key: string; url: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [approveNew, setApproveNew] = useState(false);
  const [membersSuggest, setMembersSuggest] = useState(false);
  const [mine, setMine] = useState<ConversationSummary[] | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [newGroups, setNewGroups] = useState<string[]>(['General']);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { void api().conversations({ limit: 100 }).then((r) => setMine(r.items.filter((x) => x.kind === 'group' && x.group?.role === 'admin' && !x.group.community)), () => setMine([])); }, []);
  const pickPhoto = async (f: File) => {
    setUploading(true); setError(null);
    try { const key = await api().uploadPhoto(f); setPhoto({ key, url: URL.createObjectURL(f) }); } catch (e) { setError(errText(e, "The photo didn't upload.")); } finally { setUploading(false); }
  };
  const create = async () => {
    setBusy(true); setError(null);
    try { const c = await api().createCommunity({ name, about, approveNew, membersSuggest, groupIds: picked, newGroups: newGroups.map((g) => g.trim()).filter(Boolean), ...(photo ? { photoKey: photo.key } : {}) }); onCreated(c.id); }
    catch (e) { setError(errText(e)); setBusy(false); }
  };
  const preview = (
    <>
      <span className="caps">Preview</span>
      <div className="preview-card" aria-label="Preview">
        <div className="preview-card__banner">
          <span className="ys-feature__deco a" style={{ width: 220, top: -110, right: -30 }} aria-hidden />
        </div>
        <span className="preview-card__mark"><CommunityMark c={{ id: 'new', name: name.trim() || 'C', photoUrl: photo?.url ?? null }} size={56} onBanner /></span>
        <div className="preview-card__body">
          <strong>{name.trim() || 'Your community'}</strong>
          <small>Community · 1 member{approveNew ? ' · Admin approval on' : ''}</small>
          {about.trim() && <p>{about.trim()}</p>}
        </div>
      </div>
      <div className="preview-note"><Icon name="megaphone" size={16} /><span>Every community gets an <strong>Announcements</strong> group where only admins post.</span></div>
      <span className="modal__aside-foot">Up to {COMMUNITY_LIMITS.members.toLocaleString()} members and {COMMUNITY_LIMITS.groups} groups.</span>
    </>
  );
  return (
    <Modal title="Create a community" onClose={onClose} eyebrow={`Step ${step} of 2 · ${step === 1 ? 'Details' : 'Groups'}`} progress={[step, 2]} aside={preview}>
      {error && <Banner>{error}</Banner>}
      {step === 1 ? (
        <form className="ys-col" style={{ padding: 0, gap: 14 }} onSubmit={(e) => { e.preventDefault(); if (name.trim()) setStep(2); }}>
          <div className="photo-row">
            <PhotoPick url={photo?.url ?? null} onFile={(f) => void pickPhoto(f)} busy={uploading} label="Community photo" />
            <span className="photo-row__hint">Add a photo so members recognise it.<br />Square, at least 256 × 256.</span>
          </div>
          <div className="ys-field"><label className="ys-field__label" htmlFor="cm-name">Community name</label><div className="ys-field__box"><input id="cm-name" className="ys-input" value={name} maxLength={COMMUNITY_LIMITS.name} onChange={(e) => setName(e.target.value)} autoFocus /></div><span className="ys-field__hint">{name.length} / {COMMUNITY_LIMITS.name}</span></div>
          <div className="ys-field"><label className="ys-field__label" htmlFor="cm-about">Description</label><div className="ys-field__box ys-field__box--area"><textarea id="cm-about" className="ys-input" rows={4} value={about} maxLength={COMMUNITY_LIMITS.about} onChange={(e) => setAbout(e.target.value)} /></div><span className="ys-field__hint">Shown to people before they join.</span></div>
          <div className="report-box" style={{ padding: '0 16px' }}>
            <Switch on={approveNew} onChange={setApproveNew} label="Admins approve new members" hint="People with the link send a request" />
            <Switch on={membersSuggest} onChange={setMembersSuggest} label="Members can suggest groups" hint="Admins still decide what gets added" />
          </div>
          <div className="modal__actions"><OvalButton icon="close" label="Cancel" size="sm" variant="soft" onClick={onClose} /><OvalButton type="submit" icon="arrow-right" label="Next: add groups" size="sm" variant="primary" disabled={!name.trim()} /></div>
        </form>
      ) : (
        <div className="ys-col" style={{ padding: 0, gap: 12 }}>
          <span className="ys-field__label">New groups</span>
          {newGroups.map((g, i) => (
            <div key={i} className="ys-field"><div className="ys-field__box">
              <input className="ys-input" value={g} maxLength={100} aria-label={`New group ${i + 1}`} onChange={(e) => setNewGroups(newGroups.map((x, j) => (j === i ? e.target.value : x)))} />
              <button type="button" className="icon-btn" aria-label={`Remove new group ${i + 1}`} onClick={() => setNewGroups(newGroups.filter((_, j) => j !== i))}><Icon name="close" size={16} /></button>
            </div></div>
          ))}
          {newGroups.length < 10 && <button type="button" className="link-btn" style={{ alignSelf: 'flex-start' }} onClick={() => setNewGroups([...newGroups, ''])}>+ Another new group</button>}
          <span className="ys-field__label">Groups you run</span>
          {mine === null ? <span className="ys-spin" aria-label="Loading" /> : !mine.length ? <span className="muted" style={{ fontSize: 13 }}>None to bring in.</span> : mine.map((g) => (
            <label key={g.id} className="ys-row-item pick-row">
              <input type="checkbox" checked={picked.includes(g.id)} onChange={() => setPicked(picked.includes(g.id) ? picked.filter((x) => x !== g.id) : [...picked, g.id])} aria-label={g.group!.name} />
              <Avatar name={g.group!.name} photoUrl={g.group!.photoUrl} size={36} group />
              <span className="ys-row-item__text"><span className="ys-row-item__title">{g.group!.name}</span><span className="ys-row-item__sub">{plural(g.group!.memberCount, 'member')}</span></span>
            </label>
          ))}
          <div className="modal__actions"><OvalButton icon="arrow-left" label="Back" size="sm" variant="soft" onClick={() => setStep(1)} /><OvalButton icon="check" label="Create community" size="sm" variant="primary" disabled={busy} onClick={() => void create()} /></div>
        </div>
      )}
    </Modal>
  );
}

/** w23: requests, members, groups, settings and reported messages. */
function ManageCommunity({ c, onBack }: { c: CommunityInfo; onBack: () => void }) {
  const [tab, setTab] = useState<'requests' | 'members' | 'groups' | 'reports' | 'settings'>(c.pendingRequests ? 'requests' : 'members');
  const [info, setInfo] = useState(c);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const reload = async () => setInfo(await api().community(c.id));
  const run = async (fn: () => Promise<unknown>, ok?: string) => { setError(null); setNotice(null); try { await fn(); if (ok) setNotice(ok); await reload(); } catch (e) { setError(errText(e)); } };
  const tabs: Array<[typeof tab, string]> = [['requests', 'Requests'], ['members', 'Members'], ['groups', 'Groups'], ['reports', 'Reports'], ['settings', 'Settings']];
  return (
    <section className="community community--manage" aria-label={`Manage ${c.name}`}>
      <LineArt name="coins" height={240} opacity={0.08} className="manage__art" />
      <header className="manage__head">
        <OvalButton icon="arrow-left" label="Back" size="sm" variant="ghost" onClick={onBack} />
        <CommunityMark c={info} size={44} />
        <span className="manage__title"><strong>Manage {info.name}</strong><span>You’re an admin · {info.memberCount.toLocaleString()} of {info.limits.members.toLocaleString()} members</span></span>
        <div className="manage__tabs"><div className="ys-tabs" role="tablist" aria-label="Manage">
          {tabs.map(([t, l]) => <button key={t} type="button" role="tab" className="ys-tab" aria-selected={tab === t} onClick={() => setTab(t)}>{l}{t === 'requests' && info.pendingRequests > 0 && <span className="search__count">{info.pendingRequests}</span>}</button>)}
        </div></div>
      </header>
      <div className={`manage__body${tab === 'requests' ? ' manage__body--wide' : ''}`}>
        {error && <Banner>{error}</Banner>}
        {notice && <Banner tone="success">{notice}</Banner>}
        {tab === 'requests' && <div className="manage__split"><Requests c={info} run={run} /><div className="manage__side"><Reports c={info} run={run} /></div></div>}
        {tab === 'members' && <Members c={info} run={run} />}
        {tab === 'groups' && <Groups c={info} run={run} />}
        {tab === 'reports' && <Reports c={info} run={run} />}
        {tab === 'settings' && <CommunitySettings c={info} run={run} />}
      </div>
    </section>
  );
}

type Run = (fn: () => Promise<unknown>, ok?: string) => Promise<void>;

function Requests({ c, run }: { c: CommunityInfo; run: Run }) {
  const [list, setList] = useState<JoinRequest[] | null>(null);
  const load = useCallback(() => api().communityRequests(c.id).then(setList, () => setList([])), [c.id]);
  useEffect(() => { void load(); }, [load, c.pendingRequests]);
  if (!list) return <span className="ys-spin" aria-label="Loading" />;
  return (
    <section className="set-card" aria-label="Join requests">
      <div className="row" style={{ justifyContent: 'space-between', padding: '14px 18px 6px' }}>
        <h3 style={{ margin: 0, font: '700 16px var(--font-display)' }}>Join requests · {list.length}</h3>
        {list.length > 1 && <OvalButton icon="check" label="Approve all" size="sm" variant="soft" onClick={() => void run(() => api().approveCommunityRequest(c.id, 'all'), 'Everyone was let in.')} />}
      </div>
      {!list.length && <p className="muted" style={{ margin: '4px 18px 16px', fontSize: 14 }}>No one is waiting.</p>}
      {list.map((r) => (
        <div key={r.user.id} className="ys-row-item" style={{ cursor: 'default' }} data-testid="request-row">
          <Avatar name={r.user.displayName} photoUrl={r.user.photoUrl} size={40} />
          <span className="ys-row-item__text"><span className="ys-row-item__title">{r.user.displayName}</span><span className="ys-row-item__sub">{r.user.username ? `@${r.user.username} · ` : ''}asked {listTime(r.requestedAt)}</span></span>
          <button type="button" className="icon-btn" aria-label={`Decline ${r.user.displayName}`} onClick={() => void run(() => api().declineCommunityRequest(c.id, r.user.id))}><Icon name="close" size={18} /></button>
          <button type="button" className="icon-btn icon-btn--ember" aria-label={`Approve ${r.user.displayName}`} onClick={() => void run(() => api().approveCommunityRequest(c.id, r.user.id), `${r.user.displayName} joined.`)}><Icon name="check" size={18} /></button>
        </div>
      ))}
    </section>
  );
}

function Members({ c, run }: { c: CommunityInfo; run: Run }) {
  const [list, setList] = useState<CommunityMember[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const load = useCallback(async (before?: string) => { const r = await api().communityMembers(c.id, before); setList((x) => [...(before ? x ?? [] : []), ...r.items]); setNext(r.next); }, [c.id]);
  useEffect(() => { void load(); }, [load, c.memberCount]);
  if (!list) return <span className="ys-spin" aria-label="Loading" />;
  return (
    <section className="set-card" aria-label="Members">
      <h3>{plural(c.memberCount, 'member')}</h3>
      {list.map((m) => (
        <div key={m.id} className="ys-row-item member-row" style={{ cursor: 'default' }} data-testid="community-member">
          <Avatar name={m.displayName} photoUrl={m.photoUrl} size={40} />
          <span className="ys-row-item__text"><span className="ys-row-item__title">{m.displayName}</span><span className="ys-row-item__sub">{m.username ? `@${m.username}` : ''}</span></span>
          {m.owner ? <span className="ys-tag ys-tag--ember">Creator</span> : m.admin ? <span className="ys-tag ys-tag--ember">Admin</span> : null}
          {!m.owner && (
            <span className="member-row__menu">
              <button type="button" className="icon-btn" aria-label={`Options for ${m.displayName}`} onClick={() => setMenu(menu === m.id ? null : m.id)}><Icon name="more-vertical" size={18} /></button>
              {menu === m.id && (
                <span className="menu" role="menu">
                  <button type="button" role="menuitem" onClick={() => { setMenu(null); void run(() => api().setCommunityAdmin(c.id, m.id, !m.admin), m.admin ? `${m.displayName} is no longer an admin.` : `${m.displayName} is now an admin.`); }}>{m.admin ? 'Dismiss as admin' : 'Make community admin'}</button>
                  <button type="button" role="menuitem" className="danger" onClick={() => { setMenu(null); void run(() => api().removeCommunityMember(c.id, m.id), `${m.displayName} was removed from the community and its groups.`); }}>Remove from community</button>
                </span>
              )}
            </span>
          )}
        </div>
      ))}
      {next && <div className="search__more"><OvalButton icon="chevron-down" label="More" size="sm" variant="ghost" onClick={() => void load(next)} /></div>}
    </section>
  );
}

function Groups({ c, run }: { c: CommunityInfo; run: Run }) {
  return (
    <>
      {c.suggestions.length > 0 && (
        <section className="set-card" aria-label="Suggested groups">
          <h3>Suggested by members · {c.suggestions.length}</h3>
          {c.suggestions.map((s) => (
            <div key={s.group.id} className="ys-row-item" style={{ cursor: 'default' }}>
              <Avatar name={s.group.name} photoUrl={s.group.photoUrl} size={40} group />
              <span className="ys-row-item__text"><span className="ys-row-item__title">{s.group.name}</span><span className="ys-row-item__sub">From {s.by.displayName} · {plural(s.group.memberCount, 'member')}</span></span>
              <OvalButton icon="close" label="Decline" size="sm" variant="ghost" onClick={() => void run(() => api().declineSuggestion(c.id, s.group.id))} />
              <OvalButton icon="check" label="Add" size="sm" variant="soft" onClick={() => void run(() => api().approveSuggestion(c.id, s.group.id), `${s.group.name} was added.`)} />
            </div>
          ))}
        </section>
      )}
      <section className="set-card" aria-label="Groups">
        <h3>{plural(c.groupCount, 'group')} · up to {c.limits.groups}</h3>
        {c.groups.map((g) => (
          <div key={g.id} className="ys-row-item" style={{ cursor: 'default' }}>
            {g.announcements ? <span className="ys-oval ys-oval--ember" style={{ width: 40 }}><Icon name="megaphone" size={18} /></span> : <Avatar name={g.name} photoUrl={g.photoUrl} group size={40} />}
            <span className="ys-row-item__text"><span className="ys-row-item__title">{g.name}</span><span className="ys-row-item__sub">{plural(g.memberCount, 'member')}{g.announcements ? ' · everyone in the community' : ''}</span></span>
            {!g.announcements && <ConfirmButton label="Remove" icon="close" danger={false} confirm="Remove" question={`Take ${g.name} out of the community? The group stays.`} onConfirm={() => run(() => api().removeCommunityGroup(c.id, g.id), `${g.name} was taken out.`)} />}
          </div>
        ))}
      </section>
    </>
  );
}

function Reports({ c, run }: { c: CommunityInfo; run: Run }) {
  const [list, setList] = useState<CommunityReport[] | null>(null);
  const load = useCallback(() => api().communityReports(c.id).then(setList, () => setList([])), [c.id]);
  useEffect(() => { void load(); }, [load]);
  const act = (r: CommunityReport, action: 'delete' | 'remove' | 'keep', ok: string) => run(async () => { await api().moderate(c.id, r.id, action); await load(); }, ok);
  if (!list) return <span className="ys-spin" aria-label="Loading" />;
  return (
    <section className="set-card" aria-label="Reported messages">
      <h3>Reported messages · {list.length}</h3>
      {!list.length && <p className="muted" style={{ margin: '4px 18px 16px', fontSize: 14 }}>Nothing reported. When members report a message in one of the groups, it shows up here.</p>}
      {list.map((r) => (
        <div key={r.id} className="report-card" data-testid="report-card">
          <div className="report-card__head"><span className="ys-tag ys-tag--danger">{r.reason === 'scam' ? 'Scam' : r.reason === 'harassment' ? 'Harassment' : r.reason === 'spam' ? 'Spam' : 'Other'}</span>{r.chat.name} · reported by {plural(r.reports, 'person')}</div>
          <div className="row" style={{ gap: 8, alignItems: 'flex-end' }}>
            <Avatar name={r.sender?.displayName ?? '?'} photoUrl={r.sender?.photoUrl} size={28} />
            <div className="ys-bubble ys-bubble--them" style={{ maxWidth: '100%' }}><strong style={{ display: 'block', fontSize: 12 }}>{r.sender?.displayName ?? 'Someone'}</strong>{r.message ? (r.message.deleted ? <em>This message was deleted</em> : r.message.text || 'A file') : 'Recent messages in this chat'}</div>
          </div>
          <div className="row" style={{ gap: 18, flexWrap: 'wrap' }}>
            {r.message && !r.message.deleted && <OvalButton icon="trash" label="Delete for all" size="sm" variant="danger" onClick={() => void act(r, 'delete', 'The message was deleted for everyone.')} />}
            {r.sender && <OvalButton icon="logout" label="Remove member" size="sm" variant="ghost" onClick={() => void act(r, 'remove', `${r.sender!.displayName} was removed from the community.`)} />}
            <OvalButton icon="check" label="Keep" size="sm" variant="ghost" onClick={() => void act(r, 'keep', 'Kept.')} />
          </div>
        </div>
      ))}
      <p className="muted" style={{ margin: '4px 18px 16px', fontSize: 12 }}>Members aren’t told who reported them.</p>
    </section>
  );
}

function CommunitySettings({ c, run }: { c: CommunityInfo; run: Run }) {
  const [name, setName] = useState(c.name);
  const [about, setAbout] = useState(c.about);
  return (
    <>
      <section className="set-card set-card--pad" aria-label="Details">
        <div className="ys-field"><label className="ys-field__label" htmlFor="cs-name">Name</label><div className="ys-field__box"><input id="cs-name" className="ys-input" value={name} maxLength={COMMUNITY_LIMITS.name} onChange={(e) => setName(e.target.value)} /></div></div>
        <div className="ys-field"><label className="ys-field__label" htmlFor="cs-about">Description</label><div className="ys-field__box"><textarea id="cs-about" className="ys-input" value={about} maxLength={COMMUNITY_LIMITS.about} onChange={(e) => setAbout(e.target.value)} /></div></div>
        <div className="row" style={{ justifyContent: 'flex-end' }}><OvalButton icon="check" label="Save" size="sm" disabled={!name.trim() || (name === c.name && about === c.about)} onClick={() => void run(() => api().updateCommunity(c.id, { name, about }), 'Saved.')} /></div>
      </section>
      <section className="set-card" aria-label="Who can join">
        <Switch on={c.settings.approveNew} onChange={(v) => void run(() => api().updateCommunity(c.id, { approveNew: v }), 'Saved.')} label="Admins approve new members" hint="People with the link send a request" />
        <Switch on={c.settings.membersSuggest} onChange={(v) => void run(() => api().updateCommunity(c.id, { membersSuggest: v }), 'Saved.')} label="Members can suggest groups" hint="Admins still decide what gets added" />
        <div className="set-row"><span className="set-row__text"><span>Invite link</span><small>{c.inviteCode ? 'On' : 'Off'}</small></span>{c.inviteCode && <OvalButton icon="close" label="Turn off" size="sm" variant="ghost" onClick={() => void run(() => api().revokeCommunityInvite(c.id), 'The old link no longer works.')} />}</div>
      </section>
    </>
  );
}

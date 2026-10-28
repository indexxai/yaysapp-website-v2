'use client';
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ApiError, MAX_GROUP_ABOUT, MAX_GROUP_NAME, textLength, type GroupInfo, type GroupMember, type GroupSettings, type JoinRequest, type PublicProfile } from '@yays/shared';
import { Icon } from '@/lib/icons';
import { useChatState, useEngine } from '@/lib/chat';
import { Avatar, Banner, OvalButton } from './ui';
import { BlockReportDialog, MuteRow } from './contact';

const msg = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);

export function Switch({ on, onChange, label, hint, disabled }: { on: boolean; onChange: (v: boolean) => void; label: string; hint?: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={on} className="switch-row" disabled={disabled} onClick={() => onChange(!on)}>
      <span className="switch-row__text"><span>{label}</span>{hint && <small>{hint}</small>}</span>
      <span className={`switch${on ? ' switch--on' : ''}`} aria-hidden><span /></span>
    </button>
  );
}

/** A button that asks once more before doing something hard to undo. */
export function ConfirmButton({ label, confirm, question, onConfirm, icon = 'logout', danger = true }: { label: string; confirm: string; question: string; onConfirm: () => Promise<void> | void; icon?: 'logout' | 'trash' | 'close'; danger?: boolean }) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!asking) return <OvalButton icon={icon} label={label} size="sm" variant={danger ? 'danger' : 'ghost'} onClick={() => setAsking(true)} />;
  return (
    <div className="confirm" role="group" aria-label={question}>
      <span>{question}</span>
      <div className="row">
        <button type="button" className="link-btn" onClick={() => setAsking(false)}>Cancel</button>
        <button type="button" className="link-btn link-btn--danger" disabled={busy} onClick={async () => { setBusy(true); try { await onConfirm(); } finally { setBusy(false); setAsking(false); } }}>{confirm}</button>
      </div>
    </div>
  );
}

// ---------------- picking people ----------------
/** People from my direct chats, plus anyone found by exact username, phone or email. */
function PeoplePicker({ picked, setPicked, exclude = [] }: { picked: PublicProfile[]; setPicked: (p: PublicProfile[]) => void; exclude?: string[] }) {
  const engine = useEngine();
  const s = useChatState();
  const [q, setQ] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const known = useMemo(() => s.order.map((id) => s.conversations[id]).filter((c) => c?.kind === 'direct' && c.peer).map((c) => c.peer!) as PublicProfile[], [s.order, s.conversations]);
  const isPicked = (id: string) => picked.some((p) => p.id === id);
  const toggle = (p: PublicProfile) => setPicked(isPicked(p.id) ? picked.filter((x) => x.id !== p.id) : [...picked, p]);
  const filtered = known.filter((p) => !exclude.includes(p.id) && (!q.trim() || p.displayName.toLowerCase().includes(q.trim().toLowerCase().replace(/^@/, '')) || (p.username ?? '').includes(q.trim().toLowerCase().replace(/^@/, ''))));
  const find = async (e: FormEvent) => {
    e.preventDefault();
    if (!q.trim()) return;
    setBusy(true); setError(null);
    try {
      const p = await engine.lookup(q.trim());
      if (exclude.includes(p.id)) setError(`${p.displayName} is already in the group.`);
      else { if (!isPicked(p.id)) setPicked([...picked, p]); setQ(''); }
    } catch (err) { setError(msg(err, 'Search failed. Try again.')); } finally { setBusy(false); }
  };
  return (
    <div className="picker">
      {picked.length > 0 && (
        <div className="chips" aria-label="Picked">
          {picked.map((p) => <button key={p.id} type="button" className="chip" onClick={() => toggle(p)} aria-label={`Remove ${p.displayName}`}><Avatar name={p.displayName} photoUrl={p.photoUrl} size={24} />{p.displayName}<Icon name="close" size={14} /></button>)}
        </div>
      )}
      <form onSubmit={find} className="new-chat__form" style={{ padding: 0 }}>
        <div className={`ys-field ys-field--pill${error ? ' ys-field--error' : ''}`} style={{ flex: 1 }}>
          <label htmlFor="pick" className="ys-field__label">Add people</label>
          <div className="ys-field__box"><Icon name="search" size={18} />
            <input id="pick" className="ys-input" value={q} onChange={(e) => { setQ(e.target.value); setError(null); }} placeholder="Name, @username, phone or email" autoComplete="off" />
          </div>
          <span className="ys-field__hint" role={error ? 'alert' : undefined}>{error ?? 'Pick from your chats, or press Enter to find someone by username, phone or email.'}</span>
        </div>
        <OvalButton type="submit" icon="search" label="Find" size="sm" variant="soft" loading={busy} />
      </form>
      <div className="picker__list" role="group" aria-label="Your chats">
        {filtered.map((p) => (
          <label key={p.id} className="ys-row-item pick-row">
            <input type="checkbox" checked={isPicked(p.id)} onChange={() => toggle(p)} aria-label={p.displayName} />
            <Avatar name={p.displayName} photoUrl={p.photoUrl} size={40} />
            <span className="ys-row-item__text"><span className="ys-row-item__title">{p.displayName}</span><span className="ys-row-item__sub">{p.username ? `@${p.username}` : p.about}</span></span>
          </label>
        ))}
        {!filtered.length && <span className="picker__empty">{known.length ? 'No one in your chats matches.' : 'No chats yet. Find people by username, phone or email.'}</span>}
      </div>
    </div>
  );
}

// ---------------- new group (w05) ----------------
export function NewGroup({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const engine = useEngine();
  const [step, setStep] = useState<1 | 2>(1);
  const [picked, setPicked] = useState<PublicProfile[]>([]);
  const [name, setName] = useState('');
  const [about, setAbout] = useState('');
  const [adminsOnly, setAdminsOnly] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const nameLen = textLength(name.trim());
  const create = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { setError('Give the group a name.'); return; }
    setBusy(true); setError(null);
    try { const c = await engine.createGroup({ name, about: about.trim() || undefined, memberIds: picked.map((p) => p.id), adminsOnly }); onCreated(c.id); }
    catch (err) { setError(msg(err, 'Could not create the group. Try again.')); setBusy(false); }
  };
  return (
    <section aria-label="New group" className="new-chat">
      <div className="pane-head">
        <OvalButton icon="arrow-left" label="Back" size="sm" variant="ghost" onClick={step === 1 ? onClose : () => setStep(1)} />
        <div><h2>New group</h2><span className="step">Step {step} of 2</span></div>
      </div>
      {step === 1 ? (
        <div className="pane-body">
          <PeoplePicker picked={picked} setPicked={setPicked} />
          <div className="pane-foot">
            <span>{picked.length ? `${picked.length + 1} of 1,024 members` : 'Pick at least one person'}</span>
            <OvalButton icon="arrow-right" label="Next" size="md" disabled={!picked.length} onClick={() => setStep(2)} />
          </div>
        </div>
      ) : (
        <form className="pane-body" onSubmit={create}>
          <div className={`ys-field${error ? ' ys-field--error' : ''}`}>
            <label className="ys-field__label" htmlFor="gname">Group name</label>
            <div className="ys-field__box"><input id="gname" className="ys-input" value={name} autoFocus maxLength={MAX_GROUP_NAME * 2} onChange={(e) => { setName(e.target.value); setError(null); }} placeholder="Family, Team, Sunday football…" /></div>
            <span className="ys-field__hint" role={error ? 'alert' : undefined}>{error ?? `${nameLen}/${MAX_GROUP_NAME}`}</span>
          </div>
          <div className="ys-field">
            <label className="ys-field__label" htmlFor="gabout">Description (optional)</label>
            <div className="ys-field__box"><input id="gabout" className="ys-input" value={about} maxLength={MAX_GROUP_ABOUT} onChange={(e) => setAbout(e.target.value)} placeholder="What this group is for" /></div>
          </div>
          <Switch on={adminsOnly} onChange={setAdminsOnly} label="Only admins can send messages" hint="For announcements. You can change this later." />
          <div className="chips">{picked.map((p) => <span key={p.id} className="chip"><Avatar name={p.displayName} photoUrl={p.photoUrl} size={24} />{p.displayName}</span>)}</div>
          <div className="pane-foot">
            <span>{picked.length + 1} members</span>
            <OvalButton type="submit" icon="check" label="Create group" size="md" loading={busy} disabled={nameLen > MAX_GROUP_NAME} />
          </div>
        </form>
      )}
    </section>
  );
}

// ---------------- group info (w03 right panel, w24) ----------------
const PERMS: Array<{ key: keyof GroupSettings; label: string; hint: string }> = [
  { key: 'editInfo', label: 'Edit group info', hint: 'Name, photo and description' },
  { key: 'send', label: 'Send messages', hint: 'Turn off for announcement-only' },
  { key: 'addMembers', label: 'Add other members', hint: 'Otherwise only admins can' },
  { key: 'pin', label: 'Pin messages', hint: '' },
];

export function GroupInfoPanel({ id, onClose, onLeft }: { id: string; onClose: () => void; onLeft: () => void }) {
  const engine = useEngine();
  const s = useChatState();
  const g = s.groups[id];
  const c = s.conversations[id];
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [mode, setMode] = useState<'view' | 'edit' | 'add'>('view');
  const [reporting, setReporting] = useState(false);
  useEffect(() => { void engine.loadGroup(id).catch((e) => setError(msg(e, 'Could not load the group.'))); }, [engine, id]);
  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    setError(null); setNotice(null);
    try { await fn(); if (ok) setNotice(ok); } catch (e) { setError(msg(e, 'That did not work. Try again.')); }
  };
  if (!g || !c) return <aside className="info-panel" aria-label="Group info"><div className="pane-center">{error ? <Banner>{error}</Banner> : <span className="ys-spin" aria-label="Loading" />}</div></aside>;
  const me = engine.me;
  const admin = g.role === 'admin';
  const member = g.role !== 'former';
  const canEdit = member && (admin || g.settings.editInfo === 'all');
  const canAdd = member && !g.announcements && (admin || g.settings.addMembers === 'all');
  return (
    <aside className="info-panel" aria-label="Group info">
      <div className="pane-head">
        <OvalButton icon="close" label="Close" size="sm" variant="ghost" onClick={onClose} />
        <h2>Group info</h2>
      </div>
      <div className="info-panel__body">
        {error && <Banner>{error}</Banner>}
        {notice && <Banner tone="success">{notice}</Banner>}
        {mode === 'edit' ? <EditGroup g={g} onDone={(ok) => { setMode('view'); if (ok) setNotice('Saved.'); }} /> : (
          <div className="info-hero">
            <Avatar name={g.name} photoUrl={g.photoUrl} size={96} />
            <h3>{g.name}</h3>
            <span className="muted">{g.announcements ? 'Announcements' : 'Group'} · {g.memberCount} member{g.memberCount === 1 ? '' : 's'}</span>
            {g.community && <a className="link-btn" href={`/communities?id=${g.community.id}`}>Part of {g.community.name}</a>}
            {g.about && <p>{g.about}</p>}
            {canEdit && <OvalButton icon="edit" label="Edit" size="sm" variant="soft" onClick={() => setMode('edit')} />}
          </div>
        )}
        {!member && <Banner tone="info">You’re no longer in this group. You can still read what was said while you were.</Banner>}
        <section className="info-section"><MuteRow c={c} run={run} /></section>

        {mode === 'add' ? (
          <AddMembers g={g} onDone={(n) => { setMode('view'); if (n) setNotice(`Added ${n} ${n === 1 ? 'person' : 'people'}.`); }} />
        ) : canAdd && <div className="row"><OvalButton icon="person-add" label="Add members" size="sm" variant="soft" onClick={() => setMode('add')} /></div>}

        {admin && g.pendingRequests > 0 && <Requests id={id} count={g.pendingRequests} onError={setError} />}

        <section aria-label="Members" className="info-section">
          <h4>{g.memberCount} members</h4>
          <div className="ys-list">
            {g.members.map((m) => <MemberRow key={m.id} m={m} me={me} admin={admin && !g.announcements} run={run} groupId={id} />)}
          </div>
        </section>

        {(canAdd || admin) && member && <InviteAndPermissions g={g} admin={admin} canAdd={canAdd} run={run} />}

        <section className="info-section info-danger">
          <div className="row" style={{ gap: 18, flexWrap: 'wrap' }}>
            <OvalButton icon="flag" label="Report group" size="sm" variant="danger" onClick={() => setReporting(true)} />
            <ConfirmButton label="Clear chat" icon="trash" danger={false} confirm="Clear" question="Clear all messages in this group for you?" onConfirm={() => run(() => engine.clearChat(id), 'Chat cleared.')} />
          </div>
          {g.announcements && member ? <span className="muted" style={{ fontSize: 13 }}>Everyone in the community is in this group. To leave it, exit the community.</span> : member
            ? <ConfirmButton label="Leave group" confirm="Leave" question={`Leave ${g.name}?`} onConfirm={() => run(async () => { await engine.leaveGroup(id); onLeft(); })} />
            : <ConfirmButton label="Delete group" icon="trash" confirm="Delete" question="Delete this group and its messages from your chats?" onConfirm={() => run(async () => { await engine.deleteGroup(id); onLeft(); })} />}
        </section>
      </div>
      {reporting && <BlockReportDialog mode="report" c={c} onClose={() => setReporting(false)} onDone={(t) => { setReporting(false); setNotice(t); }} />}
    </aside>
  );
}

function MemberRow({ m, me, admin, run, groupId }: { m: GroupMember; me: string; admin: boolean; run: (fn: () => Promise<unknown>, ok?: string) => Promise<void>; groupId: string }) {
  const engine = useEngine();
  const [open, setOpen] = useState(false);
  const isMe = m.id === me;
  return (
    <div className="ys-row-item member-row" data-testid="member-row">
      <Avatar name={m.displayName} photoUrl={m.photoUrl} size={40} />
      <span className="ys-row-item__text">
        <span className="ys-row-item__title">{isMe ? 'You' : m.displayName}</span>
        <span className="ys-row-item__sub">{m.about || (m.username ? `@${m.username}` : '')}</span>
      </span>
      {m.owner ? <span className="ys-tag ys-tag--ember">Creator</span> : m.admin ? <span className="ys-tag ys-tag--ember">Admin</span> : null}
      {admin && !isMe && !m.owner && (
        <span className="member-row__menu">
          <button type="button" className="icon-btn" aria-label={`Options for ${m.displayName}`} aria-expanded={open} onClick={() => setOpen(!open)}><Icon name="more-vertical" size={18} /></button>
          {open && (
            <span className="menu" role="menu">
              <button type="button" role="menuitem" onClick={() => { setOpen(false); void run(() => engine.setAdmin(groupId, m.id, !m.admin), m.admin ? `${m.displayName} is no longer an admin.` : `${m.displayName} is now an admin.`); }}>{m.admin ? 'Dismiss as admin' : 'Make group admin'}</button>
              <button type="button" role="menuitem" className="danger" onClick={() => { setOpen(false); void run(() => engine.removeMember(groupId, m.id), `${m.displayName} was removed.`); }}>Remove from group</button>
            </span>
          )}
        </span>
      )}
    </div>
  );
}

function EditGroup({ g, onDone }: { g: GroupInfo; onDone: (saved: boolean) => void }) {
  const engine = useEngine();
  const [name, setName] = useState(g.name);
  const [about, setAbout] = useState(g.about);
  const [photo, setPhoto] = useState<{ key?: string | null; url: string | null }>({ url: g.photoUrl });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const pickPhoto = async (f: File | undefined) => {
    if (!f) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(f.type) || f.size > 5 * 1024 * 1024) { setError('Photos must be JPG, PNG or WebP and under 5 MB.'); return; }
    setBusy(true); setError(null);
    try { const key = await engine.uploadPhoto(f); setPhoto({ key, url: URL.createObjectURL(f) }); } catch (e) { setError(msg(e, "The photo didn't upload.")); } finally { setBusy(false); }
  };
  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const patch: { name?: string; about?: string; photoKey?: string | null } = {};
      if (name !== g.name) patch.name = name;
      if (about !== g.about) patch.about = about;
      if (photo.key !== undefined) patch.photoKey = photo.key;
      if (Object.keys(patch).length) await engine.updateGroup(g.id, patch);
      onDone(Object.keys(patch).length > 0);
    } catch (err) { setError(msg(err, 'Could not save. Try again.')); setBusy(false); }
  };
  return (
    <form className="info-edit" onSubmit={save} aria-label="Edit group">
      <div className="info-hero">
        <Avatar name={name || g.name} photoUrl={photo.url} size={96} />
        <div className="row center">
          <OvalButton icon="camera" label={photo.url ? 'Change photo' : 'Add photo'} size="sm" variant="soft" onClick={() => file.current?.click()} disabled={busy} />
          {photo.url && <OvalButton icon="trash" label="Remove photo" size="sm" variant="ghost" onClick={() => setPhoto({ key: null, url: null })} />}
        </div>
        <input ref={file} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => void pickPhoto(e.target.files?.[0])} aria-label="Group photo" />
      </div>
      <div className={`ys-field${error ? ' ys-field--error' : ''}`}>
        <label className="ys-field__label" htmlFor="ename">Group name</label>
        <div className="ys-field__box"><input id="ename" className="ys-input" value={name} onChange={(e) => setName(e.target.value)} /></div>
        <span className="ys-field__hint" role={error ? 'alert' : undefined}>{error ?? `${textLength(name.trim())}/${MAX_GROUP_NAME}`}</span>
      </div>
      <div className="ys-field">
        <label className="ys-field__label" htmlFor="eabout">Description</label>
        <div className="ys-field__box"><input id="eabout" className="ys-input" value={about} maxLength={MAX_GROUP_ABOUT} onChange={(e) => setAbout(e.target.value)} /></div>
      </div>
      <div className="row center">
        <OvalButton icon="close" label="Cancel" size="sm" variant="ghost" onClick={() => onDone(false)} />
        <OvalButton type="submit" icon="check" label="Save" size="sm" loading={busy} />
      </div>
    </form>
  );
}

function AddMembers({ g, onDone }: { g: GroupInfo; onDone: (added: number) => void }) {
  const engine = useEngine();
  const [picked, setPicked] = useState<PublicProfile[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <section className="info-section" aria-label="Add members">
      <h4>Add members</h4>
      {error && <Banner>{error}</Banner>}
      <PeoplePicker picked={picked} setPicked={setPicked} exclude={g.members.map((m) => m.id)} />
      <div className="row center">
        <OvalButton icon="close" label="Cancel" size="sm" variant="ghost" onClick={() => onDone(0)} />
        <OvalButton icon="person-add" label="Add" size="sm" loading={busy} disabled={!picked.length}
          onClick={async () => { setBusy(true); setError(null); try { await engine.addMembers(g.id, picked.map((p) => p.id)); onDone(picked.length); } catch (e) { setError(msg(e, 'Could not add them.')); setBusy(false); } }} />
      </div>
    </section>
  );
}

function Requests({ id, count, onError }: { id: string; count: number; onError: (e: string) => void }) {
  const engine = useEngine();
  const [list, setList] = useState<JoinRequest[] | null>(null);
  const load = () => engine.joinRequests(id).then(setList, (e) => onError(msg(e, 'Could not load requests.')));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, [count]);
  return (
    <section className="info-section" aria-label="Requests to join">
      <h4>Requests to join ({count})</h4>
      <div className="ys-list">
        {list?.map((r) => (
          <div key={r.user.id} className="ys-row-item" data-testid="request-row">
            <Avatar name={r.user.displayName} photoUrl={r.user.photoUrl} size={40} />
            <span className="ys-row-item__text"><span className="ys-row-item__title">{r.user.displayName}</span><span className="ys-row-item__sub">{r.user.username ? `@${r.user.username}` : ''}</span></span>
            <button type="button" className="link-btn" onClick={() => void engine.rejectRequest(id, r.user.id).then(load, (e) => onError(msg(e, 'That did not work.')))}>Decline</button>
            <button type="button" className="link-btn link-btn--strong" onClick={() => void engine.approveRequest(id, r.user.id).then(load, (e) => onError(msg(e, 'That did not work.')))}>Approve</button>
          </div>
        ))}
      </div>
    </section>
  );
}

function InviteAndPermissions({ g, admin, canAdd, run }: { g: GroupInfo; admin: boolean; canAdd: boolean; run: (fn: () => Promise<unknown>, ok?: string) => Promise<void> }) {
  const engine = useEngine();
  const [copied, setCopied] = useState(false);
  const link = g.inviteCode ? `${typeof window !== 'undefined' ? window.location.origin : ''}/join/${g.inviteCode}` : null;
  const perm = (k: keyof GroupSettings) => g.settings[k] === 'all';
  return (
    <section className="info-section" aria-label="Invite and permissions">
      <h4>Invite and permissions</h4>
      {canAdd && (
        <div className="invite">
          {link ? (
            <>
              <span className="invite__link" data-testid="invite-link">{link}</span>
              <div className="row">
                <OvalButton icon="copy" label={copied ? 'Copied' : 'Copy link'} size="sm" variant="soft" onClick={() => { void navigator.clipboard?.writeText(link).catch(() => undefined); setCopied(true); setTimeout(() => setCopied(false), 2000); }} />
                <OvalButton icon="refresh" label="Reset link" size="sm" variant="ghost" onClick={() => void run(() => engine.resetInvite(g.id), 'The old link no longer works.')} />
                <OvalButton icon="slash" label="Turn off" size="sm" variant="ghost" onClick={() => void run(() => engine.revokeInvite(g.id), 'The invite link is off.')} />
              </div>
            </>
          ) : <OvalButton icon="link" label="Create invite link" size="sm" variant="soft" onClick={() => void run(() => engine.resetInvite(g.id))} />}
        </div>
      )}
      {admin && (
        <>
          <h5>Members can</h5>
          {PERMS.map((p) => <Switch key={p.key} label={p.label} hint={p.hint} on={perm(p.key)} onChange={(v) => void run(() => engine.setGroupSettings(g.id, { [p.key]: v ? 'all' : 'admins' }))} />)}
          <h5>Admins</h5>
          <Switch label="Approve new members" hint="People who open the invite link wait for an admin" on={g.settings.approveNew} onChange={(v) => void run(() => engine.setGroupSettings(g.id, { approveNew: v }))} />
        </>
      )}
    </section>
  );
}

/** Small label used in headers: "Ali, Sara and you". */
export function memberLine(g: GroupInfo | undefined, me: string, fallback: ReactNode) {
  if (!g) return fallback;
  const names = g.members.filter((m) => m.id !== me).map((m) => m.displayName.split(' ')[0]);
  const shown = names.slice(0, 5);
  return [...shown, ...(names.length > 5 ? [`${names.length - 5} more`] : []), ...(g.role === 'former' ? [] : ['You'])].join(', ');
}

'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ApiError, USERNAME_RE, type MeProfile } from '@yays/shared';
import { api } from '@/lib/api';
import { Avatar, Banner, Field, OvalButton } from './ui';
import { Icon } from '@/lib/icons';

const TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export function ProfileForm({ me, submitLabel, onSaved, layout = 'setup' }: { me: MeProfile; submitLabel: string; onSaved: (m: MeProfile) => void; layout?: 'setup' | 'settings' }) {
  // A name made up from the email is a placeholder, not the person's choice: start empty.
  const [name, setName] = useState(me.pending.includes('profile') ? '' : me.displayName);
  const [username, setUsername] = useState(me.username ?? '');
  const [about, setAbout] = useState(me.about);
  const [photo, setPhoto] = useState<{ key: string | null; url: string | null }>({ key: null, url: me.photoUrl });
  const [uname, setUname] = useState<{ state: 'idle' | 'checking' | 'ok' | 'bad'; msg?: string }>({ state: 'idle' });
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErr, setFieldErr] = useState<Record<string, string>>({});
  const file = useRef<HTMLInputElement>(null);

  // Check the username a moment after typing stops; ignore answers for older text.
  useEffect(() => {
    const u = username.trim().toLowerCase();
    if (!u || u === me.username) { setUname({ state: 'idle' }); return; }
    if (!USERNAME_RE.test(u)) { setUname({ state: 'bad', msg: 'Use 3–30 letters, numbers, dots or underscores.' }); return; }
    setUname({ state: 'checking' });
    let live = true;
    const t = setTimeout(async () => {
      try { const r = await api().checkUsername(u); if (live) setUname(r.available ? { state: 'ok', msg: `@${u} is available.` } : { state: 'bad', msg: r.reason }); }
      catch { if (live) setUname({ state: 'idle' }); }
    }, 400);
    return () => { live = false; clearTimeout(t); };
  }, [username, me.username]);

  const pick = async (f: File | undefined) => {
    if (!f) return;
    setError(null);
    if (!TYPES.includes(f.type)) { setError('Photos must be JPG, PNG or WebP.'); return; }
    if (f.size > 5 * 1024 * 1024) { setError('That photo is larger than 5 MB.'); return; }
    setUploading(true);
    try {
      const t = await api().request<{ key: string; uploadUrl: string; headers: Record<string, string> }>('POST', '/v1/media/upload-url', { purpose: 'avatar', contentType: f.type, size: f.size });
      const r = await fetch(t.uploadUrl, { method: 'PUT', headers: t.headers, body: f });
      if (!r.ok) throw new Error('upload failed');
      setPhoto({ key: t.key, url: URL.createObjectURL(f) });
    } catch { setError("The photo didn't upload. Check your connection and try again."); }
    finally { setUploading(false); if (file.current) file.current.value = ''; }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const fe: Record<string, string> = {};
    if (!name.trim()) fe.name = 'Your name is needed.';
    if (uname.state === 'bad') fe.username = uname.msg ?? 'Choose another username.';
    setFieldErr(fe);
    if (Object.keys(fe).length) return;
    setBusy(true); setError(null);
    try {
      const patch: Parameters<ReturnType<typeof api>['updateMe']>[0] = { displayName: name, about };
      if (username.trim() && username.trim().toLowerCase() !== me.username) patch.username = username.trim().toLowerCase();
      if (photo.key) patch.photoKey = photo.key;
      onSaved(await api().updateMe(patch));
    } catch (err) {
      const fields = err instanceof ApiError ? (err.details?.fields as Record<string, string> | undefined) : undefined;
      if (fields?.username) setFieldErr({ username: fields.username });
      else setError(err instanceof ApiError ? err.message : 'Could not save. Try again.');
    } finally { setBusy(false); }
  };

  const removePhoto = async () => { setPhoto({ key: null, url: null }); try { onSaved(await api().updateMe({ photoKey: null })); } catch { /* shown on next save */ } };
  if (layout === 'settings') {
    const discard = () => { setName(me.displayName); setUsername(me.username ?? ''); setAbout(me.about); setPhoto({ key: null, url: me.photoUrl }); setFieldErr({}); setError(null); };
    return (
      <form onSubmit={submit} className="profile-side" noValidate>
        <input ref={file} type="file" accept={TYPES.join(',')} hidden onChange={(e) => pick(e.target.files?.[0])} data-testid="photo-input" />
        <div className="profile-side__photo">
          <button type="button" className="profile-photo" aria-label={photo.url ? 'Change photo' : 'Add photo'} onClick={() => file.current?.click()} disabled={uploading}>
            <Avatar name={name || me.displayName} photoUrl={photo.url} size={116} />
            <span className="profile-photo__badge">{uploading ? <span className="ys-spin" aria-hidden /> : <Icon name="camera" size={16} />}</span>
          </button>
          {photo.url && <button type="button" className="link-btn link-btn--danger" style={{ fontSize: 13 }} onClick={() => void removePhoto()}>Remove photo</button>}
        </div>
        <div className="profile-side__fields">
          {error && <Banner>{error}</Banner>}
          <Field id="name" label="Name" hint="Shown to people you chat with." error={fieldErr.name}>
            <input id="name" className="ys-input" autoComplete="name" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field id="username" label="Username" error={fieldErr.username ?? (uname.state === 'bad' ? uname.msg : null)} hint={uname.state === 'ok' ? uname.msg : uname.state === 'checking' ? 'Checking…' : 'People can find you by it without your number.'}>
            <span style={{ fontWeight: 700 }}>@</span>
            <input id="username" className="ys-input" autoComplete="username" maxLength={30} value={username} onChange={(e) => setUsername(e.target.value.toLowerCase())} />
            {(uname.state === 'ok' || (username && username === me.username)) && <span style={{ color: 'var(--success-ink)', display: 'inline-flex' }}><Icon name="check" size={16} /></span>}
          </Field>
          <Field id="about" label="About">
            <input id="about" className="ys-input" maxLength={80} value={about} onChange={(e) => setAbout(e.target.value)} placeholder="Say something about yourself" />
            <span className="field-count">{about.length}/80</span>
          </Field>
          <div className="profile-side__actions">
            <OvalButton icon="close" label="Discard" size="sm" variant="soft" onClick={discard} />
            <OvalButton type="submit" icon="check" label={submitLabel} size="sm" loading={busy} disabled={uploading} />
          </div>
        </div>
      </form>
    );
  }
  return (
    <form onSubmit={submit} className="ys-col" style={{ padding: 0, gap: 20 }} noValidate>
      {error && <Banner>{error}</Banner>}
      <div className="row">
        <Avatar name={name || me.displayName} photoUrl={photo.url} size={96} />
        <input ref={file} type="file" accept={TYPES.join(',')} hidden onChange={(e) => pick(e.target.files?.[0])} data-testid="photo-input" />
        <OvalButton icon="camera" label={photo.url ? 'Change photo' : 'Add photo'} size="md" variant="soft" loading={uploading} onClick={() => file.current?.click()} />
        {photo.url && <OvalButton icon="trash" label="Remove" size="md" variant="ghost" onClick={() => void removePhoto()} />}
      </div>
      <Field id="name" label="Your name" hint="This is how friends see you in chats." error={fieldErr.name}>
        <input id="name" className="ys-input" autoComplete="name" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field id="username" label="Username (optional)" error={fieldErr.username ?? (uname.state === 'bad' ? uname.msg : null)} hint={uname.state === 'ok' ? uname.msg : uname.state === 'checking' ? 'Checking…' : 'People can find you by it without your number.'}>
        <span style={{ fontWeight: 700 }}>@</span>
        <input id="username" className="ys-input" autoComplete="username" maxLength={30} value={username} onChange={(e) => setUsername(e.target.value.toLowerCase())} />
      </Field>
      <Field id="about" label="About (optional)" hint={`${about.length}/80`}>
        <input id="about" className="ys-input" maxLength={80} value={about} onChange={(e) => setAbout(e.target.value)} />
      </Field>
      <div className="row center"><OvalButton type="submit" icon="arrow-right" label={submitLabel} size="lg" loading={busy} disabled={uploading} /></div>
    </form>
  );
}

import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import ImagePicker from 'react-native-image-crop-picker';
import { ApiError, USERNAME_RE, type MeProfile } from '@yays/shared';
import { api } from '../lib/api';
import { Avatar, Banner, Field, OvalButton } from '../ui/kit';

export function ProfileForm({ me, submitLabel, onSaved }: { me: MeProfile; submitLabel: string; onSaved: (m: MeProfile) => void }) {
  const [name, setName] = useState(me.pending.includes('profile') ? '' : me.displayName);
  const [username, setUsername] = useState(me.username ?? '');
  const [about, setAbout] = useState(me.about);
  const [photo, setPhoto] = useState<{ key: string | null; url: string | null }>({ key: null, url: me.photoUrl });
  const [uname, setUname] = useState<{ state: 'idle' | 'checking' | 'ok' | 'bad'; msg?: string }>({ state: 'idle' });
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErr, setFieldErr] = useState<Record<string, string>>({});

  useEffect(() => {
    const u = username.trim().toLowerCase();
    if (!u || u === me.username) { setUname({ state: 'idle' }); return; }
    if (!USERNAME_RE.test(u)) { setUname({ state: 'bad', msg: 'Use 3–30 letters, numbers, dots or underscores.' }); return; }
    setUname({ state: 'checking' });
    let live = true;
    const id = setTimeout(async () => {
      try { const r = await (await api()).checkUsername(u); if (live) setUname(r.available ? { state: 'ok', msg: `@${u} is available.` } : { state: 'bad', msg: r.reason }); }
      catch { if (live) setUname({ state: 'idle' }); }
    }, 400);
    return () => { live = false; clearTimeout(id); };
  }, [username, me.username]);

  const pick = async () => {
    setError(null);
    let img;
    try { img = await ImagePicker.openPicker({ width: 512, height: 512, cropping: true, cropperCircleOverlay: true, mediaType: 'photo', forceJpg: true, compressImageQuality: 0.85 }); }
    catch (e) { if ((e as { code?: string }).code !== 'E_PICKER_CANCELLED') setError('Could not open your photos. Allow access in Settings.'); return; }
    if (img.size > 5 * 1024 * 1024) { setError('That photo is larger than 5 MB.'); return; }
    setUploading(true);
    try {
      const c = await api();
      const t = await c.request<{ key: string; uploadUrl: string; headers: Record<string, string> }>('POST', '/v1/media/upload-url', { purpose: 'avatar', contentType: 'image/jpeg', size: img.size });
      const blob = await (await fetch(img.path)).blob();
      const r = await fetch(t.uploadUrl, { method: 'PUT', headers: t.headers, body: blob });
      if (!r.ok) throw new Error('upload failed');
      setPhoto({ key: t.key, url: img.path });
    } catch { setError("The photo didn't upload. Check your connection and try again."); }
    finally { setUploading(false); }
  };

  const save = async () => {
    const fe: Record<string, string> = {};
    if (!name.trim()) fe.name = 'Your name is needed.';
    if (uname.state === 'bad') fe.username = uname.msg ?? 'Choose another username.';
    setFieldErr(fe);
    if (Object.keys(fe).length) return;
    setBusy(true); setError(null);
    try {
      const patch: { displayName: string; about: string; username?: string; photoKey?: string } = { displayName: name, about };
      if (username.trim() && username.trim().toLowerCase() !== me.username) patch.username = username.trim().toLowerCase();
      if (photo.key) patch.photoKey = photo.key;
      onSaved(await (await api()).updateMe(patch));
    } catch (e) {
      const f = e instanceof ApiError ? (e.details?.fields as Record<string, string> | undefined) : undefined;
      if (f?.username) setFieldErr({ username: f.username }); else setError(e instanceof ApiError ? e.message : 'Could not save. Try again.');
    } finally { setBusy(false); }
  };

  return (
    <View style={{ gap: 20 }}>
      {error ? <Banner>{error}</Banner> : null}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 20 }}>
        <Avatar name={name || me.displayName} photoUrl={photo.url} size={96} />
        <OvalButton icon="camera" label={photo.url ? 'Change photo' : 'Add photo'} variant="soft" loading={uploading} onPress={pick} />
      </View>
      <Field label="Your name" hint="This is how friends see you in chats." error={fieldErr.name} value={name} onChangeText={setName} maxLength={60} textContentType="name" />
      <Field label="Username (optional)" prefix="@" value={username} onChangeText={(v) => setUsername(v.toLowerCase())} autoCapitalize="none" autoCorrect={false} maxLength={30}
        error={fieldErr.username ?? (uname.state === 'bad' ? uname.msg : null)} hint={uname.state === 'ok' ? uname.msg : uname.state === 'checking' ? 'Checking…' : 'People can find you by it without your number.'} />
      <Field label="About (optional)" hint={`${about.length}/80`} value={about} onChangeText={setAbout} maxLength={80} />
      <View style={{ alignItems: 'center' }}><OvalButton icon="arrow-right" label={submitLabel} size="lg" loading={busy} disabled={uploading} onPress={save} /></View>
    </View>
  );
}

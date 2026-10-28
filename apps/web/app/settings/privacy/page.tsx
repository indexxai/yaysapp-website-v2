'use client';
import { useEffect, useState } from 'react';
import { ApiError, type Audience, type MeProfile, type PrivacySettings, type PublicProfile } from '@yays/shared';
import { api } from '@/lib/api';
import { Switch } from '@/components/group';
import { Card, SetRow, SettingsFrame, useSaved } from '@/components/settings';
import { Avatar, OvalButton } from '@/components/ui';

const AUDIENCE: Array<[Audience, string]> = [['everyone', 'Everyone'], ['contacts', 'People I chat with'], ['nobody', 'Nobody']];

export default function PrivacySettingsPage() {
  return <SettingsFrame>{(me, setMe) => <Privacy me={me} setMe={setMe} />}</SettingsFrame>;
}

function Privacy({ me, setMe }: { me: MeProfile; setMe: (m: MeProfile) => void }) {
  const saved = useSaved();
  const [blocked, setBlocked] = useState<PublicProfile[] | null>(null);
  const p = me.privacy;
  useEffect(() => { void api().blocked().then(setBlocked, () => setBlocked([])); }, []);
  const set = async (v: Partial<PrivacySettings>) => {
    const before = me;
    setMe({ ...me, privacy: { ...p, ...v } }); // show it right away
    try { setMe(await api().setPrivacy(v)); saved.ok(); } catch (e) { setMe(before); saved.fail(e instanceof ApiError ? e.message : 'Could not save. Try again.'); }
  };
  const unblock = async (u: PublicProfile) => {
    try { await api().unblock(u.id); setBlocked((b) => b?.filter((x) => x.id !== u.id) ?? null); saved.ok(`${u.displayName} is unblocked.`); }
    catch (e) { saved.fail(e instanceof ApiError ? e.message : 'Could not unblock.'); }
  };
  return (
    <>
      {saved.banner}
      <Card title="Who can see my last seen and online">
        <fieldset className="radio-list" style={{ border: 0, margin: 0 }}>
          <legend className="sr-only">Last seen and online</legend>
          {AUDIENCE.map(([v, l]) => <label key={v}><input type="radio" name="lastSeen" checked={p.lastSeen === v} onChange={() => void set({ lastSeen: v })} />{l}</label>)}
          <p>If you don’t share your last seen, you won’t see other people’s.</p>
        </fieldset>
      </Card>
      <Card label="Profile and groups">
        <SetRow label="Profile photo" htmlFor="pv-photo">
          <select id="pv-photo" className="mini-select" value={p.photo} onChange={(e) => void set({ photo: e.target.value as Audience })}>{AUDIENCE.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        </SetRow>
        <SetRow label="About" htmlFor="pv-about">
          <select id="pv-about" className="mini-select" value={p.about} onChange={(e) => void set({ about: e.target.value as Audience })}>{AUDIENCE.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        </SetRow>
        <SetRow label="Who can add me to groups" hint="Others can still send you an invite link." htmlFor="pv-groups">
          <select id="pv-groups" className="mini-select" value={p.groups} onChange={(e) => void set({ groups: e.target.value as 'everyone' | 'contacts' })}>
            <option value="everyone">Everyone</option><option value="contacts">People I chat with</option>
          </select>
        </SetRow>
        <Switch on={p.readReceipts} onChange={(v) => void set({ readReceipts: v })} label="Read receipts" hint="Turning off also hides others’ receipts from you. Groups always show them." />
      </Card>
      <Card title="Calls">
        <Switch on={p.silenceUnknown} onChange={(v) => void set({ silenceUnknown: v })} label="Silence unknown callers" hint="Calls from people you haven’t chatted with won’t ring. They still show in your call history." />
      </Card>
      <Card title={`Blocked${blocked?.length ? ` · ${blocked.length}` : ''}`}>
        {blocked === null ? <span className="ys-spin" style={{ margin: 18 }} aria-label="Loading" /> : !blocked.length
          ? <p className="muted" style={{ margin: '4px 18px 16px', fontSize: 14 }}>You haven’t blocked anyone. Block someone from their contact info in a chat.</p>
          : blocked.map((u) => (
            <div key={u.id} className="ys-row-item" style={{ cursor: 'default' }} data-testid="blocked-row">
              <Avatar name={u.displayName} photoUrl={u.photoUrl} size={36} />
              <span className="ys-row-item__text"><span className="ys-row-item__title">{u.displayName}</span><span className="ys-row-item__sub">{u.username ? `@${u.username}` : ''}</span></span>
              <OvalButton icon="lock" label="Unblock" size="sm" variant="soft" aria-label={`Unblock ${u.displayName}`} onClick={() => void unblock(u)} />
            </div>
          ))}
      </Card>
    </>
  );
}

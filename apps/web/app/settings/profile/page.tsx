'use client';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { ApiError, normalizePhone, pinSchema, type CodeSent, type MeProfile } from '@yays/shared';
import { api } from '@/lib/api';
import { disablePush } from '@/lib/push';
import { Modal } from '@/components/message-actions';
import { ProfileForm } from '@/components/profile-form';
import { Card, SetRow, SettingsFrame, useSaved } from '@/components/settings';
import { Banner, Field, OvalButton } from '@/components/ui';
import { Icon } from '@/lib/icons';
import { SocialChips } from '@/components/socials';
import { useLoad } from '@/lib/phase2';

const errText = (e: unknown, f = 'That did not work. Try again.') => (e instanceof ApiError ? e.message : f);

export default function ProfileSettings() {
  return <SettingsFrame>{(me, setMe) => <Profile me={me} setMe={setMe} />}</SettingsFrame>;
}

function Profile({ me, setMe }: { me: MeProfile; setMe: (m: MeProfile) => void }) {
  const saved = useSaved();
  const [dialog, setDialog] = useState<'pin' | 'pin-off' | 'delete' | 'phone' | null>(null);
  const [exporting, setExporting] = useState(false);
  const download = async () => {
    setExporting(true);
    try {
      const data = await api().exportData();
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
      const a = Object.assign(document.createElement('a'), { href: url, download: `yaysapp-data-${new Date().toISOString().slice(0, 10)}.json` });
      a.click(); setTimeout(() => URL.revokeObjectURL(url), 2000);
      saved.ok('Your data was downloaded.');
    } catch (e) { saved.fail(errText(e)); } finally { setExporting(false); }
  };
  return (
    <>
      {saved.banner}
      <section className="set-card set-card--pad" aria-label="Profile">
        <ProfileForm key={me.username ?? ''} me={me} submitLabel="Save" layout="settings" onSaved={(m) => { setMe(m); saved.ok(); }} />
      </section>
      <ProfileSocials />
      <Card title="Account">
        <SetRow label="Phone number" hint="Used to sign in. Others never see it.">
          <span className="set-row__value">{me.phone ?? 'None'}</span>
          <OvalButton icon="edit" label={me.phone ? 'Change' : 'Add'} size="sm" variant="ghost" onClick={() => setDialog('phone')} />
        </SetRow>
        <SetRow label="Email" hint="For sign-in codes and recovery."><span className="set-row__value">{me.email ?? 'None'}</span></SetRow>
        <SetRow label="Two-step verification" hint="A PIN is asked after the code whenever you sign in.">
          <span className="set-row__value">{me.twoStep ? 'On' : 'Off'}</span>
          {me.twoStep
            ? <><OvalButton icon="key" label="Change PIN" size="sm" variant="ghost" onClick={() => setDialog('pin')} /><OvalButton icon="close" label="Turn off" size="sm" variant="ghost" onClick={() => setDialog('pin-off')} /></>
            : <OvalButton icon="lock" label="Turn on" size="sm" variant="soft" onClick={() => setDialog('pin')} />}
        </SetRow>
        <SetRow label="Your data" hint="Your profile, chats and the messages you sent, as a file.">
          <OvalButton icon="download" label="Download" size="sm" variant="ghost" loading={exporting} onClick={() => void download()} />
        </SetRow>
      </Card>
      <div className="row center"><OvalButton icon="trash" label="Delete account" size="sm" variant="danger" onClick={() => setDialog('delete')} /></div>
      {dialog === 'pin' && <PinDialog me={me} onClose={() => setDialog(null)} onDone={(m) => { setMe(m); setDialog(null); saved.ok(me.twoStep ? 'Your PIN was changed.' : 'Two-step verification is on.'); }} />}
      {dialog === 'pin-off' && <PinOffDialog onClose={() => setDialog(null)} onDone={(m) => { setMe(m); setDialog(null); saved.ok('Two-step verification is off.'); }} />}
      {dialog === 'phone' && <PhoneDialog onClose={() => setDialog(null)} onDone={(m) => { setMe(m); setDialog(null); saved.ok('Your number was changed.'); }} />}
      {dialog === 'delete' && <DeleteDialog me={me} onClose={() => setDialog(null)} />}
    </>
  );
}

/** p34: your socials as others see them, with a preview as a contact or as anyone else. */
function ProfileSocials() {
  const v = useLoad(() => api().socials());
  const [as, setAs] = useState<'contact' | 'anyone'>('contact');
  const d = v.data;
  if (!d) return null;
  const shown = d.visibility === 'everyone' || (d.visibility === 'contacts' && as === 'contact');
  return (
    <Card title="Socials">
      <div style={{ padding: '0 18px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {d.links.length ? <SocialChips links={d.links} /> : <span className="muted">No socials yet. Link Facebook or add a username to show them on your profile.</span>}
        <span className="muted p2-small">{d.visibility === 'everyone' ? 'Anyone who opens your profile sees these.' : d.visibility === 'contacts' ? 'Your contacts see these. Others see your name and photo only.' : 'Hidden from everyone. Only you see them here.'}</span>
        {!!d.links.length && (
          <>
            <div className="ys-tabs" role="radiogroup" aria-label="See your profile as" style={{ alignSelf: 'flex-start' }}>
              {(['contact', 'anyone'] as const).map((x) => <button key={x} type="button" role="radio" className="ys-tab" aria-checked={as === x} aria-selected={as === x} onClick={() => setAs(x)}>{x === 'contact' ? 'A contact' : 'Anyone else'}</button>)}
            </div>
            <span className="p2-small" data-testid="socials-preview">{shown ? `${as === 'contact' ? 'A contact' : 'Anyone else'} sees all ${d.links.length} of your socials.` : `${as === 'contact' ? 'A contact' : 'Anyone else'} sees your name and photo only.`}</span>
          </>
        )}
        <div><OvalButton icon="edit" label="Manage" size="sm" variant="soft" href="/settings/socials" /></div>
      </div>
    </Card>
  );
}

/** Choose a PIN, then type it again (m32). Changing it asks for the current one first. */
function PinDialog({ me, onClose, onDone }: { me: MeProfile; onClose: () => void; onDone: (m: MeProfile) => void }) {
  const [current, setCurrent] = useState('');
  const [pin, setPin] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const digits = (v: string) => v.replace(/\D/g, '').slice(0, 6);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const p = pinSchema.safeParse(pin);
    if (!p.success) { setError(p.error.issues[0].message); return; }
    if (pin !== again) { setError('The PINs don’t match. Try again.'); setAgain(''); return; }
    setBusy(true); setError(null);
    try { onDone(await api().setPin(pin, me.twoStep ? current : undefined)); } catch (err) { setError(errText(err)); setBusy(false); }
  };
  return (
    <Modal title={me.twoStep ? 'Change your PIN' : 'Two-step verification'} onClose={onClose}>
      <form onSubmit={submit} className="ys-col" style={{ padding: 0, gap: 14 }}>
        <p className="muted" style={{ margin: 0, fontSize: 14, lineHeight: '20px' }}>You’ll be asked for this 6-digit PIN after the code whenever you sign in. If you forget it, we send a code to your other address to reset it.</p>
        {error && <Banner>{error}</Banner>}
        {me.twoStep && <Field id="cur-pin" label="Current PIN"><input id="cur-pin" className="ys-input pin-input" type="password" inputMode="numeric" value={current} onChange={(e) => setCurrent(digits(e.target.value))} autoFocus /></Field>}
        <Field id="new-pin" label={me.twoStep ? 'New PIN' : 'PIN'}><input id="new-pin" className="ys-input pin-input" type="password" inputMode="numeric" value={pin} onChange={(e) => setPin(digits(e.target.value))} autoFocus={!me.twoStep} /></Field>
        <Field id="pin-again" label="Type it again"><input id="pin-again" className="ys-input pin-input" type="password" inputMode="numeric" value={again} onChange={(e) => setAgain(digits(e.target.value))} /></Field>
        <div className="modal__actions">
          <OvalButton icon="close" label="Cancel" size="sm" variant="soft" onClick={onClose} />
          <OvalButton type="submit" icon="lock" label={me.twoStep ? 'Change PIN' : 'Turn on'} size="sm" variant="primary" disabled={busy || pin.length !== 6 || again.length !== 6 || (me.twoStep && current.length !== 6)} />
        </div>
      </form>
    </Modal>
  );
}

function PinOffDialog({ onClose, onDone }: { onClose: () => void; onDone: (m: MeProfile) => void }) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Modal title="Turn off two-step verification?" onClose={onClose}>
      <form className="ys-col" style={{ padding: 0, gap: 14 }} onSubmit={async (e) => { e.preventDefault(); setBusy(true); setError(null); try { onDone(await api().removePin(pin)); } catch (err) { setError(errText(err)); setBusy(false); } }}>
        {error && <Banner>{error}</Banner>}
        <Field id="off-pin" label="Your PIN"><input id="off-pin" className="ys-input pin-input" type="password" inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))} autoFocus /></Field>
        <div className="modal__actions">
          <OvalButton icon="close" label="Cancel" size="sm" variant="soft" onClick={onClose} />
          <OvalButton type="submit" icon="lock" label="Turn off" size="sm" variant="danger" disabled={busy || pin.length !== 6} />
        </div>
      </form>
    </Modal>
  );
}

/** A new number gets a code first; chats and groups stay with the account. */
function PhoneDialog({ onClose, onDone }: { onClose: () => void; onDone: (m: MeProfile) => void }) {
  const [raw, setRaw] = useState('');
  const [phone, setPhone] = useState<string | null>(null);
  const [sent, setSent] = useState<CodeSent | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<void>) => { setBusy(true); setError(null); try { await fn(); } catch (e) { setError(errText(e)); } finally { setBusy(false); } };
  return (
    <Modal title="Change number" onClose={onClose}>
      {error && <Banner>{error}</Banner>}
      {!sent ? (
        <form className="ys-col" style={{ padding: 0, gap: 14 }} onSubmit={(e) => { e.preventDefault(); const p = normalizePhone(raw); if (!p) { setError('Enter a mobile number, for example 0300 1234567 or +44 7700 900123.'); return; } void run(async () => { setSent(await api().startAddPhone(p)); setPhone(p); }); }}>
          <p className="muted" style={{ margin: 0, fontSize: 14 }}>Your chats, groups and contacts stay with your account. You’ll sign in with the new number from now on.</p>
          <Field id="new-phone" label="New phone number"><input id="new-phone" className="ys-input" type="tel" inputMode="tel" value={raw} onChange={(e) => setRaw(e.target.value)} placeholder="0300 1234567" autoFocus /></Field>
          <div className="modal__actions"><OvalButton icon="close" label="Cancel" size="sm" variant="soft" onClick={onClose} /><OvalButton type="submit" icon="send" label="Send code" size="sm" variant="primary" disabled={busy} /></div>
        </form>
      ) : (
        <form className="ys-col" style={{ padding: 0, gap: 14 }} onSubmit={(e) => { e.preventDefault(); void run(async () => onDone(await api().verifyAddPhone(phone!, code))); }}>
          <p className="muted" style={{ margin: 0, fontSize: 14 }}>We sent a 6-digit code to <strong>{sent.sentTo}</strong>.</p>
          <Field id="phone-code" label="Code"><input id="phone-code" className="ys-input code-input" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} autoFocus /></Field>
          <div className="modal__actions"><OvalButton icon="close" label="Cancel" size="sm" variant="soft" onClick={onClose} /><OvalButton type="submit" icon="check" label="Change number" size="sm" variant="primary" disabled={busy || code.length !== 6} /></div>
        </form>
      )}
    </Modal>
  );
}

const REASONS = ['I have another account', 'I don’t use YaysApp any more', 'Privacy worries', 'Too many messages or groups', 'Something else'];

/** m33: what goes, a code to confirm, and an optional reason. */
function DeleteDialog({ me, onClose }: { me: MeProfile; onClose: () => void }) {
  const router = useRouter();
  const [sent, setSent] = useState<CodeSent | null>(null);
  const [code, setCode] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<void>) => { setBusy(true); setError(null); try { await fn(); } catch (e) { setError(errText(e)); setBusy(false); } };
  return (
    <Modal title="Delete my account" onClose={onClose}>
      {error && <Banner>{error}</Banner>}
      <div className="report-box" style={{ paddingTop: 12 }}>
        <strong style={{ color: 'var(--danger-ink)', fontFamily: 'var(--font-display)' }}>This can’t be undone</strong>
        <ul className="bullets">
          {['Your profile, photo and username', 'Your chat history on every device', 'You leave every group (someone else takes over yours)', 'Two-step verification and your settings'].map((t) => <li key={t}><Icon name="close" size={18} />{t}</li>)}
        </ul>
        <span className="muted" style={{ fontSize: 12 }}>Messages you already sent stay with the people who got them, from “Deleted account”.</span>
      </div>
      {!sent ? (
        <div className="modal__actions">
          <OvalButton icon="close" label="Cancel" size="sm" variant="soft" onClick={onClose} />
          <OvalButton icon="send" label={`Send code to ${me.phone ? 'my phone' : 'my email'}`} size="sm" variant="danger" disabled={busy} onClick={() => void run(async () => { setSent(await api().startDeleteAccount()); setBusy(false); })} />
        </div>
      ) : (
        <form className="ys-col" style={{ padding: 0, gap: 14 }} onSubmit={(e) => { e.preventDefault(); void run(async () => { await disablePush().catch(() => undefined); await api().deleteAccount(code, reason || undefined); router.replace('/sign-in?deleted=1'); }); }}>
          <Field id="del-code" label={`Code sent to ${sent.sentTo}`}><input id="del-code" className="ys-input code-input" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} autoFocus /></Field>
          <Field id="del-why" label="Why are you leaving? (optional)">
            <select id="del-why" className="ys-input" value={reason} onChange={(e) => setReason(e.target.value)}>
              <option value="">Prefer not to say</option>{REASONS.map((r) => <option key={r}>{r}</option>)}
            </select>
          </Field>
          <div className="modal__actions"><OvalButton icon="close" label="Cancel" size="sm" variant="soft" onClick={onClose} /><OvalButton type="submit" icon="trash" label="Delete account" size="sm" variant="danger" disabled={busy || code.length !== 6} /></div>
        </form>
      )}
    </Modal>
  );
}

import React, { useState } from 'react';
import { Share, View } from 'react-native';
import { emailSchema, normalizePhone, pinSchema, type CodeSent, type MeProfile } from '@yays/shared';
import { api } from '../lib/api';
import { useSession } from '../lib/session';
import { useTheme } from '../lib/theme';
import { Icon } from '../ui/Icon';
import { Banner, Field, OvalButton } from '../ui/kit';
import { Text } from '../ui/Text';
import { Sheet } from '../circles/common';
import { ProfileForm } from '../screens/ProfileForm';
import { ProfileSocials } from './Socials';
import { Choice, errText, Group, SettingsPage, useSaved, ValueRow } from './ui';

type Dialog = 'pin' | 'pin-off' | 'phone' | 'email' | 'delete' | null;
const digits = (v: string) => v.replace(/\D/g, '').slice(0, 6);

/** Profile and account: name, photo, username, about; socials as others see them; number, email, two-step, your data. */
export function AccountScreen({ me, onBack, openSocials }: { me: MeProfile; onBack: () => void; openSocials: () => void }) {
  const t = useTheme();
  const s = useSession();
  const saved = useSaved();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [exporting, setExporting] = useState(false);
  const done = (m: MeProfile, msg: string) => { s.setMe(m); setDialog(null); saved.ok(msg); };
  const download = async () => {
    setExporting(true);
    try {
      const data = await (await api()).exportData();
      await Share.share({ title: `yaysapp-data-${new Date().toISOString().slice(0, 10)}.json`, message: JSON.stringify(data, null, 2) });
    } catch (e) { saved.fail(errText(e, 'Could not get your data. Try again.')); } finally { setExporting(false); }
  };
  return (
    <SettingsPage title="Profile and account" onBack={onBack} art="selfie" testID="account-screen">
      {saved.banner}
      <View style={{ backgroundColor: t.raised, borderRadius: 24, padding: 16 }}>
        <ProfileForm key={me.username ?? ''} me={me} submitLabel="Save" onSaved={(m) => { s.setMe(m); saved.ok('Saved. Changes show on your other devices too.'); }} />
      </View>
      <ProfileSocials openSocials={openSocials} />
      <Group title="Account">
        <ValueRow label="Phone number" value={me.phone ?? 'None'} hint="Used to sign in. Others never see it.">
          <OvalButton icon="edit" label={me.phone ? 'Change number' : 'Add number'} size="sm" variant="ghost" onPress={() => setDialog('phone')} />
        </ValueRow>
        <ValueRow label="Email" value={me.email ?? 'None'} hint="For sign-in codes and recovery.">
          <OvalButton icon="edit" label={me.email ? 'Change email' : 'Add email'} size="sm" variant="ghost" onPress={() => setDialog('email')} />
        </ValueRow>
        <ValueRow label="Two-step verification" value={me.twoStep ? 'On' : 'Off'} hint="A PIN is asked after the code whenever you sign in." testID="two-step-row">
          {me.twoStep
            ? <><OvalButton icon="key" label="Change PIN" size="sm" variant="ghost" onPress={() => setDialog('pin')} /><OvalButton icon="close" label="Turn off" size="sm" variant="ghost" onPress={() => setDialog('pin-off')} /></>
            : <OvalButton icon="lock" label="Turn on" size="sm" variant="soft" onPress={() => setDialog('pin')} />}
        </ValueRow>
        <ValueRow label="Your data" hint="Your profile, chats and the messages you sent, as a file to save or send.">
          <OvalButton icon="download" label="Download" size="sm" variant="ghost" loading={exporting} onPress={() => void download()} />
        </ValueRow>
      </Group>
      <View style={{ alignItems: 'center', paddingTop: 6 }}><OvalButton icon="trash" label="Delete account" size="sm" variant="danger" onPress={() => setDialog('delete')} /></View>
      {dialog === 'pin' ? <PinSheet me={me} onClose={() => setDialog(null)} onDone={(m) => done(m, me.twoStep ? 'Your PIN was changed.' : 'Two-step verification is on.')} /> : null}
      {dialog === 'pin-off' ? <PinOffSheet onClose={() => setDialog(null)} onDone={(m) => done(m, 'Two-step verification is off.')} /> : null}
      {dialog === 'phone' ? <ChangeSheet kind="phone" onClose={() => setDialog(null)} onDone={(m) => done(m, 'Your number was changed.')} /> : null}
      {dialog === 'email' ? <ChangeSheet kind="email" onClose={() => setDialog(null)} onDone={(m) => done(m, 'Your email was changed. Sign in with the new one from now on.')} /> : null}
      {dialog === 'delete' ? <DeleteSheet me={me} onClose={() => setDialog(null)} /> : null}
    </SettingsPage>
  );
}

/** Choose a PIN, then type it again (m32). Changing it asks for the current one first. */
function PinSheet({ me, onClose, onDone }: { me: MeProfile; onClose: () => void; onDone: (m: MeProfile) => void }) {
  const [current, setCurrent] = useState('');
  const [pin, setPin] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    const p = pinSchema.safeParse(pin);
    if (!p.success) { setError(p.error.issues[0]!.message); return; }
    if (pin !== again) { setError('The PINs don’t match. Try again.'); setAgain(''); return; }
    setBusy(true); setError(null);
    try { onDone(await (await api()).setPin(pin, me.twoStep ? current : undefined)); } catch (e) { setError(errText(e, 'That did not work. Try again.')); setBusy(false); }
  };
  return (
    <Sheet title={me.twoStep ? 'Change your PIN' : 'Two-step verification'} lead="You’ll be asked for this 6-digit PIN after the code whenever you sign in. If you forget it, we send a code to your other address to reset it." onClose={onClose} testID="pin-sheet">
      {error ? <Banner>{error}</Banner> : null}
      {me.twoStep ? <Field label="Current PIN" value={current} onChangeText={(v) => setCurrent(digits(v))} keyboardType="number-pad" secureTextEntry autoFocus /> : null}
      <Field label={me.twoStep ? 'New PIN' : 'PIN'} value={pin} onChangeText={(v) => setPin(digits(v))} keyboardType="number-pad" secureTextEntry autoFocus={!me.twoStep} />
      <Field label="Type it again" value={again} onChangeText={(v) => setAgain(digits(v))} keyboardType="number-pad" secureTextEntry />
      <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 32 }}>
        <OvalButton icon="close" label="Cancel" variant="ghost" onPress={onClose} />
        <OvalButton icon="lock" label={me.twoStep ? 'Change PIN' : 'Turn on'} loading={busy} disabled={pin.length !== 6 || again.length !== 6 || (me.twoStep && current.length !== 6)} onPress={() => void submit()} />
      </View>
    </Sheet>
  );
}

function PinOffSheet({ onClose, onDone }: { onClose: () => void; onDone: (m: MeProfile) => void }) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Sheet title="Turn off two-step verification?" onClose={onClose} testID="pin-off-sheet">
      {error ? <Banner>{error}</Banner> : null}
      <Field label="Your PIN" value={pin} onChangeText={(v) => setPin(digits(v))} keyboardType="number-pad" secureTextEntry autoFocus />
      <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 32 }}>
        <OvalButton icon="close" label="Cancel" variant="ghost" onPress={onClose} />
        <OvalButton icon="lock" label="Turn off" variant="danger" loading={busy} disabled={pin.length !== 6}
          onPress={() => void (async () => { setBusy(true); setError(null); try { onDone(await (await api()).removePin(pin)); } catch (e) { setError(errText(e, 'That did not work. Try again.')); setBusy(false); } })()} />
      </View>
    </Sheet>
  );
}

/** A new number or email gets a code first; chats and groups stay with the account. */
function ChangeSheet({ kind, onClose, onDone }: { kind: 'phone' | 'email'; onClose: () => void; onDone: (m: MeProfile) => void }) {
  const [raw, setRaw] = useState('');
  const [value, setValue] = useState<string | null>(null);
  const [sent, setSent] = useState<CodeSent | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const phone = kind === 'phone';
  const run = async (fn: () => Promise<void>) => { setBusy(true); setError(null); try { await fn(); } catch (e) { setError(errText(e, 'That did not work. Try again.')); } finally { setBusy(false); } };
  const send = () => {
    if (phone) {
      const p = normalizePhone(raw);
      if (!p) { setError('Enter a mobile number, for example 0300 1234567 or +44 7700 900123.'); return; }
      void run(async () => { setSent(await (await api()).startAddPhone(p)); setValue(p); });
    } else {
      const p = emailSchema.safeParse(raw);
      if (!p.success) { setError('Enter an email address, for example name@example.com.'); return; }
      void run(async () => { setSent(await (await api()).startAddEmail(p.data)); setValue(p.data); });
    }
  };
  const verify = () => void run(async () => { const a = await api(); onDone(phone ? await a.verifyAddPhone(value!, code) : await a.verifyAddEmail(value!, code)); });
  return (
    <Sheet title={phone ? 'Change number' : 'Change email'} onClose={onClose} testID={`${kind}-sheet`}
      lead={sent ? undefined : phone ? 'Your chats, groups and contacts stay with your account. You’ll sign in with the new number from now on.' : 'Sign-in codes and account messages go to the new address. The old one stops working for sign-in.'}>
      {error ? <Banner>{error}</Banner> : null}
      {!sent ? (
        <>
          {phone
            ? <Field label="New phone number" value={raw} onChangeText={setRaw} keyboardType="phone-pad" placeholder="0300 1234567" autoFocus onSubmitEditing={send} />
            : <Field label="New email" value={raw} onChangeText={setRaw} keyboardType="email-address" autoCapitalize="none" autoComplete="email" placeholder="name@example.com" autoFocus onSubmitEditing={send} />}
          <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 32 }}>
            <OvalButton icon="close" label="Cancel" variant="ghost" onPress={onClose} />
            <OvalButton icon="send" label="Send code" loading={busy} disabled={!raw.trim()} onPress={send} />
          </View>
        </>
      ) : (
        <>
          <Field label={`Code sent to ${sent.sentTo}`} value={code} onChangeText={(v) => setCode(digits(v))} keyboardType="number-pad" autoComplete="one-time-code" textContentType="oneTimeCode" autoFocus />
          <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 32 }}>
            <OvalButton icon="close" label="Cancel" variant="ghost" onPress={onClose} />
            <OvalButton icon="check" label={phone ? 'Change number' : 'Change email'} loading={busy} disabled={code.length !== 6} onPress={verify} />
          </View>
        </>
      )}
    </Sheet>
  );
}

const REASONS = ['I have another account', 'I don’t use YaysApp any more', 'Privacy worries', 'Too many messages or groups', 'Something else'];

/** m33: what goes, a code to confirm, and an optional reason. */
function DeleteSheet({ me, onClose }: { me: MeProfile; onClose: () => void }) {
  const t = useTheme();
  const s = useSession();
  const [sent, setSent] = useState<CodeSent | null>(null);
  const [code, setCode] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<void>) => { setBusy(true); setError(null); try { await fn(); } catch (e) { setError(errText(e, 'That did not work. Try again.')); setBusy(false); } };
  return (
    <Sheet title="Delete my account" onClose={onClose} testID="delete-sheet">
      {error ? <Banner>{error}</Banner> : null}
      <View style={{ gap: 8, padding: 14, borderRadius: 18, backgroundColor: t['danger-wash'] }}>
        <Text style={{ fontWeight: '800', color: t['danger-ink'] }}>This can’t be undone</Text>
        {['Your profile, photo and username', 'Your chat history on every device', 'You leave every group (someone else takes over yours)', 'Two-step verification and your settings'].map((x) => (
          <View key={x} style={{ flexDirection: 'row', gap: 8 }}><Icon name="close" size={16} color={t['danger-ink']} /><Text style={{ flex: 1, color: t.ink }}>{x}</Text></View>
        ))}
        <Text style={{ fontSize: 12, color: t['ink-soft'] }}>Messages you already sent stay with the people who got them, from “Deleted account”.</Text>
      </View>
      {!sent ? (
        <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 32 }}>
          <OvalButton icon="close" label="Cancel" variant="ghost" onPress={onClose} />
          <OvalButton icon="send" label={`Send code to ${me.phone ? 'my phone' : 'my email'}`} variant="danger" loading={busy} onPress={() => void run(async () => { setSent(await (await api()).startDeleteAccount()); setBusy(false); })} />
        </View>
      ) : (
        <>
          <Field label={`Code sent to ${sent.sentTo}`} value={code} onChangeText={(v) => setCode(digits(v))} keyboardType="number-pad" autoComplete="one-time-code" textContentType="oneTimeCode" autoFocus />
          <Choice label="Why are you leaving? (optional)" value={reason} options={[['', 'Prefer not to say'], ...REASONS.map((r) => [r, r] as [string, string])]} onChange={setReason} />
          <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 32 }}>
            <OvalButton icon="close" label="Cancel" variant="ghost" onPress={onClose} />
            <OvalButton icon="trash" label="Delete account" variant="danger" loading={busy} disabled={code.length !== 6}
              onPress={() => void run(async () => { await (await api()).deleteAccount(code, reason || undefined); await s.signOut(); })} />
          </View>
        </>
      )}
    </Sheet>
  );
}

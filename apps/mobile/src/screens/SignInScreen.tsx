import React, { useEffect, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Text } from '../ui/Text';
import { ApiError, ErrorCode, needsPin, normalizeEmail, normalizePhone, type AuthResult, type CodeSent, type SignInResult } from '@yays/shared';
import { api } from '../lib/api';
import { font, useTheme } from '../lib/theme';
import { Banner, Field, OvalButton, TextLink } from '../ui/kit';
import { Screen } from './Screen';
import { SocialSignIn } from './SocialSignIn';

type Step =
  | { s: 'phone' } | { s: 'phone-code'; phone: string; sent: CodeSent }
  | { s: 'signup-email'; phone: string; signupToken: string } | { s: 'signup-code'; phone: string; signupToken: string; email: string; sent: CodeSent }
  | { s: 'email' } | { s: 'email-code'; email: string; sent: CodeSent };

const msg = (e: unknown) => (e instanceof ApiError || e instanceof Error ? e.message : 'Something went wrong. Try again.');

function useSecondsLeft(until: number) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { if (until <= Date.now()) return; const id = setInterval(() => setNow(Date.now()), 500); return () => clearInterval(id); }, [until]);
  return Math.max(0, Math.ceil((until - now) / 1000));
}

export function SignInScreen({ onDone }: { onDone: (r: AuthResult) => void }) {
  const t = useTheme();
  const [step, setStep] = useState<Step>({ s: 'phone' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendAt, setResendAt] = useState(0);
  const left = useSecondsLeft(resendAt);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setError(null);
    try { await fn(); } catch (e) {
      setError(msg(e));
      if (e instanceof ApiError && e.code === ErrorCode.RATE_LIMITED && e.retryAfter) setResendAt(Date.now() + e.retryAfter * 1000);
    } finally { setBusy(false); }
  };
  const sent = (s: CodeSent) => setResendAt(Date.now() + s.resendInSeconds * 1000);

  if (step.s === 'phone' || step.s === 'email') {
    return (
      <Screen title="Sign in to YaysApp" lead="Use the phone number or email from your YaysApp account. New here? The same steps create your account.">
        <View style={{ flexDirection: 'row', alignSelf: 'flex-start', padding: 4, borderRadius: 999, backgroundColor: t.surface, borderWidth: 1, borderColor: t.line }} accessibilityRole="tablist">
          {(['phone', 'email'] as const).map((k) => (
            <Pressable key={k} accessibilityRole="tab" accessibilityState={{ selected: step.s === k }} onPress={() => { setError(null); setStep({ s: k }); }}
              style={{ paddingHorizontal: 16, height: 36, justifyContent: 'center', borderRadius: 999, backgroundColor: step.s === k ? t.raised : 'transparent' }}>
              <Text style={{ fontFamily: font.display, fontWeight: '700', fontSize: 14, color: step.s === k ? t['ember-ink'] : t['ink-soft'] }}>{k === 'phone' ? 'Phone' : 'Email'}</Text>
            </Pressable>
          ))}
        </View>
        {error ? <Banner>{error}</Banner> : null}
        {step.s === 'phone'
          ? <PhoneForm busy={busy} onSubmit={(phone) => run(async () => { const r = await (await api()).startPhone(phone); sent(r); setStep({ s: 'phone-code', phone, sent: r }); })} />
          : <EmailForm busy={busy} onSubmit={(email) => run(async () => { const r = await (await api()).startEmail(email); sent(r); setStep({ s: 'email-code', email, sent: r }); })} />}
        <SocialSignIn onDone={onDone} onEmail={step.s === 'phone' ? () => { setError(null); setStep({ s: 'email' }); } : undefined} />
      </Screen>
    );
  }
  if (step.s === 'signup-email') {
    return (
      <Screen title="Add your email" lead="If you used YaysApp before, enter the email from that account and we'll bring your chats over. We'll send it a code first.">
        {error ? <Banner>{error}</Banner> : null}
        <EmailForm busy={busy} onSubmit={(email) => run(async () => { const r = await (await api()).startSignupEmail(step.signupToken, email); sent(r); setStep({ ...step, s: 'signup-code', email, sent: r }); })} />
      </Screen>
    );
  }
  const code = step;
  return (
    <CodeStep key={code.s} title={code.s === 'phone-code' ? 'Enter the code' : 'Check your email'} sentTo={code.sent.sentTo} busy={busy} error={error} left={left}
      backLabel={code.s === 'phone-code' ? 'Change number' : 'Use another email'}
      onBack={() => { setError(null); setStep(code.s === 'phone-code' ? { s: 'phone' } : code.s === 'email-code' ? { s: 'email' } : { s: 'signup-email', phone: code.phone, signupToken: code.signupToken }); }}
      onResend={() => run(async () => {
        const c = await api();
        sent(code.s === 'phone-code' ? await c.startPhone(code.phone) : code.s === 'email-code' ? await c.startEmail(code.email) : await c.startSignupEmail(code.signupToken, code.email));
      })}
      onSubmit={(value) => run(async () => {
        const c = await api();
        // The PIN screen for two-step verification arrives with the mobile settings work.
        const finish = (r: SignInResult) => { if (needsPin(r)) throw new Error('This account has two-step verification. Sign in on YaysApp Web for now.'); onDone(r); };
        if (code.s === 'phone-code') {
          const r = await c.verifyPhone(code.phone, value);
          if (r.status === 'signed_in' || r.status === 'pin_required') return finish(r);
          setResendAt(0);
          setStep({ s: 'signup-email', phone: r.phone, signupToken: r.signupToken });
        } else if (code.s === 'email-code') finish(await c.verifyEmail(code.email, value));
        else finish(await c.verifySignupEmail(code.signupToken, code.email, value));
      })} />
  );
}

function PhoneForm({ busy, onSubmit }: { busy: boolean; onSubmit: (p: string) => void }) {
  const [raw, setRaw] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const go = () => { const p = normalizePhone(raw); if (!p) { setErr('Enter a mobile number, for example 0300 1234567 or +44 7700 900123.'); return; } setErr(null); onSubmit(p); };
  return (
    <>
      <Field label="Phone number" hint="Pakistani numbers can start with 0. Others need their country code." error={err} value={raw} onChangeText={setRaw}
        keyboardType="phone-pad" textContentType="telephoneNumber" autoComplete="tel" placeholder="0300 1234567" onSubmitEditing={go} returnKeyType="send" />
      <View style={{ alignItems: 'center' }}><OvalButton icon="arrow-right" label="Send code" size="lg" loading={busy} onPress={go} /></View>
    </>
  );
}

function EmailForm({ busy, onSubmit }: { busy: boolean; onSubmit: (e: string) => void }) {
  const [raw, setRaw] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const go = () => { const v = normalizeEmail(raw); if (!v) { setErr('Enter a valid email address.'); return; } setErr(null); onSubmit(v); };
  return (
    <>
      <Field label="Email" error={err} value={raw} onChangeText={setRaw} keyboardType="email-address" autoCapitalize="none" autoCorrect={false}
        textContentType="emailAddress" autoComplete="email" placeholder="you@example.com" onSubmitEditing={go} returnKeyType="send" />
      <View style={{ alignItems: 'center' }}><OvalButton icon="arrow-right" label="Send code" size="lg" loading={busy} onPress={go} /></View>
    </>
  );
}

function CodeStep({ title, sentTo, busy, error, left, onSubmit, onResend, onBack, backLabel }: {
  title: string; sentTo: string; busy: boolean; error: string | null; left: number; onSubmit: (c: string) => void; onResend: () => void; onBack: () => void; backLabel: string;
}) {
  const [code, setCode] = useState('');
  const last = useRef('');
  useEffect(() => { if (code.length === 6 && last.current !== code && !busy) { last.current = code; onSubmit(code); } }, [code, busy, onSubmit]);
  useEffect(() => { if (error) { setCode(''); last.current = ''; } }, [error]);
  return (
    <Screen title={title} lead={<>We sent a 6-digit code to <Text style={{ fontWeight: '700' }}>{sentTo}</Text>.</>}>
      {error ? <Banner>{error}</Banner> : null}
      <Field label="6-digit code" value={code} onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))} keyboardType="number-pad"
        textContentType="oneTimeCode" autoComplete="sms-otp" maxLength={6} editable={!busy} autoFocus />
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <TextLink label={backLabel} onPress={onBack} />
        <TextLink label={left > 0 ? `Resend in ${left}s` : 'Resend code'} onPress={onResend} disabled={left > 0 || busy} />
      </View>
      <View style={{ alignItems: 'center' }}><OvalButton icon="check" label="Verify" size="lg" loading={busy} disabled={code.length !== 6} onPress={() => { last.current = code; onSubmit(code); }} /></View>
    </Screen>
  );
}

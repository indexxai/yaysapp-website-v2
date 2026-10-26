'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ApiError, ErrorCode, normalizeEmail, normalizePhone, type AuthResult, type CodeSent } from '@yays/shared';
import { api, hasSession } from '@/lib/api';
import { AuthShell } from '@/components/auth-shell';
import { Banner, Field, OvalButton } from '@/components/ui';
import { useCountdown } from '@/components/use-countdown';
import { Icon } from '@/lib/icons';

type Step =
  | { s: 'phone' } | { s: 'phone-code'; phone: string; sent: CodeSent }
  | { s: 'signup-email'; phone: string; signupToken: string } | { s: 'signup-code'; phone: string; signupToken: string; email: string; sent: CodeSent }
  | { s: 'email' } | { s: 'email-code'; email: string; sent: CodeSent };

const message = (e: unknown) => (e instanceof ApiError ? e.message : 'Something went wrong. Try again.');

export default function SignIn() {
  const router = useRouter();
  const [step, setStep] = useState<Step>({ s: 'phone' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendAt, setResendAt] = useState(0);
  const left = useCountdown(resendAt);

  useEffect(() => { if (hasSession()) router.replace('/chats'); }, [router]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setError(null);
    try { await fn(); } catch (e) {
      setError(message(e));
      if (e instanceof ApiError && e.code === ErrorCode.RATE_LIMITED && e.retryAfter) setResendAt(Date.now() + e.retryAfter * 1000);
    } finally { setBusy(false); }
  };
  const done = (r: AuthResult) => router.replace(r.me.pending.includes('profile') ? '/setup/profile' : '/chats');
  const sent = (s: CodeSent) => setResendAt(Date.now() + s.resendInSeconds * 1000);

  return (
    <AuthShell>
      {step.s === 'phone' || step.s === 'email' ? (
        <>
          <div>
            <h1>Sign in to YaysApp</h1>
            <p className="lead">Use the phone number or email from your YaysApp account. New here? The same steps create your account.</p>
          </div>
          <div className="ys-tabs" role="tablist" aria-label="Sign in with">
            <button role="tab" className="ys-tab" aria-selected={step.s === 'phone'} onClick={() => { setError(null); setStep({ s: 'phone' }); }}><Icon name="phone" size={16} />Phone</button>
            <button role="tab" className="ys-tab" aria-selected={step.s === 'email'} onClick={() => { setError(null); setStep({ s: 'email' }); }}><Icon name="mail" size={16} />Email</button>
          </div>
          {error && <Banner>{error}</Banner>}
          {step.s === 'phone' ? <PhoneForm busy={busy} onSubmit={(phone) => run(async () => { const r = await api().startPhone(phone); sent(r); setStep({ s: 'phone-code', phone, sent: r }); })} />
            : <EmailForm busy={busy} label="Email" submitLabel="Send code" onSubmit={(email) => run(async () => { const r = await api().startEmail(email); sent(r); setStep({ s: 'email-code', email, sent: r }); })} />}
          <div className="divider">or</div>
          <GoogleButton onToken={(t) => run(async () => done(await api().google(t)))} busy={busy} />
        </>
      ) : null}

      {step.s === 'phone-code' && (
        <CodeStep title="Enter the code" sentTo={step.sent.sentTo} busy={busy} error={error} left={left}
          onBack={() => { setError(null); setStep({ s: 'phone' }); }} backLabel="Change number"
          onResend={() => run(async () => sent(await api().startPhone(step.phone)))}
          onSubmit={(code) => run(async () => {
            const r = await api().verifyPhone(step.phone, code);
            if (r.status === 'signed_in') return done(r);
            setResendAt(0);
            setStep({ s: 'signup-email', phone: r.phone, signupToken: r.signupToken });
          })} />
      )}

      {step.s === 'signup-email' && (
        <>
          <div>
            <h1>Add your email</h1>
            <p className="lead">If you used YaysApp before, enter the email from that account and we&apos;ll bring your chats over. We&apos;ll send it a code first.</p>
          </div>
          {error && <Banner>{error}</Banner>}
          <EmailForm busy={busy} label="Email" submitLabel="Send code" onSubmit={(email) => run(async () => {
            const r = await api().startSignupEmail(step.signupToken, email); sent(r); setStep({ ...step, s: 'signup-code', email, sent: r });
          })} />
        </>
      )}

      {step.s === 'signup-code' && (
        <CodeStep title="Check your email" sentTo={step.sent.sentTo} busy={busy} error={error} left={left}
          onBack={() => { setError(null); setStep({ s: 'signup-email', phone: step.phone, signupToken: step.signupToken }); }} backLabel="Use another email"
          onResend={() => run(async () => sent(await api().startSignupEmail(step.signupToken, step.email)))}
          onSubmit={(code) => run(async () => done(await api().verifySignupEmail(step.signupToken, step.email, code)))} />
      )}

      {step.s === 'email-code' && (
        <CodeStep title="Check your email" sentTo={step.sent.sentTo} busy={busy} error={error} left={left}
          onBack={() => { setError(null); setStep({ s: 'email' }); }} backLabel="Use another email"
          onResend={() => run(async () => sent(await api().startEmail(step.email)))}
          onSubmit={(code) => run(async () => done(await api().verifyEmail(step.email, code)))} />
      )}
    </AuthShell>
  );
}

function PhoneForm({ busy, onSubmit }: { busy: boolean; onSubmit: (phone: string) => void }) {
  const [raw, setRaw] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const submit = (e: FormEvent) => { e.preventDefault(); const p = normalizePhone(raw); if (!p) { setErr('Enter a mobile number, for example 0300 1234567 or +44 7700 900123.'); return; } setErr(null); onSubmit(p); };
  return (
    <form onSubmit={submit} className="ys-col" style={{ padding: 0, gap: 20 }} noValidate>
      <Field id="phone" label="Phone number" hint="Pakistani numbers can start with 0. Others need their country code." error={err}>
        <input id="phone" className="ys-input" type="tel" inputMode="tel" autoComplete="tel" placeholder="0300 1234567" value={raw} onChange={(e) => setRaw(e.target.value)} aria-describedby="phone-hint" autoFocus />
      </Field>
      <div className="row center"><OvalButton type="submit" icon="arrow-right" label="Send code" size="lg" loading={busy} /></div>
    </form>
  );
}

function EmailForm({ busy, label, submitLabel, onSubmit }: { busy: boolean; label: string; submitLabel: string; onSubmit: (email: string) => void }) {
  const [raw, setRaw] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const submit = (e: FormEvent) => { e.preventDefault(); const v = normalizeEmail(raw); if (!v) { setErr('Enter a valid email address.'); return; } setErr(null); onSubmit(v); };
  return (
    <form onSubmit={submit} className="ys-col" style={{ padding: 0, gap: 20 }} noValidate>
      <Field id="email" label={label} error={err}>
        <input id="email" className="ys-input" type="email" inputMode="email" autoComplete="email" placeholder="you@example.com" value={raw} onChange={(e) => setRaw(e.target.value)} autoFocus />
      </Field>
      <div className="row center"><OvalButton type="submit" icon="arrow-right" label={submitLabel} size="lg" loading={busy} /></div>
    </form>
  );
}

function CodeStep({ title, sentTo, busy, error, left, onSubmit, onResend, onBack, backLabel }: {
  title: string; sentTo: string; busy: boolean; error: string | null; left: number; onSubmit: (c: string) => void; onResend: () => void; onBack: () => void; backLabel: string;
}) {
  const [code, setCode] = useState('');
  const submitted = useRef('');
  // Submit on the sixth digit, once per value, so paste and autofill just work.
  useEffect(() => { if (code.length === 6 && submitted.current !== code && !busy) { submitted.current = code; onSubmit(code); } }, [code, busy, onSubmit]);
  useEffect(() => { if (error) { setCode(''); submitted.current = ''; } }, [error]);
  return (
    <>
      <div>
        <h1>{title}</h1>
        <p className="lead">We sent a 6-digit code to <strong style={{ color: 'var(--ink)' }}>{sentTo}</strong>.</p>
      </div>
      {error && <Banner>{error}</Banner>}
      <form onSubmit={(e) => { e.preventDefault(); if (code.length === 6) { submitted.current = code; onSubmit(code); } }} className="ys-col" style={{ padding: 0, gap: 20 }}>
        <Field id="code" label="Code">
          <input id="code" className="ys-input code-input" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} disabled={busy}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} autoFocus aria-label="6-digit code" />
        </Field>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <button type="button" className="link-btn" onClick={onBack}>{backLabel}</button>
          <button type="button" className="link-btn" disabled={left > 0 || busy} onClick={onResend}>{left > 0 ? `Resend in ${left}s` : 'Resend code'}</button>
        </div>
        <div className="row center"><OvalButton type="submit" icon="check" label="Verify" size="lg" loading={busy} disabled={code.length !== 6} /></div>
      </form>
    </>
  );
}

declare global { interface Window { google?: { accounts: { id: { initialize: (o: object) => void; renderButton: (el: HTMLElement, o: object) => void } } } } }

/** Google's own button when a client id is configured; a dev stand-in otherwise (local and tests only). */
function GoogleButton({ onToken, busy }: { onToken: (idToken: string) => void; busy: boolean }) {
  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!clientId) return;
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client'; s.async = true;
    s.onload = () => { window.google?.accounts.id.initialize({ client_id: clientId, callback: (r: { credential: string }) => onToken(r.credential) }); if (ref.current) window.google?.accounts.id.renderButton(ref.current, { theme: 'outline', size: 'large', shape: 'pill', width: 320 }); };
    document.head.appendChild(s);
    return () => { s.remove(); };
  }, [clientId, onToken]);
  if (clientId) return <div className="row center" ref={ref} />;
  if (process.env.NEXT_PUBLIC_DEV_GOOGLE !== '1') return null;
  return (
    <div className="row center">
      <OvalButton icon="google" label="Google (dev)" size="md" variant="secondary" loading={busy} onClick={() => {
        const email = window.prompt('Dev Google sign-in: email') ?? '';
        if (email) onToken('dev.' + btoa(JSON.stringify({ sub: 'dev-' + email, email, name: email.split('@')[0] })).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''));
      }} />
    </div>
  );
}

'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import QRCode from 'qrcode';
import { ApiError, ErrorCode, needsPin, normalizeEmail, normalizePhone, type CodeSent, type LinkStart, type SignInResult } from '@yays/shared';
import { api, hasSession, keepSignedIn, setKeepSignedIn } from '@/lib/api';
import { AuthShell } from '@/components/auth-shell';
import { Banner, Field, OvalButton } from '@/components/ui';
import { useCountdown } from '@/components/use-countdown';
import { Icon } from '@/lib/icons';

type Step =
  | { s: 'phone' } | { s: 'phone-code'; phone: string; sent: CodeSent }
  | { s: 'signup-email'; phone: string; signupToken: string } | { s: 'signup-code'; phone: string; signupToken: string; email: string; sent: CodeSent }
  | { s: 'email' } | { s: 'email-code'; email: string; sent: CodeSent } | { s: 'qr' }
  | { s: 'pin'; pinToken: string } | { s: 'pin-reset'; pinToken: string; sent: CodeSent }
  | { s: 'fb-missing'; name: string };

const message = (e: unknown) => (e instanceof ApiError ? e.message : 'Something went wrong. Try again.');

export default function SignIn() {
  const router = useRouter();
  const [step, setStep] = useState<Step>({ s: 'qr' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendAt, setResendAt] = useState(0);
  const left = useCountdown(resendAt);

  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    // A phone can't scan its own screen: phones start with the phone number.
    if (window.matchMedia('(max-width: 860px)').matches) setStep((x) => (x.s === 'qr' ? { s: 'phone' } : x));
    if (hasSession()) { router.replace('/chats'); return; }
    const q = new URLSearchParams(window.location.search);
    if (q.get('deleted') === '1') setNotice('Your account was deleted. You can make a new one any time with the same steps.');
    // Back from Facebook: a one-time ticket to trade for a session, or why it didn't work.
    const ticket = q.get('fb_ticket'), fb = q.get('fb');
    if (ticket || fb) history.replaceState(null, '', '/sign-in');
    if (ticket) { setStep({ s: 'phone' }); void run(async () => done(await api().facebookSignIn(ticket))); }
    else if (fb === 'not_linked') setStep({ s: 'fb-missing', name: q.get('fb_name') ?? '' });
    else if (fb) { setStep({ s: 'phone' }); setError(fb === 'cancelled' ? 'Facebook sign-in was cancelled.' : fb === 'expired' ? 'That Facebook sign-in took too long. Try again.' : 'Facebook didn’t confirm. Try again.'); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);
  const facebook = () => run(async () => { location.href = (await api().facebookSignInStart()).url; });

  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setError(null);
    try { await fn(); } catch (e) {
      setError(message(e));
      if (e instanceof ApiError && e.code === ErrorCode.RATE_LIMITED && e.retryAfter) setResendAt(Date.now() + e.retryAfter * 1000);
    } finally { setBusy(false); }
  };
  const done = (r: SignInResult) => {
    if (needsPin(r)) { setError(null); setStep({ s: 'pin', pinToken: r.pinToken }); return; }
    router.replace(r.me.pending.includes('profile') ? '/setup/profile' : '/chats');
  };
  const sent = (s: CodeSent) => setResendAt(Date.now() + s.resendInSeconds * 1000);

  return (
    <AuthShell wide={step.s === 'qr'} art={step.s === 'qr' ? 'chat' : step.s === 'pin' ? 'lantern' : step.s === 'phone' || step.s === 'email' ? 'trader' : 'skater'}>
      {step.s === 'qr' && notice && <Banner tone="success">{notice}</Banner>}
      {step.s === 'qr' && <QrStep onBack={() => setStep({ s: 'phone' })} onLinked={() => router.replace('/chats')} />}
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
          {notice && !error && <Banner tone="success">{notice}</Banner>}
          {step.s === 'phone' ? <PhoneForm busy={busy} onSubmit={(phone) => run(async () => { const r = await api().startPhone(phone); sent(r); setStep({ s: 'phone-code', phone, sent: r }); })} />
            : <EmailForm busy={busy} label="Email" submitLabel="Send code" onSubmit={(email) => run(async () => { const r = await api().startEmail(email); sent(r); setStep({ s: 'email-code', email, sent: r }); })} />}
          <div className="divider">or</div>
          {process.env.NEXT_PUBLIC_FACEBOOK !== '0' && <FacebookButton busy={busy} onClick={() => void facebook()} />}
          <GoogleButton onToken={(t) => run(async () => done(await api().google(t)))} busy={busy} />
          <button type="button" className="link-btn qr-switch" onClick={() => { setError(null); setStep({ s: 'qr' }); }}><Icon name="qr" size={18} />Scan a QR code instead</button>
        </>
      ) : null}
      {step.s === 'fb-missing' && (
        <div className="fb-missing">
          <span className="ys-oval" style={{ width: 84, ['--ys-oval-fill' as string]: 'var(--warning-wash)', ['--ys-oval-ink' as string]: 'var(--warning-ink)' }}><Icon name="facebook" size={36} /></span>
          <h1>This Facebook isn’t linked yet</h1>
          <p className="lead">No YaysApp account uses {step.name ? <strong>{step.name}</strong> : 'this Facebook account'} for signing in. Sign in with your phone number or email, then link Facebook in Settings › Social accounts.</p>
          <div className="row center" style={{ gap: 24 }}>
            <OvalButton icon="phone" label="Sign in with phone" size="lg" onClick={() => setStep({ s: 'phone' })} />
            <OvalButton icon="mail" label="Use email" size="lg" variant="soft" onClick={() => setStep({ s: 'email' })} />
          </div>
          <p className="muted p2-xs">We don’t make new accounts from Facebook: every YaysApp account starts with a verified phone number.</p>
        </div>
      )}

      {step.s === 'phone-code' && (
        <CodeStep title="Enter the code" sentTo={step.sent.sentTo} busy={busy} error={error} left={left}
          onBack={() => { setError(null); setStep({ s: 'phone' }); }} backLabel="Change number"
          onResend={() => run(async () => sent(await api().startPhone(step.phone)))}
          onSubmit={(code) => run(async () => {
            const r = await api().verifyPhone(step.phone, code);
            if (r.status === 'signed_in' || r.status === 'pin_required') return done(r);
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
      {step.s === 'pin' && (
        <PinStep busy={busy} error={error}
          onSubmit={(pin) => run(async () => done(await api().signInWithPin(step.pinToken, pin)))}
          onForgot={() => run(async () => { const r = await api().forgotPin(step.pinToken); sent(r); setStep({ s: 'pin-reset', pinToken: step.pinToken, sent: r }); })} />
      )}

      {step.s === 'pin-reset' && (
        <CodeStep title="Reset your PIN" sentTo={step.sent.sentTo} busy={busy} error={error} left={left}
          note="Entering it turns off two-step verification so you can sign in. You can set a new PIN in Settings."
          onBack={() => { setError(null); setStep({ s: 'pin', pinToken: step.pinToken }); }} backLabel="I remember my PIN"
          onResend={() => run(async () => sent(await api().forgotPin(step.pinToken)))}
          onSubmit={(code) => run(async () => done(await api().resetPin(step.pinToken, code)))} />
      )}
    </AuthShell>
  );
}

/** Two-step verification: the 6-digit PIN after the code. */
function PinStep({ busy, error, onSubmit, onForgot }: { busy: boolean; error: string | null; onSubmit: (pin: string) => void; onForgot: () => void }) {
  const [pin, setPin] = useState('');
  const submitted = useRef('');
  useEffect(() => { if (pin.length === 6 && submitted.current !== pin && !busy) { submitted.current = pin; onSubmit(pin); } }, [pin, busy, onSubmit]);
  useEffect(() => { if (error) { setPin(''); submitted.current = ''; } }, [error]);
  return (
    <>
      <div>
        <h1>Enter your PIN</h1>
        <p className="lead">This account has two-step verification. Enter the 6-digit PIN you chose.</p>
      </div>
      {error && <Banner>{error}</Banner>}
      <form onSubmit={(e) => { e.preventDefault(); if (pin.length === 6) { submitted.current = pin; onSubmit(pin); } }} className="ys-col" style={{ padding: 0, gap: 20 }}>
        <Field id="pin" label="PIN">
          <input id="pin" className="ys-input code-input" type="password" inputMode="numeric" autoComplete="off" maxLength={6} value={pin} disabled={busy}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))} autoFocus aria-label="6-digit PIN" />
        </Field>
        <div className="row" style={{ justifyContent: 'flex-end' }}><button type="button" className="link-btn" onClick={onForgot} disabled={busy}>Forgot PIN?</button></div>
        <div className="row center"><OvalButton type="submit" icon="check" label="Continue" size="lg" loading={busy} disabled={pin.length !== 6} /></div>
      </form>
    </>
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

function CodeStep({ title, sentTo, busy, error, left, onSubmit, onResend, onBack, backLabel, note }: {
  title: string; sentTo: string; busy: boolean; error: string | null; left: number; onSubmit: (c: string) => void; onResend: () => void; onBack: () => void; backLabel: string; note?: string;
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
        <p className="lead">We sent a 6-digit code to <strong style={{ color: 'var(--ink)' }}>{sentTo}</strong>.{note ? ` ${note}` : ''}</p>
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

/** Facebook's blue sign-in button. It sends the browser to Facebook and back. */
function FacebookButton({ onClick, busy, label = 'Continue with Facebook' }: { onClick: () => void; busy?: boolean; label?: string }) {
  return <button type="button" className="fb-btn" onClick={onClick} disabled={busy} aria-busy={busy || undefined}><Icon name="facebook" size={20} />{label}</button>;
}

/** Sign in by scanning a code with a device that's already signed in (or typing the short code there). */
function QrStep({ onBack, onLinked }: { onBack: () => void; onLinked: () => void }) {
  const [link, setLink] = useState<LinkStart | null>(null);
  const [svg, setSvg] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const fresh = useRef(0);
  // A new code every minute while this screen is open.
  useEffect(() => {
    let alive = true;
    const get = async () => {
      try {
        const l = await api().linkStart();
        if (!alive) return;
        setLink(l); setError(null);
        setSvg(await QRCode.toString(l.qr, { type: 'svg', margin: 0, errorCorrectionLevel: 'H', color: { dark: '#1f1a16', light: '#ffffff' } }));
      } catch (e) { if (alive) setError(message(e)); }
    };
    void get();
    const t = setInterval(() => { setNow(Date.now()); if (fresh.current && Date.now() > fresh.current) { fresh.current = 0; void get(); } }, 1000);
    return () => { alive = false; clearInterval(t); };
  }, []);
  useEffect(() => { if (link) fresh.current = Date.parse(link.expiresAt) - 1000; }, [link]);
  // Asks every 2 seconds whether the code was used.
  useEffect(() => {
    if (!link) return;
    let alive = true;
    const t = setInterval(() => {
      void api().linkPoll(link.pollId).then((r) => { if (alive && r.status === 'linked') { clearInterval(t); onLinked(); } }).catch(() => undefined);
    }, 2000);
    return () => { alive = false; clearInterval(t); };
  }, [link, onLinked]);
  const secs = link ? Math.max(0, Math.round((Date.parse(link.expiresAt) - now) / 1000)) : 0;
  const [keep, setKeep] = useState(() => keepSignedIn());
  return (
    <div className="qr-step">
      <div className="qr-step__text">
        <h1>Scan to sign in</h1>
        <ol>
          <li>Open YaysApp on your phone</li>
          <li>Go to <strong>Me</strong> (or <strong>Settings</strong> in a browser), then <strong>Linked devices</strong></li>
          <li>Tap <strong>Link a device</strong> and point your phone at this code</li>
        </ol>
        <label className="check-row"><input type="checkbox" checked={keep} onChange={(e) => { setKeep(e.target.checked); setKeepSignedIn(e.target.checked); }} />Keep me signed in on this browser</label>
        {error && <Banner>{error}</Banner>}
        <p className="qr-step__alt">No phone with you? <button type="button" className="link-btn link-btn--inline" onClick={onBack}>Sign in with a code instead</button></p>
      </div>
      <div className="qr-step__code">
        <div className="qr-box" role="img" aria-label="QR code to link this browser">
          {svg ? <span className="qr-box__svg" dangerouslySetInnerHTML={{ __html: svg }} /> : <span className="ys-spin" aria-hidden />}
          {svg && <span className="qr-box__logo" aria-hidden><img src="/brand/mark.png" alt="" /></span>}
        </div>
        <span className="muted" style={{ fontSize: 13, fontVariantNumeric: 'tabular-nums' }}>{link ? `Code refreshes in ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}` : 'Getting a code…'}</span>
        {link && <span className="qr-code-hint">On a computer, type <strong className="qr-code-text" data-testid="link-code">{link.code}</strong></span>}
      </div>
    </div>
  );
}

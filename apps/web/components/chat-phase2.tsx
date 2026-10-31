'use client';
import { useEffect, useState } from 'react';
import { ApiError, PAY_LIMITS, type AiSummary, type ConversationSummary, type PaymentView } from '@yays/shared';
import { api } from '@/lib/api';
import { Icon } from '@/lib/icons';
import { errText, fmtUsd } from '@/lib/phase2';
import { Modal } from './message-actions';
import { Banner, Field, OvalButton } from './ui';

/* ---------------------------------------------------------------- money in a chat (W5, p11, p12) */

/** A payment request or a payment, shown in the chat in place of the text. */
export function PaymentCard({ p, me, peerName }: { p: PaymentView; me: string; peerName: string }) {
  const [paying, setPaying] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const first = peerName.split(/\s+/)[0];
  const decline = async () => { setBusy(true); setError(null); try { await api().declineRequest(p.id); } catch (e) { setError(errText(e)); } finally { setBusy(false); } };
  if (p.kind === 'payment') {
    const mine = p.fromId === me;
    return (
      <div className={`p2-pay p2-pay--sent${mine ? ' p2-pay--mine' : ''}`} data-testid="payment">
        <span className="p2-pay__eyebrow"><Icon name="check" size={14} />{mine ? 'YOU PAID' : `${first.toUpperCase()} PAID YOU`}</span>
        <strong className="p2-pay__amt">{fmtUsd(p.amountCents)}</strong>
        <span className="p2-pay__sub">{p.note ? `${p.note} · ` : ''}Ref {p.ref}</span>
      </div>
    );
  }
  const asked = p.fromId === me; // I'm the one asked to pay
  const label = { waiting: asked ? 'Waiting for you' : `Waiting for ${first}`, paid: 'Paid', declined: asked ? 'You declined' : `${first} declined`, expired: 'Expired', sent: 'Sent' }[p.status];
  return (
    <div className="p2-pay" data-testid="payment">
      <span className="p2-pay__eyebrow"><Icon name="download" size={14} />PAYMENT REQUEST</span>
      <strong className="p2-pay__amt">{fmtUsd(p.amountCents)}</strong>
      <span className="p2-pay__sub">USDXX{p.note ? ` · ${p.note}` : ''}</span>
      {p.status === 'waiting' && asked ? (
        <div className="row center" style={{ gap: 24, marginTop: 10 }}>
          <OvalButton icon="close" label="Decline" size="sm" variant="ghost" loading={busy} onClick={() => void decline()} />
          <OvalButton icon="send" label={`Pay ${fmtUsd(p.amountCents)}`} size="sm" onClick={() => setPaying(true)} />
        </div>
      ) : p.status === 'waiting' ? (
        <div className="row" style={{ gap: 10, marginTop: 8 }}><span className="ys-tag ys-tag--warning">{label}</span><button type="button" className="link-btn" onClick={() => void decline()} disabled={busy}>Cancel request</button></div>
      ) : <span className={`ys-tag ys-tag--${p.status === 'paid' ? 'success' : 'neutral'}`} style={{ marginTop: 8, alignSelf: 'flex-start' }}>{label}</span>}
      {error && <span className="p2-pay__err" role="alert">{error}</span>}
      {paying && <PinDialog title={`Pay ${first} ${fmtUsd(p.amountCents)}`} detail={`USDXX${p.note ? ` · ${p.note}` : ''}`} onClose={() => setPaying(false)} run={(pin) => api().payRequest(p.id, pin)} />}
    </div>
  );
}

/** Asks for the 6-digit payment PIN (setting one the first time) and runs the payment with it. */
export function PinDialog({ title, detail, run, onClose, onDone }: { title: string; detail: string; run: (pin: string) => Promise<unknown>; onClose: () => void; onDone?: () => void }) {
  const [pin, setPin] = useState('');
  const [needSet, setNeedSet] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const go = async () => {
    setBusy(true); setError(null);
    try {
      if (needSet) await api().setPayPin(pin);
      await run(pin);
      onDone?.(); onClose();
    } catch (e) {
      if (e instanceof ApiError && (e.details as { needPin?: boolean } | undefined)?.needPin) { setNeedSet(true); setError(null); }
      else setError(errText(e));
    } finally { setBusy(false); }
  };
  return (
    <Modal title={title} onClose={onClose} eyebrow={detail}>
      <p className="muted" style={{ margin: 0 }}>{needSet ? 'Choose a 6-digit payment PIN. You’ll use it for every payment.' : 'Enter your 6-digit payment PIN. Payments can’t be cancelled once sent.'}</p>
      <Field id="paypin" label={needSet ? 'New payment PIN' : 'Payment PIN'} error={error}>
        <input id="paypin" className="ys-input code-input" inputMode="numeric" autoComplete="off" type="password" maxLength={6} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))} onKeyDown={(e) => { if (e.key === 'Enter' && pin.length === 6) void go(); }} />
      </Field>
      <div className="row center"><OvalButton icon="lock" label={needSet ? 'Set PIN and pay' : 'Pay'} size="lg" loading={busy} disabled={pin.length !== 6} onClick={() => void go()} /></div>
    </Modal>
  );
}

/** Send or request USDXX in a one-to-one chat (W5 "Money"). */
export function MoneyDialog({ c, onClose }: { c: ConversationSummary; onClose: () => void }) {
  const [mode, setMode] = useState<'send' | 'request'>('request');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pin, setPin] = useState(false);
  const first = (c.peer?.displayName ?? 'them').split(/\s+/)[0]!;
  const cents = Math.round((Number(amount.replace(/[$,\s]/g, '')) || 0) * 100);
  const problem = !amount ? null : cents < PAY_LIMITS.minCents ? 'The smallest amount is $1.00.' : cents > PAY_LIMITS.maxCents ? 'The most at once is $1,000.' : null;
  const request = async () => {
    setBusy(true); setError(null);
    try { await api().requestMoney({ conversationId: c.id, amountCents: cents, note: note.trim(), clientId: crypto.randomUUID() }); onClose(); }
    catch (e) { setError(errText(e)); } finally { setBusy(false); }
  };
  const ready = cents >= PAY_LIMITS.minCents && !problem;
  return (
    <Modal title="Money" onClose={onClose} eyebrow={`With ${c.peer?.displayName ?? 'this person'}`}>
      <div className="ys-tabs" role="tablist" aria-label="Send or request">
        {(['send', 'request'] as const).map((m) => <button key={m} type="button" role="tab" className="ys-tab" aria-selected={mode === m} onClick={() => setMode(m)}>{m === 'send' ? 'Send' : 'Request'}</button>)}
      </div>
      <Field id="pamt" label="Amount (USDXX)" error={problem}>
        <span className="p2-pay__dollar">$</span><input id="pamt" className="ys-input p2-pay__input" inputMode="decimal" value={amount} placeholder="0.00" onChange={(e) => setAmount(e.target.value)} />
      </Field>
      <Field id="pnote" label="What’s it for?" hint={`${first} sees this note.`}>
        <input id="pnote" className="ys-input" value={note} maxLength={PAY_LIMITS.noteMax} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <div className="p2-note p2-note--plain">{mode === 'request' ? `Requests expire after ${PAY_LIMITS.requestDays} days. ${first} can pay or decline; you’ll see it in this chat either way.` : 'Payments come from your USDXX in Indexx Pay and can’t be cancelled once sent.'}</div>
      {error && <Banner>{error}</Banner>}
      <div className="row center">
        {mode === 'request'
          ? <OvalButton icon="download" label={`Request ${ready ? fmtUsd(cents) : ''}`.trim()} size="lg" loading={busy} disabled={!ready} onClick={() => void request()} />
          : <OvalButton icon="send" label={`Send ${ready ? fmtUsd(cents) : ''}`.trim()} size="lg" disabled={!ready} onClick={() => setPin(true)} />}
      </div>
      {pin && <PinDialog title={`Pay ${first} ${fmtUsd(cents)}`} detail={`USDXX${note.trim() ? ` · ${note.trim()}` : ''}`} onClose={() => setPin(false)} onDone={onClose} run={(p) => api().sendMoney({ conversationId: c.id, amountCents: cents, note: note.trim(), clientId: crypto.randomUUID(), pin: p })} />}
    </Modal>
  );
}

/* ---------------------------------------------------------------- Jack's AI inside a chat (p03, p04) */

/** "Catch me up": asks once per chat before Jack reads it, then shows a short summary above the messages. */
export function JackSummary({ c, onClose }: { c: ConversationSummary; onClose: () => void }) {
  const [step, setStep] = useState<'ask' | 'busy' | 'done'>('busy');
  const [s, setS] = useState<AiSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const name = c.group?.name ?? c.peer?.displayName ?? 'this chat';
  const run = async () => { setStep('busy'); setError(null); try { setS(await api().aiSummarize(c.id)); setStep('done'); } catch (e) { setError(errText(e)); setStep('done'); } };
  useEffect(() => {
    void api().aiConsent(c.id).then((r) => (r.consent ? run() : setStep('ask'))).catch((e) => { setError(errText(e)); setStep('done'); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c.id]);
  if (step === 'ask') return (
    <Modal title="Let Jack’s AI read this chat?" onClose={onClose}>
      <p style={{ margin: 0 }}>To summarise, Jack’s AI needs the last 200 messages from <strong>{name}</strong>. They are used for this answer only and are not used to train AI.</p>
      <ul className="p2-perms">
        <li><Icon name="check" size={18} />Sent: message text, names and times</li>
        <li><Icon name="close" size={18} />Not sent: photos, voice notes, phone numbers</li>
      </ul>
      <p className="muted p2-small" style={{ margin: 0 }}>{c.kind === 'group' ? 'Group members are not told. ' : ''}You can turn this off any time from this chat.</p>
      <div className="row center"><OvalButton icon="close" label="Not now" variant="ghost" onClick={onClose} /><OvalButton icon="sparkles" label="Allow and summarise" size="lg" onClick={() => void api().aiSetConsent(c.id, true).then(run).catch((e) => { setError(errText(e)); setStep('done'); })} /></div>
    </Modal>
  );
  return (
    <div className="p2-summary" role="status">
      <img src="/brand/jack.png" alt="" />
      <div className="p2-col" style={{ flex: 1, gap: 4 }}>
        <strong>{step === 'busy' ? 'Jack is reading the chat…' : error ? 'Couldn’t summarise' : `Summary of ${s!.count} message${s!.count === 1 ? '' : 's'}`}</strong>
        {step === 'busy' ? <span className="ys-spin" aria-hidden /> : <span>{error ?? s!.text}</span>}
        {step === 'done' && !error && <span className="muted p2-xs">AI summary · may miss details · <button type="button" className="link-btn p2-xs" onClick={() => { void api().aiSetConsent(c.id, false); onClose(); }}>Stop letting Jack read this chat</button></span>}
      </div>
      <button type="button" className="icon-btn" aria-label="Close summary" onClick={onClose}><Icon name="close" size={16} /></button>
    </div>
  );
}

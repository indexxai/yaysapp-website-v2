'use client';
import { useRouter } from 'next/navigation';
import { useMemo, useRef, useState } from 'react';
import { ApiError } from '@yays/shared';
import { api } from '@/lib/api';
import { Icon } from '@/lib/icons';
import { Modal } from '@/components/message-actions';
import { Card, SettingsFrame, useSaved } from '@/components/settings';
import { Banner, Field, OvalButton } from '@/components/ui';

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://yaysapp.com';
const VERSION = '1.0.0';

/** Answers match how this app really works. */
const FAQ: Array<[string, string]> = [
  ['I’m not getting notifications in this browser', 'Open Settings › Notifications and turn on Desktop notifications. If your browser blocks them, allow notifications for this site in the browser’s settings (the lock or tune icon next to the address). Muted chats and quiet hours don’t notify.'],
  ['Why does a message show one tick?', 'One tick means it reached YaysApp but not the other person’s phone or browser yet, usually because they are offline. Two ticks: delivered. Two orange ticks: read. If they turned read receipts off, you’ll only see delivered.'],
  ['How do I use YaysApp on another computer?', 'Sign in on yaysapp.com with your phone number or email. Your chats are kept on YaysApp, so they appear on every device. See and log out devices in Settings › Linked devices.'],
  ['How do I leave or delete a group?', 'Open the group, tap its name or Info, then Leave group. After leaving you can still read what was said while you were in it; Delete group removes it from your list.'],
  ['What happens when I block someone?', 'They can’t message or call you, and they won’t see when you’re online or your photo. They are not told. Unblock them any time from their chat or Settings › Privacy.'],
  ['I forgot my two-step PIN', 'On the PIN screen, choose Forgot PIN. We send a code to your other address (your email if you signed in with your phone, or your phone if you used email). Entering it turns two-step off so you can sign in and set a new PIN.'],
  ['How do I edit or delete a message?', 'Hover a message (or long-press on a phone) and open its menu. You can edit your messages for 15 minutes and delete them for everyone for 15 minutes; after that you can still delete them for yourself.'],
];

export default function HelpPage() { return <SettingsFrame>{() => <Help />}</SettingsFrame>; }

function Help() {
  const router = useRouter();
  const saved = useSaved();
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [reporting, setReporting] = useState(false);
  const shown = useMemo(() => { const t = q.trim().toLowerCase(); return t ? FAQ.filter(([a, b]) => `${a} ${b}`.toLowerCase().includes(t)) : FAQ; }, [q]);
  const contact = async () => {
    setBusy(true);
    try { const c = await api().supportChat(); router.push(`/chats?c=${c.id}`); } catch (e) { saved.fail(e instanceof ApiError ? e.message : 'Could not open the chat.'); setBusy(false); }
  };
  return (
    <>
      {saved.banner}
      <AskSupport />
      <div className="ys-field ys-field--pill help-search">
        <div className="ys-field__box"><Icon name="search" size={18} /><input className="ys-input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search help articles" aria-label="Search help" /></div>
      </div>
      <Card title="Popular questions">
        <div className="faq">
          {shown.map(([qq, a]) => <details key={qq}><summary>{qq}</summary><p>{a}</p></details>)}
          {!shown.length && <p className="muted" style={{ margin: '4px 18px 16px', fontSize: 14 }}>No answers match. Ask us in a chat instead.</p>}
        </div>
      </Card>
      <section className="set-card set-card--pad" style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }} aria-label="Contact us">
        <span className="ys-oval ys-oval--ember" style={{ width: 52 }}><Icon name="chat" size={22} /></span>
        <span style={{ flex: 1, display: 'flex', flexDirection: 'column' }}><strong>Contact us</strong><span className="muted" style={{ fontSize: 13 }}>Opens a chat with YaysApp Support. We reply in the same chat.</span></span>
        <OvalButton icon="chat" label="Start chat" size="sm" loading={busy} onClick={() => void contact()} />
      </section>
      <Card label="More">
        <button type="button" className="ys-row-item" onClick={() => setReporting(true)}>
          <span className="ys-oval ys-oval--wash" style={{ width: 32 }}><Icon name="flag" size={16} /></span>
          <span className="ys-row-item__text"><span className="ys-row-item__title">Report a problem</span><span className="ys-row-item__sub">Tell us what went wrong; we add your browser details</span></span>
        </button>
        <a className="ys-row-item" href={`${SITE}/terms`} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none', color: 'inherit' }}>
          <span className="ys-oval ys-oval--wash" style={{ width: 32 }}><Icon name="document" size={16} /></span>
          <span className="ys-row-item__text"><span className="ys-row-item__title">Terms and Privacy Policy</span></span>
          <Icon name="external" size={16} />
        </a>
      </Card>
      <span className="muted" style={{ textAlign: 'center', fontSize: 12 }}>YaysApp Web · version {VERSION}</span>
      {reporting && <ProblemDialog onClose={() => setReporting(false)} onSent={() => { setReporting(false); saved.ok('Thanks. We got your report and will look into it.'); }} />}
    </>
  );
}

function ProblemDialog({ onClose, onSent }: { onClose: () => void; onSent: () => void }) {
  const [text, setText] = useState('');
  const [shot, setShot] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const send = async () => {
    if (text.trim().length < 10) { setError('Tell us a bit more (at least 10 characters).'); return; }
    setBusy(true); setError(null);
    try {
      let screenshotKey: string | undefined;
      if (shot) {
        const t = await api().uploadTicket({ purpose: 'media', kind: 'image', contentType: shot.type, size: shot.size, name: shot.name });
        const r = await fetch(t.uploadUrl, { method: t.method, headers: t.headers, body: shot });
        if (!r.ok) throw new Error('upload');
        screenshotKey = t.key;
      }
      await api().reportProblem({ text: text.trim(), screenshotKey, userAgent: navigator.userAgent, appVersion: `web ${VERSION}`, page: document.referrer ? new URL(document.referrer).pathname : undefined });
      onSent();
    } catch (e) { setError(e instanceof ApiError ? e.message : 'Could not send. Try again.'); setBusy(false); }
  };
  return (
    <Modal title="Report a problem" onClose={onClose}>
      {error && <Banner>{error}</Banner>}
      <Field id="problem" label="What happened?" hint="What you did, what you expected, and what happened instead.">
        <textarea id="problem" className="ys-input" value={text} maxLength={2000} onChange={(e) => setText(e.target.value)} autoFocus />
      </Field>
      <div className="row" style={{ gap: 10 }}>
        <input ref={file} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => setShot(e.target.files?.[0] ?? null)} aria-label="Screenshot file" />
        <OvalButton icon="image" label={shot ? 'Change screenshot' : 'Add a screenshot'} size="sm" variant="ghost" onClick={() => file.current?.click()} />
        {shot && <span className="muted" style={{ fontSize: 13 }}>{shot.name}</span>}
      </div>
      <div className="modal__actions">
        <OvalButton icon="close" label="Cancel" size="sm" variant="soft" onClick={onClose} />
        <OvalButton icon="send" label="Send report" size="sm" variant="primary" disabled={busy} onClick={() => void send()} />
      </div>
    </Modal>
  );
}

/** p05: Jack's AI answers first; "Talk to a person" opens a ticket in the Support chat with the whole question. */
function AskSupport() {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [answer, setAnswer] = useState<string | null>(null);
  const [busy, setBusy] = useState<'ask' | 'ticket' | null>(null);
  const [solved, setSolved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ask = async () => {
    setBusy('ask'); setError(null); setSolved(false);
    try { setAnswer((await api().supportAsk(q)).answer); } catch (e) { setError(e instanceof ApiError ? e.message : 'Could not ask. Try again.'); } finally { setBusy(null); }
  };
  const person = async () => {
    setBusy('ticket'); setError(null);
    try { const t = await api().supportTicket(q, answer ?? ''); router.push(`/chats?c=${t.conversationId}`); } catch (e) { setError(e instanceof ApiError ? e.message : 'Could not open a ticket.'); setBusy(null); }
  };
  return (
    <section className="set-card set-card--pad" aria-labelledby="ask-h">
      <div className="row" style={{ gap: 12 }}><img src="/brand/jack.png" alt="" style={{ width: 28 }} /><h3 id="ask-h" style={{ margin: 0 }}>What’s going wrong?</h3></div>
      <div className="ys-field"><div className="ys-field__box"><textarea className="ys-input" rows={2} value={q} maxLength={1000} onChange={(e) => { setQ(e.target.value); setAnswer(null); }} placeholder="For example: my check-in didn’t add INEX" aria-label="Describe the problem" style={{ resize: 'vertical' }} /></div></div>
      {error && <Banner>{error}</Banner>}
      {answer === null ? (
        <div className="row center"><OvalButton icon="sparkles" label="Get an answer" size="md" loading={busy === 'ask'} disabled={q.trim().length < 3} onClick={() => void ask()} /></div>
      ) : (
        <>
          <div className="p2-support-answer"><span className="muted p2-xs">Jack’s AI</span><p>{answer}</p></div>
          {solved ? <Banner tone="success">Glad that helped.</Banner> : (
            <div className="row center" style={{ gap: 22 }}>
              <OvalButton icon="check" label="That solved it" size="sm" variant="soft" onClick={() => setSolved(true)} />
              <OvalButton icon="person-circle" label="Talk to a person" size="sm" loading={busy === 'ticket'} onClick={() => void person()} />
            </div>
          )}
          <p className="muted p2-xs" style={{ margin: 0, textAlign: 'center' }}>Our team sees the whole question and answer, so you won’t need to repeat yourself.</p>
        </>
      )}
    </section>
  );
}

'use client';
import { useEffect, useState } from 'react';
import type { AiSummary, ConversationSummary } from '@yays/shared';
import { api } from '@/lib/api';
import { Icon } from '@/lib/icons';
import { errText } from '@/lib/phase2';
import { Modal } from './message-actions';
import { OvalButton } from './ui';

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

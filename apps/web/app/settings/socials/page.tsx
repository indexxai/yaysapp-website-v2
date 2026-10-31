'use client';
import { useState } from 'react';
import { SOCIAL_NETWORKS, type SocialNetwork, type SocialsView } from '@yays/shared';
import { api } from '@/lib/api';
import { Icon } from '@/lib/icons';
import { Card, SettingsFrame, useSaved } from '@/components/settings';
import { Field, OvalButton } from '@/components/ui';
import { Modal } from '@/components/message-actions';
import { errText, useLoad } from '@/lib/phase2';
import { SOCIAL } from '@/lib/socials';


export default function SocialsPage() { return <SettingsFrame>{() => <Socials />}</SettingsFrame>; }

/** p16: socials shown on my profile, and who sees them. */
function Socials() {
  const v = useLoad(() => api().socials());
  const saved = useSaved();
  const [editing, setEditing] = useState<SocialNetwork | null>(null);
  const set = (d: SocialsView) => v.setData(d);
  const remove = async (n: SocialNetwork) => { try { set(await api().removeSocial(n)); saved.ok(`${SOCIAL[n].name} removed.`); } catch (e) { saved.fail(errText(e)); } };
  const vis = async (x: SocialsView['visibility']) => { try { set(await api().socialVisibility(x)); saved.ok('Saved.'); } catch (e) { saved.fail(errText(e)); } };
  const d = v.data;
  return (
    <>
      {saved.banner}
      <p className="muted" style={{ margin: 0 }}>Show your socials on your YaysApp profile. You choose who can see them.</p>
      <Card title="Social accounts">
        {SOCIAL_NETWORKS.map((n) => {
          const l = d?.links.find((x) => x.network === n);
          return (
            <div key={n} className="ys-row-item">
              <span className="ys-oval" style={{ width: 40, ['--ys-oval-fill' as string]: SOCIAL[n].fill, ['--ys-oval-ink' as string]: '#fff' }}><Icon name={SOCIAL[n].icon} size={18} /></span>
              <span className="ys-row-item__text"><span className="ys-row-item__title">{SOCIAL[n].name}</span><span className="ys-row-item__sub">{l ? <a href={l.url} target="_blank" rel="noopener noreferrer">{l.handle}</a> : 'Not added'}</span></span>
              {l ? <OvalButton icon="close" label="Remove" size="sm" variant="ghost" onClick={() => void remove(n)} /> : <OvalButton icon="plus" label="Add" size="sm" variant="soft" onClick={() => setEditing(n)} />}
            </div>
          );
        })}
      </Card>
      <Card title="Who can see my socials">
        <div className="ys-tabs" role="radiogroup" aria-label="Who can see my socials" style={{ margin: '4px 18px 18px' }}>
          {(['everyone', 'contacts', 'nobody'] as const).map((x) => <button key={x} type="button" role="radio" className="ys-tab" aria-checked={d?.visibility === x} aria-selected={d?.visibility === x} onClick={() => void vis(x)}>{x === 'everyone' ? 'Everyone' : x === 'contacts' ? 'My contacts' : 'Nobody'}</button>)}
        </div>
      </Card>
      {editing && <AddSocial network={editing} onClose={() => setEditing(null)} onSaved={(x) => { set(x); setEditing(null); saved.ok(`${SOCIAL[editing].name} added.`); }} />}
    </>
  );
}

function AddSocial({ network, onClose, onSaved }: { network: SocialNetwork; onClose: () => void; onSaved: (v: SocialsView) => void }) {
  const [handle, setHandle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => { setBusy(true); setError(null); try { onSaved(await api().setSocial(network, handle)); } catch (e) { setError(errText(e)); } finally { setBusy(false); } };
  return (
    <Modal title={`Add ${SOCIAL[network].name}`} onClose={onClose}>
      <Field id="soc" label="Username" error={error} hint="Just the username, like @sara."><input id="soc" className="ys-input" value={handle} onChange={(e) => setHandle(e.target.value)} placeholder="@username" onKeyDown={(e) => { if (e.key === 'Enter' && handle.trim()) void save(); }} /></Field>
      <div className="row center"><OvalButton icon="check" label="Save" size="lg" loading={busy} disabled={!handle.trim()} onClick={() => void save()} /></div>
    </Modal>
  );
}

'use client';
import { useEffect, useState } from 'react';
import { SOCIAL_NETWORKS, type SocialNetwork, type SocialsView } from '@yays/shared';
import { api } from '@/lib/api';
import { Icon } from '@/lib/icons';
import { Card, SettingsFrame, useSaved } from '@/components/settings';
import { Switch } from '@/components/group';
import { Banner, Field, OvalButton } from '@/components/ui';
import { Modal } from '@/components/message-actions';
import { SocialChips } from '@/components/socials';
import { errText, useLoad } from '@/lib/phase2';
import { SOCIAL } from '@/lib/socials';

export default function SocialsPage() { return <SettingsFrame>{() => <Socials />}</SettingsFrame>; }

const BACK: Record<string, ['success' | 'danger' | 'warning', string]> = {
  linked: ['success', 'Facebook linked. It shows on your profile, and you can use it to sign in if you turned that on.'],
  taken: ['danger', 'That Facebook account is already linked to another YaysApp account.'],
  cancelled: ['warning', 'Facebook linking was cancelled. Nothing changed.'],
  error: ['danger', 'Facebook didn’t confirm. Try again.'],
  expired: ['danger', 'That took too long. Try linking Facebook again.'],
};

/** p27–p30, p34: Facebook (confirmed through Facebook), other socials by username, and who sees them. */
function Socials() {
  const v = useLoad(() => api().socials());
  const saved = useSaved();
  const [editing, setEditing] = useState<SocialNetwork | null>(null);
  const [linking, setLinking] = useState(false);
  const [back, setBack] = useState<[string, string] | null>(null);
  useEffect(() => {
    const fb = new URLSearchParams(location.search).get('fb');
    if (fb && BACK[fb]) { setBack(BACK[fb]); history.replaceState(null, '', '/settings/socials'); }
  }, []);
  const set = (d: SocialsView) => v.setData(d);
  const run = async (fn: () => Promise<SocialsView>, ok: string) => { setBack(null); try { set(await fn()); saved.ok(ok); } catch (e) { saved.fail(errText(e)); } };
  const d = v.data, fb = d?.facebook ?? null;
  const others = d?.links.filter((l) => l.network !== 'facebook') ?? [];
  return (
    <>
      {back && <Banner tone={back[0] as 'success' | 'danger' | 'warning'}>{back[1]}</Banner>}
      {saved.banner}
      <p className="muted" style={{ margin: 0 }}>Link your socials to show them on your profile. Linking Facebook also lets you sign in with it.</p>
      <Card title="Social accounts">
        <div className="ys-row-item" data-testid="facebook-row">
          <span className="ys-oval" style={{ width: 40, ['--ys-oval-fill' as string]: SOCIAL.facebook.fill, ['--ys-oval-ink' as string]: '#fff' }}><Icon name="facebook" size={18} /></span>
          <span className="ys-row-item__text">
            <span className="ys-row-item__title">Facebook</span>
            <span className="ys-row-item__sub" style={fb ? { color: 'var(--success-ink)', fontWeight: 700 } : undefined}>{fb ? `${fb.name} · verified` : d && !d.facebookAvailable ? 'Not set up on this server yet' : 'Not linked'}</span>
          </span>
          {fb ? <OvalButton icon="close" label="Unlink" size="sm" variant="ghost" onClick={() => void run(() => api().unlinkFacebook(), 'Facebook unlinked.')} />
            : <OvalButton icon="link" label="Link" size="sm" disabled={!d?.facebookAvailable} onClick={() => setLinking(true)} />}
        </div>
        {SOCIAL_NETWORKS.map((n) => {
          const l = others.find((x) => x.network === n);
          return (
            <div key={n} className="ys-row-item">
              <span className="ys-oval" style={{ width: 40, ['--ys-oval-fill' as string]: SOCIAL[n].fill, ['--ys-oval-ink' as string]: '#fff' }}><Icon name={SOCIAL[n].icon} size={18} /></span>
              <span className="ys-row-item__text"><span className="ys-row-item__title">{SOCIAL[n].name}</span><span className="ys-row-item__sub">{l ? <a href={l.url ?? '#'} target="_blank" rel="noopener noreferrer">{l.handle}</a> : 'Not added'}</span></span>
              {l ? <OvalButton icon="close" label="Remove" size="sm" variant="ghost" onClick={() => void run(() => api().removeSocial(n), `${SOCIAL[n].name} removed.`)} /> : <OvalButton icon="plus" label="Add" size="sm" variant="soft" onClick={() => setEditing(n)} />}
            </div>
          );
        })}
      </Card>
      <Card title="Sign in with Facebook">
        <div style={{ padding: '0 18px 8px', opacity: fb ? 1 : 0.55 }}>
          <Switch label="Sign in with Facebook" hint={fb ? (fb.login ? 'On. Use “Continue with Facebook” on the sign-in page. Your two-step PIN is still asked.' : 'Off. Only your phone number and email sign you in.') : 'Link Facebook first.'}
            on={!!fb?.login} disabled={!fb} onChange={(on) => void run(() => api().facebookLogin(on), on ? 'You can sign in with Facebook.' : 'Signing in with Facebook is off.')} />
        </div>
      </Card>
      <Card title="Who can see my socials">
        <div className="ys-tabs" role="radiogroup" aria-label="Who can see my socials" style={{ margin: '4px 18px 18px' }}>
          {(['everyone', 'contacts', 'nobody'] as const).map((x) => <button key={x} type="button" role="radio" className="ys-tab" aria-checked={d?.visibility === x} aria-selected={d?.visibility === x} onClick={() => void run(() => api().socialVisibility(x), 'Saved.')}>{x === 'everyone' ? 'Everyone' : x === 'contacts' ? 'My contacts' : 'Nobody'}</button>)}
        </div>
      </Card>
      {!!d?.links.length && (
        <Card title="How your profile shows them">
          <div style={{ padding: '0 18px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <SocialChips links={d.links} />
            <span className="muted p2-small">{d.visibility === 'everyone' ? 'Anyone who opens your profile sees these.' : d.visibility === 'contacts' ? 'Your contacts see these. Others see your name and photo only.' : 'Hidden from everyone. Only you see them here.'} The tick means it was confirmed through that network.</span>
          </div>
        </Card>
      )}
      {editing && <AddSocial network={editing} onClose={() => setEditing(null)} onSaved={(x) => { set(x); setEditing(null); saved.ok(`${SOCIAL[editing].name} added.`); }} />}
      {linking && <LinkFacebook onClose={() => setLinking(false)} />}
    </>
  );
}

/** W15 / p28: what linking shares, then off to Facebook's own page. */
function LinkFacebook({ onClose }: { onClose: () => void }) {
  const [login, setLogin] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const go = async () => { setBusy(true); setError(null); try { location.href = (await api().linkFacebook(login)).url; } catch (e) { setError(errText(e)); setBusy(false); } };
  return (
    <Modal title="Link your Facebook" onClose={onClose} eyebrow="Facebook opens so you can confirm it’s you">
      <div className="p2-gets">
        <div><strong>YaysApp gets</strong><br />Your name and profile photo<br />A Facebook ID only for YaysApp</div>
        <div><strong>YaysApp never</strong><br />Sees your password or messages<br />Posts or reads your friends list</div>
      </div>
      <Switch label="Also sign in with Facebook" hint="You can turn this off later." on={login} onChange={setLogin} />
      {error && <Banner>{error}</Banner>}
      <button type="button" className="fb-btn" onClick={() => void go()} disabled={busy} aria-busy={busy || undefined}><Icon name="facebook" size={20} />Continue with Facebook</button>
    </Modal>
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

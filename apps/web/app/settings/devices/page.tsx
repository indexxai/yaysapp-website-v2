'use client';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Modal } from '@/components/message-actions';
import { ApiError, type DeviceSession } from '@yays/shared';
import { api } from '@/lib/api';
import { SettingsFrame } from '@/components/settings';
import { Banner, OvalButton } from '@/components/ui';
import { Icon } from '@/lib/icons';

const ago = (iso: string) => {
  const s = Math.round((Date.now() - Date.parse(iso)) / 1000);
  if (s < 90) return 'active now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
};

export default function DevicesPage() { return <SettingsFrame>{() => <Devices />}</SettingsFrame>; }

function Devices() {
  const [list, setList] = useState<DeviceSession[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: 'danger' | 'success'; text: string } | null>(null);
  const [linking, setLinking] = useState(false);
  const load = useCallback(async () => { try { setList(await api().devices()); } catch (e) { setMsg({ tone: 'danger', text: e instanceof ApiError ? e.message : 'Could not load devices.' }); } }, []);
  useEffect(() => { void load(); }, [load]);

  const act = async (id: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(id); setMsg(null);
    try { await fn(); setMsg({ tone: 'success', text: ok }); await load(); }
    catch (e) { setMsg({ tone: 'danger', text: e instanceof ApiError ? e.message : 'That did not work. Try again.' }); }
    finally { setBusy(null); }
  };

  return (
    <>
        {msg && <Banner tone={msg.tone}>{msg.text}</Banner>}
        <section className="set-card" aria-label="Signed-in devices">
          {list?.map((d) => (
            <div key={d.id} className="ys-row-item" style={{ minHeight: 66, cursor: 'default', background: d.current ? 'var(--ember-wash)' : undefined }} data-testid="device-row">
              <span className="ys-oval ys-oval--wash" style={{ width: 40 }}><Icon name={d.platform === 'web' ? 'globe' : 'phone'} size={18} /></span>
              <span className="ys-row-item__text">
                <span className="ys-row-item__title">{d.name}</span>
                <span className="ys-row-item__sub" style={d.current ? { color: 'var(--success-ink)', fontWeight: 700 } : undefined}>{d.current ? 'This browser · active now' : `Last active ${ago(d.lastActiveAt)}`}</span>
              </span>
              {!d.current && <OvalButton icon="logout" label="Log out" size="sm" variant="danger" loading={busy === d.id} onClick={() => act(d.id, () => api().revokeDevice(d.id), `${d.name} was logged out.`)} />}
            </div>
          ))}
        </section>
        <div role="note" className="perm-card" style={{ fontSize: 13, lineHeight: '19px' }}><Icon name="shield" size={18} /><span style={{ flex: 1, color: 'var(--ink-soft)' }}><strong style={{ color: 'var(--ink)' }}>Don’t recognise a device?</strong> Log it out, then turn on two-step verification.</span></div>
        <div className="row center" style={{ gap: 32 }}>
          <OvalButton icon="qr" label="Link a device" size="sm" variant="primary" onClick={() => setLinking(true)} />
          {list && list.length > 1 && <OvalButton icon="logout" label="Log out all other devices" size="sm" variant="danger" loading={busy === 'others'} onClick={() => act('others', () => api().revokeOtherDevices(), 'All other devices were logged out.')} />}
        </div>
      {linking && <LinkDeviceDialog onClose={() => setLinking(false)} onLinked={(name) => { setLinking(false); setMsg({ tone: 'success', text: `${name} is now signed in to your account.` }); void load(); }} />}
    </>
  );
}

/** Signs in another browser: type the code shown under its QR code. (Phones scan the QR code itself.) */
function LinkDeviceDialog({ onClose, onLinked }: { onClose: () => void; onLinked: (name: string) => void }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setError(null);
    try { onLinked((await api().linkApprove({ code })).deviceName); }
    catch (err) { setError(err instanceof ApiError ? err.message : 'That did not work. Try again.'); setBusy(false); }
  };
  return (
    <Modal title="Link a device" onClose={onClose}>
      <form className="link-device" onSubmit={(e) => void submit(e)}>
        <p className="muted" style={{ margin: 0, fontSize: 14, lineHeight: '21px' }}>On the other computer, open YaysApp, choose <strong>Scan a QR code</strong>, and type the 8-character code shown under the QR code. Only do this for a device you own.</p>
        {error && <Banner>{error}</Banner>}
        <input className="ys-input link-device__code" aria-label="Code from the other device" placeholder="XXXX-XXXX" maxLength={9} autoComplete="off" value={code} onChange={(e) => setCode(e.target.value)} autoFocus />
        <div className="modal__actions">
          <button type="button" className="btn btn--ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn" disabled={busy || code.replace(/[^a-z0-9]/gi, '').length !== 8}>Link device</button>
        </div>
      </form>
    </Modal>
  );
}

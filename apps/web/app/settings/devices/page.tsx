'use client';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { ApiError, type DeviceSession } from '@yays/shared';
import { api } from '@/lib/api';
import { AppShell } from '@/components/app-shell';
import { SettingsNav } from '@/components/settings-nav';
import { Banner, OvalButton } from '@/components/ui';
import { useMe } from '@/components/use-me';
import { Icon } from '@/lib/icons';

const ago = (iso: string) => {
  const s = Math.round((Date.now() - Date.parse(iso)) / 1000);
  if (s < 90) return 'active now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
};

export default function Devices() {
  const router = useRouter();
  const { me } = useMe();
  const [list, setList] = useState<DeviceSession[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: 'danger' | 'success'; text: string } | null>(null);
  const load = useCallback(async () => { try { setList(await api().devices()); } catch (e) { setMsg({ tone: 'danger', text: e instanceof ApiError ? e.message : 'Could not load devices.' }); } }, []);
  useEffect(() => { if (me) void load(); }, [me, load]);

  const act = async (id: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(id); setMsg(null);
    try { await fn(); setMsg({ tone: 'success', text: ok }); await load(); }
    catch (e) { setMsg({ tone: 'danger', text: e instanceof ApiError ? e.message : 'That did not work. Try again.' }); }
    finally { setBusy(null); }
  };

  return (
    <AppShell me={me}>
      <div style={{ maxWidth: 640, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <h1 style={{ margin: 0, font: '800 28px var(--font-display)' }}>Settings</h1>
        <SettingsNav />
        {msg && <Banner tone={msg.tone}>{msg.text}</Banner>}
        <section className="card" aria-label="Signed-in devices">
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
        <div className="row center" style={{ gap: 32 }}>
          {list && list.length > 1 && <OvalButton icon="logout" label="Log out all other devices" size="sm" variant="danger" loading={busy === 'others'} onClick={() => act('others', () => api().revokeOtherDevices(), 'All other devices were logged out.')} />}
          <OvalButton icon="logout" label="Log out of this browser" size="sm" variant="ghost" loading={busy === 'me'} onClick={async () => { setBusy('me'); await api().logout().catch(() => undefined); router.replace('/sign-in'); }} />
        </div>
      </div>
    </AppShell>
  );
}

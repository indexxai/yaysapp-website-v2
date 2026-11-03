'use client';
import { useState } from 'react';
import { ApiError } from '@yays/shared';
import { api } from '@/lib/api';
import { Icon } from '@/lib/icons';
import { Card, SettingsFrame, useSaved } from '@/components/settings';
import { Banner, Field, OvalButton } from '@/components/ui';
import { errText, useLoad } from '@/lib/phase2';

export default function IndexxPage() { return <SettingsFrame>{(me) => <Indexx email={me.email} />}</SettingsFrame>; }

/** p15: link the Indexx account (BTCY, Indexx Pay, Exchange, EMMM). */
function Indexx({ email }: { email: string | null }) {
  const s = useLoad(() => api().indexx());
  const saved = useSaved();
  const [value, setValue] = useState(email ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const link = async () => { setBusy(true); setError(null); try { s.setData(await api().linkIndexx(value)); saved.ok('Indexx account linked.'); } catch (e) { setError(e instanceof ApiError ? e.message : errText(e)); } finally { setBusy(false); } };
  const unlink = async () => { setBusy(true); try { s.setData(await api().unlinkIndexx()); saved.ok('Unlinked.'); } catch (e) { saved.fail(errText(e)); } finally { setBusy(false); } };
  const d = s.data;
  return (
    <>
      {saved.banner}
      <section className="set-card set-card--pad p2-indexx">
        <div className="row" style={{ gap: 14 }}>
          <span className="ys-oval" style={{ width: 60, ['--ys-oval-fill' as string]: '#ffffff' }}><img src="/brand/products/indexx.png" alt="" style={{ width: "62%", height: "62%", objectFit: "contain" }} /></span>
          <span className="p2-col" style={{ flex: 1 }}><strong style={{ fontSize: 18 }}>One account for every Indexx product</strong><span className="muted">Link your Indexx Zodiac account to see BTCY, EMMM and wallet balances here and use one invite code everywhere.</span></span>
        </div>
        <ul className="p2-perms">
          <li><Icon name="eye" size={18} />Read your balances and activity (read-only)</li>
          <li><Icon name="person-add" size={18} />Use your Indexx referral code for invites</li>
          <li><Icon name="lock" size={18} />Never move money without your payment PIN</li>
        </ul>
        {s.error && <Banner>{s.error}</Banner>}
        {d && !d.available && <Banner tone="info">Linking Indexx accounts isn’t available yet.</Banner>}
        {d?.linked ? (
          <div className="p2-linked">
            <span className="ys-oval ys-oval--success" style={{ width: 40 }}><Icon name="check" size={18} /></span>
            <span className="p2-col" style={{ flex: 1 }}><strong>Linked</strong><span className="muted">{d.email} · since {new Date(d.linkedAt!).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })}</span></span>
            <OvalButton icon="close" label="Unlink" size="sm" variant="ghost" loading={busy} onClick={() => void unlink()} />
          </div>
        ) : d?.available && (
          <>
            <Field id="ix-email" label="Indexx account email" error={error} hint={email && value.trim().toLowerCase() !== email.toLowerCase() ? 'This is different from your YaysApp email. You can still link it; your chats stay the same.' : undefined}>
              <input id="ix-email" className="ys-input" type="email" value={value} onChange={(e) => setValue(e.target.value)} autoComplete="email" />
            </Field>
            <div className="row center"><OvalButton icon="link" label="Link Indexx account" size="lg" loading={busy} disabled={!value.trim()} onClick={() => void link()} /></div>
          </>
        )}
      </section>
      <Card label="What linking shows">
        <div className="ys-row-item"><span className="ys-row-item__text"><span className="ys-row-item__title">Wallet</span><span className="ys-row-item__sub">BTCY Nuggets, USDXX and Exchange balances; convert points</span></span></div>
        <div className="ys-row-item"><span className="ys-row-item__text"><span className="ys-row-item__title">Pay in chat</span><span className="ys-row-item__sub">Send and request USDXX in one-to-one chats</span></span></div>
        <div className="ys-row-item"><span className="ys-row-item__text"><span className="ys-row-item__title">BTCY bonus</span><span className="ys-row-item__sub">Invites, mining days and Alchemy count toward INEX</span></span></div>
      </Card>
    </>
  );
}

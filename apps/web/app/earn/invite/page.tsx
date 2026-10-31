'use client';
import { useState } from 'react';
import { REFERRAL_POINTS } from '@yays/shared';
import { AppShell } from '@/components/app-shell';
import { Avatar, Banner, LineArt, OvalButton } from '@/components/ui';
import { useMe } from '@/components/use-me';
import { api } from '@/lib/api';
import { inviteLink, useLoad } from '@/lib/phase2';

const TONE = { pending: ['warning', 'Pending'], rewarded: ['success', 'Rewarded'], not_eligible: ['neutral', 'Not eligible'] } as const;

/** p08: my invite code and how each invite went. */
export default function InvitePage() {
  const { me } = useMe();
  const r = useLoad(() => api().referrals());
  const [copied, setCopied] = useState<'code' | 'link' | null>(null);
  const copy = async (what: 'code' | 'link') => {
    if (!r.data) return;
    const text = what === 'code' ? r.data.code : inviteLink(r.data.code);
    try {
      if (what === 'link' && navigator.share) { await navigator.share({ title: 'YaysApp', text: `Join me on YaysApp with my code ${r.data.code}`, url: text }); return; }
      await navigator.clipboard.writeText(text); setCopied(what); setTimeout(() => setCopied(null), 2000);
    } catch { /* cancelled */ }
  };
  const d = r.data;
  return (
    <AppShell me={me}>
      <LineArt name="hype" width={360} opacity={0.18} className="p2-art p2-art--br" />
      <div className="p2-page p2-page--narrow">
        <div className="p2-head"><OvalButton icon="arrow-left" label="Earn" size="sm" variant="ghost" href="/earn" /><h1>Invite friends</h1></div>
        {r.error && <Banner>{r.error}</Banner>}
        <section className="p2-card p2-card--pad p2-invite">
          <h2>Get {REFERRAL_POINTS} points for each friend</h2>
          <p className="muted" style={{ margin: 0 }}>Your friend joins with your code, verifies their number and sends a first message. Your code also works across Indexx products.</p>
          <div className="p2-code p2-code--big"><span className="p2-code__label">Your code</span><strong>{d?.code ?? '…'}</strong><OvalButton icon={copied === 'code' ? 'check' : 'copy'} label={copied === 'code' ? 'Copied' : 'Copy'} size="sm" variant="soft" onClick={() => void copy('code')} /></div>
          <div className="row center"><OvalButton icon={copied === 'link' ? 'check' : 'share'} label={copied === 'link' ? 'Link copied' : 'Share invite link'} size="lg" onClick={() => void copy('link')} disabled={!d} /></div>
          <div className="p2-stats">
            <div><b>{d?.invited ?? '–'}</b><span>Invited</span></div>
            <div><b>{d?.joined ?? '–'}</b><span>Joined</span></div>
            <div><b>{d?.pointsEarned ?? '–'}</b><span>Points earned</span></div>
          </div>
        </section>
        <section className="p2-card" aria-labelledby="inv">
          <h2 id="inv" className="p2-card__title">Your invites</h2>
          {d && !d.friends.length && <p className="muted" style={{ margin: '0 18px 18px' }}>Nobody has used your code yet. Share your link to get started.</p>}
          {d?.friends.map((f, i) => (
            <div key={i} className="ys-row-item">
              <Avatar name={f.name} size={36} />
              <span className="ys-row-item__text"><span className="ys-row-item__title">{f.name}</span><span className="ys-row-item__sub">{f.sub}</span></span>
              <span className={`ys-tag ys-tag--${TONE[f.status][0]}`}>{TONE[f.status][1]}</span>
            </div>
          ))}
        </section>
      </div>
    </AppShell>
  );
}

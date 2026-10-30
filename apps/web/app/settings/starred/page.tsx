'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ApiError, attachmentLabel, type StarredItem } from '@yays/shared';
import { api } from '@/lib/api';
import { dayLabel, clock } from '@/lib/chat';
import { Icon } from '@/lib/icons';
import { SettingsFrame } from '@/components/settings';
import { Avatar, Banner, LineArt, OvalButton } from '@/components/ui';

export default function StarredPage() {
  return <SettingsFrame>{(me) => <Starred me={me.id} />}</SettingsFrame>;
}

/** m40: every starred message, newest first. Open one to see it in its chat. */
function Starred({ me }: { me: string }) {
  const [items, setItems] = useState<StarredItem[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [only, setOnly] = useState<string | null>(null);
  useEffect(() => { setOnly(new URLSearchParams(window.location.search).get('c')); }, []);
  const load = async (before?: string) => {
    try {
      const r = await api().starred(before, only ?? undefined);
      setItems((x) => [...(before ? x ?? [] : []), ...r.items]); setNext(r.next);
      const ids = [...new Set(r.items.map((i) => i.message.senderId))].filter((id) => id !== me && !names[id]);
      if (ids.length) { const ps = await api().profiles(ids.slice(0, 100)); setNames((n) => ({ ...n, ...Object.fromEntries(ps.map((p) => [p.id, p.displayName])) })); }
    } catch (e) { setError(e instanceof ApiError ? e.message : 'Could not load starred messages.'); }
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, [only]);
  const who = (id: string) => (id === me ? 'You' : names[id] ?? '…');
  return (
    <>
      {error && <Banner>{error}</Banner>}
      {only && <div className="row" style={{ justifyContent: 'space-between' }}><span className="muted">Starred in one chat</span><Link className="link-btn" href="/settings/starred" onClick={() => setOnly(null)}>Show all</Link></div>}
      {items === null && !error && <span className="ys-spin" aria-label="Loading" />}
      {items && !items.length && (
        <div className="pane-center pane-welcome" style={{ minHeight: 280 }}>
          <LineArt name="lantern" width={80} />
          <strong>No starred messages</strong>
          <span>Star a message from its menu to find it here later.</span>
        </div>
      )}
      {items?.map((s) => {
        const m = s.message;
        const mine = m.senderId === me;
        return (
          <Link key={m.id} href={`/chats?c=${s.conversationId}&m=${m.seq}&j=${Date.now()}`} className="star-item" data-testid="starred-item">
            <span className="star-item__head">
              <Avatar name={who(m.senderId)} size={24} />
              <strong>{who(m.senderId)}</strong><span className="muted">› {s.conversationName}</span>
              <span>{dayLabel(m.createdAt)}</span>
            </span>
            <span className={`ys-bubble ${mine ? 'ys-bubble--me' : 'ys-bubble--them'}`} style={{ alignSelf: mine ? 'flex-end' : 'flex-start' }}>
              {m.attachment && <span style={{ display: 'block', fontWeight: 700 }}>{attachmentLabel(m.attachment)}{m.attachment.kind === 'file' ? `: ${m.attachment.name}` : ''}</span>}
              {m.text}
              <span className="ys-bubble__meta"><Icon name="star" size={12} /><span>{clock(m.createdAt)}</span></span>
            </span>
          </Link>
        );
      })}
      {next && <div className="row center"><OvalButton icon="chevron-down" label="More" size="sm" variant="ghost" onClick={() => void load(next)} /></div>}
      {items && items.length > 0 && <p className="muted" style={{ fontSize: 12, margin: '0 8px' }}>Starred messages stay here even if you clear the chat. They go if the sender deletes them for everyone.</p>}
    </>
  );
}

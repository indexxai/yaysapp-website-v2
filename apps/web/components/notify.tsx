'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { messagePreview, systemText, type ChatMessage, type ConversationSummary } from '@yays/shared';
import { Icon } from '@/lib/icons';
import { useChatState, useEngine } from '@/lib/chat';
import { bannerDismissed, dismissBanner, enablePush, pushState, refreshPush, type PushState } from '@/lib/push';
import { Avatar, OvalButton } from './ui';

/** "Turn on notifications" under the chat list header, until turned on or dismissed. */
export function NotifyBanner() {
  const [state, setState] = useState<PushState | null>(null);
  const [hidden, setHidden] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setState(pushState()); setHidden(bannerDismissed()); void refreshPush(); }, []);
  if (!state || state === 'unsupported' || state === 'on' || (hidden && state !== 'blocked') || (state === 'blocked' && !error)) return null;
  return (
    <div className="notify-banner" role="region" aria-label="Notifications">
      <span className="ys-oval ys-oval--ember" style={{ width: 32 }}><Icon name="bell" size={16} /></span>
      <span className="notify-banner__text">
        {state === 'blocked'
          ? <><strong>Notifications are blocked</strong><br /><span className="muted">{error}</span></>
          : <><strong>Turn on notifications</strong><br /><span className="muted">Get new messages while this tab is in the background.</span></>}
      </span>
      {state === 'off' && (
        <>
          <OvalButton icon="check" label="Allow" size="sm" variant="soft" loading={busy} onClick={async () => {
            setBusy(true);
            try {
              const r = await enablePush();
              setState(r);
              if (r === 'blocked') setError('Allow notifications for this site in your browser settings, then reload.');
            } catch { setError('Couldn’t turn on notifications. Try again.'); setState('blocked'); }
            finally { setBusy(false); }
          }} />
          <button type="button" className="icon-btn" aria-label="Not now" onClick={() => { dismissBanner(); setHidden(true); }}><Icon name="close" size={16} /></button>
        </>
      )}
      {state === 'blocked' && <button type="button" className="icon-btn" aria-label="Dismiss" onClick={() => { setError(null); dismissBanner(); }}><Icon name="close" size={16} /></button>}
    </div>
  );
}

interface Toast { id: string; conversationId: string; title: string; body: string; photo: string | null }

/**
 * While the app is open: a small banner for messages in other chats, the unread count in the tab title,
 * and opening a chat when its notification is clicked.
 */
export function Attention() {
  const engine = useEngine();
  const s = useChatState();
  const router = useRouter();
  const [toasts, setToasts] = useState<Toast[]>([]);
  useEffect(() => engine.onIncoming((m: ChatMessage, c: ConversationSummary) => {
    if (c.mutedUntil && Date.parse(c.mutedUntil) > Date.now()) return;
    const sender = engine.nameOf(m.senderId) === '…' ? c.lastSenderName ?? '' : engine.nameOf(m.senderId);
    const preview = m.type === 'system' && m.system ? systemText(m.system, m.senderId, (u) => engine.nameOf(u)) : messagePreview(m);
    const t: Toast = {
      id: m.id, conversationId: c.id, title: c.group?.name ?? c.peer?.displayName ?? sender,
      body: c.kind === 'group' && m.type !== 'system' ? `${sender.split(' ')[0]}: ${preview}` : preview, photo: c.group?.photoUrl ?? c.peer?.photoUrl ?? null,
    };
    setToasts((x) => [...x.filter((y) => y.conversationId !== c.id), t].slice(-3));
    setTimeout(() => setToasts((x) => x.filter((y) => y.id !== t.id)), 5000);
  }), [engine]);
  // "(3) YaysApp": chats with something unread.
  const count = s.order.filter((id) => { const c = s.conversations[id]; return c && c.unread > 0 && !c.archived && !(c.mutedUntil && Date.parse(c.mutedUntil) > Date.now()); }).length;
  useEffect(() => { document.title = count ? `(${count}) YaysApp` : 'YaysApp'; }, [count]);
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    const onMsg = (e: MessageEvent) => { if (e.data?.type === 'open' && typeof e.data.url === 'string' && e.data.url.startsWith('/')) router.push(e.data.url); };
    navigator.serviceWorker.addEventListener('message', onMsg);
    return () => navigator.serviceWorker.removeEventListener('message', onMsg);
  }, [router]);
  if (!toasts.length) return null;
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <button key={t.id} type="button" className="toast" data-testid="toast" onClick={() => { setToasts((x) => x.filter((y) => y.id !== t.id)); router.push(`/chats?c=${t.conversationId}`); }}>
          <Avatar name={t.title} photoUrl={t.photo} size={36} />
          <span className="toast__text"><strong>{t.title}</strong><span>{t.body}</span></span>
        </button>
      ))}
    </div>
  );
}

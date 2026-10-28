'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ApiError, formatBytes, type StorageReport } from '@yays/shared';
import { api } from '@/lib/api';
import { Card, SettingsFrame, useSaved } from '@/components/settings';
import { Avatar, Banner, OvalButton } from '@/components/ui';

const SINGULAR = { image: 'photo', video: 'video', file: 'document', voice: 'voice message' } as const;
const KINDS: Array<['image' | 'video' | 'file' | 'voice', string, string]> = [['image', 'Photos', 'var(--ember)'], ['video', 'Videos', 'var(--ember-deep)'], ['file', 'Documents', '#4f5fa8'], ['voice', 'Voice', '#5f9e1b']];

/** What this browser keeps: the saved chat list and recent messages (so chats open offline). Unsent messages are never cleared. */
function browserCache() {
  let bytes = 0;
  try { for (const k of Object.keys(localStorage)) if (k.startsWith('yays.cache.')) bytes += (localStorage.getItem(k)?.length ?? 0) * 2; } catch { /* none */ }
  return bytes;
}

export default function StoragePage() { return <SettingsFrame>{() => <Storage />}</SettingsFrame>; }

function Storage() {
  const saved = useSaved();
  const [r, setR] = useState<StorageReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cache, setCache] = useState(0);
  useEffect(() => { setCache(browserCache()); void api().storageReport().then(setR, (e) => setError(e instanceof ApiError ? e.message : 'Could not load.')); }, []);
  const clear = async () => {
    try { for (const k of Object.keys(localStorage)) if (k.startsWith('yays.cache.')) localStorage.removeItem(k); } catch { /* fine */ }
    try { for (const k of await caches.keys()) await caches.delete(k); } catch { /* fine */ }
    setCache(browserCache());
    saved.ok('Cleared. Chats load again from YaysApp next time you open them.');
  };
  return (
    <>
      {saved.banner}
      {error && <Banner>{error}</Banner>}
      <section className="set-card set-card--pad" aria-label="Shared in your chats">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
          <strong style={{ font: '800 26px var(--font-display)' }} data-testid="storage-total">{r ? formatBytes(r.total) : '…'}</strong>
          <span className="muted" style={{ fontSize: 13 }}>shared in your chats</span>
        </div>
        {r && r.total > 0 && (
          <div className="storage-bar" role="img" aria-label={KINDS.map(([k, l]) => `${l} ${formatBytes(r.byKind[k])}`).join(', ')}>
            {KINDS.map(([k, , c]) => r.byKind[k] ? <span key={k} style={{ width: `${(r.byKind[k] / r.total) * 100}%`, background: c }} /> : null)}
          </div>
        )}
        {r && <div className="storage-legend">{KINDS.map(([k, l, c]) => <span key={k}><i style={{ background: c }} />{l} {formatBytes(r.byKind[k])}</span>)}</div>}
        <span className="muted" style={{ fontSize: 12 }}>Photos show as small previews in chats; the full file loads when you open it.</span>
      </section>
      <Card title="This browser">
        <div className="set-row">
          <span className="set-row__text"><span>Saved chats and recent messages</span><small>Kept so your chats open instantly and offline. Clearing only removes this browser’s copy; your chats stay.</small></span>
          <span className="set-row__value" data-testid="cache-size">{formatBytes(cache)}</span>
          <OvalButton icon="trash" label="Clear" size="sm" variant="soft" onClick={() => void clear()} />
        </div>
      </Card>
      {r && r.chats.length > 0 && (
        <Card title="Largest chats">
          {r.chats.map((c) => (
            <Link key={c.conversationId} href={`/chats?c=${c.conversationId}`} className="ys-row-item" style={{ textDecoration: 'none', color: 'inherit' }}>
              <Avatar name={c.name} size={36} group={c.kind === 'group'} />
              <span className="ys-row-item__text">
                <span className="ys-row-item__title">{c.name}</span>
                <span className="ys-row-item__sub">{KINDS.filter(([k]) => c.counts[k]).map(([k, l]) => `${c.counts[k]} ${c.counts[k] === 1 ? SINGULAR[k] : l.toLowerCase()}`).join(' · ')}</span>
              </span>
              <strong style={{ font: '800 14px var(--font-display)' }}>{formatBytes(c.bytes)}</strong>
            </Link>
          ))}
        </Card>
      )}
    </>
  );
}

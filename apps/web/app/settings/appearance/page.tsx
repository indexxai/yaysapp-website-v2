'use client';
import { useEffect, useState } from 'react';
import { ApiError, attachmentLabel, systemText, type ChatMessage, type ConversationSummary } from '@yays/shared';
import { api } from '@/lib/api';
import { savePrefs, TEXT_SCALE, usePrefs, type LocalPrefs } from '@/lib/prefs';
import { Switch } from '@/components/group';
import { Card, SetRow, SettingsFrame, useSaved } from '@/components/settings';
import { OvalButton } from '@/components/ui';

const THEMES: Array<[LocalPrefs['theme'], string]> = [['light', 'Light'], ['dark', 'Dark'], ['system', 'Follow system']];
const SIZES = ['Smallest', 'Small', 'Default', 'Large', 'Largest'];

export default function AppearancePage() {
  return <SettingsFrame>{() => <Appearance />}</SettingsFrame>;
}

function Appearance() {
  const p = usePrefs();
  const saved = useSaved();
  const setPrefs = (v: Partial<LocalPrefs>) => { savePrefs(v).then(() => saved.ok('Saved. Your other devices use this too.'), (e) => saved.fail(e instanceof ApiError ? e.message : 'Saved in this browser only. Check your connection.')); };
  return (
    <>
      {saved.banner}
      <Card title="Theme">
        <div className="theme-grid" role="radiogroup" aria-label="Theme">
          {THEMES.map(([v, l]) => (
            <label key={v} className="theme-opt">
              <input type="radio" name="theme" checked={p.theme === v} onChange={() => setPrefs({ theme: v })} aria-label={l} />
              <span className={`theme-swatch theme-swatch--${v}`} aria-hidden><span className="s1" /><span className="s2"><i /><i /></span></span>
              {l}
            </label>
          ))}
        </div>
      </Card>
      <Card label="Chats">
        <SetRow label="Text size" hint="For messages in chats." htmlFor="text-size">
          <span className="set-row__value">{SIZES[p.textSize - 1]}</span>
          <input id="text-size" type="range" min={1} max={5} step={1} value={p.textSize} onChange={(e) => setPrefs({ textSize: Number(e.target.value) as LocalPrefs['textSize'] })} style={{ accentColor: 'var(--ember)', width: 140 }} aria-valuetext={SIZES[p.textSize - 1]} />
        </SetRow>
        <div className="set-row" aria-hidden><span className="ys-bubble ys-bubble--them" style={{ fontSize: `${15 * TEXT_SCALE[p.textSize - 1]}px`, lineHeight: `${22 * TEXT_SCALE[p.textSize - 1]}px` }}>This is how messages look.</span></div>
        <Switch on={p.enterToSend} onChange={(v) => setPrefs({ enterToSend: v })} label="Press Enter to send" hint="Off: Enter starts a new line and Ctrl+Enter sends." />
      </Card>
      <ExportChat />
      <Card title="Chat backup">
        <p className="muted" style={{ margin: '4px 18px 16px', fontSize: 14, lineHeight: '20px' }}>Your chats are kept safely on YaysApp’s servers, so they’re here whenever you sign in on a new browser. Your theme, text size, Enter to send and sound are saved to your account too, so every device looks the same.</p>
      </Card>
    </>
  );
}

/** Saves one chat as a plain text file, oldest message first. */
function ExportChat() {
  const saved = useSaved();
  const [chats, setChats] = useState<ConversationSummary[]>([]);
  const [pick, setPick] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { void api().conversations({ limit: 100 }).then((r) => { setChats(r.items); setPick(r.items[0]?.id ?? ''); }, () => undefined); }, []);
  const go = async () => {
    const c = chats.find((x) => x.id === pick);
    if (!c) return;
    setBusy(true); saved.clear();
    try {
      const name = c.group?.name ?? c.peer?.displayName ?? 'Chat';
      const all: ChatMessage[] = [];
      let before: number | undefined;
      for (let i = 0; i < 200; i++) {
        const page = await api().messages(c.id, { before, limit: 100 });
        all.unshift(...page.items);
        if (!page.hasMore || !page.items.length) break;
        before = page.items[0].seq;
      }
      const people = new Map<string, string>();
      const ids = [...new Set(all.map((m) => m.senderId))];
      for (let i = 0; i < ids.length; i += 100) for (const p of await api().profiles(ids.slice(i, i + 100))) people.set(p.id, p.displayName);
      const me = (await api().me()).id;
      const who = (id: string) => (id === me ? 'You' : people.get(id) ?? 'Deleted account');
      const lines = all.map((m) => {
        const at = new Date(m.createdAt).toLocaleString();
        if (m.type === 'system' && m.system) return `[${at}] ${systemText(m.system, m.senderId, who)}`;
        const body = m.deleted ? 'This message was deleted' : [m.attachment ? `<${attachmentLabel(m.attachment)}: ${m.attachment.name}>` : '', m.text].filter(Boolean).join(' ');
        return `[${at}] ${who(m.senderId)}: ${body}`;
      });
      const text = `YaysApp chat with ${name}\nSaved ${new Date().toLocaleString()}\n\n${lines.join('\n')}\n`;
      const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
      Object.assign(document.createElement('a'), { href: url, download: `YaysApp chat with ${name.replace(/[\\/:*?"<>|]/g, '')}.txt` }).click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      saved.ok(`Saved ${all.length} message${all.length === 1 ? '' : 's'}.`);
    } catch (e) { saved.fail(e instanceof ApiError ? e.message : 'Could not export the chat.'); } finally { setBusy(false); }
  };
  return (
    <Card title="Export a chat">
      {saved.banner && <div style={{ padding: '0 18px' }}>{saved.banner}</div>}
      <SetRow label="Chat" hint="Saves the messages as a text file. Photos and files are listed by name." htmlFor="export-chat">
        <select id="export-chat" className="mini-select" style={{ maxWidth: 200 }} value={pick} onChange={(e) => setPick(e.target.value)}>
          {!chats.length && <option value="">No chats yet</option>}
          {chats.map((c) => <option key={c.id} value={c.id}>{c.group?.name ?? c.peer?.displayName ?? 'Chat'}</option>)}
        </select>
        <OvalButton icon="download" label="Export" size="sm" variant="soft" loading={busy} disabled={!pick} onClick={() => void go()} />
      </SetRow>
    </Card>
  );
}

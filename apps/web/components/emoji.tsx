'use client';
import { useEffect, useRef, useState } from 'react';
import { Icon } from '@/lib/icons';

const GROUPS: Array<{ name: string; icon: 'clock' | 'smile' | 'heart' | 'people' | 'gift' | 'leaf' | 'flash'; list: string }> = [
  { name: 'Smileys', icon: 'smile', list: '😀 😃 😄 😁 😆 😅 😂 🤣 😊 😇 🙂 🙃 😉 😌 😍 🥰 😘 😗 😙 😚 😋 😛 😝 😜 🤪 🤨 🧐 🤓 😎 🥳 😏 😒 😞 😔 😟 😕 🙁 😣 😖 😫 😩 🥺 😢 😭 😤 😠 😡 🤯 😳 🥵 🥶 😱 😨 😰 😥 😓 🤗 🤔 🤭 🤫 🤥 😶 😐 😑 😬 🙄 😯 😦 😧 😮 😲 🥱 😴 🤤 😪 😵 🤐 🥴 🤢 🤮 🤧 😷 🤒 🤕' },
  { name: 'People', icon: 'people', list: '👋 🤚 🖐️ ✋ 🖖 👌 🤌 🤏 ✌️ 🤞 🤟 🤘 🤙 👈 👉 👆 👇 ☝️ 👍 👎 ✊ 👊 🤛 🤜 👏 🙌 👐 🤲 🤝 🙏 ✍️ 💪 🧠 👀 👁️ 👶 🧒 👦 👧 🧑 👨 👩 🧓 👴 👵 🙋 🙆 🙅 🤷 🤦 🙇 💁' },
  { name: 'Hearts', icon: 'heart', list: '❤️ 🧡 💛 💚 💙 💜 🖤 🤍 🤎 💔 ❣️ 💕 💞 💓 💗 💖 💘 💝 💯 💢 💥 💫 💦 💨 🔥 ✨ ⭐ 🌟 🎉 🎊' },
  { name: 'Food', icon: 'leaf', list: '🍏 🍎 🍐 🍊 🍋 🍌 🍉 🍇 🍓 🫐 🍈 🍒 🍑 🥭 🍍 🥥 🥝 🍅 🥑 🍆 🥔 🥕 🌽 🌶️ 🥒 🥬 🧄 🧅 🍞 🥐 🧀 🥚 🍳 🥞 🍗 🍖 🍔 🍟 🍕 🌭 🥪 🌮 🌯 🥙 🍝 🍜 🍲 🍛 🍣 🍱 🥟 🍤 🍚 🍰 🎂 🧁 🍮 🍭 🍫 🍩 🍪 ☕ 🍵 🥤 🧃' },
  { name: 'Things', icon: 'gift', list: '⚽ 🏀 🏈 ⚾ 🎾 🏏 🏸 🏓 🎮 🎲 🎯 🎵 🎶 🎤 🎧 📱 💻 ⌚ 📷 🎥 💡 📚 ✏️ 📌 📎 🔒 🔑 🎁 🎈 🏆 🥇 💰 💳 🚗 ✈️ 🚀 🏠 🕌 ⛅ 🌙 ☀️ 🌈 ☔ 🌸 🌹 🌻 🌴 🐶 🐱 🦁 🐼 🐦 🦋' },
];
const RECENT_KEY = 'yays.emoji.recent';
const recent = (): string[] => { try { return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as string[]; } catch { return []; } };

/** The emoji panel above the composer. Picking one types it where the cursor is. */
export function EmojiPicker({ onPick, onClose }: { onPick: (e: string) => void; onClose: () => void }) {
  const [tab, setTab] = useState(() => (recent().length ? 'Recent' : 'Smileys'));
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const away = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node) && !(e.target as HTMLElement).closest?.('[data-emoji-toggle]')) onClose(); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', away); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [onClose]);
  const tabs = [...(recent().length ? [{ name: 'Recent', icon: 'clock' as const, list: recent().join(' ') }] : []), ...GROUPS];
  const current = tabs.find((t) => t.name === tab) ?? tabs[0]!;
  const pick = (e: string) => {
    try { localStorage.setItem(RECENT_KEY, JSON.stringify([e, ...recent().filter((x) => x !== e)].slice(0, 24))); } catch { /* fine */ }
    onPick(e);
  };
  return (
    <div className="emoji-picker" ref={box} role="dialog" aria-label="Emoji">
      <div className="ys-tabs emoji-picker__tabs" role="tablist" aria-label="Emoji groups">
        {tabs.map((t) => (
          <button key={t.name} type="button" role="tab" className="ys-tab" aria-selected={t.name === current.name} aria-label={t.name} title={t.name} onClick={() => setTab(t.name)}><Icon name={t.icon} size={16} /></button>
        ))}
      </div>
      <div className="emoji-picker__grid" role="listbox" aria-label={current.name}>
        {current.list.split(' ').filter(Boolean).map((e) => (
          <button key={e} type="button" role="option" aria-selected={false} aria-label={e} onMouseDown={(ev) => ev.preventDefault()} onClick={() => pick(e)}>{e}</button>
        ))}
      </div>
    </div>
  );
}

'use client';
import { useState } from 'react';
import { CHAT_EARN_RULES, type ChatEarnToday, type Perk } from '@yays/shared';
import { Icon } from '@/lib/icons';
import { Bar } from '@/lib/phase2';

const WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** c01: today's conversations, the three tiers, new connections, the chat week and month, and how it all counts. */
export function ChatEarnCard({ chat }: { chat: ChatEarnToday }) {
  const [rules, setRules] = useState(false);
  const next = chat.tiers.find((x) => !x.reached);
  const settles = new Date(chat.settlesAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return (
    <section className="p2-card c2e" aria-labelledby="c2e-title" data-testid="chat-earn">
      <div className="p2-card__head p2-card__head--pad">
        <span className="ys-oval ys-oval--ember c2e__icon"><Icon name="chats" size={20} /></span>
        <span className="p2-col" style={{ flex: 1 }}>
          <span className="ys-eyebrow">Chat to Earn</span>
          <h2 id="c2e-title" data-testid="chat-earn-count">{chat.conversations} {chat.conversations === 1 ? 'conversation' : 'conversations'} today</h2>
          <span className="muted c2e__sub">{next ? `${next.of - chat.conversations} more for ${next.label}: ${next.reward}` : 'All 3 tiers reached today'}</span>
        </span>
      </div>
      <ul className="p2-tasks p2-tasks--compact">
        {chat.tiers.map((x) => (
          <li key={x.label}>
            <span className={`ys-oval ${x.reached ? 'ys-oval--ember' : 'ys-oval--wash'}`}><Icon name={x.reached ? 'check' : 'chat'} size={18} /></span>
            <span className="p2-tasks__text"><strong>{x.label} · {x.of} conversations</strong><span><Bar done={chat.conversations} of={x.of} />{Math.min(chat.conversations, x.of)} of {x.of}</span></span>
            <span className={`p2-tasks__pts${x.reached ? ' p2-tasks__pts--done' : ''}`}>{x.reached ? 'Pending' : x.reward.replace(' Jack’s AI messages', ' AI msgs')}</span>
          </li>
        ))}
      </ul>
      {chat.tiers[0]!.reached && <p className="c2e__note">Rewards are pending until the day is checked at {settles}.</p>}
      <div className="p2-stats c2e__stats">
        <div><b>{chat.newConnections}/{chat.newConnectionsMax}</b><span>New connections</span></div>
        <div><b>{chat.week.daysMet}/{chat.week.of}</b><span>Chat week</span></div>
        <div><b>{chat.month.weeks}/{chat.month.of}</b><span>Chat month</span></div>
      </div>
      <ol className="c2e__week" aria-label={`This week: Tier 1 on ${chat.week.daysMet} of ${chat.week.of} days`}>
        {chat.week.days.map((s, i) => (
          <li key={i} className={`c2e__day c2e__day--${s}`}><span aria-hidden>{s === 'met' ? <Icon name="check" size={12} /> : null}</span>{WEEK[i]}<span className="sr-only">{s === 'met' ? ': met' : s === 'today' ? ': today' : ''}</span></li>
        ))}
      </ol>
      <button type="button" className="c2e__toggle" aria-expanded={rules} onClick={() => setRules((v) => !v)} data-testid="chat-earn-rules">
        How it counts <Icon name={rules ? 'chevron-up' : 'chevron-down'} size={16} />
      </button>
      {rules && (
        <dl className="c2e__rules">
          {CHAT_EARN_RULES.map((r) => <div key={r.title}><dt>{r.title}</dt><dd>{r.body}</dd></div>)}
        </dl>
      )}
    </section>
  );
}

/** Rewards that aren't BTCY: a Turbo mining day, a coupon to pick. */
export function PerksCard({ perks }: { perks: Perk[] }) {
  return (
    <section className="p2-card" aria-labelledby="perks" data-testid="perks">
      <h2 id="perks" className="p2-card__title">Your perks</h2>
      <ul className="p2-tasks p2-tasks--compact">
        {perks.map((p) => (
          <li key={p.id}>
            <span className={`ys-oval ${p.status === 'ready' ? 'ys-oval--wash' : 'ys-oval--sunken'}`}><Icon name={p.kind === 'turbo_day' ? 'zap' : 'ticket'} size={18} /></span>
            <span className="p2-tasks__text"><strong>{p.title}</strong><span>{p.sub}</span></span>
            <span className={`p2-tasks__pts${p.status === 'ready' ? ' p2-tasks__pts--done' : ''}`}>{p.status === 'ready' ? 'Ready' : p.status === 'used' ? 'Used' : 'Expired'}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

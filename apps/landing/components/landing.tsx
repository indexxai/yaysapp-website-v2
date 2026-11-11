'use client';
import Link from 'next/link';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Icon, type IconName } from '@/lib/icons';
import { SIGN_IN_URL } from '@/lib/links';
import { CHECKIN_POINTS, PRODUCTS, SiteError, siteAsk, siteLead } from '@/lib/site';
import { setTheme, useTheme } from '@/lib/theme';
import { Field, LineArt, OvalButton } from './ui';

/* The YaysApp website. The same page as the web app's signed-out home (apps/web/components/landing.tsx), with the
   "Open web app" buttons going to the web app, and the Privacy, Terms, Support and Delete account pages alongside. */

const FEATURES: Array<[IconName, string, string]> = [
  ['chats', 'Chats', 'Private and group chats with photos, voice notes, files, replies and reactions.'],
  ['video', 'Voice and video calls', 'Call one person or the whole group, or share a link anyone can join.'],
  ['people', 'Communities', 'Bring related groups together, with announcements that reach every member.'],
  ['sparkles', 'Jack’s AI', 'Ask questions, summarise long chats, translate and write, right inside YaysApp.'],
];
const WAYS: Array<[IconName, string, string, string]> = [
  ['gift', 'Check in every day', 'Keep your streak going for bigger rewards', '+10 to +50'],
  ['chats', 'Chat with friends', 'Send messages in your chats and groups', '+10'],
  ['people', 'Post in communities', 'Join the conversation in groups you like', '+15'],
  ['person-add', 'Invite friends', 'When they join and send a first message', '+100'],
];
const SAFETY: Array<[IconName, string, string]> = [
  ['shield-check', 'Your number stays private', 'People find you by username. Choose who sees your photo, last seen and about.'],
  ['lock', 'Two-step verification', 'Add a PIN so nobody can sign in to your account with just a code.'],
  ['flag', 'Block and report', 'Block anyone in two taps. Reports go to our team and to community admins.'],
];
const FAQ: Array<[string, string]> = [
  ['Is YaysApp free?', 'Yes. Chats, calls and communities are free. Some Indexx products inside Explore have their own pricing.'],
  ['How do INEX rewards work?', 'You earn INEX for daily check-ins, chatting, posting in communities and inviting friends. Your wallet shows your balance and history.'],
  ['Can I use YaysApp on my computer?', 'Yes. Open the web app and scan the QR code with YaysApp on your phone, or sign in with a code.'],
  ['What is Jack’s AI?', 'An AI assistant built into YaysApp. It answers questions, summarises long chats and helps you write. It only reads a chat when you allow it.'],
  ['How do I start a community?', 'Go to Communities, choose New, add a name and pick the groups to bring in. Every community gets an announcements group.'],
];

/** Light or dark, the same setting the app uses (it carries over after signing in). */
function ThemeToggle() {
  const theme = useTheme();
  const dark = theme === 'dark' || (theme === 'system' && typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  return <OvalButton icon={dark ? 'sun' : 'moon'} label={dark ? 'Light' : 'Dark'} size="sm" variant="ghost" aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'} onClick={() => setTheme(dark ? 'light' : 'dark')} />;
}

/** The YaysApp wordmark, with white lettering on the dark theme. */
const Wordmark = () => <><img src="/brand/wordmark.png" alt="YaysApp" className="lp-logo lp-logo--light" /><img src="/brand/wordmark-dark.png" alt="YaysApp" className="lp-logo lp-logo--dark" /></>;

function Stores() {
  return (
    <div className="lp-stores">
      <span className="ys-store ys-store--soon" aria-label="App Store, coming soon"><Icon name="apple" size={22} /><span className="ys-store__txt"><small>Coming soon to</small><strong>App Store</strong></span></span>
      <span className="ys-store ys-store--soon" aria-label="Google Play, coming soon"><Icon name="download" size={22} /><span className="ys-store__txt"><small>Coming soon to</small><strong>Google Play</strong></span></span>
    </div>
  );
}
const Section = ({ id, label, eyebrow, title, lead, children, art }: { id?: string; label: string; eyebrow: string; title: string; lead?: string; children?: ReactNode; art?: ReactNode }) => (
  <section id={id} className="lp-section" aria-labelledby={`${label}-t`}>
    {art}
    <div className="lp-wrap">
      <div className="lp-section__head"><span className="ys-eyebrow">{eyebrow}</span><h2 id={`${label}-t`}>{title}</h2>{lead && <p>{lead}</p>}</div>
      {children}
    </div>
  </section>
);

/** The site's header: on the home page its links scroll; elsewhere they go back to that part of the home page. */
export function SiteHeader({ home = true }: { home?: boolean }) {
  const at = (id: string) => (home ? `#${id}` : `/#${id}`);
  return (
    <header className="lp-top lp-wrap">
      <Link href="/" aria-label="YaysApp home" className="lp-home"><Wordmark /></Link>
      <nav aria-label="Site" className="lp-nav"><a href={at('features')}>Features</a><a href={at('earn')}>Earn</a><a href={at('communities')}>Communities</a><a href={at('faq')}>Help</a></nav>
      <ThemeToggle />
      <OvalButton icon="globe" label="Open web app" size="sm" href={SIGN_IN_URL} />
    </header>
  );
}

export function SiteFooter({ home = true }: { home?: boolean }) {
  const at = (id: string) => (home ? `#${id}` : `/#${id}`);
  return (
    <footer className="lp-foot">
      <div className="lp-wrap lp-foot__cols">
        <div className="p2-col" style={{ gap: 10, maxWidth: 280 }}><Wordmark /><p className="muted">YaysApp is the chat hub of the Indexx ecosystem.</p></div>
        <div className="p2-col"><strong>Product</strong><a href={at('features')}>Features</a><a href={at('earn')}>Earn</a><a href={at('communities')}>Communities</a><Link href={SIGN_IN_URL}>Open web app</Link></div>
        <div className="p2-col"><strong>Help</strong><a href={at('faq')}>Questions</a><Link href="/support">Support</Link><Link href="/privacy">Privacy policy</Link><Link href="/terms">Terms</Link><Link href="/delete-account">Delete account</Link></div>
      </div>
      <div className="lp-wrap lp-foot__base"><span>© {new Date().getFullYear()} Indexx. All rights reserved.</span><span>Made for chatting, earning and belonging.</span></div>
    </footer>
  );
}

/** The home page, with the Ask Jack assistant. */
export function Landing() {
  const days = CHECKIN_POINTS.map((p, i) => ({ p, label: i === 5 ? 'Today' : `Day ${i + 1}`, state: i < 5 ? 'done' : i === 5 ? 'today' : 'upcoming' }));
  return (
    <div className="lp">
      <SiteHeader />

      <main>
      <section className="lp-hero lp-wrap">
        <LineArt name="hype" width={300} opacity={0.2} className="lp-art lp-art--hero" />
        <div className="lp-hero__copy">
          <span className="ys-eyebrow">Chat. Earn. Belong.</span>
          <h1>The chat app that rewards you for showing up.</h1>
          <p>Message friends, join communities and earn INEX every day.</p>
          <div className="row" style={{ gap: 24, alignItems: 'flex-start' }}>
            <OvalButton icon="globe" label="Open web app" size="lg" href={SIGN_IN_URL} />
            <OvalButton icon="download" label="Get the app" size="lg" variant="soft" onClick={() => document.getElementById('download')?.scrollIntoView({ behavior: 'smooth' })} />
          </div>
          <Stores />
          <span className="muted p2-small">Free to use · on your phone and in your browser</span>
        </div>
        <div className="lp-hero__art"><img className="lp-hero__bg" src="/illustrations/hero-doodles.webp" width={900} height={1108} alt="" aria-hidden="true" /><img className="lp-hero__img" src="/illustrations/hero-cards.webp" width={1200} height={1261} alt="Three YaysApp phone screens fanned out, with a character playing bass jumping out of the front one" fetchPriority="high" /></div>
      </section>

      <Section id="features" label="f" eyebrow="Features" title="Everything you need to stay close" lead="Chats, calls, communities and an AI assistant, in one app that works the same on your phone and on the web." art={<><LineArt name="selfie" height={300} opacity={0.22} className="lp-art lp-art--r" /><LineArt name="gear" height={220} opacity={0.2} className="lp-art lp-art--c" /></>}>
        <div className="lp-cards lp-cards--4">{FEATURES.map(([i, t, d]) => <div key={t} className="ys-card lp-card"><span className="ys-oval ys-oval--ember" style={{ width: 48 }}><Icon name={i} size={22} /></span><strong>{t}</strong><span>{d}</span></div>)}</div>
      </Section>

      <Section id="earn" label="e" eyebrow="INEX" title="Earn INEX for the things you already do" lead="INEX, the Indexx coin, adds up in your wallet. Withdraw it to your Indexx Exchange wallet, or use it across Indexx products." art={<><LineArt name="coins" height={260} opacity={0.22} className="lp-art lp-art--l" /><LineArt name="pay" height={240} opacity={0.2} className="lp-art lp-art--c" /></>}>
        <div className="lp-earn">
          <ul className="lp-ways">{WAYS.map(([i, t, d, p]) => <li key={t}><span className="ys-oval ys-oval--wash" style={{ width: 44 }}><Icon name={i} size={20} /></span><span className="p2-col" style={{ flex: 1 }}><strong>{t}</strong><span className="muted">{d}</span></span><b>{p}</b></li>)}</ul>
          <div className="lp-example">
            <div className="p2-hero lp-example__hero"><span className="ys-feature__deco a" /><span className="p2-hero__eyebrow">Your INEX</span><div className="p2-hero__num">2,450</div><span>+85 this week · 5-day streak</span></div>
            <div className="p2-card p2-card--pad"><div className="p2-card__head"><strong>Daily check-in</strong><span className="p2-accent">Claim +20 today</span></div>
              <div className="p2-week">{days.map((d) => <div key={d.label} className={`p2-week__day p2-week__day--${d.state}`}><span className="ys-oval">{d.state === 'done' ? <Icon name="check" size={16} /> : `+${d.p}`}</span><span>{d.label}</span></div>)}</div>
            </div>
            <span className="muted p2-xs">Example account. INEX rules can change.</span>
          </div>
        </div>
      </Section>

      <Section label="x" eyebrow="Indexx ecosystem" title="One account for every Indexx product" lead="Open BTCY, EMMM and the rest from Explore, and keep your INEX and referrals everywhere." art={<><LineArt name="trader" height={280} opacity={0.22} className="lp-art lp-art--r" /><LineArt name="wallet" height={220} opacity={0.2} className="lp-art lp-art--c" /></>}>
        <div className="lp-cards lp-cards--6">{PRODUCTS.map((p) => <div key={p.id} className={`ys-card lp-product${p.live ? '' : ' p2-product--soon'}`}><span className="ys-oval" style={{ width: 56, ['--ys-oval-fill' as string]: '#ffffff' }}><img src={p.logo} alt="" /></span><strong>{p.name}</strong><span className="muted">{p.sub}</span></div>)}</div>
      </Section>

      <section id="communities" className="lp-section" aria-labelledby="c-t">
        <div className="lp-wrap">
          <div className="lp-band">
            <span className="ys-feature__deco a" /><span className="ys-feature__deco b" />
            <div className="lp-band__copy">
              <span className="lp-band__eyebrow">Communities</span>
              <h2 id="c-t">Bring your people together</h2>
              <p>Run a trading club, a running group or your whole neighbourhood. Members pick the groups they want, and announcements reach everyone.</p>
              <ul><li><Icon name="megaphone" size={18} />Announcements only admins post to</li><li><Icon name="check" size={18} />Approve who joins with one tap</li><li><Icon name="flag" size={18} />Reported messages go straight to admins</li></ul>
              <OvalButton icon="plus" label="Start a community" size="md" variant="secondary" href={SIGN_IN_URL} />
            </div>
            <LineArt name="hype" width={360} ink="#ffffff" opacity={0.85} className="lp-band__art" />
          </div>
        </div>
      </section>

      <Section label="s" eyebrow="Safety and privacy" title="You decide who reaches you" art={<><LineArt name="explorer" height={300} opacity={0.22} className="lp-art lp-art--l" /><LineArt name="snap" height={220} opacity={0.2} className="lp-art lp-art--c" /></>}>
        <div className="lp-cards lp-cards--3">{SAFETY.map(([i, t, d]) => <div key={t} className="ys-card lp-card"><span className="ys-oval ys-oval--wash" style={{ width: 52 }}><Icon name={i} size={22} /></span><strong>{t}</strong><span>{d}</span></div>)}</div>
      </Section>

      <section id="download" className="lp-section" aria-labelledby="d-t">
        <LineArt name="reader" height={260} opacity={0.18} className="lp-art lp-art--c lp-art--low" />
        <div className="lp-wrap lp-download">
          <div className="p2-col" style={{ gap: 14, flex: 1 }}>
            <span className="ys-eyebrow">Get YaysApp</span>
            <h2 id="d-t">Start chatting in a minute</h2>
            <p className="muted">Sign up with your phone number, find your friends and claim your first check-in today.</p>
            <Stores />
            <div className="row" style={{ gap: 24 }}><OvalButton icon="globe" label="Open web app" size="md" href={SIGN_IN_URL} /></div>
          </div>
          <LineArt name="skater" height={320} />
        </div>
      </section>

      <Section id="faq" label="q" eyebrow="Help" title="Questions people ask" art={<><LineArt name="lantern" height={240} opacity={0.22} className="lp-art lp-art--r" /><LineArt name="morning" height={240} opacity={0.2} className="lp-art lp-art--c" /></>}>
        <div className="faq lp-faq">{FAQ.map(([q, a]) => <details key={q}><summary>{q}</summary><p>{a}</p></details>)}</div>
        <p className="muted" style={{ textAlign: 'center' }}>Still stuck? Ask Jack’s AI in the corner.</p>
      </Section>

      </main>
      <SiteFooter />

      <SiteAssistant />
    </div>
  );
}

/** W7b: the Ask Jack button and chat box. Answers questions; offers to pass business questions to the team. */
function SiteAssistant() {
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Array<{ role: 'user' | 'assistant'; text: string }>>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [lead, setLead] = useState(false);
  const [sent, setSent] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { box.current?.scrollTo({ top: box.current.scrollHeight }); }, [msgs, busy, lead]);
  const ask = async () => {
    const t = text.trim(); if (!t || busy) return;
    const next = [...msgs, { role: 'user' as const, text: t }];
    setMsgs(next); setText(''); setBusy(true); setError(null);
    try {
      const r = await siteAsk(next.slice(-12));
      setMsgs((m) => [...m, { role: 'assistant', text: r.text }]);
      if (/email|team/i.test(r.text)) setLead(true);
    } catch (e) { setError(e instanceof SiteError ? e.message : 'Jack’s AI couldn’t answer. Try again.'); }
    finally { setBusy(false); }
  };
  const send = async () => {
    setBusy(true); setError(null);
    try { await siteLead({ name, email, question: msgs.filter((m) => m.role === 'user').map((m) => m.text).join('\n').slice(0, 1000), consent: true }); setSent(true); }
    catch (e) { setError(e instanceof SiteError ? e.message : 'That didn’t send. Try again.'); }
    finally { setBusy(false); }
  };
  return (
    <>
      {!open && <div className="sa-greet" aria-hidden><strong>Hi, I’m Jack’s AI</strong>Questions about YaysApp or INEX? Ask me here.</div>}
      {open && (
        <div className="sa-panel" role="dialog" aria-labelledby="sa-title">
          <div className="sa-head">
            <span className="sa-logo"><img src="/brand/jack.png" alt="" /></span>
            <span className="p2-col" style={{ flex: 1 }}><strong id="sa-title">Jack’s AI</strong><span className="p2-xs">YaysApp assistant · answers about YaysApp</span></span>
            <button type="button" className="sa-min" aria-label="Minimise chat" onClick={() => setOpen(false)}><Icon name="chevron-down" size={16} /></button>
          </div>
          <div className="ys-thread sa-thread" ref={box} aria-live="polite">
            {!msgs.length && <div className="ys-bubble ys-bubble--them">Hi! Ask me how YaysApp works, how to earn INEX, or anything else.</div>}
            {msgs.map((m, i) => <div key={i} className={`ys-bubble ys-bubble--${m.role === 'user' ? 'me' : 'them'}`}>{m.text}</div>)}
            {busy && !lead && <div className="ys-bubble ys-bubble--them"><span className="ys-spin" aria-label="Jack is typing" /></div>}
            {lead && (sent ? <div className="ys-bubble ys-bubble--them">Thanks, {name.split(/\s+/)[0]}. Our team will email you at {email}.</div> : (
              <div className="sa-lead">
                <Field id="ln" label="Name"><input id="ln" className="ys-input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" /></Field>
                <Field id="le" label="Work email" error={error && /email/i.test(error) ? error : null}><input id="le" className="ys-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" /></Field>
                <label className="p2-check p2-xs"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />Yes, YaysApp can contact me about this.</label>
                <div className="row" style={{ justifyContent: 'flex-end' }}><OvalButton icon="send" label="Send to team" size="sm" loading={busy} disabled={!name.trim() || !email.trim() || !consent} onClick={() => void send()} /></div>
              </div>
            ))}
            {error && !(lead && /email/i.test(error)) && <div className="sa-error" role="alert">{error}</div>}
          </div>
          <form className="sa-compose" onSubmit={(e) => { e.preventDefault(); void ask(); }}>
            <input className="ys-input" value={text} onChange={(e) => setText(e.target.value)} placeholder="Ask a question…" aria-label="Ask Jack’s AI" maxLength={1000} />
            <OvalButton icon="send" label="Send" size="sm" type="submit" disabled={!text.trim() || busy} />
            {!lead && msgs.length > 0 && <button type="button" className="link-btn p2-xs" onClick={() => setLead(true)}>Talk to the team</button>}
          </form>
        </div>
      )}
      <div className="sa-launch-wrap">
        <button type="button" className="sa-launch" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-label={open ? 'Close the chat assistant' : 'Open the chat assistant'}>
          <span className="ys-oval ys-oval--ember" style={{ width: 68 }}><Icon name={open ? 'close' : 'chats'} size={open ? 24 : 28} /></span>
          <span>{open ? 'Close' : 'Ask Jack'}</span>
        </button>
      </div>
    </>
  );
}

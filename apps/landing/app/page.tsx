import { PLAY_URL } from '@/lib/links';

const FEATURES = [
  { mark: 'Aa', title: 'Fast, expressive messaging', text: 'Photos, files, voice notes, replies, reactions and read receipts.' },
  { mark: '#', title: 'Communities for every interest', text: 'Join one or start your own, with admins, polls and announcements.' },
  { mark: '☎', title: 'Voice and video calls', text: 'Call one friend or a whole group, on your phone or the web.' },
  { mark: '↺', title: 'Your old chats come with you', text: 'Used YaysApp before? Sign in and your chats and groups are already there.' },
  { mark: '★', title: 'INEX for everyday activity', text: 'Chat, post, check in, invite. Every reward in one history.' },
  { mark: '◎', title: 'The whole Indexx ecosystem', text: 'Mining, prediction markets, courses and the marketplace — one account throughout.' },
];
const POINTS = [
  { label: 'Daily check-in', pts: '+20' }, { label: 'Post in a community', pts: '+15' }, { label: 'Send 10 messages', pts: '+10' },
  { label: 'Invite a friend who joins', pts: '+100' }, { label: 'Ask Jack’s AI', pts: 'Soon', soon: true }, { label: 'Pay a friend in chat', pts: 'Soon', soon: true },
];
const ECO = [
  { name: 'BTCY', img: 'btcy-logo' }, { name: 'EMMM', img: 'emmm-logo' }, { name: 'ShoperPal', img: 'shoperpal-logo' }, { name: 'ReHuman', img: 'rehuman-logo' },
  { name: 'Wall Street Indexx', img: 'wallstreet-logo' }, { name: 'Indexx Academy', img: 'academy-icon' }, { name: 'Indexx', img: 'indexx-logo' }, { name: 'AI Station', img: 'aiainai-logo' },
];

function Stores() {
  return (
    <div className="stores">
      <a className="store" href={PLAY_URL}><span><small>Get it on</small>Google Play</span></a>
      <span className="store store-soon" aria-label="App Store, coming soon"><span><small>Coming soon</small>App Store</span></span>
    </div>
  );
}

export default function Home() {
  return (
    <main>
      <div className="wrap hero">
        <div>
          <span className="eyebrow">The new YaysApp</span>
          <h1>Chat. <em>Earn.</em> Together.</h1>
          <p className="lead">YaysApp is a messaging app that pays attention to the rest of your day. Talk to friends, call your family, join communities, and earn INEX, the Indexx coin, for the things you already do.</p>
          <Stores />
          <p className="note">Free on Android. iPhone coming soon. Also works in your browser.</p>
        </div>
        <div className="phone" aria-label="A chat in YaysApp">
          <div className="bubble them">Are you joining the community call tonight?</div>
          <div className="bubble me">Yes — just checked in for today too</div>
          <span className="earned">+20 INEX</span>
          <div className="bubble them">Nice. Send me your invite code?</div>
          <div className="bubble me">Sending now — you get INEX too</div>
          <span className="earned">+100 INEX</span>
        </div>
      </div>

      <section className="band alt" id="features">
        <div className="wrap">
          <span className="eyebrow">What&apos;s inside</span>
          <h2>A chat app first. Everything else earns its place.</h2>
          <p className="sub">Messaging, calls and communities are the core. Rewards and the Indexx ecosystem sit beside them, never in the way.</p>
          <div className="grid3">{FEATURES.map((f) => <div className="card" key={f.title}><span className="oval" aria-hidden="true">{f.mark}</span><h3>{f.title}</h3><p>{f.text}</p></div>)}</div>
        </div>
      </section>

      <section className="band" id="earn">
        <div className="wrap">
          <span className="eyebrow">Earn as you go</span>
          <h2>The things you already do are worth something.</h2>
          <p className="sub">INEX is the Indexx coin. You earn it in YaysApp and can withdraw it to your Indexx Exchange wallet.</p>
          <div className="points">{POINTS.map((p) => <div key={p.label} className={`point${p.soon ? ' soon' : ''}`}><span className="oval" style={{ width: 40, fontSize: 13 }} aria-hidden="true">★</span>{p.label}<b>{p.pts}</b></div>)}</div>
        </div>
      </section>

      <section className="band alt" id="ecosystem">
        <div className="wrap">
          <span className="eyebrow">Indexx Zodiac</span>
          <h2>One account. Every Indexx product.</h2>
          <p className="sub">Sign in once. Everything opens already signed in.</p>
          <div className="eco">{ECO.map((e) => <div key={e.name}><img src={`/img/ecosystem/${e.img}.png`} alt="" width={56} height={56} />{e.name}</div>)}</div>
        </div>
      </section>

      <section className="band">
        <div className="wrap cta">
          <h2 style={{ maxWidth: '20ch' }}>To enjoy every feature, download YaysApp.</h2>
          <p className="sub" style={{ margin: 0 }}>Messaging, calls, communities and rewards live in the app. Free to download, and free to start earning.</p>
          <Stores />
        </div>
      </section>
    </main>
  );
}

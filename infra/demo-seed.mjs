// Fills a LOCAL YaysApp with demo data: Sara Ahmed and her friends, chats with photos, a voice note,
// a PDF, replies, reactions and a poll, groups, two communities, calls, and a few unread messages.
// Everything goes through the API (so it behaves like real use); afterwards the times are spread
// over the last week so the lists read naturally. Ends by printing a link that signs you in as Sara.
//
//   pnpm demo            seed (refuses if the demo people already exist)
//   pnpm demo --reset    remove the demo people and everything they made, then seed again
//   pnpm demo --link     only print a fresh sign-in link for Sara
//
// Local development only: it reads apps/api/.env and stops if that isn't a development setup.
import { readFileSync, existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const apiDir = path.join(root, 'apps/api');
const require = createRequire(import.meta.url);
const { MongoClient, ObjectId } = require(require.resolve('mongodb', { paths: [apiDir] }));
const Redis = require(require.resolve('ioredis', { paths: [apiDir] }));

// ---------------- settings ----------------
const envFile = process.env.DEMO_API_ENV ?? path.join(apiDir, '.env');
if (!existsSync(envFile)) die('apps/api/.env is missing. Start the app once with start-mac.command first.');
const env = Object.fromEntries(readFileSync(envFile, 'utf8').split('\n').filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
if (env.NODE_ENV === 'production') die('apps/api/.env says production. The demo seed only runs against a local development app.');
if (!/^(true|1)$/.test(env.TEST_OUTBOX ?? '')) die('TEST_OUTBOX=true is needed in apps/api/.env (it lets the seed read sign-in codes).');
const MONGO_URI = env.MONGO_URI ?? 'mongodb://127.0.0.1:27018/?replicaSet=rs0';
if (!/127\.0\.0\.1|localhost/.test(MONGO_URI)) die('MONGO_URI does not point at this computer. The demo seed only runs against a local database.');
const API = process.env.DEMO_API ?? `http://localhost:${env.PORT ?? 4000}`;
const WEB = process.env.DEMO_WEB ?? 'http://localhost:3000';
const args = new Set(process.argv.slice(2));

function die(m) { console.error(`\n✖ ${m}\n`); process.exit(1); }
const log = (m) => console.log(`  ${m}`);

// ---------------- the cast ----------------
// Phone numbers in a block reserved for the demo, so --reset knows exactly whose data to remove.
const P = (n) => `+9230000000${String(n).padStart(2, '0')}`;
const CAST = {
  sara: { phone: P(1), name: 'Sara Ahmed', username: 'sara.ahmed', about: 'Coffee first, then messages' },
  amara: { phone: P(2), name: 'Amara Okafor', username: 'amara.o', about: 'Designer · Lahore. Replies faster on weekends.' },
  omar: { phone: P(3), name: 'Omar Siddiqui', username: 'omar.s', about: 'At work' },
  lena: { phone: P(4), name: 'Lena Fischer', username: 'lena.f', about: 'Brand and content' },
  ali: { phone: P(5), name: 'Ali Ahmed', username: 'ali.ahmed', about: 'At the gym' },
  zara: { phone: P(6), name: 'Zara Ahmed', username: 'zara.a', about: 'Hey there!' },
  hamza: { phone: P(7), name: 'Hamza Tariq', username: 'hamza.t', about: 'Hiking every Sunday' },
  hana: { phone: P(8), name: 'Hana Yusuf', username: 'hana.y', about: 'Available' },
  bilal: { phone: P(9), name: 'Bilal Khan', username: 'bilal.k', about: 'Trading since 2017' },
  hassan: { phone: P(10), name: 'Hassan Raza', username: 'hassan.r', about: 'Busy' },
  mom: { phone: P(11), name: 'Nadia Ahmed', username: 'nadia.ahmed', about: 'Busy cooking' },
  areeba: { phone: P(12), name: 'Areeba Khan', username: 'areeba.k', about: 'Learning to trade' },
  daniyal: { phone: P(13), name: 'Daniyal Shah', username: 'daniyal.s', about: 'Hey there!' },
  crypto: { phone: P(14), name: 'Crypto King', username: 'crypto.king', about: '100x signals daily' },
  faraz: { phone: P(15), name: 'Faraz Ali', username: null, about: '' },
};
const DEMO_PHONES = Object.values(CAST).map((c) => c.phone);

// ---------------- plumbing ----------------
const mongo = await new MongoClient(MONGO_URI).connect().catch((e) => die(`Can't reach MongoDB (${e.message}). Is the app running?`));
const db = mongo.db(env.MONGO_DB ?? 'yaychat');
const redis = new Redis(env.REDIS_URL ?? 'redis://127.0.0.1:6380', { lazyConnect: true, maxRetriesPerRequest: 1 });
await redis.connect().catch((e) => die(`Can't reach Redis (${e.message}). Is the app running?`));
try { const h = await fetch(`${API}/v1/health`); if (!h.ok) throw new Error(String(h.status)); } catch (e) { die(`The API isn't answering at ${API} (${e.message}). Start the app first (start-mac.command).`); }

/** The seed signs up ~15 people from this computer; clear the sign-in limits and resend waits as it goes (dev only). */
async function clearLimits() {
  for (const pattern of ['rl:*', 'otp:*:cd']) {
    let cursor = '0';
    do { const [next, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 500); cursor = next; if (keys.length) await redis.del(...keys); } while (cursor !== '0');
  }
}

async function call(pathname, body, token, method = body === undefined ? 'GET' : 'POST') {
  const r = await fetch(`${API}${pathname}`, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const j = r.status === 204 ? null : await r.json().catch(() => null);
  if (!r.ok) { const e = new Error(`${method} ${pathname} → ${r.status} ${j?.error?.message ?? j?.message ?? JSON.stringify(j)}`); e.status = r.status; throw e; }
  return j;
}
async function codeFor(to) {
  for (let i = 0; i < 30; i++) {
    const r = await fetch(`${API}/v1/_test/outbox?to=${encodeURIComponent(to)}`);
    if (r.ok) return (await r.json()).code;
    await new Promise((x) => setTimeout(x, 150));
  }
  throw new Error(`no code was sent to ${to}`);
}
const device = (who) => ({ deviceId: `demo-${who}-${randomUUID().slice(0, 8)}`, platform: 'web', name: 'Chrome on Mac' });
const emailOf = (key) => `${key}.demo@example.com`;

/** Signs a demo person up (phone, then email), or signs them in if they exist. Returns { id, token }. */
async function person(key) {
  const c = CAST[key];
  await clearLimits();
  const dev = device(key);
  await call('/v1/auth/phone/start', { phone: c.phone });
  const v = await call('/v1/auth/phone/verify', { phone: c.phone, code: await codeFor(c.phone), device: dev });
  let r = v;
  if (v.status === 'email_required') {
    await call('/v1/auth/signup/email/start', { signupToken: v.signupToken, email: emailOf(key) });
    r = await call('/v1/auth/signup/email/verify', { signupToken: v.signupToken, email: emailOf(key), code: await codeFor(emailOf(key)), device: dev });
  }
  if (!r.tokens) throw new Error(`${c.name} couldn't sign in (${r.status ?? 'unknown'}).`);
  const token = r.tokens.accessToken;
  await call('/v1/me', { displayName: c.name, about: c.about, ...(c.username ? { username: c.username } : {}) }, token, 'PATCH');
  return { key, id: r.me.id, name: c.name, token, tokens: r.tokens, deviceId: dev.deviceId };
}

// ---------------- reset / link ----------------
async function demoUserIds() {
  const users = await db.collection('users').find({ 'yc.phoneE164': { $in: DEMO_PHONES } }, { projection: { _id: 1 } }).toArray();
  return users.map((u) => u._id);
}
async function reset() {
  const ids = await demoUserIds();
  if (!ids.length) { log('No demo data to remove.'); return; }
  const convs = await db.collection('yc_conversations').find({ members: { $in: ids } }, { projection: { _id: 1 } }).toArray();
  const formerConvs = await db.collection('yc_conversations').find({ former: { $in: ids } }, { projection: { _id: 1 } }).toArray();
  const cids = [...convs, ...formerConvs].map((c) => c._id);
  const comms = await db.collection('yc_communities').find({ createdBy: { $in: ids } }, { projection: { _id: 1 } }).toArray();
  const commIds = comms.map((c) => c._id);
  const del = (name, q) => db.collection(name).deleteMany(q);
  await Promise.all([
    del('yc_messages', { convId: { $in: cids } }),
    del('yc_receipts', { $or: [{ convId: { $in: cids } }, { userId: { $in: ids } }] }),
    del('yc_join_requests', { $or: [{ convId: { $in: cids } }, { userId: { $in: ids } }] }),
    del('yc_stars', { userId: { $in: ids } }),
    del('yc_chat_prefs', { userId: { $in: ids } }),
    del('yc_blocks', { $or: [{ by: { $in: ids } }, { target: { $in: ids } }] }),
    del('yc_reports', { $or: [{ by: { $in: ids } }, { convId: { $in: cids } }] }),
    del('yc_calls', { $or: [{ convId: { $in: cids } }, { createdBy: { $in: ids } }] }),
    del('yc_call_links', { createdBy: { $in: ids } }),
    del('yc_community_members', { $or: [{ communityId: { $in: commIds } }, { userId: { $in: ids } }] }),
    del('yc_community_requests', { $or: [{ communityId: { $in: commIds } }, { userId: { $in: ids } }] }),
    del('yc_community_suggestions', { communityId: { $in: commIds } }),
    del('yc_push_subscriptions', { userId: { $in: ids } }),
    del('yc_sessions', { userId: { $in: ids } }),
  ]);
  await del('yc_communities', { _id: { $in: commIds } });
  await del('yc_conversations', { _id: { $in: cids } });
  await del('users', { _id: { $in: ids } });
  await clearLimits();
  log(`Removed ${ids.length} demo people, ${cids.length} chats and ${commIds.length} communities.`);
}
async function printLink(sara) {
  const s = sara ?? await person('sara');
  const blob = Buffer.from(JSON.stringify({ tokens: s.tokens, deviceId: s.deviceId })).toString('base64url');
  console.log(`\n✔ Open this link to sign in as Sara Ahmed (the demo account):\n\n  ${WEB}/demo#${blob}\n`);
  console.log(`  Or sign in yourself: "Sign in with a code instead", phone 0300 0000001,`);
  console.log(`  and read the code at ${API}/v1/_test/outbox?to=%2B923000000001\n`);
}

if (args.has('--link')) { await printLink(); await done(); }
if (args.has('--reset')) { console.log('\n▶ Removing the old demo data'); await reset(); }
else if ((await demoUserIds()).length) {
  await printLink();
  console.log('  The demo data is already there. Run "pnpm demo --reset" to start it over.\n');
  await done();
}

// ---------------- seed ----------------
console.log('\n▶ Signing up the demo people');
const u = {};
for (const k of Object.keys(CAST)) { u[k] = await person(k); log(`${u[k].name}`); }

/** Wanted times, applied at the end: message id → Date. */
const stamps = new Map();
const callStamps = [];
const MIN = 60_000;
const now = Date.now();
/** "ago" is minutes before now; or [days ago, "HH:MM"] for a clock time on an earlier day. */
function when(ago) {
  if (typeof ago === 'number') return new Date(now - ago * MIN);
  const [days, hm] = ago; const [h, m] = hm.split(':').map(Number);
  const d = new Date(now); d.setDate(d.getDate() - days); d.setHours(h, m, 0, 0); return d;
}

/** Earlier today, as a clock time on the script's own timeline (07:45 → about 9 hours ago, 11:52 → about 5 hours ago), always in the past. */
const TODAY = (minuteOfDay) => 320 + (712 - minuteOfDay);

async function direct(a, b) { return (await call('/v1/conversations/direct', { userId: b.id }, a.token)).id; }
async function upload(from, file, contentType, kind) {
  const buf = readFileSync(path.join(root, 'infra/demo', file));
  const t = await call('/v1/media/upload-url', { purpose: 'media', kind, contentType, size: buf.length, name: file }, from.token);
  const r = await fetch(t.uploadUrl.startsWith('http') ? t.uploadUrl : `${API}${t.uploadUrl}`, { method: 'PUT', headers: t.headers, body: buf });
  if (!r.ok) throw new Error(`upload of ${file} failed (${r.status})`);
  return t.key;
}
const MEDIA = {
  poster: { file: 'poster.png', type: 'image/png', kind: 'image', width: 448, height: 569 },
  hills: { file: 'hills.jpg', type: 'image/jpeg', kind: 'image', width: 1200, height: 800 },
  chart: { file: 'chart.png', type: 'image/png', kind: 'image', width: 1000, height: 640 },
  kheer: { file: 'kheer.jpg', type: 'image/jpeg', kind: 'image', width: 900, height: 900 },
  guide: { file: 'brand-guide.pdf', type: 'application/pdf', kind: 'file' },
  voice: { file: 'voice.wav', type: 'audio/wav', kind: 'voice', durationMs: 6000, waveform: [8, 20, 34, 52, 40, 28, 60, 72, 48, 30, 18, 40, 66, 80, 58, 36, 22, 44, 70, 54, 32, 20, 12, 30, 46, 38, 24, 14, 8, 20] },
};
/** Sends a message and remembers when it should look like it was sent. */
async function say(from, conv, text, ago, o = {}) {
  let attachment;
  if (o.media) {
    const m = MEDIA[o.media];
    attachment = { kind: m.kind, key: await upload(from, m.file, m.type, m.kind), name: m.file, ...(m.width ? { width: m.width, height: m.height } : {}), ...(m.durationMs ? { durationMs: m.durationMs, waveform: m.waveform } : {}) };
  }
  const r = await call(`/v1/conversations/${conv}/messages`, { clientId: randomUUID(), text, ...(o.reply ? { replyToId: o.reply } : {}), ...(attachment ? { attachment } : {}), ...(o.mentions ? { mentions: o.mentions } : {}) }, from.token);
  stamps.set(r.message.id, when(ago));
  lastSaid.set(conv, r.message.id);
  return r.message.id;
}
const react = (who, conv, msg, e) => call(`/v1/conversations/${conv}/messages/${msg}/reaction`, { emoji: e }, who.token, 'PUT');
const prefs = (who, conv, p) => call(`/v1/conversations/${conv}/prefs`, p, who.token, 'PUT');
const lastSaid = new Map();
/** Where Sara stopped reading, by message, so it survives the renumbering at the end. */
const saraReadAt = new Map();
/** Everything so far in this chat counts as read by them. */
const read = (who, conv) => { if (who.key === 'sara') saraReadAt.set(conv, lastSaid.get(conv)); return prefs(who, conv, { unread: false }); };

console.log('\n▶ Writing the chats');
const { sara, amara, omar, lena, ali, zara, hamza, hana, bilal, hassan, mom, areeba, daniyal, crypto, faraz } = u;

// Amara: the main chat on screen, with a reply, a photo, a PDF, a voice note, reactions and a pin.
const cAmara = await direct(sara, amara);
await say(amara, cAmara, 'Morning! Did you see the brief from Lena?', [1, '10:12']);
await say(sara, cAmara, 'Yes, looks fun. Friday launch?', [1, '10:15']);
await say(amara, cAmara, 'Friday. Dinner after at Café Aylanto, 8 pm 🎉', [1, '10:16']);
const qBtcy = await say(amara, cAmara, 'Are you joining the BTCY call tonight?', 214);
const slides = await say(sara, cAmara, "Yes! I'll bring the slides.", 211, { reply: qBtcy });
await react(amara, cAmara, slides, '❤️');
const poster = await say(amara, cAmara, 'Poster for Friday 🎉', 122, { media: 'poster' });
await react(sara, cAmara, poster, '🔥');
await say(sara, cAmara, 'slides-v3 attached, 12 pages', 120, { media: 'guide' });
await say(amara, cAmara, '', 60, { media: 'voice' });
await say(sara, cAmara, 'Can you send the venue address?', 9);
const addr = await say(amara, cAmara, 'Café Aylanto, MM Alam Road. Table booked for 8.', 7);
await call(`/v1/conversations/${cAmara}/messages/${addr}/pin`, {}, sara.token);
await call(`/v1/conversations/${cAmara}/messages/${poster}/star`, {}, sara.token, 'PUT');
await say(amara, cAmara, 'See you there!', 4);
await read(sara, cAmara);
await prefs(sara, cAmara, { pinned: true });

// Family group: mentions, a poll with votes, photos.
const fam = (await call('/v1/groups', { name: 'Family', about: "Sunday lunches, birthdays and Nani's recipes.", memberIds: [mom.id, ali.id, zara.id] }, sara.token)).id;
await say(mom, fam, 'Who is bringing dessert on Sunday?', TODAY(700));
const poll = (await call(`/v1/conversations/${fam}/polls`, { clientId: randomUUID(), question: 'Sunday lunch time?', options: ['1:00 pm', '2:30 pm', 'Dinner instead'], multi: false, anonymous: false }, ali.token)).message;
stamps.set(poll.id, when(TODAY(704)));
for (const [who, pick] of [[ali, 0], [zara, 0], [mom, 1], [sara, 0]]) await call(`/v1/conversations/${fam}/messages/${poll.id}/vote`, { options: [poll.poll.options[pick].id] }, who.token, 'PUT');
const kheer = await say(sara, fam, "I'll bring the kheer 🍮 @Nadia", TODAY(706), { media: 'kheer', mentions: [mom.id] });
await react(mom, fam, kheer, '😍'); await react(zara, fam, kheer, '😍');
await say(zara, fam, 'Save me a bowl please', TODAY(709));
await say(mom, fam, 'Lunch at 1 then. Ali, bring chairs from upstairs', TODAY(712));
await read(sara, fam);
await say(ali, fam, 'On it 👍', 40);
await say(mom, fam, 'And call your Nani tonight', 38);
await prefs(sara, fam, { pinned: true });

// Design Crew: unread, mostly documents.
const crew = (await call('/v1/groups', { name: 'Design Crew', about: 'Brand, decks and the YaysApp launch', memberIds: [sara.id, amara.id, hana.id, omar.id] }, lena.token)).id;
await say(lena, crew, 'Brand guide v2 is up, please check the colour page', [1, '16:20'], { media: 'guide' });
await say(amara, crew, 'The ember looks so much warmer now', [1, '16:31']);
await say(sara, crew, 'Love it. Can we try the oval buttons on the deck too?', [1, '16:40']);
await read(sara, crew);
await say(hana, crew, 'Sharing the new launch photo', 52, { media: 'hills' });
await say(lena, crew, 'Logo files sent to everyone 📁', 48);
await say(omar, crew, 'Got them, thanks Lena', 45);

// BTCY Traders: muted, busy.
const btcy = (await call('/v1/groups', { name: 'BTCY Traders', about: 'Market talk and BTCY updates', memberIds: [sara.id, omar.id, hamza.id, ali.id] }, bilal.token)).id;
await say(bilal, btcy, 'Morning all, BTCY up 6% overnight', TODAY(485), { media: 'chart' });
await say(hamza, btcy, 'Holding 💎', TODAY(500));
await say(omar, btcy, 'Any news behind it?', TODAY(542));
await read(sara, btcy);
await say(bilal, btcy, 'Exchange listing rumours. Webinar slides are pinned above', 160);
await say(bilal, btcy, '@Sara can you check the chart I sent?', 150, { mentions: [sara.id] });
await say(hamza, btcy, 'Same question here', 149);
await prefs(sara, btcy, { mute: 'always' });

// Omar: read, last message mine.
const cOmar = await direct(sara, omar);
await say(omar, cOmar, 'Are we still on for the gym tomorrow?', TODAY(602));
await say(sara, cOmar, 'Yes, 7 am sharp', TODAY(610));
await say(omar, cOmar, 'See you tomorrow', TODAY(614));
await say(sara, cOmar, 'See you!', TODAY(615));
await read(omar, cOmar);

// Lena: an unread question.
const cLena = await direct(sara, lena);
await say(lena, cLena, 'Hi Sara! Quick one for the launch deck', [2, '15:10']);
await say(sara, cLena, 'Go ahead', [2, '15:12']);
await read(lena, cLena);
await say(lena, cLena, 'Did you get the brand guide?', 30);

// Hamza: weekend hike photo.
const cHamza = await direct(sara, hamza);
await say(hamza, cHamza, 'Margalla trail on Sunday, you in?', [3, '19:30']);
await say(sara, cHamza, 'Only if we start before 7', [3, '19:41']);
await say(hamza, cHamza, 'Deal. This was last week 👇', [3, '19:44'], { media: 'hills' });
await read(sara, cHamza);

// Hassan: a deleted message.
const cHassan = await direct(sara, hassan);
await say(hassan, cHassan, 'Can you send me the invoice from June?', [4, '13:05']);
await say(sara, cHassan, 'Sent it to your email', [4, '13:20']);
const oops = await say(hassan, cHassan, 'Wrong chat, sorry', [4, '13:22']);
await call(`/v1/conversations/${cHassan}/messages/${oops}?for=everyone`, undefined, hassan.token, 'DELETE');
await read(sara, cHassan);

// Hana and Zara: archived.
const cHana = await direct(sara, hana);
await say(hana, cHana, 'Thanks for the recipe!', [6, '20:10']);
await say(sara, cHana, 'Anytime 😊', [6, '20:14']);
await prefs(sara, cHana, { archived: true });
const cZara = await direct(sara, zara);
await say(zara, cZara, 'Movie on Friday?', [5, '18:00']);
await say(sara, cZara, "Can't this week, next one?", [5, '18:30']);
await prefs(sara, cZara, { archived: true });

// Someone who isn't a contact.
const cFaraz = await direct(faraz, sara);
await say(faraz, cFaraz, 'Hi, is this Sara? I got your number from the BTCY meetup', 300);

// ---------------- communities ----------------
console.log('\n▶ Building the communities');
const btcyComm = await call('/v1/communities', { name: 'BTCY Traders', about: 'Market talk, BTCY updates and learning for the Indexx trading crowd. Be kind, no spam, no financial promises.', approveNew: false, membersSuggest: true, groupIds: [btcy], newGroups: ['General', 'Beginners Q&A'] }, bilal.token);
const btcyCode = (await call(`/v1/communities/${btcyComm.id}/invite`, {}, bilal.token)).inviteCode;
for (const who of [sara, hamza, omar, crypto]) await call(`/v1/community-invites/${btcyCode}/join`, {}, who.token);
const groupId = (name) => btcyComm.groups.find((g) => g.name === name)?.id;
for (const who of [sara, hamza, crypto, omar]) for (const g of ['General', 'Beginners Q&A']) await call(`/v1/communities/${btcyComm.id}/groups/${groupId(g)}/join`, {}, who.token).catch(() => undefined);
await say(bilal, btcyComm.announcementsId, 'Weekly market recap is live. Only admins can post here.', TODAY(550));
await say(bilal, groupId('General'), 'Welcome everyone 👋 Introduce yourselves!', [1, '09:00']);
await say(hamza, groupId('General'), 'Hamza here, mostly long-term holding', [1, '09:20']);
await read(sara, groupId('General'));
await say(bilal, groupId('General'), 'Chart is up for today', TODAY(700), { media: 'chart' });
await say(sara, groupId('Beginners Q&A'), 'What does "staking" mean for BTCY?', TODAY(598));
await say(bilal, groupId('Beginners Q&A'), 'You lock coins for a while and earn a reward. Thread coming soon.', TODAY(602));
const scam = await say(crypto, groupId('General'), 'DM me to double your BTCY in 24 hours 💰💰 guaranteed', TODAY(640));
for (const who of [sara, hamza, omar]) await call('/v1/reports', { conversationId: groupId('General'), messageId: scam, reason: 'scam' }, who.token).catch(() => undefined);
// Sara becomes an admin so she sees the admin view (requests, reports).
await call(`/v1/communities/${btcyComm.id}`, { approveNew: true }, bilal.token, 'PATCH');
await db.collection('yc_communities').updateOne({ _id: new ObjectId(btcyComm.id) }, { $addToSet: { admins: new ObjectId(sara.id) } });
for (const who of [areeba, daniyal]) await call(`/v1/community-invites/${btcyCode}/join`, {}, who.token);
await db.collection('yc_community_requests').updateOne({ userId: new ObjectId(areeba.id) }, { $set: { createdAt: when(140) } });
await db.collection('yc_community_requests').updateOne({ userId: new ObjectId(daniyal.id) }, { $set: { createdAt: when(35) } });

const runners = await call('/v1/communities', { name: 'Lahore Runners', about: 'Weekend runs around Lahore. All paces welcome.', approveNew: false, membersSuggest: false, groupIds: [], newGroups: ['Race day', 'Sunday long run'] }, lena.token);
const runCode = (await call(`/v1/communities/${runners.id}/invite`, {}, lena.token)).inviteCode;
for (const who of [sara, hamza, hana]) await call(`/v1/community-invites/${runCode}/join`, {}, who.token);
const raceDay = runners.groups.find((g) => g.name === 'Race day').id;
for (const who of [sara, hamza, hana]) await call(`/v1/communities/${runners.id}/groups/${raceDay}/join`, {}, who.token).catch(() => undefined);
await say(lena, runners.announcementsId, 'Race day bibs are ready, pick them up Saturday 10–1 at Gymkhana', [2, '17:00']);
await say(hamza, raceDay, 'Who is doing the 10k?', [1, '21:05']);
await say(hana, raceDay, 'Me! First one 😅', [1, '21:15']);

// ---------------- calls ----------------
console.log('\n▶ Making the call history');
let callsOk = true;
async function ring(from, conv, media, outcome, ago, durationSec = 0, answerer) {
  if (!callsOk) return;
  let id;
  try { id = (await call('/v1/calls', { conversationId: conv, media }, from.token)).call.id; }
  catch (e) { callsOk = false; log(`Calls skipped: the call server isn't set up (${e.message.split('→')[1]?.trim() ?? e.message}).`); return; }
  if (outcome === 'answered') { await call(`/v1/calls/${id}/accept`, {}, answerer.token); await new Promise((x) => setTimeout(x, 400)); await call(`/v1/calls/${id}/leave`, {}, answerer.token); await call(`/v1/calls/${id}/leave`, {}, from.token).catch(() => undefined); }
  else if (outcome === 'declined') await call(`/v1/calls/${id}/decline`, {}, answerer.token);
  else await call(`/v1/calls/${id}/leave`, {}, from.token); // rang and hung up: missed on the other side
  callStamps.push({ id, at: when(ago), durationSec });
}
await ring(sara, cOmar, 'voice', 'declined', TODAY(465), 0, omar);
await ring(amara, cAmara, 'voice', 'answered', TODAY(552), 3 * 60 + 12, sara);
await ring(mom, fam, 'video', 'answered', TODAY(520), 18 * 60 + 5, sara);
await ring(sara, crew, 'video', 'answered', TODAY(665), 14 * 60 + 40, lena);
await ring(lena, cLena, 'voice', 'missed', 32);
await ring(lena, cLena, 'voice', 'missed', 28);
await ring(hassan, cHassan, 'voice', 'missed', [1, '18:22']);

// ---------------- times ----------------
console.log('\n▶ Spreading the times over the last week');
const msgs = db.collection('yc_messages');
for (const [id, at] of stamps) await msgs.updateOne({ _id: new ObjectId(id) }, { $set: { createdAt: at } });
for (const c of callStamps) {
  const at = c.at, end = new Date(at.getTime() + (c.durationSec ? c.durationSec * 1000 + 8000 : 30_000));
  const start = new Date(at.getTime() + 8000);
  await db.collection('yc_calls').updateOne({ _id: new ObjectId(c.id) }, { $set: { createdAt: at, ...(c.durationSec ? { startedAt: start } : {}), endedAt: end, 'parts.$[].invitedAt': at } });
  // Group calls count each person's own time in the call.
  await db.collection('yc_calls').updateOne({ _id: new ObjectId(c.id) }, { $set: { 'parts.$[p].joinedAt': start, 'parts.$[p].leftAt': end } }, { arrayFilters: [{ 'p.everJoined': true }] });
  await msgs.updateMany({ 'system.callId': c.id }, { $set: { createdAt: end, ...(c.durationSec ? { 'system.durationSec': c.durationSec } : {}) } });
  stamps.set(`call:${c.id}`, end);
}
// Messages the app wrote itself (group created, joined, calls without a stamp) take the time of their neighbours.
const convIds = await db.collection('yc_conversations').find({ members: { $in: (await demoUserIds()) } }, { projection: { _id: 1 } }).toArray();
const stamped = new Set([...stamps.keys()].filter((k) => !k.startsWith('call:')));
const callMsgs = new Set((await msgs.find({ 'system.callId': { $in: callStamps.map((c) => c.id) } }, { projection: { _id: 1 } }).toArray()).map((m) => String(m._id)));
for (const { _id } of convIds) {
  const list = await msgs.find({ convId: _id }).sort({ seq: 1 }).toArray();
  if (!list.length) continue;
  const fixed = list.map((m) => (stamped.has(String(m._id)) || callMsgs.has(String(m._id)) ? m.createdAt : null));
  for (let i = 0; i < list.length; i++) {
    if (fixed[i]) continue;
    const prev = fixed.slice(0, i).reverse().find(Boolean);
    const next = fixed.slice(i + 1).find(Boolean);
    // Between two dated messages: just after the earlier one. After the last one (e.g. "added to the community",
    // which the seed does after writing the chat): early in the chat instead, so it doesn't become the preview.
    const first = fixed.find(Boolean);
    fixed[i] = prev && next ? new Date(prev.getTime() + 5000) : next ? new Date(next.getTime() - 60_000) : first ? new Date(first.getTime() - 30_000 + i) : new Date(now - 7 * 24 * 60 * MIN);
    await msgs.updateOne({ _id: list[i]._id }, { $set: { createdAt: fixed[i] } });
  }
  // The app shows messages in sending order (seq). Calls were made after the chats were written,
  // so number every chat's messages again in time order, then point the chat at its newest message.
  const order = list.map((m, i) => ({ m, at: fixed[i], i })).sort((a, b) => a.at - b.at || a.i - b.i);
  if (order.some((o, k) => o.m.seq !== k + 1)) {
    for (const [k, o] of order.entries()) await msgs.updateOne({ _id: o.m._id }, { $set: { seq: -(k + 1) } });
    for (const [k, o] of order.entries()) await msgs.updateOne({ _id: o.m._id }, { $set: { seq: k + 1 } });
  }
  const newest = order[order.length - 1];
  await db.collection('yc_conversations').updateOne({ _id }, { $set: { lastAt: newest.at, lastMessageId: newest.m._id, createdAt: order[0].at } });
}
await db.collection('users').updateOne({ _id: new ObjectId(sara.id) }, { $unset: { 'yc.callsSeenAt': '' } });
for (const [conv, msgId] of saraReadAt) {
  const m = await msgs.findOne({ _id: new ObjectId(msgId) }, { projection: { seq: 1 } });
  if (m) await db.collection('yc_receipts').updateOne({ convId: new ObjectId(conv), userId: new ObjectId(sara.id) }, { $set: { readSeq: m.seq }, $max: { deliveredSeq: m.seq } });
}

// Others have read what Sara sent (blue ticks), except in Lena's chat.
for (const [who, conv] of [[amara, cAmara], [omar, cOmar], [hamza, cHamza], [hassan, cHassan], [mom, fam], [zara, fam], [ali, fam]]) await read(who, conv).catch(() => undefined);

await clearLimits();
console.log('\n▶ Done');
await printLink(sara);
await done();

async function done() { await redis.quit().catch(() => undefined); await mongo.close(); process.exit(0); }

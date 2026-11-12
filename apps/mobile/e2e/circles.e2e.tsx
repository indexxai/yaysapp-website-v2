/// <reference types="node" />
import React from 'react';
import * as zlib from 'zlib';
import { ObjectId } from 'mongodb';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import * as Keychain from 'react-native-keychain';
import AsyncStorage from '@react-native-async-storage/async-storage';
import ImagePicker from 'react-native-image-crop-picker';
import App from '../App';
import { resetApiForTests } from '../src/lib/api';
import { API, db } from './helpers';
import { call, user, type U } from './people';

// The real API, MongoDB and Redis: circles made through the API, the app driven as a person would.
const store = (Keychain as unknown as { __store: Map<string, string> }).__store;
const as = (u: U) => u.tokens.accessToken;
const DAY = 86400_000;
const at = (ms: number) => new Date(Date.now() + ms).toISOString();
function launchAs(u: U) {
  store.set('yays.tokens', JSON.stringify(u.tokens));
  (globalThis as { YAYS_API_URL?: string }).YAYS_API_URL = API;
  resetApiForTests();
  return render(<App />);
}
async function circle(owner: U, body: object, official = false) {
  const c = await call('/v1/circles', body, as(owner));
  if (official) await db((d) => d.collection('yc_communities').updateOne({ _id: new ObjectId(c.id) }, { $set: { official: true } }));
  return c as { id: string; name: string };
}
const unique = (s: string) => `${s} ${Date.now() % 1_000_000}`;
/** A circle in the tab's list: its row is labelled with the name (and new posts). */
const openCircle = async (name: string) => fireEvent.press(await screen.findByLabelText(new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`), {}, { timeout: 8000 }));
const goCircles = async () => fireEvent.press(await screen.findByTestId('tab-Circles'));
/** A real PNG, as a data: URL the app reads like a file on the phone. */
function png(w: number, h: number): string {
  const tbl = [...Array(256)].map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = tbl[(c ^ x) & 0xff]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type: string, data: Buffer) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array(w).fill([232, 128, 40]).flat())]);
  const bytes = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.concat(Array(h).fill(row)))), chunk('IEND', Buffer.alloc(0))]);
  return `data:image/png;base64,${bytes.toString('base64')}`;
}

beforeEach(async () => { store.clear(); await AsyncStorage.clear(); });
afterEach(() => jest.clearAllMocks());

describe('Circles on mobile, against the real API', () => {
  it('no circles yet: the empty state; Discover finds an official circle, Join opens it, and it shows in the tab', async () => {
    const bilal = await user('Bilal'), sara = await user('Sara');
    const name = unique('Bitcoin YAY Circle');
    await circle(bilal, { name, about: 'Updates and support from the BTCY team', category: 'crypto' }, true);
    launchAs(sara);
    await goCircles();
    expect(await screen.findByTestId('no-circles', {}, { timeout: 8000 })).toBeTruthy();
    expect(screen.getByText('You’re not in any circles yet')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Discover'));
    fireEvent.changeText(await screen.findByLabelText('Search circles'), name);
    const tile = await waitFor(() => { const x = screen.getAllByTestId('circle-tile').find((n) => within(n).queryByText(name)); expect(x).toBeTruthy(); return x!; }, { timeout: 8000 });
    expect(within(tile).getByText('Official')).toBeTruthy();
    fireEvent.press(within(tile).getByLabelText('Join'));
    // The circle opens, as a member: Feed, Events, Chats, About.
    expect(await screen.findByTestId('circle-screen', {}, { timeout: 8000 })).toBeTruthy();
    expect(await screen.findByLabelText('Write a post')).toBeTruthy();
    expect(screen.getByLabelText(/^Chats/)).toBeTruthy();
    // Back on the tab: the circle is listed.
    fireEvent.press(within(screen.getByTestId('circle-screen')).getByLabelText('Circles'));
    fireEvent.press(within(await screen.findByTestId('discover-screen')).getByLabelText('Circles'));
    await waitFor(async () => expect((await screen.findAllByTestId('circle-row')).some((r) => within(r).queryByText(name))).toBe(true), { timeout: 8000 });
  });

  it('a post with a photo; like it; comments; the owner marks the answer and the feed shows it', async () => {
    const bilal = await user('Bilal'), sara = await user('Sara');
    const c = await circle(bilal, { name: unique('Lahore Runners'), category: 'sports', rules: ['Be kind'] });
    await call(`/v1/circles/${c.id}/join`, {}, as(sara));
    launchAs(sara);
    await goCircles();
    await openCircle(c.name);
    fireEvent.press(await screen.findByLabelText('Write a post', {}, { timeout: 8000 }));
    (ImagePicker.openPicker as jest.Mock).mockResolvedValueOnce([{ path: png(60, 40), mime: 'image/png', size: 0, width: 60, height: 40 }]);
    const compose = await screen.findByTestId('compose-screen');
    fireEvent.changeText(within(compose).getByLabelText('Write a post'), 'Is the Sunday run still on at 6?');
    fireEvent.press(within(compose).getByLabelText('Photo'));
    expect(await within(compose).findByLabelText('Remove photo')).toBeTruthy();
    fireEvent.press(within(compose).getByLabelText('Post'));
    // Back in the feed with the post and its photo.
    const post = await waitFor(() => { const p = screen.getAllByTestId('post').find((n) => within(n).queryByText('Is the Sunday run still on at 6?')); expect(p).toBeTruthy(); return p!; }, { timeout: 10000 });
    expect(within(post).getByTestId('post-photos')).toBeTruthy();
    const saved = (await call(`/v1/circles/${c.id}/posts`, undefined, as(bilal))).items[0];
    expect(saved.photos).toHaveLength(1);
    // Like.
    fireEvent.press(within(post).getByLabelText('Like'));
    await waitFor(() => expect(within(screen.getAllByTestId('post')[0]!).getByLabelText('Unlike')).toBeTruthy());
    expect((await call(`/v1/circle-posts/${saved.id}`, undefined, as(bilal))).likes).toBe(1);
    // The owner answers; Sara opens the post, sees it, and replies.
    const answer = await call(`/v1/circle-posts/${saved.id}/comments`, { text: 'Yes, 6 am at the canal bridge.' }, as(bilal));
    await call(`/v1/circle-comments/${answer.id}/answer`, undefined, as(bilal), 'PUT');
    fireEvent.press(within(screen.getAllByTestId('post')[0]!).getByLabelText('0 comments'));
    const page = await screen.findByTestId('post-screen');
    expect(await within(page).findByText('Yes, 6 am at the canal bridge.', {}, { timeout: 8000 })).toBeTruthy();
    expect(within(page).getByText('Answer')).toBeTruthy();
    fireEvent.press(within(page).getByLabelText('Reply'));
    expect(within(page).getByText('Replying to Bilal')).toBeTruthy();
    fireEvent.changeText(within(page).getByLabelText('Write a comment…'), 'See you there!');
    fireEvent.press(within(page).getByLabelText('Send'));
    expect(await within(page).findByText('See you there!', {}, { timeout: 8000 })).toBeTruthy();
    const cs = await call(`/v1/circle-posts/${saved.id}/comments`, undefined, as(bilal));
    expect(cs.find((x: { text: string }) => x.text === 'See you there!').parentId).toBe(answer.id);
    // The feed shows the answer under the question.
    fireEvent.press(within(page).getByLabelText('Feed'));
    await waitFor(() => expect(screen.queryByTestId('post-screen')).toBeNull());
    expect(await screen.findByText(/Yes, 6 am at the canal bridge/, {}, { timeout: 8000 })).toBeTruthy();
    expect(screen.getByText(/Answered by Bilal/)).toBeTruthy();
  });

  it('money-scheme wording is caught; sent to the owners it waits; the owner approves it from Review', async () => {
    const bilal = await user('Bilal'), imran = await user('Imran');
    const c = await circle(bilal, { name: unique('Crypto Beginners'), category: 'crypto', rules: ['Be kind', 'No investment promotion'] });
    await call(`/v1/circles/${c.id}/join`, {}, as(imran));
    const view = launchAs(imran);
    await goCircles();
    await openCircle(c.name);
    fireEvent.press(await screen.findByLabelText('Write a post', {}, { timeout: 8000 }));
    const compose = await screen.findByTestId('compose-screen');
    fireEvent.changeText(within(compose).getByLabelText('Write a post'), 'Guaranteed 10% daily profit! DM me to invest');
    fireEvent.press(within(compose).getByLabelText('Post'));
    const flag = await screen.findByTestId('post-flagged');
    expect(within(flag).getByText('This looks like an investment offer')).toBeTruthy();
    expect(within(flag).getByText('Guaranteed 10% daily profit')).toBeTruthy(); // marked
    fireEvent.press(within(flag).getByLabelText('Send to owners'));
    const mine = await waitFor(() => { const p = screen.getAllByTestId('post').find((n) => within(n).queryByText(/Guaranteed 10%/)); expect(p).toBeTruthy(); return p!; }, { timeout: 10000 });
    expect(within(mine).getByText('Waiting')).toBeTruthy();
    expect(within(mine).getByText(/Only you can see this/)).toBeTruthy();
    view.unmount();

    // The owner: Review · 1, Approve.
    launchAs(bilal);
    await goCircles();
    await openCircle(c.name);
    fireEvent.press(await screen.findByLabelText('Review · 1', {}, { timeout: 8000 }));
    const review = await screen.findByTestId('review');
    expect(within(review).getByText(/Guaranteed 10%/)).toBeTruthy();
    fireEvent.press(within(review).getByLabelText('Approve'));
    expect(await screen.findByText('Nothing to review', {}, { timeout: 8000 })).toBeTruthy();
    const feed = await call(`/v1/circles/${c.id}/posts`, undefined, as(bilal));
    expect(feed.items[0].status).toBe('live');
  });

  it('report a post: why, thanks, and it’s hidden for me', async () => {
    const bilal = await user('Bilal'), sara = await user('Sara'), king = await user('King');
    const c = await circle(bilal, { name: unique('Bitcoin Fans') });
    await call(`/v1/circles/${c.id}/join`, {}, as(sara));
    await call(`/v1/circles/${c.id}/join`, {}, as(king));
    await call(`/v1/circles/${c.id}/posts`, { text: 'Join my group for great tips', send: 'normal' }, as(king));
    launchAs(sara);
    await goCircles();
    await openCircle(c.name);
    const post = await waitFor(() => { const p = screen.getAllByTestId('post').find((n) => within(n).queryByText(/great tips/)); expect(p).toBeTruthy(); return p!; }, { timeout: 8000 });
    fireEvent.press(within(post).getByLabelText('Post options'));
    fireEvent.press(await screen.findByLabelText('Report'));
    const sheet = await screen.findByTestId('report-sheet');
    fireEvent.press(within(sheet).getByLabelText('Spam'));
    fireEvent.press(within(sheet).getByLabelText('Send report'));
    expect(await screen.findByTestId('report-sent', {}, { timeout: 8000 })).toBeTruthy();
    fireEvent.press(within(screen.getByTestId('report-sent')).getByLabelText('Done'));
    expect(await screen.findByText('You reported this post')).toBeTruthy();
    const review = await call(`/v1/circles/${c.id}/review`, undefined, as(bilal));
    expect(review.reports).toHaveLength(1);
    expect(review.reports[0].reason).toBe('spam');
  });

  it('a private circle: answer the owners’ question, the request waits, and it can be cancelled', async () => {
    const owner = await user('Hana'), ali = await user('Ali');
    const c = await circle(owner, { name: unique('ReHuman Wellness Club'), visibility: 'private', joinQuestion: 'Why do you want to join?', about: 'Habits, sleep and nutrition.', category: 'wellness' });
    launchAs(ali);
    await goCircles();
    fireEvent.press(await screen.findByLabelText('Discover', {}, { timeout: 8000 }));
    fireEvent.changeText(await screen.findByLabelText('Search circles'), c.name);
    const tile = await waitFor(() => { const x = screen.getAllByTestId('circle-tile').find((n) => within(n).queryByText(c.name)); expect(x).toBeTruthy(); return x!; }, { timeout: 8000 });
    expect(within(tile).getByText('Private')).toBeTruthy();
    fireEvent.press(within(tile).getByLabelText('Request'));
    const gate = await screen.findByTestId('private-gate', {}, { timeout: 8000 });
    expect(screen.getByText('Habits, sleep and nutrition.')).toBeTruthy();
    expect(within(gate).getByLabelText('Ask to join').props.accessibilityState.disabled).toBe(true);
    fireEvent.changeText(within(gate).getByLabelText('The owners ask: Why do you want to join?'), 'I want to fix my sleep.');
    fireEvent.press(within(gate).getByLabelText('Ask to join'));
    expect(await screen.findByTestId('request-sent', {}, { timeout: 8000 })).toBeTruthy();
    const v = await call(`/v1/circles/${c.id}`, undefined, as(ali));
    expect(v.access).toBe('requested');
    expect(v.request.answer).toBe('I want to fix my sleep.');
    fireEvent.press(screen.getByLabelText('Cancel request'));
    expect(await screen.findByTestId('private-gate', {}, { timeout: 8000 })).toBeTruthy();
    expect((await call(`/v1/circles/${c.id}`, undefined, as(ali))).access).toBe('visitor');
  });

  it('events: the owner makes one on the phone; a member says Going; a full event puts the next person on the waitlist', async () => {
    const bilal = await user('Bilal'), sara = await user('Sara'), omar = await user('Omar');
    const c = await circle(bilal, { name: unique('Karachi Founders'), category: 'local' });
    await call(`/v1/circles/${c.id}/join`, {}, as(sara));
    await call(`/v1/circles/${c.id}/join`, {}, as(omar));
    const view = launchAs(bilal);
    await goCircles();
    await openCircle(c.name);
    fireEvent.press(await screen.findByLabelText('Events', {}, { timeout: 8000 }));
    fireEvent.press(await screen.findByLabelText('New event'));
    await screen.findByTestId('event-form');
    fireEvent.changeText(screen.getByLabelText('Event name'), 'Founders Breakfast');
    fireEvent.press(screen.getByLabelText('Starts earlier')); // 5:45 pm
    expect(screen.getByLabelText('Starts 5:45 pm')).toBeTruthy();
    expect(screen.getByLabelText('Ends 7:45 pm')).toBeTruthy(); // the length stays the same
    fireEvent.changeText(screen.getByLabelText('Place'), 'The Second Cup, Clifton, Karachi');
    fireEvent(screen.getByLabelText('Limit seats'), 'valueChange', true);
    fireEvent.changeText(screen.getByLabelText('Seats'), '2');
    fireEvent.press(screen.getByLabelText('Create event'));
    expect(await screen.findByTestId('event-screen', {}, { timeout: 10000 })).toBeTruthy();
    expect(screen.getByText('Founders Breakfast')).toBeTruthy();
    expect(screen.getByText('1 of 2 seats left')).toBeTruthy(); // the host is going
    const ev = (await call(`/v1/circles/${c.id}/events`, undefined, as(bilal)))[0];
    expect(ev.title).toBe('Founders Breakfast');
    expect(ev.seats).toBe(2);
    expect(ev.place).toBe('The Second Cup, Clifton, Karachi');
    const local = new Intl.DateTimeFormat('en-GB', { timeZone: ev.timeZone, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(ev.startsAt));
    expect(local).toBe('17:45');
    expect(Date.parse(ev.endsAt) - Date.parse(ev.startsAt)).toBe(2 * 3600_000);
    view.unmount();

    // Sara takes the only seat from the phone.
    const s = launchAs(sara);
    await goCircles();
    await openCircle(c.name);
    fireEvent.press(await screen.findByLabelText('Events · 1', {}, { timeout: 8000 }));
    fireEvent.press(await screen.findByLabelText('Founders Breakfast'));
    fireEvent.press(await screen.findByTestId('rsvp-going', {}, { timeout: 8000 }));
    expect(await screen.findByText('You’re going', {}, { timeout: 8000 })).toBeTruthy();
    expect(screen.getByText('Full · 2 of 2 seats')).toBeTruthy();
    s.unmount();

    // Omar: full, so Going joins the waitlist.
    launchAs(omar);
    await goCircles();
    await openCircle(c.name);
    fireEvent.press(await screen.findByLabelText('Events · 1', {}, { timeout: 8000 }));
    fireEvent.press(await screen.findByLabelText('Founders Breakfast'));
    expect(await screen.findByLabelText('Join waitlist', {}, { timeout: 8000 })).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Join waitlist'));
    const wait = await screen.findByTestId('waitlist', {}, { timeout: 8000 });
    expect(within(wait).getByText('You’re 1st on the waitlist')).toBeTruthy();
    fireEvent.press(within(wait).getByLabelText('Leave waitlist'));
    expect(await screen.findByLabelText('Join waitlist', {}, { timeout: 8000 })).toBeTruthy();
  });

  it('an event changed after I said Going: what changed, and “Still going?”', async () => {
    const bilal = await user('Bilal'), sara = await user('Sara');
    const c = await circle(bilal, { name: unique('AI Meetup'), category: 'ai' });
    await call(`/v1/circles/${c.id}/join`, {}, as(sara));
    const ev = await call(`/v1/circles/${c.id}/events`, { title: 'AI Night', startsAt: at(5 * DAY), endsAt: at(5 * DAY + 7200_000), timeZone: 'Asia/Karachi', mode: 'in_person', place: 'Hall A' }, as(bilal));
    await call(`/v1/circle-events/${ev.id}/rsvp`, { status: 'going' }, as(sara), 'PUT');
    await call(`/v1/circle-events/${ev.id}`, { place: 'Hall B' }, as(bilal), 'PATCH');
    launchAs(sara);
    await goCircles();
    fireEvent.press(await screen.findByLabelText(/AI Night/, {}, { timeout: 8000 })); // Coming up
    const changed = await screen.findByTestId('event-changed', {}, { timeout: 8000 });
    expect(within(changed).getByText(/Now at Hall B \(was Hall A\)/)).toBeTruthy();
    expect(screen.getByText(/Educational event/)).toBeTruthy(); // an AI circle
    fireEvent.press(within(changed).getByLabelText('Yes, still going'));
    await waitFor(() => expect(within(screen.getByTestId('event-changed')).queryByText('Still going?')).toBeNull(), { timeout: 8000 });
    expect((await call(`/v1/circle-events/${ev.id}`, undefined, as(sara))).needsAck).toBe(false);
  });

  it('a look-alike “official” circle carries the warning; the circle’s chats can be joined and opened', async () => {
    const bilal = await user('Bilal'), sara = await user('Sara'), scam = await user('Scam');
    const base = unique('Bitcoin YAY');
    await circle(bilal, { name: base }, true);
    const fake = await circle(scam, { name: `${base} Signals` });
    const real = await circle(bilal, { name: unique('Runners Club') });
    await call(`/v1/communities/${real.id}/groups`, { name: 'Sunday runs' }, as(bilal));
    await call(`/v1/circles/${real.id}/join`, {}, as(sara));
    launchAs(sara);
    await goCircles();
    // Discover: the look-alike is marked, the real one is Official.
    fireEvent.press(await screen.findByLabelText('Discover', {}, { timeout: 8000 }));
    fireEvent.changeText(await screen.findByLabelText('Search circles'), base);
    const tile = await waitFor(() => { const x = screen.getAllByTestId('circle-tile').find((n) => within(n).queryByText(fake.name)); expect(x).toBeTruthy(); return x!; }, { timeout: 8000 });
    expect(within(tile).getByText('Not official')).toBeTruthy();
    expect(within(tile).getByTestId('lookalike')).toBeTruthy();
    fireEvent.press(within(screen.getByTestId('discover-screen')).getByLabelText('Circles'));

    // The circle's chats: join a group and it opens.
    await openCircle(real.name);
    fireEvent.press(await screen.findByLabelText(/^Chats/, {}, { timeout: 8000 }));
    const chats = await screen.findByTestId('circle-chats');
    const group = await waitFor(() => { const g = within(chats).getAllByTestId('circle-group').find((n) => within(n).queryByText('Sunday runs')); expect(g).toBeTruthy(); return g!; }, { timeout: 8000 });
    fireEvent.press(within(group).getByLabelText('Join'));
    expect(await screen.findByTestId('thread', {}, { timeout: 10000 })).toBeTruthy();
  });
});

/// <reference types="node" />
import React from 'react';
import { ObjectId } from 'mongodb';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import * as Keychain from 'react-native-keychain';
import AsyncStorage from '@react-native-async-storage/async-storage';
import App from '../App';
import { resetApiForTests } from '../src/lib/api';
import { popupsForTests } from '../src/explore/Popups';
import { API, db } from './helpers';
import { call, say, user, type U } from './people';

// The real API with its development stand-ins: Indexx (any password but "wrong-password") and Jack's AI (sample answers).
const store = (Keychain as unknown as { __store: Map<string, string> }).__store;
const as = (u: U) => u.tokens.accessToken;
function launchAs(u: U) {
  store.set('yays.tokens', JSON.stringify(u.tokens));
  (globalThis as { YAYS_API_URL?: string }).YAYS_API_URL = API;
  resetApiForTests();
  return render(<App />);
}
const ixEmail = (u: U, name: string) => `${name}.${u.id.slice(-8)}@indexx.io`;
const signIn = (u: U, email: string) => call('/v1/indexx/sign-in', { email, password: 'pass-1234' }, as(u));
const give = (u: U, points: number) => db((d) => d.collection('yc_points').updateOne({ _id: new ObjectId(u.id) as never }, { $set: { balance: points, pending: 0 } }, { upsert: true }));
const goExplore = async () => { fireEvent.press(await screen.findByTestId('tab-Explore', {}, { timeout: 8000 })); return screen.findByTestId('explore-screen'); };
const T = { timeout: 8000 };

beforeEach(async () => { store.clear(); await AsyncStorage.clear(); popupsForTests(false); });

describe('Explore on mobile, against the real API', () => {
  it('as the app opens: the daily check-in pop-up; Claim; it doesn’t come back today', async () => {
    const sara = await user('Sara');
    popupsForTests(true);
    const first = launchAs(sara);
    const pop = await screen.findByTestId('checkin-popup', {}, { timeout: 10000 });
    expect(within(pop).getByText('Welcome back, Sara')).toBeTruthy();
    expect(within(pop).getByText('Daily check-in · Day 1')).toBeTruthy();
    fireEvent.press(within(pop).getByLabelText('Claim +10'));
    expect(await within(pop).findByText('+10 INEX added', {}, T)).toBeTruthy();
    expect(within(pop).getByText('New balance: 10 INEX')).toBeTruthy();
    fireEvent.press(within(pop).getByLabelText('Done'));
    await waitFor(() => expect(screen.queryByTestId('checkin-popup')).toBeNull());
    expect((await call('/v1/rewards/points', undefined, as(sara))).balance).toBe(10);
    first.unmount();
    // The server knows it's done for today: the next pop-up is a bonus, not the check-in again.
    popupsForTests(true);
    launchAs(sara);
    expect(await screen.findByTestId('bonus-popup', {}, { timeout: 10000 })).toBeTruthy();
    expect(screen.queryByTestId('checkin-popup')).toBeNull();
    fireEvent.press(within(screen.getByTestId('bonus-popup')).getAllByLabelText('Later').at(-1)!);
    await waitFor(() => expect(screen.queryByTestId('bonus-popup')).toBeNull());
  });

  it('the Explore tab: products, search, check-in from the tile; Earn, history and invites with a friend who joined', async () => {
    const sara = await user('Sara'), hamza = await user('Hamza');
    launchAs(sara);
    const ex = await goExplore();
    for (const p of ['BTCY', 'EMMM', 'ShoperPal', 'ReHuman', 'Wall Street Indexx', 'Academy']) expect(within(ex).getByText(p)).toBeTruthy();
    fireEvent.changeText(within(ex).getByLabelText('Search products and features'), 'emm');
    expect(within(ex).queryByText('BTCY')).toBeNull();
    expect(within(ex).getByText('EMMM')).toBeTruthy();
    fireEvent.changeText(within(ex).getByLabelText('Search products and features'), '');
    // Check in from the tile.
    fireEvent.press(await within(await screen.findByTestId('checkin-tile', {}, T)).findByLabelText('Claim', {}, T));
    fireEvent.press(within(await screen.findByTestId('checkin-popup')).getByLabelText('Claim +10'));
    fireEvent.press(await within(screen.getByTestId('checkin-popup')).findByLabelText('Done', {}, T));
    await waitFor(() => expect(within(screen.getByTestId('explore-screen')).getByTestId('explore-balance').props.children).toBe('10'), T);
    // Hamza joins with Sara's code and says hi.
    const code = (await call('/v1/rewards/referrals', undefined, as(sara))).code as string;
    await call('/v1/rewards/referrals/use', { code }, as(hamza));
    const conv = (await call('/v1/conversations/direct', { userId: sara.id }, as(hamza))).id as string;
    await say(hamza, conv, 'Hi Sara!');
    fireEvent.press(within(screen.getByTestId('explore-screen')).getAllByLabelText('Earn')[0]!);
    const earn = await screen.findByTestId('earn-screen');
    await waitFor(() => expect(within(earn).getByTestId('points-balance').props.children).toBe('110'), T);
    expect(within(earn).getByText('Claimed today. Tomorrow: +10')).toBeTruthy();
    expect(within(earn).getByText('Ways to earn today')).toBeTruthy();
    expect(await within(earn).findByText('Ask Jack’s AI 3 questions', {}, T)).toBeTruthy();
    // History.
    fireEvent.press(within(earn).getByLabelText('History'));
    const hist = await screen.findByTestId('history-screen');
    expect(await within(hist).findByText('Daily check-in', {}, T)).toBeTruthy();
    expect(within(hist).getAllByTestId('ledger-row').length).toBeGreaterThanOrEqual(2);
    fireEvent.press(within(hist).getByLabelText('Spent'));
    expect(await within(hist).findByText('Nothing here yet', {}, T)).toBeTruthy();
    fireEvent.press(within(hist).getByLabelText('Earn'));
    // Invites.
    fireEvent.press(within(await screen.findByTestId('earn-screen')).getAllByLabelText('Invite')[0]!);
    const inv = await screen.findByTestId('invite-screen');
    await waitFor(() => expect(within(inv).getByTestId('invite-code').props.children).toBe(code), T);
    expect(await within(inv).findByText('Hamza', {}, T)).toBeTruthy();
    expect(within(inv).getByText('Rewarded')).toBeTruthy();
  });

  it('Indexx sign-in on Explore: a wrong password, then the live lines; BTCY and EMMM from Indexx', async () => {
    const sara = await user('Sara');
    const email = ixEmail(sara, 'sara');
    launchAs(sara);
    const ex = await goExplore();
    const card = await within(ex).findByTestId('indexx-sign-in', {}, T);
    fireEvent.changeText(within(card).getByLabelText('Indexx email'), email);
    fireEvent.changeText(within(card).getByLabelText('Indexx password'), 'wrong-password');
    fireEvent.press(within(card).getByLabelText('Sign in to Indexx'));
    expect(await within(card).findByText(/Invalid email or password/, {}, T)).toBeTruthy();
    fireEvent.changeText(within(card).getByLabelText('Indexx password'), 'my-indexx-pass');
    fireEvent.press(within(card).getByLabelText('Sign in to Indexx'));
    await waitFor(() => expect(within(ex).queryByTestId('indexx-sign-in')).toBeNull(), T);
    await waitFor(() => expect(within(ex).getByTestId('live-btcy').props.children).toBe('10.00 Nuggets · not mining'), T);
    expect(within(ex).getByTestId('live-emmm').props.children).toBe('1 open · 1 settled this month');
    expect(within(ex).getByTestId('live-shoperpal').props.children).toBe('$64.98 this month · 2 orders');
    expect(within(ex).getByTestId('live-wallstreet').props.children).toBe('1 stock · $500.00 invested');
    // BTCY.
    fireEvent.press(within(ex).getByLabelText(/^BTCY,/));
    const btcy = await screen.findByTestId('btcy-screen');
    await waitFor(() => expect(within(btcy).getByTestId('btcy-nuggets').props.children).toBe('10.00'), T);
    expect(within(btcy).getByText('Nuggets mined, last 7 days')).toBeTruthy();
    expect(within(btcy).getByText('Not mining')).toBeTruthy();
    fireEvent.press(within(btcy).getByLabelText('Explore'));
    // EMMM.
    fireEvent.press(within(await screen.findByTestId('explore-screen')).getByLabelText(/^EMMM,/));
    const prod = await screen.findByTestId('products-screen');
    await waitFor(() => expect(within(prod).getByTestId('emmm-open').props.children).toBe('1'), T);
    expect(within(prod).getByText('Your markets')).toBeTruthy();
    fireEvent.press(within(prod).getByLabelText('Wall Street Indexx'));
    await waitFor(() => expect(within(prod).getByTestId('ws-stocks').props.children).toBe('1'), T);
  });

  it('the wallet: balances from Indexx; withdraw INEX to the exchange with a confirmation; it shows as Completed', async () => {
    const sara = await user('Sara');
    const email = ixEmail(sara, 'sara');
    await signIn(sara, email);
    launchAs(sara);
    const ex = await goExplore();
    fireEvent.press(within(ex).getByLabelText('Wallet'));
    const w = await screen.findByTestId('wallet-screen');
    await waitFor(() => expect(within(w).getByTestId('card-exchange')).toBeTruthy(), T);
    expect(within(within(w).getByTestId('card-inex')).getByText('60')).toBeTruthy();
    expect(within(w).getByText('$47.50')).toBeTruthy();
    expect(within(within(w).getByTestId('card-exchange')).getByText('$1.73')).toBeTruthy();
    expect(await within(w).findByText('Nothing yet. INEX you withdraw to Indexx Exchange shows here.', {}, T)).toBeTruthy();
    fireEvent.press(within(within(w).getByTestId('card-inex')).getByLabelText('Withdraw'));
    const sheet = await screen.findByTestId('withdraw-sheet');
    fireEvent.changeText(within(sheet).getByLabelText('INEX to withdraw'), '10');
    expect(await within(sheet).findByText('The minimum withdrawal is 25 INEX.', {}, T)).toBeTruthy();
    fireEvent.changeText(within(sheet).getByLabelText('INEX to withdraw'), '25');
    await waitFor(() => expect(within(sheet).getByLabelText('Withdraw 25 INEX').props.accessibilityState.disabled).toBe(false), T);
    fireEvent.press(within(sheet).getByLabelText('Withdraw 25 INEX'));
    const conf = await screen.findByTestId('withdraw-confirm');
    expect(within(conf).getByText('25 INEX')).toBeTruthy();
    expect(within(conf).getByText('35 INEX')).toBeTruthy();
    fireEvent.press(within(conf).getByLabelText('Withdraw'));
    expect(await within(w).findByText('25 INEX is on its way to your Indexx Exchange INEX wallet.', {}, T)).toBeTruthy();
    await waitFor(() => expect(within(within(w).getByTestId('card-inex')).getByText('35')).toBeTruthy(), T);
    expect(await within(w).findByText('Completed', {}, T)).toBeTruthy();
    // The Indexx account screen (from Me): signed in, and signing out shows the sign-in again.
    fireEvent.press(within(w).getByLabelText('Explore'));
    fireEvent.press(await screen.findByTestId('tab-Me'));
    fireEvent.press(await screen.findByLabelText('Indexx account'));
    const ix = await screen.findByTestId('indexx-screen');
    expect(await within(ix).findByText(new RegExp(`${email.replace(/[.]/g, '\\.')} · since`), {}, T)).toBeTruthy();
    fireEvent.press(within(ix).getByLabelText('Sign out of Indexx'));
    expect(await within(ix).findByText('Signed out of Indexx.', {}, T)).toBeTruthy();
    expect(within(ix).getByLabelText('Indexx password')).toBeTruthy();
  });

  it('Jack’s AI: an answer, a document, a picture, history; and buying more messages when they run out', async () => {
    const sara = await user('Sara');
    await give(sara, 200);
    launchAs(sara);
    fireEvent.press(within(await goExplore()).getByLabelText('Ask Jack’s AI'));
    const jack = await screen.findByTestId('jack-screen');
    expect(within(jack).getByText(/What can I help with/)).toBeTruthy();
    fireEvent.changeText(within(jack).getByLabelText('Message Jack'), 'Give me 3 post ideas for BTCY Traders');
    fireEvent.press(within(jack).getByLabelText('Send'));
    expect(await within(jack).findByText(/demo mode/, {}, T)).toBeTruthy();
    await waitFor(() => expect(within(jack).getByText('1 of 30')).toBeTruthy(), T);
    // A document.
    fireEvent.press(within(jack).getByLabelText('Document'));
    fireEvent.changeText(within(jack).getByLabelText('Message Jack'), 'Write a sponsorship proposal for Lahore Runners');
    fireEvent.press(within(jack).getByLabelText('Send'));
    fireEvent.press(await within(jack).findByTestId('ai-doc', {}, { timeout: 10000 }));
    const doc = await screen.findByTestId('ai-doc-sheet');
    expect(within(doc).getByText('Version 1')).toBeTruthy();
    expect(within(doc).getByLabelText('Send to chat')).toBeTruthy();
    fireEvent.press(screen.getAllByLabelText('Close').at(-1)!);
    await waitFor(() => expect(screen.queryByTestId('ai-doc-sheet')).toBeNull());
    // A picture.
    fireEvent.press(within(jack).getByLabelText('Image'));
    fireEvent.changeText(within(jack).getByLabelText('Message Jack'), 'A bunny running a race at sunset');
    fireEvent.press(within(jack).getByLabelText('Send'));
    const pics = await within(jack).findByTestId('ai-pictures', {}, { timeout: 15000 });
    expect(within(pics).getByLabelText('Open picture 1 full size')).toBeTruthy();
    expect(within(jack).getByText(/pictures left today/)).toBeTruthy();
    // History: the conversation is there.
    fireEvent.press(within(jack).getByLabelText('History'));
    const hist = await screen.findByTestId('ai-history');
    expect(within(hist).getAllByLabelText(/post ideas|sponsorship|bunny/i).length).toBeGreaterThanOrEqual(1);
    fireEvent.press(within(hist).getByLabelText('New chat'));
    expect(await within(jack).findByTestId('ai-hello')).toBeTruthy();
    // Out of messages: 50 INEX buys 10 more.
    const Redis = require('ioredis') as typeof import('ioredis').default;
    const r = new Redis('redis://127.0.0.1:6430');
    const key = (await r.keys(`ai:q:${sara.id}:*`))[0]!;
    await r.set(key, '30'); r.disconnect();
    fireEvent.press(within(jack).getByLabelText('Chat'));
    fireEvent.changeText(within(jack).getByLabelText('Message Jack'), 'One more');
    fireEvent.press(within(jack).getByLabelText('Send'));
    const out = await within(jack).findByTestId('ai-out', {}, T);
    expect(within(out).getByText('You’ve used today’s 30 messages.')).toBeTruthy();
    const before = (await call('/v1/rewards/points', undefined, as(sara))).balance as number;
    fireEvent.press(within(out).getByLabelText('Use 50 INEX'));
    await waitFor(() => expect(within(jack).getByText('30 of 40')).toBeTruthy(), T);
    expect((await call('/v1/rewards/points', undefined, as(sara))).balance).toBe(before - 50);
  });

  it('help: Jack answers first; “Talk to a person” opens the Support chat with the question', async () => {
    const sara = await user('Sara');
    launchAs(sara);
    fireEvent.press(await screen.findByTestId('tab-Me', {}, T));
    fireEvent.press(await screen.findByLabelText('Help and support'));
    const help = await screen.findByTestId('help-screen');
    fireEvent.changeText(within(help).getByLabelText('Describe the problem'), 'My check-in didn’t add INEX');
    fireEvent.press(within(help).getByLabelText('Get an answer'));
    expect(await within(help).findByTestId('support-answer', {}, T)).toBeTruthy();
    fireEvent.press(within(help).getByLabelText('My check-in didn’t add INEX'));
    expect(within(help).getByText(/Check-ins reset at midnight/)).toBeTruthy();
    fireEvent.press(within(help).getByLabelText('Talk to a person'));
    expect(await screen.findByTestId('thread', {}, { timeout: 10000 })).toBeTruthy();
    expect((await screen.findAllByText(/My check-in didn’t add INEX/, {}, T)).length).toBeGreaterThan(0);
  });
});

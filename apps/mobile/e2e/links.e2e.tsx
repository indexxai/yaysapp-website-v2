/// <reference types="node" />
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Linking } from 'react-native';
import * as Keychain from 'react-native-keychain';
import AsyncStorage from '@react-native-async-storage/async-storage';
import App from '../App';
import { resetApiForTests } from '../src/lib/api';
import { config } from '../src/lib/config';
import { API } from './helpers';
import { call, say, user, type U } from './people';

// Links that open the app (invites, circles, posts, invite codes), handled against the real API.
const store = (Keychain as unknown as { __store: Map<string, string> }).__store;
const T = { timeout: 8000 };
const as = (u: U) => u.tokens.accessToken;
function launchAs(u: U) {
  store.set('yays.tokens', JSON.stringify(u.tokens));
  (globalThis as { YAYS_API_URL?: string }).YAYS_API_URL = API;
  resetApiForTests();
  return render(<App />);
}
/** A link tapped while YaysApp is open (Linking's "url" event). */
const tap = (url: string) => act(() => { for (const [type, fn] of (Linking.addEventListener as jest.Mock).mock.calls) if (type === 'url') (fn as (e: { url: string }) => void)({ url }); });

beforeEach(async () => { store.clear(); await AsyncStorage.clear(); (Linking.getInitialURL as jest.Mock).mockResolvedValue(null); });

describe('Links that open the app, against the real API', () => {
  it('a group invite link: see the group, join it, and its chat opens', async () => {
    const bilal = await user('Bilal'), omar = await user('Omar'), sara = await user('Sara');
    const g = await call('/v1/groups', { name: 'BTCY Traders', memberIds: [omar.id] }, as(bilal));
    await say(bilal, g.id, 'Welcome to the group');
    const { inviteCode } = await call(`/v1/groups/${g.id}/invite`, {}, as(bilal));
    launchAs(sara);
    await screen.findByTestId('tab-Chats', {}, T);
    tap(`${config.webUrl}/join/${inviteCode}`);
    expect(await screen.findByTestId('join-invite', {}, T)).toBeTruthy();
    expect(await screen.findByText('BTCY Traders', {}, T)).toBeTruthy();
    expect(screen.getByText('Group · 2 members')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Join group'));
    expect(await screen.findByTestId('thread', {}, { timeout: 10000 })).toBeTruthy();
    const info = await call(`/v1/groups/${g.id}`, undefined, as(bilal));
    expect(info.members.some((m: { id: string }) => m.id === sara.id)).toBe(true);
  });

  it('a circle invite link (opened from yaysapp://): join the circle and it opens', async () => {
    const hana = await user('Hana'), ali = await user('Ali');
    const c = await call('/v1/circles', { name: `Runners ${Date.now() % 100000}`, about: 'Sunday runs' }, as(hana));
    const { inviteCode } = await call(`/v1/communities/${c.id}/invite`, {}, as(hana));
    // The link that opened the app.
    (Linking.getInitialURL as jest.Mock).mockResolvedValue(`yaysapp://c/${inviteCode}`);
    launchAs(ali);
    expect(await screen.findByTestId('join-invite', {}, { timeout: 10000 })).toBeTruthy();
    expect(await screen.findByText(c.name, {}, T)).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Join circle'));
    expect(await screen.findByTestId('circle-screen', {}, { timeout: 10000 })).toBeTruthy();
    expect((await call(`/v1/circles/${c.id}`, undefined, as(ali))).access).toBe('member');
  });

  it('a shared post link opens the post; an invite code link counts for whoever shared it', async () => {
    const hana = await user('Hana'), ali = await user('Ali');
    const c = await call('/v1/circles', { name: `Readers ${Date.now() % 100000}` }, as(hana));
    const post = await call(`/v1/circles/${c.id}/posts`, { text: 'Book club moves to Thursday' }, as(hana));
    launchAs(ali);
    await screen.findByTestId('tab-Chats', {}, T);
    tap(`${config.webUrl}/circles/post?id=${post.id}`);
    expect(await screen.findByTestId('post-screen', {}, T)).toBeTruthy();
    expect(await screen.findByText('Book club moves to Thursday', {}, T)).toBeTruthy();
    // Hana's invite code, from her link.
    const code = (await call('/v1/rewards/referrals', undefined, as(hana))).code as string;
    tap(`${config.webUrl}/?ref=${code}`);
    await waitFor(async () => expect((await call('/v1/rewards/referrals', undefined, as(hana))).invited).toBe(1), T);
  });
});

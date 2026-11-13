/// <reference types="node" />
import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { Share, StyleSheet } from 'react-native';
import * as Keychain from 'react-native-keychain';
import AsyncStorage from '@react-native-async-storage/async-storage';
import App from '../App';
import { resetApiForTests } from '../src/lib/api';
import { getPrefs } from '../src/lib/prefs';
import { API, codeFor, freshEmail } from './helpers';
import { call, say, user, type U } from './people';

// Me › settings against the real API. Facebook's page is the API's development stand-in, opened by the sign-in browser
// stand-in from jest.setup.js; the share sheet is React Native's Share, watched here.
const store = (Keychain as unknown as { __store: Map<string, string> }).__store;
const { InAppBrowser } = jest.requireMock('react-native-inappbrowser-reborn') as { InAppBrowser: { openAuth: jest.Mock } };
const T = { timeout: 8000 };
function launchAs(u: U) {
  store.set('yays.tokens', JSON.stringify(u.tokens));
  (globalThis as { YAYS_API_URL?: string }).YAYS_API_URL = API;
  resetApiForTests();
  return render(<App />);
}
const me = (u: U) => call('/v1/me', undefined, u.tokens.accessToken);
const direct = async (a: U, b: U) => (await call('/v1/conversations/direct', { userId: b.id }, a.tokens.accessToken)).id as string;
async function openMe(row: string) {
  fireEvent.press(await screen.findByLabelText('Me', {}, T));
  fireEvent.press(await screen.findByLabelText(row, {}, T));
}
const shared = () => jest.spyOn(Share, 'share').mockResolvedValue({ action: Share.sharedAction } as never);

beforeEach(async () => { store.clear(); await AsyncStorage.clear(); });
afterEach(() => { jest.restoreAllMocks(); InAppBrowser.openAuth.mockReset(); InAppBrowser.openAuth.mockImplementation(async () => ({ type: 'cancel' })); });

describe('Me › settings on the phone', () => {
  it('Privacy: who sees last seen and photo, read receipts, and unblocking someone', async () => {
    const ali = await user('Ali'), sara = await user('Sara');
    await call('/v1/blocks', { userId: sara.id }, ali.tokens.accessToken);
    launchAs(ali);
    await openMe('Privacy');
    expect(await screen.findByTestId('privacy-screen', {}, T)).toBeTruthy();
    // "Nobody" appears for last seen, photo and about: the first is last seen.
    fireEvent.press(screen.getAllByLabelText('Nobody')[0]!);
    await waitFor(async () => expect((await me(ali)).privacy.lastSeen).toBe('nobody'), T);
    fireEvent(screen.getByLabelText('Read receipts'), 'valueChange', false);
    await waitFor(async () => expect((await me(ali)).privacy.readReceipts).toBe(false), T);
    const blocked = await screen.findByTestId('blocked-row', {}, T);
    expect(within(blocked).getByText('Sara')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Unblock Sara'));
    expect(await screen.findByText('Sara is unblocked.', {}, T)).toBeTruthy();
    expect(await call('/v1/blocks', undefined, ali.tokens.accessToken)).toEqual([]);
  });

  it('Notifications: previews, groups, sound and quiet hours', async () => {
    const ali = await user('Ali');
    launchAs(ali);
    await openMe('Notifications');
    expect(await screen.findByTestId('notifications-screen', {}, T)).toBeTruthy();
    fireEvent(screen.getByLabelText('Show message preview'), 'valueChange', false);
    await waitFor(async () => expect((await me(ali)).notifications.preview).toBe(false), T);
    fireEvent(screen.getByLabelText('Sound'), 'valueChange', false);
    await waitFor(async () => expect((await me(ali)).preferences.sound).toBe(false), T);
    fireEvent(screen.getByLabelText('Mute everything at night'), 'valueChange', true);
    expect(await screen.findByTestId('quiet-hours', {}, T)).toBeTruthy();
    const from = (await me(ali)).notifications.quietHours.from as string;
    fireEvent.press(screen.getByLabelText('From later'));
    await waitFor(async () => { const q = (await me(ali)).notifications.quietHours; expect(q.on).toBe(true); expect(q.from).not.toBe(from); }, T);
  });

  it('Appearance: dark theme and bigger text are saved to the account and used at once; a chat exports as text', async () => {
    const ali = await user('Ali'), sara = await user('Sara');
    const conv = await direct(sara, ali);
    await say(sara, conv, 'Exported hello');
    launchAs(ali);
    await openMe('Appearance and chats');
    expect(await screen.findByTestId('appearance-screen', {}, T)).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Dark'));
    await waitFor(async () => expect((await me(ali)).preferences.theme).toBe('dark'), T);
    expect(getPrefs().theme).toBe('dark');
    const sample = screen.getByText('This is how messages look.');
    const before = StyleSheet.flatten(sample.props.style).fontSize as number;
    fireEvent.press(screen.getByLabelText('Larger text'));
    await waitFor(async () => expect((await me(ali)).preferences.textSize).toBe(4), T);
    expect(StyleSheet.flatten(screen.getByText('This is how messages look.').props.style).fontSize).toBeGreaterThan(before);
    // Export: pick the chat; its messages go to the share sheet as text.
    const share = shared();
    fireEvent.press(screen.getByLabelText('Export'));
    fireEvent.press(await within(await screen.findByTestId('export-sheet', {}, T)).findByLabelText('Sara', {}, T));
    await waitFor(() => expect(share).toHaveBeenCalled(), T);
    const sent = share.mock.calls[0]![0] as { message: string };
    expect(sent.message).toContain('YaysApp chat with Sara');
    expect(sent.message).toContain('Sara: Exported hello');
    expect(await screen.findByText('Saved 1 message.', {}, T)).toBeTruthy();
  });

  it('Starred messages: listed newest first, and one opens its chat', async () => {
    const ali = await user('Ali'), sara = await user('Sara');
    const conv = await direct(sara, ali);
    const m = await say(sara, conv, 'Remember the 3pm meeting');
    await call(`/v1/conversations/${conv}/messages/${m.message?.id ?? m.id}/star`, {}, ali.tokens.accessToken, 'PUT');
    launchAs(ali);
    await openMe('Starred messages');
    const item = await screen.findByTestId('starred-item', {}, T);
    expect(within(item).getByText('Remember the 3pm meeting')).toBeTruthy();
    fireEvent.press(item);
    expect(await screen.findByTestId('thread', {}, T)).toBeTruthy();
    expect(await screen.findByLabelText('Contact info', {}, T)).toBeTruthy();
  });

  it('Storage: what chats take up, and clearing the phone’s copy keeps the chats', async () => {
    const ali = await user('Ali'), sara = await user('Sara');
    const conv = await direct(sara, ali);
    await say(sara, conv, 'hi');
    launchAs(ali);
    await screen.findByLabelText(/^Chat with Sara/, {}, T);
    await openMe('Storage and data');
    expect(await screen.findByTestId('storage-total', {}, T)).toBeTruthy();
    await waitFor(async () => expect((await AsyncStorage.getAllKeys()).some((k) => k.startsWith('yays.cache.'))).toBe(true), T);
    expect(screen.getByTestId('cache-size')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Clear'));
    expect(await screen.findByText(/Cleared\. Your chats stay/, {}, T)).toBeTruthy();
    expect((await AsyncStorage.getAllKeys()).some((k) => k.startsWith('yays.cache.'))).toBe(false);
  });

  it('Social accounts: add a username, link Facebook through Facebook’s page, choose who sees them; a contact sees them on contact info', async () => {
    const ali = await user('Ali'), sara = await user('Sara');
    const conv = await direct(sara, ali);
    await say(ali, conv, 'hey');
    launchAs(ali);
    await openMe('Social accounts');
    expect(await screen.findByTestId('socials-screen', {}, T)).toBeTruthy();
    fireEvent.press(await screen.findByLabelText('Add Instagram', {}, T));
    fireEvent.changeText(screen.getByLabelText('Username'), '@ali.makes');
    fireEvent.press(screen.getByLabelText('Save'));
    expect(await screen.findByText('Instagram added.', {}, T)).toBeTruthy();
    // Facebook: what's shared, then Facebook's page in the sign-in browser, back to the app.
    InAppBrowser.openAuth.mockImplementationOnce(async (url: string, back: string) => {
      expect(back).toBe('yaysapp://settings/facebook');
      const state = new URL(url).searchParams.get('state')!;
      const r = await fetch(`${API}/v1/oauth/facebook/callback?${new URLSearchParams({ state, dev_name: 'Ali Raza' })}`, { redirect: 'manual' });
      return { type: 'success', url: r.headers.get('location')! };
    });
    fireEvent.press(screen.getByLabelText('Link'));
    expect(await screen.findByText('YaysApp never', {}, T)).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Continue with Facebook'));
    expect(await screen.findByText(/Facebook linked\./, {}, T)).toBeTruthy();
    expect((await screen.findAllByText('Ali Raza · verified', {}, T)).length).toBeGreaterThan(0);
    const s = await call('/v1/me/socials', undefined, ali.tokens.accessToken);
    expect(s.facebook).toMatchObject({ name: 'Ali Raza', login: true });
    fireEvent.press(screen.getByLabelText('My contacts'));
    await waitFor(async () => expect((await call('/v1/me/socials', undefined, ali.tokens.accessToken)).visibility).toBe('contacts'), T);
    // Sara chats with Ali, so she sees both on his contact info.
    const seen = await call(`/v1/users/${ali.id}/socials`, undefined, sara.tokens.accessToken);
    expect(seen.links.map((l: { network: string }) => l.network)).toEqual(['facebook', 'instagram']);
  });

  it('a contact’s socials show on their contact info (p33)', async () => {
    const ali = await user('Ali'), sara = await user('Sara');
    const conv = await direct(sara, ali);
    await say(sara, conv, 'hi Ali');
    await call('/v1/me/socials/x', { network: 'x', handle: '@sara_k' }, sara.tokens.accessToken, 'PUT');
    launchAs(ali);
    fireEvent.press(await screen.findByLabelText(/^Chat with Sara/, {}, T));
    fireEvent.press(await screen.findByLabelText('Contact info', {}, T));
    const box = await screen.findByTestId('user-socials', {}, T);
    expect(within(box).getByLabelText('X: @sara_k')).toBeTruthy();
  });

  it('Profile and account: socials preview, two-step on and off, a new email with a code, and downloading my data', async () => {
    const ali = await user('Ali');
    await call('/v1/me/socials/tiktok', { network: 'tiktok', handle: '@ali' }, ali.tokens.accessToken, 'PUT');
    await call('/v1/me/socials', { visibility: 'contacts' }, ali.tokens.accessToken, 'PUT');
    launchAs(ali);
    await openMe('Profile and account');
    expect(await screen.findByTestId('account-screen', {}, T)).toBeTruthy();
    expect(await screen.findByText('A contact sees all 1 of your socials.', {}, T)).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Anyone else'));
    expect(screen.getByText('Anyone else sees your name and photo only.')).toBeTruthy();
    // Two-step.
    fireEvent.press(screen.getByLabelText('Turn on'));
    const pin = await screen.findByTestId('pin-sheet', {}, T);
    fireEvent.changeText(within(pin).getByLabelText('PIN'), '482916');
    fireEvent.changeText(within(pin).getByLabelText('Type it again'), '482916');
    fireEvent.press(within(pin).getByLabelText('Turn on'));
    expect(await screen.findByText('Two-step verification is on.', {}, T)).toBeTruthy();
    expect((await me(ali)).twoStep).toBe(true);
    fireEvent.press(screen.getByLabelText('Turn off'));
    const off = await screen.findByTestId('pin-off-sheet', {}, T);
    fireEvent.changeText(within(off).getByLabelText('Your PIN'), '482916');
    fireEvent.press(within(off).getByLabelText('Turn off'));
    expect(await screen.findByText('Two-step verification is off.', {}, T)).toBeTruthy();
    // A new email.
    const email = freshEmail('ali2');
    fireEvent.press(screen.getByLabelText('Change email'));
    const sheet = await screen.findByTestId('email-sheet', {}, T);
    fireEvent.changeText(within(sheet).getByLabelText('New email'), email);
    fireEvent.press(within(sheet).getByLabelText('Send code'));
    fireEvent.changeText(await within(sheet).findByLabelText(/^Code sent to/, {}, T), await codeFor(email));
    fireEvent.press(within(sheet).getByLabelText('Change email'));
    expect(await screen.findByText(/Your email was changed/, {}, T)).toBeTruthy();
    expect((await me(ali)).email).toBe(email);
    // My data goes to the share sheet.
    const share = shared();
    fireEvent.press(screen.getByLabelText('Download'));
    await waitFor(() => expect(share).toHaveBeenCalled(), T);
    expect(JSON.parse((share.mock.calls[0]![0] as { message: string }).message)).toHaveProperty('profile');
  });

  it('Delete account: a code, then the phone is back at the welcome screen', async () => {
    const ali = await user('Ali');
    launchAs(ali);
    await openMe('Profile and account');
    fireEvent.press(await screen.findByLabelText('Delete account', {}, T));
    const sheet = await screen.findByTestId('delete-sheet', {}, T);
    fireEvent.press(within(sheet).getByLabelText('Send code to my phone'));
    const field = await within(sheet).findByLabelText(/^Code sent to/, {}, T);
    const to = (await me(ali)).phone as string;
    fireEvent.changeText(field, await codeFor(to));
    fireEvent.press(within(sheet).getByLabelText('Delete account'));
    expect(await screen.findByText('Chat. Earn. Together.', {}, T)).toBeTruthy();
    expect(store.size).toBe(0);
  });
});

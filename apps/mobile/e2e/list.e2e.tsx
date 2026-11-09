/// <reference types="node" />
import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import * as Keychain from 'react-native-keychain';
import AsyncStorage from '@react-native-async-storage/async-storage';
import App from '../App';
import { resetApiForTests } from '../src/lib/api';
import { API } from './helpers';
import { call, say, user, type U } from './people';

const store = (Keychain as unknown as { __store: Map<string, string> }).__store;
function launchAs(u: U) {
  store.set('yays.tokens', JSON.stringify(u.tokens));
  (globalThis as { YAYS_API_URL?: string }).YAYS_API_URL = API;
  resetApiForTests();
  return render(<App />);
}
const direct = async (a: U, b: U, text: string) => { const id = (await call('/v1/conversations/direct', { userId: b.id }, a.tokens.accessToken)).id as string; await say(b, id, text); return id; };
const conv = (u: U, id: string) => call(`/v1/conversations/${id}`, undefined, u.tokens.accessToken);
const rowNames = () => screen.queryAllByTestId('chat-row').map((r) => r.props.accessibilityLabel as string);
const sheetAction = async (chat: RegExp, action: string) => {
  fireEvent(await screen.findByLabelText(chat), 'longPress');
  fireEvent.press(within(await screen.findByTestId('chat-actions')).getByLabelText(action));
};

beforeEach(async () => { store.clear(); await AsyncStorage.clear(); });

describe('The chat list on mobile, against the real API', () => {
  it('filters: unread and groups; long-press to pin, mark read and unread', async () => {
    const ali = await user('Ali'), sara = await user('Sara'), omar = await user('Omar');
    const withSara = await direct(ali, sara, 'Are you coming?');
    const withOmar = await direct(ali, omar, 'Hey');
    await call(`/v1/conversations/${withOmar}/read`, { seq: 1 }, ali.tokens.accessToken).catch(() => undefined);
    const g = await call('/v1/groups', { name: 'Team', memberIds: [sara.id, omar.id] }, ali.tokens.accessToken);
    await say(ali, g.id, 'Standup at 10');
    launchAs(ali);
    await screen.findByLabelText(/^Chat with Team/);
    fireEvent.press(screen.getByRole('tab', { name: /^Groups/ }));
    await waitFor(() => expect(rowNames()).toEqual([expect.stringMatching(/^Chat with Team/)]));
    fireEvent.press(screen.getByRole('tab', { name: /^Unread/ }));
    await waitFor(() => expect(rowNames().some((n) => n.startsWith('Chat with Sara'))).toBe(true));
    expect(rowNames().some((n) => n.startsWith('Chat with Team'))).toBe(false);
    fireEvent.press(screen.getByRole('tab', { name: 'All' }));

    await sheetAction(/^Chat with Sara/, 'Pin chat');
    expect(await screen.findByText('Pinned to the top.')).toBeTruthy();
    await waitFor(async () => expect((await conv(ali, withSara)).pinnedAt).toBeTruthy());
    await sheetAction(/^Chat with Sara/, 'Mark as read');
    await waitFor(async () => expect((await conv(ali, withSara)).unread).toBe(0));
    await sheetAction(/^Chat with Team/, 'Mark as unread');
    await waitFor(async () => expect((await conv(ali, g.id)).markedUnread).toBe(true));
    expect(await screen.findByLabelText(/^Chat with Team, marked unread/)).toBeTruthy();
  });

  it('archive a chat, find it under Archived, and bring it back', async () => {
    const ali = await user('Ali'), sara = await user('Sara'), omar = await user('Omar');
    const withSara = await direct(ali, sara, 'Old news');
    await direct(ali, omar, 'Hello');
    launchAs(ali);
    await sheetAction(/^Chat with Sara/, 'Archive chat');
    fireEvent.press(await screen.findByLabelText('Archived, 1 chat'));
    expect(await screen.findByLabelText(/^Chat with Sara/)).toBeTruthy();
    expect((await conv(ali, withSara)).archived).toBe(true);
    await sheetAction(/^Chat with Sara/, 'Unarchive chat');
    await waitFor(async () => expect((await conv(ali, withSara)).archived).toBe(false));
  });

  it('search finds a message and opens its chat; a username finds a new person', async () => {
    const ali = await user('Ali'), sara = await user('Sara'), zara = await user('Zara');
    await direct(ali, sara, 'Lunch at the biryani place at 1?');
    launchAs(ali);
    fireEvent.press(await screen.findByLabelText('Search'));
    fireEvent.changeText(await screen.findByLabelText('Search'), 'biryani');
    const hit = await screen.findByTestId('search-message', {}, { timeout: 5000 });
    expect(within(hit).getByText(/Sara: Lunch at the biryani place/)).toBeTruthy();
    fireEvent.press(hit);
    expect(await screen.findByText('Lunch at the biryani place at 1?')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Back to chats'));
    fireEvent.press(await screen.findByLabelText('Search'));
    fireEvent.changeText(await screen.findByLabelText('Search'), zara.username);
    fireEvent.press(await screen.findByTestId('search-person', {}, { timeout: 5000 }));
    expect(await screen.findByText('Say hello 👋')).toBeTruthy();
  });
});

/// <reference types="node" />
import React from 'react';
import { Alert } from 'react-native';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import * as Keychain from 'react-native-keychain';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Clipboard from '@react-native-clipboard/clipboard';
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
const direct = async (a: U, b: U) => (await call('/v1/conversations/direct', { userId: b.id }, a.tokens.accessToken)).id as string;
const messages = async (u: U, conv: string) => (await call(`/v1/conversations/${conv}/messages?limit=50`, undefined, u.tokens.accessToken)).items as Array<Record<string, unknown> & { id: string; text: string }>;
const openChat = async (name: string) => fireEvent.press(await screen.findByLabelText(new RegExp(`^Chat with ${name}`)));
/** Long-presses a message by its text (in its own bubble, not in a reply quote of it). */
const longPress = async (text: string) => {
  const bubble = await waitFor(() => [...screen.queryAllByTestId('msg-theirs'), ...screen.queryAllByTestId('msg-mine')].find((b) => within(b).queryAllByText(text).some(() => !within(b).queryByTestId('reply-quote') || !within(within(b).getByTestId('reply-quote')).queryByText(text))) ?? (() => { throw new Error(`no message "${text}"`); })());
  fireEvent(within(bubble).getAllByText(text).at(-1)!, 'longPress');
};
/** Answers the next Alert by pressing the button with this text. */
const answerAlert = (button: string) => jest.spyOn(Alert, 'alert').mockImplementationOnce((_t, _m, buttons) => { buttons?.find((b) => b.text === button)?.onPress?.(); });

beforeEach(async () => { store.clear(); await AsyncStorage.clear(); });
afterEach(() => jest.restoreAllMocks());

describe('Messages on mobile: the long-press menu, against the real API', () => {
  it('react, reply, edit, star, pin, copy and delete for everyone', async () => {
    const ali = await user('Ali'), sara = await user('Sara');
    const conv = await direct(ali, sara);
    await say(sara, conv, 'Hi Ali, lunch today?');
    launchAs(ali);
    await openChat('Sara');

    // React from the menu: the chip shows, and the server has it.
    await longPress('Hi Ali, lunch today?');
    const sheet = await screen.findByTestId('message-sheet');
    fireEvent.press(within(sheet).getByLabelText('React 👍'));
    expect(await screen.findByLabelText('👍 1, yours: tap to remove')).toBeTruthy();
    await waitFor(async () => expect((await messages(sara, conv))[0]!.reactions).toEqual({ '👍': [ali.id] }));

    // Reply: the quote shows in the bar, then in the bubble; the server links them.
    await longPress('Hi Ali, lunch today?');
    fireEvent.press(within(await screen.findByTestId('message-sheet')).getByLabelText('Reply'));
    expect(within(await screen.findByTestId('reply-bar')).getByText('Replying to Sara')).toBeTruthy();
    fireEvent.changeText(screen.getByLabelText('Message'), 'Yes, 1pm');
    fireEvent.press(screen.getByLabelText('Send'));
    await waitFor(() => expect(screen.queryByTestId('reply-bar')).toBeNull());
    const mineBubble = await screen.findByTestId('msg-mine');
    expect(within(mineBubble).getByTestId('reply-quote')).toBeTruthy();
    await waitFor(async () => expect((await messages(sara, conv)).find((m) => m.text === 'Yes, 1pm')?.replyTo).toMatchObject({ text: 'Hi Ali, lunch today?' }));

    // Edit my message: the text goes into the box; Save changes it everywhere.
    await longPress('Yes, 1pm');
    fireEvent.press(within(await screen.findByTestId('message-sheet')).getByLabelText('Edit'));
    expect(await screen.findByTestId('edit-bar')).toBeTruthy();
    expect(screen.getByLabelText('Message').props.value).toBe('Yes, 1pm');
    fireEvent.changeText(screen.getByLabelText('Message'), 'Yes, 1:30pm');
    fireEvent.press(screen.getByLabelText('Save'));
    expect(await screen.findByText('Yes, 1:30pm')).toBeTruthy();
    expect(await screen.findByText('Edited')).toBeTruthy();

    // Star and pin.
    await longPress('Hi Ali, lunch today?');
    fireEvent.press(within(await screen.findByTestId('message-sheet')).getByLabelText('Star'));
    await waitFor(async () => expect((await call('/v1/starred', undefined, ali.tokens.accessToken)).items).toHaveLength(1));
    await longPress('Hi Ali, lunch today?');
    fireEvent.press(within(await screen.findByTestId('message-sheet')).getByLabelText('Pin'));
    expect(within(await screen.findByTestId('pinned')).getByText(/Hi Ali, lunch today\?/)).toBeTruthy();

    // Copy.
    await longPress('Hi Ali, lunch today?');
    fireEvent.press(within(await screen.findByTestId('message-sheet')).getByLabelText('Copy'));
    expect(Clipboard.setString).toHaveBeenCalledWith('Hi Ali, lunch today?');

    // Delete my message for everyone.
    answerAlert('Delete for everyone');
    await longPress('Yes, 1:30pm');
    fireEvent.press(within(await screen.findByTestId('message-sheet')).getByLabelText('Delete'));
    expect(await screen.findByText('You deleted this message')).toBeTruthy();
    await waitFor(async () => expect((await messages(sara, conv)).find((m) => m.id && m.deleted)).toBeTruthy());
  });

  it('forward to another chat with a note, then open it there', async () => {
    const ali = await user('Ali'), sara = await user('Sara'), omar = await user('Omar');
    const withSara = await direct(ali, sara);
    const withOmar = await direct(ali, omar);
    await say(omar, withOmar, 'Hey');
    await say(sara, withSara, 'The meeting moved to Friday');
    launchAs(ali);
    await openChat('Sara');
    await longPress('The meeting moved to Friday');
    fireEvent.press(within(await screen.findByTestId('message-sheet')).getByLabelText('Forward'));
    fireEvent.press(await screen.findByRole('checkbox', { name: 'Omar' }));
    fireEvent.changeText(screen.getByLabelText('Add a note (optional)'), 'FYI');
    fireEvent.press(screen.getByLabelText('Forward'));
    // One chat picked: it opens, with the forwarded copy and the note.
    expect(await screen.findByText('Forwarded')).toBeTruthy();
    expect(await screen.findByText('FYI')).toBeTruthy();
    const got = await messages(omar, withOmar);
    expect(got.find((m) => m.text === 'The meeting moved to Friday')?.forwarded).toBe(true);
  });

  it('message info for my message, and reporting someone else’s', async () => {
    const ali = await user('Ali'), sara = await user('Sara');
    const conv = await direct(ali, sara);
    await say(sara, conv, 'Click this link to win');
    await say(ali, conv, 'Did you get this?');
    launchAs(ali);
    await openChat('Sara');
    await longPress('Did you get this?');
    fireEvent.press(within(await screen.findByTestId('message-sheet')).getByLabelText('Message info'));
    expect(await screen.findByText('Read by')).toBeTruthy();
    expect(await screen.findByText('Sara')).toBeTruthy();

    launchAs(ali);
    await openChat('Sara');
    answerAlert('Spam');
    await longPress('Click this link to win');
    const sheet = await screen.findByTestId('message-sheet');
    expect(within(sheet).queryByLabelText('Edit')).toBeNull(); // not mine
    fireEvent.press(within(sheet).getByLabelText('Report'));
    expect(await screen.findByText('Thanks. Our team will look at it.')).toBeTruthy();
  });

  it('group chats: the group name, sender names, and who is in the chat', async () => {
    const ali = await user('Ali'), sara = await user('Sara'), omar = await user('Omar');
    const g = await call('/v1/groups', { name: 'Weekend trip', memberIds: [sara.id, omar.id] }, ali.tokens.accessToken);
    await say(sara, g.id, 'I can drive');
    await say(omar, g.id, 'I’ll bring snacks');
    launchAs(ali);
    const row = await screen.findByLabelText(/^Chat with Weekend trip/);
    expect(within(row).getByText(/Omar: I’ll bring snacks/)).toBeTruthy();
    fireEvent.press(row);
    expect(await screen.findByText('3 members')).toBeTruthy();
    expect(await screen.findByText('Sara')).toBeTruthy();
    expect(screen.getByText('Omar')).toBeTruthy();
    expect(screen.getAllByTestId('system-line').length).toBeGreaterThan(0);
  });
});

/// <reference types="node" />
import React from 'react';
import { Alert } from 'react-native';
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
/** A chat with one message from b (empty chats aren't listed). */
const direct = async (a: U, b: U) => { const id = (await call('/v1/conversations/direct', { userId: b.id }, a.tokens.accessToken)).id as string; await say(b, id, `Hi from ${b.name}`); return id; };
type Msg = { id: string; text: string; mentions?: string[]; poll?: { question: string; voterCount: number; options: Array<{ id: string; text: string; votes: number }> } };
const messages = async (u: U, conv: string) => (await call(`/v1/conversations/${conv}/messages?limit=50`, undefined, u.tokens.accessToken)).items as Msg[];
const group = (u: U, id: string) => call(`/v1/groups/${id}`, undefined, u.tokens.accessToken);
const answerAlert = (button: string) => jest.spyOn(Alert, 'alert').mockImplementationOnce((_t, _m, buttons) => { buttons?.find((b) => b.text === button)?.onPress?.(); });

beforeEach(async () => { store.clear(); await AsyncStorage.clear(); });
afterEach(() => jest.restoreAllMocks());

describe('Groups, polls and mentions on mobile, against the real API', () => {
  it('make a group from people you chat with; it opens, and everyone is in it', async () => {
    const ali = await user('Ali'), sara = await user('Sara'), omar = await user('Omar');
    await direct(ali, sara); await direct(ali, omar);
    launchAs(ali);
    fireEvent.press(await screen.findByLabelText('New group'));
    fireEvent.changeText(await screen.findByLabelText('Group name'), 'Book club');
    expect(screen.getByLabelText('Create group').props.accessibilityState.disabled).toBe(true);
    fireEvent.press(screen.getByRole('checkbox', { name: 'Sara' }));
    fireEvent.press(screen.getByRole('checkbox', { name: 'Omar' }));
    fireEvent.press(screen.getByLabelText('Create group'));
    expect(await screen.findByText('3 members')).toBeTruthy();
    const list = await call('/v1/conversations', undefined, sara.tokens.accessToken);
    expect(list.items.find((c: { group: { name: string } | null }) => c.group?.name === 'Book club')).toBeTruthy();
  });

  it('a poll: create it, vote, and see someone else’s vote arrive', async () => {
    const ali = await user('Ali'), sara = await user('Sara');
    const g = await call('/v1/groups', { name: 'Lunch', memberIds: [sara.id] }, ali.tokens.accessToken);
    await say(sara, g.id, 'Hungry?');
    launchAs(ali);
    fireEvent.press(await screen.findByLabelText(/^Chat with Lunch/));
    fireEvent.press(await screen.findByLabelText('Attach'));
    fireEvent.press(within(await screen.findByTestId('attach-sheet')).getByLabelText('Poll'));
    fireEvent.changeText(await screen.findByLabelText('Question'), 'Where shall we eat?');
    fireEvent.changeText(screen.getByLabelText('Option 1'), 'Biryani place');
    fireEvent.changeText(screen.getByLabelText('Option 2'), 'Burgers');
    fireEvent.press(screen.getByLabelText('Add option'));
    fireEvent.changeText(screen.getByLabelText('Option 3'), 'Salad bar');
    fireEvent.press(screen.getByLabelText('Send poll'));
    expect(await screen.findByTestId('poll')).toBeTruthy();
    fireEvent.press(await screen.findByRole('radio', { name: 'Biryani place, 0 votes' }));
    expect(await screen.findByRole('radio', { name: 'Biryani place, 1 vote' })).toBeTruthy();
    const poll = (await messages(sara, g.id)).find((m) => m.poll)!;
    expect(poll.poll!.options.map((o) => o.text)).toEqual(['Biryani place', 'Burgers', 'Salad bar']);
    await call(`/v1/conversations/${g.id}/messages/${poll.id}/vote`, { options: [poll.poll!.options[1]!.id] }, sara.tokens.accessToken, 'PUT');
    expect(await screen.findByRole('radio', { name: 'Burgers, 1 vote' })).toBeTruthy();
    expect(await screen.findByText('2 people voted')).toBeTruthy();
  });

  it('@mentions in a group: the list follows what you type, and the person is mentioned', async () => {
    const ali = await user('Ali'), sara = await user('Sara'), omar = await user('Omar');
    const g = await call('/v1/groups', { name: 'Team', memberIds: [sara.id, omar.id] }, ali.tokens.accessToken);
    await say(omar, g.id, 'Morning');
    launchAs(ali);
    fireEvent.press(await screen.findByLabelText(/^Chat with Team/));
    await screen.findByText('Morning');
    fireEvent.changeText(screen.getByLabelText('Message'), 'Thanks @Sa');
    const list = await screen.findByTestId('mention-list');
    expect(within(list).queryByLabelText('Mention Omar')).toBeNull();
    fireEvent.press(within(list).getByLabelText('Mention Sara'));
    expect(screen.getByLabelText('Message').props.value).toBe('Thanks @Sara ');
    fireEvent.changeText(screen.getByLabelText('Message'), 'Thanks @Sara for the notes');
    fireEvent.press(screen.getByLabelText('Send'));
    await waitFor(async () => expect((await messages(sara, g.id)).find((m) => m.text === 'Thanks @Sara for the notes')?.mentions).toEqual([sara.id]));
  });

  it('group info: rename, make someone admin, add a member, exit', async () => {
    const ali = await user('Ali'), sara = await user('Sara'), omar = await user('Omar');
    await direct(ali, omar);
    const g = await call('/v1/groups', { name: 'Trip', memberIds: [sara.id] }, ali.tokens.accessToken);
    await say(sara, g.id, 'Packed!');
    launchAs(ali);
    fireEvent.press(await screen.findByLabelText(/^Chat with Trip/));
    fireEvent.press(await screen.findByLabelText('Group info'));
    await waitFor(() => expect(screen.getAllByTestId('member-row')).toHaveLength(2));
    fireEvent.changeText(screen.getByLabelText('Group name'), 'Trip to Hunza');
    fireEvent.press(screen.getByLabelText('Save'));
    await waitFor(async () => expect((await group(sara, g.id)).name).toBe('Trip to Hunza'));
    answerAlert('Make admin');
    fireEvent.press(screen.getByLabelText('Sara'));
    await waitFor(async () => expect((await group(sara, g.id)).adminIds).toContain(sara.id));
    expect(await screen.findByLabelText('Sara, admin')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Add members'));
    fireEvent.press(await screen.findByRole('checkbox', { name: 'Omar' }));
    fireEvent.press(screen.getByLabelText('Add'));
    await waitFor(async () => expect((await group(sara, g.id)).members.map((m: { id: string }) => m.id)).toContain(omar.id));
    answerAlert('Exit');
    fireEvent.press(await screen.findByLabelText('Exit group'));
    expect(await screen.findByText('You left the group.')).toBeTruthy();
    expect(await screen.findByLabelText('Delete group')).toBeTruthy();
  });

  it('contact info: mute, block and unblock', async () => {
    const ali = await user('Ali'), sara = await user('Sara');
    const conv = await direct(ali, sara);
    launchAs(ali);
    fireEvent.press(await screen.findByLabelText(/^Chat with Sara/));
    fireEvent.press(await screen.findByLabelText('Contact info'));
    expect(await screen.findByTestId('contact-info')).toBeTruthy();
    answerAlert('8 hours');
    fireEvent.press(screen.getByLabelText('Mute notifications'));
    expect(await screen.findByText('Muted for 8 hours.')).toBeTruthy();
    await waitFor(async () => expect(Date.parse((await call(`/v1/conversations/${conv}`, undefined, ali.tokens.accessToken)).mutedUntil)).toBeGreaterThan(Date.now()));
    answerAlert('Block');
    fireEvent.press(screen.getByLabelText('Block Sara'));
    expect(await screen.findByText('Sara is blocked.')).toBeTruthy();
    expect((await call('/v1/blocks', undefined, ali.tokens.accessToken)).map((p: { id: string }) => p.id)).toEqual([sara.id]);
    fireEvent.press(await screen.findByLabelText('Unblock Sara'));
    expect(await screen.findByText('Sara is unblocked.')).toBeTruthy();
  });
});

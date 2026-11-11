/// <reference types="node" />
import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import * as Keychain from 'react-native-keychain';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Vibration } from 'react-native';
import App from '../App';
import { resetApiForTests } from '../src/lib/api';
import { API } from './helpers';
import { call, say, user, type U } from './people';

// No WebRTC under Jest: livekit-client is the stand-in from jest.setup.js, the call API and LiveKit server are real.
const lk = jest.requireMock('livekit-client') as { __rooms: Array<{ url?: string; token?: string; disconnected?: boolean; localParticipant: { isMicrophoneEnabled: boolean; isCameraEnabled: boolean; pubs: Record<string, { track: { facingMode?: string } } | undefined> }; __join: (id: string, o?: { video?: boolean }) => void }> };
const audio = jest.requireMock('@livekit/react-native') as { __outputs: { selected: string[] } };
const lastRoom = () => lk.__rooms[lk.__rooms.length - 1]!;
const store = (Keychain as unknown as { __store: Map<string, string> }).__store;
function launchAs(u: U) {
  store.set('yays.tokens', JSON.stringify(u.tokens));
  (globalThis as { YAYS_API_URL?: string }).YAYS_API_URL = API;
  resetApiForTests();
  return render(<App />);
}
const direct = async (a: U, b: U, text = `Hi from ${b.name}`) => { const id = (await call('/v1/conversations/direct', { userId: b.id }, a.tokens.accessToken)).id as string; await say(b, id, text); return id; };
type View = { id: string; status: string; outcome: string | null; participants: Array<{ userId: string; state: string }> };
const live = async (u: U) => (await call('/v1/calls/live', undefined, u.tokens.accessToken)) as View[];
const getCall = async (u: U, id: string) => (await call(`/v1/calls/${id}`, undefined, u.tokens.accessToken)) as View;
const status = () => screen.getAllByTestId('call-status').map((n) => (n.props.children as string))[0] ?? '';

beforeEach(async () => { store.clear(); await AsyncStorage.clear(); audio.__outputs.selected.length = 0; });
afterEach(() => jest.restoreAllMocks());

describe('Calls on mobile, against the real API and LiveKit', () => {
  it('a voice call from the chat: it rings them, they answer, the timer runs; mute, speaker, end; the call shows in the chat', async () => {
    const ali = await user('Ali'), sara = await user('Sara');
    await direct(ali, sara);
    launchAs(ali);
    fireEvent.press(await screen.findByLabelText(/^Chat with Sara/));
    fireEvent.press(await screen.findByLabelText('Voice call'));
    expect(await screen.findByTestId('call-screen')).toBeTruthy();
    // Sara's phone is being rung by the server; the room is the server's LiveKit room.
    let rung: View | undefined;
    await waitFor(async () => { rung = (await live(sara))[0]; expect(rung?.participants.find((p) => p.userId === sara.id)?.state).toBe('ringing'); });
    await waitFor(() => expect(status()).toBe('Ringing…'));
    expect(lastRoom().url).toMatch(/^ws:\/\/127\.0\.0\.1:/);
    expect(lastRoom().token?.length).toBeGreaterThan(20);
    expect(lastRoom().localParticipant.isMicrophoneEnabled).toBe(true);
    // A voice call starts on the earpiece.
    await waitFor(() => expect(audio.__outputs.selected.at(-1)).toBe('earpiece'));

    await call(`/v1/calls/${rung!.id}/accept`, {}, sara.tokens.accessToken);
    await waitFor(() => expect(status()).toMatch(/^0:0\d$/), { timeout: 5000 });

    fireEvent.press(screen.getByLabelText('Mute'));
    await waitFor(() => expect(screen.getByLabelText('Unmute')).toBeTruthy());
    expect(lastRoom().localParticipant.isMicrophoneEnabled).toBe(false);
    fireEvent.press(screen.getByLabelText('Speaker'));
    await waitFor(() => expect(audio.__outputs.selected.at(-1)).toBe('speaker'));
    expect(screen.getByLabelText('Speaker on')).toBeTruthy();

    fireEvent.press(screen.getByTestId('hang-up'));
    await waitFor(async () => expect((await getCall(sara, rung!.id)).status).toBe('ended'));
    expect((await getCall(sara, rung!.id)).outcome).toBe('completed');
    await waitFor(() => expect(screen.queryByTestId('call-screen')).toBeNull());
    expect(lastRoom().disconnected).toBe(true);
    const line = await screen.findByTestId('call-line');
    expect(within(line).getByText(/^Voice call · /)).toBeTruthy();
    expect(within(line).getByLabelText('Call back (voice)')).toBeTruthy();
  });

  it('an incoming video call rings the phone; answer it, see them, flip the camera; they hang up and the screen closes', async () => {
    const ali = await user('Ali'), sara = await user('Sara');
    const conv = await direct(ali, sara);
    const vibrate = jest.spyOn(Vibration, 'vibrate');
    launchAs(ali);
    await screen.findByLabelText(/^Chat with Sara/);
    const started = await call('/v1/calls', { conversationId: conv, media: 'video' }, sara.tokens.accessToken);
    const ring = await screen.findByTestId('incoming-call', {}, { timeout: 8000 });
    expect(within(ring).getByText(/Incoming video call/)).toBeTruthy();
    expect(within(ring).getByText('Sara')).toBeTruthy();
    expect(vibrate).toHaveBeenCalled();

    fireEvent.press(within(ring).getByLabelText('Accept'));
    expect(await screen.findByTestId('call-screen')).toBeTruthy();
    await waitFor(() => expect(screen.queryByTestId('incoming-call')).toBeNull());
    await waitFor(async () => expect((await getCall(sara, started.call.id)).participants.find((p) => p.userId === ali.id)?.state).toBe('joined'));
    // My camera is on; a video call uses the loudspeaker.
    await waitFor(() => expect(lastRoom().localParticipant.isCameraEnabled).toBe(true));
    await waitFor(() => expect(audio.__outputs.selected.at(-1)).toBe('speaker'));
    // Sara's phone joins the room with her camera on: she fills the screen, I'm in the corner.
    act(() => { lastRoom().__join(sara.id, { video: true }); });
    expect(await screen.findByTestId('local-video')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Flip'));
    await waitFor(() => expect(lastRoom().localParticipant.pubs.camera?.track.facingMode).toBe('environment'));

    await call(`/v1/calls/${started.call.id}/leave`, {}, sara.tokens.accessToken);
    await waitFor(() => expect(status()).toBe('Call ended'), { timeout: 5000 });
    await waitFor(() => expect(screen.queryByTestId('call-screen')).toBeNull(), { timeout: 5000 });
  });

  it('decline an incoming call: the caller sees it declined', async () => {
    const ali = await user('Ali'), sara = await user('Sara');
    const conv = await direct(ali, sara);
    launchAs(ali);
    await screen.findByLabelText(/^Chat with Sara/);
    const started = await call('/v1/calls', { conversationId: conv, media: 'voice' }, sara.tokens.accessToken);
    fireEvent.press(within(await screen.findByTestId('incoming-call', {}, { timeout: 8000 })).getByLabelText('Decline'));
    await waitFor(async () => expect((await getCall(sara, started.call.id)).outcome).toBe('declined'));
    await waitFor(() => expect(screen.queryByTestId('incoming-call')).toBeNull());
  });

  it('a missed call: the Calls tab shows it in red with a badge, and calls back', async () => {
    const ali = await user('Ali'), sara = await user('Sara');
    const conv = await direct(ali, sara);
    const started = await call('/v1/calls', { conversationId: conv, media: 'voice' }, sara.tokens.accessToken);
    // Nobody answers: the server gives up after the ring time.
    await waitFor(async () => expect((await getCall(sara, started.call.id)).outcome).toBe('missed'), { timeout: 15000, interval: 500 });
    launchAs(ali);
    expect(await screen.findByLabelText(/1 missed call/, {}, { timeout: 8000 })).toBeTruthy();
    fireEvent.press(screen.getByRole('tab', { name: /^Calls/ }));
    const row = await screen.findByTestId('call-row');
    expect(within(row).getByLabelText(/^Sara, Missed, /)).toBeTruthy();
    fireEvent.press(within(row).getByLabelText('Call Sara (voice)'));
    expect(await screen.findByTestId('call-screen')).toBeTruthy();
    await waitFor(async () => expect((await live(sara))[0]?.participants.find((p) => p.userId === sara.id)?.state).toBe('ringing'));
    fireEvent.press(screen.getByTestId('hang-up'));
    await waitFor(async () => expect(await live(sara)).toEqual([]));
  });

  it('a group call already going on: Join from the chat, see who is on it, ring someone else in', async () => {
    const ali = await user('Ali'), sara = await user('Sara'), omar = await user('Omar'), hina = await user('Hina');
    const g = await call('/v1/groups', { name: 'Trip', memberIds: [ali.id, omar.id, hina.id] }, sara.tokens.accessToken);
    await say(sara, g.id, 'Calling everyone');
    const started = await call('/v1/calls', { conversationId: g.id, media: 'voice' }, sara.tokens.accessToken);
    await call(`/v1/calls/${started.call.id}/accept`, {}, omar.tokens.accessToken);
    await call(`/v1/calls/${started.call.id}/decline`, {}, hina.tokens.accessToken);
    launchAs(ali);
    // The ring is still on screen; take it from the chat instead.
    fireEvent.press(within(await screen.findByTestId('incoming-call', {}, { timeout: 8000 })).getByLabelText('Message'));
    fireEvent.press(await screen.findByLabelText(/^Join voice call/, {}, { timeout: 8000 }));
    expect(await screen.findByTestId('call-screen')).toBeTruthy();
    await waitFor(() => expect(status()).toMatch(/^\d+:\d\d · 3 on the call$/), { timeout: 5000 });
    expect(screen.getByLabelText('On the call')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Add people'));
    fireEvent.press(await screen.findByLabelText('Ring Hina'));
    await waitFor(async () => expect((await getCall(sara, started.call.id)).participants.find((p) => p.userId === hina.id)?.state).toBe('ringing'));
    fireEvent.press(screen.getByLabelText('Close'));
    // Minimise to use the app; the bar brings the call back.
    fireEvent.press(screen.getByLabelText('Minimise call'));
    fireEvent.press(await screen.findByLabelText('Back to call'));
    fireEvent.press(await screen.findByTestId('hang-up'));
    await waitFor(async () => expect((await getCall(sara, started.call.id)).participants.find((p) => p.userId === ali.id)?.state).toBe('left'));
  });
});

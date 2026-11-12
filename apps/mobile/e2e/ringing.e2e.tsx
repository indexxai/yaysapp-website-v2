/// <reference types="node" />
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { AppState, PermissionsAndroid, Platform } from 'react-native';
import * as Keychain from 'react-native-keychain';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { callUuid } from '@yays/shared';
import App from '../App';
import { resetApiForTests } from '../src/lib/api';
import { handleCallPush, registerBackgroundCallHandlers } from '../src/calls/ringing';
import { API } from './helpers';
import { call, say, user, type U } from './people';

// The real call API and LiveKit; the phone's call screens are the stand-ins from jest.setup.js: CallKit (iPhone)
// and Notifee's full-screen notification (Android). Pushes are the API's development recording (/v1/_test/pushes).
const store = (Keychain as unknown as { __store: Map<string, string> }).__store;
const CK = (jest.requireMock('react-native-callkeep') as { default: { __emit: (t: string, a: unknown) => void; __answered: string[]; __ended: string[]; __reportedEnd: string[] } }).default;
const V = (jest.requireMock('react-native-voip-push-notification') as { default: { __emit: (t: string, a: unknown) => void } }).default;
const N = (jest.requireMock('@notifee/react-native') as { default: { __shown: Array<{ id: string; title: string; data: Record<string, string>; android: Record<string, unknown> }>; __cancelled: string[]; __bg: ((e: unknown) => Promise<void>) | null; __initial: unknown } }).default;
const T = { timeout: 8000 };
function launchAs(u: U) {
  store.set('yays.tokens', JSON.stringify(u.tokens));
  (globalThis as { YAYS_API_URL?: string }).YAYS_API_URL = API;
  resetApiForTests();
  return render(<App />);
}
type View = { id: string; status: string; outcome: string | null; participants: Array<{ userId: string; state: string }> };
const direct = async (a: U, b: U) => { const id = (await call('/v1/conversations/direct', { userId: b.id }, a.tokens.accessToken)).id as string; await say(b, id, `Hi from ${b.name}`); return id; };
const ring = async (from: U, conv: string, media: 'voice' | 'video' = 'voice') => (await call('/v1/calls', { conversationId: conv, media }, from.tokens.accessToken)).call as View;
const getCall = async (u: U, id: string) => (await call(`/v1/calls/${id}`, undefined, u.tokens.accessToken)) as View;
const pushes = async (u: U) => (await (await fetch(`${API}/v1/_test/pushes?userId=${u.id}`)).json()) as Array<{ endpoint: string; payload: Record<string, string> }>;
/** The phone goes to the home screen: the app's listeners hear it, and the server stops counting it as "in front". */
const background = () => act(() => { for (const [type, fn] of (AppState.addEventListener as jest.Mock).mock.calls) if (type === 'change') (fn as (s: string) => void)('background'); });
const subscription = async (endpoint: string) => {
  const { db } = require('./helpers') as typeof import('./helpers');
  await waitFor(async () => expect(await db((d) => d.collection('yc_push_subscriptions').countDocuments({ endpoint }))).toBe(1), { timeout: 8000, interval: 200 });
};

beforeEach(async () => { store.clear(); await AsyncStorage.clear(); CK.__answered.length = 0; CK.__ended.length = 0; CK.__reportedEnd.length = 0; N.__shown.length = 0; N.__cancelled.length = 0; });
afterEach(() => { jest.restoreAllMocks(); });

describe('iPhone: calls ring on the phone’s call screen (CallKit)', () => {
  it('gives the server its VoIP token; a call while away comes as a VoIP push; Answer on CallKit answers it; hanging up in the app ends CallKit’s call', async () => {
    const ali = await user('Ali'), sara = await user('Sara');
    const conv = await direct(ali, sara);
    launchAs(sara);
    await screen.findByLabelText(/^Chat with Ali/, {}, T);
    const VOIP = 'f'.repeat(64);
    act(() => V.__emit('register', VOIP));
    await subscription(`voip:${VOIP}`);
    background();
    await new Promise((r) => setTimeout(r, 400));
    const c = await ring(ali, conv);
    const uuid = callUuid(c.id);
    // The server rang the iPhone by VoIP, with what CallKit shows (AppDelegate reports it before any JavaScript runs).
    await waitFor(async () => expect((await pushes(sara)).some((p) => p.endpoint === `voip:${VOIP}` && p.payload.type === 'call' && p.payload.callId === c.id)).toBe(true), T);
    act(() => CK.__emit('didDisplayIncomingCall', { callUUID: uuid, payload: { type: 'call', callId: c.id, media: 'voice' } }));
    act(() => CK.__emit('answerCall', { callUUID: uuid }));
    await waitFor(async () => expect((await getCall(ali, c.id)).participants.find((p) => p.userId === sara.id)?.state).toBe('joined'), T);
    expect(await screen.findByTestId('call-screen', {}, T)).toBeTruthy();
    // Hanging up in the app takes the call off CallKit too.
    fireEvent.press(screen.getByTestId('hang-up'));
    await waitFor(() => expect(CK.__ended).toContain(uuid), T);
    await waitFor(async () => expect((await getCall(ali, c.id)).status).toBe('ended'), T);
  });

  it('End on CallKit declines the call; a call the caller gives up on is taken off CallKit', async () => {
    const ali = await user('Ali'), sara = await user('Sara');
    const conv = await direct(ali, sara);
    launchAs(sara);
    await screen.findByLabelText(/^Chat with Ali/, {}, T);
    background();
    // Declined from the call screen.
    const c1 = await ring(ali, conv);
    act(() => CK.__emit('didDisplayIncomingCall', { callUUID: callUuid(c1.id), payload: { type: 'call', callId: c1.id, media: 'video' } }));
    act(() => CK.__emit('endCall', { callUUID: callUuid(c1.id) }));
    await waitFor(async () => expect(await getCall(ali, c1.id)).toMatchObject({ status: 'ended', outcome: 'declined' }), T);
    // The caller hangs up while it rings: CallKit's call is ended for them.
    const c2 = await ring(ali, conv);
    act(() => CK.__emit('didDisplayIncomingCall', { callUUID: callUuid(c2.id), payload: { type: 'call', callId: c2.id, media: 'voice' } }));
    await call(`/v1/calls/${c2.id}/leave`, {}, ali.tokens.accessToken);
    await waitFor(() => expect(CK.__reportedEnd).toContain(callUuid(c2.id)), T);
  });
});

describe('Android: calls ring as a full-screen call notification', () => {
  beforeEach(() => {
    jest.replaceProperty(Platform, 'OS', 'android');
    jest.spyOn(PermissionsAndroid, 'requestMultiple').mockResolvedValue({ [PermissionsAndroid.PERMISSIONS.RECORD_AUDIO]: 'granted', [PermissionsAndroid.PERMISSIONS.CAMERA]: 'granted' } as never);
    registerBackgroundCallHandlers();
  });

  it('the ring push shows a ringing full-screen notification; Decline on it declines the call', async () => {
    const ali = await user('Ali'), sara = await user('Sara');
    const conv = await direct(ali, sara);
    await call('/v1/push/devices', { platform: 'android', token: 'fcm-sara-' + 'a'.repeat(30) }, sara.tokens.accessToken);
    // Sara's phone is signed in, with YaysApp closed.
    store.set('yays.tokens', JSON.stringify(sara.tokens));
    (globalThis as { YAYS_API_URL?: string }).YAYS_API_URL = API;
    resetApiForTests();
    const c = await ring(ali, conv, 'video');
    // What Firebase would hand the app (data only), from the server's record of it.
    let push: Record<string, string> | undefined;
    await waitFor(async () => { push = (await pushes(sara)).find((p) => p.payload.type === 'call' && p.payload.callId === c.id)?.payload; expect(push).toBeTruthy(); }, T);
    await handleCallPush(push!);
    const n = N.__shown.at(-1)!;
    expect(n).toMatchObject({ id: `call:${c.id}`, title: 'Ali', body: 'Incoming video call', data: { callId: c.id, media: 'video' } });
    expect(n.android).toMatchObject({ channelId: 'calls', category: 'call', ongoing: true, loopSound: true, fullScreenAction: { id: 'default', launchActivity: 'default' } });
    expect((n.android.actions as Array<{ title: string }>).map((a) => a.title)).toEqual(['Decline', 'Answer video']);
    // Decline, with YaysApp closed (the background handler).
    await N.__bg!({ type: 2, detail: { pressAction: { id: 'decline' }, notification: { data: n.data } } });
    expect(N.__cancelled).toContain(`call:${c.id}`);
    await waitFor(async () => expect(await getCall(ali, c.id)).toMatchObject({ status: 'ended', outcome: 'declined' }), T);
  });

  it('Answer on the notification opens the app, which answers; a call that stops ringing takes the notification away', async () => {
    const ali = await user('Ali'), sara = await user('Sara');
    const conv = await direct(ali, sara);
    const c = await ring(ali, conv);
    await handleCallPush({ type: 'call', callId: c.id, media: 'voice', caller: 'Ali' });
    await N.__bg!({ type: 2, detail: { pressAction: { id: 'answer' }, notification: { data: { callId: c.id, media: 'voice' } } } });
    // The app opens (Answer launches it) and picks the call up.
    launchAs(sara);
    await waitFor(async () => expect((await getCall(ali, c.id)).participants.find((p) => p.userId === sara.id)?.state).toBe('joined'), { timeout: 10000 });
    expect(await screen.findByTestId('call-screen', {}, T)).toBeTruthy();
    // A second call that the caller gives up on: its notification goes.
    await call(`/v1/calls/${c.id}/leave`, {}, ali.tokens.accessToken);
    await handleCallPush({ type: 'call_end', callId: 'aaaaaaaaaaaaaaaaaaaaaaaa' });
    expect(N.__cancelled).toContain('call:aaaaaaaaaaaaaaaaaaaaaaaa');
  });
});

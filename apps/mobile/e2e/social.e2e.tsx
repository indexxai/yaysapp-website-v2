/// <reference types="node" />
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { AppState } from 'react-native';
import * as Keychain from 'react-native-keychain';
import AsyncStorage from '@react-native-async-storage/async-storage';
import App from '../App';
import { resetApiForTests } from '../src/lib/api';
import { config } from '../src/lib/config';
import { API, freshEmail } from './helpers';
import { call, say, user, type U } from './people';

// The real API (GOOGLE_DRIVER and FACEBOOK_DRIVER are its development stand-ins); Google's sheet, the sign-in
// browser and Apple's push registration are the stand-ins from jest.setup.js.
const store = (Keychain as unknown as { __store: Map<string, string> }).__store;
const google = (jest.requireMock('@react-native-google-signin/google-signin') as { __google: { __next: unknown } }).__google;
const { InAppBrowser } = jest.requireMock('react-native-inappbrowser-reborn') as { InAppBrowser: { openAuth: jest.Mock } };
const ios = (jest.requireMock('@react-native-community/push-notification-ios') as { default: { __emit: (t: string, a: unknown) => void; __allow: boolean; __delivered: unknown[]; __removed: string[]; requestPermissions: jest.Mock } }).default;
function launch(u?: U) {
  if (u) store.set('yays.tokens', JSON.stringify(u.tokens));
  (globalThis as { YAYS_API_URL?: string }).YAYS_API_URL = API;
  resetApiForTests();
  return render(<App />);
}
/** The phone goes to the home screen: the app's own AppState listeners hear it (the server then notifies). */
const appState = (state: 'background' | 'active') => act(() => { for (const [type, fn] of (AppState.addEventListener as jest.Mock).mock.calls) if (type === 'change') (fn as (s: string) => void)(state); });
const devToken = (o: object) => `dev.${Buffer.from(JSON.stringify(o)).toString('base64url')}`;
/** Plays Facebook: the stand-in page, "Continue" as `name` (or cancel), then where the browser is sent. */
async function viaFacebook(url: string, name: string | null) {
  const state = new URL(url).searchParams.get('state')!;
  const q = new URLSearchParams(name === null ? { state, error: 'access_denied' } : { state, dev_name: name });
  const r = await fetch(`${API}/v1/oauth/facebook/callback?${q}`, { redirect: 'manual' });
  return r.headers.get('location')!;
}
const fbBrowser = (name: string | null) => InAppBrowser.openAuth.mockImplementationOnce(async (url: string, back: string) => {
  expect(back).toBe('yaysapp://auth/facebook');
  const to = await viaFacebook(url, name);
  expect(to.startsWith('yaysapp://auth/facebook?')).toBe(true); // Facebook sends the browser back to the app
  return { type: 'success', url: to };
});
async function linkFacebook(u: U, name: string) {
  const { url } = await call('/v1/me/socials/facebook/start', { login: true }, u.tokens.accessToken);
  expect(await viaFacebook(url, name)).toMatch(/fb=linked/);
}

beforeEach(async () => { store.clear(); await AsyncStorage.clear(); config.google.webClientId = ''; ios.__allow = true; ios.__delivered.length = 0; ios.__removed.length = 0; });
afterEach(() => jest.clearAllMocks());

describe('Google and Facebook sign-in on mobile, against the real API', () => {
  it('Google in a development build: the stand-in signs up a new Google account, named by Google', async () => {
    launch();
    fireEvent.press(await screen.findByLabelText('Get started'));
    fireEvent.press(await screen.findByLabelText('Google'));
    expect(await screen.findByTestId('dev-google')).toBeTruthy();
    const email = freshEmail('gina');
    fireEvent.changeText(screen.getByLabelText('Google email'), email);
    fireEvent.changeText(screen.getByLabelText('Name on Google (optional)'), 'Gina Khan');
    fireEvent.press(screen.getByLabelText('Continue'));
    // A new account, named by Google: straight to Chats (as on the web).
    expect(await screen.findByText(/Gina Khan/, {}, { timeout: 8000 })).toBeTruthy();
    expect(screen.getByText(/Your account is ready/)).toBeTruthy();
  });

  it('Google with client ids: Google’s sheet gives the token, an existing account signs in', async () => {
    const sara = await user('Sara');
    const me = await call('/v1/me', undefined, sara.tokens.accessToken);
    config.google.webClientId = 'web-client.apps.googleusercontent.com';
    google.__next = { type: 'success', data: { idToken: devToken({ sub: `g-${sara.id}`, email: me.email, email_verified: true, name: 'Sara' }) } };
    launch();
    fireEvent.press(await screen.findByLabelText('Get started'));
    fireEvent.press(await screen.findByLabelText('Google'));
    expect(await screen.findByText('Welcome, Sara', {}, { timeout: 8000 })).toBeTruthy();
    // Closing Google's sheet does nothing.
  });

  it('Facebook, linked to an account: the sign-in browser goes to Facebook and back, and it signs in', async () => {
    const omar = await user('Omar');
    await linkFacebook(omar, 'Omar Farooq');
    launch();
    fireEvent.press(await screen.findByLabelText('Get started'));
    fbBrowser('Omar Farooq');
    fireEvent.press(await screen.findByLabelText('Facebook'));
    expect(await screen.findByText('Welcome, Omar', {}, { timeout: 8000 })).toBeTruthy();
    const sessions = await call('/v1/me/devices', undefined, omar.tokens.accessToken);
    expect(sessions.some((s: { platform: string }) => s.platform === 'ios')).toBe(true);
  });

  it('Facebook not linked: the design’s explanation, and email from there; cancelling does nothing', async () => {
    launch();
    fireEvent.press(await screen.findByLabelText('Get started'));
    fbBrowser(null);
    fireEvent.press(await screen.findByLabelText('Facebook'));
    await waitFor(() => expect(InAppBrowser.openAuth).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('facebook-not-linked')).toBeNull();
    fbBrowser('Someone New');
    fireEvent.press(await screen.findByLabelText('Facebook'));
    expect(await screen.findByTestId('facebook-not-linked', {}, { timeout: 8000 })).toBeTruthy();
    expect(screen.getByText('Someone New')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Sign in with email'));
    expect(await screen.findByLabelText('Email')).toBeTruthy();
  });
});

describe('Notifications on iPhone, against the real API', () => {
  const pushes = async (u: U) => (await (await fetch(`${API}/v1/_test/pushes?userId=${u.id}`)).json()) as Array<{ endpoint: string; payload: { type: string; title: string; body: string } }>;

  it('asks, gives the server the token, gets a message while away, and a tap opens the chat', async () => {
    const ali = await user('Ali'), sara = await user('Sara');
    const conv = (await call('/v1/conversations/direct', { userId: sara.id }, ali.tokens.accessToken)).id as string;
    await say(sara, conv, 'Hi Ali');
    launch(ali);
    await screen.findByLabelText(/^Chat with Sara/);
    await waitFor(() => expect(ios.requestPermissions).toHaveBeenCalled());
    // Apple gives the phone its token; the app hands it to the server.
    const token = 'a1b2c3'.repeat(10) + 'beef';
    act(() => ios.__emit('register', token));
    // While the app is in front the server sends nothing (the app shows it); on the home screen it notifies.
    appState('background');
    // The token and "not in front" reach the server over the network: wait for both, then one message.
    await waitFor(async () => {
      const { db } = require('./helpers') as typeof import('./helpers');
      expect(await db((d) => d.collection('yc_push_subscriptions').countDocuments({ endpoint: `apns:${token}` }))).toBe(1);
    }, { timeout: 8000, interval: 300 });
    await new Promise((r) => setTimeout(r, 300));
    await say(sara, conv, 'Are you there?');
    await waitFor(async () => {
      expect((await pushes(ali)).some((p) => p.endpoint === `apns:${token}` && p.payload.body === 'Are you there?')).toBe(true);
    }, { timeout: 8000, interval: 300 });
    // Tapping the notification brings the app back and opens the chat.
    appState('active');
    act(() => ios.__emit('notification', { getData: () => ({ type: 'message', conversationId: conv, userInteraction: 1 }), finish: () => undefined }));
    expect(await screen.findByTestId('thread', {}, { timeout: 8000 })).toBeTruthy();
    expect((await screen.findAllByText('Are you there?')).length).toBeGreaterThan(0);
    // "Read on another device" takes that chat's notifications off the phone.
    ios.__delivered.push({ identifier: 'n1', userInfo: { conversationId: conv } }, { identifier: 'n2', userInfo: { conversationId: 'other' } });
    act(() => ios.__emit('notification', { getData: () => ({ type: 'read', conversationId: conv }), finish: () => undefined }));
    expect(ios.__removed).toContain('n1');
    expect(ios.__removed).not.toContain('n2');
  });

  it('says no to notifications: no token is sent, and it does not ask again', async () => {
    ios.__allow = false;
    const ali = await user('Ali'), sara = await user('Sara');
    const conv = (await call('/v1/conversations/direct', { userId: sara.id }, ali.tokens.accessToken)).id as string;
    await say(sara, conv, 'Hello');
    launch(ali);
    await screen.findByLabelText(/^Chat with Sara/);
    await waitFor(() => expect(ios.requestPermissions).toHaveBeenCalledTimes(1));
    expect(await AsyncStorage.getItem('yays.push.asked')).toBe('1');
  });
});

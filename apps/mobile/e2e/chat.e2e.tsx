/// <reference types="node" />
import React from 'react';
import * as net from 'net';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import * as Keychain from 'react-native-keychain';
import AsyncStorage from '@react-native-async-storage/async-storage';
import App from '../App';
import { resetApiForTests } from '../src/lib/api';
import { API } from './helpers';
import { call, say, user, uuid, type U } from './people';

const store = (Keychain as unknown as { __store: Map<string, string> }).__store;

/** A TCP relay in front of the API: down() is the phone losing signal. */
class NetSwitch {
  private server: net.Server; private conns = new Set<net.Socket>(); private isUp = true; port = 0;
  constructor(private target: number) {
    this.server = net.createServer((c) => {
      if (!this.isUp) { c.destroy(); return; }
      const u = net.connect(this.target, '127.0.0.1');
      this.conns.add(c); this.conns.add(u);
      const end = () => { c.destroy(); u.destroy(); this.conns.delete(c); this.conns.delete(u); };
      c.on('error', end); u.on('error', end); c.on('close', end); u.on('close', end);
      c.pipe(u); u.pipe(c);
    });
  }
  async listen() { await new Promise<void>((r) => this.server.listen(0, '127.0.0.1', () => r())); this.port = (this.server.address() as net.AddressInfo).port; return this; }
  down() { this.isUp = false; for (const c of this.conns) c.destroy(); this.conns.clear(); }
  up() { this.isUp = true; }
  close() { this.down(); return new Promise((r) => this.server.close(() => r(null))); }
}

let sw: NetSwitch;
/** Opens the app signed in as `u`, talking to the API through the network switch. */
function launchAs(u: U) {
  store.set('yays.tokens', JSON.stringify(u.tokens));
  (globalThis as { YAYS_API_URL?: string }).YAYS_API_URL = `http://127.0.0.1:${sw.port}`;
  resetApiForTests();
  return render(<App />);
}
const mine = () => screen.queryAllByTestId('msg-mine');
const lastMineTick = () => { const m = mine(); const last = m[0]; return last ? ['pending', 'failed', 'sent', 'delivered', 'read'].find((k) => within(last).queryByTestId(`tick-${k}`)) : undefined; };

beforeAll(async () => { sw = await new NetSwitch(Number(new URL(API).port)).listen(); });
afterAll(async () => { await sw.close(); (globalThis as { YAYS_API_URL?: string }).YAYS_API_URL = API; });
beforeEach(async () => { sw.up(); store.clear(); await AsyncStorage.clear(); });

describe('Week 3 · mobile chats against the real API', () => {
  it('starts a chat by username, sends, and shows replies, ticks and typing live', async () => {
    const ali = await user('Ali'), sara = await user('Sara');
    const r = launchAs(ali);
    expect(await screen.findByText('Welcome, Ali')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('New chat'));
    fireEvent.changeText(await screen.findByLabelText('Find someone'), `@${sara.username}`);
    fireEvent.press(screen.getByLabelText('Search'));
    fireEvent.press(await screen.findByLabelText('Message Sara'));
    await screen.findByText('Say hello 👋');

    fireEvent.changeText(screen.getByLabelText('Message'), 'Hello from my phone');
    fireEvent.press(screen.getByLabelText('Send'));
    await screen.findByText('Hello from my phone');
    await waitFor(() => expect(lastMineTick()).toBe('sent'));
    const convId = (await call('/v1/conversations', undefined, sara.tokens.accessToken)).items[0].id;
    const got = await call(`/v1/conversations/${convId}/messages`, undefined, sara.tokens.accessToken);
    expect(got.items.map((m: { text: string }) => m.text)).toEqual(['Hello from my phone']);

    // Sara's device confirms delivery, then reads, then replies; all show up live.
    await call(`/v1/conversations/${convId}/delivered`, { seq: 1 }, sara.tokens.accessToken);
    await waitFor(() => expect(lastMineTick()).toBe('delivered'));
    await call(`/v1/conversations/${convId}/read`, { seq: 1 }, sara.tokens.accessToken);
    await waitFor(() => expect(lastMineTick()).toBe('read'));
    await say(sara, convId, 'Hi Ali!');
    expect(await screen.findByText('Hi Ali!')).toBeTruthy();

    // Back on the list: newest message and no unread (the chat was open).
    fireEvent.press(screen.getByLabelText('Back to chats'));
    const row = await screen.findByLabelText('Chat with Sara');
    expect(within(row).getByText('Hi Ali!')).toBeTruthy();
    await say(sara, convId, 'Are you there?');
    expect(await screen.findByLabelText('Chat with Sara, 1 unread')).toBeTruthy();
    r.unmount();
  });

  it('messages written with no signal wait, survive closing the app, and send once when back online', async () => {
    const ali = await user('Ali'), sara = await user('Sara');
    const c = await call('/v1/conversations/direct', { userId: sara.id }, ali.tokens.accessToken);
    await say(sara, c.id, 'Ping');
    const r = launchAs(ali);
    fireEvent.press(await screen.findByLabelText('Chat with Sara, 1 unread'));
    await screen.findByText('Ping');

    await act(async () => { sw.down(); });
    expect(await screen.findByText(/Waiting for network|Connecting/, {}, { timeout: 30000 })).toBeTruthy();
    for (const text of ['one', 'two']) {
      fireEvent.changeText(screen.getByLabelText('Message'), text);
      fireEvent.press(screen.getByLabelText('Send'));
      await screen.findByText(text);
    }
    await waitFor(() => expect(screen.getAllByTestId('tick-pending')).toHaveLength(2));
    expect(await screen.findByText(/2 messages will send when you're back online/)).toBeTruthy();
    // The phone is switched off and on again while still offline.
    r.unmount();
    const r2 = launchAs(ali);
    fireEvent.press(await screen.findByLabelText(/Chat with Sara/));
    await waitFor(() => expect(screen.getAllByTestId('tick-pending')).toHaveLength(2), { timeout: 15000 });

    expect(screen.getByText('one')).toBeTruthy();
    await act(async () => { sw.up(); });
    await waitFor(() => { expect(screen.queryAllByTestId('tick-pending')).toHaveLength(0); expect(screen.getAllByTestId('msg-mine')).toHaveLength(2); }, { timeout: 20000 });
    await waitFor(() => expect(screen.queryByText(/Waiting for network|Connecting/)).toBeNull());
    const stored = await call(`/v1/conversations/${c.id}/messages`, undefined, sara.tokens.accessToken);
    expect(stored.items.map((m: { text: string }) => m.text)).toEqual(['Ping', 'one', 'two']);
    r2.unmount();
  });

  it('shows typing and online status in the chat header', async () => {
    const ali = await user('Ali'), sara = await user('Sara');
    const c = await call('/v1/conversations/direct', { userId: sara.id }, ali.tokens.accessToken);
    await say(sara, c.id, 'Hey');
    const { io } = require('socket.io-client/dist/socket.io.js') as typeof import('socket.io-client');
    const s = io(API, { path: '/v1/socket', transports: ['websocket'], auth: { token: sara.tokens.accessToken } });
    await new Promise<void>((res) => s.on('connect', () => res()));
    const r = launchAs(ali);
    fireEvent.press(await screen.findByLabelText(/Chat with Sara/));
    await waitFor(() => expect(screen.getByTestId('peer-status').props.children).toBe('online'));
    s.emit('typing', { conversationId: c.id, on: true });
    await waitFor(() => expect(screen.getByTestId('peer-status').props.children).toBe('typing…'));
    s.close();
    await waitFor(() => expect(String(screen.getByTestId('peer-status').props.children)).toMatch(/^last seen today at \d\d:\d\d$/));
    r.unmount();
  });

  it('refuses empty and over-long messages; a message the server refuses shows Not sent and can be deleted', async () => {
    const ali = await user('Ali'), sara = await user('Sara');
    const c = await call('/v1/conversations/direct', { userId: sara.id }, ali.tokens.accessToken);
    await say(sara, c.id, 'Hi');
    // A queued message the server refuses for good (here: longer than allowed, saved by an older app version).
    await AsyncStorage.setItem(`yays.outbox.${ali.id}`, JSON.stringify([{ clientId: uuid(), conversationId: c.id, text: 'y'.repeat(5000), createdAt: new Date().toISOString(), attempts: 0, status: 'pending' }]));
    const r = launchAs(ali);
    fireEvent.press(await screen.findByLabelText(/Chat with Sara/));
    await screen.findByText('Hi');
    // Nothing typed (or only spaces): the button records a voice note instead of sending.
    expect(screen.queryByLabelText('Send')).toBeNull();
    expect(screen.getByLabelText('Voice')).toBeTruthy();
    fireEvent.changeText(screen.getByLabelText('Message'), '    ');
    expect(screen.queryByLabelText('Send')).toBeNull();
    fireEvent.changeText(screen.getByLabelText('Message'), 'x'.repeat(4097));
    expect(await screen.findByText('Messages can be up to 4096 characters (4097 now).')).toBeTruthy();
    expect(screen.getByLabelText('Send').props.accessibilityState.disabled).toBe(true);
    expect(await screen.findByLabelText('Retry sending')).toBeTruthy();
    expect(screen.getByTestId('tick-failed')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Delete unsent message'));
    await waitFor(() => expect(screen.queryByTestId('tick-failed')).toBeNull());
    await waitFor(async () => expect(await AsyncStorage.getItem(`yays.outbox.${ali.id}`)).toBeNull());
    r.unmount();
  });
});

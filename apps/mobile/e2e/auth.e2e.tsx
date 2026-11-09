import React from 'react';
import { Alert } from 'react-native';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as Keychain from 'react-native-keychain';
import App from '../App';
import { resetApiForTests } from '../src/lib/api';
import { API, codeFor, freshEmail, freshPhone, local, seedLegacy } from './helpers';

const store = (Keychain as unknown as { __store: Map<string, string> }).__store;
beforeEach(() => { store.clear(); resetApiForTests(); });

async function startPhone(phone: string) {
  fireEvent.press(await screen.findByLabelText('Get started'));
  fireEvent.changeText(await screen.findByLabelText('Phone number'), local(phone));
  fireEvent.press(screen.getByLabelText('Send code'));
  await screen.findByText('Enter the code');
}
async function phoneSignUp(phone: string, email: string) {
  await startPhone(phone);
  fireEvent.changeText(screen.getByLabelText('6-digit code'), await codeFor(phone));
  await screen.findByText('Add your email');
  fireEvent.changeText(screen.getByLabelText('Email'), email);
  fireEvent.press(screen.getByLabelText('Send code'));
  await screen.findByText('Check your email');
  fireEvent.changeText(screen.getByLabelText('6-digit code'), await codeFor(email));
}

describe('Week 2 · mobile sign-in against the real API', () => {
  it('new person: phone, email, profile, chats; then the session survives an app restart', async () => {
    const phone = freshPhone();
    const r = render(<App />);
    await phoneSignUp(phone, freshEmail('new'));
    await screen.findByText('Set up your profile');
    fireEvent.press(screen.getByLabelText('Continue'));
    expect(await screen.findByText('Your name is needed.')).toBeTruthy();
    fireEvent.changeText(screen.getByLabelText('Your name'), 'Ayesha Noor');
    const u = `ayesha.${Date.now() % 100000}`;
    fireEvent.changeText(screen.getByLabelText('Username (optional)'), u);
    expect(await screen.findByText(`@${u} is available.`)).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Continue'));
    expect(await screen.findByText('Welcome, Ayesha Noor')).toBeTruthy();
    expect(screen.getByText(/Your account is ready/)).toBeTruthy();
    r.unmount();

    // Relaunch: tokens come back from the Keychain and the app opens on Chats.
    resetApiForTests();
    render(<App />);
    expect(await screen.findByText('Welcome, Ayesha Noor')).toBeTruthy();
  });

  it('old account: phone plus its old email connects it, with no profile step', async () => {
    const email = freshEmail('legacy');
    await seedLegacy(email);
    render(<App />);
    await phoneSignUp(freshPhone(), email);
    expect(await screen.findByText('Welcome, Zainab Kazmi')).toBeTruthy();
    expect(screen.getByText(/Your account from the old YaysApp is connected/)).toBeTruthy();
  });

  it('wrong code shows how many tries are left, and Change number goes back', async () => {
    const phone = freshPhone();
    render(<App />);
    await startPhone(phone);
    const code = await codeFor(phone);
    fireEvent.changeText(screen.getByLabelText('6-digit code'), code === '000000' ? '111111' : '000000');
    expect(await screen.findByText("That code isn't right. 4 tries left.")).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Change number'));
    expect(await screen.findByLabelText('Phone number')).toBeTruthy();
  });

  it('linked devices: sees the web session, logs it out, then logs out of the phone', async () => {
    const email = freshEmail('dev');
    // A web session for the same account, signed in through the API.
    await fetch(`${API}/v1/auth/email/start`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email }) });
    const web = await (await fetch(`${API}/v1/auth/email/verify`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, code: await codeFor(email), device: { deviceId: 'web-device-123456', platform: 'web', name: 'Chrome on Mac' } }) })).json();
    await new Promise<void>((r) => setTimeout(() => r(), 5200)); // resend wait for the same email

    render(<App />);
    fireEvent.press(await screen.findByLabelText('Get started'));
    fireEvent.press(await screen.findByRole('tab', { name: 'Email' }));
    fireEvent.changeText(screen.getByLabelText('Email'), email);
    fireEvent.press(screen.getByLabelText('Send code'));
    await screen.findByText('Check your email');
    fireEvent.changeText(screen.getByLabelText('6-digit code'), await codeFor(email));
    await screen.findByText('Set up your profile');
    fireEvent.changeText(screen.getByLabelText('Your name'), 'Omar');
    fireEvent.press(screen.getByLabelText('Continue'));
    await screen.findByText('Welcome, Omar');

    fireEvent.press(screen.getByLabelText('Me'));
    fireEvent.press(await screen.findByLabelText('Linked devices'));
    await waitFor(() => expect(screen.getAllByTestId('device-row')).toHaveLength(2));
    expect(screen.getByText('Chrome on Mac')).toBeTruthy();
    fireEvent.press(screen.getAllByLabelText('Log out')[0]!);
    expect(await screen.findByText('Chrome on Mac was logged out.')).toBeTruthy();
    const after = await fetch(`${API}/v1/me`, { headers: { authorization: `Bearer ${web.tokens.accessToken}` } });
    expect(after.status).toBe(401);
  });

  it('log out from Settings returns to the welcome screen', async () => {
    const spy = jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => { buttons?.find((b) => b.style === 'destructive')?.onPress?.(); });
    render(<App />);
    await phoneSignUp(freshPhone(), freshEmail('out'));
    await screen.findByText('Set up your profile');
    fireEvent.changeText(screen.getByLabelText('Your name'), 'Bye');
    fireEvent.press(screen.getByLabelText('Continue'));
    await screen.findByText('Welcome, Bye');
    fireEvent.press(screen.getByLabelText('Me'));
    fireEvent.press(await screen.findByLabelText('Log out'));
    expect(await screen.findByText('Chat. Earn. Together.')).toBeTruthy();
    expect(store.size).toBe(0);
    spy.mockRestore();
  });

  it('a session revoked elsewhere opens on the welcome screen next launch', async () => {
    store.set('yays.tokens', JSON.stringify({ accessToken: 'x.y.z', refreshToken: 'deadbeefdeadbeefdeadbeefdeadbeef.secret-that-is-gone', accessExpiresAt: '', sessionId: 'deadbeefdeadbeefdeadbeefdeadbeef' }));
    render(<App />);
    expect(await screen.findByText('Chat. Earn. Together.')).toBeTruthy();
  });
});

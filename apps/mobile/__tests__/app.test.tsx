import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react-native';
import App from '../App';

describe('mobile app shell', () => {
  it('shows the welcome screen to a signed-out person, then sign-in', async () => {
    render(<App />);
    expect(await screen.findByText('Chat. Earn. Together.')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Get started'));
    expect(await screen.findByText('Sign in to YaysApp')).toBeTruthy();
  });

  it('checks a phone number before asking the server', async () => {
    render(<App />);
    fireEvent.press(await screen.findByLabelText('Get started'));
    fireEvent.changeText(await screen.findByLabelText('Phone number'), '123');
    fireEvent.press(screen.getByLabelText('Send code'));
    expect(await screen.findByText(/Enter a mobile number/)).toBeTruthy();
  });

  it('switches to email and checks the address', async () => {
    render(<App />);
    fireEvent.press(await screen.findByLabelText('Get started'));
    fireEvent.press(await screen.findByRole('tab', { name: 'Email' }));
    fireEvent.changeText(screen.getByLabelText('Email'), 'not-an-email');
    fireEvent.press(screen.getByLabelText('Send code'));
    expect(await screen.findByText('Enter a valid email address.')).toBeTruthy();
  });
});

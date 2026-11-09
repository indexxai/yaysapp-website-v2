import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Text, fontStyle } from '../src/ui/Text';
import { TabBar } from '../src/ui/TabBar';

describe('fonts', () => {
  it('turns family and weight into the exact font file', () => {
    expect(fontStyle({ fontFamily: 'Outfit', fontWeight: '800' })).toEqual({ fontFamily: 'Outfit-ExtraBold', fontWeight: 'normal' });
    expect(fontStyle({ fontWeight: '700' })).toEqual({ fontFamily: 'NunitoSans-Bold', fontWeight: 'normal' });
    expect(fontStyle(undefined)).toEqual({ fontFamily: 'NunitoSans-Regular', fontWeight: 'normal' });
    expect(fontStyle({ fontFamily: 'monospace' })).toEqual({});
  });
  it('Text uses them', () => {
    render(<Text style={[{ fontFamily: 'Outfit' }, { fontWeight: '600' }]}>Hi</Text>);
    expect(screen.getByText('Hi')).toHaveStyle({ fontFamily: 'Outfit-SemiBold' });
  });
});

describe('tab bar', () => {
  const routes = ['Chats', 'Calls', 'Circles', 'Explore', 'Me'].map((name) => ({ key: name, name }));
  const nav = { emit: jest.fn(() => ({ defaultPrevented: false })), navigate: jest.fn() };
  const bar = (index: number) => render(
    <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } }}>
      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
      <TabBar {...({ state: { index, routes }, navigation: nav, descriptors: {}, insets: {} } as any)} badges={{ Chats: { n: 4, label: '4 unread chats' } }} />
    </SafeAreaProvider>,
  );
  it('shows five tabs, the unread count on Chats, and opens a tab', () => {
    bar(3);
    expect(screen.getAllByRole('tab')).toHaveLength(5);
    expect(screen.getByLabelText('Chats, 4 unread chats')).toBeTruthy();
    expect(screen.getByText('4')).toBeTruthy();
    expect(screen.getByRole('tab', { selected: true })).toHaveProp('accessibilityLabel', 'Explore');
    fireEvent.press(screen.getByLabelText('Me'));
    expect(nav.navigate).toHaveBeenCalledWith('Me');
  });
  it('hides the count on the tab that is open', () => {
    bar(0);
    expect(screen.queryByText('4')).toBeNull();
  });
});

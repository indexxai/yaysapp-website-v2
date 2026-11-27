import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { Markdown } from '../src/explore/Markdown';

describe('Jack’s AI answers: numbered lists', () => {
  it('spaced-out numbered points stay one list, numbered 1, 2, 3 (not 1, 1, 1)', () => {
    render(<Markdown md={'Here are three ideas:\n\n1. **Weekly check-in**: share a win.\n\n2. **Discussion**: ask a question.\n\n3. **Challenge**: post a photo.\n\nEnjoy!'} />);
    expect(screen.getByText('1.')).toBeTruthy();
    expect(screen.getByText('2.')).toBeTruthy();
    expect(screen.getByText('3.')).toBeTruthy();
  });
  it('bullets after a numbered list start their own list', () => {
    render(<Markdown md={'1. one\n2. two\n\n- apple\n- pear'} />);
    expect(screen.getAllByText('•')).toHaveLength(2);
    expect(screen.getByText('2.')).toBeTruthy();
  });
});

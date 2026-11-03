/**
 * Scenario: a button too narrow for its longest word is drawn 'Revi' over 'ew'.
 *
 * Expected behaviour: the detector names the cut word from the lines `onTextLayout` reports,
 * stays silent for breaks at spaces, and `Button` reports a cut label once in the log the
 * device jobs collect.
 */

import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

import { Button } from '@/shared/ui/Button';
import { midWordBreak } from '@/shared/ui/midWordBreak';

jest.mock('@/shared/ui/haptics', () => ({
  selection: jest.fn(),
  light: jest.fn(),
  medium: jest.fn(),
  success: jest.fn(),
}));
jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));
jest.mock('@/shared/ui/buttonShapes', () => ({ useButtonShapes: () => false }));

describe('midWordBreak', () => {
  it('names a word cut in two', () => {
    expect(midWordBreak('Review now', ['Revi', 'ew now'])).toBe('Review');
  });

  it('names a later word cut in two', () => {
    expect(midWordBreak('Keep Forum', ['Keep ', 'For', 'um'])).toBe('Forum');
  });

  it('accepts breaks at spaces, with or without the trailing space on the line', () => {
    expect(midWordBreak('Review your data', ['Review ', 'your ', 'data'])).toBeNull();
    expect(midWordBreak('Review your data', ['Review', 'your', 'data'])).toBeNull();
  });

  it('accepts a single line and no lines', () => {
    expect(midWordBreak('Review', ['Review'])).toBeNull();
    expect(midWordBreak('Review', [])).toBeNull();
  });

  it('gives up on lines it cannot find in the label', () => {
    expect(midWordBreak('Review', ['zzz', 'yyy'])).toBeNull();
  });
});

describe('Button label layout report', () => {
  const layoutEvent = (...lines: string[]) => ({
    nativeEvent: { lines: lines.map((text) => ({ text })) },
  });
  let error: jest.SpyInstance;
  beforeEach(() => {
    error = jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => error.mockRestore());

  it('logs a label broken mid-word once, naming the word', () => {
    const { getByTestId } = render(<Button label="Review now" onPress={() => {}} testID="b" />);
    fireEvent(getByTestId('b-label'), 'textLayout', layoutEvent('Revi', 'ew now'));
    fireEvent(getByTestId('b-label'), 'textLayout', layoutEvent('Revi', 'ew now'));
    expect(error).toHaveBeenCalledTimes(1);
    expect(error.mock.calls[0]![0]).toContain('[MidWordBreak]');
    expect(error.mock.calls[0]![0]).toContain('Review');
  });

  it('stays silent when the label wraps at a space', () => {
    const { getByTestId } = render(<Button label="Review now" onPress={() => {}} testID="b" />);
    fireEvent(getByTestId('b-label'), 'textLayout', layoutEvent('Review ', 'now'));
    expect(error).not.toHaveBeenCalled();
  });
});

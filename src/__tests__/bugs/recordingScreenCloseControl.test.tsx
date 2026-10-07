/**
 * Scenario: on iOS the recording screen has no header and no edge swipe, so an
 * athlete who cancels the armed start, waits on the permission check or meets
 * the scope gate has no way off the screen.
 *
 * Expected behaviour: a close control shows while nothing is recording (idle,
 * checking, gated), is absent once a session has started, and leaves the screen.
 */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { RecordingCloseButton } from '@/features/recording/components/RecordingCloseButton';
import { TimerHeader } from '@/features/recording/components/TimerHeader';

const mockBack = jest.fn();
const mockReplace = jest.fn();
let mockCanGoBack = true;

jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  router: {
    back: () => mockBack(),
    replace: (...a: unknown[]) => mockReplace(...a),
    canGoBack: () => mockCanGoBack,
  },
}));
jest.mock('@/shared/app', () => ({
  useTheme: () => ({ isDark: false }),
}));

const headerProps = {
  currentActivityType: 'Ride' as const,
  statusPulse: { interpolate: jest.fn() } as never,
  mode: 'gps' as const,
  accuracy: null,
  autoPaused: false,
  isLocked: false,
  textPrimary: '#000',
  textSecondary: '#000',
  border: '#000',
  onOpenTypePicker: jest.fn(),
  onLock: jest.fn(),
};

beforeEach(() => {
  jest.clearAllMocks();
  mockCanGoBack = true;
});

describe('recording close control', () => {
  it('goes back when there is a screen to go back to', () => {
    render(<RecordingCloseButton />);
    fireEvent.press(screen.getByTestId('recording-close'));
    expect(mockBack).toHaveBeenCalledTimes(1);
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('falls back to the feed when nothing is behind it', () => {
    mockCanGoBack = false;
    render(<RecordingCloseButton />);
    fireEvent.press(screen.getByTestId('recording-close'));
    expect(mockBack).not.toHaveBeenCalled();
    expect(mockReplace).toHaveBeenCalledWith('/');
  });

  it('is shown in the header at idle', () => {
    render(<TimerHeader {...headerProps} status="idle" />);
    expect(screen.getByTestId('recording-close')).toBeTruthy();
  });

  it.each(['recording', 'paused'] as const)('is absent in the header while %s', (status) => {
    render(<TimerHeader {...headerProps} status={status} />);
    expect(screen.queryByTestId('recording-close')).toBeNull();
  });
});

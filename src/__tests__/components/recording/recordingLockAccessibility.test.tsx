/**
 * Scenario: the recording screen opens locked, and the slide track is the only
 * way to reach Lap, Pause and Stop. A screen reader, a switch or a keyboard
 * produces no drag.
 *
 * Expected behaviour: the track is one accessible button whose activate action
 * unlocks, a touch that does not travel still does not, and the padlock in the
 * header is named for locking, which is what pressing it does.
 */

import React from 'react';
import { Animated, StyleSheet } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { initialiseI18n } from '@/i18n';
import { UnlockTrack } from '@/features/recording/components/UnlockTrack';
import { TimerHeader } from '@/features/recording/components/TimerHeader';
import { DENSE_TEXT_SCALE } from '@/shared/ui/DenseText';

jest.mock('@/shared/app', () => ({
  useTheme: () => ({ isDark: false }),
}));
jest.mock('@/features/recording/components/GpsSignalIndicator', () => ({
  GpsSignalIndicator: () => null,
}));

const touchHistory = {
  touchBank: [],
  numberActiveTouches: 0,
  indexOfSingleActiveTouch: -1,
  mostRecentTimeStamp: 0,
};

async function activate(testID: string, actionName = 'activate') {
  await fireEvent(screen.getByTestId(testID), 'accessibilityAction', {
    nativeEvent: { actionName },
  });
}

beforeAll(async () => {
  await initialiseI18n('en-GB');
});

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('the unlock track', () => {
  it('is one focusable button named for unlocking, with the slide as its hint', async () => {
    await render(<UnlockTrack onUnlock={jest.fn()} />);
    const track = screen.getByTestId('unlock-track');

    expect(track.props.accessible).toBe(true);
    expect(track.props.focusable).toBe(true);
    expect(track.props.accessibilityRole).toBe('button');
    expect(track.props.accessibilityLabel).toBe('Unlock controls');
    expect(track.props.accessibilityHint).toBe('Slide to unlock');
    expect(track.props.accessibilityActions).toEqual([{ name: 'activate' }]);
  });

  it('unlocks once when a screen reader activates it', async () => {
    const onUnlock = jest.fn();
    await render(<UnlockTrack onUnlock={onUnlock} />);

    await activate('unlock-track');

    expect(onUnlock).toHaveBeenCalledTimes(1);
  });

  it('takes a repeated activation inside the reset window as the same unlock', async () => {
    const onUnlock = jest.fn();
    await render(<UnlockTrack onUnlock={onUnlock} />);

    await activate('unlock-track');
    await activate('unlock-track');
    expect(onUnlock).toHaveBeenCalledTimes(1);

    await act(() => {
      jest.advanceTimersByTime(300);
    });
    await activate('unlock-track');
    expect(onUnlock).toHaveBeenCalledTimes(2);
  });

  it('ignores an accessibility action that is not activate', async () => {
    const onUnlock = jest.fn();
    await render(<UnlockTrack onUnlock={onUnlock} />);

    await activate('unlock-track', 'magicTap');

    expect(onUnlock).not.toHaveBeenCalled();
  });

  it('does not unlock on a touch that does not travel', async () => {
    const onUnlock = jest.fn();
    await render(<UnlockTrack onUnlock={onUnlock} />);
    await fireEvent(screen.getByTestId('unlock-track'), 'layout', {
      nativeEvent: { layout: { x: 0, y: 0, width: 320, height: 56 } },
    });
    const handle = screen.getByTestId('unlock-track-handle');

    await fireEvent(handle, 'responderGrant', { touchHistory, nativeEvent: {} });
    await fireEvent(handle, 'responderRelease', { touchHistory, nativeEvent: {} });

    expect(onUnlock).not.toHaveBeenCalled();
  });

  it('still unlocks on a slide past the threshold', async () => {
    const onUnlock = jest.fn();
    await render(<UnlockTrack onUnlock={onUnlock} />);
    await fireEvent(screen.getByTestId('unlock-track'), 'layout', {
      nativeEvent: { layout: { x: 0, y: 0, width: 320, height: 56 } },
    });
    const handle = screen.getByTestId('unlock-track-handle');
    const touchAt = (pageX: number, timeStamp: number) => ({
      touchActive: true,
      startPageX: 0,
      startPageY: 0,
      startTimeStamp: 0,
      currentPageX: pageX,
      currentPageY: 0,
      currentTimeStamp: timeStamp,
      previousPageX: 0,
      previousPageY: 0,
      previousTimeStamp: 0,
    });
    const historyAt = (pageX: number, timeStamp: number) => ({
      touchBank: [touchAt(pageX, timeStamp)],
      numberActiveTouches: 1,
      indexOfSingleActiveTouch: 0,
      mostRecentTimeStamp: timeStamp,
    });

    await fireEvent(handle, 'responderGrant', { touchHistory: historyAt(0, 1), nativeEvent: {} });
    await fireEvent(handle, 'responderMove', { touchHistory: historyAt(300, 2), nativeEvent: {} });
    await fireEvent(handle, 'responderRelease', {
      touchHistory: historyAt(300, 3),
      nativeEvent: {},
    });

    expect(onUnlock).toHaveBeenCalledTimes(1);
  });
});

describe('the padlock in the recording header', () => {
  const props = {
    currentActivityType: 'Ride' as const,
    status: 'recording' as const,
    statusPulse: new Animated.Value(1),
    mode: 'gps' as const,
    accuracy: null,
    autoPaused: false,
    textPrimary: '#000',
    textSecondary: '#000',
    border: '#000',
    onOpenTypePicker: jest.fn(),
    onLock: jest.fn(),
  };

  it('is named for locking the controls, not for the slide', async () => {
    await render(<TimerHeader {...props} isLocked={false} />);
    const toggle = screen.getByTestId('recording-lock-toggle');

    expect(toggle.props.accessibilityLabel).toBe('Lock controls');
    expect(screen.queryByLabelText('Slide to unlock')).toBeNull();
  });

  it('announces itself disabled while the controls are already locked', async () => {
    await render(<TimerHeader {...props} isLocked />);
    const toggle = screen.getByTestId('recording-lock-toggle');

    expect(toggle.props.accessibilityLabel).toBe('Lock controls');
    expect(toggle.props.accessibilityState).toEqual(expect.objectContaining({ disabled: true }));
  });
});

describe('the unlock track label at a large text size', () => {
  it('is capped at the dense text scale', async () => {
    await render(<UnlockTrack onUnlock={jest.fn()} />);

    expect(screen.getByTestId('unlock-track-label').props.maxFontSizeMultiplier).toBe(
      DENSE_TEXT_SCALE
    );
  });

  it('starts past the handle rather than spanning the track under it', async () => {
    await render(<UnlockTrack onUnlock={jest.fn()} />);
    const label = StyleSheet.flatten(screen.getByTestId('unlock-track-label').props.style);
    const handle = StyleSheet.flatten(screen.getByTestId('unlock-track-handle').props.style);

    expect(label.width).toBeUndefined();
    expect(label.left).toBeGreaterThanOrEqual(handle.width);
  });
});

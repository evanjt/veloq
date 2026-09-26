/**
 * Scenario: a one-tap entry arms a three-second countdown, and cancelling it
 * replaced the screen with the home tab. The athlete who cancelled on purpose,
 * to wake a strap or correct the sport, had to find the widget again.
 *
 * Expected behaviour, Evan's decision of 2026-09-14: the window is an abort
 * and a pause. A cancel keeps the sport and the screen, the bar offers
 * Start, and nothing on the screen reads as a recording in progress.
 */

import React from 'react';
import { Animated } from 'react-native';
import { act, fireEvent, render, renderHook } from '@testing-library/react-native';

import { ControlBar } from '@/features/recording/components/ControlBar';
import { TimerHeader } from '@/features/recording/components/TimerHeader';
import { useInitRecordingEffect } from '@/features/recording/hooks/useInitRecordingEffect';
import { useRecordingStore } from '@/features/recording/stores/RecordingStore';

jest.mock('@/features/recording/components/GpsSignalIndicator', () => ({
  GpsSignalIndicator: () => null,
}));

const started = () => useRecordingStore.getState().startRecording as jest.Mock;

const headerProps = {
  formattedElapsed: '00:00:00',
  currentActivityType: 'Ride' as never,
  statusPulse: new Animated.Value(1),
  mode: 'gps' as never,
  accuracy: 4,
  autoPaused: false,
  isLocked: false,
  textPrimary: '#000',
  textSecondary: '#666',
  border: '#ccc',
  onOpenTypePicker: jest.fn(),
  onLock: jest.fn(),
};

const barProps = {
  mode: 'gps' as never,
  onLap: jest.fn(),
  onPause: jest.fn(),
  onResume: jest.fn(),
  onStop: jest.fn(),
};

describe('the bar a cancelled arm leaves behind', () => {
  it('offers Start while nothing is recording', () => {
    const onStart = jest.fn();
    const { getByTestId, queryByTestId } = render(
      <ControlBar {...barProps} status="idle" onStart={onStart} />
    );

    fireEvent.press(getByTestId('control-start'));

    expect(onStart).toHaveBeenCalledTimes(1);
    expect(queryByTestId('control-pause')).toBeNull();
    expect(queryByTestId('control-resume')).toBeNull();
  });

  it('keeps the recording bar for a ride that is under way', () => {
    const { getByTestId, queryByTestId } = render(
      <ControlBar {...barProps} status="recording" onStart={jest.fn()} />
    );

    expect(getByTestId('control-pause')).toBeTruthy();
    expect(queryByTestId('control-start')).toBeNull();
  });
});

describe('the header of a screen that is not recording', () => {
  it('shows no REC or PAUSED badge while idle', () => {
    const { queryByTestId } = render(<TimerHeader {...headerProps} status={'idle' as never} />);

    expect(queryByTestId('recording-status')).toBeNull();
  });

  it('still badges a paused ride', () => {
    const { getByTestId } = render(<TimerHeader {...headerProps} status={'paused' as never} />);

    expect(getByTestId('recording-status')).toBeTruthy();
  });
});

describe('starting after a cancel', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    useRecordingStore.getState().reset();
    jest.spyOn(useRecordingStore.getState(), 'startRecording').mockImplementation(jest.fn());
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  const armed = () =>
    renderHook(() => useInitRecordingEffect('idle', 'Ride', 'gps', undefined, true, 'quickstart'));

  it('records the sport chosen after the cancel, not the one tapped', () => {
    const { result } = armed();
    act(() => {
      result.current.cancelCountdown();
      useRecordingStore.getState().changeActivityType('Run');
    });

    act(() => result.current.startNow());

    expect(started()).toHaveBeenCalledWith('Run', 'gps', undefined);
  });

  it('starts nothing on its own after a cancel', () => {
    const { result } = armed();
    act(() => {
      result.current.cancelCountdown();
      jest.advanceTimersByTime(10_000);
    });

    expect(started()).not.toHaveBeenCalled();
  });

  it('starts once when Start is pressed twice', () => {
    const { result } = armed();
    act(() => result.current.cancelCountdown());

    act(() => result.current.startNow());
    act(() => result.current.startNow());

    expect(started()).toHaveBeenCalledTimes(1);
  });
});

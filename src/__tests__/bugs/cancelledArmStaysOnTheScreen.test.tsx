/**
 * Scenario: a one-tap system entry lands on the recording screen idle, so the
 * athlete can wake a strap or correct the sport before beginning.
 *
 * Expected behaviour: the bar offers Start, nothing on the screen reads as a
 * recording in progress, and the sport held when Start is pressed is the one
 * recorded.
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
  onReview: jest.fn(),
};

describe('the bar of an idle recording screen', () => {
  it('offers Start while nothing is recording', async () => {
    const onStart = jest.fn();
    const { getByTestId, queryByTestId } = await render(
      <ControlBar {...barProps} status="idle" onStart={onStart} />
    );

    await fireEvent.press(getByTestId('control-start'));

    expect(onStart).toHaveBeenCalledTimes(1);
    expect(queryByTestId('control-pause')).toBeNull();
    expect(queryByTestId('control-resume')).toBeNull();
  });

  it('keeps the recording bar for a ride that is under way', async () => {
    const { getByTestId, queryByTestId } = await render(
      <ControlBar {...barProps} status="recording" onStart={jest.fn()} />
    );

    expect(getByTestId('control-pause')).toBeTruthy();
    expect(queryByTestId('control-start')).toBeNull();
  });
});

describe('the header of a screen that is not recording', () => {
  it('shows no REC or PAUSED badge while idle', async () => {
    const { queryByTestId } = await render(
      <TimerHeader {...headerProps} status={'idle' as never} />
    );

    expect(queryByTestId('recording-status')).toBeNull();
  });

  it('still badges a paused ride', async () => {
    const { getByTestId } = await render(
      <TimerHeader {...headerProps} status={'paused' as never} />
    );

    expect(getByTestId('recording-status')).toBeTruthy();
  });
});

describe('starting from an idle screen', () => {
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

  const idle = () =>
    renderHook(() => useInitRecordingEffect('idle', 'Ride', undefined, true, 'quickstart'));

  it('records the sport chosen on the screen, not the one tapped', async () => {
    const { result } = await idle();
    await act(() => useRecordingStore.getState().changeActivityType('Run'));

    await act(() => result.current.startNow());

    expect(started()).toHaveBeenCalledWith('Run', 'gps', undefined);
  });

  it('starts nothing on its own', async () => {
    const { result } = await idle();
    await act(() => {
      jest.advanceTimersByTime(10_000);
    });
    expect(result.current).toBeDefined();

    expect(started()).not.toHaveBeenCalled();
  });

  it('starts once when Start is pressed twice', async () => {
    const { result } = await idle();

    await act(() => result.current.startNow());
    await act(() => result.current.startNow());

    expect(started()).toHaveBeenCalledTimes(1);
  });
});

/**
 * Scenario: an athlete stops a ride, lands on review, and wants to carry on.
 * Stop is a plain press once the screen is unlocked, so a stop taken in error is
 * undone from review rather than guarded by a hold.
 *
 * Expected behaviour: Stop fires on one press, and reopening a stopped ride
 * returns it to a paused recording with its streams and laps intact and the
 * time spent on review counted as paused, not ridden.
 */

import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

import { ControlBar } from '@/features/recording/components/ControlBar';
import { useRecordingStore, movingMsAt } from '@/features/recording/stores/RecordingStore';

const barProps = {
  mode: 'gps' as never,
  onLap: jest.fn(),
  onPause: jest.fn(),
  onResume: jest.fn(),
  onStart: jest.fn(),
  onReview: jest.fn(),
};

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-01-01T10:00:00Z'));
  useRecordingStore.getState().reset();
});

afterEach(() => jest.useRealTimers());

describe('Stop on a paused ride', () => {
  it('fires on a single press, with no hold', () => {
    const onStop = jest.fn();
    const { getByTestId } = render(<ControlBar {...barProps} status="paused" onStop={onStop} />);

    fireEvent.press(getByTestId('control-stop'));

    expect(onStop).toHaveBeenCalledTimes(1);
  });
});

describe('reopenStoppedRecording', () => {
  function stoppedRide() {
    const s = useRecordingStore.getState();
    s.startRecording('Ride', 'gps');
    jest.advanceTimersByTime(60_000);
    s.addLap();
    useRecordingStore.getState().stopRecording();
  }

  it('returns a stopped ride to paused with its laps and clock intact', () => {
    stoppedRide();
    const before = useRecordingStore.getState();
    const movingAtStop = movingMsAt(before, Date.now());
    const startTime = before.startTime;

    jest.advanceTimersByTime(30_000);
    useRecordingStore.getState().reopenStoppedRecording();

    const after = useRecordingStore.getState();
    expect(after.status).toBe('paused');
    expect(after.stopTime).toBeNull();
    expect(after.startTime).toBe(startTime);
    expect(after.laps).toHaveLength(before.laps.length);
    expect(movingMsAt(after, Date.now())).toBe(movingAtStop);

    jest.advanceTimersByTime(10_000);
    useRecordingStore.getState().resumeRecording();
    const resumed = useRecordingStore.getState();
    expect(resumed.status).toBe('recording');
    expect(movingMsAt(resumed, Date.now())).toBe(movingAtStop);
    expect(resumed.pauseIntervals.slice(-2)).toEqual([
      { start: 60, end: 90 },
      { start: 90, end: 100 },
    ]);
  });

  it('does nothing to a ride that is not stopped', () => {
    useRecordingStore.getState().startRecording('Ride', 'gps');
    useRecordingStore.getState().reopenStoppedRecording();
    expect(useRecordingStore.getState().status).toBe('recording');
  });

  it('does nothing to a stopped ride the library already holds', () => {
    stoppedRide();
    const { startTime } = useRecordingStore.getState();
    useRecordingStore.setState({ athleteId: 'i1' });
    useRecordingStore.getState().markSavedToLibrary('i1', startTime as number);
    useRecordingStore.getState().reopenStoppedRecording();
    expect(useRecordingStore.getState().status).toBe('stopped');
  });
});

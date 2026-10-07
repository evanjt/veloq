/**
 * Scenario: an athlete stops a ride, lands on review, and taps back to look at
 * the map again. The live screen underneath showed Lap, Pause and Stop, none of
 * which does anything to a stopped ride, and leaving it showed no pill and no
 * way back, so the unsaved ride was reachable only after a process death.
 *
 * Expected behaviour: a stopped ride is a session to return to, and every way
 * back leads to review.
 */

import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';

import { ControlBar } from '@/features/recording/components/ControlBar';
import { RecordingReturnPill } from '@/features/recording/components/RecordingReturnPill';
import { sessionReturnRoute } from '@/features/recording/lib/sessionReturnRoute';
import { useRecordingStore } from '@/features/recording/stores/RecordingStore';
import { navigateTo } from '@/shared/app/navigation';
import { useAuthStore } from '@/shared/app/AuthStore';

jest.mock('@/shared/app/navigation', () => ({ navigateTo: jest.fn() }));

const barProps = {
  mode: 'gps' as never,
  onLap: jest.fn(),
  onPause: jest.fn(),
  onResume: jest.fn(),
  onStart: jest.fn(),
  onStop: jest.fn(),
};

beforeEach(() => {
  jest.clearAllMocks();
  useRecordingStore.getState().reset();
  useAuthStore.setState({ athleteId: 'i1', isAuthenticated: true });
});

describe('the live screen under a stopped ride', () => {
  it('offers review rather than the recording controls', () => {
    const onReview = jest.fn();
    const { getByTestId, queryByTestId } = render(
      <ControlBar {...barProps} status="stopped" onReview={onReview} />
    );

    fireEvent.press(getByTestId('control-review'));

    expect(onReview).toHaveBeenCalledTimes(1);
    expect(queryByTestId('control-pause')).toBeNull();
    expect(queryByTestId('control-lap')).toBeNull();
    expect(queryByTestId('control-start')).toBeNull();
  });
});

describe('the way back to a session', () => {
  it('sends a stopped ride to review', () => {
    expect(sessionReturnRoute({ status: 'stopped', activityType: 'Ride' })).toBe(
      '/recording/review'
    );
  });

  it('sends a live ride to its recording screen', () => {
    expect(sessionReturnRoute({ status: 'recording', activityType: 'Ride' })).toBe(
      '/recording/Ride'
    );
    expect(sessionReturnRoute({ status: 'paused', activityType: 'Run' })).toBe('/recording/Run');
  });

  it('has nowhere to send an idle store', () => {
    expect(sessionReturnRoute({ status: 'idle', activityType: null })).toBeNull();
    expect(sessionReturnRoute({ status: 'idle', activityType: 'Ride' })).toBeNull();
  });

  it('has nowhere to send a stopped ride the library already holds', () => {
    expect(
      sessionReturnRoute({ status: 'stopped', activityType: 'Ride', savedToLibrary: true })
    ).toBeNull();
  });

  it('hides the pill for a stopped ride the library already holds', () => {
    useRecordingStore.getState().startRecording('Ride', 'gps');
    useRecordingStore.getState().stopRecording();
    useRecordingStore.setState({ savedToLibrary: true });
    const view = render(<RecordingReturnPill />);
    expect(view.queryByTestId('recording-return-pill')).toBeNull();
  });

  it('shows the pill for a stopped ride and opens review from it', () => {
    useRecordingStore.getState().startRecording('Ride', 'gps');
    useRecordingStore.getState().stopRecording();

    const { getByTestId } = render(<RecordingReturnPill />);
    fireEvent.press(getByTestId('recording-return-pill'));

    expect(navigateTo).toHaveBeenCalledWith('/recording/review');
  });

  it('hides the pill after sign-out', () => {
    useRecordingStore.getState().startRecording('Ride', 'gps');
    useRecordingStore.getState().stopRecording();
    const view = render(<RecordingReturnPill />);
    expect(view.queryByTestId('recording-return-pill')).not.toBeNull();
    act(() => useAuthStore.setState({ isAuthenticated: false }));
    expect(view.queryByTestId('recording-return-pill')).toBeNull();
  });

  it("hides one athlete's stopped ride from another who signs in", () => {
    useRecordingStore.getState().startRecording('Ride', 'gps');
    useRecordingStore.getState().stopRecording();
    const view = render(<RecordingReturnPill />);
    expect(view.queryByTestId('recording-return-pill')).not.toBeNull();
    act(() => useAuthStore.setState({ athleteId: 'i2', isAuthenticated: true }));
    expect(view.queryByTestId('recording-return-pill')).toBeNull();
  });

  it('hides a stopped ride that has no athlete', () => {
    useRecordingStore.getState().startRecording('Ride', 'gps');
    useRecordingStore.getState().stopRecording();
    useRecordingStore.setState({ athleteId: null });
    const view = render(<RecordingReturnPill />);
    expect(view.queryByTestId('recording-return-pill')).toBeNull();
  });

  it('does not present a manual review draft as a live ride', () => {
    useRecordingStore.getState().startRecording('Yoga', 'manual');
    const view = render(<RecordingReturnPill />);
    expect(view.queryByTestId('recording-return-pill')).toBeNull();
  });
});

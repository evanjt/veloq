/**
 * Scenario: a recording screen mounts on a ride already under way (the return
 * pill, a relaunch, a notification tap), the review is pushed over it, and
 * discard or save resets the store to idle.
 *
 * Expected behaviour: the screen decided its ride at mount, so the idle that
 * follows starts nothing.
 */

import { renderHook } from '@testing-library/react-native';

import { useInitRecordingEffect } from '@/features/recording/hooks/useInitRecordingEffect';
import { useRecordingStore } from '@/features/recording/stores/RecordingStore';
import type { RecordingStatus } from '@/features/recording/types';

const started = () => useRecordingStore.getState().startRecording as jest.Mock;

describe('a recording screen that mounted on a ride under way', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useRecordingStore.getState().reset();
    jest.spyOn(useRecordingStore.getState(), 'startRecording').mockImplementation(jest.fn());
  });

  afterEach(() => jest.restoreAllMocks());

  const mount = (initial: RecordingStatus) =>
    renderHook(
      ({ status }: { status: RecordingStatus }) => useInitRecordingEffect(status, 'Ride'),
      { initialProps: { status: initial } }
    );

  it.each<RecordingStatus>(['recording', 'paused', 'stopped'])(
    'starts no ride when the store goes idle after mounting %s',
    (initial) => {
      const { rerender } = mount(initial);

      rerender({ status: 'idle' });

      expect(started()).not.toHaveBeenCalled();
    }
  );

  it('still starts a ride on a screen that mounts idle', () => {
    mount('idle');

    expect(started()).toHaveBeenCalledTimes(1);
  });

  it('does not start a second ride when the screen it started goes idle again', () => {
    const { rerender } = mount('idle');
    rerender({ status: 'recording' });
    rerender({ status: 'idle' });

    expect(started()).toHaveBeenCalledTimes(1);
  });
});

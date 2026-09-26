/**
 * Scenario: the sport can be changed at any time, before, during or after the
 * recording, so a wrong pick never costs the ride. Before was the one moment
 * that did not work: `changeActivityType` returned early while the status was
 * `idle`, and an armed one-tap entry is idle on the recording screen.
 *
 * Expected behaviour: a tap on the Ride widget that the athlete meant as Run
 * can be corrected before the countdown fires, and the ride that then starts
 * is a Run.
 */

import { act, renderHook } from '@testing-library/react-native';

import { useInitRecordingEffect } from '@/features/recording/hooks/useInitRecordingEffect';
import { useRecordingStore } from '@/features/recording/stores/RecordingStore';
import { ARM_COUNTDOWN_SECONDS } from '@/features/recording/lib/armCountdown';

const started = () => useRecordingStore.getState().startRecording as jest.Mock;

beforeEach(() => {
  jest.useFakeTimers();
  useRecordingStore.getState().reset();
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('the sport before the ride starts', () => {
  it('changes while the store is idle, which is every moment before a start', () => {
    useRecordingStore.getState().changeActivityType('Run');
    expect(useRecordingStore.getState().activityType).toBe('Run');
  });

  it('still changes on a stopped recording, which the review screen re-picks from', () => {
    useRecordingStore.getState().startRecording('Ride', 'gps');
    useRecordingStore.getState().stopRecording();
    useRecordingStore.getState().changeActivityType('Run');
    expect(useRecordingStore.getState().activityType).toBe('Run');
  });

  describe('with a one-tap entry armed', () => {
    const armed = () =>
      renderHook(() =>
        useInitRecordingEffect('idle', 'Ride', 'gps', undefined, true, 'quickstart')
      );

    it('starts the sport chosen inside the window, not the one tapped', () => {
      jest.spyOn(useRecordingStore.getState(), 'startRecording').mockImplementation(jest.fn());
      armed();
      act(() => {
        useRecordingStore.getState().changeActivityType('Run');
        jest.advanceTimersByTime(ARM_COUNTDOWN_SECONDS * 1000);
      });
      expect(started()).toHaveBeenCalledWith('Run', 'gps', undefined);
    });

    it('starts the sport tapped when nothing was chosen', () => {
      jest.spyOn(useRecordingStore.getState(), 'startRecording').mockImplementation(jest.fn());
      armed();
      act(() => {
        jest.advanceTimersByTime(ARM_COUNTDOWN_SECONDS * 1000);
      });
      expect(started()).toHaveBeenCalledWith('Ride', 'gps', undefined);
    });

    it('records the sport actually started as the recent one', () => {
      jest.spyOn(useRecordingStore.getState(), 'startRecording').mockImplementation(jest.fn());
      const {
        useRecordingPreferences,
      } = require('@/features/recording/stores/RecordingPreferencesStore');
      const addRecent = jest
        .spyOn(useRecordingPreferences.getState(), 'addRecentType')
        .mockImplementation(jest.fn());
      armed();
      act(() => {
        useRecordingStore.getState().changeActivityType('Run');
        jest.advanceTimersByTime(ARM_COUNTDOWN_SECONDS * 1000);
      });
      expect(addRecent).toHaveBeenCalledWith('Run');
    });
  });
});

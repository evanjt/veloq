/**
 * Scenario: a pocket tap on a home-screen widget, an iOS Control or a launcher
 * shortcut deep-links to the recording screen, which started the ride on
 * mount. The athlete was left a recorded ride and a written FIT backup to stop
 * and discard.
 *
 * Expected behaviour, Evan's decision of 2026-09-11: a one-tap entry arms a
 * three-second countdown and starts when it runs out, and cancelling inside
 * the window records nothing at all. The picker path is unchanged, because
 * arriving there is already the athlete's second tap.
 */

import { act, renderHook } from '@testing-library/react-native';

import { useInitRecordingEffect } from '@/features/recording/hooks/useInitRecordingEffect';
import { useRecordingStore } from '@/features/recording/stores/RecordingStore';
import { ARM_COUNTDOWN_SECONDS } from '@/features/recording/lib/armCountdown';

const started = () => useRecordingStore.getState().startRecording as jest.Mock;

beforeEach(() => {
  jest.useFakeTimers();
  jest.spyOn(useRecordingStore.getState(), 'startRecording').mockImplementation(jest.fn());
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('a one-tap entry arms rather than starting', () => {
  const armed = () =>
    renderHook(() => useInitRecordingEffect('idle', 'Ride', 'gps', undefined, true, 'quickstart'));

  it('records nothing on mount', () => {
    const { result } = armed();
    expect(started()).not.toHaveBeenCalled();
    expect(result.current.countdown).toBe(ARM_COUNTDOWN_SECONDS);
  });

  it('counts down a second at a time', () => {
    const { result } = armed();
    act(() => {
      jest.advanceTimersByTime(1000);
    });
    expect(result.current.countdown).toBe(2);
    expect(started()).not.toHaveBeenCalled();
  });

  it('starts when the countdown runs out', () => {
    armed();
    act(() => {
      jest.advanceTimersByTime(ARM_COUNTDOWN_SECONDS * 1000);
    });
    expect(started()).toHaveBeenCalledWith('Ride', 'gps', undefined);
  });

  it('records nothing when cancelled inside the window', () => {
    const { result } = armed();
    act(() => {
      jest.advanceTimersByTime(1000);
      result.current.cancelCountdown();
    });
    act(() => {
      jest.advanceTimersByTime(10_000);
    });
    expect(started()).not.toHaveBeenCalled();
    expect(result.current.countdown).toBeNull();
  });

  it('starts once, not twice, when the window is cancelled after it fired', () => {
    const { result } = armed();
    act(() => {
      jest.advanceTimersByTime(ARM_COUNTDOWN_SECONDS * 1000);
      result.current.cancelCountdown();
      jest.advanceTimersByTime(10_000);
    });
    expect(started()).toHaveBeenCalledTimes(1);
  });

  it('records nothing when the screen unmounts inside the window', () => {
    const { unmount } = armed();
    act(() => {
      jest.advanceTimersByTime(1000);
    });
    unmount();
    act(() => {
      jest.advanceTimersByTime(10_000);
    });
    expect(started()).not.toHaveBeenCalled();
  });
});

describe('the picker path still starts on arrival', () => {
  it('starts at once with no countdown', () => {
    const { result } = renderHook(() =>
      useInitRecordingEffect('idle', 'Ride', 'gps', undefined, true, undefined)
    );
    expect(started()).toHaveBeenCalledWith('Ride', 'gps', undefined);
    expect(result.current.countdown).toBeNull();
  });
});

describe('nothing is armed that is not allowed to start', () => {
  it('arms no countdown for an athlete who cannot record', () => {
    const { result } = renderHook(() =>
      useInitRecordingEffect('idle', 'Ride', 'gps', undefined, false, 'quickstart')
    );
    act(() => {
      jest.advanceTimersByTime(10_000);
    });
    expect(started()).not.toHaveBeenCalled();
    expect(result.current.countdown).toBeNull();
  });

  it('arms no countdown when a recording is already under way', () => {
    const { result } = renderHook(() =>
      useInitRecordingEffect('recording', 'Ride', 'gps', undefined, true, 'quickstart')
    );
    act(() => {
      jest.advanceTimersByTime(10_000);
    });
    expect(started()).not.toHaveBeenCalled();
    expect(result.current.countdown).toBeNull();
  });
});

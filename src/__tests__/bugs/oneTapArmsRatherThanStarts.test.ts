/**
 * Scenario: the Start on the record entry screen answered with a countdown
 * that covered the map before the ride began.
 *
 * Expected behaviour: Start begins the recording at once and nothing runs a
 * countdown. A one-tap system entry (widget, Control, launcher shortcut) still
 * lands on the recording screen idle with its Start button, so a pocket tap
 * records nothing, and the athlete begins with one more tap.
 */

import { act, renderHook } from '@testing-library/react-native';

import { useInitRecordingEffect } from '@/features/recording/hooks/useInitRecordingEffect';
import { useRecordingStore } from '@/features/recording/stores/RecordingStore';
import { canStartAfterScopeWarning } from '@/features/recording/lib/armCountdown';

const started = () => useRecordingStore.getState().startRecording as jest.Mock;

beforeEach(() => {
  jest.useFakeTimers();
  jest.spyOn(useRecordingStore.getState(), 'startRecording').mockImplementation(jest.fn());
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('the entry screen Start', () => {
  it('begins the recording on arrival, with no wait', async () => {
    await renderHook(() => useInitRecordingEffect('idle', 'Ride', undefined, true, 'entry'));
    expect(started()).toHaveBeenCalledTimes(1);
    expect(started()).toHaveBeenCalledWith('Ride', 'gps', undefined);
  });

  it('begins once after the athlete continues past the missing-scope warning', async () => {
    const { rerender } = await renderHook(
      ({ recordingWithoutScope }: { recordingWithoutScope: boolean }) =>
        useInitRecordingEffect(
          'idle',
          'Ride',
          undefined,
          canStartAfterScopeWarning(false, 'no_permission', recordingWithoutScope),
          'entry'
        ),
      { initialProps: { recordingWithoutScope: false } }
    );
    expect(started()).not.toHaveBeenCalled();

    await rerender({ recordingWithoutScope: true });
    expect(started()).toHaveBeenCalledTimes(1);

    await rerender({ recordingWithoutScope: true });
    await act(() => jest.advanceTimersByTime(10_000));
    expect(started()).toHaveBeenCalledTimes(1);
  });
});

describe('the picker path', () => {
  it('begins on arrival', async () => {
    await renderHook(() => useInitRecordingEffect('idle', 'Ride', undefined, true, undefined));
    expect(started()).toHaveBeenCalledWith('Ride', 'gps', undefined);
  });
});

describe('a one-tap system entry', () => {
  it('records nothing however long the screen stays open', async () => {
    await renderHook(() => useInitRecordingEffect('idle', 'Ride', undefined, true, 'quickstart'));
    await act(() => jest.advanceTimersByTime(10_000));
    expect(started()).not.toHaveBeenCalled();
  });

  it('begins once, under the sport held now, when the athlete taps Start', async () => {
    const { result } = await renderHook(() =>
      useInitRecordingEffect('idle', 'Ride', undefined, true, 'quickstart')
    );
    await act(() => result.current.startNow());
    await act(() => result.current.startNow());
    expect(started()).toHaveBeenCalledTimes(1);
  });
});

describe('nothing begins that is not allowed to', () => {
  it('does nothing for an athlete who cannot record', async () => {
    await renderHook(() => useInitRecordingEffect('idle', 'Ride', undefined, false, 'entry'));
    await act(() => jest.advanceTimersByTime(10_000));
    expect(started()).not.toHaveBeenCalled();
  });

  it('does nothing when a recording is already under way', async () => {
    await renderHook(() => useInitRecordingEffect('recording', 'Ride', undefined, true, 'entry'));
    expect(started()).not.toHaveBeenCalled();
  });
});

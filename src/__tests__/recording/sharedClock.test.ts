/**
 * Scenario: the live screen reads the timer and the metrics together.
 * Expected behaviour: one clock drives both, so a second of recording is one
 * render, and an idle store still turns a held sensor sample stale.
 */

import { renderHook, act } from '@testing-library/react-native';
import { useRecordingStore } from '@/features/recording/stores/RecordingStore';
import { useTimer } from '@/features/recording/hooks/useTimer';
import { useRecordingMetrics } from '@/features/recording/hooks/useRecordingMetrics';

describe('recording clock', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    useRecordingStore.getState().reset();
  });

  afterEach(() => {
    jest.useRealTimers();
    useRecordingStore.getState().reset();
  });

  it('renders once a second while both hooks run', async () => {
    let renders = 0;
    await renderHook(() => {
      renders += 1;
      useTimer();
      useRecordingMetrics();
    });

    await act(() => {
      jest.advanceTimersByTime(400);
    });
    await act(() => {
      useRecordingStore.getState().startRecording('Ride', 'outdoor' as never);
    });
    renders = 0;
    for (let i = 0; i < 50; i += 1) {
      await act(() => {
        jest.advanceTimersByTime(100);
      });
    }

    expect(renders).toBe(5);
  });

  it('turns a held sensor sample stale while idle', async () => {
    useRecordingStore.getState().setSensorSample('heartrate', 140);
    const { result } = await renderHook(() => useRecordingMetrics());
    expect(result.current.heartrate).toBe(140);

    await act(() => {
      jest.advanceTimersByTime(10_000);
    });

    expect(result.current.heartrate).toBe(0);
  });
});

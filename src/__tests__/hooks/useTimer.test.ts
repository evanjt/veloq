/**
 * Tests for useTimer hook
 *
 * Covers: elapsed/moving/lap time calculation, formatting,
 * pause/resume cycles, idle/stopped states, interval lifecycle.
 */

import { renderHook, act } from '@testing-library/react-native';
import { useRecordingStore } from '@/features/recording/stores/RecordingStore';
import { useTimer } from '@/features/recording/hooks/useTimer';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Reset the store to idle between tests */
function resetStore() {
  useRecordingStore.getState().reset();
}

/** Directly set store fields for controlled testing */
function setStoreState(partial: Record<string, unknown>) {
  useRecordingStore.setState(partial);
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('useTimer', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    resetStore();
  });

  afterEach(() => {
    jest.useRealTimers();
    resetStore();
  });

  // -------------------------------------------------------------------------
  // Idle / stopped state
  // -------------------------------------------------------------------------

  it('returns zeroed values for idle, stopped, and null-startTime states', async () => {
    // No active recording -> all times 0 and all formatted fields "00:00".
    const states: Record<string, unknown>[] = [
      {}, // default idle
      { status: 'stopped', startTime: null },
      { status: 'recording', startTime: null }, // recording but no startTime
    ];

    for (const state of states) {
      resetStore();
      if (Object.keys(state).length > 0) {
        setStoreState(state);
      }

      const { result } = await renderHook(() => useTimer());

      expect(result.current.elapsedTime).toBe(0);
      expect(result.current.movingTime).toBe(0);
      expect(result.current.formattedElapsed).toBe('00:00');
      expect(result.current.formattedMoving).toBe('00:00');
      expect(Object.keys(result.current).sort()).toEqual([
        'elapsedTime',
        'formattedElapsed',
        'formattedMoving',
        'movingTime',
      ]);
    }
  });

  // -------------------------------------------------------------------------
  // Elapsed time tracking
  // -------------------------------------------------------------------------

  it('tracks elapsed time while recording', async () => {
    const now = Date.now();
    setStoreState({
      status: 'recording',
      startTime: now,
      pausedDuration: 0,
      laps: [],
    });

    const { result } = await renderHook(() => useTimer());

    // Advance clock by 5 seconds to trigger tick updates
    await act(() => {
      jest.advanceTimersByTime(5000);
    });

    // Elapsed should be approximately 5 seconds
    expect(result.current.elapsedTime).toBeGreaterThanOrEqual(4);
    expect(result.current.elapsedTime).toBeLessThanOrEqual(6);
  });

  it('updates every second via setInterval', async () => {
    const now = Date.now();
    setStoreState({
      status: 'recording',
      startTime: now,
      pausedDuration: 0,
      laps: [],
    });

    const { result } = await renderHook(() => useTimer());

    const initial = result.current.elapsedTime;

    await act(() => {
      jest.advanceTimersByTime(1000);
    });

    const after1s = result.current.elapsedTime;

    await act(() => {
      jest.advanceTimersByTime(1000);
    });

    const after2s = result.current.elapsedTime;

    // Each second tick should increase elapsed time
    expect(after1s).toBeGreaterThan(initial);
    expect(after2s).toBeGreaterThan(after1s);
  });

  // -------------------------------------------------------------------------
  // Moving time (excludes paused duration)
  // -------------------------------------------------------------------------

  it('subtracts paused duration from moving time', async () => {
    const now = Date.now();
    // 10 seconds of paused time
    setStoreState({
      status: 'recording',
      startTime: now - 30000, // 30 seconds ago
      pausedDuration: 10000, // 10 seconds paused
      laps: [],
    });

    const { result } = await renderHook(() => useTimer());

    // Elapsed ~30s, moving ~20s (30 - 10)
    expect(result.current.elapsedTime).toBeGreaterThanOrEqual(29);
    expect(result.current.movingTime).toBeGreaterThanOrEqual(19);
    expect(result.current.movingTime).toBeLessThan(result.current.elapsedTime);
  });

  it('moving time never goes negative', async () => {
    const now = Date.now();
    // Paused duration exceeds elapsed (edge case)
    setStoreState({
      status: 'recording',
      startTime: now - 5000,
      pausedDuration: 60000, // More paused than elapsed
      laps: [],
    });

    const { result } = await renderHook(() => useTimer());

    expect(result.current.movingTime).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Lap time
  // -------------------------------------------------------------------------

  // -------------------------------------------------------------------------
  // Time formatting
  // -------------------------------------------------------------------------

  it('formats elapsed as mm:ss under an hour and hh:mm:ss over an hour', async () => {
    // Zero formatting ("00:00") is covered by the idle-states test above.
    const cases: { agoMs: number; pattern: RegExp }[] = [
      { agoMs: 125000, pattern: /^02:05$/ }, // 2:05
      { agoMs: 3661000, pattern: /^01:01:01$/ }, // 1h1m1s
    ];

    for (const { agoMs, pattern } of cases) {
      setStoreState({
        status: 'recording',
        startTime: Date.now() - agoMs,
        pausedDuration: 0,
        laps: [],
      });

      const { result } = await renderHook(() => useTimer());
      expect(result.current.formattedElapsed).toMatch(pattern);
    }
  });

  // -------------------------------------------------------------------------
  // Interval lifecycle
  // -------------------------------------------------------------------------

  it('starts interval when status changes to recording', async () => {
    const now = Date.now();
    setStoreState({
      status: 'idle',
      startTime: null,
      pausedDuration: 0,
      laps: [],
    });

    const { result, rerender } = await renderHook(() => useTimer());

    // Initially idle - no ticking
    expect(result.current.elapsedTime).toBe(0);

    // Switch to recording
    await act(() => {
      setStoreState({
        status: 'recording',
        startTime: now,
      });
    });

    await rerender({});

    await act(() => {
      jest.advanceTimersByTime(3000);
    });

    expect(result.current.elapsedTime).toBeGreaterThanOrEqual(2);
  });

  it('keeps elapsed time counting when status changes to paused', async () => {
    const now = Date.now();
    setStoreState({
      status: 'recording',
      startTime: now - 10000,
      pausedDuration: 0,
      laps: [],
    });

    const { result, rerender } = await renderHook(() => useTimer());

    // Record the current elapsed
    const beforePause = result.current.elapsedTime;

    // Pause
    await act(() => {
      setStoreState({
        status: 'paused',
        _pauseStart: Date.now(),
      });
    });

    await rerender({});

    await act(() => {
      jest.advanceTimersByTime(5000);
    });

    expect(result.current.elapsedTime).toBe(beforePause + 5);
  });

  it('cleans up interval on unmount', async () => {
    const clearIntervalSpy = jest.spyOn(global, 'clearInterval');

    const now = Date.now();
    setStoreState({
      status: 'recording',
      startTime: now,
      pausedDuration: 0,
      laps: [],
    });

    const { unmount } = await renderHook(() => useTimer());

    await unmount();

    expect(clearIntervalSpy).toHaveBeenCalled();
    clearIntervalSpy.mockRestore();
  });

  // -------------------------------------------------------------------------
  // Pause/resume cycle
  // -------------------------------------------------------------------------

  it('tracks time through a complete start/pause/resume/stop cycle', async () => {
    const now = Date.now();

    // Start recording
    setStoreState({
      status: 'recording',
      startTime: now,
      pausedDuration: 0,
      laps: [],
    });

    const { result, rerender } = await renderHook(() => useTimer());

    // Advance 10 seconds
    await act(() => {
      jest.advanceTimersByTime(10000);
    });

    expect(result.current.elapsedTime).toBeGreaterThanOrEqual(9);
    expect(result.current.movingTime).toBeGreaterThanOrEqual(9);

    // Pause (simulate 5 seconds of pause)
    await act(() => {
      setStoreState({ status: 'paused', _pauseStart: Date.now() });
    });
    await rerender({});

    await act(() => {
      jest.advanceTimersByTime(5000);
    });

    // Resume (accumulate 5 seconds of pause)
    await act(() => {
      setStoreState({
        status: 'recording',
        pausedDuration: 5000,
        _pauseStart: null,
      });
    });
    await rerender({});

    // Advance another 10 seconds
    await act(() => {
      jest.advanceTimersByTime(10000);
    });

    // Total elapsed ~25s, paused 5s, moving ~20s
    expect(result.current.elapsedTime).toBeGreaterThanOrEqual(23);
    expect(result.current.movingTime).toBeGreaterThanOrEqual(18);
    expect(result.current.movingTime).toBeLessThan(result.current.elapsedTime);
  });

  // -------------------------------------------------------------------------
  // Edge cases
  // -------------------------------------------------------------------------

  it('handles negative elapsed (startTime in the future) gracefully', async () => {
    const now = Date.now();
    setStoreState({
      status: 'recording',
      startTime: now + 60000, // Future
      pausedDuration: 0,
      laps: [],
    });

    const { result } = await renderHook(() => useTimer());

    expect(result.current.elapsedTime).toBe(0);
    expect(result.current.movingTime).toBe(0);
  });
});

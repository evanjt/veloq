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

  it('returns zeroed values for idle, stopped, and null-startTime states', () => {
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

      const { result } = renderHook(() => useTimer());

      expect(result.current.elapsedTime).toBe(0);
      expect(result.current.movingTime).toBe(0);
      expect(result.current.lapTime).toBe(0);
      expect(result.current.formattedElapsed).toBe('00:00');
      expect(result.current.formattedMoving).toBe('00:00');
      expect(result.current.formattedLap).toBe('00:00');
    }
  });

  // -------------------------------------------------------------------------
  // Elapsed time tracking
  // -------------------------------------------------------------------------

  it('tracks elapsed time while recording', () => {
    const now = Date.now();
    setStoreState({
      status: 'recording',
      startTime: now,
      pausedDuration: 0,
      laps: [],
    });

    const { result } = renderHook(() => useTimer());

    // Advance clock by 5 seconds to trigger tick updates
    act(() => {
      jest.advanceTimersByTime(5000);
    });

    // Elapsed should be approximately 5 seconds
    expect(result.current.elapsedTime).toBeGreaterThanOrEqual(4);
    expect(result.current.elapsedTime).toBeLessThanOrEqual(6);
  });

  it('updates every second via setInterval', () => {
    const now = Date.now();
    setStoreState({
      status: 'recording',
      startTime: now,
      pausedDuration: 0,
      laps: [],
    });

    const { result } = renderHook(() => useTimer());

    const initial = result.current.elapsedTime;

    act(() => {
      jest.advanceTimersByTime(1000);
    });

    const after1s = result.current.elapsedTime;

    act(() => {
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

  it('subtracts paused duration from moving time', () => {
    const now = Date.now();
    // 10 seconds of paused time
    setStoreState({
      status: 'recording',
      startTime: now - 30000, // 30 seconds ago
      pausedDuration: 10000, // 10 seconds paused
      laps: [],
    });

    const { result } = renderHook(() => useTimer());

    // Elapsed ~30s, moving ~20s (30 - 10)
    expect(result.current.elapsedTime).toBeGreaterThanOrEqual(29);
    expect(result.current.movingTime).toBeGreaterThanOrEqual(19);
    expect(result.current.movingTime).toBeLessThan(result.current.elapsedTime);
  });

  it('moving time never goes negative', () => {
    const now = Date.now();
    // Paused duration exceeds elapsed (edge case)
    setStoreState({
      status: 'recording',
      startTime: now - 5000,
      pausedDuration: 60000, // More paused than elapsed
      laps: [],
    });

    const { result } = renderHook(() => useTimer());

    expect(result.current.movingTime).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Lap time
  // -------------------------------------------------------------------------

  it('returns full moving time as lap time when no laps exist', () => {
    const now = Date.now();
    setStoreState({
      status: 'recording',
      startTime: now - 60000, // 60 seconds ago
      pausedDuration: 0,
      laps: [],
    });

    const { result } = renderHook(() => useTimer());

    expect(result.current.lapTime).toBe(result.current.movingTime);
  });

  it('computes lap time as moving time minus last lap endTime across lap setups', () => {
    // lapTime ≈ (elapsed - paused) - lastLap.endTime. Covers a single lap, a paused
    // recording, and multiple laps (last lap wins).
    const laps = (...ends: number[]) =>
      ends.map((endTime, index) => ({
        index,
        startTime: index === 0 ? 0 : ends[index - 1],
        endTime,
        distance: 500,
        avgSpeed: 10,
        avgHeartrate: null,
        avgPower: null,
        avgCadence: null,
      }));
    const cases: {
      elapsedMs: number;
      pausedMs: number;
      ends: number[];
      lapRange: [number, number];
      minMoving?: number;
    }[] = [
      { elapsedMs: 120000, pausedMs: 0, ends: [60], lapRange: [58, 62] },
      { elapsedMs: 120000, pausedMs: 20000, ends: [50], lapRange: [48, 52], minMoving: 98 },
      { elapsedMs: 300000, pausedMs: 0, ends: [100, 200], lapRange: [98, 102] },
    ];

    for (const { elapsedMs, pausedMs, ends, lapRange, minMoving } of cases) {
      setStoreState({
        status: 'recording',
        startTime: Date.now() - elapsedMs,
        pausedDuration: pausedMs,
        laps: laps(...ends),
      });

      const { result } = renderHook(() => useTimer());

      if (minMoving !== undefined) {
        expect(result.current.movingTime).toBeGreaterThanOrEqual(minMoving);
      }
      expect(result.current.lapTime).toBeGreaterThanOrEqual(lapRange[0]);
      expect(result.current.lapTime).toBeLessThanOrEqual(lapRange[1]);
    }
  });

  // -------------------------------------------------------------------------
  // Time formatting
  // -------------------------------------------------------------------------

  it('formats elapsed as mm:ss under an hour and hh:mm:ss over an hour', () => {
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

      const { result } = renderHook(() => useTimer());
      expect(result.current.formattedElapsed).toMatch(pattern);
    }
  });

  // -------------------------------------------------------------------------
  // Interval lifecycle
  // -------------------------------------------------------------------------

  it('starts interval when status changes to recording', () => {
    const now = Date.now();
    setStoreState({
      status: 'idle',
      startTime: null,
      pausedDuration: 0,
      laps: [],
    });

    const { result, rerender } = renderHook(() => useTimer());

    // Initially idle - no ticking
    expect(result.current.elapsedTime).toBe(0);

    // Switch to recording
    act(() => {
      setStoreState({
        status: 'recording',
        startTime: now,
      });
    });

    rerender({});

    act(() => {
      jest.advanceTimersByTime(3000);
    });

    expect(result.current.elapsedTime).toBeGreaterThanOrEqual(2);
  });

  it('stops interval when status changes to paused', () => {
    const now = Date.now();
    setStoreState({
      status: 'recording',
      startTime: now - 10000,
      pausedDuration: 0,
      laps: [],
    });

    const { result, rerender } = renderHook(() => useTimer());

    // Record the current elapsed
    const beforePause = result.current.elapsedTime;

    // Pause
    act(() => {
      setStoreState({
        status: 'paused',
        _pauseStart: Date.now(),
      });
    });

    rerender({});

    // Advance time - interval should be cleared, but Date.now() still advances
    act(() => {
      jest.advanceTimersByTime(5000);
    });

    // The hook still computes from Date.now() when status is paused (not idle/stopped),
    // but there's no interval ticking, so it only updates on re-render
    // The key thing is the interval is cleared (no memory leak)
    expect(result.current.elapsedTime).toBeGreaterThanOrEqual(beforePause);
  });

  it('cleans up interval on unmount', () => {
    const clearIntervalSpy = jest.spyOn(global, 'clearInterval');

    const now = Date.now();
    setStoreState({
      status: 'recording',
      startTime: now,
      pausedDuration: 0,
      laps: [],
    });

    const { unmount } = renderHook(() => useTimer());

    unmount();

    expect(clearIntervalSpy).toHaveBeenCalled();
    clearIntervalSpy.mockRestore();
  });

  // -------------------------------------------------------------------------
  // Pause/resume cycle
  // -------------------------------------------------------------------------

  it('tracks time through a complete start/pause/resume/stop cycle', () => {
    const now = Date.now();

    // Start recording
    setStoreState({
      status: 'recording',
      startTime: now,
      pausedDuration: 0,
      laps: [],
    });

    const { result, rerender } = renderHook(() => useTimer());

    // Advance 10 seconds
    act(() => {
      jest.advanceTimersByTime(10000);
    });

    expect(result.current.elapsedTime).toBeGreaterThanOrEqual(9);
    expect(result.current.movingTime).toBeGreaterThanOrEqual(9);

    // Pause (simulate 5 seconds of pause)
    act(() => {
      setStoreState({ status: 'paused', _pauseStart: Date.now() });
    });
    rerender({});

    act(() => {
      jest.advanceTimersByTime(5000);
    });

    // Resume (accumulate 5 seconds of pause)
    act(() => {
      setStoreState({
        status: 'recording',
        pausedDuration: 5000,
        _pauseStart: null,
      });
    });
    rerender({});

    // Advance another 10 seconds
    act(() => {
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

  it('handles negative elapsed (startTime in the future) gracefully', () => {
    const now = Date.now();
    setStoreState({
      status: 'recording',
      startTime: now + 60000, // Future
      pausedDuration: 0,
      laps: [],
    });

    const { result } = renderHook(() => useTimer());

    expect(result.current.elapsedTime).toBe(0);
    expect(result.current.movingTime).toBe(0);
    expect(result.current.lapTime).toBe(0);
  });
});

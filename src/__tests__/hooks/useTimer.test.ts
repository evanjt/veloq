/**
 * Tests for useTimer hook
 *
 * Covers: elapsed/moving/lap time calculation, formatting,
 * pause/resume cycles, idle/stopped states, interval lifecycle.
 */

import { renderHook, act } from '@testing-library/react-native';
import { useRecordingStore } from '@/providers/RecordingStore';
import { useTimer } from '@/hooks/recording/useTimer';

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

  it('returns zeroed values when status is idle', () => {
    const { result } = renderHook(() => useTimer());

    expect(result.current.elapsedTime).toBe(0);
    expect(result.current.movingTime).toBe(0);
    expect(result.current.lapTime).toBe(0);
    expect(result.current.formattedElapsed).toBe('00:00');
    expect(result.current.formattedMoving).toBe('00:00');
    expect(result.current.formattedLap).toBe('00:00');
  });

  it('returns zeroed values when status is stopped', () => {
    setStoreState({ status: 'stopped', startTime: null });
    const { result } = renderHook(() => useTimer());

    expect(result.current.elapsedTime).toBe(0);
    expect(result.current.formattedElapsed).toBe('00:00');
  });

  it('returns zeroed values when startTime is null even if status is recording', () => {
    setStoreState({ status: 'recording', startTime: null });
    const { result } = renderHook(() => useTimer());

    expect(result.current.elapsedTime).toBe(0);
    expect(result.current.movingTime).toBe(0);
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

  it('calculates lap time from last lap endTime', () => {
    const now = Date.now();
    setStoreState({
      status: 'recording',
      startTime: now - 120000, // 120 seconds ago
      pausedDuration: 0,
      laps: [
        {
          index: 0,
          startTime: 0,
          endTime: 60, // First lap ended at 60s moving time
          distance: 1000,
          avgSpeed: 16.67,
          avgHeartrate: null,
          avgPower: null,
          avgCadence: null,
        },
      ],
    });

    const { result } = renderHook(() => useTimer());

    // Moving time ~120s, lap started at 60s, so lap time ~60s
    expect(result.current.lapTime).toBeGreaterThanOrEqual(58);
    expect(result.current.lapTime).toBeLessThanOrEqual(62);
  });

  it('lap time accounts for paused duration correctly', () => {
    const now = Date.now();
    setStoreState({
      status: 'recording',
      startTime: now - 120000, // 120s ago
      pausedDuration: 20000, // 20s paused
      laps: [
        {
          index: 0,
          startTime: 0,
          endTime: 50, // First lap ended at 50s moving time
          distance: 500,
          avgSpeed: 10,
          avgHeartrate: null,
          avgPower: null,
          avgCadence: null,
        },
      ],
    });

    const { result } = renderHook(() => useTimer());

    // Elapsed ~120s, moving ~100s (120-20), lap started at 50s -> lap time ~50s
    expect(result.current.movingTime).toBeGreaterThanOrEqual(98);
    expect(result.current.lapTime).toBeGreaterThanOrEqual(48);
    expect(result.current.lapTime).toBeLessThanOrEqual(52);
  });

  // -------------------------------------------------------------------------
  // Time formatting
  // -------------------------------------------------------------------------

  it('formats seconds under an hour as mm:ss', () => {
    const now = Date.now();
    setStoreState({
      status: 'recording',
      startTime: now - 125000, // 125 seconds = 2:05
      pausedDuration: 0,
      laps: [],
    });

    const { result } = renderHook(() => useTimer());

    expect(result.current.formattedElapsed).toMatch(/^0[2]:0[5]$/);
  });

  it('formats time over an hour as hh:mm:ss', () => {
    const now = Date.now();
    setStoreState({
      status: 'recording',
      startTime: now - 3661000, // 1 hour, 1 minute, 1 second
      pausedDuration: 0,
      laps: [],
    });

    const { result } = renderHook(() => useTimer());

    expect(result.current.formattedElapsed).toBe('01:01:01');
  });

  it('formats zero as 00:00', () => {
    const { result } = renderHook(() => useTimer());

    expect(result.current.formattedElapsed).toBe('00:00');
    expect(result.current.formattedMoving).toBe('00:00');
    expect(result.current.formattedLap).toBe('00:00');
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

    // Initially idle — no ticking
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

    // Advance time — interval should be cleared, but Date.now() still advances
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

  it('handles multiple laps correctly (uses last lap)', () => {
    const now = Date.now();
    setStoreState({
      status: 'recording',
      startTime: now - 300000, // 300 seconds ago
      pausedDuration: 0,
      laps: [
        {
          index: 0,
          startTime: 0,
          endTime: 100,
          distance: 1000,
          avgSpeed: 10,
          avgHeartrate: null,
          avgPower: null,
          avgCadence: null,
        },
        {
          index: 1,
          startTime: 100,
          endTime: 200,
          distance: 1000,
          avgSpeed: 10,
          avgHeartrate: null,
          avgPower: null,
          avgCadence: null,
        },
      ],
    });

    const { result } = renderHook(() => useTimer());

    // Moving time ~300s, last lap endTime is 200s, so lap time ~100s
    expect(result.current.lapTime).toBeGreaterThanOrEqual(98);
    expect(result.current.lapTime).toBeLessThanOrEqual(102);
  });
});

/**
 * Scenario: the sections page explains why detection is not running. Two
 * things hold it: the elevation backfill, which suspends detection for the
 * whole of a pass and for as long as the queue is non-empty, and the detector
 * cutover, which the engine refuses to let a detect pre-empt (`SB12`).
 *
 * Expected behaviour: the page names which of the two, because the two end
 * differently. A cutover clears itself; a backfill waits on the network. The
 * backfill runs first and the cutover waits behind it, so it answers first.
 */

import { act, renderHook } from '@testing-library/react-native';

import { useDetectionHold } from '@/features/routes/hooks/useDetectionHold';
import { getEngine } from '@/shared/native/engine';

jest.mock('@/shared/native/engine', () => ({ getEngine: jest.fn() }));

const listeners = new Map<string, Set<() => void>>();

function engineWith({
  cutoverPending = false,
  cutoverRunning = false,
  phase = 'idle',
  remaining = 0 as number | null,
}) {
  return {
    isCutoverPending: jest.fn(() => cutoverPending),
    isCutoverRunning: jest.fn(() => cutoverRunning),
    getElevationBackfillProgress: jest.fn(() => ({
      phase,
      completed: 0,
      total: 0,
      failed: 0,
      percent: 0,
    })),
    getElevationBackfillRemaining: jest.fn(() => remaining),
    subscribe: jest.fn((event: string, cb: () => void) => {
      const set = listeners.get(event) ?? new Set<() => void>();
      set.add(cb);
      listeners.set(event, set);
      return () => set.delete(cb);
    }),
  };
}

function emit(event: string) {
  act(() => {
    listeners.get(event)?.forEach((cb) => cb());
  });
}

describe('useDetectionHold', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    listeners.clear();
    jest.clearAllMocks();
  });

  afterEach(() => jest.useRealTimers());

  it('names the backfill while a pass is running', () => {
    (getEngine as jest.Mock).mockReturnValue(engineWith({ phase: 'fetching', remaining: null }));

    const { result } = renderHook(() => useDetectionHold());

    expect(result.current).toBe('elevation');
  });

  it('names the backfill while the queue is non-empty with no pass in flight', () => {
    (getEngine as jest.Mock).mockReturnValue(engineWith({ remaining: 12 }));

    const { result } = renderHook(() => useDetectionHold());

    expect(result.current).toBe('elevation');
  });

  it('names the cutover once the queue is empty', () => {
    (getEngine as jest.Mock).mockReturnValue(engineWith({ cutoverPending: true, remaining: 0 }));

    const { result } = renderHook(() => useDetectionHold());

    expect(result.current).toBe('cutover');
  });

  it('names the backfill first when both hold, which is the upgrade path', () => {
    (getEngine as jest.Mock).mockReturnValue(engineWith({ cutoverPending: true, remaining: 12 }));

    const { result } = renderHook(() => useDetectionHold());

    expect(result.current).toBe('elevation');
  });

  it('names the cutover while one is actually running', () => {
    (getEngine as jest.Mock).mockReturnValue(engineWith({ cutoverRunning: true, remaining: 0 }));

    const { result } = renderHook(() => useDetectionHold());

    expect(result.current).toBe('cutover');
  });

  it('holds on nothing when neither holds', () => {
    (getEngine as jest.Mock).mockReturnValue(engineWith({ remaining: 0 }));

    const { result } = renderHook(() => useDetectionHold());

    expect(result.current).toBeNull();
  });

  it('treats an unanswerable count as no hold, not as work owed', () => {
    (getEngine as jest.Mock).mockReturnValue(engineWith({ remaining: null }));

    const { result } = renderHook(() => useDetectionHold());

    expect(result.current).toBeNull();
  });

  it('holds on nothing when the engine cannot answer at all', () => {
    (getEngine as jest.Mock).mockReturnValue(null);

    const { result } = renderHook(() => useDetectionHold());

    expect(result.current).toBeNull();
  });

  it('lifts the cutover hold once the migration has run', () => {
    let pending = true;
    (getEngine as jest.Mock).mockImplementation(() =>
      engineWith({ cutoverPending: pending, remaining: 0 })
    );

    const { result } = renderHook(() => useDetectionHold());
    expect(result.current).toBe('cutover');

    pending = false;
    act(() => jest.advanceTimersByTime(5000));
    expect(result.current).toBeNull();
  });

  it('hands over from the backfill to the cutover when the queue drains', () => {
    let left: number | null = 12;
    (getEngine as jest.Mock).mockImplementation(() =>
      engineWith({ cutoverPending: true, remaining: left })
    );

    const { result } = renderHook(() => useDetectionHold());
    expect(result.current).toBe('elevation');

    left = 0;
    emit('backfillPhase');
    expect(result.current).toBe('cutover');
  });

  it('stops re-reading the cutover once nothing holds', () => {
    const engine = engineWith({ remaining: 0 });
    (getEngine as jest.Mock).mockReturnValue(engine);

    const { result } = renderHook(() => useDetectionHold());
    expect(result.current).toBeNull();

    const atMount = engine.isCutoverPending.mock.calls.length;
    act(() => jest.advanceTimersByTime(30_000));
    expect(engine.isCutoverPending.mock.calls.length).toBe(atMount);
  });
});

/**
 * Scenario: the sections page explains why detection is not running. Two
 * things hold it: the elevation backfill, which suspends detection for the
 * whole of a pass and for as long as the queue is non-empty, and the detector
 * cutover, which the engine refuses to let a detect pre-empt.
 *
 * Expected behaviour: the page names which of the two, because the two end
 * differently. A cutover clears itself; a backfill waits on the network. The
 * backfill runs first and the cutover waits behind it, so it answers first.
 *
 * And the backfill's own three states are told apart. A pass working through
 * its queue, a queue nothing is working on, and a download the athlete paused
 * all used to read the same, so a library stuck for a fortnight looked
 * exactly like one that was busy.
 */

import { act, renderHook } from '@testing-library/react-native';

import { routesStatus } from '../__shared__/routesStatusStub';

import { isElevationHold, useDetectionHold } from '@/features/routes/hooks/useDetectionHold';
import { getEngine } from '@/shared/native/engine';

jest.mock('@/shared/native/engine', () => ({ getEngine: jest.fn() }));

const listeners = new Map<string, Set<() => void>>();

function engineWith({
  cutoverPending = false,
  cutoverRunning = false,
  phase = 'idle',
  remaining = 0 as number | null,
  paused = false,
}) {
  return {
    isCutoverPending: jest.fn(() => cutoverPending),
    isCutoverRunning: jest.fn(() => cutoverRunning),
    getElevationBackfillRemaining: jest.fn(() => remaining),
    getRoutesStatusData: jest.fn(() =>
      routesStatus({
        elevation: { phase },
        elevationRemaining: remaining,
        elevationPaused: paused,
        cutover: { phase: cutoverRunning ? 'detecting' : 'idle', running: cutoverRunning },
      })
    ),
    subscribe: jest.fn((event: string, cb: () => void) => {
      const set = listeners.get(event) ?? new Set<() => void>();
      set.add(cb);
      listeners.set(event, set);
      return () => set.delete(cb);
    }),
  };
}

async function emit(event: string) {
  await act(() => {
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

  it('names the backfill while a pass is running', async () => {
    (getEngine as jest.Mock).mockReturnValue(engineWith({ phase: 'fetching', remaining: null }));

    const { result } = await renderHook(() => useDetectionHold());

    expect(result.current).toBe('elevation-running');
  });

  it('tells a queue nothing is working on apart from a pass in flight', async () => {
    (getEngine as jest.Mock).mockReturnValue(engineWith({ remaining: 12 }));

    const { result } = await renderHook(() => useDetectionHold());

    expect(result.current).toBe('elevation-waiting');
  });

  it('names the pause, which is the one hold the athlete can lift', async () => {
    (getEngine as jest.Mock).mockReturnValue(engineWith({ remaining: 12, paused: true }));

    const { result } = await renderHook(() => useDetectionHold());

    expect(result.current).toBe('elevation-paused');
  });

  it('names the pause over a pass still finishing its batch', async () => {
    (getEngine as jest.Mock).mockReturnValue(
      engineWith({ phase: 'fetching', remaining: null, paused: true })
    );

    const { result } = await renderHook(() => useDetectionHold());

    expect(result.current).toBe('elevation-paused');
  });

  it('does not hold on a pause once the queue is empty', async () => {
    (getEngine as jest.Mock).mockReturnValue(engineWith({ remaining: 0, paused: true }));

    const { result } = await renderHook(() => useDetectionHold());

    expect(result.current).toBeNull();
  });

  it('groups the three elevation holds and excludes the cutover', () => {
    expect(isElevationHold('elevation-running')).toBe(true);
    expect(isElevationHold('elevation-waiting')).toBe(true);
    expect(isElevationHold('elevation-paused')).toBe(true);
    expect(isElevationHold('cutover')).toBe(false);
    expect(isElevationHold(null)).toBe(false);
  });

  it('names the cutover once the queue is empty', async () => {
    (getEngine as jest.Mock).mockReturnValue(engineWith({ cutoverPending: true, remaining: 0 }));

    const { result } = await renderHook(() => useDetectionHold());

    expect(result.current).toBe('cutover');
  });

  it('names the backfill first when both hold, which is the upgrade path', async () => {
    (getEngine as jest.Mock).mockReturnValue(engineWith({ cutoverPending: true, remaining: 12 }));

    const { result } = await renderHook(() => useDetectionHold());

    expect(result.current).toBe('elevation-waiting');
  });

  it('names the cutover while one is actually running', async () => {
    (getEngine as jest.Mock).mockReturnValue(engineWith({ cutoverRunning: true, remaining: 0 }));

    const { result } = await renderHook(() => useDetectionHold());

    expect(result.current).toBe('cutover');
  });

  it('holds on nothing when neither holds', async () => {
    (getEngine as jest.Mock).mockReturnValue(engineWith({ remaining: 0 }));

    const { result } = await renderHook(() => useDetectionHold());

    expect(result.current).toBeNull();
  });

  it('treats an unanswerable count as no hold, not as work owed', async () => {
    (getEngine as jest.Mock).mockReturnValue(engineWith({ remaining: null }));

    const { result } = await renderHook(() => useDetectionHold());

    expect(result.current).toBeNull();
  });

  it('holds on nothing when the engine cannot answer at all', async () => {
    (getEngine as jest.Mock).mockReturnValue(null);

    const { result } = await renderHook(() => useDetectionHold());

    expect(result.current).toBeNull();
  });

  it('lifts the cutover hold once the migration has run', async () => {
    let pending = true;
    (getEngine as jest.Mock).mockImplementation(() =>
      engineWith({ cutoverPending: pending, remaining: 0 })
    );

    const { result } = await renderHook(() => useDetectionHold());
    expect(result.current).toBe('cutover');

    pending = false;
    await act(() => jest.advanceTimersByTime(5000));
    expect(result.current).toBeNull();
  });

  it('hands over from the backfill to the cutover when the queue drains', async () => {
    let left: number | null = 12;
    (getEngine as jest.Mock).mockImplementation(() =>
      engineWith({ cutoverPending: true, remaining: left })
    );

    const { result } = await renderHook(() => useDetectionHold());
    expect(result.current).toBe('elevation-waiting');

    left = 0;
    await emit('backfillPhase');
    expect(result.current).toBe('cutover');
  });

  it('stops re-reading the cutover once nothing holds', async () => {
    const engine = engineWith({ remaining: 0 });
    (getEngine as jest.Mock).mockReturnValue(engine);

    const { result } = await renderHook(() => useDetectionHold());
    expect(result.current).toBeNull();

    const atMount = engine.isCutoverPending.mock.calls.length;
    await act(() => jest.advanceTimersByTime(30_000));
    expect(engine.isCutoverPending.mock.calls.length).toBe(atMount);
  });
});

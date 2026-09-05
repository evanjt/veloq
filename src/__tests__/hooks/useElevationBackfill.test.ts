/**
 * Scenario: Settings shows the elevation backfill's state. A run that could not
 * proceed must read differently from a run that finished, and differently again
 * from a run that finished with activities still to ask for.
 */

import { act, renderHook } from '@testing-library/react-native';

import { getEngine } from '@/shared/native/engine';
import { useElevationBackfill } from '@/features/routes/hooks/useElevationBackfill';

jest.mock('@/shared/native/engine', () => ({
  getEngine: jest.fn(),
}));

const mockGetEngine = getEngine as jest.MockedFunction<typeof getEngine>;

interface Progress {
  phase: string;
  completed: number;
  total: number;
  failed: number;
  percent: number;
}

const listeners = new Map<string, Set<() => void>>();

function engineReporting(
  progress: () => Progress | null,
  remaining: () => number | null = () => 0
) {
  return {
    getElevationBackfillProgress: () => progress(),
    getElevationBackfillRemaining: () => remaining(),
    subscribe: (event: string, callback: () => void) => {
      const forEvent = listeners.get(event) ?? new Set<() => void>();
      forEvent.add(callback);
      listeners.set(event, forEvent);
      return () => forEvent.delete(callback);
    },
  } as unknown as ReturnType<typeof getEngine>;
}

/** Stands in for the phase transition Rust announces off the JS thread. */
function announce(event: string) {
  act(() => {
    listeners.get(event)?.forEach((listener) => listener());
  });
}

function progress(phase: string, over: Partial<Progress> = {}): Progress {
  return { phase, completed: 0, total: 0, failed: 0, percent: 0, ...over };
}

describe('useElevationBackfill', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    listeners.clear();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('reads idle when no run has happened', () => {
    mockGetEngine.mockReturnValue(engineReporting(() => progress('idle')));

    const { result } = renderHook(() => useElevationBackfill());

    expect(result.current.phase).toBe('idle');
    expect(result.current.isRunning).toBe(false);
  });

  it('reports a live count while fetching', () => {
    mockGetEngine.mockReturnValue(
      engineReporting(() => progress('fetching', { completed: 12, total: 40 }))
    );

    const { result } = renderHook(() => useElevationBackfill());

    expect(result.current).toMatchObject({
      phase: 'fetching',
      completed: 12,
      total: 40,
      isRunning: true,
    });
  });

  it('follows the count as the run advances', () => {
    let completed = 1;
    mockGetEngine.mockReturnValue(
      engineReporting(() => progress('fetching', { completed, total: 40 }))
    );

    const { result } = renderHook(() => useElevationBackfill());
    completed = 7;
    act(() => {
      jest.advanceTimersByTime(500);
    });

    expect(result.current.completed).toBe(7);
  });

  it.each([
    ['complete', { completed: 40, total: 40 }],
    ['partial', { completed: 40, total: 40, failed: 3 }],
    ['failed', {}],
    ['paused', { completed: 20, total: 40 }],
  ])('reports the %s terminal state as itself', (phase, over) => {
    mockGetEngine.mockReturnValue(engineReporting(() => progress(phase, over)));

    const { result } = renderHook(() => useElevationBackfill());

    expect(result.current.phase).toBe(phase);
    expect(result.current.isRunning).toBe(false);
  });

  it('never reports a failed run as a finished one', () => {
    mockGetEngine.mockReturnValue(
      engineReporting(() => progress('failed', { completed: 40, total: 40 }))
    );

    const { result } = renderHook(() => useElevationBackfill());

    expect(result.current.phase).not.toBe('complete');
    expect(result.current.phase).not.toBe('partial');
    expect(result.current.phase).toBe('failed');
  });

  it('keeps the retry count of a partial run', () => {
    mockGetEngine.mockReturnValue(
      engineReporting(() => progress('partial', { completed: 40, total: 40, failed: 5 }))
    );

    const { result } = renderHook(() => useElevationBackfill());

    expect(result.current.failed).toBe(5);
  });

  it('treats an unknown phase as idle rather than as a finished run', () => {
    mockGetEngine.mockReturnValue(engineReporting(() => progress('detecting')));

    const { result } = renderHook(() => useElevationBackfill());

    expect(result.current.phase).toBe('idle');
  });

  it('reads idle when the engine is unavailable', () => {
    mockGetEngine.mockReturnValue(null);

    const { result } = renderHook(() => useElevationBackfill());

    expect(result.current.phase).toBe('idle');
  });

  it('stops polling once unmounted', () => {
    const read = jest.fn(() => progress('fetching', { completed: 1, total: 2 }));
    mockGetEngine.mockReturnValue(engineReporting(read));

    const { unmount } = renderHook(() => useElevationBackfill());
    unmount();
    const callsAtUnmount = read.mock.calls.length;
    act(() => {
      jest.advanceTimersByTime(2000);
    });

    expect(read).toHaveBeenCalledTimes(callsAtUnmount);
  });

  it('makes no engine calls while nothing is running', () => {
    const read = jest.fn(() => progress('idle'));
    mockGetEngine.mockReturnValue(engineReporting(read));

    renderHook(() => useElevationBackfill());
    const callsAtMount = read.mock.calls.length;
    act(() => {
      jest.advanceTimersByTime(10_000);
    });

    expect(callsAtMount).toBe(1);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('reads the snapshot when the engine announces a phase', () => {
    let phase = 'idle';
    mockGetEngine.mockReturnValue(
      engineReporting(() => progress(phase, { completed: 0, total: 12 }))
    );

    const { result } = renderHook(() => useElevationBackfill());
    expect(result.current.isRunning).toBe(false);

    phase = 'fetching';
    announce('backfillPhase');

    expect(result.current).toMatchObject({ phase: 'fetching', total: 12, isRunning: true });
  });

  it('stops reading once the run reaches a terminal phase', () => {
    let phase = 'fetching';
    const read = jest.fn(() => progress(phase, { completed: 3, total: 12 }));
    mockGetEngine.mockReturnValue(engineReporting(read));

    const { result } = renderHook(() => useElevationBackfill());
    phase = 'complete';
    announce('backfillPhase');
    expect(result.current.phase).toBe('complete');

    const callsAtSettle = read.mock.calls.length;
    act(() => {
      jest.advanceTimersByTime(10_000);
    });

    expect(read).toHaveBeenCalledTimes(callsAtSettle);
  });

  it('hears nothing more once unmounted', () => {
    const read = jest.fn(() => progress('idle'));
    mockGetEngine.mockReturnValue(engineReporting(read));

    const { unmount } = renderHook(() => useElevationBackfill());
    unmount();
    const callsAtUnmount = read.mock.calls.length;
    announce('backfillPhase');

    expect(read).toHaveBeenCalledTimes(callsAtUnmount);
  });
});

/**
 * At rest the phase is `idle` on every launch, because it is a process-global
 * that only a pass moves. The outstanding count is the durable fact, and
 * nothing read it (`B247`).
 */
describe('useElevationBackfill outstanding count', () => {
  it('reads the count at rest', () => {
    mockGetEngine.mockReturnValue(
      engineReporting(
        () => progress('idle'),
        () => 12
      )
    );

    const { result } = renderHook(() => useElevationBackfill());

    expect(result.current.phase).toBe('idle');
    expect(result.current.remaining).toBe(12);
  });

  it('reads zero as zero, not as unknown', () => {
    mockGetEngine.mockReturnValue(
      engineReporting(
        () => progress('idle'),
        () => 0
      )
    );

    const { result } = renderHook(() => useElevationBackfill());

    expect(result.current.remaining).toBe(0);
  });

  it('reads null when the engine cannot answer', () => {
    mockGetEngine.mockReturnValue(
      engineReporting(
        () => progress('idle'),
        () => null
      )
    );

    const { result } = renderHook(() => useElevationBackfill());

    expect(result.current.remaining).toBeNull();
  });

  it('reads null with no engine at all', () => {
    mockGetEngine.mockReturnValue(undefined as unknown as ReturnType<typeof getEngine>);

    const { result } = renderHook(() => useElevationBackfill());

    expect(result.current.remaining).toBeNull();
  });

  it('does not count during a live pass, which reports its own progress', () => {
    const remaining = jest.fn(() => 12);
    mockGetEngine.mockReturnValue(
      engineReporting(() => progress('fetching', { completed: 3, total: 20 }), remaining)
    );

    const { result } = renderHook(() => useElevationBackfill());

    expect(result.current.phase).toBe('fetching');
    expect(result.current.remaining).toBeNull();
    expect(remaining).not.toHaveBeenCalled();
  });

  it('re-counts when a pass announces it has finished', () => {
    let phase = 'fetching';
    let left = 12;
    mockGetEngine.mockReturnValue(
      engineReporting(
        () => progress(phase, { completed: 12, total: 12 }),
        () => left
      )
    );

    const { result } = renderHook(() => useElevationBackfill());
    expect(result.current.remaining).toBeNull();

    phase = 'idle';
    left = 0;
    announce('backfillPhase');

    expect(result.current.remaining).toBe(0);
  });
});

/**
 * Scenario: Settings shows the elevation backfill's state. A run that could not
 * proceed must read differently from a run that finished, and differently again
 * from a run that finished with activities still to ask for.
 */

import { act, renderHook } from '@testing-library/react-native';

jest.mock('@/shared/native/routeEngine', () => ({
  getRouteEngine: jest.fn(),
}));

import { getRouteEngine } from '@/shared/native/routeEngine';
import { useElevationBackfill } from '@/features/routes/hooks/useElevationBackfill';

const mockGetRouteEngine = getRouteEngine as jest.MockedFunction<typeof getRouteEngine>;

interface Progress {
  phase: string;
  completed: number;
  total: number;
  failed: number;
  percent: number;
}

function engineReporting(progress: () => Progress | null) {
  return {
    getElevationBackfillProgress: () => progress(),
  } as unknown as ReturnType<typeof getRouteEngine>;
}

function progress(phase: string, over: Partial<Progress> = {}): Progress {
  return { phase, completed: 0, total: 0, failed: 0, percent: 0, ...over };
}

describe('useElevationBackfill', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('reads idle when no run has happened', () => {
    mockGetRouteEngine.mockReturnValue(engineReporting(() => progress('idle')));

    const { result } = renderHook(() => useElevationBackfill());

    expect(result.current.phase).toBe('idle');
    expect(result.current.isRunning).toBe(false);
  });

  it('reports a live count while fetching', () => {
    mockGetRouteEngine.mockReturnValue(
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
    mockGetRouteEngine.mockReturnValue(
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
  ])('reports the %s terminal state as itself', (phase, over) => {
    mockGetRouteEngine.mockReturnValue(engineReporting(() => progress(phase, over)));

    const { result } = renderHook(() => useElevationBackfill());

    expect(result.current.phase).toBe(phase);
    expect(result.current.isRunning).toBe(false);
  });

  it('never reports a failed run as a finished one', () => {
    mockGetRouteEngine.mockReturnValue(
      engineReporting(() => progress('failed', { completed: 40, total: 40 }))
    );

    const { result } = renderHook(() => useElevationBackfill());

    expect(result.current.phase).not.toBe('complete');
    expect(result.current.phase).not.toBe('partial');
    expect(result.current.phase).toBe('failed');
  });

  it('keeps the retry count of a partial run', () => {
    mockGetRouteEngine.mockReturnValue(
      engineReporting(() => progress('partial', { completed: 40, total: 40, failed: 5 }))
    );

    const { result } = renderHook(() => useElevationBackfill());

    expect(result.current.failed).toBe(5);
  });

  it('treats an unknown phase as idle rather than as a finished run', () => {
    mockGetRouteEngine.mockReturnValue(engineReporting(() => progress('detecting')));

    const { result } = renderHook(() => useElevationBackfill());

    expect(result.current.phase).toBe('idle');
  });

  it('reads idle when the engine is unavailable', () => {
    mockGetRouteEngine.mockReturnValue(null);

    const { result } = renderHook(() => useElevationBackfill());

    expect(result.current.phase).toBe('idle');
  });

  it('stops polling once unmounted', () => {
    const read = jest.fn(() => progress('fetching', { completed: 1, total: 2 }));
    mockGetRouteEngine.mockReturnValue(engineReporting(read));

    const { unmount } = renderHook(() => useElevationBackfill());
    unmount();
    const callsAtUnmount = read.mock.calls.length;
    act(() => {
      jest.advanceTimersByTime(2000);
    });

    expect(read).toHaveBeenCalledTimes(callsAtUnmount);
  });
});

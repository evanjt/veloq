/**
 * Scenario: the change card reports what the detector cutover did to this
 * user's catalogue. While the re-cut runs it must show the phase, and once it
 * settles it must show the stored diff, including a second run that replaces
 * the first run's numbers.
 */

import { act, renderHook } from '@testing-library/react-native';

import { getEngine } from '@/shared/native/engine';
import { useCutoverSummary } from '@/features/routes/hooks/useCutoverSummary';

jest.mock('@/shared/native/engine', () => ({
  getEngine: jest.fn(),
}));

const mockGetEngine = getEngine as jest.MockedFunction<typeof getEngine>;

interface Progress {
  phase: string;
  running: boolean;
}

interface Counts {
  current: number;
  proposed: number;
  unchanged: number;
  changed: number;
  new: number;
  gone: number;
}

function counts(over: Partial<Counts> = {}): Counts {
  return { current: 0, proposed: 0, unchanged: 0, changed: 0, new: 0, gone: 0, ...over };
}

function engine(progress: () => Progress | null, diff: () => { counts: Counts } | null) {
  return {
    getCutoverProgress: () => progress(),
    getCutoverDiff: () => diff(),
  } as unknown as ReturnType<typeof getEngine>;
}

const POLL_TICKS = 6;

describe('useCutoverSummary', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('reports no engine as idle with no counts', () => {
    mockGetEngine.mockReturnValue(null);
    const { result } = renderHook(() => useCutoverSummary());
    expect(result.current).toEqual({ phase: 'idle', isRunning: false, counts: null });
  });

  it('reports the phase while the re-cut runs and withholds the counts', () => {
    const stored = counts({ current: 40, proposed: 42, changed: 3, new: 2 });
    mockGetEngine.mockReturnValue(
      engine(
        () => ({ phase: 'detecting', running: true }),
        () => ({ counts: stored })
      )
    );
    const { result } = renderHook(() => useCutoverSummary());
    expect(result.current.phase).toBe('detecting');
    expect(result.current.isRunning).toBe(true);
    expect(result.current.counts).toBeNull();
  });

  it('picks up the counts once the run completes', () => {
    let phase = 'diffing';
    let running = true;
    const stored = counts({
      current: 40,
      proposed: 42,
      unchanged: 35,
      changed: 3,
      new: 4,
      gone: 2,
    });
    mockGetEngine.mockReturnValue(
      engine(
        () => ({ phase, running }),
        () => ({ counts: stored })
      )
    );
    const { result } = renderHook(() => useCutoverSummary());
    expect(result.current.counts).toBeNull();

    phase = 'complete';
    running = false;
    act(() => {
      jest.advanceTimersByTime(500);
    });
    expect(result.current.isRunning).toBe(false);
    expect(result.current.counts).toEqual(stored);
  });

  it("replaces the first run's numbers when a second run settles", () => {
    let phase = 'complete';
    let running = false;
    let stored = counts({ current: 10, proposed: 11, new: 1 });
    mockGetEngine.mockReturnValue(
      engine(
        () => ({ phase, running }),
        () => ({ counts: stored })
      )
    );
    const { result } = renderHook(() => useCutoverSummary());
    expect(result.current.counts?.current).toBe(10);

    phase = 'detecting';
    running = true;
    act(() => {
      jest.advanceTimersByTime(500);
    });
    expect(result.current.counts).toBeNull();

    phase = 'complete';
    running = false;
    stored = counts({ current: 11, proposed: 20, new: 9 });
    act(() => {
      jest.advanceTimersByTime(500);
    });
    expect(result.current.counts).toEqual(stored);
  });

  it('treats an unknown phase as idle', () => {
    mockGetEngine.mockReturnValue(
      engine(
        () => ({ phase: 'reticulating', running: false }),
        () => null
      )
    );
    const { result } = renderHook(() => useCutoverSummary());
    expect(result.current.phase).toBe('idle');
  });

  it('survives a diff the engine cannot give and a progress call that throws', () => {
    mockGetEngine.mockReturnValue(
      engine(
        () => ({ phase: 'complete', running: false }),
        () => null
      )
    );
    const { result: noDiff } = renderHook(() => useCutoverSummary());
    expect(noDiff.current.counts).toBeNull();
    expect(noDiff.current.phase).toBe('complete');

    mockGetEngine.mockReturnValue(
      engine(
        () => {
          throw new Error('worker died');
        },
        () => null
      )
    );
    const { result: thrown } = renderHook(() => useCutoverSummary());
    expect(thrown.current).toEqual({ phase: 'idle', isRunning: false, counts: null });
  });

  it('parses the diff once while idle rather than on every poll', () => {
    // The diff parser walks every section, so polling it twice a second while
    // the card sits open is work the settled numbers never need repeated.
    const getDiff = jest.fn(() => ({ counts: counts({ current: 4, proposed: 6 }) }));
    mockGetEngine.mockReturnValue(engine(() => ({ phase: 'idle', running: false }), getDiff));

    renderHook(() => useCutoverSummary());
    const afterMount = getDiff.mock.calls.length;

    act(() => {
      jest.advanceTimersByTime(POLL_TICKS * 500);
    });

    expect(getDiff.mock.calls.length).toBe(afterMount);
  });

  it('re-reads the diff when a run gives up the slot', () => {
    const getDiff = jest.fn(() => ({ counts: counts({ current: 4, proposed: 6 }) }));
    let running = true;
    mockGetEngine.mockReturnValue(
      engine(() => ({ phase: running ? 'detecting' : 'idle', running }), getDiff)
    );

    renderHook(() => useCutoverSummary());
    const whileRunning = getDiff.mock.calls.length;

    running = false;
    act(() => {
      jest.advanceTimersByTime(500);
    });

    expect(getDiff.mock.calls.length).toBeGreaterThan(whileRunning);
  });

  it('stops polling once unmounted', () => {
    const progress = jest.fn(() => ({ phase: 'detecting', running: true }));
    mockGetEngine.mockReturnValue(engine(progress, () => null));
    const { unmount } = renderHook(() => useCutoverSummary());
    const callsWhileMounted = progress.mock.calls.length;
    unmount();
    act(() => {
      jest.advanceTimersByTime(2000);
    });
    expect(progress.mock.calls.length).toBe(callsWhileMounted);
  });
});

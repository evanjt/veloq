/**
 * Scenario: the change card reports what the detector cutover did to this
 * user's catalogue. While the re-cut runs it must show the phase, and once
 * Rust announces the commit it must show the stored diff, including a second
 * run that replaces the first run's numbers.
 *
 * Expected behaviour: the diff is read at mount and on the announced settle,
 * never on a timer. A mounted card with nothing running makes no engine call
 * at all, and a run in flight costs the phase read alone.
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

interface FakeEngine {
  announce: (event: string) => void;
  liveListeners: () => number;
  getCutoverProgress: jest.Mock<Progress | null, []>;
  getCutoverDiff: jest.Mock<{ counts: Counts } | null, []>;
}

function engine(progress: () => Progress | null, diff: () => { counts: Counts } | null) {
  const listeners = new Map<string, Set<() => void>>();
  return {
    announce: (event: string) =>
      act(() => {
        listeners.get(event)?.forEach((cb) => cb());
      }),
    liveListeners: () => [...listeners.values()].reduce((n, set) => n + set.size, 0),
    getCutoverProgress: jest.fn(progress),
    getCutoverDiff: jest.fn(diff),
    subscribe: jest.fn((event: string, cb: () => void) => {
      const set = listeners.get(event) ?? new Set<() => void>();
      listeners.set(event, set);
      set.add(cb);
      return () => set.delete(cb);
    }),
  } as unknown as FakeEngine;
}

function mount(fake: FakeEngine) {
  mockGetEngine.mockReturnValue(fake as unknown as ReturnType<typeof getEngine>);
  return renderHook(() => useCutoverSummary());
}

const POLL_INTERVAL_MS = 500;
const TICKS = 20;

function advance(ticks = TICKS) {
  act(() => {
    jest.advanceTimersByTime(ticks * POLL_INTERVAL_MS);
  });
}

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
    expect(result.current).toEqual({
      phase: 'idle',
      isRunning: false,
      counts: null,
      sawRun: false,
    });
  });

  it('reports the phase while the re-cut runs and withholds the counts', () => {
    const stored = counts({ current: 40, proposed: 42, changed: 3, new: 2 });
    const { result } = mount(
      engine(
        () => ({ phase: 'detecting', running: true }),
        () => ({ counts: stored })
      )
    );
    expect(result.current.phase).toBe('detecting');
    expect(result.current.isRunning).toBe(true);
    expect(result.current.counts).toBeNull();
  });

  it('picks up the counts when the engine announces the settle', () => {
    let phase = 'diffing';
    let running = true;
    const stored = counts({
      current: 38,
      proposed: 40,
      unchanged: 34,
      changed: 2,
      new: 4,
      gone: 2,
    });
    const fake = engine(
      () => ({ phase, running }),
      () => ({ counts: stored })
    );
    const { result } = mount(fake);
    expect(result.current.counts).toBeNull();

    phase = 'complete';
    running = false;
    fake.announce('cutoverSettled');

    expect(result.current.isRunning).toBe(false);
    expect(result.current.counts).toEqual(stored);
  });

  it('replaces the first run numbers when a second run settles', () => {
    let phase = 'detecting';
    let running = true;
    let stored = counts({ current: 10, proposed: 11, new: 1 });
    const fake = engine(
      () => ({ phase, running }),
      () => ({ counts: stored })
    );
    const { result } = mount(fake);
    expect(result.current.counts).toBeNull();

    phase = 'complete';
    running = false;
    fake.announce('cutoverSettled');
    expect(result.current.counts?.current).toBe(10);

    stored = counts({ current: 11, proposed: 20, new: 9 });
    fake.announce('cutoverSettled');
    expect(result.current.counts).toEqual(stored);
  });

  it('treats an unknown phase as idle', () => {
    const { result } = mount(
      engine(
        () => ({ phase: 'reticulating', running: false }),
        () => null
      )
    );
    expect(result.current.phase).toBe('idle');
  });

  it('survives a diff the engine cannot give and a progress call that throws', () => {
    const { result: noDiff } = mount(
      engine(
        () => ({ phase: 'complete', running: false }),
        () => null
      )
    );
    expect(noDiff.current.counts).toBeNull();
    expect(noDiff.current.phase).toBe('complete');

    const { result: thrown } = mount(
      engine(
        () => {
          throw new Error('worker died');
        },
        () => null
      )
    );
    expect(thrown.current).toEqual({
      phase: 'idle',
      isRunning: false,
      counts: null,
      sawRun: false,
    });
  });

  it('makes no engine call on a timer while nothing is running', () => {
    const fake = engine(
      () => ({ phase: 'idle', running: false }),
      () => ({ counts: counts({ current: 4, proposed: 6 }) })
    );
    mount(fake);
    const progressAtMount = fake.getCutoverProgress.mock.calls.length;
    const diffAtMount = fake.getCutoverDiff.mock.calls.length;

    advance();

    expect(fake.getCutoverProgress.mock.calls.length).toBe(progressAtMount);
    expect(fake.getCutoverDiff.mock.calls.length).toBe(diffAtMount);
  });

  it('follows the phase of a run in flight without reading the diff', () => {
    let phase = 'draining';
    const fake = engine(
      () => ({ phase, running: true }),
      () => ({ counts: counts({ current: 4, proposed: 6 }) })
    );
    const { result } = mount(fake);
    const diffAtMount = fake.getCutoverDiff.mock.calls.length;

    phase = 'detecting';
    advance(1);
    expect(result.current.phase).toBe('detecting');

    advance();
    expect(fake.getCutoverDiff.mock.calls.length).toBe(diffAtMount);
  });

  it('stops reading once a run gives up the slot', () => {
    let running = true;
    const fake = engine(
      () => ({ phase: running ? 'detecting' : 'idle', running }),
      () => null
    );
    mount(fake);

    running = false;
    advance(1);
    const afterSettle = fake.getCutoverProgress.mock.calls.length;

    advance();
    expect(fake.getCutoverProgress.mock.calls.length).toBe(afterSettle);
  });

  it('counts the announced settle as a run it saw, even mounting after the start', () => {
    // The event only fires for a run that reached a terminal phase, so hearing
    // it is proof of a run the mount read was too late to see.
    let phase = 'idle';
    const fake = engine(
      () => ({ phase, running: false }),
      () => null
    );
    const { result } = mount(fake);
    expect(result.current.sawRun).toBe(false);

    phase = 'failed';
    fake.announce('cutoverSettled');

    expect(result.current.sawRun).toBe(true);
    expect(result.current.phase).toBe('failed');
  });

  it('drops its subscription on unmount and reads nothing after it', () => {
    const fake = engine(
      () => ({ phase: 'detecting', running: true }),
      () => null
    );
    const { unmount } = mount(fake);
    const whileMounted = fake.getCutoverProgress.mock.calls.length;

    unmount();
    fake.announce('cutoverSettled');
    advance();

    expect(fake.liveListeners()).toBe(0);
    expect(fake.getCutoverProgress.mock.calls.length).toBe(whileMounted);
  });
});

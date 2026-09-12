/**
 * Scenario: demo mode opens the strength tab for the first time, and the
 * fixtures have to be in the engine before the tab can decide whether to
 * appear.
 *
 * Expected behaviour: the seed is a write, and writes do not happen while
 * React is committing. The memo reads; an effect seeds and then wakes the memo.
 * The tab still appears, and a session that is not demo writes nothing.
 *
 * The assertion is on order rather than on presence. `renderHook` flushes
 * effects before it returns, so by the time a case can look, an effect-driven
 * seed has already run: what separates the two designs is whether the first
 * read happens before the first write.
 */
import { renderHook, act } from '@testing-library/react-native';

import { useStrengthTabState } from '@/features/strength/hooks/useStrengthVolume';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());

const mockEngine: Record<string, unknown> = {};
let mockIsDemoMode = true;

jest.mock('@/shared/native/useEngineReady', () => ({ useEngineReady: () => mockEngine }));
jest.mock('@/shared/native/engine', () => ({ getEngine: () => mockEngine }));
jest.mock('@/shared/app/AuthStore', () => ({
  useAuthStore: { getState: () => ({ isDemoMode: mockIsDemoMode }) },
}));

/** Every engine call in the order it was made. */
let trace: string[] = [];
let seeded = new Set<string>();
let listener: (() => void) | null = null;
let channels: string[] = [];

function engine(): void {
  for (const key of Object.keys(mockEngine)) delete mockEngine[key];
  trace = [];
  seeded = new Set();
  listener = null;
  channels = [];
  Object.assign(mockEngine, {
    subscribe: (channel: string, cb: () => void) => {
      channels.push(channel);
      if (channel === 'fitParsed') listener = cb;
      return () => {
        if (channel === 'fitParsed') listener = null;
      };
    },
    getExerciseSets: (id: string) => (seeded.has(id) ? [{}] : []),
    bulkInsertExerciseSets: (id: string) => {
      trace.push('write');
      seeded.add(id);
    },
    hasStrengthData: () => {
      trace.push('read');
      return seeded.size > 0;
    },
    getUnprocessedStrengthIds: () => [],
  });
}

const writes = () => trace.filter((c) => c === 'write').length;

/**
 * The seed latches once per process by design, and the latch is module state.
 * `jest.isolateModules` would give each case its own copy and its own React
 * with it, which leaves the hook with a null dispatcher, so the cases share one
 * module and are written not to need a reset instead.
 *
 * The non-demo case runs first because it leaves the latch alone:
 * `ensureDemoStrengthSeeded` returns on the demo check before setting it. The
 * demo lifecycle then runs as one ordered case, because the first mount is the
 * only one that can seed.
 */
describe('the demo strength seed', () => {
  beforeEach(() => engine());

  it('writes nothing at all when the session is not a demo one', () => {
    mockIsDemoMode = false;
    const { rerender } = renderHook(() => useStrengthTabState());
    act(() => {
      listener?.();
    });
    rerender({});
    expect(writes()).toBe(0);
  });

  it('reads before it writes, lands the seed, shows the tab, and seeds once', () => {
    mockIsDemoMode = true;
    const { result, rerender } = renderHook(() => useStrengthTabState());

    // The whole defect: the memo asked the engine before anything wrote. With
    // the seed inside the memo the first call in the trace is the write.
    expect(trace.indexOf('read')).toBe(0);
    expect(trace.indexOf('write')).toBeGreaterThan(0);

    // The seed's own announcement brings the real answer, so the tab appears.
    expect(channels).toContain('fitParsed');
    act(() => {
      listener?.();
    });
    rerender({});
    expect(result.current).toBe('ready');

    // And it is once per process, not once per mount.
    const before = writes();
    renderHook(() => useStrengthTabState());
    expect(writes()).toBe(before);
  });
});

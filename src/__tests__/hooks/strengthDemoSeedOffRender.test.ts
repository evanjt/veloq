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
import { SyncState } from 'veloqrs';
import { renderHook, act } from '@testing-library/react-native';

import { useStrengthTabState } from '@/features/strength/hooks/useStrengthScreenData';
import { demoStrengthActivityIds } from '@/features/strength/lib/demoStrength';

jest.mock('veloqrs', () =>
  require('../__shared__/veloqrsStub').withOverrides(
    require('../__shared__/veloqrsStub').namespacesOver(() =>
      require('@/shared/native/engine').getEngine()
    )
  )
);

const mockEngine: Record<string, unknown> = {};
let mockIsDemoMode = true;

jest.mock('@/shared/native/useEngineReady', () => ({ useEngineReady: () => mockEngine }));
jest.mock('@/shared/native/engine', () => ({
  getEngine: () => mockEngine,
  isEngineReady: () => true,
}));
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
    getExerciseSets: (id: string) => ({ sets: seeded.has(id) ? [{}] : [] }),
    fetchAndParseExerciseSets: (id: string) => {
      trace.push('write');
      seeded.add(id);
    },
    hasStrengthData: () => {
      trace.push('read');
      return seeded.size > 0;
    },
    getUnprocessedStrengthIds: () => [],
    getSyncStatus: () => ({ state: SyncState.Idle }),
  });
}

const writes = () => trace.filter((c) => c === 'write').length;

/**
 * The cases share one module, because `jest.isolateModules` would give each
 * case its own React and leave the hook with a null dispatcher. Each case
 * starts from an empty engine through `beforeEach`, so no case depends on what
 * an earlier one seeded. The demo lifecycle runs as one ordered case, so its
 * wipe step follows the seed it has just made.
 */
describe('the demo strength seed', () => {
  beforeEach(() => engine());

  it('writes nothing at all when the session is not a demo one', async () => {
    mockIsDemoMode = false;
    const { rerender } = await renderHook(() => useStrengthTabState());
    await act(() => {
      listener?.();
    });
    await rerender({});
    expect(writes()).toBe(0);
  });

  it('reads before it writes, lands the seed, shows the tab, and reseeds after a wipe', async () => {
    mockIsDemoMode = true;
    const { result, rerender } = await renderHook(() => useStrengthTabState());

    // The whole defect: the memo asked the engine before anything wrote. With
    // the seed inside the memo the first call in the trace is the write.
    expect(trace.indexOf('read')).toBe(0);
    expect(trace.indexOf('write')).toBeGreaterThan(0);

    // The seed's own announcement brings the real answer, so the tab appears.
    expect(channels).toContain('fitParsed');
    await act(() => {
      listener?.();
    });
    await rerender({});
    expect(result.current).toBe('ready');

    // A mount after the seed finds the sets in the engine and writes nothing.
    const before = writes();
    await renderHook(() => useStrengthTabState());
    expect(writes()).toBe(before);

    // A library wipe clears the demo sets, as a sign-in to a real account does.
    // The next demo mount in the same process reseeds them.
    seeded.clear();
    const wiped = writes();
    await renderHook(() => useStrengthTabState());
    expect(writes()).toBe(wiped + demoStrengthActivityIds().length);
  });
});

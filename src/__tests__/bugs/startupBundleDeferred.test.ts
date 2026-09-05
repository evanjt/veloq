/**
 * Scenario: the feed's startup bundle was fetched inside a `useMemo`, so the
 * engine answered on the JavaScript thread during render, once on mount and
 * again on every activities and sections event. The bundle also carried the
 * whole insights record and the cached metric id list, neither of which the
 * feed draws.
 *
 * Expected behaviour: no engine call happens during render, several events
 * arriving before the deferred read runs cost one call rather than one each,
 * the last bundle stays on screen while the next read is pending, and the
 * record carries only the summary card and the preview tracks.
 */

import { act, renderHook } from '@testing-library/react-native';
import { InteractionManager } from 'react-native';

import { useStartupData } from '@/features/home/hooks/useStartupData';
import { getEngine } from '@/shared/native/engine';

jest.mock('@/shared/native/engine', () => ({
  getEngine: jest.fn(),
}));

jest.mock('veloqrs', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('../__shared__/veloqrsStub').withOverrides({
    decodeCoords: jest.fn(() => [{ latitude: 1, longitude: 2 }]),
  })
);

const mockGetEngine = getEngine as jest.MockedFunction<typeof getEngine>;

const SUMMARY_CARD = { currentWeek: { count: 3 } };

type Task = { run: () => void; cancelled: boolean };
let pending: Task[] = [];

function flushInteractions(): void {
  const queued = pending;
  pending = [];
  act(() => {
    for (const task of queued) {
      if (!task.cancelled) task.run();
    }
  });
}

let subscribers: (() => void)[] = [];

function bundle(previewIds: string[]) {
  return {
    summaryCard: SUMMARY_CARD,
    previewTracks: previewIds.map((id) => ({ activityId: id, encodedCoords: new Uint8Array([1]) })),
  };
}

const engine = {
  getStartupData: jest.fn((_params: unknown, ids: string[]) => bundle(ids)),
  subscribe: jest.fn((_event: string, cb: () => void) => {
    subscribers.push(cb);
    return () => {};
  }),
};

beforeEach(() => {
  jest.clearAllMocks();
  pending = [];
  subscribers = [];
  engine.getStartupData.mockImplementation((_params: unknown, ids: string[]) => bundle(ids));
  mockGetEngine.mockReturnValue(engine as unknown as ReturnType<typeof getEngine>);
  jest.spyOn(InteractionManager, 'runAfterInteractions').mockImplementation((task) => {
    const entry: Task = { run: task as () => void, cancelled: false };
    pending.push(entry);
    return {
      then: () => Promise.resolve(),
      done: () => {},
      cancel: () => {
        entry.cancelled = true;
      },
    } as unknown as ReturnType<typeof InteractionManager.runAfterInteractions>;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('useStartupData', () => {
  it('makes no engine call while the feed renders', () => {
    const { result } = renderHook(() => useStartupData(['a', 'b']));

    expect(engine.getStartupData).not.toHaveBeenCalled();
    expect(result.current.data).toBeNull();

    flushInteractions();

    expect(engine.getStartupData).toHaveBeenCalledTimes(1);
    expect(result.current.data?.previewTracks.size).toBe(2);
  });

  it('costs one call when several engine events arrive before the read runs', () => {
    renderHook(() => useStartupData(['a']));
    flushInteractions();
    expect(engine.getStartupData).toHaveBeenCalledTimes(1);

    act(() => {
      for (const notify of subscribers) notify();
      for (const notify of subscribers) notify();
    });
    flushInteractions();

    expect(engine.getStartupData).toHaveBeenCalledTimes(2);
  });

  it('keeps the last bundle on screen while the next read is pending', () => {
    const { result, rerender } = renderHook(({ ids }: { ids: string[] }) => useStartupData(ids), {
      initialProps: { ids: ['a'] },
    });
    flushInteractions();
    const first = result.current.data;
    expect(first?.previewTracks.size).toBe(1);

    rerender({ ids: ['a', 'b'] });

    expect(result.current.data).toBe(first);

    flushInteractions();

    expect(result.current.data?.previewTracks.size).toBe(2);
  });

  it('keeps the last bundle when the engine read fails', () => {
    const { result } = renderHook(() => useStartupData(['a']));
    flushInteractions();
    const first = result.current.data;
    expect(first).not.toBeNull();

    engine.getStartupData.mockImplementation(() => {
      throw new Error('engine busy');
    });
    act(() => {
      for (const notify of subscribers) notify();
    });
    flushInteractions();

    expect(result.current.data).toBe(first);
  });

  it('carries only the summary card and the preview tracks', () => {
    const { result } = renderHook(() => useStartupData([]));
    flushInteractions();

    expect(engine.getStartupData).toHaveBeenCalledTimes(1);
    expect(result.current.data?.previewTracks.size).toBe(0);
    expect(Object.keys(result.current.data ?? {}).sort()).toEqual([
      'previewTracks',
      'summaryCardData',
    ]);
  });

  it('makes no engine call once the feed has unmounted', () => {
    const { unmount } = renderHook(() => useStartupData(['a']));
    unmount();
    flushInteractions();

    expect(engine.getStartupData).not.toHaveBeenCalled();
  });
});

/**
 * Scenario: the upgrade path left activities without a `time` stream, so the
 * route sync asks Rust to fetch them and reports the drain to the banner.
 *
 * Expected behaviour: the count comes from what Rust announces, not from
 * re-reading the gap, and the wait ends when the caller goes away.
 */

import { backfillTimeStreams } from '@/features/routes/lib/timeStreamBackfill';
import { engine } from 'veloqrs';

type MockListener = (payload?: unknown) => void;

const mockListeners = new Map<string, Set<MockListener>>();

jest.mock('veloqrs', () => ({
  engine: {
    getActivitiesNeedingTimeStreams: jest.fn(() => [] as string[]),
    syncTimeStreams: jest.fn(),
    subscribe: jest.fn((event: string, callback: MockListener) => {
      const forEvent = mockListeners.get(event) ?? new Set<MockListener>();
      forEvent.add(callback);
      mockListeners.set(event, forEvent);
      return () => forEvent.delete(callback);
    }),
  },
}));

const needing = engine.getActivitiesNeedingTimeStreams as unknown as jest.Mock;
const syncTimeStreams = engine.syncTimeStreams as unknown as jest.Mock;

/** Stands in for the announcement Rust makes off the JS thread. */
function announce(activityIds: string[]) {
  mockListeners.get('timeStreamsStored')?.forEach((listener) => listener({ activityIds }));
}

describe('backfillTimeStreams', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    mockListeners.clear();
    needing.mockReturnValue([]);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('asks for nothing when every activity has its stream', async () => {
    await expect(backfillTimeStreams(jest.fn())).resolves.toEqual({ total: 0, remaining: 0 });

    expect(syncTimeStreams).not.toHaveBeenCalled();
  });

  it('waits on the announcement rather than re-reading the gap', async () => {
    needing.mockReturnValue(['a1', 'a2']);

    const backfill = backfillTimeStreams(jest.fn());
    await Promise.resolve();
    expect(syncTimeStreams).toHaveBeenCalledWith(['a1', 'a2']);
    const readsAtRequest = needing.mock.calls.length;

    announce(['a1', 'a2']);

    await expect(backfill).resolves.toEqual({ total: 2, remaining: 0 });
    expect(needing).toHaveBeenCalledTimes(readsAtRequest);
  });

  it('reports the drain as each batch lands', async () => {
    needing.mockReturnValue(['a1', 'a2', 'a3']);
    const onProgress = jest.fn();

    const backfill = backfillTimeStreams(onProgress);
    await Promise.resolve();
    announce(['a1']);
    announce(['a2', 'a3']);
    await backfill;

    expect(onProgress.mock.calls).toEqual([
      [0, 3],
      [1, 3],
      [3, 3],
    ]);
  });

  it('moves on with what never landed', async () => {
    needing.mockReturnValue(['a1', 'a2']);

    const backfill = backfillTimeStreams(jest.fn());
    await Promise.resolve();
    announce(['a1']);
    jest.advanceTimersByTime(60_000);

    await expect(backfill).resolves.toEqual({ total: 2, remaining: 1 });
  });

  it('ends the wait when the screen goes away', async () => {
    needing.mockReturnValue(['a1']);
    const controller = new AbortController();

    const backfill = backfillTimeStreams(jest.fn(), controller.signal);
    await Promise.resolve();
    controller.abort();

    await expect(backfill).resolves.toEqual({ total: 1, remaining: 1 });
    expect(mockListeners.get('timeStreamsStored')?.size ?? 0).toBe(0);
  });
});

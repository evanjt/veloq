/**
 * Scenario: a silent push arrives while the foreground GPS sync is
 * downloading. Both start a fetch, and both read the result out of one global
 * slot: whichever reads first takes the other's answer and acts on it, and the
 * one that started that download reads nothing and calls its own pass a
 * failure.
 *
 * Expected behaviour: a caller reads back only what its own start produced, so
 * two interleaved runs each report their own synced activities.
 */
import { renderHook } from '@testing-library/react-native';

import { useGpsDataFetcher } from '@/features/routes/hooks/useGpsDataFetcher';

jest.mock('veloqrs', () =>
  require('../__shared__/veloqrsStub').withOverrides({
    engine: {
      ...require('../__shared__/veloqrsStub').fetchCalls,
      setActivityMetrics: jest.fn(),
      triggerRefresh: jest.fn(),
      getStats: jest.fn(() => ({ sectionsDirty: false })),
      pollTileGeneration: jest.fn(() => 'idle'),
      subscribe: jest.fn(() => () => {}),
    },
  })
);
jest.mock('@/shared/native/engine', () => ({
  getNativeModule: () => ({ engine: { getSectionDetectionProgress: () => null } }),
  getEngine: () => null,
}));
jest.mock('@/features/routes/lib/gpsDownloadPoll', () => ({
  abandonDownload: jest.fn(),
  pollDownloadProgress: jest.fn(async () => 'settled'),
  runProgressReader: jest.fn(() => () => undefined),
}));
jest.mock('@/features/routes/lib/timeStreamBackfill', () => ({
  backfillTimeStreams: jest.fn(async () => ({ total: 0, remaining: 0 })),
}));

const { startFetchAndStore, takeFetchAndStoreResult } = require('veloqrs');

const activity = (id: string) =>
  ({ id, type: 'Ride', start_date_local: '2026-01-01T08:00:00' }) as never;

const resultFor = (ids: string[]) => ({
  successCount: ids.length,
  total: ids.length,
  failedIds: [],
  syncedIds: ids,
});

const deps = () => ({
  isMountedRef: { current: true },
  abortSignal: new AbortController().signal,
  updateProgress: jest.fn(),
});

describe('the foreground sync reading a download result', () => {
  beforeEach(() => {
    startFetchAndStore.mockReset();
    takeFetchAndStoreResult.mockReset();
  });

  it('reports the activities of the run it started, whichever run finishes first', async () => {
    startFetchAndStore.mockReturnValueOnce(1).mockReturnValueOnce(2);
    const results = new Map<number, ReturnType<typeof resultFor>>([
      [1, resultFor(['a1'])],
      [2, resultFor(['b1', 'b2'])],
    ]);
    takeFetchAndStoreResult.mockImplementation((run?: number) =>
      run === undefined ? null : (results.get(run) ?? null)
    );
    const { result } = renderHook(() => useGpsDataFetcher());

    const [first, second] = await Promise.all([
      result.current.fetchApiGps([activity('a1')], deps()),
      result.current.fetchApiGps([activity('b1'), activity('b2')], deps()),
    ]);

    expect(first.syncedIds).toEqual(['a1']);
    expect(second.syncedIds).toEqual(['b1', 'b2']);
    expect(takeFetchAndStoreResult).toHaveBeenCalledWith(1);
    expect(takeFetchAndStoreResult).toHaveBeenCalledWith(2);
  });

  it('does not take a result that belongs to another run as its own', async () => {
    startFetchAndStore.mockReturnValue(1);
    takeFetchAndStoreResult.mockImplementation((run?: number) =>
      run === 99 ? resultFor(['foreign']) : null
    );
    const { result } = renderHook(() => useGpsDataFetcher());

    const outcome = await result.current.fetchApiGps([activity('a1')], deps());

    expect(outcome.syncedIds).toEqual([]);
  });
});

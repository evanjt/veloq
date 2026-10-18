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
import { useSyncDateRange } from '@/shared/app/SyncDateRangeStore';

jest.mock('veloqrs', () =>
  require('../__shared__/veloqrsStub').withOverrides({
    heatmap: {
      ...require('../__shared__/veloqrsStub').heatmap,
      pollTileGeneration: jest.fn(() => 'idle'),
    },
    engine: {
      ...require('../__shared__/veloqrsStub').fetchCalls,
      triggerRefresh: jest.fn(),
      getStats: jest.fn(() => ({ sectionsDirty: false })),
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

const { engine, takeFetchAndStoreResult, StartOutcome } = require('veloqrs');
const { startGpsPass } = engine;

/** The pass the engine starts, filed under `run`. */
const started = (run: number) => (_oldest: string, _newest: string, head: string[]) => ({
  outcome: StartOutcome.Started,
  run,
  total: head.length,
});

const activity = (id: string) => ({ activityId: id, sportType: 'Ride' });

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
    startGpsPass.mockReset();
    takeFetchAndStoreResult.mockReset();
    engine.triggerRefresh.mockClear();
  });

  it('reports the activities of the run it started, whichever run finishes first', async () => {
    startGpsPass.mockImplementationOnce(started(1)).mockImplementationOnce(started(2));
    const results = new Map<number, ReturnType<typeof resultFor>>([
      [1, resultFor(['a1'])],
      [2, resultFor(['b1', 'b2'])],
    ]);
    takeFetchAndStoreResult.mockImplementation((run?: number) =>
      run === undefined ? null : (results.get(run) ?? null)
    );
    const { result } = await renderHook(() => useGpsDataFetcher());

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
    startGpsPass.mockImplementation(started(1));
    takeFetchAndStoreResult.mockImplementation((run?: number) =>
      run === 99 ? resultFor(['foreign']) : null
    );
    const { result } = await renderHook(() => useGpsDataFetcher());

    const outcome = await result.current.fetchApiGps([activity('a1')], deps());

    expect(outcome.syncedIds).toEqual([]);
  });

  it('writes no metrics row from TypeScript and still refreshes the lists', async () => {
    startGpsPass.mockImplementation(started(1));
    takeFetchAndStoreResult.mockImplementation((run?: number) =>
      run === 1 ? resultFor(['a1']) : null
    );
    const { result } = await renderHook(() => useGpsDataFetcher());

    await result.current.fetchApiGps([activity('a1')], deps());

    expect(engine.triggerRefresh).toHaveBeenCalledWith('activities');
    expect(engine.triggerRefresh).toHaveBeenCalledWith('groups');
  });

  it.each([
    ['one is already running', 2],
    ['the network is gone', 8],
  ])(
    'ends idle and reads no result when the engine keeps the pass owed because %s',
    async (_why, outcome) => {
      startGpsPass.mockImplementation(() => ({ outcome, run: 0, total: 0 }));
      const progress = deps();
      const { result } = await renderHook(() => useGpsDataFetcher());

      const ended = await result.current.fetchApiGps([activity('a1')], progress);

      expect(ended.syncedIds).toEqual([]);
      expect(takeFetchAndStoreResult).not.toHaveBeenCalled();
      expect(progress.updateProgress).toHaveBeenLastCalledWith(
        expect.objectContaining({ status: 'idle' })
      );
    }
  );

  it('hands the engine the range and the candidates in the order to fetch them', async () => {
    startGpsPass.mockImplementation(started(1));
    takeFetchAndStoreResult.mockImplementation(() => resultFor(['b1', 'a1']));
    const { result } = await renderHook(() => useGpsDataFetcher());

    await result.current.fetchApiGps([activity('b1'), activity('a1')], deps());

    const { oldest, newest } = useSyncDateRange.getState();
    expect(startGpsPass).toHaveBeenCalledWith(oldest, newest, ['b1', 'a1']);
  });
});

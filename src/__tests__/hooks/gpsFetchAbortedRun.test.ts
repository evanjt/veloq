/**
 * Scenario: a sync reset aborts a GPS fetch while it is still running, and a
 * newer sync starts in its place. The fetcher outlives the abort: the hook
 * that runs it stays mounted, so the mount check alone still passes.
 *
 * Expected behaviour: once its signal is aborted the run writes no progress
 * at all. A stale `complete` fires the completion side effects while the new
 * run is still downloading, and a stale `error`, `idle` or `computing`
 * replaces the new run's `fetching`.
 */
import { renderHook } from '@testing-library/react-native';

import type { SyncProgress } from '@/features/routes/hooks/useRouteSyncProgress';
import { useGpsDataFetcher } from '@/features/routes/hooks/useGpsDataFetcher';

type AbortPoint = 'download' | 'detection' | 'store' | 'never';

let mockAbortAt: AbortPoint = 'never';
let mockController = new AbortController();
let mockDownloadResult: unknown = null;

const mockAbortIf = (point: AbortPoint) => {
  if (mockAbortAt === point) mockController.abort();
};

const mockTake = jest.fn(() => mockDownloadResult);
const mockAddActivities = jest.fn(async () => mockAbortIf('store'));

jest.mock('veloqrs', () =>
  require('../__shared__/veloqrsStub').withOverrides({
    engine: {
      startFetchAndStore: jest.fn(() => 1),
      takeFetchAndStoreResult: () => mockTake(),
      cancelFetchAndStore: jest.fn(),
      getFetchRunProgress: jest.fn(() => null),
      triggerRefresh: jest.fn(),
      setTimeStreams: jest.fn(),
      getStats: () => ({ sectionsDirty: false }),
    },
  })
);

jest.mock('@/shared/native/engine', () => ({
  getNativeModule: () => ({
    engine: {
      addActivities: (...args: unknown[]) => mockAddActivities(...(args as [])),
      getSectionDetectionProgress: () => ({ percent: 0 }),
    },
  }),
  getEngine: () => null,
}));

jest.mock('@/features/routes/lib/gpsDownloadPoll', () => ({
  abandonDownload: jest.fn(),
  pollDownloadProgress: jest.fn(async () => {
    mockAbortIf('download');
    return 'settled';
  }),
  runProgressReader: jest.fn(() => () => undefined),
}));

jest.mock('@/features/routes/lib/detectionRun', () => ({
  DETECTION_FOREGROUND_MS: 1000,
  followDetection: jest.fn(() => {
    mockAbortIf('detection');
    return { settled: Promise.resolve(mockController.signal.aborted ? 'abandoned' : 'complete') };
  }),
}));

// A pass that is running reports itself, so the tile wait has a write to make.
jest.mock('@/features/routes/lib/tilePass', () => ({
  ...jest.requireActual('@/features/routes/lib/tilePass'),
  awaitTilePass: jest.fn(async (onStarted?: (processed: number, total: number) => void) => {
    onStarted?.(1, 10);
  }),
}));

jest.mock('@/features/routes/lib/timeStreamBackfill', () => ({
  backfillTimeStreams: jest.fn(async () => ({ total: 0, remaining: 0 })),
  timeStreamsProgress: jest.fn(),
}));

jest.mock('@/features/routes/lib/trackFetchNotice', () => ({
  reportTrackFetchRun: jest.fn(),
}));

jest.mock('@/features/routes/stores/RouteSettingsStore', () => ({
  isRouteMatchingEnabled: () => true,
}));

jest.mock('@/data/demo/fixtures', () => ({
  getActivityMap: () => ({
    latlngs: [
      [46.5, 6.6],
      [46.51, 6.61],
      [46.52, 6.62],
      [46.53, 6.63],
    ],
  }),
  getActivityStreams: () => null,
}));

const activity = (id: string) => ({ activityId: id, sportType: 'Ride' });

const stored = {
  syncedIds: ['a1', 'a2'],
  failedIds: [],
  successCount: 2,
  total: 2,
};

async function run(mode: 'api' | 'demo', point: AbortPoint) {
  mockAbortAt = point;
  mockController = new AbortController();
  const afterAbort: SyncProgress['status'][] = [];
  const all: SyncProgress['status'][] = [];
  const { result } = await renderHook(() => useGpsDataFetcher());
  const fetch = mode === 'api' ? result.current.fetchApiGps : result.current.fetchDemoGps;

  const outcome = await fetch([activity('a1'), activity('a2')], {
    isMountedRef: { current: true },
    abortSignal: mockController.signal,
    updateProgress: (next) => {
      const status = (next as SyncProgress).status;
      all.push(status);
      if (mockController.signal.aborted) afterAbort.push(status);
    },
  });

  return { afterAbort, all, outcome };
}

beforeEach(() => {
  mockDownloadResult = null;
});

describe('an API GPS fetch aborted by a newer sync', () => {
  it('writes nothing when the download it was waiting on returns no result', async () => {
    mockDownloadResult = null;

    const { afterAbort, outcome } = await run('api', 'download');

    expect(afterAbort).toEqual([]);
    expect(outcome.syncedIds).toEqual([]);
  });

  it('writes nothing when the download it was waiting on stored a batch', async () => {
    mockDownloadResult = stored;

    const { afterAbort, outcome } = await run('api', 'download');

    expect(afterAbort).toEqual([]);
    expect(outcome.syncedIds).toEqual([]);
  });

  it('writes no tile wait and no completion once the abort lands during detection', async () => {
    mockDownloadResult = stored;

    const { afterAbort, all } = await run('api', 'detection');

    expect(all).toContain('computing');
    expect(afterAbort).toEqual([]);
  });

  it('still ends on complete when nothing aborts it', async () => {
    mockDownloadResult = stored;

    const { afterAbort, all } = await run('api', 'never');

    expect(afterAbort).toEqual([]);
    expect(all[all.length - 1]).toBe('complete');
  });
});

describe('a demo GPS fetch aborted by a newer sync', () => {
  it('writes no tile wait and no completion once the abort lands during detection', async () => {
    const { afterAbort, all } = await run('demo', 'detection');

    expect(all).toContain('fetching');
    expect(afterAbort).toEqual([]);
  });

  it('writes nothing once the abort lands while the tracks are being stored', async () => {
    const { afterAbort } = await run('demo', 'store');

    expect(afterAbort).toEqual([]);
  });

  it('still ends on complete when nothing aborts it', async () => {
    const { afterAbort, all } = await run('demo', 'never');

    expect(afterAbort).toEqual([]);
    expect(all[all.length - 1]).toBe('complete');
  });
});

/**
 * Scenario: the notice reported every track a run left over, which is catch-up
 * as often as a give-up, and the athlete saw a fault beside a progress bar.
 * Its dismissal lived in memory, so one walk with no
 * usable track brought "1 route didn't download" back on every launch, and a
 * different failure with the same count was read as the same one.
 *
 * Expected behaviour: a closed notice stays closed for the same set of
 * failures across launches, opens again for a different set, and comes down
 * when a run lands everything.
 */

import { renderHook } from '@testing-library/react-native';

import { useGpsDataFetcher } from '@/features/routes/hooks/useGpsDataFetcher';
import {
  DISMISSED_KEY,
  loadTrackFetchNotice,
  refreshTrackFetchNotice,
  useTrackFetchNotice,
} from '@/features/routes/lib/trackFetchNotice';

let mockGivenUp: string[] = [];
const mockSettings = new Map<string, string>();
jest.mock('@/shared/storage', () => ({
  getSetting: jest.fn(async (key: string) => mockSettings.get(key) ?? null),
  setSetting: jest.fn(async (key: string, value: string) => {
    mockSettings.set(key, value);
  }),
}));

jest.mock('@/shared/native/engine', () => ({
  getNativeModule: () => ({
    engine: {
      addActivities: async () => undefined,
      getSectionDetectionProgress: () => ({ percent: 0 }),
    },
  }),
}));

/** The engine's list becomes `ids` and the notice reads it. */
function engineGivesUp(ids: string[]) {
  mockGivenUp = ids;
  refreshTrackFetchNotice();
}

let mockRunResult: unknown = null;

jest.mock('veloqrs', () =>
  require('../__shared__/veloqrsStub').withOverrides({
    activities: {
      getGivenUpTracks: () => ({
        tracks: mockGivenUp.map((activityId: string) => ({
          activityId,
          name: '',
          startDateLocal: '',
        })),
      }),
    },
    engine: {
      startGpsPass: jest.fn((_oldest: string, _newest: string, head: string[]) => ({
        outcome: 1,
        run: 1,
        total: head.length,
      })),
      takeFetchAndStoreResult: () => mockRunResult,
      cancelFetchAndStore: jest.fn(),
      getFetchRunProgress: jest.fn(() => null),
      triggerRefresh: jest.fn(),
      setTimeStreams: jest.fn(),
      getStats: () => ({ sectionsDirty: false }),
    },
  })
);

jest.mock('@/features/routes/lib/gpsDownloadPoll', () => ({
  abandonDownload: jest.fn(),
  pollDownloadProgress: jest.fn(async () => 'settled'),
  runProgressReader: jest.fn(() => () => undefined),
}));

jest.mock('@/features/routes/lib/detectionRun', () => ({
  DETECTION_FOREGROUND_MS: 1000,
  followDetection: jest.fn(() => ({ settled: Promise.resolve('complete') })),
}));

jest.mock('@/features/routes/lib/tilePass', () => ({
  ...jest.requireActual('@/features/routes/lib/tilePass'),
  awaitTilePass: jest.fn(async () => undefined),
}));

jest.mock('@/features/routes/lib/timeStreamBackfill', () => ({
  backfillTimeStreams: jest.fn(async () => ({ total: 0, remaining: 0 })),
  timeStreamsProgress: jest.fn(),
}));

jest.mock('@/features/routes/stores/RouteSettingsStore', () => ({
  isRouteMatchingEnabled: () => true,
}));

const flush = () => new Promise((resolve) => setImmediate(resolve));

function fresh() {
  useTrackFetchNotice.setState({
    failedIds: [],
    failedCount: 0,
    dismissed: false,
    dismissedKey: null,
  });
}

describe('the notice', () => {
  beforeEach(() => {
    mockGivenUp = [];
    mockSettings.clear();
    fresh();
  });

  vaultIt('stands after a run that left tracks behind', () => {
    engineGivesUp(['a', 'b']);

    expect(useTrackFetchNotice.getState()).toMatchObject({ failedCount: 2, dismissed: false });
  });

  vaultIt('comes down when the next run lands them', () => {
    engineGivesUp(['a']);
    engineGivesUp([]);

    expect(useTrackFetchNotice.getState().failedCount).toBe(0);
  });

  it('comes back for a different set of failures after it was dismissed', () => {
    engineGivesUp(['a']);
    useTrackFetchNotice.getState().dismiss();
    engineGivesUp(['b']);

    expect(useTrackFetchNotice.getState()).toMatchObject({ failedCount: 1, dismissed: false });
  });

  it('stays closed when the next run fails on the same set, in any order', () => {
    engineGivesUp(['b', 'a']);
    useTrackFetchNotice.getState().dismiss();
    engineGivesUp(['a', 'b']);

    expect(useTrackFetchNotice.getState()).toMatchObject({ failedCount: 2, dismissed: true });
  });

  vaultIt('stays closed through a clean run and the same failure again', () => {
    engineGivesUp(['a']);
    useTrackFetchNotice.getState().dismiss();
    engineGivesUp([]);
    engineGivesUp(['a']);

    expect(useTrackFetchNotice.getState().dismissed).toBe(true);
  });

  vaultIt('stays closed when only some of the dismissed set still fails', () => {
    engineGivesUp(['a', 'b']);
    useTrackFetchNotice.getState().dismiss();
    engineGivesUp(['b']);

    expect(useTrackFetchNotice.getState().dismissed).toBe(true);
  });

  vaultIt('reopens when a new id joins the dismissed set', () => {
    engineGivesUp(['a']);
    useTrackFetchNotice.getState().dismiss();
    engineGivesUp(['a', 'b']);

    expect(useTrackFetchNotice.getState().dismissed).toBe(false);
  });

  it('remembers the dismissal across a relaunch', async () => {
    engineGivesUp(['walk']);
    useTrackFetchNotice.getState().dismiss();
    await flush();
    expect(mockSettings.get(DISMISSED_KEY)).toBe('walk');

    fresh();
    await loadTrackFetchNotice();
    engineGivesUp(['walk']);

    expect(useTrackFetchNotice.getState().dismissed).toBe(true);
  });

  vaultIt('applies a dismissal that loads after the run reported', async () => {
    mockSettings.set(DISMISSED_KEY, 'walk');
    engineGivesUp(['walk']);
    expect(useTrackFetchNotice.getState().dismissed).toBe(false);

    await loadTrackFetchNotice();

    expect(useTrackFetchNotice.getState().dismissed).toBe(true);
  });

  it('reads the engine list when it loads', async () => {
    mockGivenUp = ['a', 'b'];

    await loadTrackFetchNotice();

    expect(useTrackFetchNotice.getState()).toMatchObject({ failedCount: 2, dismissed: false });
  });

  it('shows nothing when the engine gave up on none', async () => {
    await loadTrackFetchNotice();

    expect(useTrackFetchNotice.getState().failedCount).toBe(0);
  });

  it('is not fed by a run that ends with tracks left over', async () => {
    mockRunResult = { syncedIds: [], failedIds: ['a', 'b', 'c'], successCount: 0, total: 3 };
    const { result } = await renderHook(() => useGpsDataFetcher());

    await result.current.fetchApiGps(
      [
        { activityId: 'a', sportType: 'Ride' },
        { activityId: 'b', sportType: 'Ride' },
        { activityId: 'c', sportType: 'Ride' },
      ] as never,
      {
        isMountedRef: { current: true },
        abortSignal: new AbortController().signal,
        updateProgress: () => undefined,
      }
    );

    expect(useTrackFetchNotice.getState().failedCount).toBe(0);
  });
});

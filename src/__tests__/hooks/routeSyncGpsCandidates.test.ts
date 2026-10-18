/**
 * Scenario: the tracks a sync owes used to be found by parsing every stored
 * activity body for a `latlng` stream type, minus the ids the device held and
 * the ones it had refused. The engine now answers from the census.
 *
 * Expected behaviour: a live run hands the engine's candidates, for the range
 * the athlete selected, to the download and publishes their ids as pending,
 * without reading a feed card. Demo mode pulls no census, so its fixtures'
 * cards decide.
 */
import { act, renderHook } from '@testing-library/react-native';
import { stubIdleScheduler, type IdleScheduler } from '../__shared__/idleScheduler';
import { feedCard } from '../__shared__/feedCard';

import { useRouteDataSync } from '@/features/routes/hooks/useRouteDataSync';
import { resetGlobalSyncState } from '@/features/routes/hooks/useRouteSyncContext';
import { getEngine, getNativeModule } from '@/shared/native/engine';
import { useAuthStore } from '@/shared/app/AuthStore';
import { useSyncDateRange } from '@/shared/app/SyncDateRangeStore';
import { setFeedHeadIds } from '@/shared/activity/feedHead';
import type { FeedCard } from '@/types';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('@/shared/native/engine', () => ({
  getNativeModule: jest.fn(),
  getEngine: jest.fn(() => undefined),
}));
jest.mock('@/shared/app/NetworkContext', () => ({
  useNetwork: () => ({ isOnline: true }),
  useIsOnline: () => true,
}));
const mockFetchApiGps = jest.fn(async (..._args: unknown[]) => undefined);
const mockFetchDemoGps = jest.fn(async (..._args: unknown[]) => undefined);
jest.mock('@/features/routes/hooks/useGpsDataFetcher', () => ({
  useGpsDataFetcher: () => ({ fetchDemoGps: mockFetchDemoGps, fetchApiGps: mockFetchApiGps }),
}));

const pendingSeen: string[][] = [];
const mockGetFeedCards = jest.fn((_oldest: number, _newest: number): FeedCard[] => []);
const mockGetGpsFetchCandidates = jest.fn();

let idle: IdleScheduler;

describe('the tracks a route sync owes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetGlobalSyncState();
    pendingSeen.length = 0;
    setFeedHeadIds([]);
    idle = stubIdleScheduler('immediate');
    useAuthStore.setState({ isAuthenticated: true, isDemoMode: false });
    useSyncDateRange.setState({ oldest: '2026-01-01', newest: '2026-03-31' });
    const setPending = useSyncDateRange.getState().setGpsSyncPendingIds;
    useSyncDateRange.setState({
      setGpsSyncPendingIds: (ids: readonly string[]) => {
        pendingSeen.push([...ids]);
        setPending(ids);
      },
    });
    (getEngine as jest.Mock).mockReturnValue({
      getFeedCards: mockGetFeedCards,
      subscribe: () => () => {},
    });
    mockGetGpsFetchCandidates.mockReturnValue([
      { activityId: 'ride', sportType: 'Ride', startDate: 1_773_642_600 },
      { activityId: 'run', sportType: 'Run' },
    ]);
    (getNativeModule as jest.Mock).mockReturnValue({
      engine: {
        getActivityIds: () => ['stored'],
        getActivityCount: () => 1,
        getStats: () => ({ libraryCount: 3 }),
        getGpsFetchCandidates: mockGetGpsFetchCandidates,
        getUnprocessedStrengthIds: () => [],
        batchFetchOwedFitFiles: () => 0,
        pollSectionDetection: () => 'idle',
        getSectionDetectionProgress: () => null,
        subscribe: () => () => {},
      },
    });
  });

  afterEach(() => {
    idle.restore();
    jest.restoreAllMocks();
  });

  it('hands the engine candidates for the selected range to the download and the pending ids', async () => {
    await renderHook(() => useRouteDataSync(true));
    await act(async () => {});

    expect(mockGetGpsFetchCandidates).toHaveBeenCalledWith('2026-01-01', '2026-03-31');
    expect(mockFetchApiGps.mock.calls[0]?.[0]).toEqual([
      { activityId: 'ride', sportType: 'Ride', startDate: 1_773_642_600 },
      { activityId: 'run', sportType: 'Run' },
    ]);
    expect(pendingSeen[0]).toEqual(['ride', 'run']);
    expect(mockFetchDemoGps).not.toHaveBeenCalled();
    expect(mockGetFeedCards).not.toHaveBeenCalled();
  });

  it('puts the cards the feed is showing first', async () => {
    setFeedHeadIds(['run']);
    await renderHook(() => useRouteDataSync(true));
    await act(async () => {});

    expect(pendingSeen[0]).toEqual(['run', 'ride']);
  });

  it('fetches nothing when the engine owes no track', async () => {
    mockGetGpsFetchCandidates.mockReturnValue([]);
    await renderHook(() => useRouteDataSync(true));
    await act(async () => {});

    expect(mockFetchApiGps).not.toHaveBeenCalled();
    expect(pendingSeen[0]).toEqual([]);
  });

  it('asks the fixtures, not the engine, in demo mode', async () => {
    useAuthStore.setState({ isAuthenticated: true, isDemoMode: true });
    mockGetFeedCards.mockReturnValue([
      feedCard({ id: 'stored', hasGps: true, sportType: 'Ride' }),
      feedCard({
        id: 'fresh',
        hasGps: true,
        sportType: 'Run',
        startDateLocal: '2026-03-16T06:30:00',
      }),
      feedCard({ id: 'pool', hasGps: false, sportType: 'Swim' }),
    ]);

    await renderHook(() => useRouteDataSync(true));
    await act(async () => {});

    expect(mockGetGpsFetchCandidates).not.toHaveBeenCalled();
    const handed = mockFetchDemoGps.mock.calls[0]?.[0] as { activityId: string }[];
    expect(handed.map((c) => c.activityId)).toEqual(['fresh']);
    expect(mockFetchApiGps).not.toHaveBeenCalled();
  });
});

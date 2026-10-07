/**
 * Scenario: an activity whose track the engine refused for good (too short, or
 * no points) still carries a `latlng` stream type, so it matched the filter for
 * "needs a track" on every sync and was published as pending.
 *
 * Expected behaviour: a refused id is absent from the activities handed to the
 * fetch and from the pending ids, while an unrefused one stays in both.
 */
import { act, renderHook } from '@testing-library/react-native';
import { stubIdleScheduler, type IdleScheduler } from '../__shared__/idleScheduler';

import { useRouteDataSync } from '@/features/routes/hooks/useRouteDataSync';
import { resetGlobalSyncState } from '@/features/routes/hooks/useRouteSyncContext';
import { getNativeModule } from '@/shared/native/engine';
import { useAuthStore } from '@/shared/app/AuthStore';
import { useSyncDateRange } from '@/shared/app/SyncDateRangeStore';
import type { Activity } from '@/types';

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
jest.mock('@/features/routes/hooks/useGpsDataFetcher', () => ({
  useGpsDataFetcher: () => ({ fetchDemoGps: jest.fn(), fetchApiGps: mockFetchApiGps }),
}));

const pendingSeen: string[][] = [];

let idle: IdleScheduler;

describe('the route sync with a refused track', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetGlobalSyncState();
    pendingSeen.length = 0;
    idle = stubIdleScheduler('immediate');
    useAuthStore.setState({ isAuthenticated: true, isDemoMode: false });
    const setPending = useSyncDateRange.getState().setGpsSyncPendingIds;
    useSyncDateRange.setState({
      setGpsSyncPendingIds: (ids: readonly string[]) => {
        pendingSeen.push([...ids]);
        setPending(ids);
      },
    });
    (getNativeModule as jest.Mock).mockReturnValue({
      engine: {
        getActivityIds: () => [],
        getRefusedTrackIds: () => ['walk'],
        getUnprocessedStrengthIds: () => [],
        batchFetchExerciseSets: () => 0,
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

  const activities = [
    { id: 'walk', stream_types: ['latlng'] },
    { id: 'ride', stream_types: ['latlng'] },
  ] as unknown as Activity[];

  it('leaves a refused id out of the fetch and the pending ids', async () => {
    renderHook(() => useRouteDataSync(activities, true));
    await act(async () => {});

    const fetched = (mockFetchApiGps.mock.calls[0]?.[0] as Activity[]).map((a) => a.id);
    expect(fetched).toEqual(['ride']);
    expect(pendingSeen[0]).toEqual(['ride']);
  });
});

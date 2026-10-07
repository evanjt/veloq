/**
 * Scenario: the engine now announces its activity steps, so the activities
 * array changes twice during one sync, once when the head window's rows land
 * and once at the settle. The second change arrives while the head's tracks
 * are still downloading.
 *
 * Expected behaviour: the run refused for the one in flight is owed a turn and
 * takes it when that run ends. Before this the effect keyed on an array
 * identity nothing brings back, so the remainder's tracks were never fetched
 * in that session.
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
const mockFetchApiGps = jest.fn();
jest.mock('@/features/routes/hooks/useGpsDataFetcher', () => ({
  useGpsDataFetcher: () => ({
    fetchDemoGps: jest.fn(),
    fetchApiGps: mockFetchApiGps,
  }),
}));

const mockGetNativeModule = getNativeModule as jest.MockedFunction<typeof getNativeModule>;

function activity(id: string): Activity {
  return { id, stream_types: ['latlng'] } as unknown as Activity;
}

/** A promise plus the handle that settles it, so a run can be held open. */
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve = () => {};
  const promise = new Promise<void>((done) => {
    resolve = () => done();
  });
  return { promise, resolve };
}

let idle: IdleScheduler;

describe('a run refused while another is in flight', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetGlobalSyncState();
    // The run has to start inside the act() that triggers it. The queue the
    // real manager keeps is not what this test is about.
    idle = stubIdleScheduler('immediate');
    useAuthStore.setState({ isAuthenticated: true, isDemoMode: false });
    mockGetNativeModule.mockReturnValue({
      engine: {
        getActivityIds: () => [],
        getRefusedTrackIds: () => [],
        getUnprocessedStrengthIds: () => [],
        batchFetchExerciseSets: () => 0,
        pollSectionDetection: () => 'idle',
        subscribe: () => () => {},
      },
    } as unknown as ReturnType<typeof getNativeModule>);
  });

  afterEach(() => {
    idle.restore();
    jest.restoreAllMocks();
  });

  it('takes its turn when that run ends', async () => {
    const first = deferred();
    const second = deferred();
    mockFetchApiGps.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);

    const head = [activity('a1')];
    const { rerender } = renderHook(
      ({ activities }: { activities: Activity[] }) => useRouteDataSync(activities, true),
      { initialProps: { activities: head } }
    );
    expect(mockFetchApiGps).toHaveBeenCalledTimes(1);

    // The settle's refresh, while the head's tracks are still downloading.
    await act(async () => {
      rerender({ activities: [...head, activity('a2')] });
    });
    expect(mockFetchApiGps).toHaveBeenCalledTimes(1);

    await act(async () => {
      first.resolve();
      await first.promise;
    });

    expect(mockFetchApiGps).toHaveBeenCalledTimes(2);
    const [secondRun] = mockFetchApiGps.mock.calls[1] as [Activity[]];
    expect(secondRun.map((a) => a.id)).toEqual(['a1', 'a2']);
  });

  it('drops the debt when the library is wiped under it', async () => {
    const first = deferred();
    mockFetchApiGps.mockReturnValueOnce(first.promise).mockReturnValueOnce(deferred().promise);

    const head = [activity('a1')];
    const { rerender } = renderHook(
      ({ activities }: { activities: Activity[] }) => useRouteDataSync(activities, true),
      { initialProps: { activities: head } }
    );
    await act(async () => {
      rerender({ activities: [...head, activity('a2')] });
    });

    // Clear and Sync empties SQLite and re-arms the sync itself, so the pass
    // that was owed is over a library that no longer exists.
    resetGlobalSyncState();
    await act(async () => {
      first.resolve();
      await first.promise;
    });

    expect(mockFetchApiGps).toHaveBeenCalledTimes(1);
  });

  it('starts nothing extra when no run was refused', async () => {
    const only = deferred();
    mockFetchApiGps.mockReturnValueOnce(only.promise);

    renderHook(() => useRouteDataSync([activity('a1')], true));
    expect(mockFetchApiGps).toHaveBeenCalledTimes(1);

    await act(async () => {
      only.resolve();
      await only.promise;
    });

    expect(mockFetchApiGps).toHaveBeenCalledTimes(1);
  });
});

describe('a sync with no native module', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetGlobalSyncState();
    useSyncDateRange.setState({ lastSyncTimestamp: null });
    useAuthStore.setState({ isAuthenticated: true, isDemoMode: false });
    mockGetNativeModule.mockReturnValue(null as unknown as ReturnType<typeof getNativeModule>);
  });

  it('ends in error and stamps no last sync', async () => {
    const { result } = renderHook(() => useRouteDataSync([activity('a1')], true));
    await act(async () => {
      await result.current.syncActivities([activity('a1')]);
    });

    expect(useSyncDateRange.getState().gpsSyncProgress.status).toBe('error');
    expect(useSyncDateRange.getState().lastSyncTimestamp).toBeNull();
    expect(mockFetchApiGps).not.toHaveBeenCalled();
  });
});

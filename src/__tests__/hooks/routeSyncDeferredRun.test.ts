/**
 * Scenario: the engine announces its activity steps, so `activities` fires
 * twice during one sync, once when the head window's rows land and once at the
 * settle. The second announcement arrives while the head's tracks are still
 * downloading.
 *
 * Expected behaviour: the run refused for the one in flight is owed a turn and
 * takes it when that run ends, since the announcement that asked for it is
 * already spent.
 */
import { act, renderHook } from '@testing-library/react-native';
import { stubIdleScheduler, type IdleScheduler } from '../__shared__/idleScheduler';

import { useRouteDataSync } from '@/features/routes/hooks/useRouteDataSync';
import { resetGlobalSyncState } from '@/features/routes/hooks/useRouteSyncContext';
import { getEngine, getNativeModule } from '@/shared/native/engine';
import { useAuthStore } from '@/shared/app/AuthStore';
import { useSyncDateRange } from '@/shared/app/SyncDateRangeStore';

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

/** The ids the engine says still owe a track; an announcement only triggers a run. */
let owed: string[] = [];

const listeners = new Set<() => void>();

function announceActivities() {
  listeners.forEach((listener) => listener());
}

const channels = {
  subscribe: (channel: string, listener: () => void) => {
    if (channel !== 'activities') return () => {};
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

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
    owed = ['a1'];
    listeners.clear();
    (getEngine as jest.Mock).mockReturnValue(channels);
    // The run has to start inside the act() that triggers it. The queue the
    // real manager keeps is not what this test is about.
    idle = stubIdleScheduler('immediate');
    useAuthStore.setState({ isAuthenticated: true, isDemoMode: false });
    mockGetNativeModule.mockReturnValue({
      engine: {
        getActivityCount: () => 0,
        getStats: () => ({ libraryCount: 1 }),
        getGpsFetchCandidates: () => owed.map((activityId) => ({ activityId, sportType: 'Ride' })),
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

    await renderHook(() => useRouteDataSync(true));
    expect(mockFetchApiGps).toHaveBeenCalledTimes(1);

    // The settle's announcement, while the head's tracks are still downloading.
    owed = ['a1', 'a2'];
    await act(async () => {
      announceActivities();
    });
    expect(mockFetchApiGps).toHaveBeenCalledTimes(1);

    await act(async () => {
      first.resolve();
      await first.promise;
    });

    expect(mockFetchApiGps).toHaveBeenCalledTimes(2);
    const [secondRun] = mockFetchApiGps.mock.calls[1] as [{ activityId: string }[]];
    expect(secondRun.map((c) => c.activityId)).toEqual(['a1', 'a2']);
  });

  it('drops the debt when the library is wiped under it', async () => {
    const first = deferred();
    mockFetchApiGps.mockReturnValueOnce(first.promise).mockReturnValueOnce(deferred().promise);

    await renderHook(() => useRouteDataSync(true));
    await act(async () => {
      announceActivities();
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

    await renderHook(() => useRouteDataSync(true));
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
    const { result } = await renderHook(() => useRouteDataSync(true));
    await act(async () => {
      await result.current.syncActivities();
    });

    expect(useSyncDateRange.getState().gpsSyncProgress.status).toBe('error');
    expect(useSyncDateRange.getState().lastSyncTimestamp).toBeNull();
    expect(mockFetchApiGps).not.toHaveBeenCalled();
  });
});

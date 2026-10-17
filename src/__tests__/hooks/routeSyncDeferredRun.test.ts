/**
 * Scenario: the engine announces its activity steps, so `activities` fires
 * twice during one sync, once when the head window's rows land and once at the
 * settle. The second announcement arrives while the head's tracks are still
 * downloading, and the sync refuses a second run.
 *
 * Expected behaviour: the refused pass is handed to the engine, which keeps it
 * owed and starts it when its running pass ends. The hook schedules no run of
 * its own when the first one ends.
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
const mockStartGpsPass = jest.fn(() => ({ outcome: 2, run: 0, total: 0 }));

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
        startGpsPass: mockStartGpsPass,
        subscribe: () => () => {},
      },
    } as unknown as ReturnType<typeof getNativeModule>);
  });

  afterEach(() => {
    idle.restore();
    jest.restoreAllMocks();
  });

  it('is handed to the engine, and the hook starts no run of its own after', async () => {
    const first = deferred();
    mockFetchApiGps.mockReturnValueOnce(first.promise).mockReturnValueOnce(deferred().promise);

    await renderHook(() => useRouteDataSync(true));
    expect(mockFetchApiGps).toHaveBeenCalledTimes(1);

    // The settle's announcement, while the head's tracks are still downloading.
    owed = ['a1', 'a2'];
    await act(async () => {
      announceActivities();
    });
    expect(mockFetchApiGps).toHaveBeenCalledTimes(1);
    const { oldest, newest } = useSyncDateRange.getState();
    expect(mockStartGpsPass).toHaveBeenCalledTimes(1);
    expect((mockStartGpsPass.mock.calls[0] as unknown[]).slice(0, 2)).toEqual([oldest, newest]);

    await act(async () => {
      first.resolve();
      await first.promise;
    });

    expect(mockFetchApiGps).toHaveBeenCalledTimes(1);
  });

  it('hands nothing to the engine when no run was refused', async () => {
    const only = deferred();
    mockFetchApiGps.mockReturnValueOnce(only.promise);

    await renderHook(() => useRouteDataSync(true));
    await act(async () => {
      only.resolve();
      await only.promise;
    });

    expect(mockFetchApiGps).toHaveBeenCalledTimes(1);
    expect(mockStartGpsPass).not.toHaveBeenCalled();
  });
});

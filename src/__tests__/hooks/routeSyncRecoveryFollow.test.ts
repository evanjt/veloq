/**
 * Scenario: a launch with no new GPS and a dirty section catalogue resumes a
 * detection run and follows it.
 *
 * Expected behaviour: the follow is given the shared foreground budget and a
 * progress callback, so the same run is judged the same way as when another
 * screen follows it, and the banner percent moves with the run.
 */
import { act, renderHook } from '@testing-library/react-native';
import { stubIdleScheduler, type IdleScheduler } from '../__shared__/idleScheduler';

import { useRouteDataSync } from '@/features/routes/hooks/useRouteDataSync';
import { resetGlobalSyncState } from '@/features/routes/hooks/useRouteSyncContext';
import { DETECTION_FOREGROUND_MS, followDetection } from '@/features/routes/lib/detectionRun';
import { getNativeModule } from '@/shared/native/engine';
import { useAuthStore } from '@/shared/app/AuthStore';
import type { Activity } from '@/types';

const mockSettle = {
  promise: Promise.resolve('timeout'),
  resolve: (_outcome: string) => {},
};
jest.mock('veloqrs', () =>
  require('../__shared__/veloqrsStub').withOverrides({
    engine: {
      getStats: () => ({ sectionsDirty: true }),
      triggerRefresh: jest.fn(),
    },
  })
);
jest.mock('@/shared/native/engine', () => ({
  getNativeModule: jest.fn(),
  getEngine: jest.fn(() => undefined),
}));
jest.mock('@/shared/app/NetworkContext', () => ({
  useNetwork: () => ({ isOnline: true }),
  useIsOnline: () => true,
}));
jest.mock('@/features/routes/hooks/useGpsDataFetcher', () => ({
  useGpsDataFetcher: () => ({ fetchDemoGps: jest.fn(), fetchApiGps: jest.fn() }),
}));
jest.mock('@/features/routes/lib/tilePass', () => ({
  waitForTilePass: jest.fn(async () => undefined),
  awaitTilePass: jest.fn(async () => undefined),
}));
jest.mock('@/features/routes/lib/timeStreamBackfill', () => ({
  backfillTimeStreams: jest.fn(async () => ({ total: 0, remaining: 0 })),
  timeStreamsProgress: jest.fn(),
}));
jest.mock('@/features/routes/lib/detectionRun', () => ({
  ...jest.requireActual('@/features/routes/lib/detectionRun'),
  followDetection: jest.fn(() => ({ settled: mockSettle.promise, cancel: jest.fn() })),
}));

const activities = [{ id: 'a1', stream_types: [] }] as unknown as Activity[];

let idle: IdleScheduler;

describe('the route sync recovery follow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSettle.promise = new Promise((resolve) => {
      mockSettle.resolve = resolve;
    });
    resetGlobalSyncState();
    idle = stubIdleScheduler('immediate');
    useAuthStore.setState({ isAuthenticated: true, isDemoMode: false });
    (getNativeModule as jest.Mock).mockReturnValue({
      engine: {
        getActivityIds: () => [],
        getRefusedTrackIds: () => [],
        getUnprocessedStrengthIds: () => [],
        batchFetchExerciseSets: () => 0,
        pollSectionDetection: () => 'idle',
        getSectionDetectionProgress: () => ({ phase: 'analysing', percent: 40 }),
        subscribe: () => () => {},
      },
    });
  });

  afterEach(() => {
    idle.restore();
    jest.restoreAllMocks();
  });

  it('follows with the shared budget and moves the percent on a tick', async () => {
    const { result } = renderHook(() => useRouteDataSync(activities, true));
    await act(async () => {});

    const options = (followDetection as jest.Mock).mock.calls[0]?.[1];
    expect(options.timeoutMs).toBe(DETECTION_FOREGROUND_MS);
    expect(typeof options.onProgress).toBe('function');

    act(() => options.onProgress({ phase: 'analysing', percent: 40 }));
    expect(result.current.progress).toMatchObject({ status: 'computing', percent: 30 });
  });
});

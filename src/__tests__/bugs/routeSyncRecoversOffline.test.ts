/**
 * Scenario: an athlete whose app was killed mid-detection, or whose engine came
 * back dirty after a quarantine, opens the Routes tab with no network. The sync
 * returned on `!online` above work that needs no network at all, so the section
 * chips and the PR indicators could not come back until the network did.
 *
 * Expected behaviour: only the three network halves are gated on the network.
 * The local recovery runs either way.
 */
import { act, renderHook } from '@testing-library/react-native';
import { stubIdleScheduler, type IdleScheduler } from '../__shared__/idleScheduler';

import { routeSyncPlan } from '@/features/routes/lib/routeSyncPlan';
import { useRouteDataSync } from '@/features/routes/hooks/useRouteDataSync';
import { resetGlobalSyncState } from '@/features/routes/hooks/useRouteSyncContext';
import { getNativeModule } from '@/shared/native/engine';
import { useAuthStore } from '@/shared/app/AuthStore';
import type { Activity } from '@/types';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('@/shared/native/engine', () => ({
  getNativeModule: jest.fn(),
  getEngine: jest.fn(() => undefined),
}));
let mockOnline = true;
jest.mock('@/shared/app/NetworkContext', () => ({
  useNetwork: () => ({ isOnline: mockOnline }),
  useIsOnline: () => mockOnline,
}));
// One identity for every render: the hook's sync callback, and so its effect,
// keys on the fetchers.
const mockFetchApiGps = jest.fn(async () => undefined);
const mockFetchDemoGps = jest.fn(async () => undefined);
jest.mock('@/features/routes/hooks/useGpsDataFetcher', () => ({
  useGpsDataFetcher: () => ({ fetchDemoGps: mockFetchDemoGps, fetchApiGps: mockFetchApiGps }),
}));

const mockGetNativeModule = getNativeModule as jest.MockedFunction<typeof getNativeModule>;
const mockPollDetection = jest.fn(() => 'idle');
const mockStrengthIds = jest.fn(() => []);

describe('online, with work to fetch', () => {
  const plan = routeSyncPlan({ online: true, isDemo: false, newGpsCount: 12 });

  it('fetches and leaves the recovery to the pass that has nothing to fetch', () => {
    expect(plan).toEqual({
      fetchGps: true,
      fetchStrength: true,
      backfillStreams: true,
      recoverDetection: false,
    });
  });
});

describe('offline', () => {
  it('runs the local recovery and asks the network for nothing', () => {
    expect(routeSyncPlan({ online: false, isDemo: false, newGpsCount: 12 })).toEqual({
      fetchGps: false,
      fetchStrength: false,
      backfillStreams: false,
      recoverDetection: true,
    });
  });

  it('recovers the same way when there was nothing new to fetch anyway', () => {
    expect(routeSyncPlan({ online: false, isDemo: false, newGpsCount: 0 })).toEqual({
      fetchGps: false,
      fetchStrength: false,
      backfillStreams: false,
      recoverDetection: true,
    });
  });
});

describe('demo mode', () => {
  it('fetches its fixtures offline and asks intervals.icu for nothing', () => {
    expect(routeSyncPlan({ online: false, isDemo: true, newGpsCount: 3 })).toEqual({
      fetchGps: true,
      fetchStrength: false,
      backfillStreams: false,
      recoverDetection: false,
    });
  });

  it('recovers when the fixtures are already in the engine', () => {
    expect(routeSyncPlan({ online: true, isDemo: true, newGpsCount: 0 })).toEqual({
      fetchGps: false,
      fetchStrength: false,
      backfillStreams: false,
      recoverDetection: true,
    });
  });
});

describe('online with nothing new', () => {
  it('recovers, backfills and still asks for the strength files', () => {
    expect(routeSyncPlan({ online: true, isDemo: false, newGpsCount: 0 })).toEqual({
      fetchGps: false,
      fetchStrength: true,
      backfillStreams: true,
      recoverDetection: true,
    });
  });
});

let idle: IdleScheduler;

describe('the hook, offline with a new track', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetGlobalSyncState();
    mockOnline = false;
    // The run has to start inside the render that triggers it.
    idle = stubIdleScheduler('immediate');
    useAuthStore.setState({ isAuthenticated: true, isDemoMode: false });
    mockGetNativeModule.mockReturnValue({
      engine: {
        getActivityIds: () => [],
        getRefusedTrackIds: () => [],
        getUnprocessedStrengthIds: mockStrengthIds,
        batchFetchExerciseSets: () => 0,
        pollSectionDetection: mockPollDetection,
        getSectionDetectionProgress: () => null,
        subscribe: () => () => {},
      },
    } as unknown as ReturnType<typeof getNativeModule>);
  });

  afterEach(() => {
    idle.restore();
    jest.restoreAllMocks();
  });

  it('runs the local recovery and fetches nothing', async () => {
    // One array for every render: the hook syncs again on a new identity.
    const activities = [{ id: 'a1', stream_types: ['latlng'] } as unknown as Activity];
    renderHook(() => useRouteDataSync(activities, true));
    await act(async () => {});

    expect(mockPollDetection).toHaveBeenCalled();
    expect(mockFetchApiGps).not.toHaveBeenCalled();
    expect(mockFetchDemoGps).not.toHaveBeenCalled();
    expect(mockStrengthIds).not.toHaveBeenCalled();
  });
});

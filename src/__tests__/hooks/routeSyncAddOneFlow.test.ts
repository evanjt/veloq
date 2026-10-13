/**
 * Scenario: one new activity reaches the library with its track. The engine
 * stores it either through the sync's own download or on its own, while
 * pulling the activity's streams, and in the second case the sync finds no
 * track left to fetch.
 *
 * Expected behaviour: the add-one span starts when the engine announces the
 * stored track, whichever path stored it, and the frame that shows the
 * applied sections records one entry.
 */
import { act, renderHook } from '@testing-library/react-native';
import { stubIdleScheduler, type IdleScheduler } from '../__shared__/idleScheduler';

import { useRouteDataSync } from '@/features/routes/hooks/useRouteDataSync';
import { resetGlobalSyncState } from '@/features/routes/hooks/useRouteSyncContext';
import { getEngine, getNativeModule } from '@/shared/native/engine';
import { useAuthStore } from '@/shared/app/AuthStore';
import { useSyncDateRange } from '@/shared/app/SyncDateRangeStore';
import { setFeedHeadIds } from '@/shared/activity/feedHead';
import { FLOW_ADD_ONE, completeFlow } from '@/shared/debug/flowTiming';
import { clearFFIMetrics, getFFIMetrics, setAppMetricsEnabled } from '@/shared/debug/renderTimer';

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

type Listener = (payload?: unknown) => void;
const listeners = new Map<string, Set<Listener>>();

function subscribe(event: string, callback: Listener): () => void {
  const set = listeners.get(event) ?? new Set<Listener>();
  set.add(callback);
  listeners.set(event, set);
  return () => set.delete(callback);
}

function announceTrackStored(activityId: string): void {
  listeners.get('gpsTrackStored')?.forEach((cb) => cb({ activityId }));
}

function addOneEntries(): number[] {
  return getFFIMetrics()
    .filter((e) => e.name === FLOW_ADD_ONE)
    .map((e) => e.durationMs);
}

const mockGetGpsFetchCandidates = jest.fn();

let idle: IdleScheduler;

describe('the add-one span', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    listeners.clear();
    clearFFIMetrics();
    setAppMetricsEnabled(true);
    // A span left open by an earlier case would be completed here instead.
    completeFlow(FLOW_ADD_ONE);
    clearFFIMetrics();
    resetGlobalSyncState();
    setFeedHeadIds([]);
    idle = stubIdleScheduler('immediate');
    useAuthStore.setState({ isAuthenticated: true, isDemoMode: false });
    useSyncDateRange.setState({ oldest: '2026-01-01', newest: '2026-03-31' });
    // The engine stored the track before the sync looked, so nothing is owed.
    mockGetGpsFetchCandidates.mockReturnValue([]);
    (getEngine as jest.Mock).mockReturnValue({ getActivityBodies: () => [], subscribe });
    (getNativeModule as jest.Mock).mockReturnValue({
      engine: {
        getActivityIds: () => ['harbour-swim'],
        getActivityCount: () => 2,
        getStats: () => ({ libraryCount: 2 }),
        getGpsFetchCandidates: mockGetGpsFetchCandidates,
        getUnprocessedStrengthIds: () => [],
        batchFetchExerciseSets: () => 0,
        pollSectionDetection: () => 'idle',
        getSectionDetectionProgress: () => null,
        subscribe,
      },
    });
  });

  afterEach(() => {
    setAppMetricsEnabled(false);
    idle.restore();
    jest.restoreAllMocks();
  });

  it('records one entry for a track the engine stored outside the sync download', async () => {
    await renderHook(() => useRouteDataSync(true));
    await act(async () => {});

    announceTrackStored('ridge-climb');
    completeFlow(FLOW_ADD_ONE);

    expect(mockFetchApiGps).not.toHaveBeenCalled();
    expect(addOneEntries()).toHaveLength(1);
  });

  it('records nothing on a second frame after the one that completed the span', async () => {
    await renderHook(() => useRouteDataSync(true));
    await act(async () => {});

    announceTrackStored('ridge-climb');
    completeFlow(FLOW_ADD_ONE);
    completeFlow(FLOW_ADD_ONE);

    expect(addOneEntries()).toHaveLength(1);
  });

  it('records nothing for a frame with no stored track', async () => {
    await renderHook(() => useRouteDataSync(true));
    await act(async () => {});

    completeFlow(FLOW_ADD_ONE);

    expect(addOneEntries()).toEqual([]);
  });

  it('stops marking once the sync hook unmounts', async () => {
    const { unmount } = await renderHook(() => useRouteDataSync(true));
    await act(async () => {});
    await act(async () => unmount());

    announceTrackStored('ridge-climb');
    completeFlow(FLOW_ADD_ONE);

    expect(addOneEntries()).toEqual([]);
  });

  it('marks once for a track the sync download stored, with no second span', async () => {
    mockGetGpsFetchCandidates.mockReturnValue([{ activityId: 'ridge-climb', sportType: 'Ride' }]);
    mockFetchApiGps.mockImplementationOnce(async () => {
      announceTrackStored('ridge-climb');
      return undefined;
    });
    await renderHook(() => useRouteDataSync(true));
    await act(async () => {});

    expect(mockFetchApiGps).toHaveBeenCalledTimes(1);
    completeFlow(FLOW_ADD_ONE);
    completeFlow(FLOW_ADD_ONE);

    expect(addOneEntries()).toHaveLength(1);
  });
});

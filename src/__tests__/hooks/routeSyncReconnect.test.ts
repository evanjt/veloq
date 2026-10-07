/**
 * Scenario: the app starts a route sync offline, then the network returns.
 * The reconnect effect was keyed on a ref object, which runs once at mount and
 * never again.
 *
 * Expected behaviour: flipping the network from offline to online runs the
 * sync again, and a render that stays online does not.
 */
import { act, renderHook } from '@testing-library/react-native';
import { stubIdleScheduler, type IdleScheduler } from '../__shared__/idleScheduler';

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
let mockOnline = false;
jest.mock('@/shared/app/NetworkContext', () => ({
  useNetwork: () => ({ isOnline: mockOnline }),
  useIsOnline: () => mockOnline,
}));
const mockFetchApiGps = jest.fn(async () => undefined);
const mockFetchDemoGps = jest.fn(async () => undefined);
jest.mock('@/features/routes/hooks/useGpsDataFetcher', () => ({
  useGpsDataFetcher: () => ({ fetchDemoGps: mockFetchDemoGps, fetchApiGps: mockFetchApiGps }),
}));

const mockPollDetection = jest.fn(() => 'idle');

let idle: IdleScheduler;

describe('the route sync on reconnect', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetGlobalSyncState();
    mockOnline = false;
    idle = stubIdleScheduler('immediate');
    useAuthStore.setState({ isAuthenticated: true, isDemoMode: false });
    (getNativeModule as jest.Mock).mockReturnValue({
      engine: {
        getActivityIds: () => [],
        getRefusedTrackIds: () => [],
        getUnprocessedStrengthIds: () => [],
        batchFetchExerciseSets: () => 0,
        pollSectionDetection: mockPollDetection,
        getSectionDetectionProgress: () => null,
        subscribe: () => () => {},
      },
    });
  });

  afterEach(() => {
    idle.restore();
    jest.restoreAllMocks();
  });

  const activities = [{ id: 'a1', stream_types: ['latlng'] } as unknown as Activity];

  it('syncs again when the network comes back', async () => {
    const { rerender } = renderHook(() => useRouteDataSync(activities, true));
    await act(async () => {});
    expect(mockFetchApiGps).not.toHaveBeenCalled();

    mockOnline = true;
    rerender({});
    await act(async () => {});

    expect(mockFetchApiGps).toHaveBeenCalledTimes(1);
  });

  it('does not sync again on a render that stays offline', async () => {
    const { rerender } = renderHook(() => useRouteDataSync(activities, true));
    await act(async () => {});
    const before = mockPollDetection.mock.calls.length;

    rerender({});
    await act(async () => {});

    expect(mockPollDetection.mock.calls.length).toBe(before);
  });
});

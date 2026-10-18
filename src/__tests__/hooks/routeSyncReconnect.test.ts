/**
 * Scenario: the app starts a route sync offline with tracks still owed, then
 * the network returns.
 *
 * Expected behaviour: the offline pass hands the owed tracks to the engine,
 * which starts the download itself on the online edge. The hook starts
 * nothing when the network comes back.
 */
import { act, renderHook } from '@testing-library/react-native';
import { stubIdleScheduler, type IdleScheduler } from '../__shared__/idleScheduler';

import { useRouteDataSync } from '@/features/routes/hooks/useRouteDataSync';
import { resetGlobalSyncState } from '@/features/routes/hooks/useRouteSyncContext';
import { getNativeModule } from '@/shared/native/engine';
import { useAuthStore } from '@/shared/app/AuthStore';

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
const mockStartGpsPass = jest.fn(() => ({ outcome: 8, run: 0, total: 0 }));

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
        getActivityCount: () => 0,
        getStats: () => ({ libraryCount: 1 }),
        getGpsFetchCandidates: () => [{ activityId: 'a1', sportType: 'Ride' }],
        getUnprocessedStrengthIds: () => [],
        batchFetchOwedFitFiles: () => 0,
        pollSectionDetection: mockPollDetection,
        getSectionDetectionProgress: () => null,
        startGpsPass: mockStartGpsPass,
        subscribe: () => () => {},
      },
    });
  });

  afterEach(() => {
    idle.restore();
    jest.restoreAllMocks();
  });

  it('hands the tracks owed offline to the engine', async () => {
    await renderHook(() => useRouteDataSync(true));
    await act(async () => {});

    expect(mockFetchApiGps).not.toHaveBeenCalled();
    expect(mockStartGpsPass).toHaveBeenCalledTimes(1);
    expect((mockStartGpsPass.mock.calls[0] as unknown[])[2]).toEqual(['a1']);
  });

  it('starts nothing when the network comes back', async () => {
    const { rerender } = await renderHook(() => useRouteDataSync(true));
    await act(async () => {});
    const polls = mockPollDetection.mock.calls.length;
    const handed = mockStartGpsPass.mock.calls.length;

    mockOnline = true;
    await rerender({});
    await act(async () => {});

    expect(mockFetchApiGps).not.toHaveBeenCalled();
    expect(mockPollDetection.mock.calls.length).toBe(polls);
    expect(mockStartGpsPass.mock.calls.length).toBe(handed);
  });

  it('hands nothing to the engine when no track is owed', async () => {
    const { engine } = (getNativeModule as jest.Mock)();
    (getNativeModule as jest.Mock).mockReturnValue({
      engine: { ...engine, getGpsFetchCandidates: () => [] },
    });

    await renderHook(() => useRouteDataSync(true));
    await act(async () => {});

    expect(mockStartGpsPass).not.toHaveBeenCalled();
  });
});

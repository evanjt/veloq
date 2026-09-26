/**
 * Scenario: an `activities` event fires while a sync write still holds the
 * engine's write lock, and the Cache & Storage screen is open.
 *
 * Expected behaviour: the screen waits on that lock once, not twice.
 * `getStats` already carries the activity count beside the date range
 * (`persistence/mod.rs` `stats()`), so a separate `getActivityCount` is a
 * second wait for a number the first call brought back.
 */

import { act, renderHook, waitFor } from '@testing-library/react-native';

import { useActivityBoundsCache } from '@/features/activity/hooks/useActivityBoundsCache';

const mockEngine = {
  getStats: jest.fn(),
  getActivityCount: jest.fn(),
  subscribe: jest.fn((_event: string, _callback: () => void) => () => {}),
  initWithPath: jest.fn(() => true),
};

jest.mock('expo-file-system/legacy', () => ({
  copyAsync: jest.fn().mockResolvedValue(undefined),
  deleteAsync: jest.fn().mockResolvedValue(undefined),
  getInfoAsync: jest.fn().mockResolvedValue({ exists: true }),
}));

jest.mock('@/shared/native/engine', () => ({
  getEngine: () => mockEngine,
  getRouteDbPath: () => '/tmp/routes.db',
}));

jest.mock('@/shared/storage/gpsStorage', () => ({
  clearAllGpsTracks: jest.fn(async () => {}),
  clearBoundsCache: jest.fn(async () => {}),
}));

jest.mock('@/features/routes/stores/RouteSettingsStore', () => ({
  isHeatmapEnabled: () => false,
}));

jest.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ refetchQueries: jest.fn(async () => {}) }),
}));

jest.mock('@/shared/app/SyncDateRangeStore', () => ({
  useSyncDateRange: (selector: (s: unknown) => unknown) =>
    selector({ lastSyncTimestamp: null, expandRange: jest.fn() }),
}));

/** The subscriber the hook registered for the `activities` channel. */
function activitiesSubscriber(): () => void {
  const call = mockEngine.subscribe.mock.calls.find(([event]) => event === 'activities');
  if (!call) throw new Error('the hook never subscribed to activities');
  return call[1];
}

beforeEach(() => {
  jest.clearAllMocks();
  mockEngine.subscribe.mockReturnValue(() => {});
  mockEngine.initWithPath.mockReturnValue(true);
  mockEngine.getStats.mockReturnValue({
    activityCount: 490,
    oldestDate: 1_700_000_000n,
    newestDate: 1_760_000_000n,
  });
  mockEngine.getActivityCount.mockReturnValue(490);
});

describe('useActivityBoundsCache', () => {
  it('takes the write lock once at mount, not twice', async () => {
    renderHook(() => useActivityBoundsCache());

    await waitFor(() => expect(mockEngine.getStats).toHaveBeenCalled());
    expect(mockEngine.getActivityCount).not.toHaveBeenCalled();
  });

  it('takes it once more per activities event, not twice', async () => {
    const { result } = renderHook(() => useActivityBoundsCache());
    await waitFor(() => expect(mockEngine.getStats).toHaveBeenCalled());
    const notify = activitiesSubscriber();
    jest.clearAllMocks();

    mockEngine.getStats.mockReturnValue({
      activityCount: 491,
      oldestDate: 1_700_000_000n,
      newestDate: 1_760_000_000n,
    });
    act(() => notify());

    expect(mockEngine.getStats).toHaveBeenCalledTimes(1);
    expect(mockEngine.getActivityCount).not.toHaveBeenCalled();
    await waitFor(() => expect(result.current.cacheStats.totalActivities).toBe(491));
  });

  it('still takes the count from the stats it read', async () => {
    const { result } = renderHook(() => useActivityBoundsCache());

    await waitFor(() => expect(result.current.cacheStats.totalActivities).toBe(490));
  });
});

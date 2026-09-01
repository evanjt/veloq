/**
 * Scenario: the cache panel's activity count is read from the engine, and the
 * clear resets that display by hand.
 *
 * Expected behaviour: what the panel shows after a clear is what the engine
 * says, so a clear that half-failed shows what actually survived rather than a
 * zero the code asserted.
 */

import { act, renderHook, waitFor } from '@testing-library/react-native';

import { useActivityBoundsCache } from '@/features/activity/hooks/useActivityBoundsCache';

const mockEngine = {
  getStats: jest.fn(),
  getActivityCount: jest.fn(),
  subscribe: jest.fn(() => () => {}),
  destroyEngine: jest.fn(),
  initWithPath: jest.fn(() => true),
  enableHeatmapTiles: jest.fn(),
};

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

function setEngineCount(count: number) {
  mockEngine.getActivityCount.mockReturnValue(count);
  mockEngine.getStats.mockReturnValue({ activityCount: count, oldestDate: null, newestDate: null });
}

describe('the cache panel count after a clear', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockEngine.subscribe.mockReturnValue(() => {});
    mockEngine.initWithPath.mockReturnValue(true);
  });

  it('reports what the engine says once the clear has emptied it', async () => {
    setEngineCount(412);
    const { result } = renderHook(() => useActivityBoundsCache());
    await waitFor(() => expect(result.current.cacheStats.totalActivities).toBe(412));

    setEngineCount(0);
    await act(async () => {
      await result.current.clearCache();
    });

    await waitFor(() => expect(result.current.cacheStats.totalActivities).toBe(0));
  });

  it('never shows a zero the engine did not report', async () => {
    // The engine still holds everything: a re-init that reopened the same file
    // deletes nothing, which is exactly what the button does today. Every
    // rendered count is recorded, because a zero that is corrected on the next
    // render is still a zero the user saw.
    setEngineCount(412);
    const seen: number[] = [];
    const { result } = renderHook(() => {
      const hook = useActivityBoundsCache();
      seen.push(hook.cacheStats.totalActivities);
      return hook;
    });
    await waitFor(() => expect(result.current.cacheStats.totalActivities).toBe(412));

    const before = seen.length;
    await act(async () => {
      await result.current.clearCache();
    });
    await waitFor(() => expect(result.current.cacheStats.totalActivities).toBe(412));

    expect(seen.slice(before)).not.toContain(0);
  });
});

/**
 * Scenario: the athlete taps "clear cache", which until now closed the engine
 * and reopened the same file, deleting nothing from the database.
 * Expected behaviour: the derived catalogue and the re-fetchable activities go
 * through the engine's own clear, the athlete's own sections stay, a rollback
 * copy stands beside the database while it happens, and a re-cut is asked for
 * once it is done.
 */

import { act, renderHook } from '@testing-library/react-native';
import * as FileSystem from 'expo-file-system/legacy';

import { useActivityBoundsCache } from '@/features/activity/hooks/useActivityBoundsCache';

const mockEngine = {
  getStats: jest.fn(() => ({ activityCount: 0, oldestDate: null, newestDate: null })),
  getActivityCount: jest.fn(() => 0),
  subscribe: jest.fn(() => () => {}),
  destroyEngine: jest.fn(),
  initWithPath: jest.fn(() => true),
  enableHeatmapTiles: jest.fn(),
  startClearDerived: jest.fn(),
  pollClearDerived: jest.fn(() => ({
    state: 'complete',
    sectionsRemoved: 12,
    activitiesRemoved: 300,
    activitiesKept: 4,
  })),
  forceRedetectSections: jest.fn(() => true),
  startBackup: jest.fn(),
  pollBackup: jest.fn(() => 'complete'),
};

jest.mock('@/shared/native/engine', () => ({
  getEngine: () => mockEngine,
  getRouteDbPath: () => '/data/routes.db',
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

jest.mock('expo-file-system/legacy', () => ({
  copyAsync: jest.fn().mockResolvedValue(undefined),
  deleteAsync: jest.fn().mockResolvedValue(undefined),
  getInfoAsync: jest.fn().mockResolvedValue({ exists: true }),
}));

const mockCopyAsync = FileSystem.copyAsync as jest.Mock;
const mockDeleteAsync = FileSystem.deleteAsync as jest.Mock;

async function clear() {
  const { result } = renderHook(() => useActivityBoundsCache());
  await act(async () => {
    await result.current.clearCache();
  });
}

describe('clearing the cache', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockEngine.subscribe.mockReturnValue(() => {});
    mockEngine.initWithPath.mockReturnValue(true);
    mockEngine.pollBackup.mockReturnValue('complete');
    mockEngine.pollClearDerived.mockReturnValue({
      state: 'complete',
      sectionsRemoved: 12,
      activitiesRemoved: 300,
      activitiesKept: 4,
    });
  });

  it('empties the derived data through the engine rather than reopening the file', async () => {
    await clear();

    expect(mockEngine.startClearDerived).toHaveBeenCalledTimes(1);
    expect(mockEngine.destroyEngine).not.toHaveBeenCalled();
  });

  it('takes a rollback copy before the clear and drops it once it succeeds', async () => {
    await clear();

    expect(mockEngine.startBackup).toHaveBeenCalledWith('/data/routes.db.clear-bak');
    const backupOrder = mockEngine.startBackup.mock.invocationCallOrder[0];
    const clearOrder = mockEngine.startClearDerived.mock.invocationCallOrder[0];
    expect(backupOrder).toBeLessThan(clearOrder);
    expect(mockDeleteAsync).toHaveBeenCalledWith('file:///data/routes.db.clear-bak', {
      idempotent: true,
    });
  });

  it('puts the snapshot back when the clear throws', async () => {
    mockEngine.pollClearDerived.mockImplementation(() => {
      throw new Error('database is locked');
    });

    await expect(clear()).rejects.toThrow('database is locked');

    expect(mockCopyAsync).toHaveBeenCalledWith({
      from: 'file:///data/routes.db.clear-bak',
      to: 'file:///data/routes.db',
    });
    expect(mockEngine.initWithPath).toHaveBeenCalledWith('/data/routes.db');
  });

  it('asks for a re-cut once the clear has landed', async () => {
    await clear();

    expect(mockEngine.forceRedetectSections).toHaveBeenCalledTimes(1);
    expect(mockEngine.forceRedetectSections.mock.invocationCallOrder[0]).toBeGreaterThan(
      mockEngine.startClearDerived.mock.invocationCallOrder[0]
    );
  });

  it('never re-cuts over a database it could not clear', async () => {
    mockEngine.pollClearDerived.mockImplementation(() => {
      throw new Error('database is locked');
    });

    await expect(clear()).rejects.toThrow();

    expect(mockEngine.forceRedetectSections).not.toHaveBeenCalled();
  });

  it('clears nothing when the rollback copy cannot be taken', async () => {
    mockEngine.pollBackup.mockReturnValue('failed');

    await expect(clear()).rejects.toThrow();

    expect(mockEngine.startClearDerived).not.toHaveBeenCalled();
  });
});

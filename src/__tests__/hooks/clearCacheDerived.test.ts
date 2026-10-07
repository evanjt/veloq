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
import type { DerivedClearResult } from '@/shared/native/engineClears';

const mockEngine = {
  getStats: jest.fn(() => ({ activityCount: 0, oldestDate: null, newestDate: null })),
  getActivityCount: jest.fn(() => 0),
  subscribe: jest.fn(() => () => {}),
  destroyEngine: jest.fn(),
  initWithPath: jest.fn(() => true),
  enableHeatmapTiles: jest.fn(),
  runClearDerived: jest.fn(() =>
    Promise.resolve({ sectionsRemoved: 12, activitiesRemoved: 300, activitiesKept: 4 })
  ),
  forceRedetectSections: jest.fn(() => true),
  writeClearSnapshot: jest.fn(() => Promise.resolve()),
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
  ...jest.requireActual('@tanstack/react-query'),
  useQueryClient: () => ({ refetchQueries: jest.fn(async () => {}) }),
}));

jest.mock('@/shared/app/SyncDateRangeStore', () => ({
  useSyncDateRange: (selector: (s: unknown) => unknown) =>
    selector({ lastSyncTimestamp: null, expandRange: jest.fn() }),
}));

jest.mock('expo-file-system/legacy', () => ({
  ...jest.requireActual('expo-file-system/legacy'),
  copyAsync: jest.fn().mockResolvedValue(undefined),
  deleteAsync: jest.fn().mockResolvedValue(undefined),
  getInfoAsync: jest.fn().mockResolvedValue({ exists: true }),
}));

const mockCopyAsync = FileSystem.copyAsync as jest.Mock;
const mockDeleteAsync = FileSystem.deleteAsync as jest.Mock;

async function clear(): Promise<boolean> {
  const { result } = renderHook(() => useActivityBoundsCache());
  let cleared = false;
  await act(async () => {
    cleared = await result.current.clearCache();
  });
  return cleared;
}

describe('clearing the cache', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockEngine.subscribe.mockReturnValue(() => {});
    mockEngine.initWithPath.mockReturnValue(true);
    mockEngine.writeClearSnapshot.mockResolvedValue(undefined);
    mockEngine.runClearDerived.mockResolvedValue({
      sectionsRemoved: 12,
      activitiesRemoved: 300,
      activitiesKept: 4,
    });
  });

  it('empties the derived data through the engine rather than reopening the file', async () => {
    await clear();

    expect(mockEngine.runClearDerived).toHaveBeenCalledTimes(1);
    expect(mockEngine.destroyEngine).not.toHaveBeenCalled();
  });

  it('takes a rollback copy before the clear and drops it once it succeeds', async () => {
    await clear();

    expect(mockEngine.writeClearSnapshot).toHaveBeenCalledWith('/data/routes.db.clear-bak');
    const backupOrder = mockEngine.writeClearSnapshot.mock.invocationCallOrder[0];
    const clearOrder = mockEngine.runClearDerived.mock.invocationCallOrder[0];
    expect(backupOrder).toBeLessThan(clearOrder);
    expect(mockDeleteAsync).toHaveBeenCalledWith('file:///data/routes.db.clear-bak', {
      idempotent: true,
    });
  });

  it('puts the snapshot back when the clear throws', async () => {
    mockEngine.runClearDerived.mockRejectedValue(new Error('database is locked'));

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
      mockEngine.runClearDerived.mock.invocationCallOrder[0]
    );
  });

  it('never re-cuts over a database it could not clear', async () => {
    mockEngine.runClearDerived.mockRejectedValue(new Error('database is locked'));

    await expect(clear()).rejects.toThrow();

    expect(mockEngine.forceRedetectSections).not.toHaveBeenCalled();
  });

  /** Clear while the wipe outlives the 60 s wait, and hand back its settle hooks. */
  async function clearPastTheWait() {
    jest.useFakeTimers({ doNotFake: ['nextTick'] });
    let land: (removed: DerivedClearResult) => void = () => {};
    let fail: (error: Error) => void = () => {};
    mockEngine.runClearDerived.mockReturnValue(
      new Promise<DerivedClearResult>((resolve, reject) => {
        land = resolve;
        fail = reject;
      })
    );

    const { result } = renderHook(() => useActivityBoundsCache());
    let cleared: boolean | undefined;
    const running = act(async () => {
      cleared = await result.current.clearCache();
    });
    await act(async () => {
      await jest.advanceTimersByTimeAsync(70_000);
    });
    await running;
    jest.useRealTimers();
    return { cleared, land, fail };
  }

  it('says the wipe is still running when it outlives the wait', async () => {
    const { cleared } = await clearPastTheWait();

    expect(cleared).toBe(false);
    expect(mockEngine.forceRedetectSections).not.toHaveBeenCalled();
  });

  it('re-cuts once when a wipe that outlived the wait lands afterwards', async () => {
    const { land } = await clearPastTheWait();

    land({ sectionsRemoved: 12, activitiesRemoved: 300, activitiesKept: 4 });
    await act(async () => {
      await new Promise(process.nextTick);
    });

    expect(mockEngine.forceRedetectSections).toHaveBeenCalledTimes(1);
  });

  it('re-cuts nothing when a wipe that outlived the wait then fails', async () => {
    const { fail } = await clearPastTheWait();

    fail(new Error('database is locked'));
    await act(async () => {
      await new Promise(process.nextTick);
    });

    expect(mockEngine.forceRedetectSections).not.toHaveBeenCalled();
  });

  it('answers true when the wipe landed inside the wait', async () => {
    expect(await clear()).toBe(true);
  });

  it('clears nothing when the rollback copy cannot be taken', async () => {
    mockEngine.writeClearSnapshot.mockRejectedValue(new Error('Backup failed: disk full'));

    await expect(clear()).rejects.toThrow();

    expect(mockEngine.runClearDerived).not.toHaveBeenCalled();
  });
});

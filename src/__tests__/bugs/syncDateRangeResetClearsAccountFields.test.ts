/**
 * Scenario: sign out after a failed GPS pass, then sign in as another athlete.
 * Expected behaviour: reset() leaves no field of the previous account behind.
 */

import { useSyncDateRange } from '@/shared/app/SyncDateRangeStore';

describe('SyncDateRangeStore.reset', () => {
  afterEach(() => {
    useSyncDateRange.getState().clearUnlockTimeout();
  });

  it('clears the GPS progress, the syncing flag and the last sync time', () => {
    const store = useSyncDateRange.getState();
    store.setGpsSyncProgress({
      status: 'fetching',
      completed: 3,
      total: 10,
      percent: 30,
      message: 'Fetching GPS data',
    });
    store.setGpsSyncProgress({
      status: 'complete',
      completed: 10,
      total: 10,
      percent: 100,
      message: 'Done',
    });
    store.setGpsSyncProgress({
      status: 'error',
      completed: 3,
      total: 10,
      percent: 30,
      message: 'Network unavailable',
    });

    expect(useSyncDateRange.getState().lastSyncTimestamp).not.toBeNull();

    useSyncDateRange.getState().reset();

    const after = useSyncDateRange.getState();
    expect(after.gpsSyncProgress).toEqual({
      status: 'idle',
      completed: 0,
      total: 0,
      percent: 0,
      message: '',
    });
    expect(after.isGpsSyncing).toBe(false);
    expect(after.lastSyncTimestamp).toBeNull();
  });

  it('clears a terrain snapshot left rendering', () => {
    useSyncDateRange
      .getState()
      .setTerrainSnapshotProgress({ status: 'rendering', completed: 2, total: 7 });

    useSyncDateRange.getState().reset();

    expect(useSyncDateRange.getState().terrainSnapshotProgress).toEqual({
      status: 'idle',
      completed: 0,
      total: 0,
    });
  });

  it('leaves the syncing flag down when reset lands mid-fetch', () => {
    useSyncDateRange.getState().setGpsSyncProgress({
      status: 'processing',
      completed: 1,
      total: 4,
      percent: 25,
      message: 'Processing',
    });
    expect(useSyncDateRange.getState().isGpsSyncing).toBe(true);

    useSyncDateRange.getState().reset();

    expect(useSyncDateRange.getState().isGpsSyncing).toBe(false);
    expect(useSyncDateRange.getState().isExpansionLocked).toBe(true);
  });
});

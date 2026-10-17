/**
 * Scenario: sign out while a GPS pass was covering cards and a widened range
 * was downloading, then sign in as another athlete.
 * Expected behaviour: reset() leaves no field of the previous account behind.
 */

import { IDLE_EXTENDED_FETCH } from '@/shared/app/extendedFetch';
import { useSyncDateRange } from '@/shared/app/SyncDateRangeStore';

describe('SyncDateRangeStore.reset', () => {
  it('clears the pending tracks and the window download of the account that went', () => {
    const store = useSyncDateRange.getState();
    store.setGpsSyncPendingIds(['ride-a', 'ride-b']);
    store.windowAccepted();
    expect(useSyncDateRange.getState().gpsSyncPendingIds.size).toBe(2);

    useSyncDateRange.getState().reset();

    const after = useSyncDateRange.getState();
    expect(after.gpsSyncPendingIds.size).toBe(0);
    expect(after.extendedFetch).toEqual(IDLE_EXTENDED_FETCH);
    expect(after.isExpansionLocked).toBe(true);
  });
});

/**
 * Global store for sync date range.
 *
 * When the user extends the timeline slider past the default 90 days,
 * this store is updated and GlobalDataSync responds by fetching more data.
 */

import { create } from 'zustand';
import { formatLocalDate } from '@/lib';

interface SyncDateRangeState {
  /** Oldest date to sync (YYYY-MM-DD) */
  oldest: string;
  /** Newest date to sync (YYYY-MM-DD) */
  newest: string;
  /** Whether we're currently fetching extended data */
  isFetchingExtended: boolean;

  /** Update the sync date range - expands to include requested range */
  expandRange: (oldest: string, newest: string) => void;
  /** Reset to default 90 days */
  reset: () => void;
  /** Set fetching state */
  setFetchingExtended: (fetching: boolean) => void;
}

function getDefaultRange() {
  const today = new Date();
  const ninetyDaysAgo = new Date(today);
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
  return {
    oldest: formatLocalDate(ninetyDaysAgo),
    newest: formatLocalDate(today),
  };
}

export const useSyncDateRange = create<SyncDateRangeState>((set, get) => ({
  ...getDefaultRange(),
  isFetchingExtended: false,

  expandRange: (requestedOldest: string, requestedNewest: string) => {
    const current = get();

    // Expand range if requested dates are outside current range
    const newOldest = requestedOldest < current.oldest ? requestedOldest : current.oldest;
    const newNewest = requestedNewest > current.newest ? requestedNewest : current.newest;

    // Only update if range actually expanded
    if (newOldest !== current.oldest || newNewest !== current.newest) {
      set({ oldest: newOldest, newest: newNewest, isFetchingExtended: true });
    }
  },

  reset: () => {
    set({ ...getDefaultRange(), isFetchingExtended: false });
  },

  setFetchingExtended: (fetching: boolean) => {
    set({ isFetchingExtended: fetching });
  },
}));

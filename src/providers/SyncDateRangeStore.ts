/**
 * Global store for sync date range and GPS sync progress.
 *
 * When the user extends the timeline slider past the default 90 days,
 * this store is updated and GlobalDataSync responds by fetching more data.
 *
 * GPS sync progress is also stored here so all screens can read from a single
 * source of truth (instead of each screen having its own progress state).
 */

import { create } from 'zustand';
import { formatLocalDate } from '@/lib';

export interface GpsSyncProgress {
  status: 'idle' | 'fetching' | 'processing' | 'computing' | 'complete' | 'error';
  completed: number;
  total: number;
  percent: number;
  message: string;
}

interface SyncDateRangeState {
  /** Oldest date to sync (YYYY-MM-DD) */
  oldest: string;
  /** Newest date to sync (YYYY-MM-DD) */
  newest: string;
  /** Whether we're currently fetching extended data */
  isFetchingExtended: boolean;
  /** Whether the range has expanded since last sync (triggers route re-optimization) */
  hasExpanded: boolean;
  /** GPS sync progress (shared across all screens) */
  gpsSyncProgress: GpsSyncProgress;
  /** Whether GPS sync is currently in progress */
  isGpsSyncing: boolean;
  /** Timestamp of last successful GPS sync */
  lastSyncTimestamp: string | null;
  /**
   * Whether expansion is locked (after reset/clear).
   * When locked, expandRange() is ignored until initial sync completes.
   * This prevents race conditions where old cached data triggers unwanted expansion.
   */
  isExpansionLocked: boolean;
  /**
   * Generation counter for sync operations.
   * Incremented on reset to invalidate in-flight fetches.
   * Sync operations capture this at start and check before adding results.
   */
  syncGeneration: number;
  /** Internal: timeout ID for delayed unlock (for cleanup) */
  _unlockTimeoutId: ReturnType<typeof setTimeout> | null;

  /** Update the sync date range - expands to include requested range */
  expandRange: (oldest: string, newest: string) => void;
  /** Reset to default 90 days and lock expansion */
  reset: () => void;
  /** Set fetching state */
  setFetchingExtended: (fetching: boolean) => void;
  /** Mark expansion as processed (call after route re-optimization) */
  markExpansionProcessed: () => void;
  /** Update GPS sync progress (called from GlobalDataSync) */
  setGpsSyncProgress: (progress: GpsSyncProgress) => void;
  /** Unlock expansion (called after initial sync completes) */
  unlockExpansion: () => void;
  /** Unlock expansion after a delay (prevents race conditions with UI updates) */
  delayedUnlockExpansion: () => void;
  /** Clear pending unlock timeout (for cleanup) */
  clearUnlockTimeout: () => void;
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

const defaultGpsSyncProgress: GpsSyncProgress = {
  status: 'idle',
  completed: 0,
  total: 0,
  percent: 0,
  message: '',
};

/**
 * Get current sync generation (for use outside React components).
 * Sync operations should capture this at start and check before adding results.
 */
export function getSyncGeneration(): number {
  return useSyncDateRange.getState().syncGeneration;
}

export const useSyncDateRange = create<SyncDateRangeState>((set, get) => ({
  ...getDefaultRange(),
  isFetchingExtended: false,
  hasExpanded: false,
  gpsSyncProgress: defaultGpsSyncProgress,
  isGpsSyncing: false,
  lastSyncTimestamp: null,
  isExpansionLocked: false,
  syncGeneration: 0,
  _unlockTimeoutId: null,

  expandRange: (requestedOldest: string, requestedNewest: string) => {
    const current = get();

    // Block expansion if locked (after reset/clear, until initial sync completes)
    if (current.isExpansionLocked) {
      if (__DEV__) {
        console.log(
          `[SyncDateRange] Expansion BLOCKED (locked): requested ${requestedOldest} - ${requestedNewest}`
        );
      }
      return;
    }

    // Expand range if requested dates are outside current range
    const newOldest = requestedOldest < current.oldest ? requestedOldest : current.oldest;
    const newNewest = requestedNewest > current.newest ? requestedNewest : current.newest;

    // Only update if range actually expanded
    if (newOldest !== current.oldest || newNewest !== current.newest) {
      set({
        oldest: newOldest,
        newest: newNewest,
        isFetchingExtended: true,
        hasExpanded: true, // Mark that we've expanded (triggers route re-optimization)
      });

      if (__DEV__) {
        console.log(
          `[SyncDateRange] Expanded range: ${current.oldest} - ${current.newest} -> ${newOldest} - ${newNewest}`
        );
      }
    }
  },

  reset: () => {
    const range = getDefaultRange();
    const current = get();
    const newGeneration = current.syncGeneration + 1;
    if (__DEV__) {
      console.log(
        `[SyncDateRange] Reset to 90 days (${range.oldest} - ${range.newest}), ` +
          `expansion LOCKED, generation ${current.syncGeneration} -> ${newGeneration}`
      );
    }
    set({
      ...range,
      isFetchingExtended: false,
      hasExpanded: false,
      isExpansionLocked: true, // Lock expansion until initial sync completes
      syncGeneration: newGeneration, // Invalidate in-flight fetches
    });
  },

  setFetchingExtended: (fetching: boolean) => {
    set({ isFetchingExtended: fetching });
  },

  markExpansionProcessed: () => {
    set({ hasExpanded: false });
  },

  setGpsSyncProgress: (progress: GpsSyncProgress) => {
    const isSyncing =
      progress.status === 'fetching' ||
      progress.status === 'processing' ||
      progress.status === 'computing';
    const updates: Partial<SyncDateRangeState> = {
      gpsSyncProgress: progress,
      isGpsSyncing: isSyncing,
    };
    // Track timestamp when sync completes successfully
    // Note: Don't auto-unlock expansion here - let GlobalDataSync call delayedUnlockExpansion
    // to prevent race conditions with UI updates
    if (progress.status === 'complete') {
      updates.lastSyncTimestamp = new Date().toISOString();
    }
    set(updates);
  },

  unlockExpansion: () => {
    if (__DEV__) {
      console.log('[SyncDateRange] Expansion manually UNLOCKED');
    }
    set({ isExpansionLocked: false });
  },

  delayedUnlockExpansion: () => {
    const state = get();
    // Clear any existing timeout to prevent stale callbacks
    if (state._unlockTimeoutId) {
      clearTimeout(state._unlockTimeoutId);
    }

    // Delay unlock to allow UI to stabilize after sync
    const timeoutId = setTimeout(() => {
      const currentState = get();
      if (currentState.isExpansionLocked) {
        if (__DEV__) {
          console.log('[SyncDateRange] Expansion UNLOCKED after delay');
        }
        set({ isExpansionLocked: false, _unlockTimeoutId: null });
      }
    }, 500);
    set({ _unlockTimeoutId: timeoutId });
  },

  clearUnlockTimeout: () => {
    const { _unlockTimeoutId } = get();
    if (_unlockTimeoutId) {
      clearTimeout(_unlockTimeoutId);
      set({ _unlockTimeoutId: null });
    }
  },
}));

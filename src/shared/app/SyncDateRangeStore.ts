/**
 * Global store for sync date range and GPS sync progress.
 *
 * When the user extends the timeline slider past the default activity window,
 * this store is updated and GlobalDataSync responds by fetching more data.
 *
 * GPS sync progress is also stored here so all screens can read from a single
 * source of truth (instead of each screen having its own progress state).
 */

import { create } from 'zustand';
import { formatLocalDate } from '@/shared/format/format';
import { debug } from '@/shared/debug/debug';
import { DEFAULT_ACTIVITY_DAYS } from '@/shared/native/activityWindow.generated';
import {
  ExtendedFetchState,
  IDLE_EXTENDED_FETCH,
  expirePickup as afterPickupDeadline,
  syncStateChanged as afterSyncState,
  windowAccepted as afterWindowAccepted,
} from '@/shared/app/extendedFetch';

const log = debug.create('SyncDateRangeStore');

export interface GpsSyncProgress {
  status: 'idle' | 'fetching' | 'processing' | 'computing' | 'complete' | 'error';
  completed: number;
  total: number;
  percent: number;
  message: string;
  /**
   * On a 'complete' write: the sync settled but Rust is still detecting, so
   * the surfaces keep showing the message until `detectionApplied` lands.
   */
  analysingInBackground?: boolean;
}

/**
 * What `expandRange` did with the request. A refusal is named so the caller
 * can say why, rather than the drag producing nothing visible.
 */
export type ExpandRangeResult = 'expanded' | 'unchanged' | 'locked';

interface SyncDateRangeState {
  /** Oldest date to sync (YYYY-MM-DD) */
  oldest: string;
  /** Newest date to sync (YYYY-MM-DD) */
  newest: string;
  /**
   * Where the widened-range download has got to. Follows the engine's sync
   * slot, which is what actually runs the download, rather than the SQLite
   * read behind the feed.
   */
  extendedFetch: ExtendedFetchState;
  /** Whether the range has expanded since last sync (triggers route re-optimization) */
  hasExpanded: boolean;
  /** GPS sync progress (shared across all screens) */
  gpsSyncProgress: GpsSyncProgress;
  /**
   * The activities the bulk GPS run is about to fetch a track for.
   *
   * Published so a feed card can tell that its own track is already on its way
   * and ask for nothing. A head card with no preview line otherwise downloads
   * the same `latlng` and `altitude` body on the Interactive lane while the
   * run fetches it off the same endpoint, which is two downloads per card and
   * the run competing with taps for the lane. The card is filled by the
   * track's own arrival instead.
   *
   * Empty whenever no run is going, so a card outside a run, and the same card
   * after one ends without bringing it a line, asks as it always did.
   */
  gpsSyncPendingIds: ReadonlySet<string>;
  /** Whether GPS sync is currently in progress */
  isGpsSyncing: boolean;
  /** Detection outlived the sync's follow and has not announced its end. */
  isAnalysingInBackground: boolean;
  /** Timestamp of last successful GPS sync */
  lastSyncTimestamp: string | null;
  /**
   * Whether expansion is locked (after reset/clear).
   * When locked, expandRange() refuses with 'locked' until the GPS sync
   * settles, which `expansionLock.ts` decides.
   * This prevents race conditions where old cached data triggers unwanted expansion.
   */
  isExpansionLocked: boolean;
  /**
   * Generation counter for sync operations.
   * Incremented on reset to invalidate in-flight fetches.
   * Sync operations capture this at start and check before adding results.
   */
  syncGeneration: number;

  /** Update the sync date range - expands to include requested range */
  expandRange: (oldest: string, newest: string) => ExpandRangeResult;
  /** Restore range from engine without triggering re-computation */
  initializeRange: (oldest: string, newest: string) => void;
  /** Reset to the default activity window and lock expansion */
  reset: () => void;
  /** The engine accepted a window download. */
  windowAccepted: () => void;
  /** The engine's sync status changed. */
  syncStateChanged: (syncing: boolean) => void;
  /** The pickup deadline ran out on a window the engine never reported. */
  expirePickup: () => void;
  /** Mark expansion as processed (call after route re-optimization) */
  markExpansionProcessed: () => void;
  /** Update GPS sync progress (called from GlobalDataSync) */
  setGpsSyncProgress: (progress: GpsSyncProgress) => void;
  /** The run the sync stopped following has landed. */
  backgroundAnalysisEnded: () => void;
  /** What the bulk GPS run is about to fetch. Cleared when the run ends. */
  setGpsSyncPendingIds: (ids: readonly string[]) => void;
  /** Unlock expansion after a delay (prevents race conditions with UI updates) */
  delayedUnlockExpansion: () => void;
}

function getDefaultRange() {
  const today = new Date();
  const defaultStart = new Date(today);
  defaultStart.setDate(defaultStart.getDate() - DEFAULT_ACTIVITY_DAYS);
  return {
    oldest: formatLocalDate(defaultStart),
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

/** Module-level timeout ID - kept outside Zustand to avoid triggering re-renders */
let _unlockTimeoutId: ReturnType<typeof setTimeout> | null = null;

/** One frozen empty set, so an idle store hands every card the same reference. */
const EMPTY_PENDING_IDS: ReadonlySet<string> = new Set<string>();

export const useSyncDateRange = create<SyncDateRangeState>((set, get) => ({
  ...getDefaultRange(),
  extendedFetch: IDLE_EXTENDED_FETCH,
  hasExpanded: false,
  gpsSyncProgress: defaultGpsSyncProgress,
  gpsSyncPendingIds: EMPTY_PENDING_IDS,
  isGpsSyncing: false,
  isAnalysingInBackground: false,
  lastSyncTimestamp: null,
  isExpansionLocked: false,
  syncGeneration: 0,

  expandRange: (requestedOldest: string, requestedNewest: string) => {
    const current = get();

    // Block expansion if locked (after reset/clear, until initial sync completes)
    if (current.isExpansionLocked) {
      if (__DEV__) {
        log.log(
          `[SyncDateRange] Expansion BLOCKED (locked): requested ${requestedOldest} - ${requestedNewest}`
        );
      }
      return 'locked';
    }

    // Expand range if requested dates are outside current range
    const newOldest = requestedOldest < current.oldest ? requestedOldest : current.oldest;
    const newNewest = requestedNewest > current.newest ? requestedNewest : current.newest;

    // Only update if range actually expanded
    if (newOldest !== current.oldest || newNewest !== current.newest) {
      set({
        oldest: newOldest,
        newest: newNewest,
        hasExpanded: true,
        gpsSyncProgress: defaultGpsSyncProgress,
      });

      if (__DEV__) {
        log.log(
          `[SyncDateRange] Expanded range: ${current.oldest} - ${current.newest} -> ${newOldest} - ${newNewest}`
        );
      }
      return 'expanded';
    }

    return 'unchanged';
  },

  initializeRange: (oldest: string, newest: string) => {
    const current = get();
    if (oldest < current.oldest || newest > current.newest) {
      if (__DEV__) {
        log.log(
          `[SyncDateRange] Initialized range from engine: ${oldest} - ${newest} (no recomputation)`
        );
      }
      set({ oldest, newest });
    }
  },

  reset: () => {
    const range = getDefaultRange();
    const current = get();
    const newGeneration = current.syncGeneration + 1;
    if (__DEV__) {
      log.log(
        `[SyncDateRange] Reset to ${DEFAULT_ACTIVITY_DAYS} days (${range.oldest} - ${range.newest}), ` +
          `expansion LOCKED, generation ${current.syncGeneration} -> ${newGeneration}`
      );
    }
    set({
      ...range,
      extendedFetch: IDLE_EXTENDED_FETCH,
      hasExpanded: false,
      // These belong to the account that just went away: an error status, a
      // last sync time or a pending id left standing reads as the new
      // athlete's.
      gpsSyncProgress: defaultGpsSyncProgress,
      gpsSyncPendingIds: EMPTY_PENDING_IDS,
      isGpsSyncing: false,
      isAnalysingInBackground: false,
      lastSyncTimestamp: null,
      isExpansionLocked: true, // Lock expansion until initial sync completes
      syncGeneration: newGeneration, // Invalidate in-flight fetches
    });
  },

  windowAccepted: () => {
    set({ extendedFetch: afterWindowAccepted(get().extendedFetch, Date.now()) });
  },

  syncStateChanged: (syncing: boolean) => {
    const next = afterSyncState(get().extendedFetch, syncing, Date.now());
    if (next !== get().extendedFetch) set({ extendedFetch: next });
  },

  expirePickup: () => {
    const next = afterPickupDeadline(get().extendedFetch, Date.now());
    if (next !== get().extendedFetch) set({ extendedFetch: next });
  },

  markExpansionProcessed: () => {
    set({ hasExpanded: false });
  },

  setGpsSyncPendingIds: (ids: readonly string[]) => {
    set({ gpsSyncPendingIds: ids.length === 0 ? EMPTY_PENDING_IDS : new Set(ids) });
  },

  setGpsSyncProgress: (progress: GpsSyncProgress) => {
    const isSyncing =
      progress.status === 'fetching' ||
      progress.status === 'processing' ||
      progress.status === 'computing';
    const updates: Partial<SyncDateRangeState> = {
      gpsSyncProgress: progress,
      isGpsSyncing: isSyncing,
      isAnalysingInBackground:
        progress.status === 'complete' && progress.analysingInBackground === true,
    };
    // A run that has ended holds nothing, so the cards it was covering are
    // free to ask. Cleared here rather than at each of the three call sites
    // that end a run, so none of them can forget.
    if (!isSyncing) updates.gpsSyncPendingIds = EMPTY_PENDING_IDS;
    // Track timestamp when sync completes successfully
    // Note: Don't auto-unlock expansion here - let GlobalDataSync call delayedUnlockExpansion
    // to prevent race conditions with UI updates
    if (progress.status === 'complete') {
      updates.lastSyncTimestamp = new Date().toISOString();
    }
    set(updates);
  },

  backgroundAnalysisEnded: () => {
    set({ isAnalysingInBackground: false });
  },

  delayedUnlockExpansion: () => {
    // Clear any existing timeout to prevent stale callbacks
    if (_unlockTimeoutId) {
      clearTimeout(_unlockTimeoutId);
    }

    // Delay unlock to allow UI to stabilize after sync
    _unlockTimeoutId = setTimeout(() => {
      _unlockTimeoutId = null;
      const currentState = get();
      if (currentState.isExpansionLocked) {
        if (__DEV__) {
          log.log('[SyncDateRange] Expansion UNLOCKED after delay');
        }
        set({ isExpansionLocked: false });
      }
    }, 500);
  },
}));

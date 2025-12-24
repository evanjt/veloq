import { useState, useEffect, useCallback, useMemo } from 'react';
import { activitySyncManager, type SyncProgress } from '@/lib/activitySyncManager';
import { findOldestDate, findNewestDate } from '@/lib/activityBoundsUtils';
import { useAuthStore } from '@/providers';
import type { ActivityBoundsCache, ActivityBoundsItem } from '@/types';

interface CacheStats {
  /** Total number of cached activities */
  totalActivities: number;
  /** Oldest activity date in cache */
  oldestDate: string | null;
  /** Newest activity date in cache */
  newestDate: string | null;
  /** Last sync timestamp */
  lastSync: string | null;
  /** Whether background sync is running */
  isSyncing: boolean;
}

interface UseActivityBoundsCacheReturn {
  /** Cached activity bounds */
  activities: ActivityBoundsItem[];
  /** Current sync progress */
  progress: SyncProgress;
  /** Whether initial load is complete */
  isReady: boolean;
  /** Sync bounds for a date range (debounced for timeline scrubbing) */
  syncDateRange: (oldest: string, newest: string) => void;
  /** Get the oldest synced date */
  oldestSyncedDate: string | null;
  /** Get the newest synced date (usually today or last sync) */
  newestSyncedDate: string | null;
  /** The oldest activity date from the API (full timeline extent) */
  oldestActivityDate: string | null;
  /** Clear the cache */
  clearCache: () => Promise<void>;
  /** Cache statistics */
  cacheStats: CacheStats;
  /** Trigger full historical sync (10 years) */
  syncAllHistory: () => void;
  /** Trigger sync for last year only */
  syncOneYear: () => void;
}

/**
 * Hook for accessing the activity bounds cache.
 * Uses the singleton ActivitySyncManager for all sync operations.
 * Only initializes when user is authenticated.
 */
export function useActivityBoundsCache(): UseActivityBoundsCacheReturn {
  const [cache, setCache] = useState<ActivityBoundsCache | null>(null);
  const [progress, setProgress] = useState<SyncProgress>({ completed: 0, total: 0, status: 'idle' });
  const [isReady, setIsReady] = useState(false);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  // Initialize sync manager and subscribe to updates - only when authenticated
  useEffect(() => {
    // Subscribe to progress updates
    const unsubProgress = activitySyncManager.onProgress((p) => {
      setProgress(p);
      // Mark as ready once we're past loading
      if (p.status !== 'loading') {
        setIsReady(true);
      }
    });

    // Subscribe to cache updates
    const unsubCache = activitySyncManager.onCacheUpdate((c) => {
      setCache(c);
    });

    // Only initialize when authenticated - this triggers the initial 3-month sync
    if (isAuthenticated) {
      activitySyncManager.initialize();
    } else {
      // Reset on logout so we can re-initialize on next login
      activitySyncManager.reset();
    }

    return () => {
      unsubProgress();
      unsubCache();
    };
  }, [isAuthenticated]);

  // Sync date range (debounced by default in the manager)
  const syncDateRange = useCallback((oldest: string, newest: string) => {
    activitySyncManager.syncDateRange(oldest, newest, true);
  }, []);

  // Clear cache
  const clearCache = useCallback(async () => {
    await activitySyncManager.clearCache();
  }, []);

  // Sync all history
  const syncAllHistory = useCallback(() => {
    activitySyncManager.syncAllHistory();
  }, []);

  // Sync last year only
  const syncOneYear = useCallback(() => {
    activitySyncManager.syncOneYear();
  }, []);

  // Convert cache to array for rendering
  const activities = useMemo(() => {
    return cache ? Object.values(cache.activities) : [];
  }, [cache]);

  // Calculate cache stats from actual cached activities
  const cacheStats: CacheStats = useMemo(() => ({
    totalActivities: activities.length,
    oldestDate: findOldestDate(cache?.activities || {}),
    newestDate: findNewestDate(cache?.activities || {}),
    lastSync: cache?.lastSync || null,
    isSyncing: progress.status === 'syncing',
  }), [activities.length, cache?.activities, cache?.lastSync, progress.status]);

  return {
    activities,
    progress,
    isReady,
    syncDateRange,
    // Use actual activity dates for the cached range display
    oldestSyncedDate: cacheStats.oldestDate,
    newestSyncedDate: cacheStats.newestDate,
    oldestActivityDate: activitySyncManager.getOldestActivityDate(),
    clearCache,
    cacheStats,
    syncAllHistory,
    syncOneYear,
  };
}

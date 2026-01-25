/**
 * Hook for managing activity bounds cache and sync state.
 * The Rust engine handles activity storage and spatial indexing.
 * This hook provides sync progress tracking and cache control functions.
 */
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useSyncDateRange } from '@/providers';
import { clearAllGpsTracks, clearBoundsCache } from '@/lib/storage/gpsStorage';
import { getRouteEngine } from '@/lib/native/routeEngine';

export interface SyncProgress {
  completed: number;
  total: number;
  status: 'idle' | 'loading' | 'syncing' | 'complete' | 'error';
  message?: string;
}

interface CacheStats {
  /** Total number of cached activities in the Rust engine */
  totalActivities: number;
  /** Last sync timestamp */
  lastSync: string | null;
  /** Whether background sync is running */
  isSyncing: boolean;
  /** Oldest activity date in cache (ISO string) */
  oldestDate: string | null;
  /** Newest activity date in cache (ISO string) */
  newestDate: string | null;
}

interface UseActivityBoundsCacheReturn {
  /** Current sync progress */
  progress: SyncProgress;
  /** Whether engine data is available */
  isReady: boolean;
  /** Expand sync date range (triggers GlobalDataSync to fetch more data) */
  syncDateRange: (oldest: string, newest: string) => void;
  /** Clear the cache */
  clearCache: () => Promise<void>;
  /** Cache statistics */
  cacheStats: CacheStats;
  /** Trigger sync for specified number of days or all history */
  sync: (days?: number | 'all') => Promise<void>;
}

/**
 * Hook for accessing the activity bounds cache sync state.
 * Activity data is now provided by useEngineMapActivities hook.
 */
export function useActivityBoundsCache(): UseActivityBoundsCacheReturn {
  const [progress, setProgress] = useState<SyncProgress>({
    completed: 0,
    total: 0,
    status: 'idle',
  });

  // Initialize activity count synchronously from engine
  const [activityCount, setActivityCount] = useState(() => {
    try {
      const engine = getRouteEngine();
      return engine ? engine.getActivityCount() : 0;
    } catch {
      return 0;
    }
  });

  const queryClient = useQueryClient();
  const lastSyncTimestamp = useSyncDateRange((s) => s.lastSyncTimestamp);

  // Track mount state to prevent setState after unmount
  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Subscribe to Rust engine activity changes
  useEffect(() => {
    const engine = getRouteEngine();
    if (!engine) return;

    // Initial count
    setActivityCount(engine.getActivityCount());

    // Subscribe to updates
    const unsubscribe = engine.subscribe('activities', () => {
      if (!isMountedRef.current) return;
      const eng = getRouteEngine();
      setActivityCount(eng ? eng.getActivityCount() : 0);
    });

    return unsubscribe;
  }, []);

  // Get date range from sync store
  const syncOldest = useSyncDateRange((s) => s.oldest);
  const syncNewest = useSyncDateRange((s) => s.newest);

  // Cache statistics from engine (date range from sync store)
  const cacheStats: CacheStats = useMemo(() => {
    return {
      totalActivities: activityCount,
      lastSync: lastSyncTimestamp,
      isSyncing: progress.status === 'syncing',
      // Use sync date range - represents the date range we've synced
      oldestDate: activityCount > 0 ? syncOldest : null,
      newestDate: activityCount > 0 ? syncNewest : null,
    };
  }, [activityCount, progress.status, lastSyncTimestamp, syncOldest, syncNewest]);

  // Expand the global sync date range
  const expandRange = useSyncDateRange((s) => s.expandRange);

  const syncDateRange = useCallback(
    (oldest: string, newest: string) => {
      expandRange(oldest, newest);
    },
    [expandRange]
  );

  const clearCache = useCallback(async () => {
    // Clear Rust engine state
    const engine = getRouteEngine();
    if (engine) engine.clear();

    // Clear FileSystem caches (GPS tracks and bounds)
    await Promise.all([clearAllGpsTracks(), clearBoundsCache()]);

    setActivityCount(0);
  }, []);

  const sync = useCallback(
    async (_days: number | 'all' = 90) => {
      // Refetch activities (triggers GlobalDataSync to download GPS data)
      await queryClient.refetchQueries({
        queryKey: ['activities'],
        type: 'all',
      });
    },
    [queryClient]
  );

  return {
    progress,
    isReady: activityCount > 0,
    syncDateRange,
    clearCache,
    cacheStats,
    sync,
  };
}

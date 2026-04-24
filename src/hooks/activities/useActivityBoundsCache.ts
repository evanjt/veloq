/**
 * Hook for managing activity bounds cache and sync state.
 * The Rust engine handles activity storage and spatial indexing.
 * This hook provides sync progress tracking and cache control functions.
 */
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useSyncDateRange } from '@/providers';
import { clearAllGpsTracks, clearBoundsCache } from '@/lib/storage/gpsStorage';
import { queryKeys } from '@/lib/queryKeys';
import { getRouteEngine, getRouteDbPath } from '@/lib/native/routeEngine';
import { isHeatmapEnabled } from '@/providers/RouteSettingsStore';
import { formatLocalDate } from '@/lib';

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

  // Initialize activity count and date range synchronously from engine
  const [activityCount, setActivityCount] = useState(() => {
    try {
      const engine = getRouteEngine();
      return engine ? engine.getActivityCount() : 0;
    } catch {
      return 0;
    }
  });

  // Track engine's actual date range (from persisted data)
  const [engineDateRange, setEngineDateRange] = useState<{
    oldest: string | null;
    newest: string | null;
  }>(() => {
    try {
      const engine = getRouteEngine();
      const stats = engine?.getStats();
      if (stats?.oldestDate && stats?.newestDate) {
        return {
          oldest: formatLocalDate(new Date(Number(stats.oldestDate) * 1000)),
          newest: formatLocalDate(new Date(Number(stats.newestDate) * 1000)),
        };
      }
    } catch {
      // Ignore
    }
    return { oldest: null, newest: null };
  });

  const queryClient = useQueryClient();
  const lastSyncTimestamp = useSyncDateRange((s) => s.lastSyncTimestamp);

  // Counter to force engine re-subscription after clear+reinit
  const [engineGeneration, setEngineGeneration] = useState(0);

  // True once we've successfully subscribed to the engine. Distinct from
  // "has activities" — an engine with zero activities is still ready, just
  // empty. Using activityCount as the readiness gate strands new/cleared
  // installs on a perpetual "Loading activities..." screen because the
  // count never climbs above zero until a sync completes.
  const [isSubscribed, setIsSubscribed] = useState(() => getRouteEngine() !== null);

  // Track mount state to prevent setState after unmount
  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Subscribe to Rust engine activity changes — retry if engine not ready on mount
  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | null = null;

    // Helper to update both count and date range from engine stats
    const updateFromEngine = () => {
      if (cancelled || !isMountedRef.current) return;
      const eng = getRouteEngine();
      if (!eng) {
        setActivityCount(0);
        setEngineDateRange({ oldest: null, newest: null });
        return;
      }
      setActivityCount(eng.getActivityCount());
      const stats = eng.getStats();
      if (stats?.oldestDate && stats?.newestDate) {
        setEngineDateRange({
          oldest: formatLocalDate(new Date(Number(stats.oldestDate) * 1000)),
          newest: formatLocalDate(new Date(Number(stats.newestDate) * 1000)),
        });
      } else {
        setEngineDateRange({ oldest: null, newest: null });
      }
    };

    function trySubscribe(): boolean {
      const engine = getRouteEngine();
      if (!engine) return false;

      updateFromEngine();
      if (isMountedRef.current) setIsSubscribed(true);

      unsubscribe = engine.subscribe('activities', () => {
        if (!isMountedRef.current) return;
        updateFromEngine();
      });
      return true;
    }

    if (!trySubscribe()) {
      const interval = setInterval(() => {
        if (trySubscribe()) {
          clearInterval(interval);
        }
      }, 200);
      return () => {
        cancelled = true;
        clearInterval(interval);
        unsubscribe?.();
      };
    }

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [engineGeneration]); // Re-subscribe when engine is destroyed and re-created

  // Cache statistics from engine (date range from engine's actual data)
  const cacheStats: CacheStats = useMemo(() => {
    return {
      totalActivities: activityCount,
      lastSync: lastSyncTimestamp,
      isSyncing: progress.status === 'syncing',
      // Use engine's actual date range - represents what's actually cached
      oldestDate: engineDateRange.oldest,
      newestDate: engineDateRange.newest,
    };
  }, [activityCount, progress.status, lastSyncTimestamp, engineDateRange]);

  // Expand the global sync date range
  const expandRange = useSyncDateRange((s) => s.expandRange);

  const syncDateRange = useCallback(
    (oldest: string, newest: string) => {
      expandRange(oldest, newest);
    },
    [expandRange]
  );

  const clearCache = useCallback(async () => {
    // Destroy and re-init engine to get a clean state.
    // DO NOT use engine.clear() — it corrupts sub-objects (strength() returns null).
    const engine = getRouteEngine();
    if (engine) {
      const dbPath = getRouteDbPath();
      engine.destroyEngine();
      if (dbPath) {
        engine.initWithPath(dbPath);
        // Re-enable heatmap tiles if setting is on (init doesn't do this automatically)
        if (isHeatmapEnabled()) {
          engine.enableHeatmapTiles();
        }
      }
    }

    // Clear FileSystem caches (GPS tracks and bounds)
    await Promise.all([clearAllGpsTracks(), clearBoundsCache()]);

    setActivityCount(0);
    setEngineDateRange({ oldest: null, newest: null });
    // Force engine re-subscription since destroy+reinit breaks the old subscription
    setEngineGeneration((g) => g + 1);
  }, []);

  const sync = useCallback(
    async (_days: number | 'all' = 90) => {
      // Refetch activities (triggers GlobalDataSync to download GPS data)
      await queryClient.refetchQueries({
        queryKey: queryKeys.activities.all,
        type: 'all',
      });
    },
    [queryClient]
  );

  return {
    progress,
    isReady: isSubscribed,
    syncDateRange,
    clearCache,
    cacheStats,
    sync,
  };
}

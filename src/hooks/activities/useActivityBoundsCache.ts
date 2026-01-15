import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthStore, useSyncDateRange } from '@/providers';
import { clearAllGpsTracks, clearBoundsCache } from '@/lib/storage/gpsStorage';
import { getRouteEngine } from '@/lib/native/routeEngine';
import type { ActivityBoundsCache, ActivityBoundsItem, Activity } from '@/types';

export interface SyncProgress {
  completed: number;
  total: number;
  status: 'idle' | 'loading' | 'syncing' | 'complete' | 'error';
  message?: string;
}

interface CacheStats {
  /** Total number of cached activities in the Rust engine */
  totalActivities: number;
  /** Oldest activity date (from activities param if provided) */
  oldestDate: string | null;
  /** Newest activity date (from activities param if provided) */
  newestDate: string | null;
  /** Last sync timestamp */
  lastSync: string | null;
  /** Whether background sync is running */
  isSyncing: boolean;
}

interface UseActivityBoundsCacheOptions {
  /** Activities with dates for computing date range */
  activitiesWithDates?: Array<{
    start_date?: string;
    start_date_local?: string;
  }>;
}

interface UseActivityBoundsCacheReturn {
  /** Activity bounds merged from engine and TanStack Query cache */
  activities: ActivityBoundsItem[];
  /** Current sync progress */
  progress: SyncProgress;
  /** Whether initial load is complete */
  isReady: boolean;
  /** Sync bounds for a date range (no-op, handled by Rust) */
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
  /**
   * Trigger sync for specified number of days or all history.
   * @param days - Number of days to sync (default 90), or 'all' for full history
   */
  sync: (days?: number | 'all') => Promise<void>;
}

/**
 * Find oldest date from activities array
 */
function findOldestActivityDate(
  activities: Array<{ start_date?: string; start_date_local?: string }>
): string | null {
  if (!activities || activities.length === 0) return null;

  let oldest: string | null = null;
  for (const activity of activities) {
    const date = activity.start_date || activity.start_date_local;
    if (date && (!oldest || date < oldest)) {
      oldest = date;
    }
  }
  return oldest;
}

/**
 * Find newest date from activities array
 */
function findNewestActivityDate(
  activities: Array<{ start_date?: string; start_date_local?: string }>
): string | null {
  if (!activities || activities.length === 0) return null;

  let newest: string | null = null;
  for (const activity of activities) {
    const date = activity.start_date || activity.start_date_local;
    if (date && (!newest || date > newest)) {
      newest = date;
    }
  }
  return newest;
}

/**
 * Hook for accessing the activity bounds cache.
 * The Rust engine handles activity storage and spatial indexing.
 * This hook provides cache statistics and control functions.
 *
 * @param options.activitiesWithDates - Activities array with date fields for date range computation
 */
export function useActivityBoundsCache(
  options: UseActivityBoundsCacheOptions = {}
): UseActivityBoundsCacheReturn {
  const { activitiesWithDates } = options;
  const [progress, setProgress] = useState<SyncProgress>({
    completed: 0,
    total: 0,
    status: 'idle',
  });
  const [isReady, setIsReady] = useState(true);
  const [activityCount, setActivityCount] = useState(0);
  const [cachedActivitiesVersion, setCachedActivitiesVersion] = useState(0);
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

  // Subscribe to activities query cache changes
  // Only update when query data actually changes (success state)
  // Use a ref to debounce rapid updates
  const updateTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
      // Only react to successful data updates, not loading/error state changes
      if (
        event.query.queryKey[0] === 'activities' &&
        event.type === 'updated' &&
        event.action?.type === 'success'
      ) {
        // Debounce updates to prevent rapid re-renders
        if (updateTimeoutRef.current) {
          clearTimeout(updateTimeoutRef.current);
        }
        // Check mount state BEFORE setting timeout to prevent firing after unmount
        if (!isMountedRef.current) {
          return;
        }
        updateTimeoutRef.current = setTimeout(() => {
          if (isMountedRef.current) {
            setCachedActivitiesVersion((v) => v + 1);
          }
        }, 100);
      }
    });
    return () => {
      unsubscribe();
      if (updateTimeoutRef.current) {
        clearTimeout(updateTimeoutRef.current);
      }
    };
  }, [queryClient]);

  // Subscribe to Rust engine activity changes
  useEffect(() => {
    const engine = getRouteEngine();
    if (!engine) return;

    // Initial count
    try {
      setActivityCount(engine.getActivityCount());
    } catch {
      setActivityCount(0);
    }

    // Subscribe to updates with mount guard
    const unsubscribe = engine.subscribe('activities', () => {
      if (!isMountedRef.current) return;
      try {
        const eng = getRouteEngine();
        setActivityCount(eng ? eng.getActivityCount() : 0);
      } catch {
        setActivityCount(0);
      }
    });

    return unsubscribe;
  }, []);

  // Calculate cache stats from Rust engine and optional activities
  // Filter to only activities that are actually in the engine
  const cacheStats: CacheStats = useMemo(() => {
    let filteredActivities = activitiesWithDates;

    // Filter to only synced activities if we have engine data
    if (activitiesWithDates && activitiesWithDates.length > 0 && activityCount > 0) {
      try {
        const engine = getRouteEngine();
        if (engine) {
          const engineIds = new Set(engine.getActivityIds());
          // Only filter if activities have id field (full Activity objects)
          if ('id' in activitiesWithDates[0]) {
            filteredActivities = (
              activitiesWithDates as Array<{
                id: string;
                start_date?: string;
                start_date_local?: string;
              }>
            ).filter((a) => engineIds.has(a.id));
          }
        }
      } catch {
        // Fall back to using all activities if engine access fails
      }
    }

    return {
      totalActivities: activityCount,
      oldestDate: filteredActivities ? findOldestActivityDate(filteredActivities) : null,
      newestDate: filteredActivities ? findNewestActivityDate(filteredActivities) : null,
      lastSync: lastSyncTimestamp,
      isSyncing: progress.status === 'syncing',
    };
  }, [activityCount, activitiesWithDates, progress.status, lastSyncTimestamp]);

  // Get current sync date range to filter activities
  const syncOldest = useSyncDateRange((s) => s.oldest);
  const syncNewest = useSyncDateRange((s) => s.newest);

  // Get all activities with GPS from TanStack Query cache for date range
  // Note: Query key is ['activities', oldest, newest, stats], so we use getQueriesData
  // with partial key matching to find all activity queries
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const allGpsActivities = useMemo<Activity[]>(() => {
    // getQueriesData returns array of [queryKey, data] tuples for all matching queries
    const queries = queryClient.getQueriesData<Activity[]>({
      queryKey: ['activities'],
    });

    // Merge all activities from all matching queries (there's usually just one)
    const allActivities: Activity[] = [];
    const seenIds = new Set<string>();

    // Filter by current sync date range to prevent old cached activities from being used
    const oldestDate = new Date(syncOldest);
    const newestDate = new Date(syncNewest);
    newestDate.setHours(23, 59, 59, 999); // Include full day

    for (const [_key, data] of queries) {
      if (!data) continue;
      for (const activity of data) {
        if (!seenIds.has(activity.id)) {
          seenIds.add(activity.id);
          // Only include activities within current sync date range
          const activityDate = new Date(activity.start_date_local);
          if (activityDate >= oldestDate && activityDate <= newestDate) {
            allActivities.push(activity);
          }
        }
      }
    }

    return allActivities.filter((a) => a.stream_types?.includes('latlng'));
  }, [queryClient, cachedActivitiesVersion, syncOldest, syncNewest]);

  // Get activities with bounds from engine for map display
  const activities = useMemo<ActivityBoundsItem[]>(() => {
    // If no GPS activities, return empty
    if (allGpsActivities.length === 0) return [];

    // Try to get bounds from engine
    const engine = getRouteEngine();
    if (!engine || activityCount === 0) return [];

    try {
      const engineBounds = engine.getAllActivityBounds();
      if (!engineBounds || engineBounds.size === 0) return [];

      // Create lookup map for activity metadata
      const activityMap = new Map<string, Activity>();
      for (const a of allGpsActivities) {
        activityMap.set(a.id, a);
      }

      // Merge engine bounds with cached metadata
      // engineBounds is a Map<string, { minLat, maxLat, minLng, maxLng }>
      // Convert to [[minLat, minLng], [maxLat, maxLng]] format
      return Array.from(engineBounds.entries()).map(([id, b]): ActivityBoundsItem => {
        const cached = activityMap.get(id);
        return {
          id,
          bounds: [
            [b.minLat, b.minLng],
            [b.maxLat, b.maxLng],
          ],
          type: (cached?.type || 'Ride') as ActivityBoundsItem['type'],
          name: cached?.name || '',
          date: cached?.start_date_local || '',
          distance: cached?.distance || 0,
          duration: cached?.moving_time || 0,
        };
      });
    } catch {
      return [];
    }
  }, [activityCount, allGpsActivities, cachedActivitiesVersion]);

  // Expand the global sync date range - triggers GlobalDataSync to fetch more data
  const expandRange = useSyncDateRange((s) => s.expandRange);
  const isFetchingExtended = useSyncDateRange((s) => s.isFetchingExtended);

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
    async (days: number | 'all' = 90) => {
      // Clear the Rust engine state
      const engine = getRouteEngine();
      if (engine) engine.clear();
      setActivityCount(0);

      // Actively refetch activities (not just invalidate, which only marks stale)
      // Using 'all' type ensures refetch even when no component is watching
      // This triggers GlobalDataSync to automatically download GPS data
      await queryClient.refetchQueries({
        queryKey: ['activities'],
        type: 'all',
      });
    },
    [queryClient]
  );

  // Compute oldest activity date from ALL GPS activities (not just those with bounds)
  // This ensures the timeline slider shows the full range even before sync completes
  const oldestActivityDate = useMemo(() => {
    if (allGpsActivities.length === 0) return null;
    let oldest: string | null = null;
    for (const a of allGpsActivities) {
      const date = a.start_date_local;
      if (date && (!oldest || date < oldest)) {
        oldest = date;
      }
    }
    return oldest;
  }, [allGpsActivities]);

  return {
    activities, // Merged from engine bounds + cached metadata
    progress,
    isReady,
    syncDateRange,
    oldestSyncedDate: cacheStats.oldestDate,
    newestSyncedDate: cacheStats.newestDate,
    oldestActivityDate, // Computed from merged activities
    clearCache,
    cacheStats,
    sync,
  };
}

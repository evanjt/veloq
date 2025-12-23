import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { intervalsApi } from '@/api';
import { formatLocalDate, SYNC, TIME, RATE_LIMIT } from '@/lib';
import {
  buildCacheEntry,
  filterGpsActivities,
  filterUncachedActivities,
  findOldestDate,
  findNewestDate,
  mergeCacheEntries,
  sortActivitiesByDateDesc,
} from '@/lib/activityBoundsUtils';
import type { ActivityBoundsCache, ActivityBoundsItem } from '@/types';

const CACHE_KEY = 'activity_bounds_cache';
const OLDEST_DATE_KEY = 'oldest_activity_date';

interface SyncProgress {
  completed: number;
  total: number;
  status: 'idle' | 'loading' | 'syncing' | 'complete' | 'error';
  message?: string;
}

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
  /** Sync bounds for a date range */
  syncDateRange: (oldest: string, newest: string) => Promise<void>;
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
  /** Trigger full historical sync */
  syncAllHistory: () => void;
}

export function useActivityBoundsCache(): UseActivityBoundsCacheReturn {
  const [cache, setCache] = useState<ActivityBoundsCache | null>(null);
  const [progress, setProgress] = useState<SyncProgress>({
    completed: 0,
    total: 0,
    status: 'idle',
  });
  const [isReady, setIsReady] = useState(false);
  const [oldestActivityDate, setOldestActivityDate] = useState<string | null>(null);
  const backgroundSyncRef = useRef<boolean>(false);
  const cacheRef = useRef<ActivityBoundsCache | null>(null);
  // Track current sync operation so we can cancel it
  const syncAbortRef = useRef<AbortController | null>(null);
  const syncIdRef = useRef<number>(0);
  // Track historical sync timeout for cleanup
  const historicalSyncTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep cacheRef in sync for background operations
  useEffect(() => {
    cacheRef.current = cache;
  }, [cache]);

  // Load cache from AsyncStorage on mount
  useEffect(() => {
    loadCache();
  }, []);

  // Cleanup timeouts on unmount
  useEffect(() => {
    return () => {
      if (historicalSyncTimeoutRef.current) {
        clearTimeout(historicalSyncTimeoutRef.current);
      }
      if (syncAbortRef.current) {
        syncAbortRef.current.abort();
      }
    };
  }, []);

  const loadCache = useCallback(async () => {
    try {
      setProgress({ completed: 0, total: 0, status: 'loading', message: 'Loading cached data...' });

      // Load cached oldest activity date (or fetch from API)
      const cachedOldestDate = await AsyncStorage.getItem(OLDEST_DATE_KEY);
      if (cachedOldestDate) {
        setOldestActivityDate(cachedOldestDate);
      } else {
        // Fetch from API and cache it
        try {
          const oldest = await intervalsApi.getOldestActivityDate();
          if (oldest) {
            setOldestActivityDate(oldest);
            await AsyncStorage.setItem(OLDEST_DATE_KEY, oldest);
          }
        } catch {
          // Silently fail - oldest date is optional
        }
      }

      const cached = await AsyncStorage.getItem(CACHE_KEY);

      if (cached) {
        const parsed: ActivityBoundsCache = JSON.parse(cached);
        setCache(parsed);
        cacheRef.current = parsed;
        setIsReady(true);
        setProgress({ completed: 0, total: 0, status: 'idle' });

        // Start background sync for any new activities since last sync
        const lastSync = new Date(parsed.lastSync);
        const now = new Date();
        const daysSinceSync = Math.floor((now.getTime() - lastSync.getTime()) / TIME.DAY);

        if (daysSinceSync > 0) {
          // Background sync new activities
          syncInBackground(parsed.lastSync, formatLocalDate(now));
        }

        // Also start background sync for older historical data
        startHistoricalBackgroundSync();
      } else {
        // No cache - sync last 90 days first (quick initial load)
        setIsReady(true);
        const today = new Date();
        const daysAgo = new Date(today);
        daysAgo.setDate(daysAgo.getDate() - SYNC.INITIAL_DAYS);
        await syncDateRange(formatLocalDate(daysAgo), formatLocalDate(today));

        // Then start background sync for older data
        startHistoricalBackgroundSync();
      }
    } catch {
      setProgress({ completed: 0, total: 0, status: 'error', message: 'Failed to load cache' });
      setIsReady(true);
    }
  }, []);

  const saveCache = useCallback(async (newCache: ActivityBoundsCache) => {
    try {
      await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(newCache));
      setCache(newCache);
      cacheRef.current = newCache;
    } catch {
      // Silently fail - cache save is not critical
    }
  }, []);

  // Background sync that doesn't block UI
  const syncInBackground = useCallback(async (oldest: string, newest: string) => {
    if (backgroundSyncRef.current) return; // Already syncing
    backgroundSyncRef.current = true;

    try {
      // Get activities for date range
      const activities = await intervalsApi.getActivities({ oldest, newest });
      const gpsActivities = filterGpsActivities(activities);

      if (gpsActivities.length === 0) {
        backgroundSyncRef.current = false;
        return;
      }

      // Filter out already cached
      const newActivities = filterUncachedActivities(gpsActivities, cacheRef.current);

      if (newActivities.length === 0) {
        backgroundSyncRef.current = false;
        return;
      }

      setProgress({
        completed: 0,
        total: newActivities.length,
        status: 'syncing',
        message: `Background sync: ${newActivities.length} activities`,
      });

      // Fetch bounds with progress
      const ids = newActivities.map((a) => a.id);
      const boundsMap = await intervalsApi.getActivityMapBounds(
        ids,
        8,
        (completed, total) => {
          setProgress({
            completed,
            total,
            status: 'syncing',
            message: `Background sync: ${completed}/${total}`,
          });
        }
      );

      // Build new entries
      const newEntries: Record<string, ActivityBoundsItem> = {};
      for (const activity of newActivities) {
        const mapData = boundsMap.get(activity.id);
        if (mapData?.bounds) {
          newEntries[activity.id] = buildCacheEntry(activity, mapData.bounds);
        }
      }

      // Merge with existing cache
      const updatedCache = mergeCacheEntries(
        cacheRef.current,
        newEntries,
        formatLocalDate(new Date()),
        oldest
      );

      await saveCache(updatedCache);
      setProgress({ completed: 0, total: 0, status: 'idle' });
    } catch {
      setProgress({ completed: 0, total: 0, status: 'idle' });
    } finally {
      backgroundSyncRef.current = false;
    }
  }, [saveCache]);

  // Start background sync for historical data
  const startHistoricalBackgroundSync = useCallback(() => {
    const currentCache = cacheRef.current;
    if (!currentCache?.oldestSynced) return;

    const oldestSynced = new Date(currentCache.oldestSynced);
    const targetDate = new Date();
    targetDate.setDate(targetDate.getDate() - SYNC.BACKGROUND_DAYS);

    // If we haven't synced back far enough, sync more
    if (oldestSynced > targetDate) {
      const syncFrom = formatLocalDate(targetDate);
      const syncTo = currentCache.oldestSynced;
      // Clear any existing timeout
      if (historicalSyncTimeoutRef.current) {
        clearTimeout(historicalSyncTimeoutRef.current);
      }
      // Delay to not compete with initial load
      historicalSyncTimeoutRef.current = setTimeout(() => {
        syncInBackground(syncFrom, syncTo);
      }, 2000);
    }
  }, [syncInBackground]);

  const syncDateRange = useCallback(async (oldest: string, newest: string) => {
    // Cancel any previous sync
    if (syncAbortRef.current) {
      syncAbortRef.current.abort();
    }

    // Create new abort controller and increment sync ID
    const abortController = new AbortController();
    syncAbortRef.current = abortController;
    syncIdRef.current += 1;
    const currentSyncId = syncIdRef.current;

    // Helper to check if this sync is still valid
    const isCancelled = () => abortController.signal.aborted || currentSyncId !== syncIdRef.current;

    try {
      setProgress({ completed: 0, total: 0, status: 'syncing', message: 'Fetching activities...' });

      // Get activities for date range
      const activities = await intervalsApi.getActivities({ oldest, newest });

      // Check if cancelled after API call
      if (isCancelled()) {
        return;
      }

      // Filter to only GPS-enabled activities
      const gpsActivities = filterGpsActivities(activities);

      if (gpsActivities.length === 0) {
        if (!isCancelled()) {
          setProgress({ completed: 0, total: 0, status: 'complete', message: 'No GPS activities found' });
        }
        return;
      }

      // Filter out already cached activities
      const uncachedActivities = filterUncachedActivities(gpsActivities, cacheRef.current);

      if (uncachedActivities.length === 0) {
        if (!isCancelled()) {
          setProgress({ completed: 0, total: 0, status: 'complete', message: 'All activities already cached' });
        }
        return;
      }

      // Sort activities by date (newest first) so partial syncs are coherent
      // This ensures if we cancel, we have the most recent data complete
      const newActivities = sortActivitiesByDateDesc(uncachedActivities);

      if (!isCancelled()) {
        setProgress({
          completed: 0,
          total: newActivities.length,
          status: 'syncing',
          message: `Syncing ${newActivities.length} activities...`,
        });
      }

      // Track which activities we've successfully synced
      const newEntries: Record<string, ActivityBoundsItem> = {};
      let syncedCount = 0;
      let wasAborted = false;

      // Fetch bounds for new activities in batches
      const concurrency = RATE_LIMIT.DEFAULT_CONCURRENCY;
      const ids = newActivities.map((a) => a.id);

      try {
        for (let i = 0; i < ids.length; i += concurrency) {
          // Check if cancelled before starting new batch
          if (isCancelled()) {
            wasAborted = true;
            break;
          }

          const batchIds = ids.slice(i, i + concurrency);
          const batchActivities = newActivities.slice(i, i + concurrency);

          // Fetch this batch
          const batchResults = await intervalsApi.getActivityMapBounds(
            batchIds,
            concurrency,
            undefined, // No per-item progress for batch
            abortController.signal
          );

          // Process batch results immediately
          for (const activity of batchActivities) {
            const mapData = batchResults.get(activity.id);
            if (mapData?.bounds) {
              newEntries[activity.id] = buildCacheEntry(activity, mapData.bounds);
            }
          }

          syncedCount += batchIds.length;

          // Update progress
          if (!isCancelled()) {
            setProgress({
              completed: syncedCount,
              total: newActivities.length,
              status: 'syncing',
              message: `Syncing ${syncedCount}/${newActivities.length} activities...`,
            });
          }
        }
      } catch (batchError) {
        // If aborted, we'll save partial results below
        const isAbortError = batchError instanceof Error && batchError.name === 'AbortError';
        if (isAbortError || isCancelled()) {
          wasAborted = true;
        } else {
          throw batchError; // Re-throw non-abort errors
        }
      }

      // Always save whatever we've collected (even if partial)
      if (Object.keys(newEntries).length > 0) {
        const updatedCache = mergeCacheEntries(
          cacheRef.current,
          newEntries,
          formatLocalDate(new Date()),
          oldest
        );
        await saveCache(updatedCache);
      }

      if (!wasAborted && !isCancelled()) {
        setProgress({
          completed: newActivities.length,
          total: newActivities.length,
          status: 'complete',
          message: `Synced ${Object.keys(newEntries).length} activities`,
        });
      } else {
        // Reset progress since sync was cancelled/aborted
        setProgress({ completed: 0, total: 0, status: 'idle' });
      }
    } catch (error) {
      // Don't report error if sync was cancelled
      const isAbortError = error instanceof Error && error.name === 'AbortError';
      if (isAbortError || isCancelled()) {
        setProgress({ completed: 0, total: 0, status: 'idle' });
        return;
      }
      setProgress({
        completed: 0,
        total: 0,
        status: 'error',
        message: 'Failed to sync activities',
      });
    }
  }, [saveCache]);

  const clearCache = useCallback(async () => {
    try {
      await AsyncStorage.removeItem(CACHE_KEY);
      await AsyncStorage.removeItem(OLDEST_DATE_KEY);
      setCache(null);
      cacheRef.current = null;
      setOldestActivityDate(null);
      setProgress({ completed: 0, total: 0, status: 'idle' });
    } catch {
      // Silently fail - clearing cache is not critical
    }
  }, []);

  // Trigger full historical sync
  const syncAllHistory = useCallback(() => {
    const today = new Date();
    const yearsAgo = new Date(today);
    yearsAgo.setFullYear(yearsAgo.getFullYear() - SYNC.MAX_HISTORY_YEARS);
    syncInBackground(formatLocalDate(yearsAgo), formatLocalDate(today));
  }, [syncInBackground]);

  // Convert cache to array for rendering
  const activities = cache ? Object.values(cache.activities) : [];

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
    oldestActivityDate,
    clearCache,
    cacheStats,
    syncAllHistory,
  };
}

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { intervalsApi } from '@/api';
import { formatLocalDate } from '@/lib';
import type { Activity, ActivityBoundsCache, ActivityBoundsItem, ActivityType } from '@/types';

const CACHE_KEY = 'activity_bounds_cache';
const OLDEST_DATE_KEY = 'oldest_activity_date';
const INITIAL_SYNC_DAYS = 90; // Initial sync period
const BACKGROUND_SYNC_DAYS = 365 * 2; // Background sync for 2 years of history

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

  // Keep cacheRef in sync for background operations
  useEffect(() => {
    cacheRef.current = cache;
  }, [cache]);

  // Load cache from AsyncStorage on mount
  useEffect(() => {
    loadCache();
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
        } catch (e) {
          console.warn('Failed to fetch oldest activity date:', e);
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
        const daysSinceSync = Math.floor((now.getTime() - lastSync.getTime()) / (1000 * 60 * 60 * 24));

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
        daysAgo.setDate(daysAgo.getDate() - INITIAL_SYNC_DAYS);
        await syncDateRange(formatLocalDate(daysAgo), formatLocalDate(today));

        // Then start background sync for older data
        startHistoricalBackgroundSync();
      }
    } catch (error) {
      console.error('Failed to load bounds cache:', error);
      setProgress({ completed: 0, total: 0, status: 'error', message: 'Failed to load cache' });
      setIsReady(true);
    }
  }, []);

  const saveCache = useCallback(async (newCache: ActivityBoundsCache) => {
    try {
      await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(newCache));
      setCache(newCache);
      cacheRef.current = newCache;
    } catch (error) {
      console.error('Failed to save bounds cache:', error);
    }
  }, []);

  // Background sync that doesn't block UI
  const syncInBackground = useCallback(async (oldest: string, newest: string) => {
    if (backgroundSyncRef.current) return; // Already syncing
    backgroundSyncRef.current = true;

    try {
      // Get activities for date range
      const activities = await intervalsApi.getActivities({ oldest, newest });
      const gpsActivities = activities.filter((a) => a.stream_types?.includes('latlng'));

      if (gpsActivities.length === 0) {
        backgroundSyncRef.current = false;
        return;
      }

      // Filter out already cached
      const existingIds = new Set(Object.keys(cacheRef.current?.activities || {}));
      const newActivities = gpsActivities.filter((a) => !existingIds.has(a.id));

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
          newEntries[activity.id] = {
            id: activity.id,
            bounds: mapData.bounds,
            type: activity.type as ActivityType,
            name: activity.name,
            date: activity.start_date_local,
            distance: activity.distance || 0,
            duration: activity.moving_time || 0,
          };
        }
      }

      // Merge with existing cache
      const currentCache = cacheRef.current;
      const updatedCache: ActivityBoundsCache = {
        lastSync: formatLocalDate(new Date()),
        oldestSynced: currentCache?.oldestSynced && currentCache.oldestSynced < oldest
          ? currentCache.oldestSynced
          : oldest,
        activities: {
          ...(currentCache?.activities || {}),
          ...newEntries,
        },
      };

      await saveCache(updatedCache);
      setProgress({ completed: 0, total: 0, status: 'idle' });
    } catch (error) {
      console.error('Background sync failed:', error);
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
    targetDate.setDate(targetDate.getDate() - BACKGROUND_SYNC_DAYS);

    // If we haven't synced back far enough, sync more
    if (oldestSynced > targetDate) {
      const syncFrom = formatLocalDate(targetDate);
      const syncTo = currentCache.oldestSynced;
      // Delay to not compete with initial load
      setTimeout(() => {
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
        console.log('Sync cancelled after fetching activities');
        return;
      }

      // Filter to only GPS-enabled activities
      const gpsActivities = activities.filter(
        (a) => a.stream_types?.includes('latlng')
      );

      if (gpsActivities.length === 0) {
        if (!isCancelled()) {
          setProgress({ completed: 0, total: 0, status: 'complete', message: 'No GPS activities found' });
        }
        return;
      }

      // Filter out already cached activities
      const existingIds = new Set(Object.keys(cacheRef.current?.activities || {}));
      const newActivities = gpsActivities.filter((a) => !existingIds.has(a.id));

      if (newActivities.length === 0) {
        if (!isCancelled()) {
          setProgress({ completed: 0, total: 0, status: 'complete', message: 'All activities already cached' });
        }
        return;
      }

      // Sort activities by date (newest first) so partial syncs are coherent
      // This ensures if we cancel, we have the most recent data complete
      newActivities.sort((a, b) =>
        new Date(b.start_date_local).getTime() - new Date(a.start_date_local).getTime()
      );

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
      // Concurrency of 8 - API allows 30 req/s, client rate-limits to 10 req/s
      const concurrency = 8;
      const ids = newActivities.map((a) => a.id);

      try {
        for (let i = 0; i < ids.length; i += concurrency) {
          // Check if cancelled before starting new batch
          if (isCancelled()) {
            console.log('Sync cancelled, saving partial results');
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
              newEntries[activity.id] = {
                id: activity.id,
                bounds: mapData.bounds,
                type: activity.type as ActivityType,
                name: activity.name,
                date: activity.start_date_local,
                distance: activity.distance || 0,
                duration: activity.moving_time || 0,
              };
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
      } catch (batchError: any) {
        // If aborted, we'll save partial results below
        if (batchError?.name === 'AbortError' || isCancelled()) {
          console.log('Batch fetch aborted, will save partial results');
          wasAborted = true;
        } else {
          throw batchError; // Re-throw non-abort errors
        }
      }

      // Always save whatever we've collected (even if partial)
      if (Object.keys(newEntries).length > 0) {
        // Calculate actual oldest synced date from the entries we have
        const currentCache = cacheRef.current;
        const allEntries = {
          ...(currentCache?.activities || {}),
          ...newEntries,
        };

        // Find the actual oldest date in all cached activities
        let actualOldestSynced: string | null = null;
        for (const entry of Object.values(allEntries)) {
          if (!actualOldestSynced || entry.date < actualOldestSynced) {
            actualOldestSynced = entry.date;
          }
        }

        // Merge with existing cache
        const updatedCache: ActivityBoundsCache = {
          lastSync: formatLocalDate(new Date()),
          oldestSynced: actualOldestSynced || oldest,
          activities: allEntries,
        };

        await saveCache(updatedCache);
        console.log(`Saved ${Object.keys(newEntries).length} activities to cache`);
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
    } catch (error: any) {
      // Don't report error if sync was cancelled
      if (error?.name === 'AbortError' || isCancelled()) {
        console.log('Sync was cancelled');
        setProgress({ completed: 0, total: 0, status: 'idle' });
        return;
      }
      console.error('Failed to sync date range:', error);
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
    } catch (error) {
      console.error('Failed to clear cache:', error);
    }
  }, []);

  // Trigger full historical sync
  const syncAllHistory = useCallback(() => {
    const today = new Date();
    const yearsAgo = new Date(today);
    yearsAgo.setFullYear(yearsAgo.getFullYear() - 10); // Sync up to 10 years
    syncInBackground(formatLocalDate(yearsAgo), formatLocalDate(today));
  }, [syncInBackground]);

  // Convert cache to array for rendering
  const activities = cache ? Object.values(cache.activities) : [];

  // Calculate cache stats from actual cached activities
  const cacheStats: CacheStats = useMemo(() => ({
    totalActivities: activities.length,
    oldestDate: activities.length > 0
      ? activities.reduce((oldest, a) => a.date < oldest ? a.date : oldest, activities[0].date)
      : null,
    newestDate: activities.length > 0
      ? activities.reduce((newest, a) => a.date > newest ? a.date : newest, activities[0].date)
      : null,
    lastSync: cache?.lastSync || null,
    isSyncing: progress.status === 'syncing',
  }), [activities, cache?.lastSync, progress.status]);

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

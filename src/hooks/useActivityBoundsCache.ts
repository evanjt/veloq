import { useState, useEffect, useCallback, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { routeEngine } from 'route-matcher-native';
import { findOldestDate, findNewestDate } from '@/lib';
import { useAuthStore } from '@/providers';
import type { ActivityBoundsCache, ActivityBoundsItem } from '@/types';

export interface SyncProgress {
  completed: number;
  total: number;
  status: 'idle' | 'loading' | 'syncing' | 'complete' | 'error';
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
  /** Trigger sync for last 90 days (used for cache reload) */
  sync90Days: () => void;
}

/**
 * Hook for accessing the activity bounds cache.
 * Simplified version - sync operations are now handled by the Rust engine.
 */
export function useActivityBoundsCache(): UseActivityBoundsCacheReturn {
  const [cache, setCache] = useState<ActivityBoundsCache | null>(null);
  const [progress, setProgress] = useState<SyncProgress>({ completed: 0, total: 0, status: 'idle' });
  const [isReady, setIsReady] = useState(true);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const queryClient = useQueryClient();

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

  // Sync operations are now no-ops - handled by Rust engine
  const syncDateRange = useCallback((oldest: string, newest: string) => {
    // Sync handled by Rust engine
  }, []);

  const clearCache = useCallback(async () => {
    setCache(null);
  }, []);

  const syncAllHistory = useCallback(() => {
    // Sync handled by Rust engine
  }, []);

  const syncOneYear = useCallback(() => {
    // Sync handled by Rust engine
  }, []);

  const sync90Days = useCallback(() => {
    // Clear the Rust engine state
    routeEngine.clear();
    // Invalidate React Query cache to trigger refetch of activities
    queryClient.invalidateQueries({ queryKey: ['activities'] });
  }, [queryClient]);

  return {
    activities,
    progress,
    isReady,
    syncDateRange,
    oldestSyncedDate: cacheStats.oldestDate,
    newestSyncedDate: cacheStats.newestDate,
    oldestActivityDate: null, // Will be populated when activities are synced
    clearCache,
    cacheStats,
    syncAllHistory,
    syncOneYear,
    sync90Days,
  };
}

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@/providers';
import type { ActivityBoundsCache, ActivityBoundsItem } from '@/types';

// Lazy load route engine to avoid native module errors during bundling
let _routeEngine: typeof import('route-matcher-native').routeEngine | null = null;
function getRouteEngine() {
  if (!_routeEngine) {
    try {
      _routeEngine = require('route-matcher-native').routeEngine;
    } catch {
      return null;
    }
  }
  return _routeEngine;
}

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
  activitiesWithDates?: Array<{ start_date?: string; start_date_local?: string }>;
}

interface UseActivityBoundsCacheReturn {
  /** Cached activity bounds (legacy - now empty, use engine instead) */
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
  /** Trigger full historical sync (10 years) */
  syncAllHistory: () => void;
  /** Trigger sync for last year only */
  syncOneYear: () => void;
  /** Trigger sync for last 90 days (used for cache reload) */
  sync90Days: () => void;
}

/**
 * Find oldest date from activities array
 */
function findOldestActivityDate(activities: Array<{ start_date?: string; start_date_local?: string }>): string | null {
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
function findNewestActivityDate(activities: Array<{ start_date?: string; start_date_local?: string }>): string | null {
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
export function useActivityBoundsCache(options: UseActivityBoundsCacheOptions = {}): UseActivityBoundsCacheReturn {
  const { activitiesWithDates } = options;
  const [progress, setProgress] = useState<SyncProgress>({ completed: 0, total: 0, status: 'idle' });
  const [isReady, setIsReady] = useState(true);
  const [activityCount, setActivityCount] = useState(0);
  const queryClient = useQueryClient();

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

    // Subscribe to updates
    const unsubscribe = engine.subscribe('activities', () => {
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
  const cacheStats: CacheStats = useMemo(() => ({
    totalActivities: activityCount,
    oldestDate: activitiesWithDates ? findOldestActivityDate(activitiesWithDates) : null,
    newestDate: activitiesWithDates ? findNewestActivityDate(activitiesWithDates) : null,
    lastSync: null,
    isSyncing: progress.status === 'syncing',
  }), [activityCount, activitiesWithDates, progress.status]);

  // Sync operations are no-ops - handled by Rust engine via useRouteDataSync
  const syncDateRange = useCallback((_oldest: string, _newest: string) => {
    // Sync handled by Rust engine
  }, []);

  const clearCache = useCallback(async () => {
    const engine = getRouteEngine();
    if (engine) engine.clear();
    setActivityCount(0);
  }, []);

  const syncAllHistory = useCallback(() => {
    // Sync handled by Rust engine
  }, []);

  const syncOneYear = useCallback(() => {
    // Sync handled by Rust engine
  }, []);

  const sync90Days = useCallback(async () => {
    // Clear the Rust engine state
    const engine = getRouteEngine();
    if (engine) engine.clear();
    setActivityCount(0);
    // Actively refetch activities (not just invalidate, which only marks stale)
    // Using 'all' type ensures refetch even when no component is watching
    await queryClient.refetchQueries({
      queryKey: ['activities'],
      type: 'all',
    });
  }, [queryClient]);

  return {
    activities: [], // Legacy - now empty, activities are in Rust engine
    progress,
    isReady,
    syncDateRange,
    oldestSyncedDate: cacheStats.oldestDate,
    newestSyncedDate: cacheStats.newestDate,
    oldestActivityDate: null,
    clearCache,
    cacheStats,
    syncAllHistory,
    syncOneYear,
    sync90Days,
  };
}

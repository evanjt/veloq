/**
 * Hook for syncing activity GPS data to the Rust route engine.
 *
 * This bridges the gap between the React Query activity cache
 * and the Rust route engine by fetching GPS data and adding it to the engine.
 */

import { useEffect, useState, useRef, useCallback } from 'react';
import {
  routeEngine,
  fetchActivityMapsWithProgress,
  addFetchProgressListener,
} from 'route-matcher-native';
import { useAuthStore } from '@/providers';
import { getStoredCredentials } from '@/providers';
import type { Activity } from '@/types';

interface SyncProgress {
  status: 'idle' | 'fetching' | 'processing' | 'complete' | 'error';
  completed: number;
  total: number;
  message: string;
}

interface UseRouteDataSyncResult {
  /** Current sync progress */
  progress: SyncProgress;
  /** Whether sync is in progress */
  isSyncing: boolean;
  /** Manually trigger sync for given activities */
  syncActivities: (activities: Activity[]) => Promise<void>;
}

/**
 * Syncs activity GPS data to the Rust route engine.
 *
 * Call this hook with activities that need GPS data fetched.
 * It will automatically fetch GPS data and add to the engine.
 *
 * @param activities - Activities to sync (should have GPS data available)
 * @param enabled - Whether to automatically sync when activities change
 */
export function useRouteDataSync(
  activities: Activity[] | undefined,
  enabled: boolean = true
): UseRouteDataSyncResult {
  const [progress, setProgress] = useState<SyncProgress>({
    status: 'idle',
    completed: 0,
    total: 0,
    message: '',
  });

  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isDemoMode = useAuthStore((s) => s.isDemoMode);
  const isSyncingRef = useRef(false);

  const syncActivities = useCallback(async (activitiesToSync: Activity[]) => {
    // Don't sync if not authenticated or in demo mode
    if (!isAuthenticated || isDemoMode) {
      return;
    }

    // Use engine state for synced IDs - more robust than JS ref
    // This persists across component remounts and correctly resets after clear()
    const engineActivityIds = new Set(routeEngine.getActivityIds());

    // Filter to activities with GPS that aren't already in the engine
    const withGps = activitiesToSync.filter(
      (a) => a.stream_types?.includes('latlng') && !engineActivityIds.has(a.id)
    );

    if (withGps.length === 0) {
      return;
    }

    // Prevent concurrent syncs
    if (isSyncingRef.current) {
      return;
    }
    isSyncingRef.current = true;

    try {
      // Get API credentials
      const creds = await getStoredCredentials();
      if (!creds?.apiKey) {
        throw new Error('No API key available');
      }

      setProgress({
        status: 'fetching',
        completed: 0,
        total: withGps.length,
        message: 'Fetching GPS data...',
      });

      // Set up progress listener
      const subscription = addFetchProgressListener((event) => {
        setProgress((p) => ({
          ...p,
          completed: event.completed,
          total: event.total,
        }));
      });

      try {
        // Fetch GPS data using Rust HTTP client
        const activityIds = withGps.map((a) => a.id);
        const results = await fetchActivityMapsWithProgress(creds.apiKey, activityIds);

        setProgress({
          status: 'processing',
          completed: 0,
          total: results.length,
          message: 'Processing routes...',
        });

        // Build flat coordinate arrays for the engine
        const successfulResults = results.filter((r) => r.success && r.latlngs.length >= 4);

        if (successfulResults.length > 0) {
          const ids: string[] = [];
          const allCoords: number[] = [];
          const offsets: number[] = [];
          const sportTypes: string[] = [];

          for (const result of successfulResults) {
            const activity = withGps.find((a) => a.id === result.activityId);
            if (!activity) continue;

            ids.push(result.activityId);
            offsets.push(allCoords.length / 2);
            sportTypes.push(activity.type || 'Ride');

            // Add coordinates (already in lat, lng format from Rust)
            allCoords.push(...result.latlngs);
            // Note: No need to track synced IDs in JS - the engine tracks them
          }

          // Add to engine (async to avoid blocking UI)
          if (ids.length > 0) {
            await routeEngine.addActivities(ids, allCoords, offsets, sportTypes);
          }
        }

        setProgress({
          status: 'complete',
          completed: successfulResults.length,
          total: withGps.length,
          message: `Synced ${successfulResults.length} activities`,
        });
      } finally {
        subscription.remove();
      }
    } catch (error) {
      setProgress({
        status: 'error',
        completed: 0,
        total: 0,
        message: error instanceof Error ? error.message : 'Sync failed',
      });
    } finally {
      isSyncingRef.current = false;
    }
  }, [isAuthenticated, isDemoMode]);

  // Auto-sync when activities change
  useEffect(() => {
    if (!enabled || !activities || activities.length === 0) {
      return;
    }

    syncActivities(activities);
  }, [enabled, activities, syncActivities]);

  return {
    progress,
    isSyncing: progress.status === 'fetching' || progress.status === 'processing',
    syncActivities,
  };
}

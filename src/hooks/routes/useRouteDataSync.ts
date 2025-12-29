/**
 * Hook for syncing activity GPS data to the Rust route engine.
 *
 * This bridges the gap between the React Query activity cache
 * and the Rust route engine by fetching GPS data and adding it to the engine.
 */

import { useEffect, useState, useRef, useCallback } from 'react';
import { useAuthStore } from '@/providers';

// Lazy load native module to avoid bundler errors
let _nativeModule: typeof import('route-matcher-native') | null = null;
function getNativeModule() {
  if (!_nativeModule) {
    try {
      _nativeModule = require('route-matcher-native');
    } catch {
      return null;
    }
  }
  return _nativeModule;
}
import { getStoredCredentials } from '@/providers';
import type { Activity } from '@/types';

interface SyncProgress {
  status: 'idle' | 'fetching' | 'processing' | 'computing' | 'complete' | 'error';
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
    const nativeModule = getNativeModule();
    if (!nativeModule) return;
    const engineActivityIds = new Set(nativeModule.routeEngine.getActivityIds());

    // Detect if this is initial sync (engine empty) vs incremental (engine has data)
    const isInitialSync = engineActivityIds.size === 0;

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
      const subscription = nativeModule.addFetchProgressListener((event) => {
        setProgress((p) => ({
          ...p,
          completed: event.completed,
          total: event.total,
        }));
      });

      try {
        // Fetch GPS data using Rust HTTP client
        const activityIds = withGps.map((a) => a.id);
        const results = await nativeModule.fetchActivityMapsWithProgress(creds.apiKey, activityIds);

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
            await nativeModule.routeEngine.addActivities(ids, allCoords, offsets, sportTypes);
          }
        }

        // Note: Route computation is now deferred to when user navigates to routes screen
        // This avoids the O(n²) full grouping computation during sync
        // The Rust engine uses lazy computation - groups are computed on first access
        // TODO: Implement incremental grouping in Rust engine for true O(n×m) updates

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

  // Counter to force re-sync after engine reset
  const [syncTrigger, setSyncTrigger] = useState(0);

  // Listen for engine reset (cache clear) and force a resync
  useEffect(() => {
    const nativeModule = getNativeModule();
    if (!nativeModule) return;

    const unsubscribe = nativeModule.routeEngine.subscribe('syncReset', () => {
      // Reset syncing state so next sync can proceed
      isSyncingRef.current = false;
      // Increment trigger to force useEffect to re-run after activities are refetched
      setSyncTrigger(prev => prev + 1);
    });

    return unsubscribe;
  }, []);

  // Auto-sync when activities change or after engine reset
  useEffect(() => {
    if (!enabled || !activities || activities.length === 0) {
      return;
    }

    syncActivities(activities);
  }, [enabled, activities, syncActivities, syncTrigger]);

  return {
    progress,
    isSyncing: progress.status === 'fetching' || progress.status === 'processing' || progress.status === 'computing',
    syncActivities,
  };
}

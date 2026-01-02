/**
 * Hook for syncing activity GPS data to the Rust route engine.
 *
 * This bridges the gap between the React Query activity cache
 * and the Rust route engine by fetching GPS data and adding it to the engine.
 */

import { useEffect, useState, useRef, useCallback } from 'react';
import { InteractionManager } from 'react-native';
import { useAuthStore, getStoredCredentials, useNetwork } from '@/providers';
import { getNativeModule } from '@/lib/native/routeEngine';
import { routeEngine, type ActivityMetrics } from 'route-matcher-native';
import {
  loadCustomSections,
  saveSectionMatches,
  loadSectionMatches,
} from '@/lib/storage/customSections';
import { matchActivityToCustomSection } from '@/lib/sectionMatcher';
import type { Activity, CustomSectionMatch } from '@/types';

/**
 * Convert Activity to ActivityMetrics for Rust engine.
 */
function toActivityMetrics(activity: Activity): ActivityMetrics {
  return {
    activityId: activity.id,
    name: activity.name,
    date: Math.floor(new Date(activity.start_date_local).getTime() / 1000),
    distance: activity.distance,
    movingTime: activity.moving_time,
    elapsedTime: activity.elapsed_time,
    elevationGain: activity.total_elevation_gain || 0,
    avgHr: activity.average_heartrate,
    avgPower: activity.average_watts,
    sportType: activity.type || 'Ride',
  };
}

/**
 * Sync newly synced activities against existing custom sections.
 * Checks if any of the synced activities match custom sections and updates matches.
 */
async function syncActivitiesWithCustomSections(activityIds: string[]): Promise<void> {
  if (activityIds.length === 0) return;

  try {
    // Load all custom sections
    const sections = await loadCustomSections();
    if (sections.length === 0) return;

    // For each section, check if any new activities match
    for (const section of sections) {
      // Load existing matches
      const existingMatches = await loadSectionMatches(section.id);
      const existingActivityIds = new Set(existingMatches.map((m) => m.activityId));

      // Check each new activity
      const newMatches: CustomSectionMatch[] = [];
      for (const activityId of activityIds) {
        // Skip if already matched
        if (existingActivityIds.has(activityId)) continue;

        const match = await matchActivityToCustomSection(section, activityId);
        if (match) {
          newMatches.push(match);
        }
      }

      // Save new matches if any were found
      if (newMatches.length > 0) {
        await saveSectionMatches(section.id, [...existingMatches, ...newMatches]);
      }
    }
  } catch (error) {
    // Log but don't throw - custom section sync is non-critical
    console.warn('Failed to sync custom sections:', error);
  }
}

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
  const { isOnline } = useNetwork();

  // Use refs to track current values without causing callback recreation
  // This prevents race conditions from callback reference changes
  const isAuthenticatedRef = useRef(isAuthenticated);
  const isDemoModeRef = useRef(isDemoMode);
  const isOnlineRef = useRef(isOnline);
  const isSyncingRef = useRef(false);
  const isMountedRef = useRef(true);
  const syncAbortRef = useRef<AbortController | null>(null);

  // Keep refs in sync with current values
  useEffect(() => {
    isAuthenticatedRef.current = isAuthenticated;
    isDemoModeRef.current = isDemoMode;
    isOnlineRef.current = isOnline;
  }, [isAuthenticated, isDemoMode, isOnline]);

  // Track component mount state to prevent state updates after unmount
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      // Abort any in-progress sync on unmount
      syncAbortRef.current?.abort();
    };
  }, []);

  const syncActivities = useCallback(async (activitiesToSync: Activity[]) => {
    // Use refs for current values to avoid stale closures
    const isAuth = isAuthenticatedRef.current;
    const isDemo = isDemoModeRef.current;
    const online = isOnlineRef.current;

    // Don't sync if not authenticated or already unmounted
    if (!isAuth || !isMountedRef.current) return;

    // Skip sync when offline - GPS fetch requires network
    // Existing synced activities will still work from the engine cache
    if (!online) {
      if (isMountedRef.current) {
        setProgress({
          status: 'idle',
          completed: 0,
          total: 0,
          message: 'Offline - using cached routes',
        });
      }
      return;
    }

    // Prevent concurrent syncs with atomic-like check using closure
    // JavaScript is single-threaded, so this is safe within one event loop tick
    if (isSyncingRef.current) {
      return;
    }
    isSyncingRef.current = true;

    // Create abort controller for this sync operation
    const abortController = new AbortController();
    syncAbortRef.current = abortController;

    // Use engine state for synced IDs - more robust than JS ref
    // This persists across component remounts and correctly resets after clear()
    const nativeModule = getNativeModule();
    if (!nativeModule) {
      isSyncingRef.current = false;
      return;
    }

    const engineActivityIds = new Set(nativeModule.routeEngine.getActivityIds());

    // Filter to activities with GPS that aren't already in the engine
    const withGps = activitiesToSync.filter(
      (a) => a.stream_types?.includes('latlng') && !engineActivityIds.has(a.id)
    );

    if (withGps.length === 0) {
      isSyncingRef.current = false;
      return;
    }

    try {
      // Check for abort before starting
      if (abortController.signal.aborted) {
        isSyncingRef.current = false;
        return;
      }

      // Handle demo mode differently - use fixtures instead of API
      if (isDemo) {
        if (isMountedRef.current) {
          setProgress({
            status: 'fetching',
            completed: 0,
            total: withGps.length,
            message: 'Loading demo GPS data...',
          });
        }

        // Import demo fixtures
        const { getActivityMap } = require('@/data/demo/fixtures');

        const ids: string[] = [];
        const allCoords: number[] = [];
        const offsets: number[] = [];
        const sportTypes: string[] = [];

        for (const activity of withGps) {
          const map = getActivityMap(activity.id, false);
          if (!map?.latlngs || map.latlngs.length < 4) {
            continue;
          }

          ids.push(activity.id);
          offsets.push(allCoords.length / 2);
          sportTypes.push(activity.type || 'Ride');

          // Add coordinates (latlngs are [[lat, lng], ...])
          for (const coord of map.latlngs) {
            if (coord && coord.length >= 2) {
              allCoords.push(coord[0], coord[1]);
            }
          }
        }

        if (ids.length > 0 && isMountedRef.current) {
          await nativeModule.routeEngine.addActivities(ids, allCoords, offsets, sportTypes);

          // Sync activity metrics to engine for performance calculations
          const syncedActivities = withGps.filter((a) => ids.includes(a.id));
          const metrics = syncedActivities.map(toActivityMetrics);
          routeEngine.setActivityMetrics(metrics);

          // Sync with custom sections (non-blocking)
          syncActivitiesWithCustomSections(ids).catch(() => {});

          // Start section detection in the background (persistent mode only)
          nativeModule.routeEngine.startSectionDetection();
        }

        if (isMountedRef.current) {
          setProgress({
            status: 'complete',
            completed: ids.length,
            total: withGps.length,
            message: `Synced ${ids.length} demo activities`,
          });
        }

        return;
      }

      // Real API mode
      // Get API credentials
      const creds = await getStoredCredentials();
      if (!isMountedRef.current || abortController.signal.aborted) return;

      if (!creds?.apiKey) {
        throw new Error('No API key available');
      }

      setProgress({
        status: 'fetching',
        completed: 0,
        total: withGps.length,
        message: 'Fetching GPS data...',
      });

      // Set up progress listener with mount guard and abort check
      const subscription = nativeModule.addFetchProgressListener((event) => {
        // Check both mount state and abort signal
        if (!isMountedRef.current || abortController.signal.aborted) {
          return;
        }
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

        // Check mount state and abort signal after async operation
        if (!isMountedRef.current || abortController.signal.aborted) return;

        setProgress({
          status: 'processing',
          completed: 0,
          total: results.length,
          message: 'Processing routes...',
        });

        // Build flat coordinate arrays for the engine
        const successfulResults = results.filter((r) => r.success && r.latlngs.length >= 4);

        if (successfulResults.length > 0 && isMountedRef.current) {
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
          }

          // Add to engine (async to avoid blocking UI)
          if (ids.length > 0 && isMountedRef.current) {
            await nativeModule.routeEngine.addActivities(ids, allCoords, offsets, sportTypes);

            // Sync activity metrics to engine for performance calculations
            const syncedActivities = withGps.filter((a) => ids.includes(a.id));
            const metrics = syncedActivities.map(toActivityMetrics);
            routeEngine.setActivityMetrics(metrics);

            // Sync with custom sections (non-blocking)
            syncActivitiesWithCustomSections(ids).catch(() => {});

            // Start section detection in the background (persistent mode only)
            // This detects frequent road sections across all synced activities
            nativeModule.routeEngine.startSectionDetection();
          }
        }

        // Note: Route computation is now deferred to when user navigates to routes screen
        // The Rust engine uses lazy computation - groups are computed on first access
        // When new activities are added to an engine with existing groups, incremental
        // grouping is used (O(n×m) instead of O(n²)), comparing only new signatures
        // against existing + new signatures, not re-comparing all existing pairs.

        if (isMountedRef.current) {
          setProgress({
            status: 'complete',
            completed: successfulResults.length,
            total: withGps.length,
            message: `Synced ${successfulResults.length} activities`,
          });
        }
      } finally {
        subscription.remove();
      }
    } catch (error) {
      if (isMountedRef.current) {
        setProgress({
          status: 'error',
          completed: 0,
          total: 0,
          message: error instanceof Error ? error.message : 'Sync failed',
        });
      }
    } finally {
      isSyncingRef.current = false;
      syncAbortRef.current = null;
    }
    // Empty dependency array - callback reads current values from refs
    // This ensures stable callback identity and prevents race conditions
  }, []);

  // Counter to force re-sync after engine reset or reconnection
  const [syncTrigger, setSyncTrigger] = useState(0);

  // Track previous online state to detect reconnection
  const wasOnlineRef = useRef(isOnline);

  // Trigger resync when coming back online
  useEffect(() => {
    if (isOnline && !wasOnlineRef.current) {
      // Just came back online - increment trigger to resync
      setSyncTrigger((prev) => prev + 1);
    }
    wasOnlineRef.current = isOnline;
  }, [isOnline]);

  // Listen for engine reset (cache clear) and force a resync
  useEffect(() => {
    const nativeModule = getNativeModule();
    if (!nativeModule) return;

    const unsubscribe = nativeModule.routeEngine.subscribe('syncReset', () => {
      // Reset syncing state so next sync can proceed
      isSyncingRef.current = false;
      // Increment trigger to force useEffect to re-run after activities are refetched
      setSyncTrigger((prev) => prev + 1);
    });

    return unsubscribe;
  }, []);

  // Auto-sync when activities change or after engine reset
  // Use InteractionManager to avoid blocking navigation animations
  useEffect(() => {
    if (!enabled || !activities || activities.length === 0) {
      return;
    }

    // Defer heavy processing until after navigation/animations complete
    const task = InteractionManager.runAfterInteractions(() => {
      syncActivities(activities);
    });

    return () => task.cancel();
  }, [enabled, activities, syncActivities, syncTrigger]);

  return {
    progress,
    isSyncing:
      progress.status === 'fetching' ||
      progress.status === 'processing' ||
      progress.status === 'computing',
    syncActivities,
  };
}

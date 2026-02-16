/**
 * @fileoverview useRouteDataSync - Route data sync orchestrator
 *
 * **Refactored Architecture** (Phase 1 Complete)
 *
 * Original 441-line file split into focused modules:
 *
 * **Extracted Modules:**
 * 1. `useRouteSyncProgress.ts` (88 lines)
 *    - Progress state management with mount guards
 *    - Derives isSyncing from progress status
 *
 * 2. `useRouteSyncContext.ts` (140 lines)
 *    - Lifecycle refs (auth, demo mode, online, syncing)
 *    - Abort controller management
 *    - Sync state coordination
 *
 * 3. `useGpsDataFetcher.ts` (270 lines)
 *    - Demo mode GPS loading from fixtures
 *    - Real API GPS fetching via Rust HTTP client
 *    - Progress tracking and coordinate building
 *
 * 4. `activityMetrics.ts` (38 lines)
 *    - Activity to ActivityMetrics conversion
 *
 * **Orchestrator (this file - 240 lines):**
 * - Coordinates sync flow
 * - Manages sync triggers (reset, reconnection)
 * - Delegates to specialized hooks
 * - Auto-syncs on activity changes
 *
 * **Benefits:**
 * - Each module has single responsibility
 * - Easier to test individual pieces
 * - Clearer data flow
 * - Better code organization
 *
 * Original file backed up as `useRouteDataSync.ts.backup`
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import { InteractionManager } from 'react-native';
import { useRouteSyncProgress } from './useRouteSyncProgress';
import { useRouteSyncContext, resetGlobalSyncState } from './useRouteSyncContext';
import { useGpsDataFetcher } from './useGpsDataFetcher';
import { getNativeModule } from '@/lib/native/routeEngine';
import { routeEngine } from 'veloqrs';
import { toActivityMetrics } from '@/lib/utils/activityMetrics';
import { useSyncDateRange } from '@/providers';
import type { Activity } from '@/types';
import type { SyncProgress } from './useRouteSyncProgress';

interface UseRouteDataSyncResult {
  /** Current sync progress */
  progress: SyncProgress;
  /** Whether sync is in progress */
  isSyncing: boolean;
  /** Manually trigger sync for given activities */
  syncActivities: (activities: Activity[]) => Promise<void>;
}

export type { SyncProgress };

/**
 * Orchestrates activity GPS data synchronization to the Rust route engine.
 *
 * **High-Level Flow:**
 * 1. Check auth, online status, and concurrent sync state
 * 2. Filter activities to those with GPS not yet in engine
 * 3. Fetch GPS (demo fixtures or real API based on mode)
 * 4. Add to engine with metrics and trigger section detection
 * 5. Update progress throughout
 *
 * **Triggers:**
 * - Activities list changes
 * - Engine reset (cache clear)
 * - Network reconnection
 * - Manual trigger via syncActivities()
 *
 * **Delegation:**
 * - Progress state → useRouteSyncProgress
 * - Lifecycle refs → useRouteSyncContext
 * - GPS fetching → useGpsDataFetcher
 *
 * @param activities - Activities to sync (should have GPS data available)
 * @param enabled - Whether to automatically sync when activities change
 *
 * @example
 * ```tsx
 * function ActivityList({ activities }: Props) {
 *   const { progress, isSyncing } = useRouteDataSync(activities, true);
 *
 *   return (
 *     <View>
 *       <Text>Status: {progress.message}</Text>
 *       {activities.map(activity => <ActivityCard key={activity.id} {...activity} />)}
 *     </View>
 *   );
 * }
 * ```
 */
export function useRouteDataSync(
  activities: Activity[] | undefined,
  enabled: boolean = true
): UseRouteDataSyncResult {
  // Extracted hooks
  const { progress, isSyncing, updateProgress, isMountedRef } = useRouteSyncProgress();
  const setGpsSyncProgress = useSyncDateRange((s) => s.setGpsSyncProgress);

  // Sync progress to shared store whenever it changes
  // This allows other screens to read progress without calling useRouteDataSync themselves
  useEffect(() => {
    setGpsSyncProgress(progress);
  }, [progress, setGpsSyncProgress]);
  const {
    isAuthenticatedRef,
    isDemoModeRef,
    isOnlineRef,
    isSyncingRef,
    syncAbortRef,
    createAbortController,
    canStartSync,
    markSyncComplete,
  } = useRouteSyncContext();
  const { fetchDemoGps, fetchApiGps } = useGpsDataFetcher();

  /**
   * Main sync orchestration function.
   *
   * Coordinates the entire sync process from filtering to fetching to engine population.
   */
  const syncActivities = useCallback(
    async (activitiesToSync: Activity[]) => {
      // Get current values from refs
      const isAuth = isAuthenticatedRef.current;
      const isDemo = isDemoModeRef.current;
      const online = isOnlineRef.current;

      // Don't sync if not authenticated or already unmounted
      if (!isAuth || !isMountedRef.current) {
        if (__DEV__) {
          console.log(`[RouteDataSync] Blocked: isAuth=${isAuth}, mounted=${isMountedRef.current}`);
        }
        return;
      }

      // Skip sync when offline - GPS fetch requires network
      // Existing synced activities will still work from the engine cache
      if (!online) {
        if (__DEV__) {
          console.log('[RouteDataSync] Blocked: offline');
        }
        if (isMountedRef.current) {
          updateProgress({
            status: 'idle',
            completed: 0,
            total: 0,
            percent: 0,
            message: 'Offline - using cached routes',
          });
        }
        return;
      }

      // Prevent concurrent syncs
      if (!canStartSync()) {
        if (__DEV__) {
          console.log('[RouteDataSync] Blocked: sync already in progress');
        }
        return;
      }

      // Create abort controller for this sync operation
      const abortController = createAbortController();

      try {
        // Get native module
        const nativeModule = getNativeModule();
        if (!nativeModule) {
          if (__DEV__) {
            console.warn('[RouteDataSync] Native module not available');
          }
          if (isMountedRef.current) {
            updateProgress({
              status: 'complete',
              completed: 0,
              total: 0,
              percent: 0,
              message: 'Native module unavailable',
            });
          }
          markSyncComplete();
          return;
        }

        // Check engine state for already-synced activities
        const engineActivityIds = new Set(nativeModule.routeEngine.getActivityIds());

        // Filter to activities with GPS that aren't already in the engine
        const withGps = activitiesToSync.filter(
          (a) => a.stream_types?.includes('latlng') && !engineActivityIds.has(a.id)
        );

        if (__DEV__) {
          const totalGps = activitiesToSync.filter((a) =>
            a.stream_types?.includes('latlng')
          ).length;
          console.log(
            `[RouteDataSync] Activities: ${activitiesToSync.length} total, ` +
              `${totalGps} with GPS, ${withGps.length} new to sync, ` +
              `${engineActivityIds.size} already in engine, isDemo: ${isDemo}`
          );
        }

        // Populate activity metrics early so weekly stats appear immediately.
        // Metrics only need activity metadata (date, duration, type) which is
        // available from the activity list API response — no GPS needed.
        const allMetrics = activitiesToSync
          .filter((a) => a.start_date_local && a.moving_time)
          .map(toActivityMetrics);
        if (allMetrics.length > 0) {
          nativeModule.routeEngine.setActivityMetrics(allMetrics);
          routeEngine.triggerRefresh('activities');
        }

        if (withGps.length === 0) {
          if (__DEV__) {
            console.log('[RouteDataSync] No new activities to sync');
          }
          // Set complete status so lastSyncTimestamp is updated
          if (isMountedRef.current) {
            updateProgress({
              status: 'complete',
              completed: engineActivityIds.size,
              total: engineActivityIds.size,
              percent: 100,
              message: 'All activities synced',
            });
          }
          markSyncComplete();
          return;
        }

        if (__DEV__) {
          console.log(`[RouteDataSync] Starting GPS fetch for ${withGps.length} activities...`);
        }

        // Fetch GPS data (demo or real API mode)
        if (isDemo) {
          await fetchDemoGps(withGps, {
            isMountedRef,
            abortSignal: abortController.signal,
            updateProgress,
          });
        } else {
          await fetchApiGps(withGps, {
            isMountedRef,
            abortSignal: abortController.signal,
            updateProgress,
          });
        }
      } catch (error) {
        if (__DEV__) {
          console.error('[RouteDataSync] Error during sync:', error);
        }
        // Update progress with error
        if (isMountedRef.current) {
          updateProgress({
            status: 'error',
            completed: 0,
            total: 0,
            percent: 0,
            message: error instanceof Error ? error.message : 'Sync failed',
          });
        }
      } finally {
        if (__DEV__) {
          console.log('[RouteDataSync] Sync complete (finally block)');
        }
        // Always mark sync complete
        markSyncComplete();
      }
    },
    [
      isAuthenticatedRef,
      isDemoModeRef,
      isOnlineRef,
      isMountedRef,
      updateProgress,
      canStartSync,
      createAbortController,
      markSyncComplete,
      fetchDemoGps,
      fetchApiGps,
    ]
  );

  // Counter to force re-sync after engine reset or reconnection
  const [syncTrigger, setSyncTrigger] = useState(0);

  // Track previous online state to detect reconnection
  const wasOnlineRef = useRef(isOnlineRef.current);

  // Trigger resync when coming back online
  useEffect(() => {
    const isOnline = isOnlineRef.current;
    if (isOnline && !wasOnlineRef.current) {
      // Just came back online - increment trigger to resync
      setSyncTrigger((prev) => prev + 1);
    }
    wasOnlineRef.current = isOnline;
  }, [isOnlineRef]);

  // Listen for engine reset (cache clear) and force a resync
  useEffect(() => {
    const nativeModule = getNativeModule();
    if (!nativeModule) return;

    const unsubscribe = nativeModule.routeEngine.subscribe('syncReset', () => {
      // Reset GLOBAL syncing state so next sync can proceed
      // Note: Don't directly mutate isSyncingRef.current here - resetGlobalSyncState()
      // handles the global mutex, and each component's local ref should be managed
      // through markSyncComplete() in its own sync lifecycle
      resetGlobalSyncState();
      // Increment trigger to force useEffect to re-run after activities are refetched
      setSyncTrigger((prev) => prev + 1);
    });

    return unsubscribe;
  }, [isSyncingRef]);

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
    isSyncing,
    syncActivities,
  };
}

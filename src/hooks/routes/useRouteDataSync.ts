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
import { i18n } from '@/i18n';
import { getNativeModule } from '@/lib/native/routeEngine';
import { routeEngine } from 'veloqrs';
import { intervalsApi } from '@/api';
import { toActivityMetrics } from '@/lib/utils/activityMetrics';
import { useSyncDateRange, getStoredCredentials } from '@/providers';
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
            message: i18n.t('cache.offlineUsingCached'),
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

        // Sync metrics only for activities not already in the engine.
        // Uses metric IDs (all activities) not GPS activity IDs (GPS-only) to avoid
        // re-writing indoor/non-GPS activities on every startup.
        const cachedMetricIds = new Set(nativeModule.routeEngine.getActivityMetricIds());
        const newActivities = activitiesToSync.filter((a) => !cachedMetricIds.has(a.id));
        if (__DEV__) {
          console.log(
            `[RouteDataSync] Metrics: ${cachedMetricIds.size} cached, ${newActivities.length} new`
          );
        }
        if (newActivities.length > 0) {
          const newMetrics = newActivities
            .filter((a) => a.start_date_local && a.moving_time)
            .map(toActivityMetrics);
          if (newMetrics.length > 0) {
            nativeModule.routeEngine.setActivityMetrics(newMetrics);
            routeEngine.triggerRefresh('activities');
          }
        }

        // Batch-fetch FIT files for WeightTraining activities not yet processed
        if (!isDemoModeRef.current) {
          const strengthIds = activitiesToSync
            .filter((a) => a.type === 'WeightTraining')
            .map((a) => a.id);

          if (
            strengthIds.length > 0 &&
            typeof nativeModule.routeEngine.getUnprocessedStrengthIds === 'function'
          ) {
            const unprocessed = nativeModule.routeEngine.getUnprocessedStrengthIds(strengthIds);
            if (unprocessed.length > 0) {
              if (__DEV__) {
                console.log(
                  `[RouteDataSync] Fetching FIT files for ${unprocessed.length} strength activities`
                );
              }
              try {
                const creds = getStoredCredentials();
                let authHeader: string;
                if (creds.authMethod === 'oauth' && creds.accessToken) {
                  authHeader = `Bearer ${creds.accessToken}`;
                } else if (creds.apiKey) {
                  authHeader = `Basic ${btoa(`API_KEY:${creds.apiKey}`)}`;
                } else {
                  authHeader = '';
                }
                if (authHeader) {
                  const processed = nativeModule.routeEngine.batchFetchExerciseSets(
                    authHeader,
                    unprocessed
                  );
                  if (__DEV__) {
                    console.log(
                      `[RouteDataSync] FIT batch complete: ${processed.length}/${unprocessed.length}`
                    );
                  }
                }
              } catch (err) {
                if (__DEV__) {
                  console.error('[RouteDataSync] FIT batch fetch error:', err);
                }
              }
            }
          }
        }

        if (withGps.length === 0) {
          // Check if section detection was interrupted and needs to recover
          const stats = routeEngine.getStats();
          if (stats?.sectionsDirty && isMountedRef.current) {
            if (__DEV__) {
              console.log(
                '[RouteDataSync] No new GPS, but sectionsDirty — triggering section detection'
              );
            }
            updateProgress({
              status: 'computing',
              completed: 0,
              total: 0,
              percent: 0,
              message: 'Analyzing routes...',
            });

            const started = nativeModule.routeEngine.startSectionDetection();
            if (started) {
              const pollInterval = 150;
              const maxPollTime = 60000;
              const startTime = Date.now();
              while (isMountedRef.current) {
                const detectionStatus = nativeModule.routeEngine.pollSectionDetection();
                if (detectionStatus !== 'running' || Date.now() - startTime > maxPollTime) break;
                await new Promise((resolve) => setTimeout(resolve, pollInterval));
              }
              routeEngine.triggerRefresh('groups');
              routeEngine.triggerRefresh('sections');

              // Poll heatmap tile generation (runs on Rust background thread) and surface
              // processed/total so the user sees forward motion instead of a frozen bar.
              // Foreground wait capped at 5 s (Tier 1.2); Rust keeps rendering in background
              // if we bail out early and the map will pick up tiles as they land.
              const tileStatus = routeEngine.pollTileGeneration();
              if (tileStatus === 'running' && isMountedRef.current) {
                const initialTileProgress = routeEngine.getHeatmapTileProgress();
                const tileTotal =
                  initialTileProgress && initialTileProgress.length >= 2
                    ? initialTileProgress[1]
                    : 0;
                const maxPoll =
                  tileTotal > 0 ? Math.min(5_000, Math.max(2_000, tileTotal * 10)) : 3_000;
                const tileStartTime = Date.now();
                while (isMountedRef.current) {
                  await new Promise((resolve) => setTimeout(resolve, 200));
                  const s = routeEngine.pollTileGeneration();
                  const progress = routeEngine.getHeatmapTileProgress();
                  if (progress && progress.length >= 2 && progress[1] > 0) {
                    const [processed, total] = progress;
                    const tilePct = Math.min(100, Math.round((processed / total) * 100));
                    const pct = 75 + Math.min(processed / total, 1) * 25;
                    updateProgress({
                      status: 'computing',
                      completed: 0,
                      total: 0,
                      percent: Math.min(100, Math.round(pct)),
                      message: i18n.t('cache.finalizingHeatmap', { percent: tilePct }),
                    });
                  }
                  if (s !== 'running' || Date.now() - tileStartTime > maxPoll) break;
                }
              }
            }
          } else if (__DEV__) {
            console.log('[RouteDataSync] No new activities to sync');
          }

          // Backfill: fetch time streams for activities with NULL lap_time (upgrade path).
          // Report progress per-batch so the sync banner keeps moving; the loop is up to
          // ~20 s on a large cache and previously reported nothing.
          if (isMountedRef.current && !isDemo) {
            try {
              const needingStreams = routeEngine.getActivitiesNeedingTimeStreams();
              if (needingStreams.length > 0) {
                if (__DEV__) {
                  console.log(
                    `[RouteDataSync] Backfilling time streams for ${needingStreams.length} activities`
                  );
                }
                const batchSize = 10;
                const totalStreams = needingStreams.length;
                const backfillStreams: Array<{ activityId: string; times: number[] }> = [];
                let completedStreams = 0;

                if (isMountedRef.current) {
                  updateProgress({
                    status: 'fetching',
                    completed: 0,
                    total: totalStreams,
                    percent: 50,
                    message: i18n.t('cache.fetchingTimeStreams', {
                      percent: 50,
                      completed: 0,
                      total: totalStreams,
                    }),
                  });
                }

                for (let i = 0; i < needingStreams.length; i += batchSize) {
                  if (!isMountedRef.current) break;
                  const batch = needingStreams.slice(i, i + batchSize);
                  const results = await Promise.all(
                    batch.map(async (activityId) => {
                      try {
                        const streams = await intervalsApi.getActivityStreams(activityId, ['time']);
                        return { activityId, times: (streams.time as number[]) || [] };
                      } catch {
                        return { activityId, times: [] as number[] };
                      }
                    })
                  );
                  for (const r of results) {
                    if (r.times.length > 0) backfillStreams.push(r);
                  }
                  completedStreams += batch.length;
                  if (isMountedRef.current) {
                    updateProgress({
                      status: 'fetching',
                      completed: completedStreams,
                      total: totalStreams,
                      percent: 50,
                      message: i18n.t('cache.fetchingTimeStreams', {
                        percent: 50,
                        completed: completedStreams,
                        total: totalStreams,
                      }),
                    });
                  }
                }
                if (backfillStreams.length > 0 && isMountedRef.current) {
                  routeEngine.setTimeStreams(backfillStreams);
                  if (__DEV__) {
                    console.log(
                      `[RouteDataSync] Backfilled ${backfillStreams.length}/${needingStreams.length} time streams`
                    );
                  }
                }
              }
            } catch {
              // Non-critical — will retry next sync
            }
          }

          // Set complete status so lastSyncTimestamp is updated
          if (isMountedRef.current) {
            updateProgress({
              status: 'complete',
              completed: engineActivityIds.size,
              total: engineActivityIds.size,
              percent: 100,
              message: i18n.t('cache.allActivitiesSynced'),
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

import { useEffect, useState, useCallback } from 'react';
import { InteractionManager } from 'react-native';
import { useRouteSyncProgress } from './useRouteSyncProgress';
import { useRouteSyncContext, resetGlobalSyncState } from './useRouteSyncContext';
import { useGpsDataFetcher } from './useGpsDataFetcher';
import { i18n } from '@/i18n';
import { getNativeModule } from '@/shared/native/engine';
import { engine } from 'veloqrs';
import { toActivityMetrics } from '@/features/activity/lib/activityMetrics';
import { useSyncDateRange } from '@/shared/app/SyncDateRangeStore';
import { useReconnect } from '@/shared/app/useRetryTriggers';
import type { Activity } from '@/types';
import type { SyncProgress } from './useRouteSyncProgress';

/** How long to let the Rust time-stream backfill run before moving on. It
 *  resumes on the next sync, so a slow drain never blocks the banner. */
const STREAM_BACKFILL_TIMEOUT_MS = 60_000;
const STREAM_BACKFILL_POLL_MS = 500;

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
 * Pulls GPS for activities the engine has not seen yet and hands it to Rust,
 * which then starts section detection.
 *
 * Runs on an activities change, an engine reset, a reconnection, or a manual
 * `syncActivities` call. `enabled` turns off only the automatic trigger.
 *
 * Progress lives in `useRouteSyncProgress`, the lifecycle refs in
 * `useRouteSyncContext` and the fetching in `useGpsDataFetcher`. This file is
 * the order they run in, nothing more.
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
          markSyncComplete(abortController);
          return;
        }

        // Check engine state for already-synced activities
        const engineActivityIds = new Set(nativeModule.engine.getActivityIds());

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
        const cachedMetricIds = new Set(nativeModule.engine.getActivityMetricIds());
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
            nativeModule.engine.setActivityMetrics(newMetrics);
            engine.triggerRefresh('activities');
          }
        }

        // Batch-fetch FIT files for WeightTraining activities not yet processed
        if (!isDemoModeRef.current) {
          const strengthIds = activitiesToSync
            .filter((a) => a.type === 'WeightTraining')
            .map((a) => a.id);

          if (
            strengthIds.length > 0 &&
            typeof nativeModule.engine.getUnprocessedStrengthIds === 'function'
          ) {
            const unprocessed = nativeModule.engine.getUnprocessedStrengthIds(strengthIds);
            if (unprocessed.length > 0) {
              if (__DEV__) {
                console.log(
                  `[RouteDataSync] Fetching FIT files for ${unprocessed.length} strength activities`
                );
              }
              try {
                // Fire and forget: the downloads run on a Rust thread and the
                // sets are read back from SQLite when a strength screen asks.
                const started = nativeModule.engine.batchFetchExerciseSets(unprocessed);
                if (__DEV__) {
                  console.log(
                    `[RouteDataSync] FIT batch for ${unprocessed.length} activities: ${
                      started ? 'started' : 'already running'
                    }`
                  );
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
          // Drain any completed-but-uncollected detection results. If a prior
          // detection finished after the TS poll loop timed out, the result
          // sits in the global handle and blocks all future start() calls.
          const drainStatus = nativeModule.engine.pollSectionDetection();
          if (drainStatus === 'complete') {
            if (__DEV__) {
              console.log('[RouteDataSync] Drained stale detection result');
            }
            engine.triggerRefresh('sections');
            engine.triggerRefresh('groups');
          }

          // Check if section detection was interrupted and needs to recover
          const stats = engine.getStats();
          if (stats?.sectionsDirty && isMountedRef.current) {
            if (__DEV__) {
              console.log(
                '[RouteDataSync] No new GPS, but sectionsDirty - triggering section detection'
              );
            }
            updateProgress({
              status: 'computing',
              completed: 0,
              total: 0,
              percent: 0,
              message: 'Analyzing routes...',
            });

            // The engine starts detection when the batch lands; follow it.
            const started = nativeModule.engine.pollSectionDetection() === 'running';
            if (started) {
              const pollInterval = 500;
              const maxPollTime = 60000;
              const startTime = Date.now();
              while (isMountedRef.current && !abortController.signal.aborted) {
                const detectionStatus = nativeModule.engine.pollSectionDetection();
                if (detectionStatus !== 'running' || Date.now() - startTime > maxPollTime) break;
                await new Promise((resolve) => setTimeout(resolve, pollInterval));
              }
              // Skip side effects if a newer sync took over (cache clear race)
              if (!abortController.signal.aborted) {
                engine.triggerRefresh('groups');
                engine.triggerRefresh('sections');
              }

              // Poll heatmap tile generation (runs on Rust background thread) and surface
              // processed/total so the user sees forward motion instead of a frozen bar.
              // Foreground wait capped at 5 s (Tier 1.2); Rust keeps rendering in background
              // if we bail out early and the map will pick up tiles as they land.
              const tileStatus = engine.pollTileGeneration();
              if (
                tileStatus === 'running' &&
                isMountedRef.current &&
                !abortController.signal.aborted
              ) {
                const initialTileProgress = engine.getHeatmapTileProgress();
                const tileTotal =
                  initialTileProgress && initialTileProgress.length >= 2
                    ? initialTileProgress[1]
                    : 0;
                const maxPoll =
                  tileTotal > 0 ? Math.min(5_000, Math.max(2_000, tileTotal * 10)) : 3_000;
                const tileStartTime = Date.now();
                while (isMountedRef.current && !abortController.signal.aborted) {
                  await new Promise((resolve) => setTimeout(resolve, 200));
                  const s = engine.pollTileGeneration();
                  const progress = engine.getHeatmapTileProgress();
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

          // Backfill: time streams for activities with NULL lap_time (upgrade
          // path). Rust fetches and persists them behind the shared governor,
          // so this only reports progress while it drains.
          if (isMountedRef.current && !isDemo && !abortController.signal.aborted) {
            try {
              const needingStreams = engine.getActivitiesNeedingTimeStreams();
              if (needingStreams.length > 0) {
                if (__DEV__) {
                  console.log(
                    `[RouteDataSync] Backfilling time streams for ${needingStreams.length} activities`
                  );
                }
                const totalStreams = needingStreams.length;
                engine.syncTimeStreams(needingStreams);

                const deadline = Date.now() + STREAM_BACKFILL_TIMEOUT_MS;
                let remaining = totalStreams;
                while (
                  Date.now() < deadline &&
                  isMountedRef.current &&
                  !abortController.signal.aborted
                ) {
                  remaining = engine.getMissingTimeStreams(needingStreams).length;
                  if (remaining === 0) break;
                  if (isMountedRef.current) {
                    updateProgress({
                      status: 'fetching',
                      completed: totalStreams - remaining,
                      total: totalStreams,
                      percent: 50,
                      message: i18n.t('cache.fetchingTimeStreams', {
                        percent: 50,
                        completed: totalStreams - remaining,
                        total: totalStreams,
                      }),
                    });
                  }
                  await new Promise((resolve) => setTimeout(resolve, STREAM_BACKFILL_POLL_MS));
                }
                if (__DEV__) {
                  console.log(
                    `[RouteDataSync] Backfilled ${totalStreams - remaining}/${totalStreams} time streams`
                  );
                }
              }
            } catch {
              // Non-critical - will retry next sync
            }
          }

          // Set complete status so lastSyncTimestamp is updated.
          // Skip if aborted so a stale run can't mark a newer sync's work complete.
          if (isMountedRef.current && !abortController.signal.aborted) {
            updateProgress({
              status: 'complete',
              completed: engineActivityIds.size,
              total: engineActivityIds.size,
              percent: 100,
              message: i18n.t('cache.allActivitiesSynced'),
            });
          }
          markSyncComplete(abortController);
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
        // Update progress with error. Skip if aborted so a stale run's failure
        // (e.g. engine cleared mid-sync) doesn't overwrite a newer sync's progress.
        if (isMountedRef.current && !abortController.signal.aborted) {
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
        // Always mark sync complete. Ownership check inside markSyncComplete
        // ensures a stale run won't clear the globals a newer sync now owns.
        markSyncComplete(abortController);
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

  // Trigger resync when coming back online. This has to key on the network
  // value: an effect keyed on `isOnlineRef` ran at mount and never again,
  // because a ref object's identity never changes.
  useReconnect(() => setSyncTrigger((prev) => prev + 1));

  // Listen for engine reset (cache clear) and force a resync
  useEffect(() => {
    const nativeModule = getNativeModule();
    if (!nativeModule) return;

    const unsubscribe = nativeModule.engine.subscribe('syncReset', () => {
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

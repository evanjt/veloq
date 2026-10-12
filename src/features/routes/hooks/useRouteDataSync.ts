import { useEffect, useMemo, useState, useCallback } from 'react';
import { FLOW_ADD_ONE, markFlow } from '@/shared/debug/flowTiming';
import { runWhenIdle } from '@/shared/async/runWhenIdle';
import { useRouteSyncProgress } from './useRouteSyncProgress';
import { useRouteSyncContext, resetGlobalSyncState } from './useRouteSyncContext';
import { feedHeadIds } from '@/shared/activity/feedHead';
import { headFirst } from '@/features/routes/lib/gpsFetchOrder';
import { demoGpsCandidates } from '@/features/routes/lib/demoGpsCandidates';

import { useGpsDataFetcher } from './useGpsDataFetcher';
import { i18n } from '@/i18n';
import { getNativeModule } from '@/shared/native/engine';
import { readLibraryCount } from '@/shared/native/libraryCount';
import { engineErrorTag } from '@/shared/native/engineError';
import { engine, hasStarted, startOutcome, StartOutcome, type StartVerdict } from 'veloqrs';
import { useSyncDateRange } from '@/shared/app/SyncDateRangeStore';
import { useEngineSubscription } from '@/shared/native/useEngineSubscription';
import { useReconnect } from '@/shared/app/useRetryTriggers';
import { readActivities } from '@/shared/native/storedActivities';
import type { SyncProgress } from './useRouteSyncProgress';
import { backfillTimeStreams, timeStreamsProgress } from '@/features/routes/lib/timeStreamBackfill';
import { awaitTilePass, tilePassProgress } from '@/features/routes/lib/tilePass';
import {
  DETECTION_FOREGROUND_MS,
  followDetection,
  type DetectionEngine,
} from '@/features/routes/lib/detectionRun';
import { scalePercent } from '@/features/routes/lib/scalePercent';
import { endGpsSync } from '@/features/routes/lib/gpsSyncEnding';
import { routeSyncPlan } from '@/features/routes/lib/routeSyncPlan';
import { deferSyncRun, takeDeferredSyncRun } from '@/features/routes/lib/deferredSyncRun';
import { debug } from '@/shared/debug/debug';

const log = debug.create('RouteDataSync');

interface UseRouteDataSyncResult {
  /** Current sync progress */
  progress: SyncProgress;
  /** Whether sync is in progress */
  isSyncing: boolean;
  /** Manually trigger a sync pass */
  syncActivities: () => Promise<void>;
  /** Activities the library holds, null until the engine answers */
  activityCount: number | null;
}

export type { SyncProgress };

/**
 * Ask for every FIT file the engine's strength queue still owes, as one batch.
 *
 * The one place the owed files are requested: the sync asks after each pass, and the
 * strength tab asks when it has nothing to show but owed sessions. The engine keeps the
 * queue, so the request names no period. Undefined when there is no engine to ask.
 */
export function requestOwedStrengthFiles(
  native: { engine: typeof engine } | null
): StartVerdict | undefined {
  if (!native || typeof native.engine.getUnprocessedStrengthIds !== 'function') return undefined;
  const owed = native.engine.getUnprocessedStrengthIds();
  if (owed.length === 0) return StartOutcome.NotOwed;
  // Fire and forget: the downloads run on a Rust thread and the sets are read
  // back from SQLite when a strength screen asks.
  return native.engine.batchFetchExerciseSets(owed);
}

/**
 * How many activities the library holds, tracks or not, or null while there is
 * no engine to ask. The GPS-backed count is zero before the first track lands,
 * which is exactly when the pass is owed.
 */
function readActivityCount(): number | null {
  const nativeModule = getNativeModule();
  if (!nativeModule) return null;
  try {
    return readLibraryCount(nativeModule.engine);
  } catch {
    // empty-on-error: unknown, not empty. No pass runs and the latch holds, and
    // the next announcement asks the engine again.
    return null;
  }
}

/**
 * Pulls GPS for activities the engine has not seen yet and hands it to Rust,
 * which then starts section detection.
 *
 * Runs on every `activities` announcement, a change of the selected range, an
 * engine reset, a reconnection, or a manual `syncActivities` call. It reads no
 * activity body to decide that: the engine owns the candidates and the count.
 * `enabled` turns off only the automatic trigger.
 *
 * Progress lives in `useRouteSyncProgress`, the lifecycle refs in
 * `useRouteSyncContext` and the fetching in `useGpsDataFetcher`. This file is
 * the order they run in, nothing more.
 */
export function useRouteDataSync(enabled: boolean = true): UseRouteDataSyncResult {
  // Extracted hooks
  const { progress, isSyncing, updateProgress, isMountedRef } = useRouteSyncProgress();
  const setGpsSyncProgress = useSyncDateRange((s) => s.setGpsSyncProgress);
  const setGpsSyncPendingIds = useSyncDateRange((s) => s.setGpsSyncPendingIds);

  // Sync progress to shared store whenever it changes
  // This allows other screens to read progress without calling useRouteDataSync themselves
  useEffect(() => {
    setGpsSyncProgress(progress);
  }, [progress, setGpsSyncProgress]);

  // The sync stopped following a run that Rust kept going. Its end is what
  // takes the "still analysing" state off the screen. The run may also have
  // ended between the follow giving up and the progress write, in which case
  // no announcement is coming, so the flag is checked against the engine too.
  const detectionEnded = useEngineSubscription(['detectionApplied']);
  const backgroundAnalysisEnded = useSyncDateRange((s) => s.backgroundAnalysisEnded);
  const analysingInBackground = useSyncDateRange((s) => s.isAnalysingInBackground);
  useEffect(() => {
    if (!analysingInBackground) return;
    let running = true;
    try {
      running = engine.getSectionDetectionProgress() != null;
    } catch {
      running = false;
    }
    if (!running) backgroundAnalysisEnded();
  }, [detectionEnded, analysingInBackground, backgroundAnalysisEnded]);
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

  // Counter to force a re-sync after an engine reset, a reconnection, or a
  // run this one refused.
  const [syncTrigger, setSyncTrigger] = useState(0);

  /**
   * Main sync orchestration function.
   *
   * Coordinates the entire sync process from filtering to fetching to engine population.
   */
  const syncActivities = useCallback(async () => {
    // Get current values from refs
    const isAuth = isAuthenticatedRef.current;
    const isDemo = isDemoModeRef.current;
    const online = isOnlineRef.current;

    // Don't sync if not authenticated or already unmounted
    if (!isAuth || !isMountedRef.current) {
      if (__DEV__) {
        log.log(`[RouteDataSync] Blocked: isAuth=${isAuth}, mounted=${isMountedRef.current}`);
      }
      return;
    }

    // Prevent concurrent syncs. The activities that arrived while one was
    // running are owed a pass: the announcement that brought them has
    // already been spent, so a refusal used to lose them until a reconnect
    // or a wipe asked again.
    if (!canStartSync()) {
      if (__DEV__) {
        log.log('[RouteDataSync] Blocked: sync already in progress');
      }
      deferSyncRun();
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
        endGpsSync('no-engine', {
          updateProgress,
          owns: isMountedRef.current && !abortController.signal.aborted,
          withGpsCount: 0,
        });
        markSyncComplete(abortController);
        return;
      }

      // The tracks still owed. A live library asks the engine, which answers
      // from the census without parsing a stored body: marked with a track
      // upstream, not on the device, not refused for good or given up on.
      // Demo mode pulls no census, so the fixtures say it themselves.
      const { oldest, newest } = useSyncDateRange.getState();
      const candidates = isDemo
        ? demoGpsCandidates(
            readActivities(oldest, newest),
            new Set(nativeModule.engine.getActivityIds())
          )
        : nativeModule.engine.getGpsFetchCandidates(oldest, newest);
      const engineActivityCount = nativeModule.engine.getActivityCount();
      const withGps = headFirst(candidates, feedHeadIds(), (c) => c.activityId);

      // Published before the first fetch goes out, so a card already on
      // screen stops asking for its own copy of a track this run is about
      // to bring. Cleared by the store when the run reaches a terminal
      // status, which every exit below passes through.
      setGpsSyncPendingIds(withGps.map((c) => c.activityId));

      if (__DEV__) {
        log.log(
          `[RouteDataSync] ${withGps.length} new to sync, ` +
            `${engineActivityCount} already in engine, isDemo: ${isDemo}`
        );
      }

      // Offline only the fetching half has nothing to do. The seeding, the
      // drain and a dirty detection are local compute over stored tracks.
      const plan = routeSyncPlan({ online, isDemo, newGpsCount: withGps.length });

      // Batch-fetch FIT files for WeightTraining activities not yet processed.
      // The engine keeps the queue: the sport is a column there, so filtering
      // a whole-library parsed array here for `WeightTraining` only sent the
      // engine ids it can select itself.
      if (plan.fetchStrength) {
        try {
          const outcome = requestOwedStrengthFiles(nativeModule);
          if (__DEV__ && outcome !== undefined) {
            log.log(
              `[RouteDataSync] FIT batch: ${
                hasStarted(outcome) ? 'started' : `refused (${startOutcome(outcome)})`
              }`
            );
          }
        } catch (err) {
          if (__DEV__) {
            console.error('[RouteDataSync] FIT batch fetch error:', err);
          }
        }
      }

      // Set when a detection follow gives up on a run Rust is still doing,
      // so the settled banner does not claim work that has not landed.
      let stillAnalysing = false;

      if (plan.recoverDetection) {
        // A finished run settles itself on its worker, so this poll almost
        // always reads an empty slot. It still collects a run that ended
        // while nothing was left to settle it, which would block start().
        // Its outcome can describe an earlier run. The worker announces
        // catalogue changes when they land.
        nativeModule.engine.pollSectionDetection();

        // Check if section detection was interrupted and needs to recover.
        // A failed read leaves recovery to the next sync rather than failing
        // this one, whose activities have already landed.
        let sectionsDirty = false;
        try {
          sectionsDirty = engine.getStats()?.sectionsDirty === true;
        } catch (error) {
          console.warn(
            '[RouteDataSync] Could not read whether detection is owed:',
            engineErrorTag(error) ?? error
          );
        }
        if (sectionsDirty && isMountedRef.current) {
          if (__DEV__) {
            log.log('[RouteDataSync] No new GPS, but sectionsDirty - triggering section detection');
          }
          updateProgress({
            status: 'computing',
            completed: 0,
            total: 0,
            percent: 0,
            message: i18n.t('cache.analyzingRoutes'),
          });

          // The engine starts detection when the batch lands; follow it.
          // The end arrives on `detectionApplied`, so nothing here ticks
          // the drain: a tick that saw completion would take it from
          // whichever screen is also following the same run.
          const started = nativeModule.engine.getSectionDetectionProgress() != null;
          if (started) {
            const outcome = await followDetection(
              nativeModule.engine as unknown as DetectionEngine,
              {
                isActive: () => isMountedRef.current && !abortController.signal.aborted,
                timeoutMs: DETECTION_FOREGROUND_MS,
                onProgress: (progress) =>
                  updateProgress({
                    status: 'computing',
                    completed: 0,
                    total: 0,
                    percent: scalePercent(progress.percent, 0, 75),
                    message: i18n.t('cache.analyzingRoutes'),
                  }),
              }
            ).settled;
            // The shared foreground budget is the follow's, not the run's. Rust keeps
            // going and the sections land when it does, so the banner says
            // that rather than that everything is synced.
            stillAnalysing = outcome === 'timeout';
            // Skip side effects if a newer sync took over (cache clear race)
            if (!abortController.signal.aborted) {
              engine.triggerRefresh('groups');
              engine.triggerRefresh('sections');
            }

            // The heatmap tile pass runs on a Rust background thread and
            // announces itself when it finishes. The foreground wait is
            // capped: Rust keeps drawing after it and the map picks the
            // tiles up as they land.
            await awaitTilePass((processed, total) => {
              if (!isMountedRef.current || abortController.signal.aborted || total === 0) return;
              updateProgress(tilePassProgress(processed, total, i18n.t));
            });
          }
        } else if (__DEV__) {
          log.log('[RouteDataSync] No new activities to sync');
        }

        // Backfill: time streams for activities with NULL lap_time (upgrade
        // path). Rust fetches and persists them behind the shared governor
        // and announces each one, so this only reports progress.
        if (plan.backfillStreams && isMountedRef.current && !abortController.signal.aborted) {
          try {
            const { total, remaining } = await backfillTimeStreams((completed, streams) => {
              if (!isMountedRef.current) return;
              updateProgress(timeStreamsProgress(completed, streams, i18n.t));
            }, abortController.signal);
            if (__DEV__ && total > 0) {
              log.log(`[RouteDataSync] Backfilled ${total - remaining}/${total} time streams`);
            }
          } catch (error) {
            // Not fatal to the sync: the next one asks again.
            console.warn(
              '[RouteDataSync] Time stream backfill failed:',
              engineErrorTag(error) ?? error
            );
          }
        }

        // Set complete status so lastSyncTimestamp is updated.
        // Skip if aborted so a stale run can't mark a newer sync's work complete.
        if (isMountedRef.current && !abortController.signal.aborted) {
          updateProgress({
            status: 'complete',
            completed: engineActivityCount,
            total: engineActivityCount,
            percent: 100,
            analysingInBackground: stillAnalysing,
            message: stillAnalysing
              ? i18n.t('cache.syncedStillAnalysing', { count: engineActivityCount })
              : online
                ? i18n.t('cache.allActivitiesSynced')
                : i18n.t('cache.offlineUsingCached'),
          });
        }
        markSyncComplete(abortController);
        return;
      }

      if (__DEV__) {
        log.log(`[RouteDataSync] Starting GPS fetch for ${withGps.length} activities...`);
      }

      if (withGps.length === 1) markFlow(FLOW_ADD_ONE);

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
        log.log('[RouteDataSync] Sync complete (finally block)');
      }
      // Always mark sync complete. Ownership check inside markSyncComplete
      // ensures a stale run won't clear the globals a newer sync now owns.
      markSyncComplete(abortController);
      // And always release the cards this run was covering. The store clears
      // them on a terminal progress too, but an aborted run publishes none:
      // the catch above skips the update so a stale failure cannot overwrite
      // a newer run's progress, and a gate left standing there is a feed of
      // cards that never ask for a map again. Unconditional, without the
      // ownership check above, because the worst this costs a newer run is
      // one card asking for a track early, which is what it did before this
      // gate existed.
      setGpsSyncPendingIds([]);
      // The mutex is free again, so whatever was refused while this run held
      // it gets the pass it was owed, against the activities as they stand
      // now rather than as they stood when it was refused.
      if (takeDeferredSyncRun()) {
        setSyncTrigger((prev) => prev + 1);
      }
    }
  }, [
    isAuthenticatedRef,
    isDemoModeRef,
    isOnlineRef,
    isMountedRef,
    updateProgress,
    canStartSync,
    createAbortController,
    markSyncComplete,
    setGpsSyncPendingIds,
    fetchDemoGps,
    fetchApiGps,
  ]);

  // Trigger resync when coming back online. This has to key on the network
  // value: an effect keyed on `isOnlineRef` ran at mount and never again,
  // because a ref object's identity never changes.
  useReconnect(() => setSyncTrigger((prev) => prev + 1));

  // Listen for engine reset (cache clear) and force a resync
  useEffect(() => {
    const nativeModule = getNativeModule();
    if (!nativeModule) return undefined;

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

  // One pass per stored page and per range the athlete selects. The candidate
  // read takes the range, so a wider window already local still gets its pass.
  const activitiesAnnounced = useEngineSubscription(['activities']);
  const rangeOldest = useSyncDateRange((s) => s.oldest);
  const rangeNewest = useSyncDateRange((s) => s.newest);
  // Re-read on the announcement and on every trigger that asks for a pass.
  const activityCount = useMemo(() => {
    void activitiesAnnounced;
    void syncTrigger;
    return enabled ? readActivityCount() : null;
  }, [enabled, activitiesAnnounced, syncTrigger]);

  // An empty library has nothing to pass over, and a pass would report a
  // completed sync for it on every announcement.
  // Idle scheduling keeps the sync off the frames of a navigation animation
  useEffect(() => {
    if (!enabled || !activityCount) return undefined;

    // Defer heavy processing until the thread is idle
    return runWhenIdle(() => {
      void syncActivities();
    });
  }, [
    enabled,
    activityCount,
    activitiesAnnounced,
    rangeOldest,
    rangeNewest,
    syncActivities,
    syncTrigger,
  ]);

  return {
    progress,
    isSyncing,
    syncActivities,
    activityCount,
  };
}

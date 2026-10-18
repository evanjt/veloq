import { useEffect, useMemo, useState, useCallback } from 'react';
import { markAddOneOnTrackStored } from '@/shared/debug/flowTiming';
import { runWhenIdle } from '@/shared/async/runWhenIdle';
import { stampedProgressWriter, useRouteSyncProgress } from './useRouteSyncProgress';
import { useRouteSyncContext, resetGlobalSyncState } from './useRouteSyncContext';
import { feedHeadIds } from '@/shared/activity/feedHead';
import { headFirst } from '@/features/routes/lib/gpsFetchOrder';
import { demoGpsCandidates } from '@/features/routes/lib/demoGpsCandidates';
import { readFeedCards } from '@/features/activity/light';

import { useGpsDataFetcher } from './useGpsDataFetcher';
import { i18n } from '@/i18n';
import { getNativeModule } from '@/shared/native/engine';
import { readLibraryCount } from '@/shared/native/libraryCount';
import { engineErrorTag } from '@/shared/native/engineError';
import { engine, hasStarted, startOutcome, type StartVerdict, detection, strength } from 'veloqrs';
import { getSyncGeneration, useSyncDateRange } from '@/shared/app/SyncDateRangeStore';
import { useEngineSubscription } from '@/shared/native/useEngineSubscription';
import { useEngineReady } from '@/shared/native/useEngineReady';
import type { SyncProgress } from './useRouteSyncProgress';
import { backfillTimeStreams, timeStreamsProgress } from '@/features/routes/lib/timeStreamBackfill';
import { awaitTilePass, tilePassProgress } from '@/features/routes/lib/tilePass';
import {
  DETECTION_FOREGROUND_MS,
  followDetection,
  detectionEngineOf,
} from '@/features/routes/lib/detectionRun';
import { scalePercent } from '@/features/routes/lib/scalePercent';
import { endGpsSync } from '@/features/routes/lib/gpsSyncEnding';
import { routeSyncPlan } from '@/features/routes/lib/routeSyncPlan';
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
 * Ask for every FIT file the engine's queue still owes, strength sessions and pool swims
 * alike, as one batch.
 *
 * The one place the owed files are requested: the sync asks after each pass, and the
 * strength tab asks when it has nothing to show but owed sessions. The engine reads its own
 * queue, so the request names no activity, and answers NotOwed when it is empty. Undefined
 * when there is no engine to ask.
 */
export function requestOwedFitFiles(
  native: { engine: typeof engine } | null
): StartVerdict | undefined {
  if (!native) return undefined;
  // Fire and forget: the downloads run on a Rust thread and what each file held
  // is read back from SQLite when a screen asks.
  return strength.batchFetchOwedFitFiles();
}

/**
 * Hand the engine a GPS pass this sync cannot run itself: one is already
 * running here, or the network is gone. The engine starts it, or keeps it owed
 * and starts it when its running pass ends or the connection returns, so
 * nothing on this side asks again.
 */
function handGpsPassToEngine(
  native: { engine: typeof engine } | null,
  oldest: string,
  newest: string,
  head: string[]
): void {
  if (!native) return;
  try {
    native.engine.startGpsPass(oldest, newest, head);
  } catch (error) {
    console.warn(
      '[RouteDataSync] Could not hand the pass to the engine:',
      engineErrorTag(error) ?? error
    );
  }
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
 * engine reset, or a manual `syncActivities` call. It reads no activity body to
 * decide that: the engine owns the candidates and the count. A pass it cannot
 * run, because one is running or the network is gone, it hands to the engine,
 * which keeps it owed and starts it itself. `enabled` turns off only the
 * automatic trigger.
 *
 * Progress lives in `useRouteSyncProgress`, the lifecycle refs in
 * `useRouteSyncContext` and the fetching in `useGpsDataFetcher`. This file is
 * the order they run in, nothing more. The progress orders this hook's own
 * lifecycle only: what the screens show of the track work is the engine's,
 * read from the sync status.
 */
export function useRouteDataSync(enabled: boolean = true): UseRouteDataSyncResult {
  // Extracted hooks
  const {
    progress,
    isSyncing,
    updateProgress: writeProgress,
    isMountedRef,
  } = useRouteSyncProgress();
  const setGpsSyncPendingIds = useSyncDateRange((s) => s.setGpsSyncPendingIds);
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

  // The add-one span starts where a track lands, not at this sync's download:
  // the engine also stores tracks while it pulls an activity's streams, and
  // then this sync finds nothing to fetch.
  const readyEngine = useEngineReady();
  useEffect(() => (readyEngine ? markAddOneOnTrackStored(readyEngine) : undefined), [readyEngine]);

  // Counter to force a re-sync after an engine reset.
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
    // running are owed a pass, and the announcement that brought them has
    // already been spent, so the engine keeps the pass owed and starts it
    // itself. Demo mode downloads nothing.
    if (!canStartSync()) {
      if (__DEV__) {
        log.log('[RouteDataSync] Blocked: sync already in progress');
      }
      if (!isDemo) {
        const { oldest, newest } = useSyncDateRange.getState();
        handGpsPassToEngine(getNativeModule(), oldest, newest, [...feedHeadIds()]);
      }
      return;
    }

    // Create abort controller for this sync operation
    const abortController = createAbortController();
    const updateProgress = stampedProgressWriter(writeProgress, getSyncGeneration());

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
            readFeedCards(oldest, newest),
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

      // The tracks still owed offline are the engine's to fetch when the
      // connection returns, so it is told now rather than asked again then.
      if (plan.oweGpsToEngine) {
        handGpsPassToEngine(
          nativeModule,
          oldest,
          newest,
          withGps.map((c) => c.activityId)
        );
      }

      // Batch-fetch the FIT files the engine still owes. The engine keeps the
      // queue: the sport is a column there, so it selects the strength sessions
      // and pool swims itself.
      if (plan.fetchFitFiles) {
        try {
          const outcome = requestOwedFitFiles(nativeModule);
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
        detection.pollSectionDetection();

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
          const started = detection.getSectionDetectionProgress() != null;
          if (started) {
            const outcome = await followDetection(
              detectionEngineOf(nativeModule.engine, detection),
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

        // Set complete status so the expansion lock sees the pass settle.
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
      // And always release the cards this run was covering, on every exit:
      // an aborted run writes no terminal progress, and a gate left standing
      // is a feed of cards that never ask for a map again. Unconditional,
      // without the ownership check above, because the worst this costs a
      // newer run is one card asking for a track early, which is what it did
      // before this gate existed.
      setGpsSyncPendingIds([]);
    }
  }, [
    isAuthenticatedRef,
    isDemoModeRef,
    isOnlineRef,
    isMountedRef,
    writeProgress,
    canStartSync,
    createAbortController,
    markSyncComplete,
    setGpsSyncPendingIds,
    fetchDemoGps,
    fetchApiGps,
  ]);

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

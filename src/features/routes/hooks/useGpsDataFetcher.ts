/**
 * @fileoverview useGpsDataFetcher - GPS data fetching logic
 *
 * Handles fetching GPS data for activities in both demo and real API modes.
 * Manages progress tracking and coordinates building for the Rust engine.
 *
 * **Demo Mode:** Loads GPS tracks from local fixtures
 * **Real Mode:** Fetches GPS tracks from intervals.icu API via Rust HTTP client
 */

import { useCallback } from 'react';
import { i18n } from '@/i18n';
import { getNativeModule } from '@/shared/native/engine';
import {
  engine,
  getDownloadProgress,
  startFetchAndStore,
  takeFetchAndStoreResult,
  type ActivitySportMapping,
} from 'veloqrs';
import { getSyncGeneration, useSyncDateRange } from '@/shared/app/SyncDateRangeStore';
import { isRouteMatchingEnabled } from '@/features/routes/stores/RouteSettingsStore';
import { toActivityMetrics } from '@/features/activity/lib/activityMetrics';
import { activityStartEpoch } from '@/features/routes/lib/streamWindow';
import type { Activity } from '@/types';
import type { SyncProgress } from './useRouteSyncProgress';
import { backfillTimeStreams } from '@/features/routes/lib/timeStreamBackfill';
import { awaitTilePass } from '@/features/routes/lib/tilePass';
import { debug } from '@/shared/debug/debug';
import { followDetection, type DetectionEngine } from '@/features/routes/lib/detectionRun';
import { fetchWithRetry, type FetchPass } from '@/features/routes/lib/gpsFetchRetry';
import { pollDownloadProgress } from '@/features/routes/lib/gpsDownloadPoll';

const log = debug.create('GpsDataFetcher');

export interface GpsFetchResult {
  /** Activity IDs that were successfully synced */
  syncedIds: string[];
  /** Number of activities that had GPS data */
  withGpsCount: number;
  /** Success message to display */
  message: string;
}

interface FetchDeps {
  /** Ref tracking if component is mounted */
  isMountedRef: React.MutableRefObject<boolean>;
  /** Abort signal for cancellation */
  abortSignal: AbortSignal;
  /** Function to update progress state */
  updateProgress: (updater: SyncProgress | ((prev: SyncProgress) => SyncProgress)) => void;
}

/**
 * Scale a Rust-reported 0–100 percent into an arbitrary sub-range of the
 * overall sync progress bar.
 */
/**
 * How long a run is followed before the bar goes indeterminate, and how long
 * it is followed at all. The old shape polled for 120 s in the foreground and
 * then spawned a second 300 s poll of its own; one subscription now spans
 * both, so the lapse only changes what the banner says.
 */
const DETECTION_FOREGROUND_MS = 120000;
const DETECTION_FOLLOW_MS = 420000;

function scalePercent(rustPercent: number, rangeStart: number, rangeEnd: number): number {
  return Math.min(
    Math.round(rangeEnd),
    Math.round(rangeStart + (rustPercent / 100) * (rangeEnd - rangeStart))
  );
}

/**
 * Wait for the heatmap tile pass, surfacing it to the sync banner.
 *
 * Rust announces the pass when it finishes. The foreground wait is capped:
 * tile generation continues on a Rust background thread after the cap and the
 * map view picks up fresh tiles as they render.
 */
async function waitForTilePass(
  isMountedRef: React.MutableRefObject<boolean>,
  updateProgress?: (updater: SyncProgress | ((prev: SyncProgress) => SyncProgress)) => void,
  rangeStart = 75,
  rangeEnd = 100
): Promise<void> {
  await awaitTilePass((processed, total) => {
    if (!updateProgress || !isMountedRef.current || total === 0) return;
    const tilePct = Math.min(100, Math.round((processed / total) * 100));
    updateProgress({
      status: 'computing',
      completed: 0,
      total: 0,
      percent: scalePercent(tilePct, rangeStart, rangeEnd),
      message: i18n.t('cache.finalizingHeatmap', { percent: tilePct }),
    });
  });
}

/**
 * Hook for GPS data fetching operations.
 *
 * Provides methods to fetch GPS data in both demo and real API modes.
 * Handles progress tracking, coordinate building, and engine population.
 *
 * **Coordinate Format:**
 * - Input: Activity objects with encoded polylines
 * - Output: Flat number array [lat1, lng1, lat2, lng2, ...]
 * - Offsets: Index in flat array where each activity starts
 *
 * **Progress Tracking:**
 * - Demo mode: Updates once at start, once at end
 * - Real mode: Updates during HTTP fetch via progress listener
 *
 * @example
 * ```tsx
 * const { fetchDemoGps, fetchApiGps } = useGpsDataFetcher();
 *
 * // Demo mode
 * const result = await fetchDemoGps(activities, deps);
 *
 * // Real API mode
 * const result = await fetchApiGps(activities, deps);
 * ```
 */

export function useGpsDataFetcher() {
  /**
   * Fetch GPS data from demo fixtures.
   *
   * Loads pre-defined GPS tracks from @/data/demo/fixtures.ts.
   * Useful for testing and offline development.
   *
   * @param activities - Activities to load GPS for
   * @param deps - Dependencies for progress updates and abort checking
   * @returns Sync result with synced IDs and message
   */
  const fetchDemoGps = useCallback(
    async (activities: Activity[], deps: FetchDeps): Promise<GpsFetchResult> => {
      const { isMountedRef, abortSignal, updateProgress } = deps;

      // Capture sync generation at start - results will be discarded if it changes
      const startGeneration = getSyncGeneration();

      // Check for abort before starting
      if (abortSignal.aborted) {
        return { syncedIds: [], withGpsCount: 0, message: 'Cancelled' };
      }

      const nativeModule = getNativeModule();
      if (!nativeModule) {
        return {
          syncedIds: [],
          withGpsCount: 0,
          message: i18n.t('cache.engineNotAvailable'),
        };
      }

      // Update progress
      if (isMountedRef.current) {
        updateProgress({
          status: 'fetching',
          completed: 0,
          total: activities.length,
          percent: 0,
          message: i18n.t('cache.loadingDemoGps'),
        });
      }

      // Import demo fixtures
      const { getActivityMap } = require('@/data/demo/fixtures');

      const ids: string[] = [];
      const allCoords: number[] = [];
      const offsets: number[] = [];
      const sportTypes: string[] = [];

      // Track failures for debugging
      let failedNoMap = 0;
      let failedNoCoords = 0;
      let skippedInvalidCoords = 0;

      /**
       * Validates GPS coordinates are within valid bounds.
       * @param lat - Latitude (-90 to 90)
       * @param lng - Longitude (-180 to 180)
       * @returns true if coordinates are valid
       */
      const isValidCoordinate = (lat: number, lng: number): boolean => {
        return (
          Number.isFinite(lat) &&
          Number.isFinite(lng) &&
          lat >= -90 &&
          lat <= 90 &&
          lng >= -180 &&
          lng <= 180
        );
      };

      // Build flat coordinate arrays for Rust FFI
      for (const activity of activities) {
        const map = getActivityMap(activity.id, false);
        if (!map) {
          failedNoMap++;
          continue;
        }
        if (!map.latlngs || map.latlngs.length < 4) {
          failedNoCoords++;
          continue;
        }

        ids.push(activity.id);
        offsets.push(allCoords.length / 2);
        sportTypes.push(activity.type || 'Ride');

        // Add coordinates (latlngs are [[lat, lng], ...])
        for (const coord of map.latlngs) {
          if (coord && coord.length >= 2) {
            const lat = coord[0];
            const lng = coord[1];
            // Validate coordinate bounds before passing to Rust
            if (isValidCoordinate(lat, lng)) {
              allCoords.push(lat, lng);
            } else {
              skippedInvalidCoords++;
            }
          }
        }
      }

      // Log skipped coordinates in development
      if (__DEV__ && skippedInvalidCoords > 0) {
        console.warn(
          `[fetchDemoGps] Skipped ${skippedInvalidCoords} invalid coordinates (out of bounds or non-finite)`
        );
      }

      if (ids.length > 0 && isMountedRef.current) {
        // Check if sync generation has changed (reset occurred during fetch)
        const currentGeneration = getSyncGeneration();
        if (currentGeneration !== startGeneration) {
          if (__DEV__) {
            log.log(
              `[fetchDemoGps] DISCARDING stale results: generation ${startGeneration} -> ${currentGeneration}`
            );
          }
          return {
            syncedIds: [],
            withGpsCount: 0,
            message: 'Sync reset - results discarded',
          };
        }

        // Add to engine
        await nativeModule.engine.addActivities(ids, allCoords, offsets, sportTypes);

        // Sync activity metrics for performance calculations
        const syncedActivities = activities.filter((a) => ids.includes(a.id));
        const metrics = syncedActivities.map(toActivityMetrics);
        engine.setActivityMetrics(metrics);
        engine.triggerRefresh('activities');

        // Persist synthetic time streams so save_sections() can compute lap_time/lap_pace
        // during detection. Without this, the section detail chart is blank in demo mode
        // because the junction table ends up with NULL lap_time on every portion.
        const { getActivityStreams } = require('@/data/demo/fixtures');
        const demoTimeStreams = ids
          .map((id) => {
            const streams = getActivityStreams(id) as { time?: number[] } | null;
            return { activityId: id, times: streams?.time ?? [] };
          })
          .filter((s) => s.times.length > 0);
        if (demoTimeStreams.length > 0) {
          engine.setTimeStreams(demoTimeStreams);
        }

        // Demo: detection 25-75%, tiles 75-100%. The engine starts the
        // run itself when the batch lands; this only follows it.
        //
        // The end arrives on `detectionApplied`, so one subscription covers
        // the whole run: the foreground budget only switches the banner to
        // indeterminate, it does not tear the follow down and take the
        // announcement with it. The timer that remains reads progress alone.
        if (nativeModule.engine.pollSectionDetection() === 'running') {
          const outcome = await followDetection(nativeModule.engine as unknown as DetectionEngine, {
            isActive: () => isMountedRef.current && !abortSignal.aborted,
            timeoutMs: DETECTION_FOLLOW_MS,
            lapseAfterMs: DETECTION_FOREGROUND_MS,
            onLapse: () => {
              if (__DEV__) {
                console.warn(
                  '[fetchDemoGps] Section detection exceeded foreground poll time, following on'
                );
              }
            },
            onProgress: (progress) =>
              updateProgress({
                status: 'computing',
                completed: 0,
                total: 0,
                percent: scalePercent(progress.percent, 25, 75),
                message: i18n.t('cache.analyzingRoutes'),
              }),
          }).settled;

          if (outcome === 'error') {
            // Surface in production. A silent break here was hiding real
            // failures from the Rust apply-save path (e.g. transactional
            // junction-table writes), leaving users staring at a frozen
            // progress bar with no idea anything went wrong.
            console.error('[fetchDemoGps] Section detection returned error status');
          }
        }

        engine.triggerRefresh('groups');
        engine.triggerRefresh('sections');

        await waitForTilePass(isMountedRef, updateProgress);

        if (isMountedRef.current) {
          updateProgress({
            status: 'complete',
            completed: ids.length,
            total: activities.length,
            percent: 100,
            message: i18n.t('cache.syncedDemoActivities', { count: ids.length }),
          });
        }

        return {
          syncedIds: ids,
          withGpsCount: activities.length,
          message: i18n.t('cache.syncedDemoActivities', { count: ids.length }),
        };
      }

      // Update progress to complete/idle when no valid GPS data found
      if (isMountedRef.current) {
        updateProgress({
          status: 'idle',
          completed: 0,
          total: activities.length,
          percent: 0,
          message: i18n.t('cache.noValidGpsChecked', { count: activities.length }),
        });
      }

      // Log diagnostic info in development
      if (__DEV__) {
        console.warn(
          `[fetchDemoGps] No valid GPS data found. Activities: ${activities.length}, ` +
            `failedNoMap: ${failedNoMap}, failedNoCoords: ${failedNoCoords}, ` +
            `checked IDs: ${activities
              .slice(0, 3)
              .map((a) => a.id)
              .join(', ')}...`
        );
      }

      return {
        syncedIds: [],
        withGpsCount: activities.length,
        message: i18n.t('cache.noValidGpsData'),
      };
    },
    []
  );

  /**
   * Fetch GPS data from intervals.icu API.
   *
   * Uses Rust HTTP client for efficient parallel fetching.
   * Shows progress updates during fetch.
   *
   * @param activities - Activities to fetch GPS for
   * @param deps - Dependencies for progress updates and abort checking
   * @returns Sync result with synced IDs and message
   */
  const fetchApiGps = useCallback(
    async (activities: Activity[], deps: FetchDeps): Promise<GpsFetchResult> => {
      // Capture sync generation at start - results will be discarded if it changes
      const startGeneration = getSyncGeneration();

      if (__DEV__) {
        log.log(
          `[fetchApiGps] Entered with ${activities.length} activities, generation=${startGeneration}`
        );
      }

      const { isMountedRef, abortSignal, updateProgress } = deps;

      const nativeModule = getNativeModule();
      if (!nativeModule) {
        if (__DEV__) {
          console.warn('[fetchApiGps] Native module not available!');
        }
        return {
          syncedIds: [],
          withGpsCount: 0,
          message: 'Engine not available',
        };
      }

      if (!isMountedRef.current || abortSignal.aborted) {
        return { syncedIds: [], withGpsCount: 0, message: 'Cancelled' };
      }

      // Update progress
      if (isMountedRef.current) {
        updateProgress({
          status: 'fetching',
          completed: 0,
          total: activities.length,
          percent: 0,
          message: i18n.t('cache.fetchingGpsData'),
        });
      }

      // Build sport type mapping for Rust
      const activityIds = activities.map((a) => a.id);
      const sportTypes: ActivitySportMapping[] = activities.map((a) => ({
        activityId: a.id,
        sportType: a.type || 'Ride',
        startDate: activityStartEpoch(a.start_date_local),
      }));

      if (__DEV__) {
        log.log(`[fetchApiGps] Starting fetch+store for ${activityIds.length} activities...`);
      }

      // Update initial progress
      if (isMountedRef.current) {
        updateProgress({
          status: 'fetching',
          completed: 0,
          total: activityIds.length,
          percent: 0,
          message: i18n.t('cache.downloadingGpsProgress', {
            percent: 0,
            completed: 0,
            total: activityIds.length,
          }),
        });
      }

      // One pass over a set of ids. Rust downloads the GPS data and stores it
      // directly: no FFI round-trip, the data never crosses to TypeScript and
      // back. `stored` is what earlier passes already put away, so the bar
      // counts against the whole set and a retry never sends it backwards.
      const downloadBudget = isRouteMatchingEnabled() ? 50 : 100;
      let stored = 0;

      const runPass = async (ids: string[]): Promise<FetchPass | null> => {
        const pending = new Set(ids);
        startFetchAndStore(
          ids,
          sportTypes.filter((s) => pending.has(s.activityId))
        );

        // Poll download progress every 100ms. Rust fetches each activity's map
        // and then its time stream, and only clears `active` once both are done,
        // so one counter covers the whole download. The poll carries its own
        // deadline: a fetch thread that unwinds leaves the flag true, and this
        // loop is the only consumer of it.
        // When route matching is on: download = 0-50%, detection = 50-75%, tiles = 75-100%.
        // When off: download = 0-100%.
        const outcome = await pollDownloadProgress({
          read: getDownloadProgress,
          isActive: () => isMountedRef.current && !abortSignal.aborted,
          onProgress: (progress) => {
            const completed = Math.min(stored + progress.completed, activityIds.length);
            const gpsFraction = activityIds.length > 0 ? completed / activityIds.length : 0;
            const combined = Math.round(gpsFraction * downloadBudget);
            updateProgress({
              status: 'fetching',
              completed,
              total: activityIds.length,
              percent: combined,
              message: i18n.t('cache.downloadingGpsProgress', { percent: combined }),
            });
          },
        });
        if (outcome === 'stalled') {
          console.warn('[fetchApiGps] The download stopped reporting progress, giving up on it');
        }

        // Get result (just IDs - no GPS data transfer!)
        const passResult = takeFetchAndStoreResult();
        if (__DEV__) {
          log.log(
            '[fetchApiGps] takeFetchAndStoreResult returned:',
            passResult ? `${passResult.successCount}/${passResult.total}` : 'null'
          );
        }
        if (!passResult) return null;

        stored += passResult.syncedIds.length;
        return passResult;
      };

      const result = await fetchWithRetry(activityIds, {
        pass: runPass,
        isActive: () => isMountedRef.current && !abortSignal.aborted,
        onRetry: (ids, attempt) => {
          console.warn(
            `[fetchApiGps] Retrying ${ids.length} failed GPS download(s), attempt ${attempt}`
          );
        },
      });

      if (!result) {
        console.warn('[fetchApiGps] Result was null - Rust may have failed');
        return {
          syncedIds: [],
          withGpsCount: activities.length,
          message: 'Cancelled',
        };
      }

      // Surface in production. A route whose GPS never arrives is the athlete's
      // symptom and the retries have already run out, so this is the last word.
      if (result.failedIds.length > 0) {
        console.warn(
          `[fetchApiGps] ${result.failedIds.length} GPS download(s) still failing after ` +
            `${result.attempts} attempt(s): ${result.failedIds.slice(0, 5).join(', ')}`
        );
      }

      if (__DEV__) {
        // Log Rust result in Expo console (timing logged via adb logcat)
        log.log(
          `[RUST: fetch_and_store] Complete: ${result.successCount}/${result.total} synced, ` +
            `${result.failedIds.length} failed, ${result.recoveredIds.length} recovered on retry`
        );
      }

      // Check mount state and abort signal
      if (!isMountedRef.current || abortSignal.aborted) {
        return {
          syncedIds: [],
          withGpsCount: activities.length,
          message: 'Cancelled',
        };
      }

      // Check if sync generation has changed
      const currentGeneration = getSyncGeneration();
      if (currentGeneration !== startGeneration) {
        if (__DEV__) {
          log.log(
            `[fetchApiGps] DISCARDING stale results: generation ${startGeneration} -> ${currentGeneration}`
          );
        }
        return {
          syncedIds: [],
          withGpsCount: 0,
          message: 'Sync reset - results discarded',
        };
      }

      // Activities already stored in Rust engine by startFetchAndStore
      // Just need to sync metrics and start section detection

      const gapStart = Date.now();

      if (result.syncedIds.length > 0 && isMountedRef.current) {
        const syncedActivities = activities.filter((a) => result.syncedIds.includes(a.id));
        const metrics = syncedActivities.map(toActivityMetrics);

        const t0 = Date.now();
        engine.setActivityMetrics(metrics);
        if (__DEV__) {
          log.log(`[fetchApiGps] ⏱ setActivityMetrics: ${Date.now() - t0}ms`);
        }

        // Yield so the sync banner can paint between the metrics write and the
        // refresh notifications, which synchronously re-render every subscriber.
        await new Promise((resolve) => setTimeout(resolve, 0));

        const t1 = Date.now();
        engine.triggerRefresh('activities');
        engine.triggerRefresh('groups');
        if (__DEV__) {
          log.log(`[fetchApiGps] ⏱ triggerRefresh: ${Date.now() - t1}ms`);
        }
      }

      if (__DEV__) {
        log.log(`[fetchApiGps] ⏱ total gap before detection check: ${Date.now() - gapStart}ms`);
      }

      // Run section detection if route matching is enabled AND (new activities synced,
      // engine needs re-detection, or date range expanded).
      const { hasExpanded } = useSyncDateRange.getState();
      const routeMatchingOn = isRouteMatchingEnabled();
      const needsDetection =
        routeMatchingOn &&
        (result.syncedIds.length > 0 || engine.getStats()?.sectionsDirty === true || hasExpanded);

      // API: detection 50-75%, tiles 75-100%
      if (needsDetection && isMountedRef.current) {
        updateProgress({
          status: 'computing',
          completed: 0,
          total: 0,
          percent: 50,
          message: i18n.t('cache.analyzingRoutes'),
        });

        await new Promise((resolve) => setTimeout(resolve, 0));

        // The engine starts detection itself at the end of a stored batch
        // (and a cutover re-cuts everything at its own end), so this only
        // follows a run that is under way.
        //
        // The end arrives on `detectionApplied`, so one subscription covers
        // the whole run. Past the foreground budget the bar used to freeze on
        // its last percent, reading as a crash: an INDETERMINATE ongoing
        // state instead, a zero percent/completed/total triple with
        // `status: 'computing'`, maps to `indeterminate: true` in
        // `formatGpsSyncProgress`, so the banner shows a moving marquee
        // rather than a stuck number. A large-corpus detection legitimately
        // runs for minutes; this keeps it honest.
        if (nativeModule.engine.pollSectionDetection() === 'running') {
          let lapsed = false;
          const indeterminate = () =>
            updateProgress({
              status: 'computing',
              completed: 0,
              total: 0,
              percent: 0,
              message: i18n.t('cache.analyzingRoutes'),
            });

          const outcome = await followDetection(nativeModule.engine as unknown as DetectionEngine, {
            isActive: () => isMountedRef.current && !abortSignal.aborted,
            timeoutMs: DETECTION_FOLLOW_MS,
            lapseAfterMs: DETECTION_FOREGROUND_MS,
            onLapse: () => {
              lapsed = true;
              if (__DEV__) {
                console.warn(
                  '[fetchApiGps] Section detection exceeded foreground poll time, following on'
                );
              }
              if (isMountedRef.current) indeterminate();
            },
            onProgress: (progress) => {
              if (lapsed) {
                indeterminate();
                return;
              }
              updateProgress({
                status: 'computing',
                completed: 0,
                total: 0,
                percent: scalePercent(progress.percent, 50, 75),
                message: i18n.t('cache.analyzingRoutes'),
              });
            },
          }).settled;

          if (outcome === 'error') {
            // Surface in production. A silent break here was hiding real
            // failures from the Rust apply-save path (e.g. transactional
            // junction-table writes), leaving users staring at a frozen
            // progress bar with no idea anything went wrong.
            console.error('[fetchApiGps] Section detection returned error status');
          }
        }

        engine.triggerRefresh('groups');
        engine.triggerRefresh('sections');

        await waitForTilePass(isMountedRef, updateProgress);
      }

      // Backfill: time streams for existing activities with NULL lap_time.
      // Handles upgrade from versions that didn't fetch them during sync.
      // Rust does the fetching and persisting and announces each stream; this
      // only waits for the drain.
      if (isMountedRef.current && !abortSignal.aborted) {
        try {
          const { total, remaining } = await backfillTimeStreams(() => {}, abortSignal);
          if (__DEV__ && total > 0) {
            log.log(`[fetchApiGps] Backfilled ${total - remaining}/${total} time streams`);
          }
        } catch {
          // Non-critical - will retry on next sync
        }
      }

      // Final progress update
      if (isMountedRef.current) {
        updateProgress({
          status: 'complete',
          completed: result.successCount,
          total: activities.length,
          percent: 100,
          message: i18n.t('cache.syncedActivities', { count: result.successCount }),
        });
      }

      return {
        syncedIds: result.syncedIds,
        withGpsCount: activities.length,
        message: i18n.t('cache.syncedActivities', { count: result.successCount }),
      };
    },
    []
  );

  return {
    fetchDemoGps,
    fetchApiGps,
  };
}

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
import { getNativeModule } from '@/lib/native/routeEngine';
import {
  routeEngine,
  getDownloadProgress,
  startFetchAndStore,
  takeFetchAndStoreResult,
  type ActivitySportMapping,
} from 'veloqrs';
import { getStoredCredentials, getSyncGeneration, useSyncDateRange } from '@/providers';
import { isRouteMatchingEnabled } from '@/providers/RouteSettingsStore';
import { toActivityMetrics } from '@/lib/utils/activityMetrics';
import { intervalsApi } from '@/api';
import type { Activity } from '@/types';
import type { SyncProgress } from './useRouteSyncProgress';

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
function scalePercent(rustPercent: number, rangeStart: number, rangeEnd: number): number {
  return Math.min(
    Math.round(rangeEnd),
    Math.round(rangeStart + (rustPercent / 100) * (rangeEnd - rangeStart))
  );
}

/**
 * Poll heatmap tile generation until complete, surfacing progress to
 * the sync banner. Foreground wait is capped at 5 s regardless of tile
 * count — tile generation continues on a Rust background thread after
 * the cap and the map view picks up fresh tiles as they render.
 */
async function pollTileGeneration(
  isMountedRef: React.MutableRefObject<boolean>,
  updateProgress?: (updater: SyncProgress | ((prev: SyncProgress) => SyncProgress)) => void,
  rangeStart = 75,
  rangeEnd = 100
): Promise<void> {
  const status = routeEngine.pollTileGeneration();
  if (status !== 'running' || !isMountedRef.current) return;

  const initial = routeEngine.getHeatmapTileProgress();
  const tileTotal = initial && initial.length >= 2 ? initial[1] : 0;
  const maxPollTime = tileTotal > 0 ? Math.min(5_000, Math.max(2_000, tileTotal * 10)) : 3_000;

  const startTime = Date.now();
  while (isMountedRef.current) {
    await new Promise((resolve) => setTimeout(resolve, 200));
    const s = routeEngine.pollTileGeneration();
    if (updateProgress) {
      const progress = routeEngine.getHeatmapTileProgress();
      if (progress && progress.length >= 2) {
        const [processed, total] = progress;
        if (total > 0) {
          const tilePct = Math.min(100, Math.round((processed / total) * 100));
          updateProgress({
            status: 'computing',
            completed: 0,
            total: 0,
            percent: scalePercent(tilePct, rangeStart, rangeEnd),
            message: i18n.t('cache.finalizingHeatmap', { percent: tilePct }),
          });
        }
      }
    }
    if (s !== 'running' || Date.now() - startTime > maxPollTime) break;
  }
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
            console.log(
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
        await nativeModule.routeEngine.addActivities(ids, allCoords, offsets, sportTypes);

        // Sync activity metrics for performance calculations
        const syncedActivities = activities.filter((a) => ids.includes(a.id));
        const metrics = syncedActivities.map(toActivityMetrics);
        routeEngine.setActivityMetrics(metrics);
        routeEngine.triggerRefresh('activities');

        // Demo: detection 25-75%, tiles 75-100%
        const started = nativeModule.routeEngine.startSectionDetection();
        if (!started) {
          if (__DEV__) {
            console.warn('[fetchDemoGps] startSectionDetection returned false — skipping poll');
          }
        } else {
          const pollInterval = 150;
          const maxPollTime = 60000;
          const startTime = Date.now();

          while (isMountedRef.current && !abortSignal.aborted) {
            const status = nativeModule.routeEngine.pollSectionDetection();

            if (status === 'running') {
              const progress = nativeModule.routeEngine.getSectionDetectionProgress();
              if (progress) {
                updateProgress({
                  status: 'computing',
                  completed: 0,
                  total: 0,
                  percent: scalePercent(progress.percent, 25, 75),
                  message: i18n.t('cache.analyzingRoutes'),
                });
              }
            } else if (status === 'complete' || status === 'idle') {
              break;
            } else if (status === 'error') {
              if (__DEV__) {
                console.warn('[fetchDemoGps] Section detection error');
              }
              break;
            }

            if (Date.now() - startTime > maxPollTime) {
              if (__DEV__) {
                console.warn('[fetchDemoGps] Section detection timed out');
              }
              break;
            }

            await new Promise((resolve) => setTimeout(resolve, pollInterval));
          }
        }

        routeEngine.triggerRefresh('groups');
        routeEngine.triggerRefresh('sections');

        await pollTileGeneration(isMountedRef, updateProgress);

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
        console.log(
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

      if (__DEV__) {
        console.log('[fetchApiGps] Getting credentials...');
      }

      // Get API credentials (synchronous - uses Zustand getState)
      const creds = getStoredCredentials();
      if (!isMountedRef.current || abortSignal.aborted) {
        return { syncedIds: [], withGpsCount: 0, message: 'Cancelled' };
      }

      // Build auth header based on auth method
      let authHeader: string;
      if (creds.authMethod === 'oauth' && creds.accessToken) {
        // OAuth: Bearer token
        authHeader = `Bearer ${creds.accessToken}`;
      } else if (creds.apiKey) {
        // API key: Basic auth with "API_KEY" as username
        const encoded = btoa(`API_KEY:${creds.apiKey}`);
        authHeader = `Basic ${encoded}`;
      } else {
        throw new Error('No credentials available');
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
      }));

      if (__DEV__) {
        console.log(`[fetchApiGps] Starting fetch+store for ${activityIds.length} activities...`);
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

      // Start combined fetch+store - Rust downloads GPS data and stores directly
      // NO FFI round-trip: GPS data never crosses to TypeScript and back
      startFetchAndStore(authHeader, activityIds, sportTypes);

      // Tier 1.1: kick off time-stream HTTP fetches concurrently with GPS download.
      // Previously these ran sequentially AFTER GPS completed, adding ~20 s silent tail
      // on a scenario-E sync. Rate-limit budget: intervals.icu allows 30 req/s burst,
      // 120 req/10 s sustained. GPS fetches are paced in Rust (~10 concurrent); this
      // TS batch of 10 adds ~10 more concurrent, staying under the burst limit.
      // Streams are fetched for every candidate activity; failed-GPS rows are filtered
      // out at the end against result.syncedIds so we never persist orphan streams.
      const streamProgress = { completed: 0 };
      const totalStreams = activityIds.length;
      const streamFetchPromise: Promise<Array<{ activityId: string; times: number[] }>> =
        (async () => {
          const out: Array<{ activityId: string; times: number[] }> = [];
          const batchSize = 10;
          for (let i = 0; i < activityIds.length; i += batchSize) {
            if (!isMountedRef.current || abortSignal.aborted) break;
            const batch = activityIds.slice(i, i + batchSize);
            const batchResults = await Promise.all(
              batch.map(async (activityId) => {
                try {
                  const streams = await intervalsApi.getActivityStreams(activityId, ['time']);
                  return { activityId, times: (streams.time as number[]) || [] };
                } catch {
                  return { activityId, times: [] as number[] };
                }
              })
            );
            for (const r of batchResults) {
              if (r.times.length > 0) out.push(r);
            }
            streamProgress.completed = Math.min(
              streamProgress.completed + batch.length,
              totalStreams
            );
          }
          return out;
        })();

      // Poll for combined GPS + time stream progress every 100ms.
      // Both run concurrently; each contributes half of the download budget.
      // When route matching is on: download = 0-50%, detection = 50-75%, tiles = 75-100%.
      // When off: download = 0-100%.
      const downloadBudget = isRouteMatchingEnabled() ? 50 : 100;
      let pollCount = 0;
      while (isMountedRef.current && !abortSignal.aborted) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        pollCount++;

        const progress = getDownloadProgress();
        if (!progress.active) {
          if (__DEV__) {
            console.log(
              `[fetchApiGps] GPS done after ${pollCount} polls: ${progress.completed}/${progress.total}`
            );
          }
          break;
        }

        const gpsFraction = progress.total > 0 ? progress.completed / progress.total : 0;
        const streamFraction = totalStreams > 0 ? streamProgress.completed / totalStreams : 1;
        const combined = Math.round(((gpsFraction + streamFraction) / 2) * downloadBudget);
        updateProgress({
          status: 'fetching',
          completed: progress.completed,
          total: progress.total,
          percent: combined,
          message: i18n.t('cache.downloadingGpsProgress', { percent: combined }),
        });
      }

      // Get result (just IDs - no GPS data transfer!)
      if (__DEV__) {
        console.log('[fetchApiGps] Calling takeFetchAndStoreResult()...');
      }
      const result = takeFetchAndStoreResult();

      if (__DEV__) {
        console.log(
          '[fetchApiGps] takeFetchAndStoreResult returned:',
          result ? `${result.successCount}/${result.total}` : 'null'
        );
      }

      if (!result) {
        console.warn('[fetchApiGps] Result was null - Rust may have failed');
        return {
          syncedIds: [],
          withGpsCount: activities.length,
          message: 'Cancelled',
        };
      }

      if (__DEV__) {
        // Log Rust result in Expo console (timing logged via adb logcat)
        console.log(
          `[RUST: fetch_and_store] Complete: ${result.successCount}/${result.total} synced, ` +
            `${result.failedIds.length} failed`
        );
        if (result.failedIds.length > 0) {
          console.log(`[fetchApiGps] Sample failures:`, result.failedIds.slice(0, 3));
        }
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
          console.log(
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
        routeEngine.setActivityMetrics(metrics);
        if (__DEV__) {
          console.log(`[fetchApiGps] ⏱ setActivityMetrics: ${Date.now() - t0}ms`);
        }

        const t1 = Date.now();
        routeEngine.triggerRefresh('activities');
        routeEngine.triggerRefresh('groups');
        if (__DEV__) {
          console.log(`[fetchApiGps] ⏱ triggerRefresh: ${Date.now() - t1}ms`);
        }
      }

      // Drain remaining time streams. GPS is done so its half is 100%;
      // keep advancing the bar as streams complete until we reach downloadBudget.
      if (result.syncedIds.length > 0 && isMountedRef.current && !abortSignal.aborted) {
        try {
          while (
            isMountedRef.current &&
            !abortSignal.aborted &&
            streamProgress.completed < totalStreams
          ) {
            const streamFraction = totalStreams > 0 ? streamProgress.completed / totalStreams : 1;
            const combined = Math.round(((1 + streamFraction) / 2) * downloadBudget);
            updateProgress({
              status: 'fetching',
              completed: streamProgress.completed,
              total: totalStreams,
              percent: combined,
              message: i18n.t('cache.fetchingTimeStreams', { percent: combined }),
            });
            await new Promise((resolve) => setTimeout(resolve, 150));
          }

          const t2 = Date.now();
          const fetchedStreams = await streamFetchPromise;
          if (__DEV__) {
            console.log(`[fetchApiGps] ⏱ await streamFetchPromise: ${Date.now() - t2}ms`);
          }
          if (fetchedStreams.length > 0 && isMountedRef.current) {
            const syncedSet = new Set(result.syncedIds);
            const toSync = fetchedStreams.filter((s) => syncedSet.has(s.activityId));
            if (toSync.length > 0) {
              const t3 = Date.now();
              routeEngine.setTimeStreams(toSync);
              if (__DEV__) {
                console.log(
                  `[fetchApiGps] ⏱ setTimeStreams (${toSync.length}): ${Date.now() - t3}ms`
                );
              }
            }
          }
        } catch (e) {
          if (__DEV__) {
            console.warn('[fetchApiGps] Time stream fetch failed:', e);
          }
        }
      }

      if (__DEV__) {
        console.log(`[fetchApiGps] ⏱ total gap before detection check: ${Date.now() - gapStart}ms`);
      }

      // Run section detection if route matching is enabled AND (new activities synced,
      // engine needs re-detection, or date range expanded).
      const { hasExpanded } = useSyncDateRange.getState();
      const routeMatchingOn = isRouteMatchingEnabled();
      const needsDetection =
        routeMatchingOn &&
        (result.syncedIds.length > 0 ||
          routeEngine.getStats()?.sectionsDirty === true ||
          hasExpanded);

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

        if (__DEV__) {
          console.log('[fetchApiGps] ⏱ calling startSectionDetection...');
        }
        const detStart = Date.now();
        const started = nativeModule.routeEngine.startSectionDetection();
        if (__DEV__) {
          console.log(
            `[fetchApiGps] ⏱ startSectionDetection returned ${started} in ${Date.now() - detStart}ms`
          );
        }
        if (!started) {
          if (__DEV__) {
            console.warn('[fetchApiGps] startSectionDetection returned false — skipping poll');
          }
        } else {
          const pollInterval = 150;
          const maxPollTime = 60000;
          const startTime = Date.now();

          while (isMountedRef.current && !abortSignal.aborted) {
            const status = nativeModule.routeEngine.pollSectionDetection();

            if (status === 'running') {
              const progress = nativeModule.routeEngine.getSectionDetectionProgress();
              if (progress) {
                updateProgress({
                  status: 'computing',
                  completed: 0,
                  total: 0,
                  percent: scalePercent(progress.percent, 50, 75),
                  message: i18n.t('cache.analyzingRoutes'),
                });
              }
            } else if (status === 'complete' || status === 'idle') {
              break;
            } else if (status === 'error') {
              if (__DEV__) {
                console.warn('[fetchApiGps] Section detection error');
              }
              break;
            }

            if (Date.now() - startTime > maxPollTime) {
              if (__DEV__) {
                console.warn('[fetchApiGps] Section detection timed out');
              }
              break;
            }

            await new Promise((resolve) => setTimeout(resolve, pollInterval));
          }
        }

        routeEngine.triggerRefresh('groups');
        routeEngine.triggerRefresh('sections');

        await pollTileGeneration(isMountedRef, updateProgress);
      }

      // Backfill: fetch time streams for existing activities with NULL lap_time.
      // Handles upgrade from versions that didn't fetch time streams during sync.
      if (isMountedRef.current && !abortSignal.aborted) {
        try {
          const needingStreams = routeEngine.getActivitiesNeedingTimeStreams();
          if (needingStreams.length > 0) {
            if (__DEV__) {
              console.log(
                `[fetchApiGps] Backfilling time streams for ${needingStreams.length} activities`
              );
            }
            const batchSize = 10;
            const backfillStreams: Array<{ activityId: string; times: number[] }> = [];
            for (let i = 0; i < needingStreams.length; i += batchSize) {
              if (!isMountedRef.current || abortSignal.aborted) break;
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
            }
            if (backfillStreams.length > 0 && isMountedRef.current) {
              routeEngine.setTimeStreams(backfillStreams);
              if (__DEV__) {
                console.log(
                  `[fetchApiGps] Backfilled ${backfillStreams.length}/${needingStreams.length} time streams`
                );
              }
            }
          }
        } catch {
          // Non-critical — will retry on next sync
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

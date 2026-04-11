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
 * Human-readable phase names for section detection.
 * Rust emits: "loading", "building_rtrees", "finding_overlaps",
 *             "clustering", "postprocessing", "saving", "complete"
 */
const PHASE_DISPLAY_NAMES: Record<string, string> = {
  loading: 'Loading tracks',
  building_rtrees: 'Building spatial index',
  finding_overlaps: 'Finding overlaps',
  clustering: 'Clustering sections',
  postprocessing: 'Processing sections',
  saving: 'Saving sections',
  complete: 'Complete',
  detecting: 'Detecting sections',
};

/**
 * Calculate overall progress for section detection (50-100% range).
 * Download is 0-50%, all detection phases combined are 50-100%.
 */
function calculateDetectionProgress(completed: number, total: number): number {
  if (total <= 0) return 50;
  const phasePercent = Math.min(completed / total, 1);
  return Math.round(50 + phasePercent * 50);
}

/**
 * Get display name for a detection phase.
 */
export function getPhaseDisplayName(phase: string): string {
  // Handle scale phases (e.g., "scale_short", "scale_medium")
  const normalizedPhase = phase.startsWith('scale_') ? 'finding_overlaps' : phase;
  return PHASE_DISPLAY_NAMES[normalizedPhase] ?? phase;
}

/**
 * Reset the progress tracker. Call this when starting a new sync operation.
 */
export function resetProgressTracker(): void {
  // No-op — progress is now calculated directly from phase completed/total
}

/**
 * Poll heatmap tile generation until complete.
 * Tile generation runs on a Rust background thread after section detection.
 * We poll briefly to ensure tiles are ready before the user navigates to the map.
 */
async function pollTileGeneration(isMountedRef: React.MutableRefObject<boolean>): Promise<void> {
  const status = routeEngine.pollTileGeneration();
  if (status !== 'running' || !isMountedRef.current) return;

  // Poll every 200ms for up to 10s (tile generation is usually fast)
  const maxPollTime = 10000;
  const startTime = Date.now();
  while (isMountedRef.current) {
    await new Promise((resolve) => setTimeout(resolve, 200));
    const s = routeEngine.pollTileGeneration();
    if (s !== 'running' || Date.now() - startTime > maxPollTime) break;
  }
}

/**
 * Get a user-friendly message for section detection.
 * Simplified to show just "Analyzing routes..." with percentage.
 * Uses i18n for translation support.
 */
function getSectionDetectionMessage(phase: string): string {
  if (phase === 'complete') {
    return i18n.t('cache.routeAnalysisComplete');
  }

  return i18n.t('cache.analyzingRoutes');
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

        // Start section detection and poll for progress
        // Reset the progress tracker for a fresh sync
        resetProgressTracker();
        const started = nativeModule.routeEngine.startSectionDetection();
        if (!started) {
          if (__DEV__) {
            console.warn('[fetchDemoGps] startSectionDetection returned false — skipping poll');
          }
        } else {
          // Poll for section detection completion with smooth progress updates
          const pollInterval = 150; // ms - faster polling for smoother animations
          const maxPollTime = 60000; // 60 seconds
          const startTime = Date.now();
          let lastPercent = -1;

          while (isMountedRef.current && !abortSignal.aborted) {
            const status = nativeModule.routeEngine.pollSectionDetection();

            if (status === 'running') {
              const progress = nativeModule.routeEngine.getSectionDetectionProgress();
              if (progress) {
                const phasePercent = calculateDetectionProgress(progress.completed, progress.total);
                const phaseName = getPhaseDisplayName(progress.phase);
                const countText =
                  progress.total > 0 ? ` ${progress.completed}/${progress.total}` : '';

                updateProgress({
                  status: 'computing',
                  completed: progress.completed,
                  total: progress.total,
                  percent: phasePercent,
                  message: `${phaseName}${countText}`,
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

            // Check timeout
            if (Date.now() - startTime > maxPollTime) {
              if (__DEV__) {
                console.warn('[fetchDemoGps] Section detection timed out');
              }
              break;
            }

            await new Promise((resolve) => setTimeout(resolve, pollInterval));
          }
        }

        // Section detection complete - refresh groups and sections
        routeEngine.triggerRefresh('groups');
        routeEngine.triggerRefresh('sections');

        // Poll heatmap tile generation (runs on Rust background thread)
        await pollTileGeneration(isMountedRef);

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
            completed: 0,
            total: activityIds.length,
          }),
        });
      }

      // Start combined fetch+store - Rust downloads GPS data and stores directly
      // NO FFI round-trip: GPS data never crosses to TypeScript and back
      startFetchAndStore(authHeader, activityIds, sportTypes);

      // Poll for progress every 100ms until complete
      let pollCount = 0;
      while (isMountedRef.current && !abortSignal.aborted) {
        await new Promise((resolve) => setTimeout(resolve, 100));

        const progress = getDownloadProgress();
        pollCount++;

        if (__DEV__ && pollCount <= 5) {
          console.log(
            `[fetchApiGps] Poll #${pollCount}: active=${progress.active}, completed=${progress.completed}/${progress.total}`
          );
        }

        if (progress.active) {
          // Download is 0-50% when route matching is on (detection fills 50-100%),
          // or 0-100% when route matching is off (no detection phase).
          const maxPercent = isRouteMatchingEnabled() ? 50 : 100;
          const dlPercent =
            progress.total > 0 ? Math.round((progress.completed / progress.total) * maxPercent) : 0;
          updateProgress({
            status: 'fetching',
            completed: progress.completed,
            total: progress.total,
            percent: dlPercent,
            message: i18n.t('cache.downloadingGpsProgress', {
              completed: progress.completed,
              total: progress.total,
            }),
          });
        } else {
          if (__DEV__) {
            console.log(
              `[fetchApiGps] Polling stopped: active=false after ${pollCount} polls, final progress: ${progress.completed}/${progress.total}`
            );
          }
          break;
        }
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

      if (result.syncedIds.length > 0 && isMountedRef.current) {
        // Sync activity metrics BEFORE notifying UI — subscribers query metrics on notification
        const syncedActivities = activities.filter((a) => result.syncedIds.includes(a.id));
        const metrics = syncedActivities.map(toActivityMetrics);
        routeEngine.setActivityMetrics(metrics);

        // Now notify UI that activities have been added (metrics are already in DB)
        routeEngine.triggerRefresh('activities');
        routeEngine.triggerRefresh('groups');
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

      if (needsDetection && isMountedRef.current) {
        updateProgress({
          status: 'computing',
          completed: 0,
          total: 0,
          percent: 50,
          message: i18n.t('cache.analyzingRoutes'),
        });

        await new Promise((resolve) => setTimeout(resolve, 0));

        // Start section detection
        resetProgressTracker();
        const started = nativeModule.routeEngine.startSectionDetection();
        if (!started) {
          if (__DEV__) {
            console.warn('[fetchApiGps] startSectionDetection returned false — skipping poll');
          }
        } else {
          // Poll for section detection completion
          const pollInterval = 150;
          const maxPollTime = 60000;
          const startTime = Date.now();
          let lastPercent = -1;

          while (isMountedRef.current && !abortSignal.aborted) {
            const status = nativeModule.routeEngine.pollSectionDetection();

            if (status === 'running') {
              const progress = nativeModule.routeEngine.getSectionDetectionProgress();
              if (progress) {
                const phasePercent = calculateDetectionProgress(progress.completed, progress.total);
                const phaseName = getPhaseDisplayName(progress.phase);
                const countText =
                  progress.total > 0 ? ` ${progress.completed}/${progress.total}` : '';

                updateProgress({
                  status: 'computing',
                  completed: progress.completed,
                  total: progress.total,
                  percent: phasePercent,
                  message: `${phaseName}${countText}`,
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

        // Section detection complete - refresh groups and sections
        routeEngine.triggerRefresh('groups');
        routeEngine.triggerRefresh('sections');

        // Poll heatmap tile generation (runs on Rust background thread)
        await pollTileGeneration(isMountedRef);
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

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
import { getStoredCredentials, getSyncGeneration } from '@/providers';
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
 * Phase weights for section detection progress calculation.
 * Maps Rust detection phases to 0-100% progress within the section detection stage.
 *
 * Rust emits phases: "loading", "building_rtrees", "finding_overlaps",
 *                    "clustering", "postprocessing", "saving", "complete"
 */
const PHASE_WEIGHTS: Record<string, { start: number; weight: number }> = {
  loading: { start: 0, weight: 8 },
  building_rtrees: { start: 8, weight: 7 },
  finding_overlaps: { start: 15, weight: 50 },
  clustering: { start: 65, weight: 15 },
  postprocessing: { start: 80, weight: 15 },
  saving: { start: 95, weight: 5 },
  complete: { start: 100, weight: 0 },
  detecting: { start: 15, weight: 80 }, // backwards compat (single blocking call)
};

// Track the last known progress to prevent backwards jumps
let lastKnownProgress = 0;

// Timestamp of last progress update, used for time-based interpolation
let lastProgressUpdateTime = 0;

/**
 * Calculate overall progress percentage across all phases.
 * Returns a smoothly increasing value from 0-100.
 * Uses monotonic tracking to prevent backwards jumps from unknown phases.
 *
 * Applies time-based interpolation: if no new progress has arrived for a while,
 * nudge the displayed value forward slowly to give a sense of continuous movement.
 */
function calculateOverallProgress(phase: string, completed: number, total: number): number {
  // Handle scale phases (e.g., "scale_short", "scale_medium") - treat as finding_overlaps
  const normalizedPhase = phase.startsWith('scale_') ? 'finding_overlaps' : phase;

  const phaseInfo = PHASE_WEIGHTS[normalizedPhase];
  if (!phaseInfo) {
    // Unknown phase - return last known progress instead of 0 to prevent jumps
    if (__DEV__) {
      console.log(
        `[calculateOverallProgress] Unknown phase: "${phase}", keeping progress at ${lastKnownProgress}`
      );
    }
    return lastKnownProgress;
  }

  const now = Date.now();

  // Calculate progress within this phase
  const phaseProgress = total > 0 ? Math.min(completed / total, 1) : 0;

  // Overall = phase start + (phase weight * progress within phase)
  const rawProgress = Math.round(phaseInfo.start + phaseInfo.weight * phaseProgress);

  // Compute the maximum the display should reach for the current phase
  // (the end of the phase range). Used to cap time-based interpolation.
  const phaseEnd = phaseInfo.start + phaseInfo.weight;

  // Time-based interpolation: if the raw progress hasn't changed but time has elapsed,
  // creep forward by up to 1% per 300ms towards the phase ceiling.
  // This prevents the bar from appearing frozen during long computations.
  let newProgress = rawProgress;
  if (rawProgress === lastKnownProgress && lastProgressUpdateTime > 0) {
    const elapsed = now - lastProgressUpdateTime;
    const interpolatedCreep = Math.floor(elapsed / 300); // 1% per 300ms
    if (interpolatedCreep > 0) {
      // Don't creep past the end of the current phase
      const maxCreep = Math.max(0, Math.floor(phaseEnd) - lastKnownProgress - 1);
      newProgress = lastKnownProgress + Math.min(interpolatedCreep, maxCreep);
    }
  }

  // Only allow progress to increase (monotonic) to prevent backwards jumps
  // Exception: if we're at 'loading' phase, allow reset to start new detection
  if (newProgress >= lastKnownProgress || normalizedPhase === 'loading') {
    if (newProgress !== lastKnownProgress) {
      lastProgressUpdateTime = now;
    }
    lastKnownProgress = newProgress;
    return newProgress;
  }

  // Progress would go backwards - keep the higher value
  return lastKnownProgress;
}

/**
 * Reset the progress tracker. Call this when starting a new sync operation.
 */
export function resetProgressTracker(): void {
  lastKnownProgress = 0;
  lastProgressUpdateTime = 0;
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
              // Get progress and calculate overall percentage
              const progress = nativeModule.routeEngine.getSectionDetectionProgress();
              // If no progress yet, keep the last percentage (don't reset to 0)
              const overallPercent = progress
                ? calculateOverallProgress(progress.phase, progress.completed, progress.total)
                : lastPercent >= 0
                  ? lastPercent
                  : 0;

              // Update on every percentage change - the animation will smooth transitions
              if (overallPercent !== lastPercent) {
                const message = progress
                  ? getSectionDetectionMessage(progress.phase)
                  : i18n.t('cache.analyzingRoutes');

                updateProgress({
                  status: 'computing',
                  completed: 0,
                  total: 0,
                  percent: overallPercent,
                  message,
                });
                lastPercent = overallPercent;
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
          message: i18n.t('cache.downloadingGpsProgress', { completed: 0, total: activityIds.length }),
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
          const dlPercent =
            progress.total > 0 ? Math.round((progress.completed / progress.total) * 100) : 0;
          updateProgress({
            status: 'fetching',
            completed: progress.completed,
            total: progress.total,
            percent: dlPercent,
            message: i18n.t('cache.downloadingGpsProgress', { completed: progress.completed, total: progress.total }),
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

      // Run section detection if new activities were synced OR if the engine
      // needs re-detection (e.g., after a migration updated the portions algorithm)
      const needsDetection =
        result.syncedIds.length > 0 || routeEngine.getStats()?.sectionsDirty === true;

      if (needsDetection && isMountedRef.current) {
        updateProgress({
          status: 'computing',
          completed: 0,
          total: 0,
          percent: 0,
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
              const overallPercent = progress
                ? calculateOverallProgress(progress.phase, progress.completed, progress.total)
                : lastPercent >= 0
                  ? lastPercent
                  : 0;

              if (overallPercent !== lastPercent) {
                const message = progress
                  ? getSectionDetectionMessage(progress.phase)
                  : i18n.t('cache.analyzingRoutes');

                updateProgress({
                  status: 'computing',
                  completed: 0,
                  total: 0,
                  percent: overallPercent,
                  message,
                });
                lastPercent = overallPercent;
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

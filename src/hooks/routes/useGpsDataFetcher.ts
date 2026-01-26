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
import * as FileSystem from 'expo-file-system/legacy';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { i18n } from '@/i18n';
import { getNativeModule } from '@/lib/native/routeEngine';
import {
  routeEngine,
  detectSectionsMultiscale,
  gpsPointsToRoutePoints,
  SectionConfig,
  startBackgroundFetch,
  getDownloadProgress,
  takeBackgroundFetchResults,
  startFetchAndStore,
  takeFetchAndStoreResult,
  ffiGenerateAndSaveTiles,
  type RouteGroup,
  type ActivitySportType,
  type ActivitySportMapping,
  type FfiTileConfig,
} from 'veloqrs';
import { getStoredCredentials, getSyncGeneration } from '@/providers';
import { usePotentialSections as usePotentialSectionsStore } from '@/providers/PotentialSectionsStore';
import { toActivityMetrics } from '@/lib/utils/activityMetrics';
import type { Activity, PotentialSection } from '@/types';
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
 * Minimum number of activities before running potential section detection.
 */
const MIN_ACTIVITIES_FOR_POTENTIAL_DETECTION = 10;

/**
 * Phase weights for overall progress calculation.
 * These roughly correspond to how long each phase takes.
 */
const PHASE_WEIGHTS: Record<string, { start: number; weight: number }> = {
  loading: { start: 0, weight: 10 },
  building_rtrees: { start: 10, weight: 5 },
  finding_overlaps: { start: 15, weight: 40 },
  clustering: { start: 55, weight: 10 },
  building_sections: { start: 65, weight: 20 },
  postprocessing: { start: 85, weight: 15 },
  complete: { start: 100, weight: 0 },
};

// Track the last known progress to prevent backwards jumps
let lastKnownProgress = 0;

/**
 * Calculate overall progress percentage across all phases.
 * Returns a smoothly increasing value from 0-100.
 * Uses monotonic tracking to prevent backwards jumps from unknown phases.
 */
function calculateOverallProgress(phase: string, completed: number, total: number): number {
  // Handle scale phases (e.g., "scale_short", "scale_medium") - treat as finding_overlaps
  const normalizedPhase = phase.startsWith('scale_') ? 'finding_overlaps' : phase;

  const phaseInfo = PHASE_WEIGHTS[normalizedPhase];
  if (!phaseInfo) {
    // Unknown phase - return last known progress instead of 0 to prevent jumps
    // This handles any phases added in Rust that aren't yet mapped here
    if (__DEV__) {
      console.log(
        `[calculateOverallProgress] Unknown phase: "${phase}", keeping progress at ${lastKnownProgress}`
      );
    }
    return lastKnownProgress;
  }

  // Calculate progress within this phase
  const phaseProgress = total > 0 ? Math.min(completed / total, 1) : 0;

  // Overall = phase start + (phase weight * progress within phase)
  const newProgress = Math.round(phaseInfo.start + phaseInfo.weight * phaseProgress);

  // Only allow progress to increase (monotonic) to prevent backwards jumps
  // Exception: if we're at 'loading' phase, allow reset to start new detection
  if (newProgress >= lastKnownProgress || normalizedPhase === 'loading') {
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
}

/**
 * Get a user-friendly message for section detection.
 * Simplified to show just "Analyzing routes..." with percentage.
 * Uses i18n for translation support.
 */
function getSectionDetectionMessage(phase: string, completed: number, total: number): string {
  if (phase === 'complete') {
    return i18n.t('cache.routeAnalysisComplete');
  }

  const percent = calculateOverallProgress(phase, completed, total);
  return i18n.t('cache.analyzingRoutesProgress', { percent });
}

/**
 * Run potential section detection and store results.
 *
 * NOTE: This is intentionally SKIPPED during initial sync to keep the sync fast.
 * Potential sections (1-2 activity overlaps) are a nice-to-have feature that
 * can be detected lazily when the user views the Routes screen.
 *
 * The full implementation has been moved to a separate lazy detection system.
 * This stub is kept to maintain the API signature for callers.
 */
async function runPotentialSectionDetection(
  _nativeModule: ReturnType<typeof getNativeModule>,
  _updateProgress?: (p: SyncProgress) => void
): Promise<void> {
  // Skip potential section detection during sync to keep it fast
  // This operation is expensive (54+ FFI calls for getGpsTrack + synchronous detection)
  // and blocks the UI. Potential sections can be detected lazily when viewing Routes screen.
  if (__DEV__) {
    console.log('[runPotentialSectionDetection] Skipping during sync for performance');
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

/** Directory for heatmap tiles - URI format for Expo FileSystem */
const HEATMAP_TILES_DIR_URI = `${FileSystem.documentDirectory}heatmap-tiles`;

/** Directory for heatmap tiles - filesystem path for Rust FFI (no file:// prefix) */
const HEATMAP_TILES_DIR_PATH = HEATMAP_TILES_DIR_URI.replace('file://', '');

/** Default tile configuration - zoom 0-16 covers world view to street level */
const DEFAULT_TILE_CONFIG: FfiTileConfig = {
  lineColorR: 252,
  lineColorG: 76,
  lineColorB: 2,
  lineColorA: 180,
  lineWidth: 2.0,
  minZoom: 0,
  maxZoom: 16,
};

/**
 * Generate heatmap tiles after sync/section detection completes.
 * Runs in background and doesn't block the sync completion.
 */
async function generateHeatmapTilesInBackground(queryClient: QueryClient): Promise<void> {
  if (__DEV__) {
    console.log('[Heatmap] Starting tile generation...');
  }
  try {
    // Ensure tiles directory exists (FileSystem needs URI)
    const dirInfo = await FileSystem.getInfoAsync(HEATMAP_TILES_DIR_URI);
    if (!dirInfo.exists) {
      await FileSystem.makeDirectoryAsync(HEATMAP_TILES_DIR_URI, { intermediates: true });
    }

    // Generate and save tiles using direct FFI function
    // (Rust needs filesystem path, not file:// URI)
    const result = ffiGenerateAndSaveTiles(HEATMAP_TILES_DIR_PATH, DEFAULT_TILE_CONFIG);
    if (__DEV__) {
      console.log(
        `[Heatmap] Generated ${result.tilesSaved} tiles from ${result.tracksProcessed} tracks ` +
          `(${result.generationTimeMs}ms generation, ${result.saveTimeMs}ms save)`
      );
    }

    // Invalidate tiles query so UI updates
    queryClient.invalidateQueries({ queryKey: ['heatmap-tiles-exist'] });
  } catch (error) {
    if (__DEV__) {
      console.warn('[Heatmap] Tile generation failed:', error);
    }
    // Don't rethrow - heatmap generation is non-critical
  }
}

export function useGpsDataFetcher() {
  const queryClient = useQueryClient();

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
          message: 'Engine not available',
        };
      }

      // Update progress
      if (isMountedRef.current) {
        updateProgress({
          status: 'fetching',
          completed: 0,
          total: activities.length,
          message: 'Loading demo GPS data...',
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

        // Start section detection and poll for progress
        // Reset the progress tracker for a fresh sync
        resetProgressTracker();
        nativeModule.routeEngine.startSectionDetection();

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
                ? getSectionDetectionMessage(progress.phase, progress.completed, progress.total)
                : i18n.t('cache.analyzingRoutes');

              updateProgress({
                status: 'computing',
                completed: overallPercent,
                total: 100,
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

        // Section detection complete - refresh groups now that they're computed
        routeEngine.triggerRefresh('groups');

        // Run potential section detection after regular detection completes
        if (isMountedRef.current && !abortSignal.aborted) {
          await runPotentialSectionDetection(nativeModule, updateProgress);
        }

        // Generate heatmap tiles in background (non-blocking)
        generateHeatmapTilesInBackground(queryClient);

        if (isMountedRef.current) {
          updateProgress({
            status: 'complete',
            completed: ids.length,
            total: activities.length,
            message: `Synced ${ids.length} demo activities`,
          });
        }

        return {
          syncedIds: ids,
          withGpsCount: activities.length,
          message: `Synced ${ids.length} demo activities`,
        };
      }

      // Update progress to complete/idle when no valid GPS data found
      if (isMountedRef.current) {
        updateProgress({
          status: 'idle',
          completed: 0,
          total: activities.length,
          message: `No valid GPS data found (checked ${activities.length} activities)`,
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
        message: 'No valid GPS data in fixtures',
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
          message: 'Fetching GPS data...',
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
          message: `Downloading GPS data... 0/${activityIds.length}`,
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
          updateProgress({
            status: 'fetching',
            completed: progress.completed,
            total: progress.total,
            message: `Downloading GPS data... ${progress.completed}/${progress.total}`,
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
        // Notify UI that activities have been added
        // startFetchAndStore bypasses RouteEngineClient.addActivities() so we must trigger manually
        routeEngine.triggerRefresh('activities');
        routeEngine.triggerRefresh('groups');

        // Sync activity metrics for performance calculations
        const syncedActivities = activities.filter((a) => result.syncedIds.includes(a.id));
        const metrics = syncedActivities.map(toActivityMetrics);
        routeEngine.setActivityMetrics(metrics);

        updateProgress({
          status: 'computing',
          completed: 0,
          total: 100,
          message: 'Starting route analysis...',
        });

        await new Promise((resolve) => setTimeout(resolve, 0));

        // Start section detection
        resetProgressTracker();
        nativeModule.routeEngine.startSectionDetection();

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
                ? getSectionDetectionMessage(progress.phase, progress.completed, progress.total)
                : i18n.t('cache.analyzingRoutes');

              updateProgress({
                status: 'computing',
                completed: overallPercent,
                total: 100,
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

        // Section detection complete - refresh groups now that they're computed
        routeEngine.triggerRefresh('groups');

        // Run potential section detection
        if (isMountedRef.current && !abortSignal.aborted) {
          await new Promise((resolve) => setTimeout(resolve, 0));
          await runPotentialSectionDetection(nativeModule, updateProgress);
        }

        // Generate heatmap tiles in background (non-blocking)
        // Only runs after tracks are actually added to the engine
        generateHeatmapTilesInBackground(queryClient);
      }

      // Final progress update
      if (isMountedRef.current) {
        updateProgress({
          status: 'complete',
          completed: result.successCount,
          total: activities.length,
          message: `Synced ${result.successCount} activities`,
        });
      }

      return {
        syncedIds: result.syncedIds,
        withGpsCount: activities.length,
        message: `Synced ${result.successCount} activities`,
      };
    },
    []
  );

  return {
    fetchDemoGps,
    fetchApiGps,
  };
}

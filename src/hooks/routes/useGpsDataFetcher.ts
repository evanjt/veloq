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
  detectSectionsMultiscale,
  gpsPointsToRoutePoints,
  SectionConfig,
  getDownloadProgress,
  type RouteGroup,
  type ActivitySportType,
} from 'route-matcher-native';
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
 * This runs AFTER regular section detection completes during GPS sync.
 */
async function runPotentialSectionDetection(
  nativeModule: ReturnType<typeof getNativeModule>,
  updateProgress?: (p: SyncProgress) => void
): Promise<void> {
  if (!nativeModule) return;

  const activityIds = nativeModule.routeEngine.getActivityIds();
  if (activityIds.length < MIN_ACTIVITIES_FOR_POTENTIAL_DETECTION) {
    if (__DEV__) {
      console.log(
        `[runPotentialSectionDetection] Not enough activities (${activityIds.length} < ${MIN_ACTIVITIES_FOR_POTENTIAL_DETECTION})`
      );
    }
    return;
  }

  // Check if we already have potentials stored
  const existingPotentials = usePotentialSectionsStore.getState().potentials;
  if (existingPotentials.length > 0) {
    if (__DEV__) {
      console.log(
        `[runPotentialSectionDetection] Already have ${existingPotentials.length} stored potentials, skipping`
      );
    }
    return;
  }

  if (__DEV__) {
    console.log(
      `[runPotentialSectionDetection] Running detection for ${activityIds.length} activities`
    );
  }

  updateProgress?.({
    status: 'computing',
    completed: 0,
    total: 0,
    message: 'Detecting potential sections...',
  });

  try {
    // Build flat coordinate arrays for the detection API
    const ids: string[] = [];
    const allCoords: number[] = [];
    const offsets: number[] = [];
    const activitySportTypes: ActivitySportType[] = [];

    for (const id of activityIds) {
      // Skip null/empty activity IDs - FFI requires non-null strings
      if (id == null || id === '') continue;

      const track = nativeModule.routeEngine.getGpsTrack(id);
      if (track.length >= 4) {
        ids.push(id);
        offsets.push(allCoords.length / 2);
        activitySportTypes.push({
          activityId: id,
          sportType: 'Ride', // Default - could be improved by storing sport type in engine
        });

        for (const point of track) {
          allCoords.push(point.latitude, point.longitude);
        }
      }
    }

    if (ids.length === 0) {
      if (__DEV__) {
        console.log('[runPotentialSectionDetection] No valid GPS tracks found');
      }
      return;
    }

    // Get route groups for linking sections
    const rawGroups: RouteGroup[] = nativeModule.routeEngine.getGroups();

    // Filter and sanitize groups - FFI requires all string fields to be non-null/non-empty
    const groups = rawGroups
      .filter(
        (g) =>
          g.groupId != null &&
          g.groupId !== '' &&
          g.representativeId != null &&
          g.representativeId !== '' &&
          g.activityIds != null &&
          g.activityIds.length > 0
      )
      .map((g) => ({
        ...g,
        // Ensure sportType is never null/empty - default to 'Ride' if missing
        sportType: g.sportType || 'Ride',
        // Filter out any null/empty activity IDs within the array
        activityIds: g.activityIds.filter((id): id is string => id != null && id !== ''),
        // Convert null to undefined for optional fields - FFI expects undefined, not null
        // (JSON parsing produces null, but UniFFI optional converters expect undefined)
        customName: g.customName ?? undefined,
        bestActivityId: g.bestActivityId ?? undefined,
        bounds: g.bounds ?? undefined,
        bestTime: g.bestTime ?? undefined,
        avgTime: g.avgTime ?? undefined,
        bestPace: g.bestPace ?? undefined,
      }))
      // After filtering activityIds, remove groups that ended up empty
      .filter((g) => g.activityIds.length > 0);

    if (__DEV__ && rawGroups.length !== groups.length) {
      console.log(
        `[runPotentialSectionDetection] Filtered ${rawGroups.length - groups.length} invalid groups (null/empty string fields)`
      );
    }

    // Create section config for potential detection
    const config = SectionConfig.create({
      proximityThreshold: 50,
      minSectionLength: 200,
      maxSectionLength: 5000,
      minActivities: 2,
      clusterTolerance: 80,
      samplePoints: 50,
      detectionMode: 'discovery',
      includePotentials: true,
      scalePresets: [],
      preserveHierarchy: false,
    });

    // Run multi-scale detection
    const result = detectSectionsMultiscale(
      ids,
      allCoords,
      offsets,
      activitySportTypes,
      groups,
      config
    );

    // Convert native PotentialSection to app type
    const potentials: PotentialSection[] = result.potentials.map((p) => ({
      ...p,
      polyline: gpsPointsToRoutePoints(p.polyline),
    }));

    // Store potentials
    if (potentials.length > 0) {
      await usePotentialSectionsStore.getState().setPotentials(potentials);
      if (__DEV__) {
        console.log(
          `[runPotentialSectionDetection] Stored ${potentials.length} potential sections`
        );
      }
    }
  } catch (error) {
    if (__DEV__) {
      console.error('[runPotentialSectionDetection] Detection failed:', error);
    }
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

        // Run potential section detection after regular detection completes
        if (isMountedRef.current && !abortSignal.aborted) {
          await runPotentialSectionDetection(nativeModule, updateProgress);
        }

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

      // Fetch GPS data using Rust HTTP client
      const activityIds = activities.map((a) => a.id);

      if (__DEV__) {
        console.log(`[fetchApiGps] Starting fetch for ${activityIds.length} activities...`);
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

      // Start fetch - sends all IDs to Rust in one call (Rust handles rate limiting)
      const fetchPromise = nativeModule.fetchActivityMaps(authHeader, activityIds);

      // Poll for progress while fetch runs (avoids cross-thread callback issues)
      const pollInterval = setInterval(() => {
        if (!isMountedRef.current || abortSignal.aborted) {
          clearInterval(pollInterval);
          return;
        }

        const progress = getDownloadProgress();

        if (progress.active) {
          updateProgress({
            status: 'fetching',
            completed: progress.completed,
            total: progress.total,
            message: `Downloading GPS data... ${progress.completed}/${progress.total}`,
          });
        }
      }, 100);

      // Wait for completion
      let results: Awaited<ReturnType<typeof nativeModule.fetchActivityMaps>>;
      try {
        results = await fetchPromise;
      } finally {
        clearInterval(pollInterval);
      }

      const allResults = results;

      if (__DEV__) {
        const successful = results.filter((r) => r.success);
        const withCoords = results.filter((r) => r.latlngs && r.latlngs.length >= 4);
        console.log(
          `[fetchApiGps] Fetch complete: ${results.length} results, ` +
            `${successful.length} successful, ${withCoords.length} with coords`
        );
        // Log first few failures for debugging
        const failures = results.filter((r) => !r.success).slice(0, 3);
        if (failures.length > 0) {
          console.log(
            `[fetchApiGps] Sample failures:`,
            failures.map((f) => f.activityId)
          );
        }
      }

      // Check mount state and abort signal after async operation
      if (!isMountedRef.current || abortSignal.aborted) {
        return {
          syncedIds: [],
          withGpsCount: activities.length,
          message: 'Cancelled',
        };
      }

      // Update progress to processing
      if (isMountedRef.current) {
        updateProgress({
          status: 'processing',
          completed: 0,
          total: results.length,
          message: 'Processing routes...',
        });
      }

      // Build flat coordinate arrays for the engine
      const successfulResults = results.filter((r) => r.success && r.latlngs.length >= 4);

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

      let skippedInvalidCoords = 0;

      if (successfulResults.length > 0 && isMountedRef.current) {
        const ids: string[] = [];
        const allCoords: number[] = [];
        const offsets: number[] = [];
        const sportTypes: string[] = [];

        for (const result of successfulResults) {
          const activity = activities.find((a) => a.id === result.activityId);
          if (!activity) continue;

          ids.push(result.activityId);
          offsets.push(allCoords.length / 2);
          sportTypes.push(activity.type || 'Ride');

          // Add coordinates (already in flat [lat, lng, ...] format from Rust)
          // Validate each coordinate pair before adding
          const latlngs = result.latlngs;
          for (let i = 0; i < latlngs.length - 1; i += 2) {
            const lat = latlngs[i];
            const lng = latlngs[i + 1];
            if (isValidCoordinate(lat, lng)) {
              allCoords.push(lat, lng);
            } else {
              skippedInvalidCoords++;
            }
          }
        }

        // Log skipped coordinates in development
        if (__DEV__ && skippedInvalidCoords > 0) {
          console.warn(
            `[fetchApiGps] Skipped ${skippedInvalidCoords} invalid coordinates (out of bounds or non-finite)`
          );
        }

        // Add to engine
        if (ids.length > 0 && isMountedRef.current) {
          // Check if sync generation has changed (reset occurred during fetch)
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
                console.warn('[fetchApiGps] Section detection error');
              }
              break;
            }

            // Check timeout
            if (Date.now() - startTime > maxPollTime) {
              if (__DEV__) {
                console.warn('[fetchApiGps] Section detection timed out');
              }
              break;
            }

            await new Promise((resolve) => setTimeout(resolve, pollInterval));
          }

          // Run potential section detection after regular detection completes
          if (isMountedRef.current && !abortSignal.aborted) {
            await runPotentialSectionDetection(nativeModule, updateProgress);
          }
        }
      }

      // Final progress update
      if (isMountedRef.current) {
        updateProgress({
          status: 'complete',
          completed: successfulResults.length,
          total: activities.length,
          message: `Synced ${successfulResults.length} activities`,
        });
      }

      return {
        syncedIds: successfulResults.map((r) => r.activityId),
        withGpsCount: activities.length,
        message: `Synced ${successfulResults.length} activities`,
      };
    },
    []
  );

  return {
    fetchDemoGps,
    fetchApiGps,
  };
}

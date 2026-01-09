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
import { getNativeModule } from '@/lib/native/routeEngine';
import { routeEngine } from 'route-matcher-native';
import { getStoredCredentials } from '@/providers';
import { toActivityMetrics } from '@/lib/utils/activityMetrics';
import { syncActivitiesWithCustomSections } from '@/lib/storage/customSectionSync';
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

      // Check for abort before starting
      if (abortSignal.aborted) {
        return { syncedIds: [], withGpsCount: 0, message: 'Cancelled' };
      }

      const nativeModule = getNativeModule();
      if (!nativeModule) {
        return { syncedIds: [], withGpsCount: 0, message: 'Engine not available' };
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

      // Build flat coordinate arrays for Rust FFI
      for (const activity of activities) {
        const map = getActivityMap(activity.id, false);
        if (!map?.latlngs || map.latlngs.length < 4) {
          continue;
        }

        ids.push(activity.id);
        offsets.push(allCoords.length / 2);
        sportTypes.push(activity.type || 'Ride');

        // Add coordinates (latlngs are [[lat, lng], ...])
        for (const coord of map.latlngs) {
          if (coord && coord.length >= 2) {
            allCoords.push(coord[0], coord[1]);
          }
        }
      }

      if (ids.length > 0 && isMountedRef.current) {
        // Add to engine
        await nativeModule.routeEngine.addActivities(ids, allCoords, offsets, sportTypes);

        // Sync activity metrics for performance calculations
        const syncedActivities = activities.filter((a) => ids.includes(a.id));
        const metrics = syncedActivities.map(toActivityMetrics);
        routeEngine.setActivityMetrics(metrics);

        // Sync with custom sections (non-blocking)
        syncActivitiesWithCustomSections(ids).catch(() => {});

        // Start section detection in background
        nativeModule.routeEngine.startSectionDetection();

        if (isMountedRef.current) {
          updateProgress({
            status: 'complete',
            completed: ids.length,
            total: activities.length,
            message: `Synced ${ids.length} demo activities`,
          });
        }

        return { syncedIds: ids, withGpsCount: activities.length, message: `Synced ${ids.length} demo activities` };
      }

      return { syncedIds: [], withGpsCount: activities.length, message: 'No valid GPS data in fixtures' };
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
      const { isMountedRef, abortSignal, updateProgress } = deps;

      const nativeModule = getNativeModule();
      if (!nativeModule) {
        return { syncedIds: [], withGpsCount: 0, message: 'Engine not available' };
      }

      // Get API credentials
      const creds = await getStoredCredentials();
      if (!isMountedRef.current || abortSignal.aborted) {
        return { syncedIds: [], withGpsCount: 0, message: 'Cancelled' };
      }

      if (!creds?.apiKey) {
        throw new Error('No API key available');
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

      // Set up progress listener with mount guard and abort check
      const subscription = nativeModule.addFetchProgressListener((event) => {
        // Check both mount state and abort signal
        if (!isMountedRef.current || abortSignal.aborted) {
          return;
        }
        updateProgress((p) => ({
          ...p,
          completed: event.completed,
          total: event.total,
        }));
      });

      try {
        // Fetch GPS data using Rust HTTP client
        const activityIds = activities.map((a) => a.id);
        const results = await nativeModule.fetchActivityMapsWithProgress(creds.apiKey, activityIds);

        // Check mount state and abort signal after async operation
        if (!isMountedRef.current || abortSignal.aborted) {
          return { syncedIds: [], withGpsCount: activities.length, message: 'Cancelled' };
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
            allCoords.push(...result.latlngs);
          }

          // Add to engine
          if (ids.length > 0 && isMountedRef.current) {
            await nativeModule.routeEngine.addActivities(ids, allCoords, offsets, sportTypes);

            // Sync activity metrics for performance calculations
            const syncedActivities = activities.filter((a) => ids.includes(a.id));
            const metrics = syncedActivities.map(toActivityMetrics);
            routeEngine.setActivityMetrics(metrics);

            // Sync with custom sections (non-blocking)
            syncActivitiesWithCustomSections(ids).catch(() => {});

            // Start section detection in background
            nativeModule.routeEngine.startSectionDetection();
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
      } finally {
        // Clean up progress listener
        subscription.remove();
      }
    },
    []
  );

  return {
    fetchDemoGps,
    fetchApiGps,
  };
}

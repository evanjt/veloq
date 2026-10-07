/**
 * Hook for accessing route groups.
 * Provides filtered and sorted lists of route groups from the Rust engine.
 * Uses lightweight summaries (no activityIds arrays) for list views.
 */

import { useMemo, useCallback } from 'react';
import { useGroupSummaries } from './useEngine';
import { getEngine } from '@/shared/native/engine';
import { toActivityType, type ActivityType } from '@/types';
import { groupCoversType } from '@/features/routes/lib/routeSportMembership';

interface UseRouteGroupsOptions {
  /** Filter by activity type */
  type?: ActivityType;
  /** Minimum number of activities in group */
  minActivities?: number;
  /** Sort order */
  sortBy?: 'count' | 'name';
  /** Filter routes by date range - only show routes with activities in this range */
  startDate?: Date;
  /** Filter routes by date range - only show routes with activities in this range */
  endDate?: Date;
}

interface RouteGroupExtended {
  /** Unique route ID */
  id: string;
  /** Display name for the route */
  name: string;
  representativeId: string;
  activityIds: string[];
  bounds: {
    minLat: number;
    maxLat: number;
    minLng: number;
    maxLng: number;
  } | null;
  activityCount: number;
  type: ActivityType;
  /** All sport types present in this group's activities */
  sportTypes?: string[] | undefined;
  /** The representative activity's distance in metres, absent when unknown */
  distance?: number | undefined;
  /** Best moving time in seconds (fastest completion) */
  bestTime?: number | undefined;
  /** Average moving time in seconds */
  avgTime?: number | undefined;
  /** Best pace/speed in m/s (from fastest activity) */
  bestPace?: number | undefined;
  /** Activity ID with the best performance */
  bestActivityId?: string | undefined;
}

interface UseRouteGroupsResult {
  /** List of route groups */
  groups: RouteGroupExtended[];
  /** Total number of groups (before filtering) */
  totalCount: number;
  /** Number of processed activities */
  processedCount: number;
  /** Whether the store is initialized */
  /** Rename a route (triggers refresh via engine events) */
  renameRoute: (routeId: string, name: string) => void;
  /** What the engine threw, when the read failed. Empty groups with no error is an empty library. */
  error?: unknown;
}

export function useRouteGroups(options: UseRouteGroupsOptions = {}): UseRouteGroupsResult {
  const { type, minActivities = 2, sortBy = 'count' } = options;

  // Use lightweight summaries instead of full groups (no activityIds arrays)
  // Activity-count filter + sort pushed into Rust.
  const { totalCount, summaries, error } = useGroupSummaries({
    minActivities,
    sortBy,
  });

  // Rename a route - uses Rust engine as single source of truth
  // The engine will persist the name and fire 'groups' event to trigger refresh
  const renameRoute = useCallback((routeId: string, name: string) => {
    const engine = getEngine();
    if (!engine) {
      throw new Error('Route engine not initialized');
    }
    engine.setRouteName(routeId, name);
    // No need to manually refresh - engine fires 'groups' event which
    // triggers useGroupSummaries subscriber to call refresh()
  }, []);

  const result = useMemo(() => {
    // Convert summaries to extended format. The trace is not loaded here, to
    // keep sync FFI calls off the render: useRepresentativeRoute loads it.
    // Names are stored persistently in Rust and available via customName

    const extended: RouteGroupExtended[] = summaries.map((g) => {
      return {
        id: g.groupId,
        representativeId: g.representativeId,
        activityIds: [], // Not loaded in summaries
        bounds: g.bounds ?? null,
        // Names are stored in Rust (user-set or auto-generated on creation/migration)
        name: g.customName ?? '',
        activityCount: g.activityCount,
        type: toActivityType(undefined),
        sportTypes: g.sportTypes,
        distance: g.distanceMeters > 0 ? g.distanceMeters : undefined,
        // Performance stats not in summaries
        bestTime: undefined,
        avgTime: undefined,
        bestPace: undefined,
        bestActivityId: undefined,
      };
    });

    // Activity count threshold + name/count sort are applied in Rust.
    // Only `type` (ActivityType) filtering stays in TS because the mapping
    // is display-layer logic. Membership reads every sport that has traversed
    // the ground, not the representative's alone: one loop is one route however
    // many sports have used it.
    const filtered = type ? extended.filter((g) => groupCoversType(g, type)) : extended;

    return {
      groups: filtered,
      totalCount,
      processedCount: summaries.reduce((sum, g) => sum + g.activityCount, 0),
      renameRoute,
      error,
    };
  }, [summaries, type, totalCount, renameRoute, error]);

  return result;
}

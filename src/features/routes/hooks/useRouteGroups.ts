/**
 * Hook for accessing route groups.
 * Provides filtered and sorted lists of route groups from the Rust engine.
 * Uses lightweight summaries (no activityIds arrays) for list views.
 */

import { useMemo, useCallback } from 'react';
import { useGroupSummaries } from './useEngine';
import type { ActivityType } from '@/types';
import { groupCoversType } from '@/features/routes/lib/routeSportMembership';
import type { LiveRouteOverlap } from 'veloqrs';
import { routes } from 'veloqrs';

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
  bounds: {
    minLat: number;
    maxLat: number;
    minLng: number;
    maxLng: number;
  } | null;
  activityCount: number;
  /** All sport types present in this group's activities */
  sportTypes?: string[] | undefined;
  /** The representative activity's distance in metres, absent when unknown */
  distance?: number | undefined;
}

interface UseRouteGroupsResult {
  /** List of route groups */
  groups: RouteGroupExtended[];
  /** Number of processed activities */
  processedCount: number;
  /** What the engine threw, when the read failed. Empty groups with no error is an empty library. */
  error?: unknown;
  /** Reads the groups again after a failure. */
  retry: () => void;
  measureLiveOverlap: (groupIds: string[], coordinates: number[]) => Promise<LiveRouteOverlap[]>;
}

export function useRouteGroups(options: UseRouteGroupsOptions = {}): UseRouteGroupsResult {
  const { type, minActivities = 2, sortBy = 'count' } = options;

  // Use lightweight summaries instead of full groups (no activityIds arrays)
  // Activity-count filter + sort pushed into Rust.
  const { summaries, error, retry } = useGroupSummaries({
    minActivities,
    sortBy,
  });

  const measureLiveOverlap = useCallback((groupIds: string[], coordinates: number[]) => {
    return routes.liveRouteOverlaps(groupIds, coordinates);
  }, []);

  const result = useMemo(() => {
    // Convert summaries to extended format. The trace is not loaded here, to
    // keep sync FFI calls off the render: useRepresentativeRoute loads it.
    // Names are stored persistently in Rust and available via customName

    const extended: RouteGroupExtended[] = summaries.map((g) => {
      return {
        id: g.groupId,
        representativeId: g.representativeId,
        bounds: g.bounds ?? null,
        // Names are stored in Rust (user-set or auto-generated on creation/migration)
        name: g.customName ?? '',
        activityCount: g.activityCount,
        sportTypes: g.sportTypes,
        distance: g.distanceMeters > 0 ? g.distanceMeters : undefined,
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
      processedCount: summaries.reduce((sum, g) => sum + g.activityCount, 0),
      error,
      retry,
      measureLiveOverlap,
    };
  }, [summaries, type, error, retry, measureLiveOverlap]);

  return result;
}

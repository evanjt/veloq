/**
 * Hook for accessing route groups.
 * Provides filtered and sorted lists of route groups from the Rust engine.
 * Uses lightweight summaries (no activityIds arrays) for list views.
 */

import { useMemo, useCallback } from 'react';
import { useGroupSummaries } from './useRouteEngine';
import { getRouteEngine } from '@/lib/native/routeEngine';
import { toActivityType, type ActivityType } from '@/types';

interface UseRouteGroupsOptions {
  /** Filter by activity type */
  type?: ActivityType;
  /** Minimum number of activities in group */
  minActivities?: number;
  /** Sort order */
  sortBy?: 'count' | 'recent' | 'name';
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
  sportType: string;
  bounds: {
    minLat: number;
    maxLat: number;
    minLng: number;
    maxLng: number;
  } | null;
  activityCount: number;
  type: ActivityType;
  /** All sport types present in this group's activities */
  sportTypes?: string[];
  /** Route signature with points for mini-trace preview */
  signature?: {
    points: Array<{ lat: number; lng: number }>;
    distance: number;
  } | null;
  /** Best moving time in seconds (fastest completion) */
  bestTime?: number;
  /** Average moving time in seconds */
  avgTime?: number;
  /** Best pace/speed in m/s (from fastest activity) */
  bestPace?: number;
  /** Activity ID with the best performance */
  bestActivityId?: string;
}

interface UseRouteGroupsResult {
  /** List of route groups */
  groups: RouteGroupExtended[];
  /** Total number of groups (before filtering) */
  totalCount: number;
  /** Number of processed activities */
  processedCount: number;
  /** Whether the store is initialized */
  isReady: boolean;
  /** Rename a route (triggers refresh via engine events) */
  renameRoute: (routeId: string, name: string) => void;
}

export function useRouteGroups(options: UseRouteGroupsOptions = {}): UseRouteGroupsResult {
  const { type, minActivities = 2, sortBy = 'count' } = options;

  // Use lightweight summaries instead of full groups (no activityIds arrays)
  // Activity-count filter + sort pushed into Rust.
  const { totalCount, summaries } = useGroupSummaries({
    minActivities,
    sortBy: sortBy === 'name' ? 'name' : 'count',
  });

  // Rename a route - uses Rust engine as single source of truth
  // The engine will persist the name and fire 'groups' event to trigger refresh
  const renameRoute = useCallback((routeId: string, name: string) => {
    const engine = getRouteEngine();
    if (!engine) {
      throw new Error('Route engine not initialized');
    }
    engine.setRouteName(routeId, name);
    // No need to manually refresh - engine fires 'groups' event which
    // triggers useGroupSummaries subscriber to call refresh()
  }, []);

  const result = useMemo(() => {
    // Convert summaries to extended format
    // NOTE: Signature is NOT loaded here to avoid blocking render with sync FFI calls.
    // Use useConsensusRoute hook to load signature lazily when needed.
    // Names are stored persistently in Rust and available via customName

    const extended: RouteGroupExtended[] = summaries.map((g) => {
      const sportType = g.sportType || 'Ride';

      return {
        id: g.groupId,
        representativeId: g.representativeId,
        activityIds: [], // Not loaded in summaries - use useGroupDetail for full data
        sportType: g.sportType,
        bounds: g.bounds ?? null,
        // Names are stored in Rust (user-set or auto-generated on creation/migration)
        name: g.customName ?? g.groupId,
        activityCount: g.activityCount,
        type: toActivityType(sportType),
        sportTypes: g.sportTypes ?? [sportType],
        // Signature loaded lazily via useConsensusRoute to avoid blocking render
        signature: undefined,
        // Performance stats not in summaries - use useGroupDetail for full data
        bestTime: undefined,
        avgTime: undefined,
        bestPace: undefined,
        bestActivityId: undefined,
      };
    });

    // Activity count threshold + name/count sort are applied in Rust.
    // Only `type` (ActivityType) filtering stays in TS because the mapping
    // is display-layer logic.
    const filtered = type ? extended.filter((g) => g.type === type) : extended;

    return {
      groups: filtered,
      totalCount,
      processedCount: summaries.reduce((sum, g) => sum + g.activityCount, 0),
      isReady: true,
      renameRoute,
    };
  }, [summaries, type, totalCount, renameRoute]);

  return result;
}

/**
 * Get all route display names.
 * Names are now stored persistently in Rust (user-set or auto-generated on creation).
 * Used for uniqueness validation when renaming routes.
 * Returns a map of routeId -> displayName for all routes.
 */
export function getAllRouteDisplayNames(): Record<string, string> {
  const engine = getRouteEngine();
  if (!engine) return {};

  // Use lightweight summaries - names are stored in customName field
  const { summaries } = engine.getGroupSummaries();

  const result: Record<string, string> = {};
  for (const summary of summaries) {
    // Names are stored in Rust (user-set or auto-generated on creation/migration)
    result[summary.groupId] = summary.customName ?? summary.groupId;
  }

  return result;
}

/**
 * Get the display name for a specific route by ID.
 * Computes the index based on sorted position within sport type.
 */
export function getRouteDisplayName(routeId: string): string | null {
  const allNames = getAllRouteDisplayNames();
  return allNames[routeId] ?? null;
}

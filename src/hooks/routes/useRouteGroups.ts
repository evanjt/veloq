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
  const { count: totalCount, summaries } = useGroupSummaries({
    minActivities: 1, // Get all, filter below
    sortBy: 'count',
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
    const extended: RouteGroupExtended[] = summaries.map((g, index) => {
      const sportType = g.sportType || 'Ride';

      // Use custom name from summary if set, otherwise generate default
      const name = g.customName || `${sportType} Route ${index + 1}`;

      return {
        id: g.groupId,
        representativeId: g.representativeId,
        activityIds: [], // Not loaded in summaries - use useGroupDetail for full data
        sportType: g.sportType,
        bounds: g.bounds ?? null,
        name,
        activityCount: g.activityCount,
        type: toActivityType(sportType),
        // Signature loaded lazily via useConsensusRoute to avoid blocking render
        signature: undefined,
        // Performance stats not in summaries - use useGroupDetail for full data
        bestTime: undefined,
        avgTime: undefined,
        bestPace: undefined,
        bestActivityId: undefined,
      };
    });

    let filtered = extended;

    // Filter by type
    if (type) {
      filtered = filtered.filter((g) => g.type === type);
    }

    // Filter by minimum activities
    filtered = filtered.filter((g) => g.activityCount >= minActivities);

    // Sort
    const sorted = [...filtered];
    switch (sortBy) {
      case 'count':
        sorted.sort((a, b) => b.activityCount - a.activityCount);
        break;
      case 'name':
        sorted.sort((a, b) => a.id.localeCompare(b.id));
        break;
      // 'recent' would require dates which aren't in the engine yet
      default:
        sorted.sort((a, b) => b.activityCount - a.activityCount);
    }

    return {
      groups: sorted,
      totalCount,
      // processedCount from sum of activityCount (no need for full activityIds arrays)
      processedCount: summaries.reduce((sum, g) => sum + g.activityCount, 0),
      isReady: true,
      renameRoute,
    };
  }, [summaries, type, minActivities, sortBy, totalCount, renameRoute]);

  return result;
}

/**
 * Get all route display names (custom or auto-generated).
 * Used for uniqueness validation when renaming routes.
 * Returns a map of routeId -> displayName for all routes.
 */
export function getAllRouteDisplayNames(): Record<string, string> {
  const engine = getRouteEngine();
  if (!engine) return {};

  // Use lightweight summaries instead of full groups
  const summaries = engine.getGroupSummaries();
  const result: Record<string, string> = {};

  summaries.forEach((summary, index) => {
    const sportType = summary.sportType || 'Ride';
    // Use custom name if set, otherwise generate default name
    result[summary.groupId] = summary.customName || `${sportType} Route ${index + 1}`;
  });

  return result;
}

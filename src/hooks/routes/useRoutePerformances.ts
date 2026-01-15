/**
 * Hook for getting performance data for all activities in a route group.
 * Uses API-provided metrics (average_speed, etc.) instead of recalculating.
 * Match direction and percentage come from Rust engine.
 */

import { useMemo } from 'react';
import { useEngineGroups } from './useRouteEngine';
import type { Activity, RouteGroup, MatchDirection } from '@/types';
import { toActivityType } from '@/types';

export interface RoutePerformancePoint {
  activityId: string;
  date: Date;
  name: string;
  /** Speed in m/s (from API's average_speed) */
  speed: number;
  /** Duration in seconds (elapsed_time from API) */
  duration: number;
  /** Moving time in seconds */
  movingTime: number;
  /** Distance in meters */
  distance: number;
  /** Elevation gain in meters */
  elevationGain: number;
  /** Average heart rate */
  avgHr?: number;
  /** Average power */
  avgPower?: number;
  /** Is this the current activity being viewed */
  isCurrent: boolean;
  /** Match direction: same, reverse, or partial */
  direction: MatchDirection;
  /** Match percentage (0-100) */
  matchPercentage: number;
}

interface UseRoutePerformancesResult {
  /** Route group info */
  routeGroup: RouteGroup | null;
  /** Performance data points sorted by date */
  performances: RoutePerformancePoint[];
  /** Whether data is loading */
  isLoading: boolean;
  /** Best performance (fastest average speed) */
  best: RoutePerformancePoint | null;
  /** Current activity's rank (1 = fastest) */
  currentRank: number | null;
}

// Note: For routes, we use API data directly. Match info (direction, percentage)
// is only needed for sections where we calculate segment-specific times.
// Routes are already grouped by GPS similarity, so we default to 100% match.

export function useRoutePerformances(
  activityId: string | undefined,
  routeGroupId?: string,
  activities?: Activity[]
): UseRoutePerformancesResult {
  const { groups } = useEngineGroups({ minActivities: 1 });

  // Find route group - either from provided ID or by looking up activity
  const engineGroup = useMemo(() => {
    if (routeGroupId) {
      return groups.find((g) => g.groupId === routeGroupId) || null;
    }

    if (activityId) {
      return groups.find((g) => g.activityIds.includes(activityId)) || null;
    }

    return null;
  }, [groups, routeGroupId, activityId]);

  // Convert to RouteGroup type
  // Get the index of this group in the full list (matching useRouteGroups naming convention)
  const groupIndex = useMemo(() => {
    if (!engineGroup) return 0;
    // Use global index (not sport-filtered) to match useRouteGroups naming
    return groups.findIndex((g) => g.groupId === engineGroup.groupId) + 1;
  }, [groups, engineGroup]);

  const routeGroup = useMemo((): RouteGroup | null => {
    if (!engineGroup) return null;
    // Use customName if set, otherwise generate name matching useRouteGroups convention
    const sportType = engineGroup.sportType || 'Ride';
    const defaultName = `${sportType} Route ${groupIndex}`;
    return {
      id: engineGroup.groupId,
      name: engineGroup.customName || defaultName,
      type: toActivityType(engineGroup.sportType),
      activityIds: engineGroup.activityIds,
      activityCount: engineGroup.activityIds.length,
      firstDate: '',
      lastDate: '',
    };
  }, [engineGroup, groupIndex]);

  // Build performances from Activity objects (API data)
  // No Rust calculation needed - we use API's average_speed directly
  const { performances, best, currentRank } = useMemo(() => {
    if (!engineGroup || !activities || activities.length === 0) {
      return { performances: [], best: null, currentRank: null };
    }

    // Filter to activities in this route group
    const groupActivityIds = new Set(engineGroup.activityIds);
    const groupActivities = activities.filter((a) => groupActivityIds.has(a.id));

    // Build performance points from API data
    // Filter out activities with invalid speed (would crash chart)
    const validActivities = groupActivities.filter(
      (a) => Number.isFinite(a.average_speed) && a.average_speed > 0
    );

    const points: RoutePerformancePoint[] = validActivities.map((activity) => ({
      activityId: activity.id,
      date: new Date(activity.start_date_local),
      name: activity.name,
      speed: activity.average_speed, // Direct from API!
      duration: activity.elapsed_time,
      movingTime: activity.moving_time,
      distance: activity.distance || 0,
      elevationGain: activity.total_elevation_gain || 0,
      avgHr: activity.average_heartrate ?? activity.icu_average_hr,
      avgPower: activity.average_watts ?? activity.icu_average_watts,
      isCurrent: activity.id === activityId,
      direction: 'same' as MatchDirection, // Routes are grouped by similarity
      matchPercentage: 100, // All activities in a route group match
    }));

    // Sort by date (oldest first for charting)
    points.sort((a, b) => a.date.getTime() - b.date.getTime());

    // Find best (fastest speed)
    const bestPoint =
      points.length > 0
        ? points.reduce((best, p) => (p.speed > best.speed ? p : best), points[0])
        : null;

    // Calculate current rank (1 = fastest)
    let rank: number | null = null;
    if (activityId && points.length > 0) {
      const sortedBySpeed = [...points].sort((a, b) => b.speed - a.speed);
      const idx = sortedBySpeed.findIndex((p) => p.activityId === activityId);
      if (idx >= 0) {
        rank = idx + 1;
      }
    }

    return {
      performances: points,
      best: bestPoint,
      currentRank: rank,
    };
  }, [engineGroup, activities, activityId]);

  return {
    routeGroup,
    performances,
    isLoading: false,
    best,
    currentRank,
  };
}

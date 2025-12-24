/**
 * Hook for getting performance data for all activities in a route group.
 * Used to display performance comparison charts.
 */

import { useMemo } from 'react';
import { useRouteMatchStore } from '@/providers/RouteMatchStore';
import { useActivities } from '@/hooks/useActivities';
import type { RouteGroup, Activity, MatchDirection } from '@/types';

export interface RoutePerformancePoint {
  activityId: string;
  date: Date;
  name: string;
  /** Speed in m/s */
  speed: number;
  /** Duration in seconds */
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

export function useRoutePerformances(
  activityId: string | undefined,
  routeGroupId?: string
): UseRoutePerformancesResult {
  const cache = useRouteMatchStore((s) => s.cache);

  // Find route group - either from provided ID or by looking up activity
  const routeGroup = useMemo(() => {
    if (!cache) return null;

    if (routeGroupId) {
      return cache.groups.find((g) => g.id === routeGroupId) || null;
    }

    if (activityId) {
      const groupId = cache.activityToRouteId?.[activityId];
      if (groupId) {
        return cache.groups.find((g) => g.id === groupId) || null;
      }
    }

    return null;
  }, [cache, routeGroupId, activityId]);

  // Fetch activities for the route's date range
  const { data: activities, isLoading } = useActivities({
    oldest: routeGroup?.firstDate?.split('T')[0],
    newest: routeGroup?.lastDate?.split('T')[0],
    includeStats: false,
  });

  // Filter and map to performance points
  const { performances, best, currentRank } = useMemo(() => {
    if (!routeGroup || !activities || !cache) {
      return { performances: [], best: null, currentRank: null };
    }

    const activityIdsSet = new Set(routeGroup.activityIds);

    // Filter to only activities in this route
    const routeActivities = activities.filter((a) => activityIdsSet.has(a.id));

    // Map to performance points with match info
    const points: RoutePerformancePoint[] = routeActivities.map((a: Activity) => {
      const match = cache.matches[a.id];
      return {
        activityId: a.id,
        date: new Date(a.start_date_local),
        name: a.name,
        speed: a.distance / a.moving_time, // m/s
        duration: a.elapsed_time,
        movingTime: a.moving_time,
        distance: a.distance,
        elevationGain: a.total_elevation_gain || 0,
        avgHr: a.average_heartrate,
        avgPower: a.average_watts,
        isCurrent: a.id === activityId,
        direction: match?.direction || 'same',
        matchPercentage: match?.matchPercentage || 100,
      };
    });

    // Sort by date (oldest first for charting)
    points.sort((a, b) => a.date.getTime() - b.date.getTime());

    // Find best (fastest speed)
    let bestPoint: RoutePerformancePoint | null = null;
    for (const p of points) {
      if (!bestPoint || p.speed > bestPoint.speed) {
        bestPoint = p;
      }
    }

    // Sort by speed for ranking
    const bySpeed = [...points].sort((a, b) => b.speed - a.speed);
    let rank: number | null = null;
    if (activityId) {
      const idx = bySpeed.findIndex((p) => p.activityId === activityId);
      if (idx >= 0) {
        rank = idx + 1;
      }
    }

    return {
      performances: points,
      best: bestPoint,
      currentRank: rank,
    };
  }, [routeGroup, activities, activityId, cache]);

  return {
    routeGroup,
    performances,
    isLoading,
    best,
    currentRank,
  };
}

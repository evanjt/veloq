/**
 * Hook for getting performance data for all activities in a route group.
 * Used to display performance comparison charts.
 */

import { useMemo } from 'react';
import { useEngineGroups } from './useRouteEngine';
import { useActivities } from '@/hooks/useActivities';
import type { RouteGroup, Activity, MatchDirection, ActivityType } from '@/types';

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
  const routeGroup = useMemo((): RouteGroup | null => {
    if (!engineGroup) return null;
    return {
      id: engineGroup.groupId,
      name: engineGroup.groupId,
      type: engineGroup.sportType as ActivityType,
      activityIds: engineGroup.activityIds,
      activityCount: engineGroup.activityIds.length,
      firstDate: '',
      lastDate: '',
    };
  }, [engineGroup]);

  // Fetch all activities (we'll filter to just those in the group)
  const { data: activities, isLoading } = useActivities({
    includeStats: false,
  });

  // Filter and map to performance points
  const { performances, best, currentRank } = useMemo(() => {
    if (!engineGroup || !activities) {
      return { performances: [], best: null, currentRank: null };
    }

    const activityIdsSet = new Set(engineGroup.activityIds);

    // Filter to only activities in this route
    const routeActivities = activities.filter((a) => activityIdsSet.has(a.id));

    // Map to performance points
    const points: RoutePerformancePoint[] = routeActivities.map((a: Activity) => {
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
        direction: 'same', // Direction not stored in engine
        matchPercentage: 100, // Not available from engine
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
  }, [engineGroup, activities, activityId]);

  return {
    routeGroup,
    performances,
    isLoading,
    best,
    currentRank,
  };
}

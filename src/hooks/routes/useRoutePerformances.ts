/**
 * Hook for getting performance data for all activities in a route group.
 * Uses API-provided metrics (average_speed, etc.) instead of recalculating.
 * Match direction and percentage come from Rust engine's checkpoint-based matching.
 */

import { useMemo } from 'react';
import { useEngineGroups } from './useRouteEngine';
import { getRouteEngine } from '@/lib/native/routeEngine';
import type { Activity, RouteGroup, MatchDirection } from '@/types';
import { toActivityType } from '@/types';

/** Match info returned from the Rust engine */
interface RustMatchInfo {
  activity_id: string;
  match_percentage: number;
  direction: string;
}

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
  /** Match percentage (0-100), undefined if not computed */
  matchPercentage?: number;
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

  // Get match info from Rust engine (checkpoint-based matching)
  // This provides accurate percentages reflecting how well each activity matches the route
  const matchInfoMap = useMemo((): Map<string, RustMatchInfo> => {
    if (!engineGroup) return new Map();

    try {
      const engine = getRouteEngine();
      if (!engine) return new Map();

      // Get match data from Rust engine (includes direction and match_percentage)
      const json = engine.getRoutePerformances(engineGroup.groupId, activityId || '');
      if (!json) return new Map();

      const parsed = JSON.parse(json);
      const performances = parsed.performances || [];

      // Build lookup map by activity ID
      // Only include entries that have actual match_percentage computed (not 100% fallback)
      const map = new Map<string, RustMatchInfo>();
      for (const perf of performances) {
        // Only store if match_percentage exists and isn't the 100% fallback
        // A real match percentage from checkpoint matching is rarely exactly 100
        if (perf.match_percentage !== undefined && perf.match_percentage !== 100) {
          map.set(perf.activity_id, {
            activity_id: perf.activity_id,
            match_percentage: perf.match_percentage,
            direction: perf.direction ?? 'same',
          });
        }
      }
      return map;
    } catch {
      // Fallback if engine unavailable or JSON parsing fails
      return new Map();
    }
  }, [engineGroup, activityId]);

  // Build performances from Activity objects (API data) + match info from Rust
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

    const points: RoutePerformancePoint[] = validActivities.map((activity) => {
      // Get match info from Rust engine (undefined if not computed)
      const matchInfo = matchInfoMap.get(activity.id);
      const matchPercentage = matchInfo?.match_percentage;
      const direction = (matchInfo?.direction ?? 'same') as MatchDirection;

      return {
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
        direction,
        matchPercentage,
      };
    });

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
  }, [engineGroup, activities, activityId, matchInfoMap]);

  return {
    routeGroup,
    performances,
    isLoading: false,
    best,
    currentRank,
  };
}

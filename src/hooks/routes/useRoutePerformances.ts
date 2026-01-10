/**
 * Hook for getting performance data for all activities in a route group.
 * Uses Rust engine for performance calculations.
 */

import { useMemo } from 'react';
import { useEngineGroups } from './useRouteEngine';
import type { RouteGroup, MatchDirection } from '@/types';
import { toActivityType } from '@/types';

// Lazy load routeEngine to avoid native module import errors
function getRouteEngine() {
  try {
    const module = require('route-matcher-native');
    return module.routeEngine || module.default?.routeEngine || null;
  } catch (error) {
    console.warn('[RouteMatcher] Failed to load native module:', error);
    return null;
  }
}

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
  // Get the index of this group in the filtered list for generating a default name
  const groupIndex = useMemo(() => {
    if (!engineGroup) return 0;
    const sameTypeGroups = groups.filter((g) => g.sportType === engineGroup.sportType);
    return sameTypeGroups.findIndex((g) => g.groupId === engineGroup.groupId) + 1;
  }, [groups, engineGroup]);

  const routeGroup = useMemo((): RouteGroup | null => {
    if (!engineGroup) return null;
    // Use customName if set, otherwise generate a readable name like "Run Route 3"
    const sportType = engineGroup.sportType || 'Route';
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

  // Get performances from Rust engine
  // NOTE: Requires metrics to be synced via useRouteDataSync
  const { performances, best, currentRank } = useMemo(() => {
    if (!engineGroup) {
      return { performances: [], best: null, currentRank: null };
    }

    try {
      const engine = getRouteEngine();
      if (!engine) {
        return { performances: [], best: null, currentRank: null };
      }

      // Get calculated performances from Rust engine
      const result = engine.getRoutePerformances(engineGroup.groupId, activityId);

      // Convert to RoutePerformancePoint format (add Date objects)
      const points: RoutePerformancePoint[] = result.performances.map(
        (p: Omit<RoutePerformancePoint, 'date'> & { date: number }) => ({
          activityId: p.activityId,
          date: new Date(p.date * 1000), // Convert Unix timestamp to Date
          name: p.name,
          speed: p.speed,
          duration: p.duration,
          movingTime: p.movingTime,
          distance: p.distance,
          elevationGain: p.elevationGain,
          avgHr: p.avgHr,
          avgPower: p.avgPower,
          isCurrent: p.isCurrent,
          direction: p.direction as MatchDirection,
          matchPercentage: p.matchPercentage,
        })
      );

      const bestPoint: RoutePerformancePoint | null = result.best
        ? {
            activityId: result.best.activityId,
            date: new Date(result.best.date * 1000),
            name: result.best.name,
            speed: result.best.speed,
            duration: result.best.duration,
            movingTime: result.best.movingTime,
            distance: result.best.distance,
            elevationGain: result.best.elevationGain,
            avgHr: result.best.avgHr,
            avgPower: result.best.avgPower,
            isCurrent: result.best.isCurrent,
            direction: result.best.direction as MatchDirection,
            matchPercentage: result.best.matchPercentage,
          }
        : null;

      return {
        performances: points,
        best: bestPoint,
        currentRank: result.currentRank,
      };
    } catch {
      // Engine may not have metrics yet - return empty
      return { performances: [], best: null, currentRank: null };
    }
  }, [engineGroup, activityId]);

  return {
    routeGroup,
    performances,
    isLoading: false, // Data is synchronous from Rust engine
    best,
    currentRank,
  };
}

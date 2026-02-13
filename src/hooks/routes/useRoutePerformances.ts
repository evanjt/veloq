/**
 * Hook for getting performance data for all activities in a route group.
 * Uses engine-cached metrics instead of API calls.
 * Match direction and percentage come from Rust engine's AMD-based matching.
 */

import { useMemo } from 'react';
import { useEngineGroups } from './useRouteEngine';
import { getRouteEngine } from '@/lib/native/routeEngine';
import type { RouteGroup, MatchDirection, DirectionStats } from '@/types';
import { toActivityType } from '@/types';
import type { RoutePerformanceResult } from 'veloqrs';
import { toDirectionStats, fromUnixSeconds } from '@/lib/utils/ffiConversions';

/** Match info returned from the Rust engine (uses camelCase from serde) */
interface RustMatchInfo {
  activityId: string;
  matchPercentage: number;
  direction: string;
}

export interface RoutePerformancePoint {
  activityId: string;
  date: Date;
  name: string;
  /** Speed in m/s (computed from engine metrics: distance / movingTime) */
  speed: number;
  /** Duration in seconds (elapsed_time from engine) */
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
  /** Match percentage (0-100), undefined if no match data */
  matchPercentage?: number;
}

/** Per-direction best record for UI display */
export interface DirectionBestRecord {
  bestTime: number;
  bestSpeed?: number; // Speed (m/s) for routes where distance varies
  activityDate: Date;
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
  /** Best performance in forward/same direction */
  bestForwardRecord: DirectionBestRecord | null;
  /** Best performance in reverse direction */
  bestReverseRecord: DirectionBestRecord | null;
  /** Summary stats for forward direction */
  forwardStats: DirectionStats | null;
  /** Summary stats for reverse direction */
  reverseStats: DirectionStats | null;
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

  // Get route performance data from Rust engine (includes inlined metrics as of Issue C optimization)
  // This provides match info, direction stats, current rank, AND activity metrics (no separate FFI call)
  const rustData = useMemo((): {
    matchInfoMap: Map<string, RustMatchInfo>;
    activityMetrics: Map<string, any>; // Activity ID -> metrics
    forwardStats: DirectionStats | null;
    reverseStats: DirectionStats | null;
    currentRank: number | null;
  } => {
    const emptyResult = {
      matchInfoMap: new Map<string, RustMatchInfo>(),
      activityMetrics: new Map(),
      forwardStats: null,
      reverseStats: null,
      currentRank: null,
    };

    if (!engineGroup) return emptyResult;

    try {
      const engine = getRouteEngine();
      if (!engine) return emptyResult;

      // Get typed performance data directly from Rust engine (now includes metrics)
      const result: RoutePerformanceResult = engine.getRoutePerformances(
        engineGroup.groupId,
        activityId || ''
      );
      const performances = result.performances || [];

      // Build lookup map by activity ID
      const map = new Map<string, RustMatchInfo>();
      for (const perf of performances) {
        if (perf.matchPercentage != null) {
          map.set(perf.activityId, {
            activityId: perf.activityId,
            matchPercentage: perf.matchPercentage,
            direction: perf.direction ?? 'same',
          });
        }
      }

      // Build metrics map from inlined activity_metrics (Issue C optimization - eliminates duplicate FFI call)
      const metricsMap = new Map();
      for (const m of result.activityMetrics || []) {
        metricsMap.set(m.activityId, m);
      }

      return {
        matchInfoMap: map,
        activityMetrics: metricsMap,
        forwardStats: toDirectionStats(result.forwardStats),
        reverseStats: toDirectionStats(result.reverseStats),
        currentRank: result.currentRank ?? null,
      };
    } catch {
      return emptyResult;
    }
  }, [engineGroup, activityId]);

  const {
    matchInfoMap,
    activityMetrics,
    forwardStats: rustForwardStats,
    reverseStats: rustReverseStats,
  } = rustData;

  // Build performances from inlined metrics (Issue C: no separate FFI call) + match info from Rust
  const { performances, best, bestForwardRecord, bestReverseRecord } = useMemo(() => {
    if (!engineGroup || engineGroup.activityIds.length === 0) {
      return {
        performances: [],
        best: null,
        bestForwardRecord: null,
        bestReverseRecord: null,
      };
    }

    if (activityMetrics.size === 0) {
      return {
        performances: [],
        best: null,
        bestForwardRecord: null,
        bestReverseRecord: null,
      };
    }

    // Build performance points from inlined metrics (already fetched in rustData)
    // Filter out activities with invalid speed (would crash chart)
    const points: RoutePerformancePoint[] = [];
    for (const m of activityMetrics.values()) {
      const speed = m.movingTime > 0 ? m.distance / m.movingTime : 0;
      if (!Number.isFinite(speed) || speed <= 0) continue;

      const matchInfo = matchInfoMap.get(m.activityId);
      const matchPercentage = matchInfo?.matchPercentage;
      const direction = (matchInfo?.direction ?? 'same') as MatchDirection;

      points.push({
        activityId: m.activityId,
        date: fromUnixSeconds(m.date) ?? new Date(),
        name: m.name,
        speed,
        duration: m.elapsedTime,
        movingTime: m.movingTime,
        distance: m.distance || 0,
        elevationGain: m.elevationGain || 0,
        avgHr: m.avgHr ?? undefined,
        avgPower: m.avgPower ?? undefined,
        isCurrent: m.activityId === activityId,
        direction,
        matchPercentage,
      });
    }

    // Sort by date (oldest first for charting)
    points.sort((a, b) => a.date.getTime() - b.date.getTime());

    // Find best (fastest speed) - overall
    const bestPoint =
      points.length > 0
        ? points.reduce((best, p) => (p.speed > best.speed ? p : best), points[0])
        : null;

    // Find best forward (direction is "same" or "forward")
    const forwardPoints = points.filter((p) => p.direction === 'same' || p.direction === 'partial');
    const bestForwardPoint =
      forwardPoints.length > 0
        ? forwardPoints.reduce((best, p) => (p.speed > best.speed ? p : best), forwardPoints[0])
        : null;
    const bestForward: DirectionBestRecord | null = bestForwardPoint
      ? {
          bestTime: bestForwardPoint.duration,
          bestSpeed: bestForwardPoint.speed,
          activityDate: bestForwardPoint.date,
        }
      : null;

    // Find best reverse
    const reversePoints = points.filter((p) => p.direction === 'reverse');
    const bestReversePoint =
      reversePoints.length > 0
        ? reversePoints.reduce((best, p) => (p.speed > best.speed ? p : best), reversePoints[0])
        : null;
    const bestReverse: DirectionBestRecord | null = bestReversePoint
      ? {
          bestTime: bestReversePoint.duration,
          bestSpeed: bestReversePoint.speed,
          activityDate: bestReversePoint.date,
        }
      : null;

    return {
      performances: points,
      best: bestPoint,
      bestForwardRecord: bestForward,
      bestReverseRecord: bestReverse,
    };
  }, [engineGroup, activityId, matchInfoMap, activityMetrics]);

  // Compute average speed for each direction (for pace display in routes)
  const augmentedForwardStats = useMemo(() => {
    if (!rustForwardStats) return null;
    const forwardPerfs = performances.filter(
      (p) => p.direction === 'same' || p.direction === 'partial'
    );
    const avgSpeed =
      forwardPerfs.length > 0
        ? forwardPerfs.reduce((sum, p) => sum + p.speed, 0) / forwardPerfs.length
        : null;
    return { ...rustForwardStats, avgSpeed };
  }, [rustForwardStats, performances]);

  const augmentedReverseStats = useMemo(() => {
    if (!rustReverseStats) return null;
    const reversePerfs = performances.filter((p) => p.direction === 'reverse');
    const avgSpeed =
      reversePerfs.length > 0
        ? reversePerfs.reduce((sum, p) => sum + p.speed, 0) / reversePerfs.length
        : null;
    return { ...rustReverseStats, avgSpeed };
  }, [rustReverseStats, performances]);

  return {
    routeGroup,
    performances,
    isLoading: false,
    best,
    bestForwardRecord,
    bestReverseRecord,
    forwardStats: augmentedForwardStats,
    reverseStats: augmentedReverseStats,
    currentRank: rustData.currentRank,
  };
}

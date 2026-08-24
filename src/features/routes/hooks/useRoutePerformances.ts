/**
 * Hook for getting performance data for all activities in a route group.
 * Uses engine-cached metrics instead of API calls.
 * Match direction and percentage come from Rust engine's AMD-based matching.
 */

import { useMemo } from 'react';
import { useEngineGroups } from './useRouteEngine';
import { getRouteEngine } from '@/shared/native/routeEngine';
import type { RouteGroup, MatchDirection, DirectionStats } from '@/types';
import { toActivityType } from '@/types';
import type {
  RouteGroup as EngineRouteGroup,
  RoutePerformanceResult,
  FfiActivityMetrics,
} from 'veloqrs';
import { toDirectionStats, fromUnixSeconds } from '@/shared/ffi/ffiConversions';
import { safeGetTime } from '@/shared/format/format';
import { calculateSpeed } from '@/shared/math';
import type { DirectionBestRecord } from '../lib/performanceTypes';

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
  /** Activity metrics inlined from route performances (avoids duplicate FFI call) */
  activityMetrics: Map<string, FfiActivityMetrics>;
}

/** Groups and performances a caller already read as part of a screen bundle. */
export interface PreComputedRoutePerformances {
  groups: readonly EngineRouteGroup[];
  /** The result for this exact sport filter, when the caller has it. */
  result?: RoutePerformanceResult;
}

export function useRoutePerformances(
  activityId: string | undefined,
  routeGroupId?: string,
  sportType?: string,
  preComputed?: PreComputedRoutePerformances
): UseRoutePerformancesResult {
  const { groups: queriedGroups } = useEngineGroups({
    minActivities: 1,
    enabled: preComputed === undefined,
  });
  const groups = preComputed?.groups ?? queriedGroups;

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

  // The engine already picks the best run per direction, over its own population and its
  // own direction rules. Mapping its record keeps this card consistent with the rank and
  // direction counts rendered beside it.
  function toDirectionBest(
    ffi: { movingTime: number; speed: number; date: number | bigint } | null | undefined
  ): DirectionBestRecord | null {
    if (!ffi) return null;
    return {
      bestTime: ffi.movingTime,
      bestSpeed: ffi.speed,
      activityDate: fromUnixSeconds(ffi.date) ?? new Date(),
    };
  }

  // Get route performance data from Rust engine (includes inlined metrics as of Issue C optimization)
  // This provides match info, direction stats, current rank, AND activity metrics (no separate FFI call)
  const rustData = useMemo((): {
    matchInfoMap: Map<string, RustMatchInfo>;
    activityMetrics: Map<string, any>; // Activity ID -> metrics
    forwardStats: DirectionStats | null;
    reverseStats: DirectionStats | null;
    currentRank: number | null;
    bestForward: DirectionBestRecord | null;
    bestReverse: DirectionBestRecord | null;
  } => {
    const emptyResult = {
      matchInfoMap: new Map<string, RustMatchInfo>(),
      activityMetrics: new Map(),
      forwardStats: null,
      reverseStats: null,
      currentRank: null,
      bestForward: null,
      bestReverse: null,
    };

    if (!engineGroup) return emptyResult;

    try {
      // Get typed performance data directly from Rust engine (now includes metrics)
      let result = preComputed?.result;
      if (!result) {
        const engine = getRouteEngine();
        if (!engine) return emptyResult;
        result = engine.getRoutePerformances(engineGroup.groupId, activityId || '', sportType);
      }
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
        bestForward: toDirectionBest(result.bestForward),
        bestReverse: toDirectionBest(result.bestReverse),
      };
    } catch {
      return emptyResult;
    }
  }, [engineGroup, activityId, sportType, preComputed]);

  const {
    matchInfoMap,
    activityMetrics,
    forwardStats: rustForwardStats,
    reverseStats: rustReverseStats,
    bestForward: rustBestForward,
    bestReverse: rustBestReverse,
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
      const speed = calculateSpeed(m.distance, m.movingTime);
      if (speed <= 0) continue;

      const matchInfo = matchInfoMap.get(m.activityId);
      const matchPercentage = matchInfo?.matchPercentage;
      const direction = (matchInfo?.direction ?? 'same') as MatchDirection;

      points.push({
        activityId: m.activityId,
        date: fromUnixSeconds(m.date) ?? new Date(),
        name: m.name,
        speed,
        duration: m.movingTime,
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
    points.sort((a, b) => safeGetTime(a.date) - safeGetTime(b.date));

    // Find best (shortest time) - overall
    const validPoints = points.filter((p) => p.duration > 0);
    const bestPoint =
      validPoints.length > 0
        ? validPoints.reduce((best, p) => (p.duration < best.duration ? p : best), validPoints[0])
        : null;

    return {
      performances: points,
      best: bestPoint,
      bestForwardRecord: rustBestForward,
      bestReverseRecord: rustBestReverse,
    };
  }, [engineGroup, activityId, matchInfoMap, activityMetrics, rustBestForward, rustBestReverse]);

  // avg_speed now comes pre-computed from Rust's DirectionStats - no TS
  // augmentation needed.

  return {
    routeGroup,
    performances,
    isLoading: false,
    best,
    bestForwardRecord,
    bestReverseRecord,
    forwardStats: rustForwardStats,
    reverseStats: rustReverseStats,
    currentRank: rustData.currentRank,
    activityMetrics: rustData.activityMetrics,
  };
}

import { useMemo } from 'react';
import { decodeCoords } from 'veloqrs';
import type { RouteGroup as EngineRouteGroup } from 'veloqrs';
import { getRouteEngine } from '@/shared/native/routeEngine';
import {
  buildRouteChartShape,
  enrichWithDirectionBests,
  type RouteSignatureMap,
} from '../lib/routeChartData';
import type { PerformanceDataPoint } from '../types';
import type { RoutePerformancePoint } from './useRoutePerformances';

export function useRouteChartData(
  performances: RoutePerformancePoint[],
  bestPerformance: RoutePerformancePoint | null,
  engineGroup: EngineRouteGroup | null | undefined,
  excludedChartData: (PerformanceDataPoint & { x: number })[]
) {
  // Simplified GPS signatures for the mini trace preview, one batch FFI call.
  const signatures = useMemo<RouteSignatureMap>(() => {
    if (!engineGroup?.activityIds?.length) return {};
    try {
      const engine = getRouteEngine();
      if (!engine) return {};

      const wanted = new Set(engineGroup.activityIds);
      const result: RouteSignatureMap = {};
      for (const sig of engine.getAllMapSignatures()) {
        if (!wanted.has(sig.activityId)) continue;
        const decoded = decodeCoords(sig.encodedCoords);
        if (decoded.length < 2) continue;
        result[sig.activityId] = {
          points: decoded.map((p) => ({ lat: p.latitude, lng: p.longitude })),
        };
      }
      return result;
    } catch {
      return {};
    }
  }, [engineGroup?.activityIds]);

  const { chartData, minSpeed, maxSpeed, bestIndex, hasReverseRuns } = useMemo(
    () => buildRouteChartShape(performances, bestPerformance, signatures),
    [performances, bestPerformance, signatures]
  );

  const enrichedChartData = useMemo(() => enrichWithDirectionBests(chartData), [chartData]);

  const combinedChartData = useMemo(() => {
    if (excludedChartData.length === 0) return enrichedChartData;
    return [...enrichedChartData, ...excludedChartData];
  }, [enrichedChartData, excludedChartData]);

  return {
    signatures,
    chartData: combinedChartData,
    minSpeed,
    maxSpeed,
    bestIndex,
    hasReverseRuns,
  };
}

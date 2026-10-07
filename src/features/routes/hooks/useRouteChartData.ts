import { useMemo } from 'react';
import { decodeCoords } from 'veloqrs';
import type { RouteGroup as EngineRouteGroup, FfiMapSignature } from 'veloqrs';
import { getEngine } from '@/shared/native/engine';
import type { PerformanceDataPoint } from '../types';
import type { DirectionBestRecord } from '../lib/performanceTypes';
import type { RoutePerformancePoint } from './useRoutePerformances';
import type { LatLngShort } from '@/shared/geo/distance';

export interface RouteDirectionBests {
  forward: DirectionBestRecord | null;
  reverse: DirectionBestRecord | null;
}

export function useRouteChartData(
  performances: RoutePerformancePoint[],
  engineGroup: EngineRouteGroup | null | undefined,
  excludedChartData: (PerformanceDataPoint & { x: number })[],
  preComputedSignatures?: FfiMapSignature[],
  directionBests?: RouteDirectionBests
) {
  // Load simplified GPS signatures for mini trace preview (single batch FFI call)
  const signatures = useMemo(() => {
    if (!engineGroup?.activityIds?.length) return {};
    try {
      let allSigs = preComputedSignatures;
      if (!allSigs) {
        const engine = getEngine();
        if (!engine) return {};
        allSigs = engine.getAllMapSignatures();
      }

      const activityIdSet = new Set(engineGroup.activityIds);
      const result: Record<string, { points: LatLngShort[] }> = {};

      for (const sig of allSigs) {
        if (!activityIdSet.has(sig.activityId)) continue;
        const decoded = decodeCoords(sig.encodedCoords);
        if (decoded.length < 2) continue;
        const points = decoded.map((p) => ({ lat: p.latitude, lng: p.longitude }));
        result[sig.activityId] = { points };
      }
      return result;
    } catch {
      // empty-on-error: mini-trace thumbnails beside each point; the chart's points come from the performances passed in.
      return {};
    }
  }, [engineGroup, preComputedSignatures]);

  // Prepare chart data using Rust engine performance data
  const { chartData, minSpeed, maxSpeed, bestIndex, hasReverseRuns } = useMemo(() => {
    if (performances.length === 0) {
      return {
        chartData: [],
        minSpeed: 0,
        maxSpeed: 1,
        bestIndex: 0,
        hasReverseRuns: false,
      };
    }

    // Convert performances to chart data format
    // Filter out 'partial' directions and invalid speed values (NaN would crash SVG renderer)
    const validPerformances = performances.filter(
      (p) => p.direction !== 'partial' && Number.isFinite(p.speed)
    );
    const dataPoints: (PerformanceDataPoint & { x: number })[] = validPerformances.map(
      (perf, idx) => {
        const activityPoints = signatures[perf.activityId]?.points;
        return {
          x: idx,
          id: perf.activityId,
          activityId: perf.activityId,
          speed: perf.speed,
          date: perf.date,
          activityName: perf.name,
          direction: perf.direction as 'same' | 'reverse',
          matchPercentage: perf.matchPercentage,
          isBest: perf.isRecord,
          outsideDistanceBand: perf.outsideDistanceBand,
          sectionTime: Math.round(perf.duration),
          lapPoints: activityPoints,
        };
      }
    );

    const speeds = dataPoints.map((d) => d.speed);
    const min = speeds.length > 0 ? Math.min(...speeds) : 0;
    const max = speeds.length > 0 ? Math.max(...speeds) : 1;
    const padding = (max - min) * 0.15 || 0.5;

    // The ring follows the engine's record stamp, forward before reverse.
    // No stamped point rings nothing rather than the first point.
    const bestIdx =
      [
        dataPoints.findIndex((d) => d.isBest && d.direction !== 'reverse'),
        dataPoints.findIndex((d) => d.isBest),
      ].find((i) => i >= 0) ?? -1;

    const hasAnyReverse = dataPoints.some((d) => d.direction === 'reverse');

    return {
      chartData: dataPoints,
      minSpeed: Math.max(0, min - padding),
      maxSpeed: max + padding,
      bestIndex: bestIdx,
      hasReverseRuns: hasAnyReverse,
    };
  }, [performances, signatures]);

  // The tooltip's reference is the engine's best per direction, which already leaves out
  // out-of-band, partial, excluded and untimed attempts and other sports.
  const enrichedChartData = useMemo(() => {
    if (chartData.length === 0) return chartData;

    return chartData.map((p) => {
      const reference =
        p.direction === 'reverse' ? directionBests?.reverse : directionBests?.forward;
      return {
        ...p,
        bestTime: reference?.bestTime,
        bestSpeed: reference?.bestSpeed,
        sectionTime: Math.round(p.sectionTime ?? 0) || undefined,
      };
    });
  }, [chartData, directionBests]);

  // Merge excluded points into chart data when showing excluded
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

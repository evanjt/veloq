import { useMemo } from 'react';
import { decodeCoords } from 'veloqrs';
import type { RouteGroup as EngineRouteGroup } from 'veloqrs';
import { getRouteEngine } from '@/shared/native/routeEngine';
import type { PerformanceDataPoint } from '../types';
import type { RoutePerformancePoint } from './useRoutePerformances';

export function useRouteChartData(
  performances: RoutePerformancePoint[],
  bestPerformance: RoutePerformancePoint | null,
  engineGroup: EngineRouteGroup | null | undefined,
  excludedChartData: (PerformanceDataPoint & { x: number })[]
) {
  // Load simplified GPS signatures for mini trace preview (single batch FFI call)
  const signatures = useMemo(() => {
    if (!engineGroup?.activityIds?.length) return {};
    try {
      const engine = getRouteEngine();
      if (!engine) return {};

      const activityIdSet = new Set(engineGroup.activityIds);
      const allSigs = engine.getAllMapSignatures();
      const result: Record<string, { points: Array<{ lat: number; lng: number }> }> = {};

      for (const sig of allSigs) {
        if (!activityIdSet.has(sig.activityId)) continue;
        const decoded = decodeCoords(sig.encodedCoords);
        if (decoded.length < 2) continue;
        const points = decoded.map((p) => ({ lat: p.latitude, lng: p.longitude }));
        result[sig.activityId] = { points };
      }
      return result;
    } catch {
      return {};
    }
  }, [engineGroup?.activityIds]);

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
          sectionTime: Math.round(perf.duration),
          lapPoints: activityPoints,
        };
      }
    );

    const speeds = dataPoints.map((d) => d.speed);
    const min = speeds.length > 0 ? Math.min(...speeds) : 0;
    const max = speeds.length > 0 ? Math.max(...speeds) : 1;
    const padding = (max - min) * 0.15 || 0.5;

    // Find best (shortest time) - use the bestPerformance from hook if available
    let bestIdx = 0;
    if (bestPerformance) {
      bestIdx = dataPoints.findIndex((d) => d.activityId === bestPerformance.activityId);
      if (bestIdx === -1) bestIdx = 0;
    } else {
      let bestTime = Infinity;
      for (let i = 0; i < dataPoints.length; i++) {
        const time = dataPoints[i].sectionTime ?? Infinity;
        if (time > 0 && time < bestTime) {
          bestTime = time;
          bestIdx = i;
        }
      }
    }

    const hasAnyReverse = dataPoints.some((d) => d.direction === 'reverse');

    return {
      chartData: dataPoints,
      minSpeed: Math.max(0, min - padding),
      maxSpeed: max + padding,
      bestIndex: bestIdx,
      hasReverseRuns: hasAnyReverse,
    };
  }, [performances, bestPerformance, signatures]);

  // Enrich chart data with PR info for tooltip display
  const enrichedChartData = useMemo(() => {
    if (chartData.length === 0) return chartData;

    let fwdBestTime: number | undefined;
    let fwdBestSpeed: number | undefined;
    let revBestTime: number | undefined;
    let revBestSpeed: number | undefined;

    for (const p of chartData) {
      const time = Math.round(p.sectionTime ?? 0);
      if (time <= 0) continue;
      if (p.direction === 'reverse') {
        if (revBestTime === undefined || time < revBestTime) {
          revBestTime = time;
          revBestSpeed = p.speed;
        }
      } else {
        if (fwdBestTime === undefined || time < fwdBestTime) {
          fwdBestTime = time;
          fwdBestSpeed = p.speed;
        }
      }
    }

    return chartData.map((p) => {
      const isReverse = p.direction === 'reverse';
      const dirBestTime = isReverse ? revBestTime : fwdBestTime;
      const dirBestSpeed = isReverse ? revBestSpeed : fwdBestSpeed;
      const time = Math.round(p.sectionTime ?? 0);
      const isBest = dirBestTime !== undefined && time > 0 && time === dirBestTime;
      return {
        ...p,
        bestTime: dirBestTime,
        bestSpeed: dirBestSpeed,
        isBest,
        sectionTime: time || undefined,
      };
    });
  }, [chartData]);

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

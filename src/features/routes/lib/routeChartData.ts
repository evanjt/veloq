/**
 * Shaping for the route-detail performance chart.
 *
 * Takes the performance records plus the already-decoded GPS signatures and
 * turns them into chart points. No engine access and no React, so it can be
 * tested on its own.
 */

import type { PerformanceDataPoint } from '../types';
import type { RoutePerformancePoint } from '../hooks/useRoutePerformances';

export type RouteChartPoint = PerformanceDataPoint & { x: number };

/** Decoded mini-trace geometry, keyed by activity. */
export type RouteSignatureMap = Record<string, { points: Array<{ lat: number; lng: number }> }>;

export interface RouteChartShape {
  chartData: RouteChartPoint[];
  minSpeed: number;
  maxSpeed: number;
  bestIndex: number;
  hasReverseRuns: boolean;
}

const EMPTY_SHAPE: RouteChartShape = {
  chartData: [],
  minSpeed: 0,
  maxSpeed: 1,
  bestIndex: 0,
  hasReverseRuns: false,
};

export function buildRouteChartShape(
  performances: RoutePerformancePoint[],
  bestPerformance: RoutePerformancePoint | null,
  signatures: RouteSignatureMap
): RouteChartShape {
  if (performances.length === 0) return EMPTY_SHAPE;

  // A partial traversal has no comparable speed, and a non-finite one would
  // reach the SVG renderer as NaN and crash it.
  const valid = performances.filter((p) => p.direction !== 'partial' && Number.isFinite(p.speed));
  const dataPoints: RouteChartPoint[] = valid.map((perf, idx) => ({
    x: idx,
    id: perf.activityId,
    activityId: perf.activityId,
    speed: perf.speed,
    date: perf.date,
    activityName: perf.name,
    direction: perf.direction as 'same' | 'reverse',
    matchPercentage: perf.matchPercentage,
    sectionTime: Math.round(perf.duration),
    lapPoints: signatures[perf.activityId]?.points,
  }));

  const speeds = dataPoints.map((d) => d.speed);
  const min = speeds.length > 0 ? Math.min(...speeds) : 0;
  const max = speeds.length > 0 ? Math.max(...speeds) : 1;
  const padding = (max - min) * 0.15 || 0.5;

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

  return {
    chartData: dataPoints,
    minSpeed: Math.max(0, min - padding),
    maxSpeed: max + padding,
    bestIndex: bestIdx,
    hasReverseRuns: dataPoints.some((d) => d.direction === 'reverse'),
  };
}

/**
 * Tag each point with the best time and speed for its own direction, so the
 * tooltip can say how an effort compares without a second pass.
 */
export function enrichWithDirectionBests(points: RouteChartPoint[]): RouteChartPoint[] {
  if (points.length === 0) return points;

  let fwdBestTime: number | undefined;
  let fwdBestSpeed: number | undefined;
  let revBestTime: number | undefined;
  let revBestSpeed: number | undefined;

  for (const p of points) {
    const time = Math.round(p.sectionTime ?? 0);
    if (time <= 0) continue;
    if (p.direction === 'reverse') {
      if (revBestTime === undefined || time < revBestTime) {
        revBestTime = time;
        revBestSpeed = p.speed;
      }
    } else if (fwdBestTime === undefined || time < fwdBestTime) {
      fwdBestTime = time;
      fwdBestSpeed = p.speed;
    }
  }

  return points.map((p) => {
    const isReverse = p.direction === 'reverse';
    const dirBestTime = isReverse ? revBestTime : fwdBestTime;
    const dirBestSpeed = isReverse ? revBestSpeed : fwdBestSpeed;
    const time = Math.round(p.sectionTime ?? 0);
    return {
      ...p,
      bestTime: dirBestTime,
      bestSpeed: dirBestSpeed,
      isBest: dirBestTime !== undefined && time > 0 && time === dirBestTime,
      sectionTime: time || undefined,
    };
  });
}

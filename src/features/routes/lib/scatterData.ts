/**
 * Pure data-prep helpers for the section scatter chart.
 *
 * Splits the counted performance data points into forward and reverse sets
 * (an excluded attempt is drawn but never counted), normalizes
 * each point's time position to [0, 1], identifies the PR (fastest non-excluded)
 * in each direction, and computes padded Y domain bounds for each direction.
 * Also places the engine's trend curves on the chart's x axis.
 *
 * No React, no Victory - pure functions so they can be unit tested in
 * isolation and reused if another chart needs the same bisected layout.
 */

import type { FfiTrendBandPoint } from 'veloqrs';
import type { PerformanceDataPoint } from '@/types';

/** A performance point as rendered on the chart - base record plus its normalized X. */
export type ScatterChartPoint = PerformanceDataPoint & { x: number };

export interface ScatterDomain {
  minSpeed: number;
  maxSpeed: number;
  minTime: number;
  maxTime: number;
}

/** Result of splitting chart data into forward + reverse buckets. */
export interface ScatterSplitResult {
  /** All valid points sorted by date and x-normalized, union of both directions,
   *  excluded attempts included so they can be drawn and tapped. */
  allPoints: ScatterChartPoint[];
  /** Forward-direction points (non-reverse) that count, in date order. */
  forwardPoints: ScatterChartPoint[];
  /** Reverse-direction points that count, in date order. */
  reversePoints: ScatterChartPoint[];
  /** Padded domains for the directions that have drawn points. */
  domains: { forward: ScatterDomain | null; reverse: ScatterDomain | null };
}

/** Empty result used when input data is missing or invalid. */
const EMPTY_SPLIT: ScatterSplitResult = Object.freeze({
  allPoints: [] as ScatterChartPoint[],
  forwardPoints: [] as ScatterChartPoint[],
  reversePoints: [] as ScatterChartPoint[],
  domains: { forward: null, reverse: null },
}) as ScatterSplitResult;

function domainFor(points: ScatterChartPoint[]): ScatterDomain | null {
  if (points.length === 0) return null;
  const speeds = points.map((p) => p.speed);
  const min = Math.min(...speeds);
  const max = Math.max(...speeds);
  const padding = (max - min) * 0.15 || 0.5;
  const times = points.map((p) => p.sectionTime ?? 0).filter((t) => t > 0);
  const tMin = times.length > 0 ? Math.min(...times) : 0;
  const tMax = times.length > 0 ? Math.max(...times) : 1;
  const tPadding = (tMax - tMin) * 0.15 || 30;
  return {
    minSpeed: Math.max(0, min - padding),
    maxSpeed: max + padding,
    minTime: Math.max(0, tMin - tPadding),
    maxTime: tMax + tPadding,
  };
}

/**
 * Split chart data into forward / reverse lists, normalize each point's X
 * position to [0.02, 0.98] by time, and compute padded speed bounds. The
 * record mark is each point's `isBest`, which the engine decides.
 *
 * Returns a frozen `EMPTY_SPLIT` when input is empty or contains no valid dates.
 */
export function splitAndPositionChartData(
  chartData: (PerformanceDataPoint & { x: number })[]
): ScatterSplitResult {
  if (chartData.length === 0) {
    return EMPTY_SPLIT;
  }

  // Guard against non-Date values (e.g., raw bigint timestamps from FFI)
  const validData = chartData.filter((p) => p.date instanceof Date && !isNaN(p.date.getTime()));
  if (validData.length === 0) {
    return EMPTY_SPLIT;
  }

  const sorted = [...validData].sort((a, b) => a.date.getTime() - b.date.getTime());
  const firstTime = sorted[0].date.getTime();
  const lastTime = sorted[sorted.length - 1].date.getTime();
  const timeRange = lastTime - firstTime || 1;

  // Normalize x to 0-1 (small edge margin so dots aren't clipped)
  const positioned: ScatterChartPoint[] = sorted.map((p) => ({
    ...p,
    x: 0.02 + ((p.date.getTime() - firstTime) / timeRange) * 0.96,
  }));

  const fwd: ScatterChartPoint[] = [];
  const rev: ScatterChartPoint[] = [];

  for (const p of positioned) {
    // An excluded attempt is drawn and tappable from `allPoints`, and counts
    // nowhere: not in a direction's trend or its count.
    if (p.isExcluded) continue;
    if (p.direction === 'reverse') rev.push(p);
    else fwd.push(p);
  }

  return {
    forwardPoints: fwd,
    reversePoints: rev,
    allPoints: positioned,
    domains: {
      forward: domainFor(positioned.filter((p) => p.direction !== 'reverse')),
      reverse: domainFor(positioned.filter((p) => p.direction === 'reverse')),
    },
  };
}

/** One point on the trend line with a confidence band. */
export interface TrendBandPoint {
  x: number;
  y: number;
  /** Upper band edge (y + std, clamped to chart range). */
  upper: number;
  /** Lower band edge (y - std, clamped to chart range). */
  lower: number;
}

/**
 * Place an engine trend curve on the chart's x axis, 0.02 to 0.98 across the
 * drawn points' dates (the same placement `splitAndPositionChartData` gives
 * each point). The engine's curve is over unix seconds; this is only geometry.
 * Null when the engine has no curve for the direction or nothing is drawn.
 */
export function placeEngineTrend(
  curve: readonly FfiTrendBandPoint[] | null | undefined,
  drawnPoints: readonly { date: Date }[]
): TrendBandPoint[] | null {
  const firstPoint = drawnPoints.at(0);
  const lastPoint = drawnPoints.at(-1);
  if (!curve || curve.length < 2 || !firstPoint || !lastPoint) return null;
  const first = firstPoint.date.getTime();
  const range = lastPoint.date.getTime() - first || 1;
  return curve.map((p) => ({
    x: 0.02 + ((p.time * 1000 - first) / range) * 0.96,
    y: p.value,
    upper: p.upper,
    lower: p.lower,
  }));
}

/**
 * Index of the scatter point nearest a tap, or -1 when nothing can be hit.
 *
 * Both the tap and the points are compared in the chart's own normalised box,
 * x and y running 0 to 1 with y measured down from the top edge, so the axis
 * the chart draws is the axis the tap resolves against.
 */
export function nearestScatterPointIndex(
  points: readonly { x: number; y: number | null | undefined }[],
  tap: { x: number; y: number },
  yDomain: readonly [number, number]
): number {
  const [bottom, top] = yDomain;
  const span = top - bottom || 1;

  let closestIdx = -1;
  let closestDist = Infinity;
  for (let i = 0; i < points.length; i++) {
    const value = points[i].y;
    if (value == null || !Number.isFinite(value)) continue;
    const dx = points[i].x - tap.x;
    const dy = 1 - (value - bottom) / span - tap.y;
    const dist = dx * dx + dy * dy;
    if (dist < closestDist) {
      closestDist = dist;
      closestIdx = i;
    }
  }
  return closestIdx;
}

export type ChartDirection = 'forward' | 'reverse';

/**
 * The direction a chart shows: the one asked for, else the linked activity's,
 * else forward, and never a direction with nothing drawn.
 */
export function resolveChartDirection(
  requested: ChartDirection | null,
  linkedDirection: ChartDirection,
  hasForward: boolean,
  hasReverse: boolean
): ChartDirection {
  if ((requested ?? linkedDirection) === 'reverse' && hasReverse) return 'reverse';
  return hasForward ? 'forward' : 'reverse';
}

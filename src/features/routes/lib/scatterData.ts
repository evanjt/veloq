/**
 * Pure data-prep helpers for the section scatter chart.
 *
 * Splits the counted performance data points into forward and reverse sets
 * (an excluded attempt is drawn but never counted), normalises
 * each point's time position to [0, 1], and says which directions have a
 * drawn point. The y range is the engine's, read in `scatterMarks`. Also
 * places the engine's trend curves on the chart's x axis.
 *
 * No React, no Victory - pure functions so they can be unit tested in
 * isolation and reused if another chart needs the same bisected layout.
 */

import type { FfiTrendBandPoint } from 'veloqrs';
import type { PerformanceDataPoint } from '@/types';

/** A performance point as rendered on the chart - base record plus its normalised X. */
export type ScatterChartPoint = PerformanceDataPoint & { x: number };

/** Result of splitting chart data into forward + reverse buckets. */
export interface ScatterSplitResult {
  /** All valid points sorted by date and x-normalised, union of both directions,
   *  excluded attempts included so they can be drawn and tapped. */
  allPoints: ScatterChartPoint[];
  /** Forward-direction points (non-reverse) that count, in date order. */
  forwardPoints: ScatterChartPoint[];
  /** Reverse-direction points that count, in date order. */
  reversePoints: ScatterChartPoint[];
  /** Which directions have a drawn point, excluded attempts included. */
  drawn: { forward: boolean; reverse: boolean };
}

/** Empty result used when input data is missing or invalid. */
const EMPTY_SPLIT: ScatterSplitResult = Object.freeze({
  allPoints: [] as ScatterChartPoint[],
  forwardPoints: [] as ScatterChartPoint[],
  reversePoints: [] as ScatterChartPoint[],
  drawn: { forward: false, reverse: false },
}) as ScatterSplitResult;

/**
 * Split chart data into forward / reverse lists, normalise each point's X
 * position to [0.02, 0.98] by time. The
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

  // Normalise x to 0-1 (small edge margin so dots aren't clipped)
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
    drawn: {
      forward: positioned.some((p) => p.direction !== 'reverse'),
      reverse: positioned.some((p) => p.direction === 'reverse'),
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
 * the chart draws is the axis the tap resolves against. With `reach`, the box
 * is measured in pixels and a point further than `reach.radius` from the tap
 * is out of reach, so a tap on empty plot selects nothing. A value past the
 * domain is drawn at its edge, and is reached there.
 */
export function nearestScatterPointIndex(
  points: readonly { x: number; y: number | null | undefined }[],
  tap: { x: number; y: number },
  yDomain: readonly [number, number],
  reach?: { width: number; height: number; radius: number }
): number {
  const [bottom, top] = yDomain;
  const span = top - bottom || 1;
  const width = reach?.width ?? 1;
  const height = reach?.height ?? 1;
  const limit = reach ? reach.radius * reach.radius : Infinity;

  let closestIdx = -1;
  let closestDist = Infinity;
  for (let i = 0; i < points.length; i++) {
    const value = points[i].y;
    if (value == null || !Number.isFinite(value)) continue;
    const dx = (points[i].x - tap.x) * width;
    const along = Math.min(1, Math.max(0, (value - bottom) / span));
    const dy = (1 - along - tap.y) * height;
    const dist = dx * dx + dy * dy;
    if (dist > limit) continue;
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

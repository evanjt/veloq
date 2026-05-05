/**
 * Pure data-prep helpers for the section scatter chart.
 *
 * Splits performance data points into forward and reverse sets, normalizes
 * each point's time position to [0, 1], identifies the PR (fastest non-excluded)
 * in each direction, and computes padded Y domain bounds shared across both
 * directions. Also provides a Gaussian-kernel trend-line builder with a
 * confidence band.
 *
 * No React, no Victory — pure functions so they can be unit tested in
 * isolation and reused if another chart needs the same bisected layout.
 */

import { gaussianSmooth, type SmoothedPoint } from '@/lib/utils/smoothing';
import type { PerformanceDataPoint } from '@/types';

/** A performance point as rendered on the chart — base record plus its normalized X. */
export type ScatterChartPoint = PerformanceDataPoint & { x: number };

/** Result of splitting chart data into forward + reverse buckets. */
export interface ScatterSplitResult {
  /** All valid points sorted by date and x-normalized, union of both directions. */
  allPoints: ScatterChartPoint[];
  /** Forward-direction points (non-reverse), in date order. */
  forwardPoints: ScatterChartPoint[];
  /** Reverse-direction points, in date order. */
  reversePoints: ScatterChartPoint[];
  /** Index into `forwardPoints` of the fastest non-excluded forward point, or -1. */
  forwardBestIdx: number;
  /** Index into `reversePoints` of the fastest non-excluded reverse point, or -1. */
  reverseBestIdx: number;
  /** Minimum speed for Y domain (includes 15% padding, floored at 0). */
  minSpeed: number;
  /** Maximum speed for Y domain (includes 15% padding). */
  maxSpeed: number;
  /** Minimum sectionTime across all points (for time-axis domain). */
  minTime: number;
  /** Maximum sectionTime across all points (for time-axis domain). */
  maxTime: number;
}

/** Empty result used when input data is missing or invalid. */
const EMPTY_SPLIT: ScatterSplitResult = Object.freeze({
  allPoints: [] as ScatterChartPoint[],
  forwardPoints: [] as ScatterChartPoint[],
  reversePoints: [] as ScatterChartPoint[],
  forwardBestIdx: -1,
  reverseBestIdx: -1,
  minSpeed: 0,
  maxSpeed: 1,
  minTime: 0,
  maxTime: 1,
}) as ScatterSplitResult;

/**
 * Split chart data into forward / reverse lists, normalize each point's X
 * position to [0.02, 0.98] by time, identify the best in each direction,
 * and compute padded speed bounds.
 *
 * @param bestBy - 'time' picks shortest sectionTime as PR, 'speed' picks fastest speed.
 *
 * Returns a frozen `EMPTY_SPLIT` when input is empty or contains no valid dates.
 */
export function splitAndPositionChartData(
  chartData: (PerformanceDataPoint & { x: number })[],
  bestBy: 'time' | 'speed' = 'time'
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
  let fwdBest = -1;
  let fwdBestVal = bestBy === 'speed' ? -Infinity : Infinity;
  let revBest = -1;
  let revBestVal = bestBy === 'speed' ? -Infinity : Infinity;

  for (const p of positioned) {
    const val = bestBy === 'speed' ? p.speed : (p.sectionTime ?? Infinity);
    const isBetter = bestBy === 'speed' ? val > 0 && val > fwdBestVal : val > 0 && val < fwdBestVal;
    const isBetterRev =
      bestBy === 'speed' ? val > 0 && val > revBestVal : val > 0 && val < revBestVal;
    if (p.direction === 'reverse') {
      if (!p.isExcluded && isBetterRev) {
        revBestVal = val;
        revBest = rev.length;
      }
      rev.push(p);
    } else {
      if (!p.isExcluded && isBetter) {
        fwdBestVal = val;
        fwdBest = fwd.length;
      }
      fwd.push(p);
    }
  }

  const speeds = positioned.map((p) => p.speed);
  const min = Math.min(...speeds);
  const max = Math.max(...speeds);
  const padding = (max - min) * 0.15 || 0.5;

  const times = positioned.map((p) => p.sectionTime ?? 0).filter((t) => t > 0);
  const tMin = times.length > 0 ? Math.min(...times) : 0;
  const tMax = times.length > 0 ? Math.max(...times) : 1;
  const tPadding = (tMax - tMin) * 0.15 || 30;

  return {
    forwardPoints: fwd,
    reversePoints: rev,
    allPoints: positioned,
    forwardBestIdx: fwdBest,
    reverseBestIdx: revBest,
    minSpeed: Math.max(0, min - padding),
    maxSpeed: max + padding,
    minTime: Math.max(0, tMin - tPadding),
    maxTime: tMax + tPadding,
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
 * Build a Gaussian-smoothed trend line with a confidence band for a single
 * direction. Returns null when there are fewer than 2 points, since a trend
 * needs at least two observations.
 *
 * The band is clamped to the point set's own min/max (plus 15% padding) so
 * it can't visually extend past the chart axis.
 */
export function buildTrendWithBand(
  points: (PerformanceDataPoint & { x: number })[],
  outputCount: number = 200,
  yAccessor: 'speed' | 'sectionTime' = 'speed'
): TrendBandPoint[] | null {
  if (points.length < 2) return null;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => (yAccessor === 'sectionTime' ? (p.sectionTime ?? 0) : p.speed));

  const trend: SmoothedPoint[] = gaussianSmooth(xs, ys, outputCount);
  if (trend.length < 2) return null;

  const yMin = Math.min(...ys);
  const yMax = Math.max(...ys);
  const yPad = (yMax - yMin) * 0.15 || 0.5;

  return trend.map((p) => ({
    x: p.x,
    y: Math.max(yMin - yPad, Math.min(yMax + yPad, p.y)),
    upper: Math.min(yMax + yPad, p.y + p.std),
    lower: Math.max(yMin - yPad, p.y - p.std),
  }));
}

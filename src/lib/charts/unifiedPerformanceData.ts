/**
 * Pure lane-data preparation for the unified performance chart.
 *
 * Splits performance data points into forward and reverse lanes (based on
 * `direction`), computes per-lane min/max speed (with padding) for Y domain
 * sizing, identifies the fastest (best) point in each lane, and locates
 * the globally-highlighted "current" point inside each lane when present.
 *
 * No React, no Victory — pure functions so they can be unit tested in
 * isolation.
 */

import type { PerformanceDataPoint } from '@/types';

/** A point as rendered on the chart — the base record plus its normalized X. */
export type ChartPoint = PerformanceDataPoint & { x: number };

/** Prepared data for a single direction lane. */
export interface LaneData {
  /** Points to render in this lane, already tagged with their normalized X. */
  points: ChartPoint[];
  /**
   * Index back into the original `chartData` array for each lane point.
   * Parallel to `points` — `originalIndices[i]` is the source index of
   * `points[i]`.
   */
  originalIndices: number[];
  /** Index (in `points`) of the fastest point in this lane, or -1. */
  bestIndex: number;
  /** Index (in `points`) of the highlighted "current" point, or -1. */
  currentIndex: number;
  /** Y-domain minimum for this lane (includes padding). */
  minSpeed: number;
  /** Y-domain maximum for this lane (includes padding). */
  maxSpeed: number;
}

/** Result of splitting chart data into forward / reverse lanes. */
export interface SplitLanes {
  forwardLane: LaneData;
  reverseLane: LaneData;
}

/**
 * Fallback stats for an empty lane.
 *
 * Keeps the domain non-degenerate so Victory can still render an (empty)
 * axis without triggering divide-by-zero paths.
 */
const EMPTY_LANE: LaneData = Object.freeze({
  points: [],
  originalIndices: [],
  bestIndex: -1,
  currentIndex: -1,
  minSpeed: 0,
  maxSpeed: 1,
}) as LaneData;

/**
 * Build stats for a single direction lane.
 *
 * - `points` should already be in display order (normally original index order).
 * - `originalIndices[i]` must be the index of `points[i]` in the source
 *   `chartData` array.
 * - `currentIndex` (if provided) is a global index into `chartData`; the
 *   returned `currentIndex` is the corresponding lane-local index, or -1.
 */
export function buildLaneStats(
  points: ChartPoint[],
  originalIndices: number[],
  currentIndex: number | undefined
): LaneData {
  if (points.length === 0) {
    return { ...EMPTY_LANE };
  }

  let laneBestIdx = -1;
  let laneBestSpeed = -Infinity;
  let current = -1;
  let min = Infinity;
  let max = -Infinity;

  points.forEach((p, idx) => {
    if (currentIndex !== undefined && originalIndices[idx] === currentIndex) current = idx;
    min = Math.min(min, p.speed);
    max = Math.max(max, p.speed);
    if (p.speed > laneBestSpeed) {
      laneBestSpeed = p.speed;
      laneBestIdx = idx;
    }
  });

  // Add 20% padding to Y domain (with a 0.5 floor so all-equal datasets
  // still render with some breathing room). Deliberately wider than
  // scatterData.ts's 15%: lanes render one point per traversal (sparse),
  // so extra vertical space improves readability.
  const padding = (max - min) * 0.2 || 0.5;
  return {
    points,
    originalIndices,
    bestIndex: laneBestIdx,
    currentIndex: current,
    minSpeed: min - padding,
    maxSpeed: max + padding,
  };
}

/**
 * Split chart data by direction and build lane stats for both directions.
 *
 * `dateToX` maps each point's `date` to a normalized [0, 1] position on
 * the (possibly gap-compressed) shared time axis.
 *
 * @param chartData Performance data points sorted in the intended display order.
 * @param dateToX Function mapping dates to normalized X positions.
 * @param currentIndex Optional global index of the currently-highlighted point.
 */
export function splitIntoLanes(
  chartData: PerformanceDataPoint[],
  dateToX: (date: Date) => number,
  currentIndex: number | undefined
): SplitLanes {
  const forwardPoints: ChartPoint[] = [];
  const reversePoints: ChartPoint[] = [];
  const forwardIndices: number[] = [];
  const reverseIndices: number[] = [];

  chartData.forEach((point, idx) => {
    const x = dateToX(point.date);
    if (point.direction === 'reverse') {
      reversePoints.push({ ...point, x });
      reverseIndices.push(idx);
    } else {
      forwardPoints.push({ ...point, x });
      forwardIndices.push(idx);
    }
  });

  return {
    forwardLane: buildLaneStats(forwardPoints, forwardIndices, currentIndex),
    reverseLane: buildLaneStats(reversePoints, reverseIndices, currentIndex),
  };
}

/**
 * Pixel layout for the attempt histogram. The engine decides the bins; this
 * only places them: bar rectangles, where a time falls on the x axis, and the
 * integer count ticks.
 */

import type { FfiAttemptHistogram } from 'veloqrs';

export interface HistogramFrame {
  width: number;
  height: number;
  padding: { left: number; right: number; top: number; bottom: number };
}

export interface HistogramRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface HistogramCountTick {
  count: number;
  y: number;
}

export interface HistogramLayout {
  bars: HistogramRect[];
  /** Integer counts from zero to the tallest bar, each with its pixel row. */
  countTicks: HistogramCountTick[];
  /** The pixel x of a time in seconds, or null outside the binned span. */
  xForTime: (timeSecs: number) => number | null;
}

/** At most this many count ticks, so a tall bar does not crowd the axis. */
const MAX_COUNT_TICKS = 4;

/** Whole counts from 1 to `maxCount`, thinned to at most `MAX_COUNT_TICKS`. */
export function integerCountTicks(maxCount: number): number[] {
  const top = Math.floor(maxCount);
  if (!Number.isFinite(top) || top < 1) return [];
  const step = Math.ceil(top / MAX_COUNT_TICKS);
  const ticks: number[] = [];
  for (let count = step; count <= top; count += step) ticks.push(count);
  return ticks;
}

export function layoutHistogram(
  histogram: FfiAttemptHistogram,
  frame: HistogramFrame
): HistogramLayout {
  const { counts, startSecs, binWidthSecs } = histogram;
  const { padding } = frame;
  const plotWidth = Math.max(0, frame.width - padding.left - padding.right);
  const plotHeight = Math.max(0, frame.height - padding.top - padding.bottom);
  const baseline = padding.top + plotHeight;
  const maxCount = Math.max(1, ...counts);
  const barWidth = counts.length > 0 ? plotWidth / counts.length : 0;

  const bars = counts.map((count, i) => {
    const height = (count / maxCount) * plotHeight;
    return { x: padding.left + i * barWidth, y: baseline - height, width: barWidth, height };
  });

  const span = counts.length * binWidthSecs;
  const xForTime = (timeSecs: number) => {
    if (!Number.isFinite(timeSecs) || span <= 0) return null;
    const fraction = (timeSecs - startSecs) / span;
    if (fraction < 0 || fraction > 1) return null;
    return padding.left + fraction * plotWidth;
  };

  const countTicks = integerCountTicks(Math.max(...counts, 0)).map((count) => ({
    count,
    y: baseline - (count / maxCount) * plotHeight,
  }));

  return { bars, countTicks, xForTime };
}

/**
 * Pixel layout for the attempt histogram. The engine decides the bins; this
 * only places them: one bar per bin, capped and centred in its bin, where a
 * time falls on the x axis, and the integer count ticks from zero.
 */

import { barWidthFor } from '@/shared/charts/chartMarks';
import type { FfiAttemptHistogram } from 'veloqrs';

export interface HistogramFrame {
  width: number;
  height: number;
  padding: { left: number; right: number; top: number; bottom: number };
}

export interface HistogramBar {
  /** The bar's left edge, its top, its width and its height. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** The bar's centre, which is its bin's centre. */
  centre: number;
  /** The span of the bin the bar stands in. */
  binLeft: number;
  binRight: number;
}

export interface HistogramCountTick {
  count: number;
  y: number;
}

export interface HistogramLayout {
  bars: HistogramBar[];
  /** The pixel row of a zero count. */
  baseline: number;
  /** Integer counts from zero to the tallest bar, each with its pixel row. */
  countTicks: HistogramCountTick[];
  /** The pixel x of a time in seconds, or null outside the binned span. */
  xForTime: (timeSecs: number) => number | null;
}

/** At most this many count ticks, so a tall bar does not crowd the axis. */
const MAX_COUNT_TICKS = 4;

/** Whole counts from 0 to `maxCount`, thinned to at most `MAX_COUNT_TICKS` above zero. */
export function integerCountTicks(maxCount: number): number[] {
  const top = Math.floor(maxCount);
  if (!Number.isFinite(top) || top < 1) return [0];
  const step = Math.ceil(top / MAX_COUNT_TICKS);
  const ticks: number[] = [0];
  for (let count = step; count <= top; count += step) ticks.push(count);
  return ticks;
}

/** Whether a time in seconds falls inside the binned span, the last bin's end included. */
export function binsContain(histogram: FfiAttemptHistogram, timeSecs: number): boolean {
  const span = histogram.counts.length * histogram.binWidthSecs;
  if (!Number.isFinite(timeSecs) || span <= 0) return false;
  const fraction = (timeSecs - histogram.startSecs) / span;
  return fraction >= 0 && fraction <= 1;
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
  const binWidth = counts.length > 0 ? plotWidth / counts.length : 0;
  const centres = counts.map((_, i) => padding.left + (i + 0.5) * binWidth);
  const barWidth = Math.min(barWidthFor(centres, plotWidth), binWidth);

  const bars = counts.map((count, i) => {
    const height = (count / maxCount) * plotHeight;
    const centre = centres[i] ?? 0;
    return {
      x: centre - barWidth / 2,
      y: baseline - height,
      width: barWidth,
      height,
      centre,
      binLeft: padding.left + i * binWidth,
      binRight: padding.left + (i + 1) * binWidth,
    };
  });

  const span = counts.length * binWidthSecs;
  const xForTime = (timeSecs: number) =>
    binsContain(histogram, timeSecs)
      ? padding.left + ((timeSecs - startSecs) / span) * plotWidth
      : null;

  const countTicks = integerCountTicks(Math.max(...counts, 0)).map((count) => ({
    count,
    y: baseline - (count / maxCount) * plotHeight,
  }));

  return { bars, baseline, countTicks, xForTime };
}

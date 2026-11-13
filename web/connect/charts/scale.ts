// The chart kit's arithmetic: the plot box, a value axis rounded to nice ticks
// and the nearest category under a pointer. Pure, so a test drives it without
// a browser. Extents, tick steps and curve paths come from the app's shared
// chart modules.

import { niceScale } from '@/shared/charts/axisLabels';
import { finiteExtent } from '@/shared/charts/extent';

export type Box = { left: number; right: number; top: number; bottom: number };

/** The drawing's size in user units; the SVG scales to its card. */
export const CHART_WIDTH = 640;
export const CHART_HEIGHT = 240;

/** The room the axes take: value labels on the left, category labels below. */
export const PLOT: Box = { left: 48, right: 12, top: 10, bottom: CHART_HEIGHT - 28 };

export type ValueAxis = { low: number; high: number; ticks: number[] };

/**
 * A value axis over every finite value, rounded out to 1, 2 or 5 times a power
 * of ten. `zero` pins the low end at or below zero, which bars and areas need
 * for their length to mean something.
 */
export function valueAxis(values: readonly number[], zero: boolean, intervals = 4): ValueAxis {
  const extent = finiteExtent(values);
  const low = extent ? (zero ? Math.min(0, extent.min) : extent.min) : 0;
  const high = extent ? (zero ? Math.max(0, extent.max) : extent.max) : 1;
  const scale = niceScale([low, high], intervals);
  return { low: scale.domain[0], high: scale.domain[1], ticks: scale.ticks };
}

/** Pixel y of `value` on `axis` inside the plot. */
export function yOf(value: number, axis: ValueAxis, box: Box = PLOT): number {
  const span = axis.high - axis.low;
  if (span <= 0) return box.bottom;
  return box.bottom - ((value - axis.low) / span) * (box.bottom - box.top);
}

/** Pixel x of category `index` of `count`, bars and dots centred in their band. */
export function xOfIndex(index: number, count: number, band: boolean, box: Box = PLOT): number {
  const width = box.right - box.left;
  if (band) return box.left + ((index + 0.5) / Math.max(count, 1)) * width;
  return box.left + (count <= 1 ? 0.5 : index / (count - 1)) * width;
}

/** The category nearest a pointer `x` user units from the drawing's left edge, clamped. */
export function indexAtPointer(x: number, count: number, band: boolean, box: Box = PLOT): number {
  if (count <= 0) return -1;
  const width = box.right - box.left;
  const fraction = Math.min(1, Math.max(0, (x - box.left) / width));
  const near = band ? Math.floor(fraction * count) : Math.round(fraction * (count - 1));
  return Math.min(count - 1, Math.max(0, near));
}

/** Indexes of at most `limit` labels, evenly spaced and always including the ends. */
export function labelIndexes(count: number, limit: number): number[] {
  if (count <= 0) return [];
  if (count <= limit) return Array.from({ length: count }, (_, i) => i);
  const picked = new Set<number>();
  for (let i = 0; i < limit; i++) picked.add(Math.round((i * (count - 1)) / (limit - 1)));
  return [...picked];
}

import { curveMonotoneX, line } from 'd3-shape';

import type { XY } from './svgPath';

export interface SparklineBox {
  width: number;
  height: number;
  /** Kept clear on every side, so a mark on an end point is not cut by the canvas. */
  pad: number;
  /** A higher value sits lower, for a quantity where less is better. */
  invert?: boolean | undefined;
}

export interface SparklinePlacement {
  points: XY[];
  min: number;
  max: number;
}

/**
 * Where each value of a sparkline sits in its box. Points carrying dates sit at
 * their date, so a long gap between two of them reads as one; with no dates, or
 * dates that do not line up with the values or span no time, they are spaced
 * evenly. A flat series has no range to scale against and runs down the middle.
 */
export function sparklinePlacement(
  values: readonly number[],
  dates: readonly number[] | undefined,
  { width, height, pad, invert = false }: SparklineBox
): SparklinePlacement {
  if (values.length === 0) return { points: [], min: 0, max: 0 };

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min;
  const first = dates?.[0];
  const last = dates?.[dates.length - 1];
  const span = first !== undefined && last !== undefined ? last - first : 0;
  const byDate = dates?.length === values.length && Number.isFinite(span) && span > 0;
  const w = width - pad * 2;
  const h = height - pad * 2;

  const along = (i: number) => {
    if (values.length === 1) return 0.5;
    if (byDate && first !== undefined) return ((dates[i] ?? first) - first) / span;
    return i / (values.length - 1);
  };
  const rise = (value: number) => {
    if (range === 0) return 0.5;
    const share = (value - min) / range;
    return invert ? 1 - share : share;
  };

  return {
    points: values.map((value, i) => ({
      x: pad + along(i) * w,
      y: pad + (1 - rise(value)) * h,
    })),
    min,
    max,
  };
}

/** The sparkline's line through its placed points, a monotone curve, or null with fewer than two. */
export function sparklineSvg(points: readonly XY[]): string | null {
  if (points.length < 2) return null;
  return (
    line<XY>()
      .x((p) => p.x)
      .y((p) => p.y)
      .curve(curveMonotoneX)(points as XY[]) ?? null
  );
}

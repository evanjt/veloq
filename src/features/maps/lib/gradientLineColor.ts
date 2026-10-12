/**
 * Gradient-based line coloring helpers for MapLibre `line-gradient`.
 *
 * Maps per-point gradient (% slope) values to colors along a polyline, on the
 * diverging `gradientScale` from the theme: a light neutral on flat ground,
 * darkening blues on descents and darkening oranges on climbs.
 *
 * Usage:
 *   const stops = buildGradientLineStops(streams.grade_smooth, streams.distance);
 *   <LineLayer style={{ lineGradient: ['interpolate', ['linear'], ['line-progress'], ...stops] }} />
 *
 * Requires the GeoJSON source spec to set `lineMetrics: true` so that
 * `line-progress` expressions are available.
 */

import { gradientScale } from '@/theme';

/** Color stops mapping gradient % to an RGB hex color. */
export interface GradientStop {
  /** Slope percent (-30 .. +30) */
  percent: number;
  /** Hex color for this stop */
  color: string;
}

/** The scale from steep descent to steep climb, flat ground at its middle stop. */
export const GRADIENT_COLOR_STOPS: readonly GradientStop[] = gradientScale;

/** The gradients the map key labels on its ramp. */
export const GRADIENT_KEY_TICKS: readonly number[] = [-10, 0, 10, 20];

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function hexToRgb(hex: string): [number, number, number] {
  const cleaned = hex.replace('#', '');
  const r = parseInt(cleaned.slice(0, 2), 16);
  const g = parseInt(cleaned.slice(2, 4), 16);
  const b = parseInt(cleaned.slice(4, 6), 16);
  return [r, g, b];
}

function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (v: number) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/**
 * Return the color for a given gradient percentage by linearly interpolating
 * between the nearest stops in {@link GRADIENT_COLOR_STOPS}.
 */
export function gradientToColor(percent: number): string {
  const stops = GRADIENT_COLOR_STOPS;
  if (!Number.isFinite(percent)) return gradientToColor(0);

  const p = clamp(percent, stops[0].percent, stops[stops.length - 1].percent);

  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i];
    const b = stops[i + 1];
    if (p >= a.percent && p <= b.percent) {
      const t = (p - a.percent) / (b.percent - a.percent);
      const [ar, ag, ab] = hexToRgb(a.color);
      const [br, bg, bb] = hexToRgb(b.color);
      return rgbToHex(ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t);
    }
  }
  return stops[stops.length - 1].color;
}

/**
 * Build a `line-gradient` interpolation expression body for MapLibre.
 *
 * Produces an alternating sequence of `[progress, color, progress, color, ...]`
 * suitable for feeding into an `['interpolate', ['linear'], ['line-progress'], ...]`
 * expression. `progress` runs from 0 to 1 along the line.
 *
 * `line-progress` is a fraction of the line's length, while the grade stream is
 * sampled by time, so each stop is placed by its share of the distance stream.
 * Index stands in only when distance cannot say where a sample is.
 *
 * To keep the expression size manageable we cap at ~100 stops (downsampling
 * long streams by stride). 100 stops is plenty for a visually smooth gradient.
 *
 * `hasPosition` marks the samples that are on the drawn line.
 *
 * Returns `null` if there isn't enough data to render a gradient.
 */
export function buildGradientLineStops(
  gradient: ArrayLike<number> | undefined,
  distance: ArrayLike<number> | undefined,
  maxStops = 100,
  hasPosition?: boolean[]
): (string | number)[] | null {
  if (gradient && hasPosition && hasPosition.length === gradient.length) {
    // The drawn line holds only samples with a position, so line-progress
    // spans those and nothing else.
    const keep = (_: unknown, i: number) => hasPosition[i];
    const usable = distance && distance.length === gradient.length;
    return buildGradientLineStops(
      Array.prototype.filter.call(gradient, keep) as number[],
      usable ? (Array.prototype.filter.call(distance, keep) as number[]) : undefined,
      maxStops
    );
  }
  if (!gradient || gradient.length < 2) return null;
  const n = gradient.length;
  const last = n - 1;
  const progressAt = usableDistance(distance, n)
    ? (i: number) => (distance[i] - distance[0]) / (distance[last] - distance[0])
    : (i: number) => i / last;
  const stride = Math.max(1, Math.floor(n / maxStops));
  const pairs: (string | number)[] = [];

  // A stop with the recorder running holds distance still for many samples.
  // Interpolate refuses stops that do not strictly increase, so those collapse
  // into the first sample at that distance.
  const push = (progress: number, grade: number) => {
    if (pairs.length > 0 && progress <= (pairs[pairs.length - 2] as number)) return;
    pairs.push(progress, gradientToColor(grade));
  };

  for (let i = 0; i < n; i += stride) {
    push(progressAt(i), gradient[i]);
  }
  // Always include the final point so the gradient reaches progress=1
  push(1, gradient[last]);

  return pairs;
}

/** Distance can place the samples only when it covers each one and never runs backwards. */
function usableDistance(
  distance: ArrayLike<number> | undefined,
  n: number
): distance is ArrayLike<number> {
  if (!distance || distance.length !== n) return false;
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(distance[i])) return false;
    if (i > 0 && distance[i] < distance[i - 1]) return false;
  }
  return distance[n - 1] > distance[0];
}

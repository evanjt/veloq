/**
 * Grade-based line colouring helpers for MapLibre `line-gradient`.
 *
 * Maps per-point grade (% slope) values to the base map's diverging steps along
 * a polyline: grey within 2 % of flat, then three steps of the base's cool side
 * on descents and three of its warm side on climbs. Each band is one colour, so
 * a colour always means one band.
 *
 * Usage:
 *   const stops = buildGradientLineStops(streams.grade_smooth, streams.distance, mapStyle);
 *   <LineLayer style={{ lineGradient: gradientStepExpression(stops) }} />
 *
 * Requires the GeoJSON source spec to set `lineMetrics: true` so that
 * `line-progress` expressions are available.
 */

import { colourTokens } from '@/theme';
import type { MapStyleType } from '../components/mapStyles';

/** A step of a base map's diverging ramp, from steep descent to steep climb. */
export type GradeStep = 'cool-3' | 'cool-2' | 'cool-1' | 'mid' | 'warm-1' | 'warm-2' | 'warm-3';

/**
 * The grade bands from steep descent to steep climb, each ending at `upTo`
 * percent on its climbing side. Flat ground is the band within 2 % either way.
 */
export const GRADE_BANDS: readonly { step: GradeStep; upTo: number }[] = [
  { step: 'cool-3', upTo: -10 },
  { step: 'cool-2', upTo: -5 },
  { step: 'cool-1', upTo: -2 },
  { step: 'mid', upTo: 2 },
  { step: 'warm-1', upTo: 5 },
  { step: 'warm-2', upTo: 10 },
  { step: 'warm-3', upTo: Infinity },
];

/** The gradients the map key labels on its ramp. */
export const GRADIENT_KEY_TICKS: readonly number[] = [-10, 0, 10];

/** The step a grade falls in. A grade with no value is drawn as flat. */
export function gradeStep(percent: number): GradeStep {
  if (!Number.isFinite(percent)) return 'mid';
  for (const band of GRADE_BANDS) {
    // A band holds its edge farther from flat, and flat ground both of its own.
    if (band.upTo < 0 ? percent < band.upTo : percent <= band.upTo) return band.step;
  }
  return 'warm-3';
}

/** The base map's colour for one step of its diverging ramp. */
export function gradeStepTokenColour(step: GradeStep, style: MapStyleType): string {
  return colourTokens.light[`map-${style}-div-${step}`];
}

/** The base map's colour for a grade. */
export function gradeStepColour(percent: number, style: MapStyleType): string {
  return gradeStepTokenColour(gradeStep(percent), style);
}

/**
 * The `line-gradient` expression for stops from {@link buildGradientLineStops}:
 * a `step` over `line-progress`, so each band keeps its colour up to the next.
 * Runs of one colour fold into their first stop.
 */
export function gradientStepExpression(stops: readonly (string | number)[]): unknown[] {
  const expression: unknown[] = ['step', ['line-progress'], stops[1]];
  for (let i = 2; i < stops.length; i += 2) {
    if (stops[i + 1] === expression[expression.length - 1]) continue;
    expression.push(stops[i], stops[i + 1]);
  }
  return expression;
}

/**
 * Build the colour stops along the line for MapLibre's `line-gradient`.
 *
 * Produces an alternating sequence of `[progress, colour, progress, colour, ...]`
 * in the base map's diverging steps, for {@link gradientStepExpression}.
 * `progress` runs from 0 to 1 along the line.
 *
 * `line-progress` is a fraction of the line's length, while the grade stream is
 * sampled by time, so each stop is placed by its share of the distance stream.
 * Index stands in only when distance cannot say where a sample is.
 *
 * To keep the expression size manageable we cap at ~100 stops (downsampling
 * long streams by stride).
 *
 * `hasPosition` marks the samples that are on the drawn line.
 *
 * Returns `null` if there isn't enough data to render a gradient.
 */
export function buildGradientLineStops(
  gradient: ArrayLike<number> | undefined,
  distance: ArrayLike<number> | undefined,
  style: MapStyleType,
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
      style,
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
    pairs.push(progress, gradeStepColour(grade, style));
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

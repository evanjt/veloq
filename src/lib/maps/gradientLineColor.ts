/**
 * Gradient-based line coloring helpers for MapLibre `line-gradient`.
 *
 * Maps per-point gradient (% slope) values to colors along a polyline.
 * Colors: steep descents → blue, flats → green/yellow, steep climbs → red/purple.
 *
 * Usage:
 *   const stops = buildGradientLineStops(gradientStream);
 *   <LineLayer style={{ lineGradient: ['interpolate', ['linear'], ['line-progress'], ...stops] }} />
 *
 * Requires the `ShapeSource` to set `lineMetrics: true` so that
 * `line-progress` expressions are available.
 */

/** Color stops mapping gradient % to an RGB hex color. */
export interface GradientStop {
  /** Slope percent (-30 .. +30) */
  percent: number;
  /** Hex color for this stop */
  color: string;
}

/**
 * Reference colormap from steep descent to steep ascent.
 * Anchored at the gradient percentages called out in the feature spec.
 */
export const GRADIENT_COLOR_STOPS: readonly GradientStop[] = [
  { percent: -30, color: '#1E3A8A' }, // deep blue (very steep descent)
  { percent: -10, color: '#22C55E' }, // green (gentle descent)
  { percent: 0, color: '#A3E635' }, // yellow-green (flat)
  { percent: 5, color: '#FACC15' }, // yellow (mild climb)
  { percent: 10, color: '#F97316' }, // orange (moderate climb)
  { percent: 20, color: '#DC2626' }, // red (steep climb)
  { percent: 30, color: '#7C1D6F' }, // purple (very steep climb)
];

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
  if (!Number.isFinite(percent)) return stops[Math.floor(stops.length / 2)].color;

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
 * To keep the expression size manageable we cap at ~100 stops (downsampling
 * long streams by stride). 100 stops is plenty for a visually smooth gradient.
 *
 * Returns `null` if there isn't enough data to render a gradient.
 */
export function buildGradientLineStops(
  gradient: number[] | undefined,
  maxStops = 100
): (string | number)[] | null {
  if (!gradient || gradient.length < 2) return null;
  const n = gradient.length;
  const stride = Math.max(1, Math.floor(n / maxStops));
  const pairs: (string | number)[] = [];

  for (let i = 0; i < n; i += stride) {
    const progress = n === 1 ? 0 : i / (n - 1);
    pairs.push(progress, gradientToColor(gradient[i]));
  }

  // Always include the final point so the gradient reaches progress=1
  const last = n - 1;
  if ((pairs[pairs.length - 2] as number) !== 1) {
    pairs.push(1, gradientToColor(gradient[last]));
  }

  return pairs;
}

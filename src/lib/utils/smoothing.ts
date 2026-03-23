import type { TimeRange } from '@/hooks';

export type SmoothingWindow = 'auto' | 'none' | 3 | 7 | 14 | 21 | 28;

/** Default smoothing windows per time range */
export const DEFAULT_SMOOTHING_WINDOWS: Record<TimeRange, number> = {
  '7d': 0, // No smoothing for 1 week - daily data is meaningful
  '1m': 3, // 3-day average reduces weekday/weekend variance
  '42d': 5, // 5-day average for 42-day range (similar to 1m)
  '3m': 7, // Weekly average aligns with training weeks
  '6m': 14, // 2-week window for medium-term trends
  '1y': 21, // ~3 weeks captures monthly-ish patterns
};

/** Available smoothing presets for the config UI */
export const SMOOTHING_PRESETS: { value: SmoothingWindow; label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'none', label: 'None' },
  { value: 3, label: '3d' },
  { value: 7, label: '7d' },
  { value: 14, label: '14d' },
  { value: 21, label: '21d' },
  { value: 28, label: '28d' },
];

/**
 * Get the effective window size based on user preference and time range
 */
export function getEffectiveWindow(preference: SmoothingWindow, timeRange: TimeRange): number {
  if (preference === 'none') return 0;
  if (preference === 'auto') return DEFAULT_SMOOTHING_WINDOWS[timeRange];
  return preference;
}

/**
 * Apply centered moving average smoothing to data points
 *
 * Uses a centered window (equal days before and after) to avoid lag.
 * At edges, uses asymmetric window with available data.
 *
 * @param data Array of data points with x (index) and value
 * @param windowSize Total window size (e.g., 7 means ±3 days around each point)
 * @returns New array with smoothed values (original rawValue preserved)
 */
export function smoothDataPoints<T extends { x: number; value: number; rawValue: number }>(
  data: T[],
  windowSize: number
): T[] {
  if (windowSize <= 1 || data.length <= 1) return data;

  // Create a map for quick lookup by x index
  const valueMap = new Map<number, number>();
  data.forEach((d) => valueMap.set(d.x, d.rawValue));

  // Half window on each side (centered)
  const halfWindow = Math.floor(windowSize / 2);

  return data.map((point) => {
    let sum = 0;
    let count = 0;

    // Collect values within the window
    for (let offset = -halfWindow; offset <= halfWindow; offset++) {
      const targetX = point.x + offset;
      const value = valueMap.get(targetX);
      if (value !== undefined) {
        sum += value;
        count++;
      }
    }

    // Calculate smoothed value (or keep original if no neighbors)
    const smoothedValue = count > 0 ? sum / count : point.rawValue;

    return {
      ...point,
      value: smoothedValue,
      // Keep rawValue for display when user selects a point
    };
  });
}

/**
 * LOESS (Locally Weighted Scatterplot Smoothing).
 * Fits local weighted linear regressions using a tricube kernel.
 *
 * @param xs - X values (e.g., timestamps normalized 0-1)
 * @param ys - Y values (e.g., speed in m/s)
 * @param span - Bandwidth: fraction of data used per fit (0.15-0.8).
 *               Smaller = more responsive, larger = smoother.
 *               Default: auto based on point count.
 * @param outputCount - Number of evenly-spaced output points (default: 40)
 * @returns Array of {x, y} points for the smooth curve
 */
export function loessSmooth(
  xs: number[],
  ys: number[],
  span?: number,
  outputCount: number = 40
): { x: number; y: number }[] {
  const n = xs.length;
  if (n < 2 || n !== ys.length) return [];
  if (n === 2)
    return [
      { x: xs[0], y: ys[0] },
      { x: xs[1], y: ys[1] },
    ];

  const effectiveSpan =
    span ?? (n <= 6 ? 1.0 : n <= 10 ? 0.8 : Math.max(0.25, Math.min(0.5, 15 / n)));
  const k = Math.max(2, Math.ceil(effectiveSpan * n));

  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  if (xMin === xMax) {
    const meanY = ys.reduce((a, b) => a + b, 0) / n;
    return [{ x: xMin, y: meanY }];
  }

  const result: { x: number; y: number }[] = [];

  for (let i = 0; i < outputCount; i++) {
    const x0 = xMin + (i / (outputCount - 1)) * (xMax - xMin);

    // Find k nearest neighbors by distance
    const distances = xs.map((xi, j) => ({ dist: Math.abs(xi - x0), j }));
    distances.sort((a, b) => a.dist - b.dist);
    const maxDist = distances[k - 1].dist || 1e-10;

    // Tricube kernel weights + weighted linear regression
    let sumW = 0,
      sumWx = 0,
      sumWy = 0,
      sumWxx = 0,
      sumWxy = 0;
    for (let m = 0; m < k; m++) {
      const { j } = distances[m];
      const u = distances[m].dist / maxDist;
      const t = 1 - u * u * u;
      const w = t * t * t; // tricube
      sumW += w;
      sumWx += w * xs[j];
      sumWy += w * ys[j];
      sumWxx += w * xs[j] * xs[j];
      sumWxy += w * xs[j] * ys[j];
    }

    // Weighted least squares: y = a + b*x
    const denom = sumW * sumWxx - sumWx * sumWx;
    let y0: number;
    if (Math.abs(denom) < 1e-12) {
      y0 = sumW > 0 ? sumWy / sumW : 0;
    } else {
      const b = (sumW * sumWxy - sumWx * sumWy) / denom;
      const a = (sumWy - b * sumWx) / sumW;
      y0 = a + b * x0;
    }

    result.push({ x: x0, y: y0 });
  }

  return result;
}

/**
 * Weighted quadratic polynomial trend line.
 * Fits y = a + b*x + c*x² via weighted least squares.
 * Produces a single smooth curve — ideal for showing global performance trends.
 *
 * @param xs - X values (typically time-normalized 0-1)
 * @param ys - Y values (e.g., speed in m/s)
 * @param outputCount - Number of evenly-spaced output points (default: 80)
 * @returns Array of {x, y} points for the smooth curve
 */
export function quadraticTrend(
  xs: number[],
  ys: number[],
  outputCount: number = 80
): { x: number; y: number }[] {
  const n = xs.length;
  if (n < 2 || n !== ys.length) return [];
  if (n === 2)
    return [
      { x: xs[0], y: ys[0] },
      { x: xs[1], y: ys[1] },
    ];

  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  if (xMin === xMax) {
    const meanY = ys.reduce((a, b) => a + b, 0) / n;
    return [{ x: xMin, y: meanY }];
  }

  // Normalize xs to [0, 1] for numerical stability
  const range = xMax - xMin;
  const xn = xs.map((x) => (x - xMin) / range);

  // Recency weight: 0.5 at start → 1.0 at end (subtle bias toward recent data)
  const ws = xn.map((x) => 0.5 + 0.5 * x);

  // Build weighted normal equations for y = a + b*t + c*t²
  // [S0   S1   S2 ] [a]   [Sy0]
  // [S1   S2   S3 ] [b] = [Sy1]
  // [S2   S3   S4 ] [c]   [Sy2]
  let s0 = 0,
    s1 = 0,
    s2 = 0,
    s3 = 0,
    s4 = 0;
  let sy0 = 0,
    sy1 = 0,
    sy2 = 0;
  for (let i = 0; i < n; i++) {
    const w = ws[i];
    const t = xn[i];
    const t2 = t * t;
    s0 += w;
    s1 += w * t;
    s2 += w * t2;
    s3 += w * t * t2;
    s4 += w * t2 * t2;
    sy0 += w * ys[i];
    sy1 += w * t * ys[i];
    sy2 += w * t2 * ys[i];
  }

  // Solve 3x3 system via Cramer's rule
  const det = s0 * (s2 * s4 - s3 * s3) - s1 * (s1 * s4 - s3 * s2) + s2 * (s1 * s3 - s2 * s2);

  let a: number, b: number, c: number;
  if (Math.abs(det) < 1e-12) {
    // Degenerate — fall back to weighted mean
    const meanY = sy0 / s0;
    a = meanY;
    b = 0;
    c = 0;
  } else {
    a = (sy0 * (s2 * s4 - s3 * s3) - s1 * (sy1 * s4 - sy2 * s3) + s2 * (sy1 * s3 - sy2 * s2)) / det;
    b = (s0 * (sy1 * s4 - sy2 * s3) - sy0 * (s1 * s4 - s3 * s2) + s2 * (s1 * sy2 - sy1 * s2)) / det;
    c = (s0 * (s2 * sy2 - s3 * sy1) - s1 * (s1 * sy2 - sy1 * s2) + sy0 * (s1 * s3 - s2 * s2)) / det;
  }

  // Evaluate polynomial at evenly-spaced output points
  const result: { x: number; y: number }[] = [];
  for (let i = 0; i < outputCount; i++) {
    const t = i / (outputCount - 1); // 0 to 1
    const x0 = xMin + t * range;
    const y0 = a + b * t + c * t * t;
    result.push({ x: x0, y: y0 });
  }

  return result;
}

/**
 * Gaussian kernel smoother with local-linear boundary correction.
 * Produces a smooth trend line for any number of points (≥2), handling
 * irregular time spacing naturally. No parameter tuning needed.
 *
 * Unlike LOESS (tricube kernel with hard cutoffs), Gaussian tails never
 * reach zero — every observation always contributes, preventing flat
 * regions and sudden transitions with sparse data.
 *
 * Bandwidth adapts automatically: h = timeSpan / sqrt(n).
 * Local-linear fit at each evaluation point corrects boundary bias
 * so the recent trend isn't pulled toward the historical mean.
 *
 * @param xs - X values (e.g., normalized time positions)
 * @param ys - Y values (e.g., speed in m/s)
 * @param outputCount - Number of evenly-spaced output points (default: 200)
 * @returns Array of {x, y} points for the smooth curve
 */
export function gaussianSmooth(
  xs: number[],
  ys: number[],
  outputCount: number = 200
): { x: number; y: number }[] {
  const n = xs.length;
  if (n < 2 || n !== ys.length) return [];
  if (n === 2)
    return [
      { x: xs[0], y: ys[0] },
      { x: xs[1], y: ys[1] },
    ];

  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const span = xMax - xMin;
  if (span === 0) {
    const meanY = ys.reduce((a, b) => a + b, 0) / n;
    return [{ x: xMin, y: meanY }];
  }

  // Adaptive bandwidth: wider for sparse data, narrower for dense
  const h = span / Math.max(3, Math.sqrt(n));

  const result: { x: number; y: number }[] = [];

  for (let i = 0; i < outputCount; i++) {
    const x0 = xMin + (i / (outputCount - 1)) * span;

    // Gaussian weights for all observations
    let sumW = 0,
      sumWx = 0,
      sumWy = 0,
      sumWxx = 0,
      sumWxy = 0;
    for (let j = 0; j < n; j++) {
      const dx = (xs[j] - x0) / h;
      const w = Math.exp(-0.5 * dx * dx);
      sumW += w;
      sumWx += w * xs[j];
      sumWy += w * ys[j];
      sumWxx += w * xs[j] * xs[j];
      sumWxy += w * xs[j] * ys[j];
    }

    // Local-linear fit: y = a + b*x (corrects boundary bias)
    const denom = sumW * sumWxx - sumWx * sumWx;
    let y0: number;
    if (Math.abs(denom) < 1e-12) {
      y0 = sumW > 0 ? sumWy / sumW : 0;
    } else {
      const b = (sumW * sumWxy - sumWx * sumWy) / denom;
      const a = (sumWy - b * sumWx) / sumW;
      y0 = a + b * x0;
    }

    result.push({ x: x0, y: y0 });
  }

  return result;
}

/**
 * Get a human-readable description of the smoothing window
 */
export function getSmoothingDescription(preference: SmoothingWindow, timeRange: TimeRange): string {
  const effectiveWindow = getEffectiveWindow(preference, timeRange);
  if (effectiveWindow === 0) return 'Raw data';
  return `${effectiveWindow}-day average`;
}

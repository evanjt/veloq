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

  const effectiveSpan = span ?? Math.max(0.25, Math.min(0.5, 15 / n));
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
 * Get a human-readable description of the smoothing window
 */
export function getSmoothingDescription(preference: SmoothingWindow, timeRange: TimeRange): string {
  const effectiveWindow = getEffectiveWindow(preference, timeRange);
  if (effectiveWindow === 0) return 'Raw data';
  return `${effectiveWindow}-day average`;
}

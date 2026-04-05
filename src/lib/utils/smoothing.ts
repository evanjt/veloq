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
export interface SmoothedPoint {
  x: number;
  y: number;
  /** Local weighted standard deviation (for confidence bands) */
  std: number;
}

export function gaussianSmooth(
  xs: number[],
  ys: number[],
  outputCount: number = 200
): SmoothedPoint[] {
  const n = xs.length;
  if (n < 2 || n !== ys.length) return [];
  if (n === 2) {
    const std2 = Math.abs(ys[1] - ys[0]) / 2;
    return [
      { x: xs[0], y: ys[0], std: std2 },
      { x: xs[1], y: ys[1], std: std2 },
    ];
  }

  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const span = xMax - xMin;
  if (span === 0) {
    const meanY = ys.reduce((a, b) => a + b, 0) / n;
    return [{ x: xMin, y: meanY, std: 0 }];
  }

  // Ensure at least 2 output points to avoid division by zero
  const safeOutputCount = Math.max(2, outputCount);

  // Adaptive bandwidth: wider for sparse data, narrower for dense
  const h = span / Math.max(3, Math.sqrt(n));

  const result: SmoothedPoint[] = [];

  for (let i = 0; i < safeOutputCount; i++) {
    const x0 = xMin + (i / (safeOutputCount - 1)) * span;

    // Gaussian weights for all observations — single pass accumulates
    // both regression sums and sum-of-squared-y for variance derivation
    let sumW = 0,
      sumWx = 0,
      sumWy = 0,
      sumWxx = 0,
      sumWxy = 0,
      sumWyy = 0;
    for (let j = 0; j < n; j++) {
      const dx = (xs[j] - x0) / h;
      const w = Math.exp(-0.5 * dx * dx);
      sumW += w;
      sumWx += w * xs[j];
      sumWy += w * ys[j];
      sumWxx += w * xs[j] * xs[j];
      sumWxy += w * xs[j] * ys[j];
      sumWyy += w * ys[j] * ys[j];
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

    // Weighted residual std via algebraic identity: E[(y-y0)²] = E[y²] - 2·y0·E[y] + y0²
    // Avoids a second O(n) loop per output point
    const variance = sumW > 0 ? (sumWyy - 2 * y0 * sumWy + y0 * y0 * sumW) / sumW : 0;
    const std = Math.sqrt(Math.max(0, variance));

    result.push({ x: x0, y: y0, std });
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

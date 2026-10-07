import { type TimeRange } from '@/shared/app/timeRange';

export type SmoothingWindow = 'auto' | 'none' | 3 | 7 | 14 | 21 | 28;

/** Default smoothing windows per time range */
export const DEFAULT_SMOOTHING_WINDOWS: Record<TimeRange, number> = {
  '7d': 0, // No smoothing for 1 week - daily data is meaningful
  '1m': 3, // 3-day average reduces weekday/weekend variance
  '3m': 7, // Weekly average aligns with training weeks
  '6m': 14, // 2-week window for medium-term trends
  '1y': 21, // ~3 weeks captures monthly-ish patterns
};

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** Available smoothing presets for the config UI */
export const SMOOTHING_PRESETS: { value: SmoothingWindow }[] = [
  { value: 'auto' },
  { value: 'none' },
  { value: 3 },
  { value: 7 },
  { value: 14 },
  { value: 21 },
  { value: 28 },
];

/** The label of a preset, in the app's language */
export function getSmoothingPresetLabel(preset: SmoothingWindow, t: Translate): string {
  if (preset === 'auto') return t('wellness.smoothingAuto');
  if (preset === 'none') return t('wellness.smoothingNone');
  return t('wellness.smoothingDaysShort', { days: preset });
}

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
 * The window spans exactly `windowSize` rows: centred for an odd size, and one row further
 * forward than back for an even one, so 7 means ±3 and 14 means 6 back and 7 forward.
 * At edges, averages only the rows that exist.
 *
 * @param data Array of data points with x (index) and value
 * @param windowSize Total window size in rows
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

  const halfWindow = Math.floor(windowSize / 2);
  const firstOffset = -(windowSize - 1 - halfWindow);

  return data.map((point) => {
    let sum = 0;
    let count = 0;

    // Collect values within the window
    for (let offset = firstOffset; offset <= halfWindow; offset++) {
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
 * Get a human-readable description of the smoothing window
 */
export function getSmoothingDescription(
  preference: SmoothingWindow,
  timeRange: TimeRange,
  t: Translate
): string {
  const effectiveWindow = getEffectiveWindow(preference, timeRange);
  if (effectiveWindow === 0) return t('wellness.smoothingRaw');
  return t('wellness.smoothingAverage', { count: effectiveWindow });
}

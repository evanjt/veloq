/**
 * What one wellness trend row states, and where its marker sits.
 *
 * The sparkline draws the smoothed value, the window mean, while the readout is
 * the day's own reading. The scrub dot marks the line, so it sits on the
 * smoothed value at the scrubbed day, and the row names the smoothed value
 * beside the reading wherever the two can differ.
 */

export interface WellnessPoint {
  x: number;
  date: string;
  /** The smoothed value the line is drawn through. */
  value: number;
  /** The day's own reading. */
  rawValue: number;
}

export interface WellnessRowReading {
  x: number;
  date: string;
  /** The day's own reading, the printed figure. */
  value: number;
}

/**
 * The scrubbed day's reading, or at rest the newest one. A scrubbed day the
 * metric was not logged on states none rather than another day's reading.
 */
export function wellnessRowReading(
  points: readonly WellnessPoint[],
  selectedIdx: number | null
): WellnessRowReading | null {
  const point =
    selectedIdx === null ? points[points.length - 1] : points.find((d) => d.x === selectedIdx);
  if (!point) return null;
  return { x: point.x, date: point.date, value: point.rawValue };
}

/** Where the scrub dot sits: on the drawn line at the scrubbed day. */
export interface WellnessRowMarker {
  x: number;
  /** The smoothed value, the line's height at that day. */
  value: number;
}

/**
 * The scrub dot for the scrubbed day, on the smoothed line. At rest, or on a
 * day the metric was not logged on, there is no dot.
 */
export function wellnessRowMarker(
  points: readonly WellnessPoint[],
  selectedIdx: number | null
): WellnessRowMarker | null {
  if (selectedIdx === null) return null;
  const point = points.find((d) => d.x === selectedIdx);
  return point ? { x: point.x, value: point.value } : null;
}

/** The low, high and average of a row's day readings over the period drawn. */
export interface WellnessRowStats {
  low: number;
  high: number;
  average: number;
}

export function wellnessRowStats(points: readonly WellnessPoint[]): WellnessRowStats | null {
  if (points.length === 0) return null;
  let low = Infinity;
  let high = -Infinity;
  let sum = 0;
  for (const d of points) {
    low = Math.min(low, d.rawValue);
    high = Math.max(high, d.rawValue);
    sum += d.rawValue;
  }
  return { low, high, average: sum / points.length };
}

/**
 * The row's vertical scale, padded by 15% each side. It spans the raw readings
 * as well as the smoothed line, so the printed low and high lie inside it.
 */
export function wellnessRowDomain(points: readonly WellnessPoint[]): { min: number; max: number } {
  const values = points.flatMap((d) => [d.value, d.rawValue]);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  return { min: min - range * 0.15, max: max + range * 0.15 };
}

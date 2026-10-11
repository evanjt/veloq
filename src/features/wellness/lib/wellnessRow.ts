/**
 * What one wellness trend row states, and where its marker sits.
 *
 * The sparkline draws the smoothed value, the window mean, while the readout is
 * the day's own reading. The scrub marker used to sit on the smoothed line next
 * to the raw number, so under smoothing the dot and the figure disagreed. A row
 * now has one reading, the day's own, and the dot and the label both read it.
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
  /** The day's own reading: the marker's height and the printed figure. */
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

/**
 * The row's vertical scale, padded by 15% each side. It spans the raw readings
 * as well as the smoothed line, so a marker at a reading never leaves its row.
 */
export function wellnessRowDomain(points: readonly WellnessPoint[]): { min: number; max: number } {
  const values = points.flatMap((d) => [d.value, d.rawValue]);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  return { min: min - range * 0.15, max: max + range * 0.15 };
}

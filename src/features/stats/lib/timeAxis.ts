/**
 * Shared time-axis helpers for date-based charts.
 *
 * Builds a start / middle / end label set from an ordered list of
 * date-bearing points, and says when the day is needed to tell two
 * consecutive labels apart. `formatAxisDate` in `shared/format` draws them.
 */

/**
 * Compute the three key dates for a start/middle/end time axis given a
 * chronologically-ordered list of points.
 *
 * Returns an empty array when there are fewer than 2 points (a single
 * point doesn't warrant an axis).
 */
export function computeTimeAxisLabels<T extends { date: Date }>(points: T[]): Date[] {
  if (points.length < 2) return [];
  const firstDate = points[0].date;
  const lastDate = points[points.length - 1].date;
  const midDate = new Date((firstDate.getTime() + lastDate.getTime()) / 2);
  return [firstDate, midDate, lastDate];
}

/**
 * True when two consecutive axis labels share the same year+month - in
 * which case the axis renderer should include the day portion to keep the
 * labels distinguishable.
 */
export function axisLabelsNeedDay(labels: Date[]): boolean {
  if (labels.length < 2) return false;
  const monthKeys = labels.map((d) => `${d.getFullYear()}-${d.getMonth()}`);
  return monthKeys[0] === monthKeys[1] || monthKeys[1] === monthKeys[2];
}

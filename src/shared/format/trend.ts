/**
 * Whether a number moved, and which way.
 *
 * One primitive and one threshold table, because the same five metrics are
 * drawn on the summary card and again on the widget, and every threshold was
 * written out twice with nothing asserting the two agreed. They matched until
 * the card's baselines were fixed and the widget's were not.
 *
 * The deadband is absolute here. Rust's own verdict is a fraction of the
 * baseline, which is right for a lap time and wrong for a weight in kilograms,
 * so the two primitives stay separate and a verdict computed in Rust crosses
 * as a verdict rather than being recomputed.
 */

/** Which way a number moved, or that it did not move enough to say. */
export type TrendDirection = 'up' | 'down' | 'flat';

/**
 * How much each metric has to move before it reads as a move at all.
 *
 * Both surfaces import this, so a threshold cannot be changed on one and not
 * the other. The units are the metric's own: points of CTL, hours, whole
 * activities, watts, minutes per kilometre, beats, kilograms.
 */
export const TREND_DEADBAND = {
  /** CTL and ATL are integers, so under a point is not a move. */
  fitness: 1,
  fatigue: 1,
  /** Form is a difference of two, so it carries twice the noise. */
  form: 2,
  weekHours: 0.5,
  weekCount: 1,
  ftp: 2,
  thresholdPace: 0.05,
  css: 0.05,
  hrv: 2,
  rhr: 1,
  weight: 0.3,
} as const;

/** A metric with a threshold of its own. */
export type TrendMetric = keyof typeof TREND_DEADBAND;

/**
 * The direction `current` moved from `baseline`, or `flat` when the move is
 * inside the deadband. A missing value on either side reads as flat: nothing
 * to compare is not a move.
 */
export function trendDirection(
  current: number | null | undefined,
  baseline: number | null | undefined,
  deadband: number
): TrendDirection {
  if (current == null || baseline == null) return 'flat';
  if (!Number.isFinite(current) || !Number.isFinite(baseline)) return 'flat';
  const delta = current - baseline;
  if (Math.abs(delta) < deadband) return 'flat';
  return delta > 0 ? 'up' : 'down';
}

/** The same, taking the metric's own threshold. */
export function trendOfMetric(
  metric: TrendMetric,
  current: number | null | undefined,
  baseline: number | null | undefined
): TrendDirection {
  return trendDirection(current, baseline, TREND_DEADBAND[metric]);
}

/** The arrow the summary card and the wellness stats draw. */
export function trendArrow(direction: TrendDirection): '↑' | '↓' | '' {
  if (direction === 'up') return '↑';
  if (direction === 'down') return '↓';
  return '';
}

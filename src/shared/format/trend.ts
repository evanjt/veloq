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
 *
 * The table itself is Rust's, in `veloqrs/src/trend_table.rs`, and
 * `trendTable.generated.ts` is written from it. Editing a threshold here fails
 * `npm run audit`; edit the Rust table and run `npm run config:trend`.
 */

import type { VerdictRung } from '@/theme/colors';

import { TREND_DEADBAND, TREND_POLARITY, type TrendMetric } from './trendTable.generated';

export { TREND_DEADBAND, TREND_POLARITY };
export type { TrendMetric };

/** Which way a number moved, or that it did not move enough to say. */
export type TrendDirection = 'up' | 'down' | 'flat';

/** The judgement a surface draws: not the direction, but whether it was good. */
export type TrendVerdict = 'improved' | 'declined' | 'flat' | 'moved';

/** The glyph a dense surface draws. Flat is a glyph, never an empty string. */
export type TrendGlyph = '↑' | '↓' | '→';

/** The icon an insight card draws, from the same verdict as the glyph. */
export type TrendIcon = 'trending-up' | 'trending-down' | 'minus';

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

/**
 * The arrow for a direction. This is the number's own direction, which is what
 * a chart axis and a metric with no polarity want; a judged surface draws
 * `trendGlyph`.
 */
export function trendArrow(direction: TrendDirection): TrendGlyph {
  if (direction === 'up') return '↑';
  if (direction === 'down') return '↓';
  return '→';
}

/** The judgement for a metric's move, read off the polarity table. */
export function trendVerdict(metric: TrendMetric, direction: TrendDirection): TrendVerdict {
  if (direction === 'flat') return 'flat';
  const polarity = TREND_POLARITY[metric];
  if (polarity === 'none') return 'moved';
  const improved = polarity === 'higher' ? direction === 'up' : direction === 'down';
  return improved ? 'improved' : 'declined';
}

/**
 * The glyph a surface draws for a metric's move: up for an improvement even
 * when the number fell, the bare direction for a metric with no polarity, and
 * always something for flat.
 */
export function trendGlyph(metric: TrendMetric, direction: TrendDirection): TrendGlyph {
  const verdict = trendVerdict(metric, direction);
  if (verdict === 'improved') return '↑';
  if (verdict === 'declined') return '↓';
  return trendArrow(direction);
}

/** The same choice as `trendGlyph`, in the icon vocabulary the insight cards use. */
export function trendIcon(metric: TrendMetric, direction: TrendDirection): TrendIcon {
  return verdictIcon(trendVerdict(metric, direction), direction);
}

/**
 * The icon for a move already judged, for a surface that carries the verdict
 * rather than the metric: up for an improvement even when the number fell,
 * the bare direction for a move with no judgement.
 */
export function verdictIcon(verdict: TrendVerdict, direction: TrendDirection): TrendIcon {
  if (verdict === 'improved') return 'trending-up';
  if (verdict === 'declined') return 'trending-down';
  if (direction === 'up') return 'trending-up';
  if (direction === 'down') return 'trending-down';
  return 'minus';
}

/** The ladder rung a verdict is coloured from, so no caller writes its own mapping. */
export function verdictRung(verdict: TrendVerdict): VerdictRung {
  if (verdict === 'improved') return 'positive';
  if (verdict === 'declined') return 'negative';
  return 'neutral';
}

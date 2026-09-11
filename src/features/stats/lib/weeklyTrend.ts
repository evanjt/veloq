import {
  trendGlyph,
  trendOfMetric,
  trendVerdict,
  verdictRung,
  type TrendGlyph,
  type TrendMetric,
} from '@/shared/format/trend';
import type { VerdictRung } from '@/theme/colors';

/** The four numbers the weekly summary compares against the period before. */
export type WeeklyStat = 'count' | 'duration' | 'distance' | 'tss';

/** What the summary draws beside a number, or null when there is nothing to compare. */
export interface WeeklyTrendCell {
  glyph: TrendGlyph;
  rung: VerdictRung;
  /** The size of the move, absent for a flat one. */
  pct: string | null;
}

const METRIC: Record<WeeklyStat, TrendMetric> = {
  count: 'weekCount',
  duration: 'weekHours',
  distance: 'weekDistance',
  tss: 'weekTss',
};

/** Raw units into the table's: seconds to hours, metres to kilometres. */
const PER_UNIT: Record<WeeklyStat, number> = {
  count: 1,
  duration: 3600,
  distance: 1000,
  tss: 1,
};

/**
 * The glyph, its rung and the percentage for one stat against the previous
 * period. The deadband and the polarity both come from the trend tables, so
 * the component holds no judgement of its own, and a period with nothing
 * before it draws nothing rather than a move from zero.
 */
export function weeklyTrend(
  stat: WeeklyStat,
  current: number,
  previous: number
): WeeklyTrendCell | null {
  if (previous <= 0) return null;
  const metric = METRIC[stat];
  const direction = trendOfMetric(metric, current / PER_UNIT[stat], previous / PER_UNIT[stat]);
  const pct = Math.round(Math.abs(((current - previous) / previous) * 100));
  return {
    glyph: trendGlyph(metric, direction),
    rung: verdictRung(trendVerdict(metric, direction)),
    pct: direction === 'flat' ? null : `${pct}%`,
  };
}

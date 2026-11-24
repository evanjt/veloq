import { trendVerdict, verdictRung, type TrendMetric } from '@/shared/format/trend';
import type { VerdictRung } from '@/theme/colors';
import { formatSignedPercentage } from '@/shared/format';

/** What the season card compares, and the trend metric whose polarity judges it. */
const SEASON_METRIC: Record<'hours' | 'distance' | 'tss', TrendMetric> = {
  hours: 'weekHours',
  distance: 'weekDistance',
  tss: 'weekTss',
};

/**
 * A season percentage as the card prints it, and the rung it is drawn on. The
 * move is the printed whole percentage, so a change that rounds to nothing is
 * '0%' on the neutral rung rather than a green '+0%' or a red '-0%', and the
 * metric's polarity decides the rung, so load moves with no judgement.
 */
export function seasonChange(
  metric: 'hours' | 'distance' | 'tss',
  pct: number
): { text: string; rung: VerdictRung } {
  const whole = Math.round(Math.abs(pct)) * Math.sign(pct);
  const text = formatSignedPercentage(pct, 0);
  if (whole === 0) return { text, rung: 'neutral' };
  const direction = whole > 0 ? 'up' : 'down';
  return {
    text,
    rung: verdictRung(trendVerdict(SEASON_METRIC[metric], direction)),
  };
}

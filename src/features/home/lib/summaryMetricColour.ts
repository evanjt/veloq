import { colors, darkColors } from '@/theme';
import { SPORT_TEXT_COLORS, SPORT_TEXT_COLORS_DARK } from '@/features/fitness';

/** The summary card values drawn in a hue of their own rather than the body ink. */
export const SUMMARY_HUED_METRICS = ['fitness', 'hrv', 'ftp', 'thresholdPace', 'css'] as const;

export type SummaryHuedMetric = (typeof SUMMARY_HUED_METRICS)[number];

/**
 * The colour a summary card value is set in. A headline number is text, so it
 * takes the text variant of its series or sport hue for the theme the card is
 * drawn in: the fills themselves sit between 2.18:1 and 3.31:1 on the light card.
 * The sparkline's scrub readout reads the same variants, so a value keeps its
 * colour whether or not the sparkline is shown.
 */
export function summaryMetricTextColor(metric: SummaryHuedMetric, isDark: boolean): string {
  const palette = isDark ? darkColors : colors;
  const sport = isDark ? SPORT_TEXT_COLORS_DARK : SPORT_TEXT_COLORS;
  const byMetric: Record<SummaryHuedMetric, string> = {
    fitness: palette.fitnessBlueText,
    hrv: palette.chartHrvText,
    ftp: sport.Cycling,
    thresholdPace: sport.Running,
    css: sport.Swimming,
  };
  return byMetric[metric];
}

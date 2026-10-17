import { colors, darkColors } from '@/theme';
import { FORM_ZONE_MARK_COLORS, type FormZone } from '@/features/fitness';

/** The series the summary card's sparklines draw, each keyed by a dot beside its value. */
export type SummarySeries = 'fitness' | 'fatigue' | 'hrv' | 'rhr';

/**
 * The colour a summary card series is drawn in: its sparkline line and the key
 * dot beside its value. Text is never set in it; the value beside the dot is
 * the theme's primary text.
 */
export function summarySeriesColor(series: SummarySeries, isDark: boolean): string {
  const palette = isDark ? darkColors : colors;
  const bySeries: Record<SummarySeries, string> = {
    fitness: colors.fitnessBlue,
    fatigue: colors.chartPink,
    hrv: palette.chartHrv,
    rhr: palette.chartRhr,
  };
  return bySeries[series];
}

/** The key dot beside a form value: its zone's mark, the colour the zone bar draws it in. */
export function summaryFormZoneColor(zone: FormZone): string {
  return FORM_ZONE_MARK_COLORS[zone];
}

import { i18n } from '@/i18n';
import type { WellnessData } from '@/types';
import { colors } from '@/theme/colors';
import { tsbFromLoads } from '@/shared/math';

/**
 * Calculate TSB (Form) per day from wellness data, for chart rendering.
 * Handles both field name variants (ctl/atl and ctlLoad/atlLoad). A day missing
 * either load renders as 0 rather than a distorted -atl.
 */
export function calculateTSB(wellness: WellnessData[]): (WellnessData & { tsb: number })[] {
  return wellness.map((day) => ({
    ...day,
    tsb: tsbFromLoads(day.ctl ?? day.ctlLoad, day.atl ?? day.atlLoad) ?? 0,
  }));
}

/**
 * Form zones based on TSB (Training Stress Balance) - intervals.icu boundaries:
 *
 * - highRisk (TSB < -30): Significant accumulated fatigue
 * - optimal (-30 to -10): Where most adaptation occurs
 * - greyZone (-10 to 5): Moderate training load
 * - fresh (5 to 25): Well-rested, fitness exceeds fatigue
 * - transition (> 25): Losing fitness from insufficient stimulus
 */
export type FormZone = 'highRisk' | 'optimal' | 'greyZone' | 'fresh' | 'transition';

/**
 * The band a form number falls in, on the denominator the athlete chose.
 *
 * `icu_form_as_percent` decides what form means: absolute TSB, or TSB as a
 * share of fitness. The thresholds are the same either way, applied to
 * whichever number the athlete reads. A percentage needs a denominator, so an
 * athlete with no fitness yet, a sport with no load, or any day before the
 * first activity falls back to the absolute band: that is what the number
 * means when there is no fitness to be a percentage of.
 */
export function getFormZone(tsb: number, fitness?: number | null, asPercent?: boolean): FormZone {
  const value = asPercent && fitness ? (tsb / fitness) * 100 : tsb;
  if (value < -30) return 'highRisk';
  if (value < -10) return 'optimal';
  if (value < 5) return 'greyZone';
  if (value < 25) return 'fresh';
  return 'transition';
}

export const FORM_ZONE_COLORS: Record<FormZone, string> = {
  highRisk: colors.formHighRisk,
  optimal: colors.formOptimal,
  greyZone: colors.formGreyZone,
  fresh: colors.formFresh,
  transition: colors.formTransition,
};

/**
 * The zone's name in the athlete's language. The widget already read these
 * keys while the screens read an English map beside them, so one device drew
 * the same zone under two names.
 */
export function formZoneLabel(zone: FormZone): string {
  return i18n.t(`formZones.${zone}`);
}

/**
 * Zone boundaries (TSB values) for chart rendering
 */
export const FORM_ZONE_BOUNDARIES: Record<FormZone, { min: number; max: number }> = {
  transition: { min: 25, max: 50 },
  fresh: { min: 5, max: 25 },
  greyZone: { min: -10, max: 5 },
  optimal: { min: -30, max: -10 },
  highRisk: { min: -50, max: -30 },
};

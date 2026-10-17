import { i18n } from '@/i18n';
import type { WellnessData } from '@/types';
import { colors, darkColors } from '@/theme/colors';
import { formFromLoads } from '@/shared/math';
import { sortByDateId } from '@/shared/activity/activityUtils';

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
 * whichever number the athlete reads. A percentage needs a denominator, so a
 * day with no fitness has no form value under that setting and no zone: null,
 * not the absolute band.
 */
export function getFormZone(
  tsb: number,
  fitness?: number | null,
  asPercent?: boolean
): FormZone | null {
  if (asPercent && !fitness) return null;
  const value = asPercent && fitness ? (tsb / fitness) * 100 : tsb;
  if (value < -30) return 'highRisk';
  if (value < -10) return 'optimal';
  if (value < 5) return 'greyZone';
  if (value < 25) return 'fresh';
  return 'transition';
}

/**
 * The band for one day's loads, judged on the form the app prints: rounded
 * fitness minus rounded fatigue, against rounded fitness under the percentage
 * setting. Zoning the unrounded difference can name the band across a
 * boundary from the number shown beside it.
 */
export function formZoneFromLoads(
  ctl?: number | null,
  atl?: number | null,
  asPercent?: boolean
): FormZone | null {
  const fitness = Number.isFinite(ctl as number) ? Math.round(ctl as number) : 0;
  return getFormZone(formFromLoads(ctl, atl), fitness, asPercent);
}

/**
 * A form number as the athlete reads it, on the denominator getFormZone zones
 * it by: the integer percentage of fitness with a % suffix under the
 * percentage setting, the signed absolute TSB otherwise. A day with no fitness
 * has no percentage, so it prints nothing (null) rather than the absolute
 * number beside a zone from another denominator.
 */
export function formatForm(
  tsb: number,
  fitness?: number | null,
  asPercent?: boolean
): string | null {
  if (asPercent) {
    if (!fitness) return null;
    return `${signed(Math.round((tsb / fitness) * 100))}%`;
  }
  return signed(Math.round(tsb));
}

function signed(n: number): string {
  const v = n === 0 ? 0 : n;
  return v > 0 ? `+${v}` : String(v);
}

export interface FormChartPoint {
  x: number;
  date: string;
  /** Null on a day with no fitness under the percentage setting: a gap, not a dropped day. */
  form: number | null;
  /** Absolute TSB whatever the setting, for a header that prints it. */
  tsb: number;
  fitness: number;
  fatigue: number;
}

/**
 * One point per day, oldest first, with form in the unit the athlete chose.
 * The percentage keeps full precision: rounding happens only when it is printed,
 * so a zone never depends on the display digits.
 * The zone thresholds apply to whichever unit is plotted, so the bands stay
 * horizontal under either setting.
 */
export function formChartSeries(data: WellnessData[], asPercent: boolean): FormChartPoint[] {
  return sortByDateId(data).map((day, idx) => {
    const fitness = Math.round(day.ctl ?? 0);
    const fatigue = Math.round(day.atl ?? 0);
    const tsb = formFromLoads(day.ctl, day.atl);
    const form = asPercent ? (fitness ? (tsb / fitness) * 100 : null) : tsb;
    return { x: idx, date: day.id, form, tsb, fitness, fatigue };
  });
}

/**
 * The zones on the diverging ramp, fresh on the cool arm and high risk on the
 * warm one around a grey midpoint: the chart bands, the sparkline runs, the
 * form bar and the dot keying a zone to its name. Each step holds 3:1 on every
 * surface of its own theme, so the fill is also the mark.
 */
export const FORM_ZONE_COLORS: Record<FormZone, string> = {
  highRisk: colors.formHighRisk,
  optimal: colors.formOptimal,
  greyZone: colors.formGreyZone,
  fresh: colors.formFresh,
  transition: colors.formTransition,
};

export const FORM_ZONE_COLORS_DARK: Record<FormZone, string> = {
  highRisk: darkColors.formHighRisk,
  optimal: darkColors.formOptimal,
  greyZone: darkColors.formGreyZone,
  fresh: darkColors.formFresh,
  transition: darkColors.formTransition,
};

/** The zone's colour for the scheme on screen. */
export function formZoneColor(zone: FormZone, isDark: boolean): string {
  return isDark ? FORM_ZONE_COLORS_DARK[zone] : FORM_ZONE_COLORS[zone];
}

/**
 * Text: the form number, the zone name and any word coloured by zone. The fills
 * run from 1.8:1 to 3.1:1 on white, and a zone label beside the number does not
 * exempt it: 1.4.11 covers a graphic whose information is carried another way,
 * text is held to 4.5:1 regardless.
 */
export const FORM_ZONE_TEXT_COLORS: Record<FormZone, string> = {
  highRisk: colors.formHighRiskText,
  optimal: colors.formOptimalText,
  greyZone: colors.formGreyZoneText,
  fresh: colors.formFreshText,
  transition: colors.formTransitionText,
};

export const FORM_ZONE_TEXT_COLORS_DARK: Record<FormZone, string> = {
  highRisk: darkColors.formHighRiskText,
  optimal: darkColors.formOptimalText,
  greyZone: darkColors.formGreyZoneText,
  fresh: darkColors.formFreshText,
  transition: darkColors.formTransitionText,
};

/** The zone's text colour for the scheme on screen. */
export function formZoneTextColor(zone: FormZone, isDark: boolean): string {
  return isDark ? FORM_ZONE_TEXT_COLORS_DARK[zone] : FORM_ZONE_TEXT_COLORS[zone];
}

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

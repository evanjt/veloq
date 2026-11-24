import { i18n } from '@/i18n';
import type { FormZone, WellnessData } from '@/types';
import { colors, colorWithOpacity, darkColors, opacity } from '@/theme/colors';
import { sortByDateId } from '@/shared/activity/activityUtils';

export type { FormZone } from '@/types';

export interface FormChartPoint {
  x: number;
  date: string;
  /** The day's form in the athlete's unit; null on a day the engine could not state one. */
  form: number | null;
  /** The zone the engine judged `form` to be in, null with it. */
  zone: FormZone | null;
  /** `form` as the engine prints it, null with it. */
  text: string | null;
  fitness: number;
  fatigue: number;
}

/**
 * One point per day, oldest first, with the form, zone and text the engine
 * stated for that day. The value keeps full precision under the percentage
 * setting: rounding is the engine's text, so a zone never depends on display
 * digits. A day the engine states no form for is a gap, not a dropped day.
 */
export function formChartSeries(data: WellnessData[]): FormChartPoint[] {
  return sortByDateId(data).map((day, idx) => ({
    x: idx,
    date: day.id,
    form: day.form ?? null,
    zone: day.formZone ?? null,
    text: day.formText ?? null,
    fitness: Math.round(day.ctl ?? 0),
    fatigue: Math.round(day.atl ?? 0),
  }));
}

/** How far past the outer zone edges the form chart's bands reach, in its own units. */
const OUTER_BAND_REACH = 25;

/**
 * The band behind each zone from the engine's edges, lowest first: each zone
 * spans from its lower edge to its upper one, the lowest and highest running
 * a fixed reach beyond the outer edges so the chart has room to draw them.
 * Empty before the engine has stated the edges.
 */
export function formZoneBands(
  edges: readonly number[]
): Partial<Record<FormZone, { min: number; max: number }>> {
  const [highRisk, optimal, greyZone, fresh] = edges;
  if (
    highRisk === undefined ||
    optimal === undefined ||
    greyZone === undefined ||
    fresh === undefined
  ) {
    return {};
  }
  return {
    highRisk: { min: highRisk - OUTER_BAND_REACH, max: highRisk },
    optimal: { min: highRisk, max: optimal },
    greyZone: { min: optimal, max: greyZone },
    fresh: { min: greyZone, max: fresh },
    transition: { min: fresh, max: fresh + OUTER_BAND_REACH },
  };
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
 * A zone's band behind the form line: its colour washed at the second tint
 * step on light and the third on dark, where the same alpha reads fainter.
 */
export function formZoneBandColor(zone: FormZone, isDark: boolean): string {
  return colorWithOpacity(formZoneColor(zone, isDark), isDark ? opacity.tint3 : opacity.tint2);
}

/**
 * The zone's name in the athlete's language. The widget already read these
 * keys while the screens read an English map beside them, so one device drew
 * the same zone under two names.
 */
export function formZoneLabel(zone: FormZone): string {
  return i18n.t(`formZones.${zone}`);
}

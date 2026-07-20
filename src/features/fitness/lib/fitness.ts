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

export function getFormZone(tsb: number): FormZone {
  if (tsb < -30) return 'highRisk';
  if (tsb < -10) return 'optimal';
  if (tsb < 5) return 'greyZone';
  if (tsb < 25) return 'fresh';
  return 'transition';
}

export const FORM_ZONE_COLORS: Record<FormZone, string> = {
  highRisk: colors.formHighRisk,
  optimal: colors.formOptimal,
  greyZone: colors.formGreyZone,
  fresh: colors.formFresh,
  transition: colors.formTransition,
};

/** Line/marker colour for a TSB value (the solid FORM_ZONE_COLORS swatch). */
export function getFormZoneColor(tsb: number): string {
  return FORM_ZONE_COLORS[getFormZone(tsb)];
}

/**
 * Fill RGB per zone for translucent chart backgrounds. `optimal` deliberately
 * uses a deeper green than FORM_ZONE_COLORS so it stays legible under opacity.
 */
const FORM_ZONE_FILL_RGB: Record<FormZone, readonly [number, number, number]> = {
  highRisk: [239, 83, 80],
  optimal: [76, 175, 80],
  greyZone: [158, 158, 158],
  fresh: [129, 199, 132],
  transition: [100, 181, 246],
};

/** Translucent band fill for a zone; opacity is per-chart (denser for small charts). */
export function formZoneFill(zone: FormZone, opacity: number): string {
  const [r, g, b] = FORM_ZONE_FILL_RGB[zone];
  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}

export const FORM_ZONE_LABELS: Record<FormZone, string> = {
  highRisk: 'High Risk',
  optimal: 'Optimal',
  greyZone: 'Grey Zone',
  fresh: 'Fresh',
  transition: 'Transition',
};

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

/** i18n keys for contextual guidance per form zone */
export const FORM_ZONE_GUIDANCE_KEYS: Record<FormZone, string> = {
  highRisk: 'fitnessScreen.guidance.highRisk',
  optimal: 'fitnessScreen.guidance.optimal',
  greyZone: 'fitnessScreen.guidance.greyZone',
  fresh: 'fitnessScreen.guidance.fresh',
  transition: 'fitnessScreen.guidance.transition',
};

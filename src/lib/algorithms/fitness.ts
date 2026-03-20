import type { WellnessData } from '@/types';

/**
 * Calculate TSB (Training Stress Balance / Form) from wellness data.
 * TSB = CTL - ATL (Fitness minus Fatigue)
 *
 * Handles both field name variants from intervals.icu API:
 * - ctl/atl (preferred)
 * - ctlLoad/atlLoad (alternative)
 */
export function calculateTSB(wellness: WellnessData[]): (WellnessData & { tsb: number })[] {
  return wellness.map((day) => {
    const ctl = day.ctl ?? day.ctlLoad ?? 0;
    const atl = day.atl ?? day.atlLoad ?? 0;
    return {
      ...day,
      tsb: ctl - atl,
    };
  });
}

/**
 * Form zones based on TSB (Training Stress Balance) — intervals.icu boundaries:
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
  highRisk: '#EF5350', // Red (matches intervals.icu)
  optimal: '#66BB6A', // Green (matches intervals.icu)
  greyZone: '#9E9E9E', // Grey (matches intervals.icu)
  fresh: '#81C784', // Light green (matches intervals.icu)
  transition: '#64B5F6', // Light blue (matches intervals.icu)
};

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

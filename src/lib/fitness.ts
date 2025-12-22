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
 * Form zones based on TSB (Training Stress Balance):
 *
 * - highRisk (TSB < -30): Overtrained, high injury/illness risk
 * - optimal (-30 to -10): Productive training, building fitness
 * - grey (-10 to 5): Maintenance zone, unclear benefit
 * - fresh (5 to 25): Recovered, good for racing/testing
 * - transition (> 25): Detraining, losing fitness
 */
export type FormZone = 'highRisk' | 'optimal' | 'grey' | 'fresh' | 'transition';

export function getFormZone(tsb: number): FormZone {
  if (tsb < -30) return 'highRisk';
  if (tsb < -10) return 'optimal';
  if (tsb < 5) return 'grey';
  if (tsb < 25) return 'fresh';
  return 'transition';
}

export const FORM_ZONE_COLORS: Record<FormZone, string> = {
  highRisk: '#EF5350', // Red
  optimal: '#66BB6A', // Green
  grey: '#9E9E9E', // Grey
  fresh: '#42A5F5', // Blue
  transition: '#AB47BC', // Purple
};

export const FORM_ZONE_LABELS: Record<FormZone, string> = {
  highRisk: 'High Risk',
  optimal: 'Optimal',
  grey: 'Grey Zone',
  fresh: 'Fresh',
  transition: 'Transition',
};

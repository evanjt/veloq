import {
  formatPaceCompact,
  formatSwimPace,
  paceUnitLabel,
  swimPaceUnitLabel,
} from '@/shared/format';
import type { ClimbBest } from '@/features/stats';
import { M_TO_FT } from '@/shared/format/format';
import type { PrimarySport } from '../stores/SportPreferenceStore';

// Power for cycling, pace per km or mile for running, pace per 100 m or 100 yd for swimming.
export function formatEffortValue(
  value: number | null,
  sport: PrimarySport,
  wattsUnit: string,
  isMetric: boolean
): string {
  if (value === null || !Number.isFinite(value)) return '-';

  if (sport === 'Cycling') {
    return `${Math.round(value)} ${wattsUnit}`;
  }
  if (sport === 'Running') {
    return `${formatPaceCompact(value, isMetric)}${paceUnitLabel(isMetric)}`;
  }
  if (sport === 'Swimming') {
    return `${formatSwimPace(value, isMetric)}${swimPaceUnitLabel(isMetric)}`;
  }
  return '-';
}

/** Windows from this length up are read as climbing rate, shorter ones as vertical power. */
export const VAM_FROM_WINDOW_S = 300;

export interface ClimbUnits {
  wattsPerKg: string;
  metresPerHour: string;
  feetPerHour: string;
}

// Vertical power per kilogram for a short window, vertical metres or feet per hour for a long one.
export function formatClimbValue(best: ClimbBest, isMetric: boolean, units: ClimbUnits): string {
  if (best.windowS < VAM_FROM_WINDOW_S) {
    if (best.wattsPerKg === null || !Number.isFinite(best.wattsPerKg)) return '-';
    return `${best.wattsPerKg.toFixed(2)} ${units.wattsPerKg}`;
  }
  if (best.vam === null || !Number.isFinite(best.vam)) return '-';
  return isMetric
    ? `${Math.round(best.vam)} ${units.metresPerHour}`
    : `${Math.round(best.vam * M_TO_FT)} ${units.feetPerHour}`;
}

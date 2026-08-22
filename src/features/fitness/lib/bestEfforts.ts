import { formatDuration, formatPaceCompact, formatSwimPace } from '@/shared/format';
import type { PrimarySport } from '../stores/SportPreferenceStore';

// Power for cycling, pace per km for running, pace per 100m for swimming.
export function formatEffortValue(value: number | null, sport: PrimarySport): string {
  if (value === null || !Number.isFinite(value)) return '-';

  if (sport === 'Cycling') {
    return `${Math.round(value)}w`;
  }
  if (sport === 'Running') {
    return `${formatPaceCompact(value)}/km`;
  }
  if (sport === 'Swimming') {
    return `${formatSwimPace(value)}/100m`;
  }
  return '-';
}

export function formatEffortTime(time: number | null): string | null {
  if (time === null || !Number.isFinite(time)) return null;
  return formatDuration(time);
}

import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { intervalsApi } from '@/api';
import type { PowerCurve } from '@/types';

interface UsePowerCurveOptions {
  sport?: string;
  /** Number of days to include (default 365) */
  days?: number;
  enabled?: boolean;
}

export function usePowerCurve(options: UsePowerCurveOptions = {}) {
  const { sport = 'Ride', days = 365, enabled = true } = options;

  return useQuery<PowerCurve>({
    queryKey: ['powerCurve', sport, days],
    queryFn: () => intervalsApi.getPowerCurve({ sport, days }),
    enabled,
    staleTime: 1000 * 60 * 5, // 5 minutes
    retry: 1, // Only retry once on failure
    placeholderData: keepPreviousData, // Keep previous data visible while fetching new range
  });
}

// Standard durations for power curve display (in seconds)
export const POWER_CURVE_DURATIONS = [
  { secs: 5, label: '5s' },
  { secs: 15, label: '15s' },
  { secs: 30, label: '30s' },
  { secs: 60, label: '1m' },
  { secs: 120, label: '2m' },
  { secs: 300, label: '5m' },
  { secs: 600, label: '10m' },
  { secs: 1200, label: '20m' },
  { secs: 1800, label: '30m' },
  { secs: 3600, label: '1h' },
  { secs: 7200, label: '2h' },
];

// Get power at a specific duration from the curve
export function getPowerAtDuration(curve: PowerCurve | undefined, secs: number): number | null {
  if (!curve?.secs || !curve?.watts) return null;

  const index = curve.secs.findIndex(s => s === secs);
  if (index !== -1) return curve.watts[index];

  // Find closest duration
  let closestIndex = 0;
  let closestDiff = Math.abs(curve.secs[0] - secs);
  for (let i = 1; i < curve.secs.length; i++) {
    const diff = Math.abs(curve.secs[i] - secs);
    if (diff < closestDiff) {
      closestDiff = diff;
      closestIndex = i;
    }
  }
  return curve.watts[closestIndex];
}

// Format power curve data for chart display
export function formatPowerCurveForChart(curve: PowerCurve | undefined) {
  if (!curve?.secs || !curve?.watts) return [];

  return POWER_CURVE_DURATIONS
    .map(({ secs, label }) => {
      const power = getPowerAtDuration(curve, secs);
      return power !== null ? { secs, label, power } : null;
    })
    .filter((d): d is { secs: number; label: string; power: number } => d !== null);
}

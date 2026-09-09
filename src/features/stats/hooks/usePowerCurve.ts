import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { getEngine } from '@/shared/native/engine';
import { useEngineBody } from '@/shared/native/engineBodies';
import { parsePowerCurveBody } from '@/features/stats/lib/curveBodies';
import { queryKeys } from '@/shared/query/queryKeys';
import type { PowerCurve } from '@/types';

interface UsePowerCurveOptions {
  sport?: string;
  /** Number of days to include (default 365) */
  days?: number;
  enabled?: boolean;
}

export function usePowerCurve(options: UsePowerCurveOptions = {}) {
  const { sport = 'Ride', days = 365, enabled = true } = options;
  const queryKey = queryKeys.charts.powerCurve.bySport(sport, days);

  // The query is the only reader of the stored body. `null` is "never
  // fetched", which is the cue to ask Rust for it; the empty curve is what the
  // chart draws in the meantime.
  const query = useQuery<PowerCurve | null>({
    queryKey,
    queryFn: () => {
      const stored = getEngine()?.getPowerCurveBody(sport, days);
      return stored ? parsePowerCurveBody(stored, sport) : null;
    },
    enabled,
    // SQLite is the source, so a sync decides freshness, not a clock.
    staleTime: Infinity,
    placeholderData: keepPreviousData, // Keep previous data visible while fetching new range
  });
  useEngineBody(
    query.data !== null,
    () => getEngine()?.syncPowerCurve(sport, days),
    queryKey,
    enabled && query.data !== undefined
  );

  return { ...query, data: query.data ?? emptyPowerCurve(sport) };
}

/** Rendered as "no data yet" rather than an error while the fetch is in flight. */
function emptyPowerCurve(sport: string): PowerCurve {
  return { type: 'power', sport, secs: [], watts: [] };
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

  const index = curve.secs.findIndex((s) => s === secs);
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

// Get the array index for a given duration (exact or closest match)
export function getIndexAtDuration(curve: PowerCurve | undefined, secs: number): number | null {
  if (!curve?.secs || curve.secs.length === 0) return null;

  const exactIndex = curve.secs.findIndex((s) => s === secs);
  if (exactIndex !== -1) return exactIndex;

  let closestIndex = 0;
  let closestDiff = Math.abs(curve.secs[0] - secs);
  for (let i = 1; i < curve.secs.length; i++) {
    const diff = Math.abs(curve.secs[i] - secs);
    if (diff < closestDiff) {
      closestDiff = diff;
      closestIndex = i;
    }
  }
  return closestIndex;
}

// Format power curve data for chart display
export function formatPowerCurveForChart(curve: PowerCurve | undefined) {
  if (!curve?.secs || !curve?.watts) return [];

  return POWER_CURVE_DURATIONS.map(({ secs, label }) => {
    const power = getPowerAtDuration(curve, secs);
    return power !== null ? { secs, label, power } : null;
  }).filter((d): d is { secs: number; label: string; power: number } => d !== null);
}

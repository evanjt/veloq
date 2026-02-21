import { useEffect, useRef } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { intervalsApi } from '@/api';
import { getRouteEngine } from '@/lib/native/routeEngine';
import type { PaceCurve } from '@/types';

interface UsePaceCurveOptions {
  sport?: string;
  /** Number of days to include (default 42 to match intervals.icu) */
  days?: number;
  /** Use gradient adjusted pace (running only) */
  gap?: boolean;
  enabled?: boolean;
}

export function usePaceCurve(options: UsePaceCurveOptions = {}) {
  const { sport = 'Run', days = 42, gap = false, enabled = true } = options;

  const result = useQuery<PaceCurve>({
    queryKey: ['paceCurve', sport, days, gap],
    queryFn: () => intervalsApi.getPaceCurve({ sport, days, gap }),
    enabled,
    staleTime: 1000 * 60 * 15, // 15 minutes - curves change infrequently
    retry: 1,
    placeholderData: keepPreviousData,
  });

  // Snapshot critical speed for trend tracking (idempotent: INSERT OR REPLACE by date+sport)
  const lastSnapshotted = useRef<string | null>(null);
  useEffect(() => {
    const cs = result.data?.criticalSpeed;
    if (cs == null || cs <= 0) return;
    const key = `${sport}:${cs}`;
    if (lastSnapshotted.current === key) return;
    lastSnapshotted.current = key;
    const engine = getRouteEngine();
    if (!engine) return;
    const todayTs = Math.floor(new Date().setHours(0, 0, 0, 0) / 1000);
    engine.savePaceSnapshot(sport, cs, result.data?.dPrime, result.data?.r2, todayTs);
  }, [result.data?.criticalSpeed, sport, result.data?.dPrime, result.data?.r2]);

  return result;
}

// Standard distances for running pace curve (in meters)
export const PACE_CURVE_DISTANCES = [
  { meters: 400, label: '400m' },
  { meters: 800, label: '800m' },
  { meters: 1000, label: '1K' },
  { meters: 1609.34, label: 'Mile' },
  { meters: 3000, label: '3K' },
  { meters: 5000, label: '5K' },
  { meters: 10000, label: '10K' },
  { meters: 21097.5, label: 'Half' },
];

// Standard distances for swimming pace curve (in meters)
export const SWIM_PACE_CURVE_DISTANCES = [
  { meters: 100, label: '100m' },
  { meters: 200, label: '200m' },
  { meters: 400, label: '400m' },
  { meters: 800, label: '800m' },
  { meters: 1500, label: '1500m' },
  { meters: 3800, label: '3.8K' },
];

/**
 * Get pace at a specific distance
 * @param curve - The pace curve data
 * @param targetDistance - Target distance in meters
 * @returns Pace in m/s at that distance, or null if not found
 */
export function getPaceAtDistance(
  curve: PaceCurve | undefined,
  targetDistance: number
): number | null {
  if (!curve?.distances || !curve?.pace || curve.distances.length === 0) return null;

  // Find exact match first
  const exactIndex = curve.distances.findIndex((d) => Math.abs(d - targetDistance) < 1);
  if (exactIndex !== -1 && curve.pace[exactIndex]) return curve.pace[exactIndex];

  // Find closest distance
  let closestIndex = 0;
  let closestDiff = Math.abs(curve.distances[0] - targetDistance);
  for (let i = 1; i < curve.distances.length; i++) {
    const diff = Math.abs(curve.distances[i] - targetDistance);
    if (diff < closestDiff) {
      closestDiff = diff;
      closestIndex = i;
    }
  }
  return curve.pace[closestIndex] || null;
}

/**
 * Get the array index for a given distance (exact or closest match)
 */
export function getIndexAtDistance(
  curve: PaceCurve | undefined,
  targetDistance: number
): number | null {
  if (!curve?.distances || curve.distances.length === 0) return null;

  const exactIndex = curve.distances.findIndex((d) => Math.abs(d - targetDistance) < 1);
  if (exactIndex !== -1) return exactIndex;

  let closestIndex = 0;
  let closestDiff = Math.abs(curve.distances[0] - targetDistance);
  for (let i = 1; i < curve.distances.length; i++) {
    const diff = Math.abs(curve.distances[i] - targetDistance);
    if (diff < closestDiff) {
      closestDiff = diff;
      closestIndex = i;
    }
  }
  return closestIndex;
}

/**
 * Get the time in seconds to cover a given distance
 */
export function getTimeAtDistance(
  curve: PaceCurve | undefined,
  targetDistance: number
): number | null {
  if (!curve?.distances || !curve?.times) return null;

  const index = getIndexAtDistance(curve, targetDistance);
  if (index === null) return null;
  return curve.times[index] ?? null;
}

/**
 * Convert m/s to min:sec per km (for display)
 */
export function paceToMinPerKm(metersPerSecond: number): {
  minutes: number;
  seconds: number;
} {
  if (metersPerSecond <= 0) return { minutes: 0, seconds: 0 };
  const secondsPerKm = 1000 / metersPerSecond;
  const minutes = Math.floor(secondsPerKm / 60);
  const seconds = Math.round(secondsPerKm % 60);
  return { minutes, seconds };
}

/**
 * Convert m/s to min:sec per 100m (for swimming)
 */
export function paceToMinPer100m(metersPerSecond: number): {
  minutes: number;
  seconds: number;
} {
  if (metersPerSecond <= 0) return { minutes: 0, seconds: 0 };
  const secondsPer100m = 100 / metersPerSecond;
  const minutes = Math.floor(secondsPer100m / 60);
  const seconds = Math.round(secondsPer100m % 60);
  return { minutes, seconds };
}

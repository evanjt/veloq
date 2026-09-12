import { useEffect, useRef } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { getEngine } from '@/shared/native/engine';
import { useEngineBody } from '@/shared/native/engineBodies';
import { parsePaceCurveBody } from '@/features/stats/lib/curveBodies';
import { paceSnapshotDate } from '@/features/stats/lib/paceSnapshot';
import { queryKeys } from '@/shared/query/queryKeys';
import type { PaceCurve } from '@/types';

interface UsePaceCurveOptions {
  sport?: string;
  /** Number of days to include (default 42 to match intervals.icu) */
  days?: number;
  /** Use gradient adjusted pace (running only) */
  gap?: boolean;
  enabled?: boolean;
}

/** A parsed curve with the time the body behind it was fetched. */
interface DatedPaceCurve {
  curve: PaceCurve;
  /** Epoch milliseconds, or null when the curve has never been fetched. */
  fetchedAt: number | null;
}

export function usePaceCurve(options: UsePaceCurveOptions = {}) {
  const { sport = 'Run', days = 42, gap = false, enabled = true } = options;

  const queryKey = queryKeys.charts.paceCurve.bySport(sport, days, gap);

  // The query is the only reader of the stored body. `null` is "never
  // fetched", which is the cue to ask Rust for it; the empty curve is what the
  // chart draws in the meantime.
  const query = useQuery<DatedPaceCurve | null>({
    queryKey,
    queryFn: () => {
      const stored = getEngine()?.getPaceCurve(sport, days, gap);
      if (!stored) return null;
      // A body that will not parse is not a curve, and reporting it as one
      // would draw an empty chart under a date saying it is current.
      const curve = parsePaceCurveBody(stored.raw, sport);
      return curve ? { curve, fetchedAt: stored.fetchedAt } : null;
    },
    enabled,
    // SQLite is the source, so a sync decides freshness, not a clock.
    staleTime: Infinity,
    placeholderData: keepPreviousData,
  });
  useEngineBody(
    query.data !== null,
    () => getEngine()?.syncPaceCurve(sport, days, gap),
    queryKey,
    enabled && query.data !== undefined
  );
  const result = {
    ...query,
    data: query.data?.curve ?? emptyPaceCurve(sport),
    fetchedAt: query.data?.fetchedAt ?? null,
  };

  // Snapshot critical speed for trend tracking (idempotent: INSERT OR REPLACE by date+sport)
  const lastSnapshotted = useRef<string | null>(null);
  const endDate = result.data?.endDate;
  useEffect(() => {
    const cs = result.data?.criticalSpeed;
    if (cs == null || cs <= 0) return;
    const key = `${sport}:${cs}`;
    if (lastSnapshotted.current === key) return;
    lastSnapshotted.current = key;
    const engine = getEngine();
    if (!engine) return;
    engine.savePaceSnapshot(
      sport,
      cs,
      result.data?.dPrime,
      result.data?.r2,
      paceSnapshotDate(endDate)
    );
  }, [result.data?.criticalSpeed, sport, result.data?.dPrime, result.data?.r2, endDate]);

  return result;
}

/** Rendered as "no data yet" rather than an error while the fetch is in flight. */
function emptyPaceCurve(sport: string): PaceCurve {
  return { type: 'pace', sport, distances: [], times: [], pace: [] };
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

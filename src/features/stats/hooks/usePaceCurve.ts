import { useEffect, useRef } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { LOCAL_READ_QUERY } from '@/shared/query/QueryProvider';
import { getEngine } from '@/shared/native/engine';
import { useEngineBody } from '@/shared/native/engineBodies';
import { useRangeCoverage } from '@/shared/native/useRangeCoverage';
import { paceCurveOf } from '@/features/stats/lib/curveRecords';
import { paceSnapshotDate } from '@/features/stats/lib/paceSnapshot';
import { PACE_SNAPSHOT_WINDOW_DAYS } from '@/shared/app/constants';
import { queryKeys } from '@/shared/query/queryKeys';
import { RangeCoverage } from 'veloqrs';
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
    ...LOCAL_READ_QUERY,
    queryKey,
    queryFn: () => {
      // The engine answers `null` for a window never fetched and for a body
      // that will not parse, which the chart treats alike: it has no curve.
      const stored = getEngine()?.getPaceCurve(sport, days, gap);
      if (!stored) return null;
      return { curve: paceCurveOf(stored), fetchedAt: stored.fetchedAt };
    },
    enabled,
    // SQLite is the source, so a sync decides freshness, not a clock.
    staleTime: Infinity,
    placeholderData: keepPreviousData,
  });
  const body = useEngineBody(
    query.data !== null,
    () => getEngine()?.syncPaceCurve(sport, days, gap),
    queryKey,
    enabled && query.data !== undefined
  );
  // An empty activity census proves there is nothing to chart. Downloaded
  // activities alone cannot prove the separate curve request has returned.
  const coverage = useRangeCoverage(days, enabled);

  const result = {
    ...query,
    data: query.data?.curve ?? emptyPaceCurve(sport),
    fetchedAt: query.data?.fetchedAt ?? null,
    coverage: query.data
      ? RangeCoverage.Loaded
      : coverage === RangeCoverage.Empty
        ? RangeCoverage.Empty
        : RangeCoverage.NotFetched,
    bodyStatus: body.status,
    retryBody: body.retry,
  };

  // The engine stores the sync window's snapshot with the curve body.
  const lastSnapshotted = useRef<string | null>(null);
  const endDate = result.data?.endDate;
  useEffect(() => {
    const cs = result.data?.criticalSpeed;
    if (cs == null || cs <= 0) return;
    if (days === PACE_SNAPSHOT_WINDOW_DAYS && (sport === 'Run' || sport === 'Swim')) return;
    const key = `${sport}:${cs}`;
    if (lastSnapshotted.current === key) return;
    lastSnapshotted.current = key;
    const engine = getEngine();
    if (!engine) return;
    // Under the range the screen is showing. The trend reads the sync's window
    // and leaves these alone: a year curve's critical speed is the athlete's
    // best year, which is a different fact from the last six weeks and not an
    // improvement on it.
    engine.savePaceSnapshot(
      sport,
      cs,
      days,
      result.data?.dPrime,
      result.data?.r2,
      paceSnapshotDate(endDate)
    );
  }, [result.data?.criticalSpeed, sport, days, result.data?.dPrime, result.data?.r2, endDate]);

  return result;
}

/** Empty axes while the separate coverage and body status explain the wait. */
function emptyPaceCurve(sport: string): PaceCurve {
  return { type: 'pace', sport, distances: [], times: [], pace: [] };
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

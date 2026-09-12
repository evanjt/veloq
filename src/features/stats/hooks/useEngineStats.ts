/**
 * Aggregate totals read from the engine rather than summed in JavaScript.
 *
 * `activity_metrics` covers exactly what `activity_bodies` covers: the sync
 * writes both from the same page (`objects/sync.rs:1078-1098`). The comments
 * these hooks replaced said the engine could only answer the 90-day GPS window,
 * which is why a year of bodies was being parsed to sum a dozen numbers.
 */
import { useQuery } from '@tanstack/react-query';

import type { MonthlyStats as EngineMonthlyStats } from 'veloqrs';

import { getEngine } from '@/shared/native/engine';
import { useEngineChannel } from '@/shared/native/useEngineChannel';
import { queryKeys } from '@/shared/query/queryKeys';

/** The four totals the engine reports for any window. */
export interface PeriodTotals {
  count: number;
  duration: number;
  distance: number;
  tss: number;
}

/** One calendar month's totals. */
export interface MonthTotals extends PeriodTotals {
  year: number;
  month: number;
}

const NO_TOTALS: PeriodTotals = { count: 0, duration: 0, distance: 0, tss: 0 };

/**
 * The engine's four totals, with the seconds narrowed to a number.
 *
 * `total_duration` is an i64 and so crosses the FFI as a bigint. Seconds of
 * moving time do not come near the safe-integer range, and every caller
 * arithmetics on it.
 */
function totals(stats: {
  count: number;
  totalDuration: bigint | number;
  totalDistance: number;
  totalTss: number;
}): PeriodTotals {
  return {
    count: stats.count,
    duration: Number(stats.totalDuration),
    distance: stats.totalDistance,
    tss: stats.totalTss,
  };
}
const NO_MONTHS: MonthTotals[] = [];

/** Midnight of a local date, as the epoch seconds the engine stores. */
export function localDayStart(date: Date): number {
  return Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 1000);
}

/** The last instant of a local date, as epoch seconds. */
export function localDayEnd(date: Date): number {
  return localDayStart(date) + 86_399;
}

export function useMonthlyStats(startTs: number, endTs: number): MonthTotals[] {
  useEngineChannel('activities', queryKeys.stats.all);

  const { data } = useQuery({
    queryKey: queryKeys.stats.monthly(startTs, endTs),
    queryFn: () =>
      (getEngine()?.getMonthlyStats?.(startTs, endTs) ?? []).map((row: EngineMonthlyStats) => ({
        year: row.year,
        month: row.month,
        ...totals(row.stats),
      })),
    // SQLite is the source, so a sync decides freshness, not a clock.
    staleTime: Infinity,
  });

  return data ?? NO_MONTHS;
}

export function usePeriodStats(
  startTs: number,
  endTs: number,
  enabled = true
): { totals: PeriodTotals; isPending: boolean } {
  useEngineChannel('activities', queryKeys.stats.all);

  const { data, isPending } = useQuery({
    queryKey: queryKeys.stats.period(startTs, endTs),
    queryFn: () => {
      const stats = getEngine()?.getPeriodStats?.(startTs, endTs);
      return stats ? totals(stats) : NO_TOTALS;
    },
    staleTime: Infinity,
    enabled,
  });

  return { totals: data ?? NO_TOTALS, isPending: enabled && isPending };
}

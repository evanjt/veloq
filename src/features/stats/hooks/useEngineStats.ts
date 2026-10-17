/**
 * Aggregate totals read from the engine rather than summed in JavaScript.
 *
 * `activity_metrics` covers exactly what `activity_bodies` covers: the sync
 * writes both from the same page (`sync_activity_window`). The comments
 * these hooks replaced said the engine could only answer the 90-day GPS window,
 * which is why a year of bodies was being parsed to sum a dozen numbers.
 */
import { useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { LOCAL_READ_QUERY } from '@/shared/query/QueryProvider';

import type {
  HeatmapDay,
  MonthlyStats as EngineMonthlyStats,
  StatTrend,
  SummaryComparison as EngineSummaryComparison,
  TrainingScreenWindows,
} from 'veloqrs';

import { formatLocalDate, parseDayString } from '@/shared/format/format';
import type { TrendGlyph } from '@/shared/format/trend';
import { localWallClockToEpochSeconds } from '@/shared/time/startDate';
import { getEngine } from '@/shared/native/engine';
import { queryKeys } from '@/shared/query/queryKeys';
import { heatmapLayout, type HeatmapLayout } from '../lib/heatmapGrid';
import { seasonWindows, type SeasonWindows } from '../lib/periodWindows';

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
 * `total_duration` crosses as an f64, so it needs no narrowing: seconds of
 * moving time do not come near the safe-integer range.
 */
function totals(stats: {
  count: number;
  totalDuration: number;
  totalDistance: number;
  totalTss: number;
}): PeriodTotals {
  return {
    count: stats.count,
    duration: stats.totalDuration,
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

/** The windows the training tab draws, every one fixed by the local date. */
export interface TrainingWindows {
  /** Today, at local midnight. */
  today: Date;
  /** 1 January last year, where the season chart's two years begin. */
  seasonFrom: Date;
  /** The heatmap grid, whose first and last cells bound its days. */
  heatmap: HeatmapLayout;
  /** The year and the month to date, each against last year's same span. */
  season: SeasonWindows;
}

export function trainingWindows(now: Date): TrainingWindows {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return {
    today,
    seasonFrom: new Date(today.getFullYear() - 1, 0, 1),
    heatmap: heatmapLayout(today),
    season: seasonWindows(today),
  };
}

/**
 * The windows as the engine takes them, whole local days in its timebase, and
 * the instant the weekly card's periods run to.
 */
function engineWindows(w: TrainingWindows, now: Date): TrainingScreenWindows {
  const days = (start: Date, end: Date) => ({
    startTs: localDayStart(start),
    endTs: localDayEnd(end),
  });
  return {
    heatmapFirstDay: formatLocalDate(w.heatmap.first),
    heatmapLastDay: formatLocalDate(w.heatmap.last),
    months: days(w.seasonFrom, w.today),
    yearCurrent: days(w.season.yearCurrent.start, w.season.yearCurrent.end),
    yearPrevious: days(w.season.yearPrevious.start, w.season.yearPrevious.end),
    monthCurrent: days(w.season.monthCurrent.start, w.season.monthCurrent.end),
    monthPrevious: days(w.season.monthPrevious.start, w.season.monthPrevious.end),
    nowWallSeconds: localWallClockToEpochSeconds(now),
  };
}

/** The weekly card's ranges. */
export type SummaryRange = 'week' | 'month' | '3m' | '6m' | 'year';

/** The four totals the weekly card compares. */
export type SummaryStat = keyof PeriodTotals;

/** One total's move against the period before, as the engine judged it. */
export interface StatMove {
  glyph: TrendGlyph;
  /** Whole percent of the earlier total, absent for a move inside the deadband. */
  percent: number | null;
}

/** A period to now against the same elapsed span of the period before it. */
export interface SummaryComparison {
  currentStart: Date;
  currentEnd: Date;
  previousStart: Date;
  previousEnd: Date;
  current: PeriodTotals;
  previous: PeriodTotals;
  /** Absent for a total the earlier period has none of. */
  moves: Record<SummaryStat, StatMove | null>;
}

/** An engine wall-clock second as the local `Date` it names. */
function wallDate(seconds: number): Date {
  const d = new Date(seconds * 1000);
  return new Date(
    d.getUTCFullYear(),
    d.getUTCMonth(),
    d.getUTCDate(),
    d.getUTCHours(),
    d.getUTCMinutes(),
    d.getUTCSeconds()
  );
}

function move(trend: StatTrend | undefined): StatMove | null {
  if (!trend) return null;
  return { glyph: trend.glyph as TrendGlyph, percent: trend.percent ?? null };
}

function comparison(read: EngineSummaryComparison): SummaryComparison {
  return {
    currentStart: wallDate(read.current.startTs),
    currentEnd: wallDate(read.current.endTs),
    previousStart: wallDate(read.previous.startTs),
    previousEnd: wallDate(read.previous.endTs),
    current: totals(read.currentStats),
    previous: totals(read.previousStats),
    moves: {
      count: move(read.count),
      duration: move(read.duration),
      distance: move(read.distance),
      tss: move(read.load),
    },
  };
}

/** What the training tab's heatmap and season cards paint with. */
export interface TrainingScreen {
  heatmap: HeatmapDay[];
  months: MonthTotals[];
  yearCurrent: PeriodTotals;
  yearPrevious: PeriodTotals;
  monthCurrent: PeriodTotals;
  monthPrevious: PeriodTotals;
  /** The weekly card's every range, or null before the first read. */
  comparisons: Record<SummaryRange, SummaryComparison> | null;
}

const NO_TRAINING_SCREEN: TrainingScreen = {
  heatmap: [],
  months: NO_MONTHS,
  yearCurrent: NO_TOTALS,
  yearPrevious: NO_TOTALS,
  monthCurrent: NO_TOTALS,
  monthPrevious: NO_TOTALS,
  comparisons: null,
};

/**
 * The training tab's one screen read: the heatmap days, the season chart's
 * monthly rows and its to-date totals, all over windows fixed by today's date,
 * and the weekly card's every range to the instant of the read, judged by the
 * engine.
 *
 * Every card that paints from it calls this, and they share the one query, so
 * the tab costs one engine call on mount and one per `activities` event, the
 * event the read names as what makes it stale. A tap between the weekly
 * card's ranges reads nothing.
 *
 * `isPending` is true until the first answer, so a card can tell an empty
 * library from one not read yet. `error` is what the read threw.
 */
export function useTrainingScreenData(): {
  windows: TrainingWindows;
  data: TrainingScreen;
  isPending: boolean;
  error: unknown;
} {
  // A day key rather than the instant, so the windows hold across renders and
  // move when the tab is next painted after midnight.
  const day = formatLocalDate(new Date());
  const windows = useMemo(() => trainingWindows(parseDayString(day)), [day]);

  // Every card on the tab subscribes, so one event arrives once per card. The
  // read is synchronous, so a refetch the first card started has already read
  // the new rows, and the rest join it rather than cancel it and read again.
  const queryClient = useQueryClient();
  useEffect(() => {
    const engine = getEngine();
    if (!engine) return undefined;
    return engine.subscribe('activities', () => {
      void queryClient.invalidateQueries(
        { queryKey: queryKeys.stats.training.all },
        { cancelRefetch: false }
      );
    });
  }, [queryClient]);

  const { data, isPending, error } = useQuery({
    ...LOCAL_READ_QUERY,
    queryKey: queryKeys.stats.training.byDay(day),
    queryFn: (): TrainingScreen => {
      const read = getEngine()?.getTrainingScreenData(engineWindows(windows, new Date()));
      if (!read) return NO_TRAINING_SCREEN;
      return {
        heatmap: read.heatmap,
        months: read.months.map((row: EngineMonthlyStats) => ({
          year: row.year,
          month: row.month,
          ...totals(row.stats),
        })),
        yearCurrent: totals(read.yearCurrent),
        yearPrevious: totals(read.yearPrevious),
        monthCurrent: totals(read.monthCurrent),
        monthPrevious: totals(read.monthPrevious),
        comparisons: {
          week: comparison(read.comparisons.week),
          month: comparison(read.comparisons.month),
          '3m': comparison(read.comparisons.threeMonths),
          '6m': comparison(read.comparisons.sixMonths),
          year: comparison(read.comparisons.year),
        },
      };
    },
    // SQLite is the source, so a sync decides freshness, not a clock.
    staleTime: Infinity,
  });

  return { windows, data: data ?? NO_TRAINING_SCREEN, isPending, error };
}

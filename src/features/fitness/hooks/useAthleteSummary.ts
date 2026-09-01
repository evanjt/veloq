import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { useAuthStore } from '@/shared/app/AuthStore';
import { formatLocalDate, getMonday, getSunday, getIntlLocale } from '@/shared/format/format';
import { getEngine } from '@/shared/native/engine';
import { useEngineChannel } from '@/shared/native/useEngineChannel';
import { queryKeys } from '@/shared/query/queryKeys';
import type { AthleteSummary } from '@/types';

/**
 * Get ISO week number for a date
 * Week 1 is the week containing the first Thursday of the year
 */
export function getISOWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

/**
 * Format a date range for display (e.g., "Jan 20-26" or "Dec 30 - Jan 5")
 */
export function formatWeekRange(monday: Date): string {
  const sunday = getSunday(monday);
  const locale = getIntlLocale();
  const mondayMonth = monday.toLocaleString(locale, { month: 'short' });
  const sundayMonth = sunday.toLocaleString(locale, { month: 'short' });

  if (mondayMonth === sundayMonth) {
    return `${mondayMonth} ${monday.getDate()}-${sunday.getDate()}`;
  }
  return `${mondayMonth} ${monday.getDate()} - ${sundayMonth} ${sunday.getDate()}`;
}

export interface WeeklySummaryData {
  /** Current week summary (or null if no data) */
  currentWeek: AthleteSummary | null;
  /** Previous week summary (or null if no data) */
  previousWeek: AthleteSummary | null;
  /** Week number for current week (ISO week) */
  currentWeekNumber: number;
  /** Date range string for current week (e.g., "Jan 20-26") */
  currentWeekRange: string;
  /** Monday of current week */
  currentWeekMonday: Date;
  /** All weekly summaries in the queried range */
  allWeeks: AthleteSummary[];
}

/**
 * Hook to fetch athlete weekly summaries (calendar weeks matching intervals.icu)
 * Returns current week and previous week data for comparison
 *
 * @param weeksBack - Number of weeks to fetch (default 8 for comparison purposes)
 */
/** A week of totals, in the AthleteSummary shape the screens already read.
 *  Fields outside count / moving_time / distance / training_load are zeroed:
 *  nothing renders them, and inventing values would be worse than zero. */
function toSummary(weekStart: Date, row: EngineWeek): AthleteSummary {
  return {
    date: formatLocalDate(weekStart),
    count: row.count,
    time: row.movingTime,
    moving_time: row.movingTime,
    elapsed_time: row.movingTime,
    calories: 0,
    total_elevation_gain: 0,
    training_load: row.trainingLoad,
    srpe: 0,
    distance: row.distance,
    eftp: null,
    eftpPerKg: null,
    athlete_id: '',
    athlete_name: '',
    fitness: 0,
    fatigue: 0,
    form: 0,
    rampRate: 0,
    weight: null,
    timeInZones: [],
    timeInZonesTot: 0,
    byCategory: [],
    mostRecentWellnessId: '',
  };
}

interface EngineWeek {
  weekStart: number;
  count: number;
  movingTime: number;
  distance: number;
  trainingLoad: number;
}

/** Seconds in a week, the span each Monday anchor covers. */
const WEEK_SECONDS = 7 * 24 * 60 * 60;

/**
 * Derive weekly totals from the engine rather than fetching them.
 *
 * `activity_metrics` already holds everything the weekly cards read, so the
 * intervals.icu athlete-summary endpoint is one less thing to keep in sync.
 * Week boundaries are computed here because they are a local-calendar
 * question Rust cannot answer.
 */
function readWeeklySummaries(currentMonday: Date, weeksBack: number): AthleteSummary[] {
  const engine = getEngine();
  if (!engine?.getWeeklySummaries) return [];

  const mondays: Date[] = [];
  for (let i = weeksBack; i >= 0; i--) {
    const monday = new Date(currentMonday);
    monday.setDate(monday.getDate() - i * 7);
    mondays.push(monday);
  }

  const rows = engine.getWeeklySummaries(
    mondays.map((d) => Math.floor(d.getTime() / 1000)),
    WEEK_SECONDS
  );

  return rows
    .map((row, i) => toSummary(mondays[i], row))
    .filter((week) => week.count > 0)
    .reverse();
}

export function useAthleteSummary(weeksBack: number = 8) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  // Calculate date range: start from weeksBack weeks ago, end at end of current week
  const today = new Date();
  const currentMonday = getMonday(today);
  const startDate = new Date(currentMonday);
  startDate.setDate(startDate.getDate() - weeksBack * 7);

  // End at Sunday of current week
  const endDate = getSunday(today);

  useEngineChannel('activities', queryKeys.athleteSummary.all);

  const query = useQuery<AthleteSummary[]>({
    queryKey: queryKeys.athleteSummary.byRange(
      formatLocalDate(startDate),
      formatLocalDate(endDate)
    ),
    queryFn: () => readWeeklySummaries(currentMonday, weeksBack),
    enabled: isAuthenticated,
    // SQLite is the source, so a sync decides freshness, not a clock.
    staleTime: Infinity,
    gcTime: 1000 * 60 * 60, // 1 hour
    placeholderData: keepPreviousData,
  });

  // Process the data to extract current and previous week
  const data: WeeklySummaryData = {
    currentWeek: null,
    previousWeek: null,
    currentWeekNumber: getISOWeekNumber(today),
    currentWeekRange: formatWeekRange(currentMonday),
    currentWeekMonday: currentMonday,
    allWeeks: query.data || [],
  };

  if (query.data && query.data.length > 0) {
    const currentWeekStr = formatLocalDate(currentMonday);
    const prevMonday = new Date(currentMonday);
    prevMonday.setDate(prevMonday.getDate() - 7);
    const prevWeekStr = formatLocalDate(prevMonday);

    for (const week of query.data) {
      if (week.date === currentWeekStr) {
        data.currentWeek = week;
      } else if (week.date === prevWeekStr) {
        data.previousWeek = week;
      }
    }
  }

  return {
    ...query,
    data,
  };
}

import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { intervalsApi } from '@/api';
import { useAuthStore } from '@/providers';
import { formatLocalDate, getMonday } from '@/lib';
import { getRouteEngine } from '@/lib/native/routeEngine';
import type { AthleteSummary } from '@/types';

/**
 * Get the Sunday of the week for a given date (ISO week: Monday-Sunday)
 */
function getSunday(date: Date): Date {
  const monday = getMonday(date);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return sunday;
}

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
  const mondayMonth = monday.toLocaleString('en-US', { month: 'short' });
  const sundayMonth = sunday.toLocaleString('en-US', { month: 'short' });

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
/**
 * Build a partial AthleteSummary from engine period stats.
 * Only populates fields used by WeeklySummary (count, moving_time, distance, training_load).
 */
function enginePeriodToSummary(
  monday: Date,
  startTs: number,
  endTs: number
): AthleteSummary | null {
  const engine = getRouteEngine();
  if (!engine) return null;

  const stats = engine.getPeriodStats(startTs, endTs);
  if (stats.count === 0) return null;

  return {
    date: formatLocalDate(monday),
    count: stats.count,
    time: Number(stats.totalDuration),
    moving_time: Number(stats.totalDuration),
    elapsed_time: Number(stats.totalDuration),
    calories: 0,
    total_elevation_gain: 0,
    training_load: stats.totalTss,
    srpe: 0,
    distance: stats.totalDistance,
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

export function useAthleteSummary(weeksBack: number = 8) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  // Calculate date range: start from weeksBack weeks ago, end at end of current week
  const today = new Date();
  const currentMonday = getMonday(today);
  const startDate = new Date(currentMonday);
  startDate.setDate(startDate.getDate() - weeksBack * 7);

  // End at Sunday of current week
  const endDate = getSunday(today);

  const query = useQuery<AthleteSummary[]>({
    queryKey: ['athlete-summary', formatLocalDate(startDate), formatLocalDate(endDate)],
    queryFn: () =>
      intervalsApi.getAthleteSummary({
        start: formatLocalDate(startDate),
        end: formatLocalDate(endDate),
      }),
    enabled: isAuthenticated,
    staleTime: 1000 * 60 * 5, // 5 minutes - weekly data can change as activities sync
    gcTime: 1000 * 60 * 60, // 1 hour
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: true, // Weekly stats update on foreground
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

  // Engine fallback: if API hasn't responded yet, compute from engine
  if (!data.currentWeek) {
    const currentSunday = getSunday(today);
    data.currentWeek = enginePeriodToSummary(
      currentMonday,
      Math.floor(currentMonday.getTime() / 1000),
      Math.floor(currentSunday.getTime() / 1000)
    );
  }
  if (!data.previousWeek) {
    const prevMonday = new Date(currentMonday);
    prevMonday.setDate(prevMonday.getDate() - 7);
    const prevSunday = new Date(prevMonday);
    prevSunday.setDate(prevMonday.getDate() + 6);
    data.previousWeek = enginePeriodToSummary(
      prevMonday,
      Math.floor(prevMonday.getTime() / 1000),
      Math.floor(prevSunday.getTime() / 1000)
    );
  }

  return {
    ...query,
    data,
  };
}

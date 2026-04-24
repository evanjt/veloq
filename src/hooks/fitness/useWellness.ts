import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { intervalsApi } from '@/api';
import { useAuthStore } from '@/providers';
import { formatLocalDate } from '@/lib';
import { queryKeys } from '@/lib/queryKeys';
import { getRouteEngine } from '@/lib/native/routeEngine';
import type { WellnessData } from '@/types';

/**
 * Mirror wellness rows into Rust so sparkline + HRV-trend atomics can
 * read from SQLite. Fire-and-forget: failures are logged in dev only
 * (engine may not be ready yet during early startup).
 */
function syncWellnessToEngine(rows: WellnessData[]): void {
  if (rows.length === 0) return;
  try {
    const engine = getRouteEngine();
    if (!engine?.upsertWellness) return;
    engine.upsertWellness(
      rows.map((w) => ({
        date: w.id,
        ctl: w.ctl ?? w.ctlLoad,
        atl: w.atl ?? w.atlLoad,
        rampRate: w.rampRate,
        hrv: w.hrv,
        restingHr: w.restingHR,
        weight: w.weight,
        sleepSecs: w.sleepSecs,
        sleepScore: w.sleepScore,
        soreness: w.soreness,
        fatigue: w.fatigue,
        stress: w.stress,
        mood: w.mood,
        motivation: w.motivation,
      }))
    );
  } catch (err) {
    if (__DEV__) console.warn('[useWellness] upsertWellness failed:', err);
  }
}

export type TimeRange = '7d' | '1m' | '42d' | '3m' | '6m' | '1y';

const TIME_RANGE_DAYS: Record<TimeRange, number> = {
  '7d': 7,
  '1m': 30,
  '42d': 42,
  '3m': 90,
  '6m': 180,
  '1y': 365,
};

/** Convert a TimeRange token to a day count. */
export function timeRangeToDays(range: TimeRange): number {
  return TIME_RANGE_DAYS[range];
}

function getDateRange(range: TimeRange): { oldest: string; newest: string } {
  const today = new Date();
  const newest = formatLocalDate(today);

  const oldest = new Date(today);
  oldest.setDate(oldest.getDate() - TIME_RANGE_DAYS[range]);

  return {
    oldest: formatLocalDate(oldest),
    newest,
  };
}

export function useWellness(range: TimeRange = '3m') {
  const { oldest, newest } = getDateRange(range);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  return useQuery<WellnessData[]>({
    queryKey: queryKeys.wellness.byRange(range),
    queryFn: async () => {
      const rows = await intervalsApi.getWellness({ oldest, newest });
      syncWellnessToEngine(rows);
      return rows;
    },
    // Only fetch if authenticated (prevents 404 when athleteId is missing)
    enabled: isAuthenticated,
    staleTime: 1000 * 60 * 30, // 30 minutes - wellness data changes infrequently
    gcTime: 1000 * 60 * 60 * 24, // 24 hours
    placeholderData: keepPreviousData, // Keep previous data visible while fetching new range
    refetchOnWindowFocus: true, // CTL/ATL/TSB updates on foreground
  });
}

/**
 * Fetch wellness data for a specific date
 * Used for showing Form (CTL/ATL/TSB) on activity detail pages
 */
export function useWellnessForDate(date: string | undefined) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  return useQuery<WellnessData | null>({
    queryKey: queryKeys.wellness.byDate(date),
    queryFn: async () => {
      if (!date) return null;
      // Fetch just this one day
      const data = await intervalsApi.getWellness({
        oldest: date,
        newest: date,
      });
      syncWellnessToEngine(data);
      return data?.[0] || null;
    },
    // Only fetch if authenticated and date is provided
    enabled: isAuthenticated && !!date,
    staleTime: 1000 * 60 * 60, // 1 hour - historical data doesn't change often
    gcTime: 1000 * 60 * 60 * 24, // 24 hours
  });
}

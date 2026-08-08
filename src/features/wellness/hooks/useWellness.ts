/**
 * Wellness reads come from SQLite, not the API.
 *
 * Rust's sync service fetches the year of wellness and stores each day both
 * typed (what Rust computes on) and as its untyped body (what these screens
 * read). The query key is woken by the sync-complete invalidation in
 * GlobalDataSync and by the engine's own change channel, so a finished sync
 * refreshes the charts without a second network call.
 */
import { useQuery, keepPreviousData } from '@tanstack/react-query';

import { useAuthStore } from '@/shared/app/AuthStore';
import { formatLocalDate } from '@/shared/format/format';
import { queryKeys } from '@/shared/query/queryKeys';
import { getRouteEngine } from '@/shared/native/routeEngine';
import { useEngineChannel } from '@/shared/native/useEngineChannel';
import type { WellnessData } from '@/types';
import type { TimeRange } from '@/shared/app/timeRange';

export type { TimeRange };

/** Refetch the wellness queries whenever the engine reports a change.
 *  Its own channel, not 'activities': the targeted wellness sync writes only
 *  these rows, and every new activity would otherwise refetch them too. */
function useWellnessInvalidation(): void {
  useEngineChannel('wellness', queryKeys.wellness.all);
}

const TIME_RANGE_DAYS: Record<TimeRange, number> = {
  '7d': 7,
  '1m': 30,
  '42d': 42,
  '3m': 90,
  '6m': 180,
  '1y': 365,
};

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

/**
 * Read stored wellness bodies over a date window. A body that will not parse
 * is dropped rather than surfaced as a half-populated day.
 */
function readWellness(oldest: string, newest: string): WellnessData[] {
  const engine = getRouteEngine();
  if (!engine?.getWellnessBodies) return [];

  const out: WellnessData[] = [];
  for (const body of engine.getWellnessBodies(oldest, newest)) {
    try {
      out.push(JSON.parse(body) as WellnessData);
    } catch {
      // A body we cannot parse is a corrupt row, not a day with no data.
    }
  }
  return out;
}

export function useWellness(range: TimeRange = '3m') {
  const { oldest, newest } = getDateRange(range);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  useWellnessInvalidation();

  return useQuery<WellnessData[]>({
    queryKey: queryKeys.wellness.byRange(range),
    queryFn: () => readWellness(oldest, newest),
    enabled: isAuthenticated,
    // SQLite is the source, so staleness is decided by the sync, not a clock.
    staleTime: Infinity,
    gcTime: 1000 * 60 * 60 * 24,
    placeholderData: keepPreviousData,
  });
}

// Used for showing Form (CTL/ATL/TSB) on activity detail pages.
export function useWellnessForDate(date: string | undefined) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  useWellnessInvalidation();

  return useQuery<WellnessData | null>({
    queryKey: queryKeys.wellness.byDate(date),
    queryFn: () => {
      if (!date) return null;
      return readWellness(date, date)[0] ?? null;
    },
    enabled: isAuthenticated && !!date,
    staleTime: Infinity,
    gcTime: 1000 * 60 * 60 * 24,
  });
}

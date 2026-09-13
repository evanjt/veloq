/**
 * Wellness reads come from SQLite, not the API.
 *
 * Rust's sync service fetches the year of wellness and stores each day typed,
 * and the engine answers typed, so nothing here parses a body. The query key
 * is woken by the sync-complete invalidation in
 * GlobalDataSync and by the engine's own change channel, so a finished sync
 * refreshes the charts without a second network call.
 */
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { PERIOD_DAYS } from '@/shared/app/period';

import { useAuthStore } from '@/shared/app/AuthStore';
import { formatLocalDate } from '@/shared/format/format';
import { queryKeys } from '@/shared/query/queryKeys';
import { getEngine } from '@/shared/native/engine';
import { useEngineChannel } from '@/shared/native/useEngineChannel';
import type { WellnessData } from '@/types';
import type { WellnessDay } from 'veloqrs';
import type { TimeRange } from '@/shared/app/timeRange';

export type { TimeRange };

/**
 * Refetch the wellness queries when wellness lands, and not before.
 *
 * This followed the `activities` channel, because nothing announced wellness at
 * all. That channel fires per synced page, measured five times in the first
 * 4.5 s of a launch, while wellness is written once, so all three consumers
 * re-read and re-parsed their whole window four times over for no change.
 * `sync_wellness` now announces through `store_body`, so the kind is what to
 * follow.
 */
function useWellnessInvalidation(): void {
  useEngineChannel('bodyStored', queryKeys.wellness.all, 'wellness');
}

export function timeRangeToDays(range: TimeRange): number {
  return PERIOD_DAYS[range];
}

function getDateRange(range: TimeRange): { oldest: string; newest: string } {
  const today = new Date();
  const newest = formatLocalDate(today);

  const oldest = new Date(today);
  oldest.setDate(oldest.getDate() - PERIOD_DAYS[range]);

  return {
    oldest: formatLocalDate(oldest),
    newest,
  };
}

/**
 * Read stored wellness days over a date window. The engine answers typed, so
 * this is a rename of its fields onto the shape the screens read.
 */
export function toWellnessData(day: WellnessDay): WellnessData {
  return {
    id: day.date,
    ctl: day.ctl,
    atl: day.atl,
    rampRate: day.rampRate,
    hrv: day.hrv,
    restingHR: day.restingHr,
    weight: day.weight,
    sleepSecs: day.sleepSecs,
    sleepScore: day.sleepScore,
    soreness: day.soreness,
    fatigue: day.fatigue,
    stress: day.stress,
    mood: day.mood,
    motivation: day.motivation,
    sportInfo: day.sportLoad.map((s) => ({ sportGroup: s.sportGroup, load: s.load })),
  };
}

function readWellness(oldest: string, newest: string): WellnessData[] {
  const engine = getEngine();
  if (!engine?.getWellnessDays) return [];
  return engine.getWellnessDays(oldest, newest).map(toWellnessData);
}

export function useWellness(range: TimeRange = '3m') {
  const { oldest, newest } = getDateRange(range);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  useWellnessInvalidation();

  return useQuery<WellnessData[]>({
    queryKey: queryKeys.wellness.byRange(range, oldest, newest),
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

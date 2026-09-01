/**
 * How many activities the athlete has in each calendar year, read from the
 * engine.
 *
 * Written by the same sync pass that records the first-ever activity date,
 * from a response that already carries every start date, so the history
 * slider can say what a widening would download without a second request.
 */

import { useQuery } from '@tanstack/react-query';

import { useAuthStore } from '@/shared/app/AuthStore';
import { getEngine } from '@/shared/native/engine';
import { useEngineChannel } from '@/shared/native/useEngineChannel';
import { queryKeys } from '@/shared/query/queryKeys';

/** Settings key written by the Rust sync (`ACTIVITY_YEAR_COUNTS_KEY`). */
const ACTIVITY_YEAR_COUNTS_KEY = 'activity_year_counts';

export function useActivityYearCounts() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  useEngineChannel('activities', queryKeys.calendar.yearCounts);

  return useQuery({
    queryKey: queryKeys.calendar.yearCounts,
    queryFn: (): Record<string, number> => {
      const stored = getEngine()?.getSetting(ACTIVITY_YEAR_COUNTS_KEY);
      if (!stored) return {};
      try {
        const parsed = JSON.parse(stored) as unknown;
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
        return Object.fromEntries(
          Object.entries(parsed as Record<string, unknown>).filter(
            ([, v]) => typeof v === 'number' && Number.isFinite(v)
          ) as [string, number][]
        );
      } catch {
        // A malformed setting is a missing one: the gate must not block on it.
        return {};
      }
    },
    enabled: isAuthenticated,
    // SQLite is the source, so a sync decides freshness, not a clock.
    staleTime: Infinity,
    gcTime: 7 * 24 * 60 * 60 * 1000,
  });
}

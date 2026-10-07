/**
 * How many activities the athlete has in each calendar year, read from the
 * engine.
 *
 * Written by the same sync pass that records the first-ever activity date,
 * from a response that already carries every start date, so the history
 * slider can say what a widening would download without a second request.
 */

import { useQuery } from '@tanstack/react-query';
import { LOCAL_READ_QUERY } from '@/shared/query/QueryProvider';

import { useAuthStore } from '@/shared/app/AuthStore';
import { getEngine } from '@/shared/native/engine';
import { useEngineChannel } from '@/shared/native/useEngineChannel';
import { queryKeys } from '@/shared/query/queryKeys';
import type { FfiYearCount } from 'veloqrs';
import { TIME } from '@/shared/app/time';

export function useActivityYearCounts() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  useEngineChannel('activities', queryKeys.calendar.yearCounts);

  return useQuery({
    ...LOCAL_READ_QUERY,
    queryKey: queryKeys.calendar.yearCounts,
    queryFn: (): FfiYearCount[] => getEngine()?.getCacheScreenData()?.activityYearCounts ?? [],
    enabled: isAuthenticated,
    // SQLite is the source, so a sync decides freshness, not a clock.
    staleTime: Infinity,
    gcTime: 7 * TIME.DAY,
  });
}

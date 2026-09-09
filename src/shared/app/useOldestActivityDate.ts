/**
 * The athlete's first-ever activity date, read from the engine.
 *
 * The sync writes it as a setting from a cheap two-field pull over all
 * history, so the timeline slider knows how far back it may reach without the
 * app holding every activity.
 */

import { useQuery } from '@tanstack/react-query';

import { useAuthStore } from '@/shared/app/AuthStore';
import { getEngine } from '@/shared/native/engine';
import { useEngineChannel } from '@/shared/native/useEngineChannel';
import { queryKeys } from '@/shared/query/queryKeys';

/** Settings key written by the Rust sync (`OLDEST_ACTIVITY_DATE_KEY`). */
const OLDEST_ACTIVITY_DATE_KEY = 'oldest_activity_date';

/** Get the oldest activity date from the user's activities */
export function useOldestActivityDate() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  useEngineChannel('activities', queryKeys.calendar.oldestDate);

  return useQuery({
    queryKey: queryKeys.calendar.oldestDate,
    queryFn: () => {
      const engine = getEngine();
      const stored = engine?.getSetting(OLDEST_ACTIVITY_DATE_KEY);
      if (!stored) return null;
      const parsed = new Date(stored);
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    },
    enabled: isAuthenticated,
    // SQLite is the source, so a sync decides freshness, not a clock.
    staleTime: Infinity,
    gcTime: 7 * 24 * 60 * 60 * 1000,
  });
}

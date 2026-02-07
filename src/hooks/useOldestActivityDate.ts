/**
 * Hook for getting the oldest activity date from the Rust engine.
 *
 * Uses the engine's SQLite stats (Unix timestamp) instead of an API call.
 * Falls back to API if engine has no data yet.
 */

import { useMemo } from 'react';
import { useEngineStats } from '@/hooks/routes/useRouteEngine';

/** Get the oldest activity date from the engine's stored activities */
export function useOldestActivityDate() {
  const stats = useEngineStats();

  const data = useMemo(() => {
    if (stats.oldestDate == null) return null;
    return new Date(Number(stats.oldestDate) * 1000);
  }, [stats.oldestDate]);

  return { data, isLoading: false, isError: false };
}

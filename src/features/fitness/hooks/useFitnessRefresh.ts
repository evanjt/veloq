import { useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/shared/query/queryKeys';
import { refreshWellness } from '@/shared/native/refreshWellness';

type Refetcher = () => Promise<unknown>;

/**
 * Orchestrates pull-to-refresh across every query the Fitness screen depends on.
 *
 * Asks Rust for fresh wellness, re-reads it from SQLite (via the passed
 * refetcher) and invalidates activity, power-curve, pace-curve, and
 * athlete-summary caches in parallel. Without the sync the re-read would only
 * return the rows already stored, which is what made pull-to-refresh look inert.
 */
export function useFitnessRefresh(refetchWellness: Refetcher) {
  const queryClient = useQueryClient();
  const [isRefreshing, setIsRefreshing] = useState(false);

  const onRefresh = useCallback(async () => {
    setIsRefreshing(true);
    refreshWellness();
    await Promise.all([
      refetchWellness(),
      queryClient.invalidateQueries({ queryKey: queryKeys.activities.all }),
      queryClient.invalidateQueries({ queryKey: queryKeys.charts.powerCurve.all }),
      queryClient.invalidateQueries({ queryKey: queryKeys.charts.paceCurve.all }),
      queryClient.invalidateQueries({ queryKey: queryKeys.athleteSummary.all }),
    ]);
    setIsRefreshing(false);
  }, [refetchWellness, queryClient]);

  return { isRefreshing, onRefresh };
}

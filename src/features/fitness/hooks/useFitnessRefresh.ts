import { useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/shared/query/queryKeys';
import { useSyncRefreshNotice } from '@/shared/native/useSyncRefreshNotice';

type Refetcher = () => Promise<unknown>;

/**
 * Orchestrates pull-to-refresh across every query the Fitness screen depends on.
 *
 * Re-fetches wellness (via the passed refetcher) and invalidates activity,
 * power-curve, pace-curve, athlete-summary and engine stats caches in parallel.
 * The stats caches hold the calendar, the weekly totals and the year comparison.
 */
export function useFitnessRefresh(refetchWellness: Refetcher) {
  const queryClient = useQueryClient();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const { requestRefresh } = useSyncRefreshNotice();

  const onRefresh = useCallback(async () => {
    setIsRefreshing(true);
    requestRefresh();
    try {
      await Promise.all([
        refetchWellness(),
        queryClient.invalidateQueries({ queryKey: queryKeys.activities.all }),
        queryClient.invalidateQueries({ queryKey: queryKeys.charts.powerCurve.all }),
        queryClient.invalidateQueries({ queryKey: queryKeys.charts.paceCurve.all }),
        queryClient.invalidateQueries({ queryKey: queryKeys.charts.bestEfforts.all }),
        queryClient.invalidateQueries({ queryKey: queryKeys.athleteSummary.all }),
        queryClient.invalidateQueries({ queryKey: queryKeys.stats.all }),
      ]);
    } finally {
      // A rejected refetch is offline, not broken. Leaving the spinner on has
      // no way back short of leaving the screen.
      setIsRefreshing(false);
    }
  }, [refetchWellness, queryClient, requestRefresh]);

  return { isRefreshing, onRefresh };
}

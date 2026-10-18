import { useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/shared/query/queryKeys';
import { useSyncRefreshNotice } from '@/shared/native/useSyncRefreshNotice';

type Refetcher = () => Promise<unknown>;

/**
 * Orchestrates pull-to-refresh across every query the Fitness screen depends on.
 *
 * Re-fetches wellness (via the passed refetcher), invalidates activity,
 * power-curve, pace-curve and athlete-summary caches in parallel, and reads
 * the screen read again, which holds the calendar, the weekly totals and the
 * year comparison.
 */
export function useFitnessRefresh(refetchWellness: Refetcher, rereadScreen: () => void) {
  const queryClient = useQueryClient();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const { requestRefresh } = useSyncRefreshNotice();

  const onRefresh = useCallback(async () => {
    setIsRefreshing(true);
    requestRefresh();
    rereadScreen();
    try {
      await Promise.all([
        refetchWellness(),
        queryClient.invalidateQueries({ queryKey: queryKeys.activities.all }),
        queryClient.invalidateQueries({ queryKey: queryKeys.charts.powerCurve.all }),
        queryClient.invalidateQueries({ queryKey: queryKeys.charts.paceCurve.all }),
        queryClient.invalidateQueries({ queryKey: queryKeys.charts.bestEfforts.all }),
        queryClient.invalidateQueries({ queryKey: queryKeys.athleteSummary.all }),
      ]);
    } finally {
      // A rejected refetch is offline, not broken. Leaving the spinner on has
      // no way back short of leaving the screen.
      setIsRefreshing(false);
    }
  }, [refetchWellness, rereadScreen, queryClient, requestRefresh]);

  return { isRefreshing, onRefresh };
}

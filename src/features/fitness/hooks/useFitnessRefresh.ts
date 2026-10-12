import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/shared/query/queryKeys';
import { useSyncRefreshNotice } from '@/shared/native/useSyncRefreshNotice';
import { onPullRefresh } from '@/shared/ui/haptics';

type Refetcher = () => Promise<unknown>;

/**
 * Orchestrates pull-to-refresh across every query the Fitness screen depends on.
 *
 * Re-fetches wellness (via the passed refetcher) and invalidates activity,
 * power-curve, pace-curve, and athlete-summary caches in parallel.
 */
export function useFitnessRefresh(refetchWellness: Refetcher) {
  const queryClient = useQueryClient();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const { requestRefresh } = useSyncRefreshNotice();

  const onRefresh = useMemo(
    () =>
      onPullRefresh(async () => {
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
          ]);
        } finally {
          // A rejected refetch is offline, not broken. Leaving the spinner on has
          // no way back short of leaving the screen.
          setIsRefreshing(false);
        }
      }),
    [refetchWellness, queryClient, requestRefresh]
  );

  return { isRefreshing, onRefresh };
}

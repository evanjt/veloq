import type { QueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@/shared/app/AuthStore';
import { formatLocalDate } from '@/shared/format/format';
import { queryKeys } from './queryKeys';

/**
 * Check if the persisted activities-infinite query has stale page params
 * (first page doesn't cover today's date). When stale, `invalidateQueries`
 * won't help because it refetches with the stored params — `resetQueries`
 * is needed to re-evaluate `initialPageParam` with today's date.
 *
 * Lives in shared/query because it operates on the shared `queryKeys.activities`
 * surface and is consumed by the shared query-client cache lifecycle.
 */
export function isInfiniteActivitiesStale(queryClient: QueryClient): boolean {
  const athleteId = useAuthStore.getState().athleteId ?? 'anon';
  const state = queryClient.getQueryState(
    queryKeys.activities.infinite.byAthlete(athleteId, false)
  );
  if (!state?.data) return false;
  const pageParams = (state.data as { pageParams?: Array<{ newest?: string }> }).pageParams;
  const firstNewest = pageParams?.[0]?.newest;
  if (!firstNewest) return false;
  return firstNewest !== formatLocalDate(new Date());
}

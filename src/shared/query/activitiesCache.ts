import type { QueryClient } from '@tanstack/react-query';
import { formatLocalDate } from '@/shared/format/format';
import { queryKeys } from './queryKeys';

/**
 * Check if any activities-infinite query in this session holds stale page
 * params (the first page doesn't cover today's date). A feed left open across
 * midnight keeps the page params it was fetched with, and `invalidateQueries`
 * refetches with those stored params, so today's activities never arrive.
 * `resetQueries` re-evaluates `initialPageParam` with today's date, so
 * pull-to-refresh resets when this returns true and invalidates otherwise.
 *
 * Every key under `queryKeys.activities.infinite.all` is scanned, which is the
 * same prefix the reset and the invalidation act on, so the check covers
 * exactly the queries the refresh touches without knowing the athlete id.
 */
export function isInfiniteActivitiesStale(queryClient: QueryClient): boolean {
  const today = formatLocalDate(new Date());
  return queryClient
    .getQueryCache()
    .findAll({ queryKey: queryKeys.activities.infinite.all })
    .some((query) => {
      const pageParams = (query.state.data as { pageParams?: { newest?: string }[] } | undefined)
        ?.pageParams;
      const firstNewest = pageParams?.[0]?.newest;
      return typeof firstNewest === 'string' && firstNewest !== today;
    });
}

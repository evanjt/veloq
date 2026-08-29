import type { QueryClient } from '@tanstack/react-query';
import { formatLocalDate } from '@/shared/format/format';
import { queryKeys } from './queryKeys';

/**
 * Check if any persisted activities-infinite query has stale page params
 * (first page doesn't cover today's date). When stale, `invalidateQueries`
 * won't help because it refetches with the stored params - `resetQueries`
 * is needed to re-evaluate `initialPageParam` with today's date.
 *
 * Every cached variant is scanned rather than one reconstructed key. The
 * persisted-cache callback runs before `AuthStore` finishes reading SecureStore,
 * so an athlete id is not available yet, and the feed is cached under both the
 * `stats` and `base` variants.
 *
 * Lives in shared/query because it operates on the shared `queryKeys.activities`
 * surface and is consumed by the shared query-client cache lifecycle.
 */
export function isInfiniteActivitiesStale(queryClient: QueryClient): boolean {
  const today = formatLocalDate(new Date());
  return queryClient
    .getQueryCache()
    .findAll({ queryKey: queryKeys.activities.infinite.all })
    .some((query) => {
      const pageParams = (
        query.state.data as { pageParams?: Array<{ newest?: string }> } | undefined
      )?.pageParams;
      const firstNewest = pageParams?.[0]?.newest;
      return typeof firstNewest === 'string' && firstNewest !== today;
    });
}

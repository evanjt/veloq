import {
  useQuery,
  useInfiniteQuery,
  keepPreviousData,
  type QueryClient,
} from '@tanstack/react-query';
import { useMemo } from 'react';
import { intervalsApi } from '@/api';
import { formatLocalDate } from '@/lib';
import { CACHE } from '@/lib/utils/constants';
import { queryKeys } from '@/lib/queryKeys';
import type { Activity, IntervalsDTO } from '@/types';
import { useAuthStore } from '@/providers/AuthStore';

interface UseActivitiesOptions {
  /** Number of days to fetch (from today backwards) */
  days?: number;
  /** Start date (YYYY-MM-DD) - overrides days */
  oldest?: string;
  /** End date (YYYY-MM-DD) - defaults to today */
  newest?: string;
  /** Include additional stats fields (eFTP, zone times) - use for performance page */
  includeStats?: boolean;
  /** Whether to enable the query (default: true) */
  enabled?: boolean;
}

/**
 * Standard activities hook for fixed date ranges.
 * Use this for specific date range queries (e.g., stats page, wellness).
 */
export function useActivities(options: UseActivitiesOptions = {}) {
  const { days, oldest, newest, includeStats = false, enabled = true } = options;
  const athleteId = useAuthStore((s) => s.athleteId);

  // Calculate date range
  let queryOldest = oldest;
  let queryNewest = newest;

  if (!oldest) {
    const today = new Date();
    const daysAgo = new Date(today);
    daysAgo.setDate(daysAgo.getDate() - (days || 30));
    queryOldest = formatLocalDate(daysAgo);
    queryNewest = newest || formatLocalDate(today);
  }

  return useQuery<Activity[]>({
    queryKey: queryKeys.activities.list(
      athleteId ?? 'anon',
      queryOldest!,
      queryNewest!,
      includeStats
    ),
    queryFn: () =>
      intervalsApi.getActivities({
        oldest: queryOldest,
        newest: queryNewest,
        includeStats,
      }),
    // Stale-while-revalidate: show cached data immediately, refetch in background
    staleTime: CACHE.SHORT, // 5 minutes - data appears instantly from cache
    gcTime: CACHE.HOUR, // 1 hour - keep in memory for navigation
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: true, // Pick up new activities on foreground
    enabled: enabled && !!athleteId,
  });
}

/**
 * Page size for infinite scroll (in days)
 */
const PAGE_SIZE_DAYS = 30;

/**
 * Infinite scroll for activity feed.
 *
 * Stale-while-revalidate: cached activities show instantly on app open,
 * background refetch picks up new activities. Persisted to AsyncStorage
 * so the feed renders immediately on subsequent opens.
 */
export function useInfiniteActivities(options: { includeStats?: boolean } = {}) {
  const { includeStats = false } = options;
  const athleteId = useAuthStore((s) => s.athleteId);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  const query = useInfiniteQuery<Activity[], Error>({
    queryKey: queryKeys.activities.infinite.byAthlete(athleteId ?? 'anon', includeStats),
    queryFn: async ({ pageParam }) => {
      const { oldest, newest } = pageParam as {
        oldest: string;
        newest: string;
      };

      return intervalsApi.getActivities({
        oldest,
        newest,
        includeStats,
      });
    },
    initialPageParam: (() => {
      const today = new Date();
      const thirtyDaysAgo = new Date(today);
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - PAGE_SIZE_DAYS);
      return {
        oldest: formatLocalDate(thirtyDaysAgo),
        newest: formatLocalDate(today),
      };
    })(),
    getNextPageParam: (lastPage, _allPages, lastPageParam) => {
      // Stop if no more activities
      if (lastPage.length === 0) {
        return undefined;
      }

      const pageParam = lastPageParam as { oldest: string };
      const nextEnd = new Date(pageParam.oldest);
      nextEnd.setDate(nextEnd.getDate() - 1);
      const nextStart = new Date(nextEnd);
      nextStart.setDate(nextStart.getDate() - PAGE_SIZE_DAYS);

      return {
        oldest: formatLocalDate(nextStart),
        newest: formatLocalDate(nextEnd),
      };
    },
    // Stale-while-revalidate: show cached data immediately, refetch in background
    staleTime: CACHE.SHORT, // 5 minutes - data appears instantly from cache
    gcTime: CACHE.HOUR, // 1 hour - keep in memory for navigation
    // refetchOnMount: false (inherits global default) — persisted cache shows instantly,
    // 'always' bypasses staleTime so new activities appear immediately on foreground
    refetchOnWindowFocus: 'always',
    maxPages: 10, // Evict old pages to prevent memory growth
    enabled: isAuthenticated && !!athleteId,
  });

  // All activities flattened from loaded pages
  const allActivities = useMemo(() => {
    if (!query.data?.pages) return [];
    return query.data.pages.flat();
  }, [query.data?.pages]);

  return {
    ...query,
    allActivities,
  };
}

export function useActivity(id: string) {
  return useQuery({
    queryKey: queryKeys.activities.detail(id),
    queryFn: () => intervalsApi.getActivity(id),
    // Single activity - cache for 1 hour, rarely changes
    staleTime: CACHE.HOUR,
    // GC after 4 hours to prevent memory bloat when viewing many activities
    gcTime: CACHE.HOUR * 4,
    enabled: !!id,
  });
}

export function useActivityStreams(id: string) {
  return useQuery({
    queryKey: queryKeys.activities.streams(id),
    queryFn: () =>
      intervalsApi.getActivityStreams(id, [
        'latlng',
        'altitude',
        'fixed_altitude',
        'heartrate',
        'watts',
        'cadence',
        'distance',
        'time',
        'velocity_smooth',
        'grade_smooth',
        'temp',
      ]),
    // Streams NEVER change - infinite staleTime prevents refetching
    staleTime: Infinity,
    // GC after 30 minutes - streams are large (100-500KB), free memory sooner
    gcTime: CACHE.LONG,
    enabled: !!id,
  });
}

export function useActivityIntervals(id: string) {
  return useQuery<IntervalsDTO>({
    queryKey: queryKeys.activities.intervals(id),
    queryFn: () => intervalsApi.getActivityIntervals(id),
    // Intervals never change
    staleTime: Infinity,
    gcTime: CACHE.HOUR * 2,
    enabled: !!id,
  });
}

/**
 * Check if the persisted activities-infinite query has stale page params
 * (first page doesn't cover today's date). When stale, `invalidateQueries`
 * won't help because it refetches with the stored params — `resetQueries`
 * is needed to re-evaluate `initialPageParam` with today's date.
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

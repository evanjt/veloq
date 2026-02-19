import { useQuery, useInfiniteQuery, keepPreviousData } from '@tanstack/react-query';
import { useMemo } from 'react';
import { intervalsApi } from '@/api';
import { formatLocalDate } from '@/lib';
import type { Activity, IntervalsDTO } from '@/types';

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
    queryKey: ['activities', queryOldest, queryNewest, includeStats ? 'stats' : 'base'],
    queryFn: () =>
      intervalsApi.getActivities({
        oldest: queryOldest,
        newest: queryNewest,
        includeStats,
      }),
    // Stale-while-revalidate: show cached data immediately, refetch in background
    staleTime: 1000 * 60 * 5, // 5 minutes - data appears instantly from cache
    gcTime: 1000 * 60 * 60, // 1 hour - keep in memory for navigation
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: true, // Pick up new activities on foreground
    enabled,
  });
}

/**
 * Page size for infinite scroll (in days)
 */
const PAGE_SIZE_DAYS = 30;

/**
 * Infinite scroll for activity feed.
 *
 * Thin client approach:
 * - Always fetch fresh data (staleTime: 0)
 * - Refetch on focus/mount to ensure data is current
 * - Simple pull-to-refresh using standard refetch
 */
export function useInfiniteActivities(options: { includeStats?: boolean } = {}) {
  const { includeStats = false } = options;

  const query = useInfiniteQuery<Activity[], Error>({
    queryKey: ['activities-infinite', includeStats ? 'stats' : 'base'],
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
    staleTime: 1000 * 60 * 5, // 5 minutes - data appears instantly from cache
    gcTime: 1000 * 60 * 60, // 1 hour - keep in memory for navigation
    refetchOnWindowFocus: true, // Pick up new activities on foreground
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
    queryKey: ['activity', id],
    queryFn: () => intervalsApi.getActivity(id),
    // Single activity - cache for 1 hour, rarely changes
    staleTime: 1000 * 60 * 60,
    // GC after 4 hours to prevent memory bloat when viewing many activities
    gcTime: 1000 * 60 * 60 * 4,
    enabled: !!id,
  });
}

export function useActivityStreams(id: string) {
  return useQuery({
    queryKey: ['activity-streams-v3', id],
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
      ]),
    // Streams NEVER change - infinite staleTime prevents refetching
    staleTime: Infinity,
    // GC after 2 hours - streams are large (100-500KB) and rarely needed after viewing
    gcTime: 1000 * 60 * 60 * 2,
    enabled: !!id,
  });
}

export function useActivityIntervals(id: string) {
  return useQuery<IntervalsDTO>({
    queryKey: ['activity-intervals', id],
    queryFn: () => intervalsApi.getActivityIntervals(id),
    // Intervals never change
    staleTime: Infinity,
    gcTime: 1000 * 60 * 60 * 2,
    enabled: !!id,
  });
}

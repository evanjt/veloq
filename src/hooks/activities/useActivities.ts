import { useQuery, useInfiniteQuery, keepPreviousData } from '@tanstack/react-query';
import { useMemo } from 'react';
import { intervalsApi } from '@/api';
import { formatLocalDate } from '@/lib';
import { getActivityStreams, storeActivityStreams } from '@/lib/storage';
import type { Activity, ActivityStreams } from '@/types';

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
    // Refetch on window/app focus for fresh data
    refetchOnWindowFocus: true,
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
    gcTime: 1000 * 60 * 60 * 24 * 30, // 30 days
    enabled: !!id,
  });
}

/**
 * Fetch activity streams with offline-first support.
 * 1. Check FileSystem cache first
 * 2. If not cached, fetch from API
 * 3. Store in FileSystem for offline access
 */
async function fetchStreamsWithOfflineSupport(id: string): Promise<ActivityStreams> {
  // Try to load from FileSystem cache first
  const cached = await getActivityStreams(id);
  if (cached) {
    return cached;
  }

  // Not cached - fetch from API
  const streams = await intervalsApi.getActivityStreams(id, [
    'latlng',
    'altitude',
    'fixed_altitude',
    'heartrate',
    'watts',
    'cadence',
    'distance',
    'time',
    'velocity_smooth',
  ]);

  // Store in FileSystem for offline access (fire and forget)
  storeActivityStreams(id, streams).catch(() => {
    // Ignore storage errors - not critical
  });

  return streams;
}

export function useActivityStreams(id: string) {
  return useQuery({
    queryKey: ['activity-streams-v3', id],
    queryFn: () => fetchStreamsWithOfflineSupport(id),
    // Streams NEVER change - infinite staleTime
    staleTime: Infinity,
    gcTime: 1000 * 60 * 60 * 24 * 30, // 30 days
    enabled: !!id,
  });
}

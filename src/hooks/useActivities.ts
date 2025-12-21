import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { intervalsApi } from '@/api';
import { formatLocalDate } from '@/lib';
import type { Activity } from '@/types';

interface UseActivitiesOptions {
  /** Number of days to fetch (from today backwards) */
  days?: number;
  /** Start date (YYYY-MM-DD) - overrides days */
  oldest?: string;
  /** End date (YYYY-MM-DD) - defaults to today */
  newest?: string;
  /** Include additional stats fields (eFTP, zone times) - use for performance page */
  includeStats?: boolean;
}

export function useActivities(options: UseActivitiesOptions = {}) {
  const { days, oldest, newest, includeStats = false } = options;

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
    // Include 'stats' in query key to cache separately from non-stats queries
    queryKey: ['activities', queryOldest, queryNewest, includeStats ? 'stats' : 'base'],
    queryFn: () => intervalsApi.getActivities({
      oldest: queryOldest,
      newest: queryNewest,
      includeStats,
    }),
    staleTime: 1000 * 60 * 5, // 5 minutes
    gcTime: 1000 * 60 * 60 * 24 * 7, // 7 days
    placeholderData: keepPreviousData, // Keep previous data visible while fetching new range
  });
}

export function useActivity(id: string) {
  return useQuery({
    queryKey: ['activity', id],
    queryFn: () => intervalsApi.getActivity(id),
    staleTime: 1000 * 60 * 60, // 1 hour
    gcTime: 1000 * 60 * 60 * 24 * 30, // 30 days
    enabled: !!id,
  });
}

export function useActivityStreams(id: string) {
  return useQuery({
    // v2: fixed parsing of latlng data (data + data2)
    queryKey: ['activity-streams-v2', id],
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
      ]),
    staleTime: Infinity, // Streams never change
    gcTime: 1000 * 60 * 60 * 24 * 30, // 30 days
    enabled: !!id,
  });
}

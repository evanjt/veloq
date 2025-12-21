import { useQuery } from '@tanstack/react-query';
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
}

export function useActivities(options: UseActivitiesOptions = {}) {
  const { days, oldest, newest } = options;

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
    queryKey: ['activities', queryOldest, queryNewest],
    queryFn: () => intervalsApi.getActivities({ oldest: queryOldest, newest: queryNewest }),
    staleTime: 1000 * 60 * 5, // 5 minutes
    gcTime: 1000 * 60 * 60 * 24 * 7, // 7 days
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

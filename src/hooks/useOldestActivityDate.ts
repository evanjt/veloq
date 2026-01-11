/**
 * Hook for getting the oldest activity date from the API.
 *
 * Uses the intervals.icu API binary search to efficiently find the oldest
 * activity without fetching the entire activity history.
 */

import { useQuery } from '@tanstack/react-query';
import { intervalsApi } from '@/api';

/** Get the oldest activity date from the user's activities */
export function useOldestActivityDate() {
  return useQuery({
    queryKey: ['oldestActivityDate'],
    queryFn: async () => {
      const dateStr = await intervalsApi.getOldestActivityDate();
      return dateStr ? new Date(dateStr) : null;
    },
    staleTime: 24 * 60 * 60 * 1000, // 24 hours - oldest date rarely changes
    gcTime: 7 * 24 * 60 * 60 * 1000, // Keep in cache for 7 days
  });
}

/**
 * Hook for getting the oldest activity date from the API.
 *
 * Uses the intervals.icu API binary search to efficiently find the oldest
 * activity without fetching the entire activity history.
 */

import { useQuery } from '@tanstack/react-query';
import { intervalsApi } from '@/api';
import { useAuthStore } from '@/providers/AuthStore';
import { queryKeys } from '@/lib/queryKeys';

/** Get the oldest activity date from the user's activities */
export function useOldestActivityDate() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  return useQuery({
    queryKey: queryKeys.calendar.oldestDate,
    queryFn: async () => {
      const dateStr = await intervalsApi.getOldestActivityDate();
      return dateStr ? new Date(dateStr) : null;
    },
    enabled: isAuthenticated,
    staleTime: 0, // Always refetch on mount — prevents stale null from persisting
    gcTime: 7 * 24 * 60 * 60 * 1000, // Keep in cache for 7 days
  });
}

/**
 * Hook to fetch the oldest activity date from the API.
 * This is used to set the timeline slider's minimum date.
 */

import { useQuery } from '@tanstack/react-query';
import { intervalsApi } from '@/api';
import { useAuthStore } from '@/providers';

/**
 * Fetches the oldest activity date from the API.
 * This determines the full extent of the timeline slider.
 */
export function useOldestActivityDate() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  return useQuery({
    queryKey: ['oldest-activity-date'],
    queryFn: () => intervalsApi.getOldestActivityDate(),
    // Cache for 1 hour - this rarely changes
    staleTime: 1000 * 60 * 60,
    gcTime: 1000 * 60 * 60 * 24, // Keep for 24 hours
    enabled: isAuthenticated,
  });
}

import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { intervalsApi } from '@/api';
import { useAuthStore } from '@/providers';
import { formatLocalDate } from '@/lib';
import type { WellnessData } from '@/types';

export type TimeRange = '7d' | '1m' | '42d' | '3m' | '6m' | '1y';

function getDateRange(range: TimeRange): { oldest: string; newest: string } {
  const today = new Date();
  const newest = formatLocalDate(today);

  const daysMap: Record<TimeRange, number> = {
    '7d': 7,
    '1m': 30,
    '42d': 42,
    '3m': 90,
    '6m': 180,
    '1y': 365,
  };

  const oldest = new Date(today);
  oldest.setDate(oldest.getDate() - daysMap[range]);

  return {
    oldest: formatLocalDate(oldest),
    newest,
  };
}

export function useWellness(range: TimeRange = '3m') {
  const { oldest, newest } = getDateRange(range);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  return useQuery<WellnessData[]>({
    queryKey: ['wellness', range],
    queryFn: () => intervalsApi.getWellness({ oldest, newest }),
    // Only fetch if authenticated (prevents 404 when athleteId is missing)
    enabled: isAuthenticated,
    staleTime: 1000 * 60 * 30, // 30 minutes - wellness data changes infrequently
    gcTime: 1000 * 60 * 60 * 24, // 24 hours
    placeholderData: keepPreviousData, // Keep previous data visible while fetching new range
    refetchOnWindowFocus: true, // CTL/ATL/TSB updates on foreground
  });
}

/**
 * Fetch wellness data for a specific date
 * Used for showing Form (CTL/ATL/TSB) on activity detail pages
 */
export function useWellnessForDate(date: string | undefined) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  return useQuery<WellnessData | null>({
    queryKey: ['wellness-date', date],
    queryFn: async () => {
      if (!date) return null;
      // Fetch just this one day
      const data = await intervalsApi.getWellness({
        oldest: date,
        newest: date,
      });
      return data?.[0] || null;
    },
    // Only fetch if authenticated and date is provided
    enabled: isAuthenticated && !!date,
    staleTime: 1000 * 60 * 60, // 1 hour - historical data doesn't change often
    gcTime: 1000 * 60 * 60 * 24, // 24 hours
  });
}

import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { intervalsApi } from '@/api';
import { formatLocalDate } from '@/lib';
import type { WellnessData } from '@/types';

// Re-export fitness utilities for backwards compatibility
export {
  calculateTSB,
  getFormZone,
  FORM_ZONE_COLORS,
  FORM_ZONE_LABELS,
  type FormZone,
} from '@/lib/fitness';

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

  return useQuery<WellnessData[]>({
    queryKey: ['wellness', range],
    queryFn: () => intervalsApi.getWellness({ oldest, newest }),
    staleTime: 1000 * 60 * 15, // 15 minutes
    gcTime: 1000 * 60 * 60 * 24, // 24 hours
    placeholderData: keepPreviousData, // Keep previous data visible while fetching new range
  });
}

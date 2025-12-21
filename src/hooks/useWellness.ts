import { useQuery } from '@tanstack/react-query';
import { intervalsApi } from '@/api';
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

  return useQuery<WellnessData[]>({
    queryKey: ['wellness', range],
    queryFn: () => intervalsApi.getWellness({ oldest, newest }),
    staleTime: 1000 * 60 * 15, // 15 minutes
    gcTime: 1000 * 60 * 60 * 24, // 24 hours
  });
}

// Helper to calculate TSB (Form) from CTL and ATL
export function calculateTSB(wellness: WellnessData[]): (WellnessData & { tsb: number })[] {
  return wellness.map((day) => {
    const ctl = day.ctl ?? day.ctlLoad ?? 0;
    const atl = day.atl ?? day.atlLoad ?? 0;
    return {
      ...day,
      tsb: ctl - atl,
    };
  });
}

// Get the form zone based on TSB value
export type FormZone = 'highRisk' | 'optimal' | 'grey' | 'fresh' | 'transition';

export function getFormZone(tsb: number): FormZone {
  if (tsb < -30) return 'highRisk';
  if (tsb < -10) return 'optimal';
  if (tsb < 5) return 'grey';
  if (tsb < 25) return 'fresh';
  return 'transition';
}

export const FORM_ZONE_COLORS: Record<FormZone, string> = {
  highRisk: '#EF5350', // Red
  optimal: '#66BB6A', // Green
  grey: '#9E9E9E', // Grey
  fresh: '#42A5F5', // Blue
  transition: '#AB47BC', // Purple
};

export const FORM_ZONE_LABELS: Record<FormZone, string> = {
  highRisk: 'High Risk',
  optimal: 'Optimal',
  grey: 'Grey Zone',
  fresh: 'Fresh',
  transition: 'Transition',
};

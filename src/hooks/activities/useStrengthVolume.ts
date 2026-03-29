import { useQuery } from '@tanstack/react-query';
import { getRouteEngine } from '@/lib/native/routeEngine';
import type { StrengthSummary, StrengthPeriod } from '@/types';

function getDateRange(period: StrengthPeriod): { startDate: string; endDate: string } {
  const now = new Date();
  const endDate = now.toISOString().slice(0, 10); // YYYY-MM-DD

  const start = new Date(now);
  switch (period) {
    case 'week':
      start.setDate(start.getDate() - 7);
      break;
    case '4weeks':
      start.setDate(start.getDate() - 28);
      break;
    case '3months':
      start.setMonth(start.getMonth() - 3);
      break;
  }
  const startDate = start.toISOString().slice(0, 10);

  return { startDate, endDate };
}

/**
 * Fetch aggregated strength volume for a time period.
 * Returns muscle group volumes with weighted set counting.
 */
export function useStrengthVolume(period: StrengthPeriod) {
  const { startDate, endDate } = getDateRange(period);

  return useQuery<StrengthSummary>({
    queryKey: ['strength-volume', period, startDate],
    queryFn: () => {
      const engine = getRouteEngine();
      if (!engine || typeof engine.getStrengthSummary !== 'function') {
        return { muscleVolumes: [], activityCount: 0, totalSets: 0 };
      }

      try {
        const raw = engine.getStrengthSummary(startDate, endDate);
        return {
          muscleVolumes: (raw.muscleVolumes ?? []).map(
            (v: {
              slug: string;
              primarySets: number;
              secondarySets: number;
              weightedSets: number;
              totalReps: number;
              totalWeightKg: number;
              exerciseNames: string[];
            }) => ({
              slug: v.slug,
              primarySets: v.primarySets,
              secondarySets: v.secondarySets,
              weightedSets: v.weightedSets,
              totalReps: v.totalReps,
              totalWeightKg: v.totalWeightKg,
              exerciseNames: v.exerciseNames,
            })
          ),
          activityCount: raw.activityCount ?? 0,
          totalSets: raw.totalSets ?? 0,
        };
      } catch (err) {
        console.error('[StrengthVolume] Error:', err);
        return { muscleVolumes: [], activityCount: 0, totalSets: 0 };
      }
    },
    staleTime: 1000 * 60 * 5, // 5 minutes
    gcTime: 1000 * 60 * 30, // 30 minutes
  });
}

/**
 * Check if any strength training data exists in the engine.
 */
export function useHasStrengthData(): boolean {
  const engine = getRouteEngine();
  if (!engine || typeof engine.hasStrengthData !== 'function') return false;
  try {
    return engine.hasStrengthData();
  } catch {
    return false;
  }
}

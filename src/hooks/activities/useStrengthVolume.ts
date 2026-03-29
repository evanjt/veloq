import { useQuery } from '@tanstack/react-query';
import { getRouteEngine } from '@/lib/native/routeEngine';
import type { StrengthSummary, StrengthPeriod } from '@/types';

/**
 * Compute start/end timestamps for a period, rounded to start-of-day
 * so the values are stable within a day (prevents queryKey churn).
 */
function getTimestampRange(period: StrengthPeriod): { startTs: number; endTs: number } {
  const now = new Date();
  // Round to end of today (23:59:59) so it's stable within the day
  now.setHours(23, 59, 59, 0);
  const endTs = Math.floor(now.getTime() / 1000);

  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
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
    case '6months':
      start.setMonth(start.getMonth() - 6);
      break;
  }
  const startTs = Math.floor(start.getTime() / 1000);

  return { startTs, endTs };
}

/**
 * Fetch aggregated strength volume for a time period.
 * Returns muscle group volumes with weighted set counting.
 */
export function useStrengthVolume(period: StrengthPeriod) {
  return useQuery<StrengthSummary>({
    queryKey: ['strength-volume', period],
    queryFn: () => {
      const { startTs, endTs } = getTimestampRange(period);
      const engine = getRouteEngine();
      if (!engine || typeof engine.getStrengthSummary !== 'function') {
        return { muscleVolumes: [], activityCount: 0, totalSets: 0 };
      }

      try {
        const raw = engine.getStrengthSummary(startTs, endTs);
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

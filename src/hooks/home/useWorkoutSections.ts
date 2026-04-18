import { useMemo } from 'react';
import { getRouteEngine } from '@/lib/native/routeEngine';
import { useEngineSubscription } from '@/hooks/routes/useRouteEngine';

export interface WorkoutSection {
  id: string;
  name: string;
  prTimeSecs: number | null;
  /** Second-best time (previous PR before current best) */
  previousBestTimeSecs: number | null;
  lastTimeSecs: number | null;
  daysSinceLast: number | null;
  /** Days since PR was set (based on the activity date of the best record) */
  prDaysAgo: number | null;
  trend: 'improving' | 'stable' | 'declining' | null;
}

/**
 * Home-screen "Sections for you" list.
 *
 * Thin pass-through to `engine.getWorkoutSections` — ranking, PR lookup,
 * previous-best, trend computation all happen in Rust in a single FFI
 * round-trip (was previously an N+1 loop calling `getSectionPerformances`
 * per ranked section from TS).
 */
export function useWorkoutSections(sportType: string | undefined): {
  sections: WorkoutSection[];
} {
  const trigger = useEngineSubscription(['sections']);

  const sections = useMemo<WorkoutSection[]>(() => {
    if (!sportType) return [];
    const engine = getRouteEngine();
    if (!engine) return [];

    return engine.getWorkoutSections(sportType, 5).map((row) => ({
      id: row.id,
      name: row.name,
      prTimeSecs: row.prTimeSecs ?? null,
      previousBestTimeSecs: row.previousBestTimeSecs ?? null,
      lastTimeSecs: row.lastTimeSecs ?? null,
      daysSinceLast: row.daysSinceLast ?? null,
      prDaysAgo: row.prDaysAgo ?? null,
      trend: trendFromString(row.trend),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sportType, trigger]);

  return { sections };
}

function trendFromString(trend: string): WorkoutSection['trend'] {
  if (trend === 'improving' || trend === 'declining' || trend === 'stable') return trend;
  return null;
}

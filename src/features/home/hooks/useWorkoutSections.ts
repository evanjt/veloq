import { useMemo } from 'react';
import { useEngineRead } from '@/shared/native/useEngineSubscription';

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
 * Thin pass-through to `engine.getWorkoutSections` - ranking, PR lookup,
 * previous-best, trend computation all happen in Rust in a single FFI
 * round-trip (was previously an N+1 loop calling `getSectionPerformances`
 * per ranked section from TS).
 */
export function useWorkoutSections(sportType: string | undefined): {
  sections: WorkoutSection[];
} {
  const readSections = useEngineRead(['sections']);

  const sections = useMemo<WorkoutSection[]>(() => {
    if (!sportType) return [];

    return (
      readSections((engine) =>
        engine.getWorkoutSections(sportType, 5).map((row) => ({
          id: row.id,
          name: row.name,
          prTimeSecs: row.prTimeSecs ?? null,
          previousBestTimeSecs: row.previousBestTimeSecs ?? null,
          lastTimeSecs: row.lastTimeSecs ?? null,
          daysSinceLast: row.daysSinceLast ?? null,
          prDaysAgo: row.prDaysAgo ?? null,
          trend: trendLabel(row.trend),
        }))
      ) ?? []
    );
  }, [sportType, readSections]);

  return { sections };
}

/** The engine's three-way verdict, as the label this list renders. */
function trendLabel(trend: number | undefined): WorkoutSection['trend'] {
  if (trend == null) return null;
  if (trend > 0) return 'improving';
  if (trend < 0) return 'declining';
  return 'stable';
}

import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ExerciseSet, MuscleGroup } from 'veloqrs';

import { getEngine } from '@/shared/native/engine';
import { useAuthStore } from '@/shared/app/AuthStore';
import { queryKeys } from '@/shared/query/queryKeys';

import { demoStrengthSets } from '../demo';

function isDemo(): boolean {
  return useAuthStore.getState().isDemoMode;
}

/** How long to keep asking the engine for a fetch it started, before giving up. */
const FIT_POLL_INTERVAL_MS = 1500;
const FIT_POLL_LIMIT = 40;

/**
 * Fetch and cache exercise set data for a WeightTraining activity.
 *
 * On first view Rust downloads the FIT file in the background, parses it and
 * writes the sets to SQLite. The download used to run on this thread, which
 * froze the UI for as long as the network took, so the query reads what is
 * stored and polls while a fetch is in flight.
 *
 * A row in the engine's FIT status table means the activity has settled: parsed,
 * or genuinely carrying no sets, or absent upstream. A download that failed for
 * any other reason records nothing, so the next visit tries again.
 */
export function useExerciseSets(activityId: string, activityType: string) {
  const pollsRef = useRef(0);

  const query = useQuery<ExerciseSet[]>({
    queryKey: queryKeys.strength.exerciseSets(activityId),
    queryFn: () => {
      const engine = getEngine();
      if (!engine) return [];

      // Check if strength() method exists (requires Rust rebuild with StrengthManager)
      if (typeof engine.getExerciseSets !== 'function') {
        console.log('[ExerciseSets] getExerciseSets not available - rebuild required');
        return [];
      }

      try {
        const cached = engine.getExerciseSets(activityId);
        if (cached.length > 0) return cached;

        // A settled activity has nothing more to fetch, whether or not it has sets.
        if (engine.isFitProcessed(activityId)) return [];

        // Demo mode has no FIT file - seed synthetic sets for any fixture
        // activity that carries one, then read back through the normal path.
        if (isDemo() && demoStrengthSets[activityId]) {
          if (typeof engine.bulkInsertExerciseSets !== 'function') {
            console.log('[ExerciseSets] bulkInsertExerciseSets not available - rebuild required');
            return [];
          }
          engine.bulkInsertExerciseSets(activityId, demoStrengthSets[activityId]);
          return engine.getExerciseSets(activityId);
        }

        pollsRef.current += 1;
        engine.fetchAndParseExerciseSets(activityId);
        return [];
      } catch (err) {
        console.error('[ExerciseSets] Error:', err);
        return [];
      }
    },
    enabled: activityType === 'WeightTraining' && !!activityId,
    staleTime: Infinity, // exercise data never changes
    gcTime: 1000 * 60 * 60 * 2, // 2 hours in memory
    // Keep reading while the background download is in flight. Bounded, so a
    // black-hole network costs one minute of polling and not a live timer for
    // as long as the screen is open.
    refetchInterval: (query) =>
      (query.state.data?.length ?? 0) === 0 && pollsRef.current < FIT_POLL_LIMIT
        ? FIT_POLL_INTERVAL_MS
        : false,
  });

  // A remount asks again, which is what makes a transient failure recoverable.
  useEffect(() => {
    pollsRef.current = 0;
  }, [activityId]);

  return query;
}

/**
 * Get aggregated muscle groups for an activity's exercises.
 * Returns slugs compatible with react-native-body-highlighter.
 */
export function useMuscleGroups(activityId: string, hasExercises: boolean) {
  return useQuery<MuscleGroup[]>({
    queryKey: queryKeys.strength.muscleGroups(activityId),
    queryFn: () => {
      const engine = getEngine();
      if (!engine || typeof engine.getMuscleGroups !== 'function') return [];

      try {
        return engine.getMuscleGroups(activityId);
      } catch (err) {
        console.error('[MuscleGroups] Error:', err);
        return [];
      }
    },
    enabled: hasExercises && !!activityId,
    staleTime: Infinity,
    gcTime: 1000 * 60 * 60 * 2,
  });
}

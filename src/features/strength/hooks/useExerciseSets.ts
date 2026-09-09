import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ExerciseSet, MuscleGroup } from 'veloqrs';

import { getEngine } from '@/shared/native/engine';
import { useAuthStore } from '@/shared/app/AuthStore';
import { queryKeys } from '@/shared/query/queryKeys';

import { demoStrengthSets } from '../demo';
import { debug } from '@/shared/debug/debug';

const log = debug.create('ExerciseSets');

function isDemo(): boolean {
  return useAuthStore.getState().isDemoMode;
}

/**
 * Fetch and cache exercise set data for a WeightTraining activity.
 *
 * On first view Rust downloads the FIT file in the background, parses it and
 * writes the sets to SQLite. The query reads what is stored, asks for a fetch
 * when nothing is, and then waits for the engine to announce the parse rather
 * than re-reading on a timer.
 *
 * A row in the engine's FIT status table means the activity has settled: parsed,
 * or genuinely carrying no sets, or absent upstream. A download that failed for
 * any other reason records nothing and announces nothing, so the next visit
 * tries again.
 */
export function useExerciseSets(activityId: string, activityType: string) {
  const enabled = activityType === 'WeightTraining' && !!activityId;
  const queryClient = useQueryClient();

  const query = useQuery<ExerciseSet[]>({
    queryKey: queryKeys.strength.exerciseSets(activityId),
    queryFn: () => {
      const engine = getEngine();
      if (!engine) return [];

      // Check if strength() method exists (requires Rust rebuild with StrengthManager)
      if (typeof engine.getExerciseSets !== 'function') {
        log.log('[ExerciseSets] getExerciseSets not available - rebuild required');
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
            log.log('[ExerciseSets] bulkInsertExerciseSets not available - rebuild required');
            return [];
          }
          engine.bulkInsertExerciseSets(activityId, demoStrengthSets[activityId]);
          return engine.getExerciseSets(activityId);
        }

        engine.fetchAndParseExerciseSets(activityId);
        return [];
      } catch (err) {
        console.error('[ExerciseSets] Error:', err);
        return [];
      }
    },
    enabled,
    staleTime: Infinity, // exercise data never changes
    gcTime: 1000 * 60 * 60 * 2, // 2 hours in memory
  });

  useEffect(() => {
    const engine = enabled ? getEngine() : null;
    if (!engine) return undefined;

    return engine.subscribe('fitParsed', (payload) => {
      if (payload && 'activityId' in payload && payload.activityId !== activityId) return;
      queryClient.invalidateQueries({
        queryKey: queryKeys.strength.exerciseSets(activityId),
      });
    });
  }, [activityId, enabled, queryClient]);

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

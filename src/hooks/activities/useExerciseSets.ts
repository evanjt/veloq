import { useQuery } from '@tanstack/react-query';
import { getRouteEngine } from '@/lib/native/routeEngine';
import { getStoredCredentials, useAuthStore } from '@/providers';
import { queryKeys } from '@/lib/queryKeys';
import { demoStrengthSets } from '@/data/demo/strengthSets';
import type { ExerciseSet, MuscleGroup } from 'veloqrs';

function isDemo(): boolean {
  return useAuthStore.getState().isDemoMode;
}

function buildAuthHeader(): string {
  const creds = getStoredCredentials();
  if (creds.authMethod === 'oauth' && creds.accessToken) {
    return `Bearer ${creds.accessToken}`;
  } else if (creds.apiKey) {
    const encoded = btoa(`API_KEY:${creds.apiKey}`);
    return `Basic ${encoded}`;
  }
  throw new Error('No credentials available');
}

/**
 * Fetch and cache exercise set data for a WeightTraining activity.
 *
 * On first view: downloads FIT file from intervals.icu, parses in Rust,
 * stores in SQLite, returns structured data. Subsequent views read from cache.
 * The FIT binary is not persisted — only the parsed set data.
 */
export function useExerciseSets(activityId: string, activityType: string) {
  return useQuery<ExerciseSet[]>({
    queryKey: queryKeys.strength.exerciseSets(activityId),
    queryFn: () => {
      console.log(`[ExerciseSets] Querying for ${activityId} (type: ${activityType})`);
      const engine = getRouteEngine();
      if (!engine) {
        console.log('[ExerciseSets] No engine available');
        return [];
      }

      // Check if strength() method exists (requires Rust rebuild with StrengthManager)
      if (typeof engine.getExerciseSets !== 'function') {
        console.log('[ExerciseSets] getExerciseSets not available — rebuild required');
        return [];
      }

      try {
        // Check SQLite cache first
        const cached = engine.getExerciseSets(activityId);
        console.log(`[ExerciseSets] Cache: ${cached.length} sets`);

        if (cached.length > 0) return cached;

        // Check if already processed (may have no exercise data in FIT)
        const processed = engine.isFitProcessed(activityId);
        console.log(`[ExerciseSets] Processed: ${processed}`);
        if (processed) return [];

        // Demo mode has no FIT file — seed synthetic sets for any fixture
        // activity that carries one, then read back through the normal path.
        if (isDemo() && demoStrengthSets[activityId]) {
          if (typeof engine.bulkInsertExerciseSets !== 'function') {
            console.log('[ExerciseSets] bulkInsertExerciseSets not available — rebuild required');
            return [];
          }
          engine.bulkInsertExerciseSets(activityId, demoStrengthSets[activityId]);
          return engine.getExerciseSets(activityId);
        }

        // Download, parse, store, return
        console.log(`[ExerciseSets] Fetching FIT file for ${activityId}...`);
        const authHeader = buildAuthHeader();
        const result = engine.fetchAndParseExerciseSets(authHeader, activityId);
        console.log(`[ExerciseSets] Parsed ${result.length} sets`);
        return result;
      } catch (err) {
        console.error('[ExerciseSets] Error:', err);
        return [];
      }
    },
    enabled: activityType === 'WeightTraining' && !!activityId,
    staleTime: Infinity, // exercise data never changes
    gcTime: 1000 * 60 * 60 * 2, // 2 hours in memory
  });
}

/**
 * Get aggregated muscle groups for an activity's exercises.
 * Returns slugs compatible with react-native-body-highlighter.
 */
export function useMuscleGroups(activityId: string, hasExercises: boolean) {
  return useQuery<MuscleGroup[]>({
    queryKey: queryKeys.strength.muscleGroups(activityId),
    queryFn: () => {
      const engine = getRouteEngine();
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

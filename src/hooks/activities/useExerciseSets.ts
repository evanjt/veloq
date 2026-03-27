import { useQuery } from '@tanstack/react-query';
import { getRouteEngine } from '@/lib/native/routeEngine';
import { getStoredCredentials } from '@/providers';
import type { ExerciseSet, MuscleGroup } from 'veloqrs';

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
    queryKey: ['exercise-sets', activityId],
    queryFn: () => {
      const engine = getRouteEngine();
      if (!engine) return [];

      // Check SQLite cache first
      const cached = engine.getExerciseSets(activityId);
      if (cached.length > 0) return cached;

      // Already processed but no sets found
      if (engine.isFitProcessed(activityId)) return [];

      // Download, parse, store, return
      const authHeader = buildAuthHeader();
      return engine.fetchAndParseExerciseSets(authHeader, activityId);
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
    queryKey: ['muscle-groups', activityId],
    queryFn: () => {
      const engine = getRouteEngine();
      if (!engine) return [];
      return engine.getMuscleGroups(activityId);
    },
    enabled: hasExercises && !!activityId,
    staleTime: Infinity,
    gcTime: 1000 * 60 * 60 * 2,
  });
}

import { useMemo } from 'react';
import {
  getMuscleRole,
  MUSCLE_DISPLAY_NAMES,
  type MuscleSlug,
} from '@/lib/strength/exerciseMuscleMap';
import type { ExerciseSet } from 'veloqrs';

export interface ExerciseContribution {
  /** Human-readable exercise name */
  name: string;
  /** Whether this muscle is a primary or secondary target */
  role: 'primary' | 'secondary';
  /** Number of active sets */
  sets: number;
  /** Total reps across all sets */
  reps: number;
  /** Total volume load (weight x reps) in kg */
  volumeKg: number;
}

export interface MuscleGroupDetail {
  /** Display name for the muscle group */
  name: string;
  /** Slug matching body-highlighter format */
  slug: string;
  /** Per-exercise breakdown */
  exercises: ExerciseContribution[];
  /** Totals */
  totalSets: number;
  totalReps: number;
  totalVolumeKg: number;
  /** Count of exercises targeting this muscle as primary vs secondary */
  primaryExercises: number;
  secondaryExercises: number;
}

/**
 * Computes a detailed breakdown of which exercises targeted a specific muscle group.
 * Returns null when no slug is selected.
 */
export function useMuscleDetail(
  slug: string | null,
  exerciseSets: ExerciseSet[]
): MuscleGroupDetail | null {
  return useMemo(() => {
    if (!slug || exerciseSets.length === 0) return null;

    // Group active sets by exercise display name, tracking role
    const exerciseMap = new Map<string, { role: 'primary' | 'secondary'; sets: ExerciseSet[] }>();

    for (const set of exerciseSets) {
      if (set.setType !== 0) continue; // skip rest/warmup/cooldown
      const role = getMuscleRole(set.exerciseCategory, slug);
      if (!role) continue;

      const existing = exerciseMap.get(set.displayName);
      if (existing) {
        existing.sets.push(set);
        // Upgrade to primary if any set targets this muscle as primary
        if (role === 'primary') existing.role = 'primary';
      } else {
        exerciseMap.set(set.displayName, { role, sets: [set] });
      }
    }

    if (exerciseMap.size === 0) return null;

    const exercises: ExerciseContribution[] = [];
    let totalSets = 0;
    let totalReps = 0;
    let totalVolumeKg = 0;
    let primaryExercises = 0;
    let secondaryExercises = 0;

    for (const [name, { role, sets }] of exerciseMap) {
      const reps = sets.reduce((sum, s) => sum + (s.repetitions ?? 0), 0);
      const volumeKg = sets.reduce((sum, s) => sum + (s.weightKg ?? 0) * (s.repetitions ?? 1), 0);

      exercises.push({ name, role, sets: sets.length, reps, volumeKg });
      totalSets += sets.length;
      totalReps += reps;
      totalVolumeKg += volumeKg;
      if (role === 'primary') primaryExercises++;
      else secondaryExercises++;
    }

    // Sort: primary exercises first, then by volume descending
    exercises.sort((a, b) => {
      if (a.role !== b.role) return a.role === 'primary' ? -1 : 1;
      return b.volumeKg - a.volumeKg;
    });

    return {
      name: MUSCLE_DISPLAY_NAMES[slug as MuscleSlug] ?? slug,
      slug,
      exercises,
      totalSets,
      totalReps,
      totalVolumeKg,
      primaryExercises,
      secondaryExercises,
    };
  }, [slug, exerciseSets]);
}

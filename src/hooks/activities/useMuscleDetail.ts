import { useMemo } from 'react';
import { getRouteEngine } from '@/lib/native/routeEngine';
import { MUSCLE_DISPLAY_NAMES, type MuscleSlug } from '@/lib/strength/exerciseMuscleMap';

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
 * Per-activity, per-muscle-group breakdown of exercise contributions.
 *
 * Thin pass-through to `engine.getMuscleDetail` — grouping, role
 * classification, and sorting all happen in Rust. TS only tacks on the
 * localized muscle display name.
 */
export function useMuscleDetail(
  activityId: string | null,
  slug: string | null
): MuscleGroupDetail | null {
  return useMemo(() => {
    if (!slug || !activityId) return null;
    const engine = getRouteEngine();
    if (!engine) return null;
    const detail = engine.getMuscleDetail(activityId, slug);
    if (!detail || detail.exercises.length === 0) return null;
    return {
      name: MUSCLE_DISPLAY_NAMES[slug as MuscleSlug] ?? slug,
      slug: detail.slug,
      exercises: detail.exercises.map((e) => ({
        name: e.name,
        role: e.role === 'primary' ? 'primary' : 'secondary',
        sets: e.sets,
        reps: e.reps,
        volumeKg: e.volumeKg,
      })),
      totalSets: detail.totalSets,
      totalReps: detail.totalReps,
      totalVolumeKg: detail.totalVolumeKg,
      primaryExercises: detail.primaryExercises,
      secondaryExercises: detail.secondaryExercises,
    };
  }, [activityId, slug]);
}

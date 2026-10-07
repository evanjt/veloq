import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useEngineRead } from '@/shared/native/useEngineSubscription';

import { muscleName } from '../lib/muscleNames';

export interface ExerciseContribution {
  name: string;
  role: 'primary' | 'secondary';
  sets: number;
  reps: number;
  volumeKg: number;
}

export interface MuscleGroupDetail {
  name: string;
  slug: string;
  exercises: ExerciseContribution[];
  totalSets: number;
  totalReps: number;
  volumeKg: number;
  primaryExercises: number;
  secondaryExercises: number;
}

/**
 * Per-activity, per-muscle-group breakdown of exercise contributions.
 *
 * Thin pass-through to `engine.getMuscleDetail` - grouping, role
 * classification, and sorting all happen in Rust. TS only tacks on the
 * localized muscle display name.
 */
export function useMuscleDetail(
  activityId: string | null,
  slug: string | null
): MuscleGroupDetail | null {
  const { t } = useTranslation();
  // A FIT parsed after the screen opened is the event, not the ids below.
  const readActivities = useEngineRead(['activities']);
  const name = slug ? muscleName(slug, t) : '';

  return useMemo(() => {
    if (!slug || !activityId) return null;
    const detail = readActivities((engine) => engine.getMuscleDetail(activityId, slug));
    if (!detail || detail.exercises.length === 0) return null;
    return {
      name,
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
      volumeKg: detail.volumeKg,
      primaryExercises: detail.primaryExercises,
      secondaryExercises: detail.secondaryExercises,
    };
  }, [activityId, slug, readActivities, name]);
}

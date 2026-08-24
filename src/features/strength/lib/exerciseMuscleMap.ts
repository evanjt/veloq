/**
 * Static exercise-to-muscle-group mapping.
 * Mirrors modules/veloqrs/rust/veloqrs/src/fit.rs exercise_muscle_groups().
 *
 * Category IDs follow the Garmin FIT SDK Profile v21.133 ExerciseCategory enum.
 * See FIT SDK Profile.xlsx -> Types -> ExerciseCategory for authoritative values.
 *
 * Used by both the activity detail muscle tap feature and the strength insights tab.
 */

export type MuscleSlug =
  | 'abs'
  | 'adductors'
  | 'biceps'
  | 'calves'
  | 'chest'
  | 'deltoids'
  | 'forearm'
  | 'gluteal'
  | 'hamstring'
  | 'lower-back'
  | 'obliques'
  | 'quadriceps'
  | 'trapezius'
  | 'triceps'
  | 'upper-back';

export const MUSCLE_DISPLAY_NAMES: Record<MuscleSlug, string> = {
  abs: 'Abs',
  adductors: 'Adductors',
  biceps: 'Biceps',
  calves: 'Calves',
  chest: 'Chest',
  deltoids: 'Deltoids',
  forearm: 'Forearms',
  gluteal: 'Glutes',
  hamstring: 'Hamstrings',
  'lower-back': 'Lower Back',
  obliques: 'Obliques',
  quadriceps: 'Quadriceps',
  trapezius: 'Trapezius',
  triceps: 'Triceps',
  'upper-back': 'Upper Back',
};

/**
 * Static exercise-to-muscle-group mapping.
 * Mirrors modules/veloqrs/rust/veloqrs/src/fit.rs exercise_muscle_groups().
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

interface MuscleMapping {
  primary: MuscleSlug[];
  secondary: MuscleSlug[];
}

/**
 * Maps FIT exercise category ID to primary and secondary muscle groups.
 * Keep in sync with fit.rs exercise_muscle_groups().
 */
const EXERCISE_MUSCLE_MAP: Record<number, MuscleMapping> = {
  0: { primary: ['chest', 'triceps'], secondary: ['deltoids'] }, // Bench Press
  1: { primary: ['calves'], secondary: [] }, // Calf Raise
  2: { primary: [], secondary: [] }, // Cardio
  3: { primary: ['forearm', 'trapezius'], secondary: ['abs', 'obliques'] }, // Carry
  4: { primary: ['obliques', 'abs'], secondary: ['deltoids'] }, // Chop
  5: { primary: ['abs', 'obliques'], secondary: ['lower-back'] }, // Core
  6: { primary: ['abs'], secondary: ['obliques'] }, // Crunch
  7: { primary: ['biceps'], secondary: ['forearm'] }, // Curl
  8: { primary: ['hamstring', 'gluteal', 'lower-back'], secondary: ['trapezius', 'forearm'] }, // Deadlift
  9: { primary: ['chest'], secondary: ['deltoids'] }, // Flye
  10: { primary: ['gluteal'], secondary: ['hamstring'] }, // Hip Raise
  11: { primary: ['gluteal'], secondary: ['adductors'] }, // Hip Stability
  12: { primary: ['gluteal', 'hamstring'], secondary: ['abs'] }, // Hip Swing
  13: { primary: ['lower-back'], secondary: ['gluteal', 'hamstring'] }, // Hyperextension
  14: { primary: ['deltoids'], secondary: ['trapezius'] }, // Lateral Raise
  15: { primary: ['hamstring'], secondary: ['calves'] }, // Leg Curl
  16: { primary: ['abs'], secondary: ['obliques'] }, // Leg Raise
  17: { primary: ['quadriceps', 'gluteal'], secondary: ['hamstring', 'calves'] }, // Lunge
  18: {
    primary: ['quadriceps', 'gluteal', 'trapezius'],
    secondary: ['deltoids', 'hamstring'],
  }, // Olympic Lift
  19: { primary: ['abs', 'obliques'], secondary: ['lower-back'] }, // Plank
  20: { primary: ['quadriceps', 'calves'], secondary: ['hamstring', 'gluteal'] }, // Plyo
  21: { primary: ['upper-back', 'biceps'], secondary: ['forearm', 'deltoids'] }, // Pull Up
  22: { primary: ['chest', 'triceps'], secondary: ['deltoids', 'abs'] }, // Push Up
  23: { primary: ['upper-back', 'biceps'], secondary: ['lower-back', 'forearm'] }, // Row
  24: { primary: ['deltoids', 'triceps'], secondary: ['trapezius'] }, // Shoulder Press
  25: { primary: ['deltoids'], secondary: ['trapezius'] }, // Shoulder Stability
  26: { primary: ['trapezius'], secondary: [] }, // Shrug
  27: { primary: ['abs'], secondary: ['obliques'] }, // Sit Up
  28: {
    primary: ['quadriceps', 'gluteal'],
    secondary: ['hamstring', 'calves', 'lower-back'],
  }, // Squat
  29: { primary: ['quadriceps', 'chest', 'deltoids'], secondary: ['abs', 'triceps'] }, // Total Body
  30: { primary: ['triceps'], secondary: [] }, // Triceps Extension
};

/**
 * Get primary and secondary muscle groups for an exercise category.
 * Returns empty arrays for unknown/cardio categories.
 */
export function getExerciseMuscles(exerciseCategory: number): MuscleMapping {
  return EXERCISE_MUSCLE_MAP[exerciseCategory] ?? { primary: [], secondary: [] };
}

/**
 * Check if a muscle slug is targeted by a given exercise category.
 * Returns 'primary', 'secondary', or null.
 */
export function getMuscleRole(
  exerciseCategory: number,
  muscleSlug: string
): 'primary' | 'secondary' | null {
  const mapping = EXERCISE_MUSCLE_MAP[exerciseCategory];
  if (!mapping) return null;
  if (mapping.primary.includes(muscleSlug as MuscleSlug)) return 'primary';
  if (mapping.secondary.includes(muscleSlug as MuscleSlug)) return 'secondary';
  return null;
}

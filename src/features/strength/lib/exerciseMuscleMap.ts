/**
 * The English name each muscle slug is shown under.
 *
 * The mapping from an exercise to its muscles belongs to the engine:
 * `exercise_muscle_groups` in `modules/veloqrs/rust/veloqrs/src/fit.rs` decides
 * which slugs a set reports, and nothing here repeats that table. What stays
 * here is the label, which is a UI concern and is translated nowhere else.
 *
 * The slugs are the engine's, so the two lists have to agree:
 * `src/__tests__/bugs/muscleSlugParity.test.ts` fails when they do not. Every
 * call site falls back to the raw slug, so a missing name is `lower-back` on
 * screen rather than a crash.
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

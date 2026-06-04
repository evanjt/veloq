/**
 * Synthetic exercise sets for demo-mode WeightTraining activities.
 *
 * Real WeightTraining activities carry their set data in a FIT file fetched
 * from intervals.icu. Demo mode has no such file, so these sets are seeded
 * directly into Rust via engine.bulkInsertExerciseSets() on first view.
 *
 * Exercise category / name values come from the FIT profile; see
 * https://developer.garmin.com/fit/ FitProfile.xlsx Exercise.csv.
 */

/**
 * Shape of an exercise set passed to the Rust engine.
 * Mirrors modules/veloqrs/rust/veloqrs/src/ffi_types.rs:FfiExerciseSet.
 */
export interface DemoExerciseSet {
  activityId: string;
  setOrder: number;
  /** FIT exercise category enum (4=BenchPress, 25=Squat, 12=Deadlift, …) */
  exerciseCategory: number;
  /** Optional sub-name enum; we leave undefined to use the category's default */
  exerciseName: number | undefined;
  /** Pre-resolved display name (Rust normally derives this; we match the format) */
  displayName: string;
  /** 0=active, 1=rest, 2=warmup, 3=cooldown */
  setType: number;
  repetitions: number | undefined;
  weightKg: number | undefined;
  durationSecs: number | undefined;
}

/**
 * Build a standard strength session for demo-test-6.
 * Bench 3×5 @ 60kg, squat 5×5 @ 80kg, deadlift 1×5 @ 100kg.
 */
function buildDemoTest6Sets(): DemoExerciseSet[] {
  const activityId = 'demo-test-6';
  const sets: DemoExerciseSet[] = [];
  let order = 0;

  const push = (
    exerciseCategory: number,
    displayName: string,
    reps: number,
    weightKg: number,
    count: number
  ): void => {
    for (let i = 0; i < count; i++) {
      sets.push({
        activityId,
        setOrder: order++,
        exerciseCategory,
        exerciseName: undefined,
        displayName,
        setType: 0,
        repetitions: reps,
        weightKg,
        durationSecs: undefined,
      });
    }
  };

  push(4, 'Bench Press', 5, 60, 3);
  push(25, 'Squat', 5, 80, 5);
  push(12, 'Deadlift', 5, 100, 1);

  return sets;
}

/** activity_id → pre-parsed sets, seeded once per demo session. */
export const demoStrengthSets: Record<string, DemoExerciseSet[]> = {
  'demo-test-6': buildDemoTest6Sets(),
};

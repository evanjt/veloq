// The strength page's reading of the engine's screen: the exercise table's rows, how strongly each
// muscle is drawn on the body, and how a balance pair splits between its two sides. Pure, so a test
// drives it without a browser. The volumes, verdicts and trends are the engine's; this only
// arranges them.

import type { Methods } from './schema';

type Screen = Methods['strength.screen']['result'];

export type ExerciseRow = {
  category: number;
  name: string;
  sets: number;
  reps: number;
  volumeKg: number;
  /** The muscles the period's exercises list this exercise under. */
  muscles: string[];
};

/**
 * One row per exercise of the period. The engine lists an exercise under every muscle it works, so
 * a row gathers those muscles, and `muscle` keeps only the exercises listed under it.
 */
export function exerciseRows(groups: Screen['exercises'], muscle: string | null): ExerciseRow[] {
  const rows = new Map<number, ExerciseRow>();
  for (const group of groups) {
    for (const exercise of group.exercises) {
      const held = rows.get(exercise.exerciseCategory);
      if (held) {
        held.muscles.push(group.muscleSlug);
      } else {
        rows.set(exercise.exerciseCategory, {
          category: exercise.exerciseCategory,
          name: exercise.exerciseName,
          sets: exercise.totalSets,
          reps: exercise.totalReps,
          volumeKg: exercise.volumeKg,
          muscles: [group.muscleSlug],
        });
      }
    }
  }
  const all = [...rows.values()];
  return muscle === null ? all : all.filter((row) => row.muscles.includes(muscle));
}

/**
 * How many of the period's exercises target a muscle first and how many only assist it, from the
 * engine's per-muscle exercise lists. None when no muscle is chosen or the period did not train it.
 */
export function muscleSplit(
  groups: Screen['exercises'],
  muscle: string | null
): { primary: number; secondary: number } | null {
  const group = muscle === null ? undefined : groups.find((g) => g.muscleSlug === muscle);
  if (group === undefined) return null;
  const primary = group.exercises.filter((exercise) => exercise.isPrimary).length;
  return { primary, secondary: group.exercises.length - primary };
}

/** The share of a pair's weighted sets each side holds, 0 to 1, or half each when neither was trained. */
export function pairShares(pair: Screen['summary']['balance'][number]): {
  left: number;
  right: number;
} {
  const total = pair.leftWeightedSets + pair.rightWeightedSets;
  return total > 0
    ? { left: pair.leftWeightedSets / total, right: pair.rightWeightedSets / total }
    : { left: 0.5, right: 0.5 };
}

/** The muscle a query names when the period trained it, else none. */
export function chosenMuscle(
  asked: string | null,
  volumes: Screen['summary']['muscleVolumes']
): string | null {
  return asked !== null && volumes.some((volume) => volume.slug === asked) ? asked : null;
}

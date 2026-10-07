/**
 * Scenario: the strength tab holds one screen read and a finger crosses the
 * body diagram, picking a muscle at a time.
 *
 * Expected behaviour: the progression chart and the exercise list under it are
 * selections out of that one read, so a muscle costs nothing beyond a lookup,
 * and a muscle the period never reached still draws an empty list rather than
 * nothing at all.
 */
import { selectExercises, selectProgression } from '@/features/strength/lib/analysis';
import type { StrengthScreenData } from '@/features/strength/types';

const WEEKS = [
  { label: '-3w', startTs: 100, endTs: 199 },
  { label: '-2w', startTs: 200, endTs: 299 },
  { label: '-1w', startTs: 300, endTs: 399 },
  { label: 'This wk', startTs: 400, endTs: 499 },
];

function screenData(): StrengthScreenData {
  return {
    summary: { muscleVolumes: [], activityCount: 0, totalSets: 0, balance: [] },
    weeks: WEEKS,
    weekly: WEEKS.map((_week, index) => ({
      muscleVolumes: [],
      activityCount: index + 1,
      totalSets: 0,
      balance: [],
    })),
    progressions: [
      {
        muscleSlug: 'biceps',
        weeklyWeightedSets: [2, 3, 6, 7],
        recentAverage: 6.5,
        baselineAverage: 2.5,
        peakWeightedSets: 7,
        changePct: 160,
        trend: 'up',
        signalDelta: null,
      },
    ],
    exercises: [
      {
        muscleSlug: 'biceps',
        exercises: [
          {
            exerciseName: 'Curl',
            exerciseCategory: 7,
            totalSets: 6,
            totalReps: 48,
            volumeKg: 1920,
            activityCount: 2,
            isPrimary: true,
          },
        ],
      },
    ],
    owedCount: 0,
  };
}

describe('selectProgression', () => {
  it('labels each week from the ranges the reader holds, in their order', () => {
    const progression = selectProgression(screenData(), 'biceps');

    expect(progression?.points.map((point) => point.label)).toEqual([
      '-3w',
      '-2w',
      '-1w',
      'This wk',
    ]);
    expect(progression?.points.map((point) => point.weightedSets)).toEqual([2, 3, 6, 7]);
    expect(progression?.points.map((point) => point.activityCount)).toEqual([1, 2, 3, 4]);
  });

  it('reads the engine ranking rather than re-deriving it from the weeks', () => {
    const data = screenData();
    data.progressions[0].recentAverage = 42;
    data.progressions[0].changePct = 500;

    const progression = selectProgression(data, 'biceps');

    expect(progression?.recentAverage).toBe(42);
    expect(progression?.changePct).toBe(500);
  });

  it('has nothing to draw for a muscle the weeks never reached', () => {
    expect(selectProgression(screenData(), 'calves')).toBeNull();
    expect(selectProgression(screenData(), null)).toBeNull();
    expect(selectProgression(undefined, 'biceps')).toBeNull();
  });
});

describe('selectExercises', () => {
  it('takes the muscle exercises and the period they are measured over', () => {
    const summary = selectExercises(screenData(), 'biceps');

    expect(summary.exercises.map((exercise) => exercise.exerciseCategory)).toEqual([7]);
  });

  it('reads empty for a muscle the period never reached', () => {
    expect(selectExercises(screenData(), 'calves').exercises).toEqual([]);
    expect(selectExercises(screenData(), null).exercises).toEqual([]);
    expect(selectExercises(undefined, 'biceps').exercises).toEqual([]);
  });
});

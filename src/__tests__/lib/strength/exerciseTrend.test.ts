/**
 * Scenario: the estimated one-rep max trend on an exercise's history placed
 * each session by its index, so two sessions a day apart and two six weeks
 * apart drew the same step.
 *
 * Expected behaviour: each session is placed on its date, so the gap between
 * two sessions takes the width it lasted.
 */

import { seriesChartModel } from '@/features/insights/lib/seriesChart';
import { exerciseTrendSamples } from '@/features/strength/lib/exerciseTrend';
import type { ExerciseDetailData } from 'veloqrs';

type Session = ExerciseDetailData['sessions'][number];

const DAY = 86_400;
const START = Date.UTC(2026, 2, 2) / 1000;

function session(id: string, day: number, estimate: number | undefined): Session {
  return {
    activityId: id,
    activityName: `Workout ${id}`,
    date: START + day * DAY,
    bestSet: { reps: 5, weightKg: 80 },
    estimatedOneRepMaxKg: estimate,
  } as unknown as Session;
}

const positions = (sessions: Session[]) => {
  const model = seriesChartModel(exerciseTrendSamples(sessions), { formatDate: String });
  if (!model) throw new Error('no trend');
  const [left, right] = model.xDomain;
  return model.data.map((d) => (d.x - left) / (right - left));
};

describe('exerciseTrendSamples', () => {
  it('places sessions on days 0, 1 and 30 in proportion to the days between them', () => {
    const [first, second, third] = positions([
      session('a', 0, 90),
      session('b', 1, 92),
      session('c', 30, 95),
    ]);

    expect((second - first) / (third - first)).toBeCloseTo(1 / 30, 5);
  });

  it('carries each estimate and its date', () => {
    const samples = exerciseTrendSamples([session('a', 0, 90), session('b', 7, 92.5)]);

    expect(samples).toEqual([
      { value: 90, date: START },
      { value: 92.5, date: START + 7 * DAY },
    ]);
  });

  it('leaves out a session with no estimate rather than drawing it at zero', () => {
    const samples = exerciseTrendSamples([
      session('a', 0, 90),
      session('b', 3, undefined),
      session('c', 9, 94),
    ]);

    expect(samples.map((s) => s.value)).toEqual([90, 94]);
  });

  it('gives no trend for fewer than two estimates', () => {
    const samples = exerciseTrendSamples([session('a', 0, 90), session('b', 3, undefined)]);

    expect(seriesChartModel(samples, { formatDate: String })).toBeNull();
    expect(exerciseTrendSamples([])).toEqual([]);
  });
});

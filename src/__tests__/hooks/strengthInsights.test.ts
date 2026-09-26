import { generateStrengthInsights } from '@/features/strength/hooks/strengthInsights';
import type { StrengthProgressionRecord, StrengthSummary } from '@/features/strength/types';

const t = (key: string, params?: Record<string, string | number>) => {
  if (!params) return key;
  return `${key}:${JSON.stringify(params)}`;
};

/**
 * The balance verdict is the engine's, so a fixture states it rather than
 * re-deriving it here: `objects/strength.rs` owns the arithmetic and its own
 * tests cover it.
 */
function makeSummary(
  muscles: { slug: string; weightedSets: number }[],
  activityCount = 4,
  balance: StrengthSummary['balance'] = []
): StrengthSummary {
  return {
    muscleVolumes: muscles.map((muscle) => ({
      slug: muscle.slug,
      primarySets: Math.floor(muscle.weightedSets),
      secondarySets: 0,
      weightedSets: muscle.weightedSets,
      totalReps: 0,
      totalWeightKg: 0,
      exerciseNames: [],
    })),
    activityCount,
    totalSets: muscles.reduce((sum, muscle) => sum + Math.round(muscle.weightedSets), 0),
    balance,
  };
}

function makeProgression(
  muscleSlug: string,
  weeklyWeightedSets: number[],
  fields: Partial<StrengthProgressionRecord> = {}
): StrengthProgressionRecord {
  const baseline = weeklyWeightedSets.slice(0, 2);
  const recent = weeklyWeightedSets.slice(-2);
  const average = (values: number[]) =>
    values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1);
  const baselineAverage = average(baseline);
  const recentAverage = average(recent);

  return {
    muscleSlug,
    weeklyWeightedSets,
    recentAverage,
    baselineAverage,
    peakWeightedSets: Math.max(0, ...weeklyWeightedSets),
    changePct:
      baselineAverage > 0 ? ((recentAverage - baselineAverage) / baselineAverage) * 100 : null,
    trend:
      recentAverage > baselineAverage ? 'up' : recentAverage < baselineAverage ? 'down' : 'flat',
    ...fields,
  };
}

describe('generateStrengthInsights', () => {
  it('emits a balance insight when a major antagonist pair is skewed', () => {
    const monthly = makeSummary(
      [
        { slug: 'quadriceps', weightedSets: 12 },
        { slug: 'hamstring', weightedSets: 4 },
        { slug: 'chest', weightedSets: 6 },
        { slug: 'upper-back', weightedSets: 6 },
      ],
      4,
      [
        {
          id: 'quads_hamstrings',
          leftSlug: 'quadriceps',
          rightSlug: 'hamstring',
          leftWeightedSets: 12,
          rightWeightedSets: 4,
          dominantSlug: 'quadriceps',
          ratio: 3,
          status: 'imbalanced',
        },
        {
          id: 'chest_back',
          leftSlug: 'chest',
          rightSlug: 'upper-back',
          leftWeightedSets: 6,
          rightWeightedSets: 6,
          dominantSlug: null,
          ratio: 1,
          status: 'balanced',
        },
      ]
    );
    const weekly = [
      makeSummary([
        { slug: 'quadriceps', weightedSets: 3 },
        { slug: 'hamstring', weightedSets: 1 },
      ]),
      makeSummary([
        { slug: 'quadriceps', weightedSets: 3 },
        { slug: 'hamstring', weightedSets: 1 },
      ]),
      makeSummary([
        { slug: 'quadriceps', weightedSets: 3 },
        { slug: 'hamstring', weightedSets: 1 },
      ]),
      makeSummary([
        { slug: 'quadriceps', weightedSets: 3 },
        { slug: 'hamstring', weightedSets: 1 },
      ]),
    ];

    const result = generateStrengthInsights(monthly, weekly, [], Date.now(), t);
    const balance = result.find((insight) => insight.category === 'strength_balance');
    expect(balance!.navigationTarget).toBe('/insights?tab=strength');
    expect(balance!.title).toContain('Quadriceps');
  });

  it('emits a progression insight for a muscle with clear recent growth', () => {
    const monthly = makeSummary([
      { slug: 'hamstring', weightedSets: 18 },
      { slug: 'quadriceps', weightedSets: 6 },
    ]);
    const weekly = [
      makeSummary([{ slug: 'hamstring', weightedSets: 2 }], 1),
      makeSummary([{ slug: 'hamstring', weightedSets: 3 }], 1),
      makeSummary([{ slug: 'hamstring', weightedSets: 6 }], 1),
      makeSummary([{ slug: 'hamstring', weightedSets: 7 }], 1),
    ];

    const result = generateStrengthInsights(
      monthly,
      weekly,
      [makeProgression('hamstring', [2, 3, 6, 7])],
      Date.now(),
      t
    );
    const progression = result.find((insight) => insight.id === 'strength_progression-hamstring');
    expect(progression!.title).toContain('Hamstrings');
    expect(progression!.supportingData?.sparklineData).toEqual([2, 3, 6, 7]);
  });

  it('does not emit strength insights when there is no meaningful signal', () => {
    const monthly = makeSummary([
      { slug: 'quadriceps', weightedSets: 2 },
      { slug: 'hamstring', weightedSets: 2 },
    ]);
    const weekly = [
      makeSummary(
        [
          { slug: 'quadriceps', weightedSets: 1 },
          { slug: 'hamstring', weightedSets: 1 },
        ],
        1
      ),
      makeSummary(
        [
          { slug: 'quadriceps', weightedSets: 1 },
          { slug: 'hamstring', weightedSets: 1 },
        ],
        1
      ),
      makeSummary([], 0),
      makeSummary([], 0),
    ];

    const result = generateStrengthInsights(
      monthly,
      weekly,
      [makeProgression('quadriceps', [1, 1, 0, 0]), makeProgression('hamstring', [1, 1, 0, 0])],
      Date.now(),
      t
    );
    expect(result).toEqual([]);
  });

  // A record that disagrees with the weekly summaries is the one that shows,
  // which is what proves nothing re-derives the ranking here.
  it('reads the engine ranking rather than the weekly summaries', () => {
    const monthly = makeSummary([{ slug: 'chest', weightedSets: 18 }]);
    const weekly = [
      makeSummary([{ slug: 'chest', weightedSets: 9 }], 1),
      makeSummary([{ slug: 'chest', weightedSets: 9 }], 1),
      makeSummary([{ slug: 'chest', weightedSets: 0 }], 1),
      makeSummary([{ slug: 'chest', weightedSets: 0 }], 1),
    ];

    const result = generateStrengthInsights(
      monthly,
      weekly,
      [makeProgression('chest', [1, 2, 5, 6])],
      Date.now(),
      t
    );
    const progression = result.find((insight) => insight.id === 'strength_progression-chest');

    expect(progression!.supportingData?.sparklineData).toEqual([1, 2, 5, 6]);
    expect(progression!.iconTone).toBe('positive');
  });
});

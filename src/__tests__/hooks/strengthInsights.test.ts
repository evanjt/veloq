import { generateStrengthInsights } from '@/hooks/insights/strengthInsights';
import type { StrengthSummary } from '@/types';

function makeSummary(
  muscles: Array<{ slug: string; weightedSets: number }>,
  activityCount = 4
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
  };
}

describe('generateStrengthInsights', () => {
  it('emits a balance insight when a major antagonist pair is skewed', () => {
    const monthly = makeSummary([
      { slug: 'quadriceps', weightedSets: 12 },
      { slug: 'hamstring', weightedSets: 4 },
      { slug: 'chest', weightedSets: 6 },
      { slug: 'upper-back', weightedSets: 6 },
    ]);
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

    const result = generateStrengthInsights(monthly, weekly, Date.now());
    const balance = result.find((insight) => insight.category === 'strength_balance');
    expect(balance!.navigationTarget).toBe('/routes?tab=strength');
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

    const result = generateStrengthInsights(monthly, weekly, Date.now());
    const progression = result.find((insight) => insight.category === 'strength_progression');
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

    const result = generateStrengthInsights(monthly, weekly, Date.now());
    expect(result).toEqual([]);
  });
});

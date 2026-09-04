/**
 * Scenario: strength insights are generated inside the shared insight
 * pipeline rather than beside it.
 * Expected behaviour: they are scored against `categoryBase`, capped by
 * `maxPerCategory` and counted against `maxTotal`, with no private
 * score-and-pick of their own.
 */
import { generateInsights } from '@/features/insights/lib/generateInsights';
import { INSIGHTS_CONFIG } from '@/features/insights/lib/config';
import { generateStrengthInsights } from '@/features/strength/hooks/strengthInsights';
import type { StrengthSummary } from '@/types';

const t = (key: string, params?: Record<string, string | number>) => {
  if (!params) return key;
  return `${key}:${JSON.stringify(params)}`;
};

function makeSummary(
  muscles: { slug: string; weightedSets: number }[],
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

const GROWING = ['hamstring', 'quadriceps', 'chest', 'upper-back', 'glutes', 'calves'];

function growingMonthly(): StrengthSummary {
  return makeSummary(GROWING.map((slug) => ({ slug, weightedSets: 18 })));
}

function growingWeekly(): StrengthSummary[] {
  return [2, 3, 6, 7].map((sets) =>
    makeSummary(
      GROWING.map((slug) => ({ slug, weightedSets: sets })),
      1
    )
  );
}

function emptyInput() {
  return {
    currentPeriod: null,
    previousPeriod: null,
    ftpTrend: null,
    paceTrend: null,
    recentPRs: [],
    sectionTrends: [],
    formTsb: null,
    formCtl: null,
    formAtl: null,
    peakCtl: null,
    currentCtl: null,
  };
}

describe('strength insights inside the shared pipeline', () => {
  it('surfaces strength insights from generateInsights', () => {
    const result = generateInsights(
      {
        ...emptyInput(),
        strengthMonthly: growingMonthly(),
        strengthWeekly: growingWeekly(),
      },
      t
    );

    expect(result.some((insight) => insight.category === 'strength_progression')).toBe(true);
  });

  it('caps strength progressions with the shared per-category limit', () => {
    const result = generateInsights(
      {
        ...emptyInput(),
        strengthMonthly: growingMonthly(),
        strengthWeekly: growingWeekly(),
      },
      t
    );

    const progressions = result.filter((insight) => insight.category === 'strength_progression');
    expect(progressions).toHaveLength(INSIGHTS_CONFIG.surface.maxPerCategory);
  });

  it('never exceeds the surface cap once strength joins the candidates', () => {
    const result = generateInsights(
      {
        ...emptyInput(),
        strengthMonthly: growingMonthly(),
        strengthWeekly: growingWeekly(),
      },
      t
    );

    expect(result.length).toBeLessThanOrEqual(INSIGHTS_CONFIG.surface.maxTotal);
  });

  it('returns every qualifying progression rather than one private pick', () => {
    const result = generateStrengthInsights(growingMonthly(), growingWeekly(), Date.now(), t);

    const perMuscle = result.filter((insight) => insight.id.startsWith('strength_progression-'));
    expect(perMuscle.map((insight) => insight.id).sort()).toEqual(
      GROWING.map((slug) => `strength_progression-${slug}`).sort()
    );
  });

  it('yields no strength candidates when there is no strength data', () => {
    const result = generateInsights(
      { ...emptyInput(), strengthMonthly: null, strengthWeekly: [] },
      t
    );

    expect(result).toEqual([]);
  });
});

/**
 * Scenario: strength insights are generated inside the shared insight
 * pipeline rather than beside it.
 * Expected behaviour: they are scored against `categoryBase`, capped by
 * `maxPerCategory` and counted against `maxTotal`, with no private
 * score-and-pick of their own.
 */
import { resolvedLocale } from '../i18n/resolvedLocale';
import { generateInsights } from '@/features/insights/lib/generateInsights';
import { INSIGHTS_CONFIG } from '@/features/insights/lib/config';
import { generateStrengthInsights } from '@/features/strength/hooks/strengthInsights';
import type { StrengthProgressionRecord, StrengthSummary } from '@/features/strength/types';

const en = resolvedLocale('en-AU');

const english = en as unknown as { strength: Record<string, Record<string, string>> };
const t = (key: string, params?: Record<string, string | number>) => {
  const [, group, name] = key.match(/^strength\.(muscles|balancePairs)\.(\w+)$/) ?? [];
  if (group) return english.strength[group][name];
  if (!params) return key;
  return `${key}:${JSON.stringify(params)}`;
};

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
      volumeKg: 0,
      exerciseNames: [],
    })),
    activityCount,
    totalSets: muscles.reduce((sum, muscle) => sum + Math.round(muscle.weightedSets), 0),
    balance,
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

function growingProgressions(): StrengthProgressionRecord[] {
  return GROWING.map((slug) => ({
    muscleSlug: slug,
    weeklyWeightedSets: [2, 3, 6, 7],
    recentAverage: 6.5,
    baselineAverage: 2.5,
    peakWeightedSets: 7,
    changePct: 160,
    trend: 'up' as const,
    // The engine's reading of this series: a 4-set rise over weeks whose
    // population deviation is sqrt(4.25).
    signalDelta: 4 / Math.sqrt(4.25),
  }));
}

function emptyInput() {
  return {
    currentPeriod: null,
    previousPeriod: null,
    ftpTrend: null,
    paceTrend: null,
    recentPRs: [],
    sectionTrends: [],
  };
}

describe('strength insights inside the shared pipeline', () => {
  it('surfaces strength insights from generateInsights', () => {
    const result = generateInsights(
      {
        ...emptyInput(),
        strengthMonthly: growingMonthly(),
        strengthWeekly: growingWeekly(),
        strengthProgressions: growingProgressions(),
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
        strengthProgressions: growingProgressions(),
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
        strengthProgressions: growingProgressions(),
      },
      t
    );

    expect(result.length).toBeLessThanOrEqual(INSIGHTS_CONFIG.surface.maxTotal);
  });

  it('returns every qualifying progression rather than one private pick', () => {
    const result = generateStrengthInsights(
      growingMonthly(),
      growingWeekly(),
      growingProgressions(),
      Date.now(),
      t
    );

    const perMuscle = result.filter((insight) => insight.id.startsWith('strength_progression-'));
    expect(perMuscle.map((insight) => insight.id).sort()).toEqual(
      GROWING.map((slug) => `strength_progression-${slug}`).sort()
    );
  });

  it('yields no strength candidates when there is no strength data', () => {
    const result = generateInsights(
      { ...emptyInput(), strengthMonthly: null, strengthWeekly: [], strengthProgressions: [] },
      t
    );

    expect(result).toEqual([]);
  });
});

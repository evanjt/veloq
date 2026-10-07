import { resolvedLocale } from '../i18n/resolvedLocale';
import { generateStrengthInsights } from '@/features/strength/hooks/strengthInsights';
import type {
  StrengthBalancePair,
  StrengthProgressionRecord,
  StrengthSummary,
} from '@/features/strength/types';
import { formatBalanceRatio } from '@/features/strength/lib/formatting';

const en = resolvedLocale('en-AU');

const english = en as unknown as { strength: Record<string, Record<string, string>> };
const t = (key: string, params?: Record<string, string | number>) => {
  const [, group, name] = key.match(/^strength\.(muscles|balancePairs)\.(\w+)$/) ?? [];
  if (group) return english.strength[group][name];
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
      volumeKg: 0,
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
    signalDelta: null,
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
      { slug: 'quadriceps', weightedSets: 1 },
      { slug: 'hamstring', weightedSets: 1 },
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
    expect(progression!.iconTone).toBe('neutral');
  });

  it('labels a one-sided pair one-sided in every row it draws', () => {
    const monthly = makeSummary(
      [
        { slug: 'quadriceps', weightedSets: 6 },
        { slug: 'hamstring', weightedSets: 0 },
      ],
      4,
      [
        {
          id: 'quads_hamstrings',
          leftSlug: 'quadriceps',
          rightSlug: 'hamstring',
          leftWeightedSets: 6,
          rightWeightedSets: 0,
          dominantSlug: 'quadriceps',
          ratio: null,
          status: 'one-sided',
        },
      ]
    );

    const result = generateStrengthInsights(monthly, [monthly], [], Date.now(), t);
    const balance = result.find((insight) => insight.category === 'strength_balance');
    const rows = Object.fromEntries(
      (balance!.supportingData?.dataPoints ?? []).map((point) => [point.label, point.value])
    );

    expect(rows['insights.strengthBalance.ratioLabel']).toBe('insights.strengthBalance.oneSided');
    expect(rows['insights.strengthBalance.statusLabel']).toBe('insights.strengthBalance.oneSided');
  });
});

describe('the progression reading the ranker scores', () => {
  const monthly = makeSummary([{ slug: 'hamstring', weightedSets: 18 }]);
  const weekly = [0, 1, 2, 3].map(() => makeSummary([{ slug: 'hamstring', weightedSets: 4 }], 1));

  const progressionInsight = (record: StrengthProgressionRecord) =>
    generateStrengthInsights(monthly, weekly, [record], Date.now(), t).find(
      (insight) => insight.id === 'strength_progression-hamstring'
    );

  it('is the engine reading the record carries', () => {
    const insight = progressionInsight(
      makeProgression('hamstring', [2, 3, 6, 7], { signalDelta: 0.42 })
    );

    expect(insight!.meta?.signalDelta).toBe(0.42);
  });

  it('is absent when the engine sent none', () => {
    const insight = progressionInsight(makeProgression('hamstring', [2, 3, 6, 7]));

    expect(insight).toBeDefined();
    expect(insight!.meta?.signalDelta).toBeUndefined();
  });
});

describe('the progression body', () => {
  const monthly = makeSummary([{ slug: 'hamstring', weightedSets: 18 }]);
  const weekly = [0, 1, 2, 3].map(() => makeSummary([{ slug: 'hamstring', weightedSets: 4 }], 1));

  const bodyFor = (weeks: number[]) =>
    generateStrengthInsights(
      monthly,
      weekly,
      [makeProgression('hamstring', weeks)],
      Date.now(),
      t
    ).find((insight) => insight.id === 'strength_progression-hamstring')?.body;

  it('gives both averages when the volume starts from zero', () => {
    expect(bodyFor([0, 0, 4, 8])).toBe(
      t('insights.strengthProgression.shiftBody', { muscle: 'Hamstrings', from: '0', to: '6' })
    );
  });

  it('gives both averages when the volume starts from something', () => {
    expect(bodyFor([2, 4, 6, 8])).toBe(
      t('insights.strengthProgression.shiftBody', { muscle: 'Hamstrings', from: '3', to: '7' })
    );
  });

  it('has nothing to say about a muscle with no volume either side', () => {
    expect(bodyFor([0, 0, 0, 0])).toBeUndefined();
  });
});

describe('the one ratio formatter', () => {
  const pair = (fields: Partial<StrengthBalancePair>): StrengthBalancePair => ({
    id: 'p',
    label: 'Pair',
    leftSlug: 'a',
    rightSlug: 'b',
    dominantSlug: null,
    leftLabel: 'A',
    rightLabel: 'B',
    leftWeightedSets: 0,
    rightWeightedSets: 0,
    ratio: null,
    status: 'insufficient',
    dominantLabel: null,
    ...fields,
  });

  it('prints the one-sided copy for a pair with no ratio', () => {
    expect(formatBalanceRatio(pair({ status: 'one-sided' }), t)).toBe(
      'insights.strengthBalance.oneSided'
    );
  });

  it('prints the no-signal copy when there is nothing to divide', () => {
    expect(formatBalanceRatio(pair({}), t)).toBe('insights.strengthBalance.noSignal');
  });

  it('prints the ratio when there is one', () => {
    expect(formatBalanceRatio(pair({ ratio: 1.24, status: 'balanced' }), t)).toBe('1.2x');
    expect(formatBalanceRatio(pair({ ratio: 12.4, status: 'imbalanced' }), t)).toBe('12x');
  });
});

describe('the strength gates', () => {
  it('emits the snapshot at exactly the minimum sets, as the per-muscle gate does', () => {
    const monthly = makeSummary([{ slug: 'hamstring', weightedSets: 4 }]);
    const weekly = [makeSummary([{ slug: 'hamstring', weightedSets: 4 }], 1)];
    const ids = generateStrengthInsights(monthly, weekly, [], Date.now(), t).map((i) => i.id);
    expect(ids).toContain('strength_snapshot');
  });

  it('takes the engine trend as the verdict whatever the rounded change reads', () => {
    const monthly = makeSummary([{ slug: 'hamstring', weightedSets: 18 }]);
    const weekly = [makeSummary([{ slug: 'hamstring', weightedSets: 6 }], 1)];
    const progression = makeProgression('hamstring', [5, 5, 6, 6], {
      changePct: 10,
      trend: 'up',
    });
    const ids = generateStrengthInsights(monthly, weekly, [progression], Date.now(), t).map(
      (i) => i.id
    );
    expect(ids).toContain('strength_progression-hamstring');
  });

  it.each([
    ['up', [2, 3, 5, 6], 120],
    ['down', [4, 4, 0, 1], -80],
  ] as const)('judges a %s move in weekly sets on the neutral rung', (trend, weeks, changePct) => {
    const monthly = makeSummary([{ slug: 'chest', weightedSets: 14 }]);
    const weekly = [makeSummary([{ slug: 'chest', weightedSets: 6 }], 1)];
    const progression = generateStrengthInsights(
      monthly,
      weekly,
      [makeProgression('chest', [...weeks], { changePct, trend })],
      Date.now(),
      t
    ).find((insight) => insight.id === 'strength_progression-chest');

    expect(progression!.iconTone).toBe('neutral');
    expect(progression!.supportingData?.trend).toEqual({ direction: trend, verdict: 'moved' });
  });
});

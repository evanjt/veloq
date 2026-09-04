/**
 * Scenario: the engine ships a per-effort HR/pace series with every
 * efficiency trend in the insights bundle.
 * Expected behaviour: the insight carries the series, so the detail sheet
 * plots the efforts the claim rests on.
 */

import type { EfficiencyTrend } from 'veloqrs';
import { generateEfficiencyTrendInsights } from '@/features/insights/generators/efficiencyTrend';

const NOW = 1_700_000_000_000;
const t = (key: string) => key;

function point(ratio: number) {
  return {
    date: BigInt(1),
    paceSecsPerKm: 240,
    avgHr: 150,
    hrPaceRatio: ratio,
  };
}

function trend(overrides: Partial<EfficiencyTrend> = {}): EfficiencyTrend {
  return {
    sectionId: 'sec-1',
    sectionName: 'Church Hill',
    points: [point(0.64), point(0.62), point(0.59), point(0.58)],
    trendSlope: -0.0004,
    isImproving: true,
    hrChangeBpm: -6.2,
    effortCount: 4,
    ...overrides,
  } as EfficiencyTrend;
}

it('carries the HR/pace series onto the insight', () => {
  const [insight] = generateEfficiencyTrendInsights([trend()], NOW, t);

  expect(insight.supportingData?.sparklineData).toEqual([0.64, 0.62, 0.59, 0.58]);
  expect(insight.supportingData?.sparklineLabel).toBe('insights.efficiencyTrend.seriesLabel');
});

it('omits the series when the engine sent no points', () => {
  const [insight] = generateEfficiencyTrendInsights([trend({ points: [] })], NOW, t);

  expect(insight.supportingData?.sparklineData).toBeUndefined();
  expect(insight.supportingData?.sparklineLabel).toBeUndefined();
});

it('omits a one-point series, which plots nothing', () => {
  const [insight] = generateEfficiencyTrendInsights([trend({ points: [point(0.6)] })], NOW, t);

  expect(insight.supportingData?.sparklineData).toBeUndefined();
});

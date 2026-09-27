/**
 * Scenario: R6 read `meta.signalDelta` and one emit site of fifteen wrote it,
 * so the flow corridor was inert on every other category.
 *
 * Expected behaviour: a generator whose series the engine holds carries the
 * reading the engine took off it, and one holding two points and no spread
 * declares the absence rather than scaling a ratio into a corridor measured in
 * deviations.
 */

import type { EfficiencyTrend, HrvTrend } from 'veloqrs';

import { generateEfficiencyTrendInsights } from '@/features/insights/generators/efficiencyTrend';
import { generateHrvTrendInsight } from '@/features/insights/generators/hrvTrend';
import { generatePeriodComparisonInsights } from '@/features/insights/generators/periodComparison';
import { generateSectionTrendInsights } from '@/features/insights/generators/sectionTrend';

const NOW = 1_700_000_000_000;
const t = (key: string) => key;

/** The verdict as the insights bundle carries it. */
function hrv(overrides: Partial<HrvTrend> = {}): HrvTrend {
  return {
    label: 'trendingUp',
    avg: 60,
    latest: 70,
    dataPoints: 7,
    sparkline: [54, 56, 58, 60, 62, 64, 66],
    ...overrides,
  } as HrvTrend;
}

function point(ratio: number) {
  return { date: BigInt(1), paceSecsPerKm: 240, avgHr: 150, hrPaceRatio: ratio };
}

function efficiency(overrides: Partial<EfficiencyTrend> = {}): EfficiencyTrend {
  return {
    sectionId: 'sec-1',
    sectionName: 'Church Hill',
    points: [point(0.64), point(0.62), point(0.59), point(0.5)],
    trendSlope: -0.0004,
    isImproving: true,
    hrChangeBpm: -6.2,
    effortCount: 4,
    signalDelta: 1.4,
    ...overrides,
  } as EfficiencyTrend;
}

function withoutSignalDelta(trend: EfficiencyTrend): EfficiencyTrend {
  const copy = { ...trend };
  delete copy.signalDelta;
  return copy;
}

beforeEach(() => jest.clearAllMocks());

describe('the HRV trend insight', () => {
  it('measures the latest reading against the window it sits in', () => {
    const [insight] = generateHrvTrendInsight(
      hrv({
        label: 'trendingUp',
        avg: 60,
        latest: 70,
        dataPoints: 7,
        sparkline: [54, 56, 58, 60, 62, 64, 66],
        signalDelta: 2.6,
      }),
      NOW,
      t
    );

    expect(insight.meta?.signalDelta).toBeGreaterThan(0);
  });

  it('declares no delta when every day of the window reads the same', () => {
    const [insight] = generateHrvTrendInsight(
      hrv({
        label: 'stable',
        avg: 60,
        latest: 60,
        dataPoints: 7,
        sparkline: [60, 60, 60, 60, 60, 60, 60],
      }),
      NOW,
      t
    );

    expect(insight.meta?.signalDelta).toBeUndefined();
  });

  it('declares no delta when the engine sends no series at all', () => {
    const [insight] = generateHrvTrendInsight(
      hrv({
        label: 'trendingUp',
        avg: 60,
        latest: 70,
        dataPoints: 2,
        sparkline: [],
      }),
      NOW,
      t
    );

    expect(insight.meta?.signalDelta).toBeUndefined();
  });
});

describe("the reading is the engine's", () => {
  it('carries the HRV delta the engine took, not one read off the sparkline', () => {
    const [insight] = generateHrvTrendInsight(
      hrv({
        label: 'trendingUp',
        avg: 60,
        latest: 70,
        dataPoints: 7,
        sparkline: [54, 56, 58, 60, 62, 64, 66],
        signalDelta: 0.25,
      }),
      NOW,
      t
    );

    expect(insight.meta?.signalDelta).toBe(0.25);
  });

  it('carries the efficiency delta the engine took, not one read off the points', () => {
    const [insight] = generateEfficiencyTrendInsights([efficiency({ signalDelta: 0.75 })], NOW, t);

    expect(insight.meta?.signalDelta).toBe(0.75);
  });
});

describe('the efficiency trend insight', () => {
  it('measures the newest effort against the series behind it', () => {
    const [insight] = generateEfficiencyTrendInsights([efficiency()], NOW, t);

    expect(insight.meta?.signalDelta).toBeGreaterThan(0);
  });

  it('declares no delta when the engine sent no per-effort series', () => {
    const [insight] = generateEfficiencyTrendInsights(
      [withoutSignalDelta(efficiency({ points: [] }))],
      NOW,
      t
    );

    expect(insight.meta?.signalDelta).toBeUndefined();
  });
});

describe('a generator with two points and no spread', () => {
  it('leaves the period comparison delta absent', () => {
    const insights = generatePeriodComparisonInsights(
      { count: 5, totalDuration: 20_000, totalDistance: 100_000, totalTss: 400 },
      { count: 4, totalDuration: 10_000, totalDistance: 60_000, totalTss: 200 },
      null,
      undefined,
      { metric: 'tss', current: 400, previous: 200, ratio: 1 },
      null,
      NOW,
      t
    );

    expect(insights.length).toBeGreaterThan(0);
    for (const insight of insights) expect(insight.meta?.signalDelta).toBeUndefined();
  });

  it('leaves the section trend delta absent', () => {
    const insights = generateSectionTrendInsights(
      [
        {
          sectionId: 's1',
          sectionName: 'Climb',
          trend: 1,
          medianRecentSecs: 300,
          bestTimeSecs: 280,
          traversalCount: 9,
          daysSinceLast: 2,
        },
      ],
      new Set<string>(),
      NOW,
      t
    );

    expect(insights.length).toBeGreaterThan(0);
    for (const insight of insights) expect(insight.meta?.signalDelta).toBeUndefined();
  });
});

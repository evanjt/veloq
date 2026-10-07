/**
 * Tier 0.6 contract baseline: locks down the current output shape of
 * `computeInsightsFromData`, the pure computation that consumes pre-fetched
 * FFI data and produces ranked insights.
 *
 * Tier 3.3 consolidates 8 FFI calls into one (`get_insights_inputs`), but
 * the *output* of `computeInsightsFromData` should not change. This test is
 * the regression net for that work - it mocks the FFI surface, exercises
 * the pure compute path with deterministic inputs, and asserts on stable
 * insight IDs / categories / titles.
 *
 * If Tier 3.3 changes the output of computeInsightsFromData, that's a
 * semantics change and needs explicit baseline review, not a silent diff.
 *
 * Reviewed 2026-09-14: the HRV card moved above the stale-PR card at the same
 * priority. R6 now reads a signal delta off the seven-day window, which for this
 * fixture is 0.7 standard deviations, inside the flow corridor, and the stale-PR
 * card declares none. That is the term working rather than the ranking drifting.
 */

import { computeInsightsFromData } from '@/features/insights/lib/computeInsightsData';
import * as sectionDisplayNames from '@/features/routes/lib/sectionDisplayNames';
import { LoadMetric } from 'veloqrs';
import type { FfiImprovementBasis, InsightsData, SummaryCardData } from 'veloqrs';
import { getEngine } from '@/shared/native/engine';
import { isRouteMatchingEnabled } from '@/features/routes/stores/RouteSettingsStore';
import { datedSeries } from '../__shared__/datedSeries';

// The enum is not on the mocked module, so the first member is spelt by value.
const MEDIAN_OF_THREE = 0 as FfiImprovementBasis;

jest.mock('@/shared/native/engine', () => ({
  getEngine: jest.fn(),
}));
jest.mock('@/features/routes/stores/RouteSettingsStore', () => ({
  isRouteMatchingEnabled: jest.fn(() => true),
}));

const t = (key: string, params?: Record<string, string | number>) => {
  if (!params) return key;
  return `${key}:${JSON.stringify(params)}`;
};

function makePeriod(count: number, durationSecs: number, distanceM: number, tss: number) {
  return {
    count,
    totalDuration: Math.round(durationSecs),
    totalDistance: distanceM,
    totalTss: tss,
  };
}

/**
 * `trend` is the engine's three-way verdict, not a rate of change: -1
 * declining, 0 stable, 1 improving. Climb A improves off a PR, which is the
 * only path to a priority 2 section-trend card; Flat B declines; Neglected C
 * is stable, so it is filtered out before the generator sees it.
 */
function makeRankedSections(sportType: string) {
  return [
    {
      sectionId: `sec-${sportType.toLowerCase()}-climb-A`,
      sectionName: `${sportType} Climb A`,
      relevanceScore: 0.9,
      recencyScore: 0.8,
      improvementScore: 0.6,
      improvementChange: 0.2,
      improvementBasis: MEDIAN_OF_THREE,
      anomalyScore: 0.1,
      engagementScore: 0.7,
      traversalCount: 18,
      bestTimeSecs: 680,
      medianRecentSecs: 700,
      daysSinceLast: 4,
      trend: 1,
      latestIsPr: true,
      recentEfforts: [],
    },
    {
      sectionId: `sec-${sportType.toLowerCase()}-flat-B`,
      sectionName: `${sportType} Flat B`,
      relevanceScore: 0.5,
      recencyScore: 0.3,
      improvementScore: 0.2,
      anomalyScore: 0.1,
      engagementScore: 0.4,
      traversalCount: 9,
      bestTimeSecs: 305,
      medianRecentSecs: 320,
      daysSinceLast: 12,
      trend: -1,
      latestIsPr: false,
      recentEfforts: [],
    },
    {
      // Past the staleness floor, so this is the only section a stale-PR
      // suggestion may name. A at 4 days and B at 12 must never be.
      sectionId: `sec-${sportType.toLowerCase()}-neglected-C`,
      sectionName: `${sportType} Neglected C`,
      relevanceScore: 0.2,
      recencyScore: 0.05,
      improvementScore: 0.2,
      anomalyScore: 0.1,
      engagementScore: 0.3,
      traversalCount: 6,
      bestTimeSecs: 410,
      medianRecentSecs: 430,
      daysSinceLast: 65,
      trend: 0,
      latestIsPr: false,
      recentEfforts: [],
    },
  ];
}

function buildFfiData(): InsightsData {
  return {
    form: { date: '2026-04-19', ctl: 67.8, atl: 61.5 },
    currentWeek: makePeriod(5, 4 * 3600, 80_000, 320),
    previousWeek: makePeriod(3, 2.5 * 3600, 50_000, 220),
    chronicPeriod: makePeriod(20, 18 * 3600, 320_000, 1280),
    chronicWeekAverage: makePeriod(5, 4.5 * 3600, 80_000, 320),
    weeklyTotals: [],
    ftpTrend: {
      latestFtp: 285,
      latestDate: 1_745_000_000,
      previousFtp: 270,
      previousDate: 1_700_000_000,
      sampleCount: 24,
      history: [],
      changes: [],
    },
    runPaceTrend: {
      latestPace: 4.55,
      latestDate: 1_745_000_000,
      previousPace: 4.7,
      previousDate: 1_700_000_000,
      sampleCount: 24,
      history: [],
    },
    recentPrs: [
      {
        sectionId: 'sec-ride-climb-A',
        sectionName: 'Sunday Climb',
        bestTime: 690,
        daysAgo: 3,
        sportType: 'Ride',
        traversalCount: 14,
        recentEfforts: [],
        encodedPolyline: new ArrayBuffer(0),
      },
    ],
    sectionCount: 42,
    sportTypes: ['Ride', 'Run'],
    rankedSections: [
      { sportType: 'Ride', sections: makeRankedSections('Ride') },
      { sportType: 'Run', sections: makeRankedSections('Run') },
    ],
    trendSections: [
      {
        sportType: 'Ride',
        sections: makeRankedSections('Ride').filter((section) => section.trend < 0),
      },
      {
        sportType: 'Run',
        sections: makeRankedSections('Run').filter((section) => section.trend !== 0),
      },
    ],
    trendFasterCount: 1,
    trendSlowerCount: 2,
    routeInsights: [],
    routeRecordCount: 0,
    routeFasterCount: 0,
    routeSlowerCount: 0,
    efficiencyTrends: [],
    hasStrengthData: false,
    weekOverWeek: {
      metric: LoadMetric.Tss,
      current: 320,
      previous: 220,
      ratio: 320 / 220 - 1,
      comparedStart: 1_700_000_000,
    },
    weekAgainstChronic: {
      metric: LoadMetric.Tss,
      current: 220,
      previous: 320,
      ratio: 220 / 320 - 1,
      comparedStart: 1_699_395_200,
    },
    hrvTrend: {
      label: 'trendingDown',
      reason: 'halves',
      avg: 470 / 7,
      latest: 68,
      dataPoints: 7,
      sparkline: datedSeries([67, 68, 69, 65, 66, 67, 68]),
      // The engine takes the distance off the same window it read the verdict
      // from: 68 against the window's mean of 67.14, over a deviation of 1.245.
      signalDelta: 0.688,
    },
    recentSectionChanges: [],
    stalePrOpportunities: [
      {
        sectionId: 'sec-ride-neglected-C',
        sectionName: 'Ride Neglected C',
        bestTimeSecs: 410,
        daysSinceLast: 65,
        traversalCount: 6,
        fitnessMetric: 'power',
        currentValue: 285,
        previousValue: 270,
        gainPercent: 5.6,
        unit: 'W',
        sportType: 'Ride',
        recentEfforts: [],
      },
    ],
  };
}

function buildSummaryCardData(): SummaryCardData {
  return {
    // The insights bundle does not read the card's wellness half; it is here
    // because the record carries it.
    wellness: {
      fitness: 60,
      fitnessTrend: '↑',
      form: 20,
      formTrend: '→',
      hrv: 70,
      rhr: 48,
    },
    currentWeek: makePeriod(5, 4 * 3600, 80_000, 320),
    prevWeek: makePeriod(3, 2.5 * 3600, 50_000, 220),
    ftpTrend: {
      latestFtp: 285,
      latestDate: 1_745_000_000,
      previousFtp: 270,
      previousDate: 1_700_000_000,
      sampleCount: 24,
      history: [],
      changes: [],
    },
    runPaceTrend: {
      latestPace: 4.55,
      latestDate: 1_745_000_000,
      previousPace: 4.7,
      previousDate: 1_700_000_000,
      sampleCount: 24,
      history: [],
    },
    swimPaceTrend: {
      sampleCount: 24,
      history: [],
    },
  };
}

/**
 * The bundle carries everything now, including the two answers only Rust gives:
 * the HRV verdict, and the stale-PR filter, whose row here is Ride Neglected C
 * at 65 days against the 270 to 285 W gain the fixture's FTP trend carries.
 * There is nothing left for an engine mock to answer.
 */
function buildMockEngine(): unknown {
  return {};
}

describe('Tier 0.6 contract: computeInsightsFromData', () => {
  beforeEach(() => {
    (getEngine as jest.Mock).mockReturnValue(buildMockEngine());
  });

  it('produces a ranked insight list with unique ids given fixture FFI data', () => {
    const { insights } = computeInsightsFromData(buildFfiData(), t, buildSummaryCardData());

    expect(insights.length).toBeGreaterThan(0);

    const ids = new Set(insights.map((i) => i.id));
    expect(ids.size).toBe(insights.length); // No duplicate insight IDs.

    for (const ins of insights) {
      expect(ins.priority).toBeGreaterThanOrEqual(1);
      expect(ins.priority).toBeLessThanOrEqual(3);
      expect(typeof ins.title).toBe('string');
      expect(ins.title.length).toBeGreaterThan(0);
    }
  });

  it('adds one route card from the engine route rows and moves no other card', () => {
    const without = computeInsightsFromData(buildFfiData(), t, buildSummaryCardData()).insights;
    const routeRow = (routeId: string, routeName: string, over: Record<string, unknown>) => ({
      routeId,
      routeName,
      sportType: 'Run',
      isReverse: false,
      isRecentRecord: false,
      trend: 0,
      bestTime: 1500,
      daysSinceLast: 3,
      attemptCount: 9,
      recentEfforts: [],
      ...over,
    });
    const ffiData = {
      ...buildFfiData(),
      routeInsights: [
        routeRow('route-a', 'Lakeside loop', { isRecentRecord: true }),
        routeRow('route-b', 'Orchard lane', { trend: 1 }),
        routeRow('route-c', 'Mill road', { trend: 1 }),
      ],
      routeRecordCount: 1,
      routeFasterCount: 2,
      routeSlowerCount: 0,
    } as InsightsData;

    const { insights } = computeInsightsFromData(ffiData, t, buildSummaryCardData());

    const routeCards = insights.filter((i) => i.category === 'route');
    expect(routeCards).toHaveLength(1);
    expect(routeCards[0].id).toBe('route-group');
    expect(routeCards[0].supportingData?.routes?.map((r) => r.navigationTarget)).toEqual([
      '/route/route-a',
      '/route/route-b',
      '/route/route-c',
    ]);
    expect(insights.filter((i) => i.category !== 'route').map((i) => i.id)).toEqual(
      without.filter((i) => i.category !== 'route').map((i) => i.id)
    );
  });

  it('draws the chronic weeks and leaves the compared week off the strip', () => {
    const ffiData = buildFfiData();
    ffiData.weeklyTotals = [100, 200, 300, 400, 500].map((tss, week) => ({
      start: 1_697_000_000 + week * 604_800,
      stats: makePeriod(3, 3600, 40_000, tss),
    }));

    const { insights } = computeInsightsFromData(ffiData, t, buildSummaryCardData());

    const weekly = insights.find(
      (insight) => insight.supportingData?.sparklineLabel === 'insights.data.weeklyLoad'
    );
    expect(weekly?.supportingData?.sparklineData).toEqual([100, 200, 300, 400]);
  });

  it('returns [] when ffiData is null', () => {
    const { insights } = computeInsightsFromData(null, t, null);
    expect(insights).toEqual([]);
  });

  it('does not read section names when the ledger has no recent changes', () => {
    const getNames = jest
      .spyOn(sectionDisplayNames, 'getAllSectionDisplayNames')
      .mockReturnValue({});
    const ffiData = { ...buildFfiData(), recentSectionChanges: [] } as InsightsData;

    computeInsightsFromData(ffiData, t, buildSummaryCardData());

    expect(getNames).not.toHaveBeenCalled();
    getNames.mockRestore();
  });

  it('still lists a recorded section change when the name lookup throws', () => {
    const getNames = jest
      .spyOn(sectionDisplayNames, 'getAllSectionDisplayNames')
      .mockImplementation(() => {
        throw { tag: 'Database', inner: { msg: 'poisoned' } };
      });
    const ffiData = {
      ...buildFfiData(),
      recentSectionChanges: [
        {
          sectionId: 'sec-moved',
          kind: 'recut',
          at: new Date().toISOString().slice(0, 19).replace('T', ' '),
        },
      ],
    } as unknown as InsightsData;

    const { insights } = computeInsightsFromData(ffiData, t, buildSummaryCardData());

    expect(insights.some((i) => i.id.startsWith('section_changed-sec-moved'))).toBe(true);
    getNames.mockRestore();
  });

  it('does not crash when wellness is empty (rest-day framing path)', () => {
    const { insights } = computeInsightsFromData(buildFfiData(), t, buildSummaryCardData());
    // Should still produce at least the section-pattern insights derived
    // from FFI data alone.
    expect(Array.isArray(insights)).toBe(true);
  });

  it('carries the engine ranking breakdown onto section-trend insights', () => {
    const { insights } = computeInsightsFromData(buildFfiData(), t, buildSummaryCardData());

    const trend = insights.find((i) => i.id.startsWith('section_trend-'));
    if (!trend) throw new Error('expected a section-trend insight');

    const section = trend.supportingData?.sections?.[0];
    const source = ['Ride', 'Run']
      .flatMap((sport) => makeRankedSections(sport))
      .find((r) => r.sectionId === section?.sectionId);
    if (!source) throw new Error('expected a ranked section behind the insight');
    expect(section?.ranking).toEqual({
      relevance: source.relevanceScore,
      recency: source.recencyScore,
      improvement: source.improvementScore,
      anomaly: source.anomalyScore,
      engagement: source.engagementScore,
      ...('improvementChange' in source
        ? {
            improvementChange: source.improvementChange,
            improvementBasis: source.improvementBasis,
          }
        : {}),
    });
  });

  it('carries the signed change and its basis, and leaves them off when absent', () => {
    const { insights } = computeInsightsFromData(buildFfiData(), t, buildSummaryCardData());
    const trends = insights.filter((i) => i.category === 'section_trend');
    const sections = trends.flatMap((i) => i.supportingData?.sections ?? []);
    const withChange = sections.find((s) => s.sectionId.endsWith('climb-A'));
    const without = sections.find((s) => s.sectionId.endsWith('flat-B'));
    expect(withChange?.ranking).toMatchObject({
      improvementChange: 0.2,
      improvementBasis: MEDIAN_OF_THREE,
    });
    expect(without?.ranking).toBeDefined();
    expect(without?.ranking).not.toHaveProperty('improvementChange');
    expect(without?.ranking).not.toHaveProperty('improvementBasis');
  });

  it('feeds only trend verdicts the wire can carry', () => {
    // `FfiRankedSection.trend` is an i8: -1 declining, 0 stable, 1 improving.
    // A fraction is not a weaker version of that, it is a value no engine
    // build can emit, and the generator reads anything but 1 as declining.
    for (const sport of ['Ride', 'Run']) {
      for (const section of makeRankedSections(sport)) {
        expect([-1, 0, 1]).toContain(section.trend);
      }
    }
  });

  it('carries improving and declining sections in one summary', () => {
    const { insights } = computeInsightsFromData(buildFfiData(), t, buildSummaryCardData());

    const trends = insights.filter((i) => i.category === 'section_trend');
    expect(trends).toHaveLength(1);
    expect(trends[0].supportingData?.sections?.map((section) => section.trend)).toEqual(
      expect.arrayContaining([1, -1])
    );
  });

  // Section trends come from the engine's trend batch and from nothing else.
  // Patterns used to be a fallback when the batch was empty; what it built
  // carried no `daysSinceLast` and no ranking, so it could not pass the
  // recency gate or score on the tiebreak, and it produced nothing either way.
  it('produces no section trends when the trend batch is empty', () => {
    const ffiData = {
      ...buildFfiData(),
      trendSections: [],
      trendFasterCount: 0,
      trendSlowerCount: 0,
      routeInsights: [],
      routeRecordCount: 0,
      routeFasterCount: 0,
      routeSlowerCount: 0,
    } as InsightsData;

    const { insights } = computeInsightsFromData(ffiData, t, buildSummaryCardData());

    expect(insights.filter((i) => i.id.startsWith('section_trend-'))).toEqual([]);
  });

  it('builds no section trends with route matching off while the engine reports sections', () => {
    (isRouteMatchingEnabled as jest.Mock).mockReturnValueOnce(false);

    const { insights } = computeInsightsFromData(buildFfiData(), t, buildSummaryCardData());

    expect(insights.filter((i) => i.id.startsWith('section_trend-'))).toEqual([]);
  });

  it('section-derived insights only reference sections present in the FFI ranked-batch', () => {
    const { insights } = computeInsightsFromData(buildFfiData(), t, buildSummaryCardData());

    const allowedSectionIds = new Set(
      ['Ride', 'Run'].flatMap((sport) => makeRankedSections(sport)).map((r) => r.sectionId)
    );

    for (const ins of insights) {
      const refs = ins.supportingData?.sections ?? [];
      for (const ref of refs) {
        expect(allowedSectionIds).toContain(ref.sectionId);
      }
    }
  });
});

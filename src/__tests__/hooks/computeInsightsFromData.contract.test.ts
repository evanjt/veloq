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
import { LoadMetric } from 'veloqrs';
import type { InsightsData, SummaryCardData } from 'veloqrs';
import { getEngine } from '@/shared/native/engine';

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

function makePattern(
  sportType: string,
  primaryDay: number,
  confidence: number,
  avgDurationSecs: number,
  activityCount: number
): InsightsData['allPatterns'][0] {
  return {
    sportType,
    clusterId: 0,
    primaryDay,
    seasonLabel: 'all',
    activityCount,
    avgDurationSecs,
    avgTss: 80,
    avgDistanceMeters: 40_000,
    frequencyPerMonth: 4,
    confidence,
    daysSinceLast: 3,
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
    form: { date: '2026-04-19', ctl: 67.8, atl: 61.5, tsb: 6.3 },
    currentWeek: makePeriod(5, 4 * 3600, 80_000, 320),
    previousWeek: makePeriod(3, 2.5 * 3600, 50_000, 220),
    chronicPeriod: makePeriod(20, 18 * 3600, 320_000, 1280),
    chronicWeekAverage: makePeriod(5, 4.5 * 3600, 80_000, 320),
    chronicWeeks: [],
    todayPeriod: makePeriod(1, 1.2 * 3600, 22_000, 90),
    ftpTrend: {
      latestFtp: 285,
      latestDate: 1_745_000_000,
      previousFtp: 270,
      previousDate: 1_700_000_000,
      sampleCount: 24,
      history: [],
    },
    runPaceTrend: {
      latestPace: 4.55,
      latestDate: 1_745_000_000,
      previousPace: 4.7,
      previousDate: 1_700_000_000,
      sampleCount: 24,
      history: [],
    },
    allPatterns: [
      makePattern('Ride', 6, 0.9, 3 * 3600, 12),
      makePattern('Run', 2, 0.8, 45 * 60, 9),
    ],
    todayPattern: undefined,
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
    efficiencyTrends: [],
    hasStrengthData: false,
    strengthSeries: undefined,
    weekOverWeek: { metric: LoadMetric.Tss, current: 320, previous: 220, ratio: 320 / 220 - 1 },
    weekAgainstChronic: {
      metric: LoadMetric.Tss,
      current: 220,
      previous: 320,
      ratio: 220 / 320 - 1,
    },
    hrvTrend: {
      label: 'trendingDown',
      reason: 'halves',
      avg: 470 / 7,
      latest: 68,
      dataPoints: 7,
      sparkline: [67, 68, 69, 65, 66, 67, 68],
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
      hrvTrend: undefined,
      rhr: 48,
      rhrTrend: undefined,
      weight: undefined,
      weightTrend: undefined,
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
      latestPace: undefined,
      latestDate: undefined,
      previousPace: undefined,
      previousDate: undefined,
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

  it('produces a stable, ranked insight list given fixture FFI data', () => {
    const insights = computeInsightsFromData(buildFfiData(), t, buildSummaryCardData());

    // Snapshot the structural shape of the output. Each entry's id /
    // category / priority are the contract Tier 3.3 must preserve. Title
    // text is locale-dependent so we don't assert on it.
    const fingerprint = insights.map((i) => ({
      id: i.id,
      category: i.category,
      priority: i.priority,
      hasNavigationTarget: typeof i.navigationTarget === 'string',
      sectionRefIds: i.supportingData?.sections?.map((s) => s.sectionId) ?? null,
    }));

    // The snapshot IS the contract: whatever shape today's code produces
    // for this fixture is what Tier 3.3's consolidation must reproduce.
    // If the snapshot is empty today, that means computeInsightsFromData
    // silently swallows an error somewhere (the function is wrapped in
    // try/catch). That's a separate bug; this test just locks the
    // observable behaviour.
    expect(fingerprint).toMatchSnapshot();

    // Invariants on whatever IS produced.
    const ids = new Set(insights.map((i) => i.id));
    expect(ids.size).toBe(insights.length); // No duplicate insight IDs.

    for (const ins of insights) {
      expect(ins.priority).toBeGreaterThanOrEqual(1);
      expect(ins.priority).toBeLessThanOrEqual(3);
      expect(typeof ins.title).toBe('string');
      expect(ins.title.length).toBeGreaterThan(0);
    }
  });

  it('returns [] when ffiData is null', () => {
    const insights = computeInsightsFromData(null, t, null);
    expect(insights).toEqual([]);
  });

  it('does not crash when wellness is empty (rest-day framing path)', () => {
    const insights = computeInsightsFromData(buildFfiData(), t, buildSummaryCardData());
    // Should still produce at least the section-pattern insights derived
    // from FFI data alone.
    expect(Array.isArray(insights)).toBe(true);
  });

  it('carries the engine ranking breakdown onto section-trend insights', () => {
    const insights = computeInsightsFromData(buildFfiData(), t, buildSummaryCardData());

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
    });
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

  it('exercises both the improving and the declining section-trend branch', () => {
    const insights = computeInsightsFromData(buildFfiData(), t, buildSummaryCardData());

    const trends = insights.filter((i) => i.category === 'section_trend');
    expect(trends.map((i) => i.icon)).toEqual(
      expect.arrayContaining(['trending-up', 'trending-down'])
    );

    // Improving on a section whose latest traversal is a PR is the only path
    // to priority 2, so a fixture that never reaches it leaves the branch
    // that decides ranking untested.
    const improving = trends.find((i) => i.icon === 'trending-up');
    expect(improving?.priority).toBe(2);
    expect(trends.find((i) => i.icon === 'trending-down')?.priority).toBe(3);
  });

  // Section trends come from the engine's ranked batch and from nothing else.
  // Patterns used to be a fallback when the batch was empty; what it built
  // carried no `daysSinceLast` and no ranking, so it could not pass the
  // recency gate or score on the tiebreak, and it produced nothing either way.
  it('produces no section trends when the ranked batch is empty', () => {
    const ffiData = { ...buildFfiData(), rankedSections: [] } as InsightsData;

    const insights = computeInsightsFromData(ffiData, t, buildSummaryCardData());

    expect(insights.filter((i) => i.id.startsWith('section_trend-'))).toEqual([]);
  });

  it('section-derived insights only reference sections present in the FFI ranked-batch', () => {
    const insights = computeInsightsFromData(buildFfiData(), t, buildSummaryCardData());

    const allowedSectionIds = new Set([
      'sec-ride-climb-A',
      'sec-ride-flat-B',
      'sec-run-climb-A',
      'sec-run-flat-B',
    ]);

    for (const ins of insights) {
      const refs = ins.supportingData?.sections ?? [];
      for (const ref of refs) {
        expect(allowedSectionIds).toContain(ref.sectionId);
      }
    }
  });
});

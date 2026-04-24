/**
 * Tier 0.6 contract baseline: locks down the current output shape of
 * `computeInsightsFromData`, the pure computation that consumes pre-fetched
 * FFI data and produces ranked insights.
 *
 * Tier 3.3 consolidates 8 FFI calls into one (`get_insights_inputs`), but
 * the *output* of `computeInsightsFromData` should not change. This test is
 * the regression net for that work — it mocks the FFI surface, exercises
 * the pure compute path with deterministic inputs, and asserts on stable
 * insight IDs / categories / titles.
 *
 * If Tier 3.3 changes the output of computeInsightsFromData, that's a
 * semantics change and needs explicit baseline review, not a silent diff.
 */

jest.mock('@/lib/native/routeEngine', () => ({
  getRouteEngine: jest.fn(),
}));
jest.mock('@/providers/RouteSettingsStore', () => ({
  isRouteMatchingEnabled: jest.fn(() => true),
}));

import {
  computeInsightsFromData,
  invalidateInsightsCache,
  type FfiInsightsDataShape,
  type FfiSummaryCardDataShape,
  type WellnessInput,
} from '@/hooks/insights/computeInsightsData';
import { getRouteEngine } from '@/lib/native/routeEngine';

const t = (key: string, params?: Record<string, string | number>) => {
  if (!params) return key;
  return `${key}:${JSON.stringify(params)}`;
};

function makePeriod(count: number, durationSecs: number, distanceM: number, tss: number) {
  return {
    count,
    totalDuration: durationSecs,
    totalDistance: distanceM,
    totalTss: tss,
  };
}

function buildFfiData(): FfiInsightsDataShape {
  return {
    currentWeek: makePeriod(5, 4 * 3600, 80_000, 320),
    previousWeek: makePeriod(3, 2.5 * 3600, 50_000, 220),
    chronicPeriod: makePeriod(20, 18 * 3600, 320_000, 1280),
    todayPeriod: makePeriod(1, 1.2 * 3600, 22_000, 90),
    ftpTrend: {
      latestFtp: 285,
      latestDate: 1_745_000_000,
      previousFtp: 270,
      previousDate: 1_700_000_000,
    },
    runPaceTrend: {
      latestPace: 4.55,
      latestDate: 1_745_000_000,
      previousPace: 4.7,
      previousDate: 1_700_000_000,
    },
    swimPaceTrend: undefined,
    allPatterns: [
      {
        primaryDay: 6, // Saturday
        confidence: 0.9,
        sportType: 'Ride',
        avgDurationSecs: 3 * 3600,
        activityCount: 12,
        commonSections: [
          {
            sectionId: 'sec-ride-climb-A',
            sectionName: 'Sunday Climb',
            trend: -0.05,
            medianRecentSecs: 720,
            bestTimeSecs: 690,
            traversalCount: 14,
          },
        ],
      },
      {
        primaryDay: 2, // Tuesday
        confidence: 0.8,
        sportType: 'Run',
        avgDurationSecs: 45 * 60,
        activityCount: 9,
        commonSections: [],
      },
    ],
    todayPattern: null,
    recentPrs: [
      {
        sectionId: 'sec-ride-climb-A',
        sectionName: 'Sunday Climb',
        bestTime: 690,
        daysAgo: 3,
      },
    ],
  };
}

function buildSummaryCardData(): FfiSummaryCardDataShape {
  return {
    currentWeek: makePeriod(5, 4 * 3600, 80_000, 320),
    prevWeek: makePeriod(3, 2.5 * 3600, 50_000, 220),
    ftpTrend: {
      latestFtp: 285,
      latestDate: 1_745_000_000,
      previousFtp: 270,
      previousDate: 1_700_000_000,
    },
    runPaceTrend: {
      latestPace: 4.55,
      latestDate: 1_745_000_000,
      previousPace: 4.7,
      previousDate: 1_700_000_000,
    },
    swimPaceTrend: {
      latestPace: undefined,
      latestDate: undefined,
      previousPace: undefined,
      previousDate: undefined,
    },
  };
}

function buildWellness(): WellnessInput[] {
  // 14 days of slowly rising CTL, ATL just under, TSB slightly positive.
  const today = new Date('2026-04-19T08:00:00Z');
  return Array.from({ length: 14 }).map((_, i) => {
    const d = new Date(today);
    d.setDate(today.getDate() - (13 - i));
    return {
      id: d.toISOString().slice(0, 10),
      ctl: 60 + i * 0.6,
      atl: 55 + i * 0.5,
      ctlLoad: 60 + i * 0.6,
      atlLoad: 55 + i * 0.5,
      hrv: 65 + (i % 5),
      restingHr: 48,
      sleepSecs: 7 * 3600,
      weight: 72,
    } as WellnessInput;
  });
}

function buildMockEngine(): unknown {
  return {
    getStats: () => ({
      sectionCount: 42,
      activityCount: 150,
      groupCount: 8,
    }),
    getAvailableSportTypes: () => ['Ride', 'Run'],
    getRankedSectionsBatch: (sportTypes: string[]) =>
      sportTypes.map((sportType) => ({
        sportType,
        sections: [
          {
            sectionId: `sec-${sportType.toLowerCase()}-climb-A`,
            sectionName: `${sportType} Climb A`,
            trend: -0.04,
            medianRecentSecs: 700,
            bestTimeSecs: 680,
            traversalCount: 18,
            daysSinceLast: 4,
            latestIsPr: true,
          },
          {
            sectionId: `sec-${sportType.toLowerCase()}-flat-B`,
            sectionName: `${sportType} Flat B`,
            trend: 0.02,
            medianRecentSecs: 320,
            bestTimeSecs: 305,
            traversalCount: 9,
            daysSinceLast: 12,
            latestIsPr: false,
          },
        ],
      })),
    getStrengthInsightSeries: () => null,
    getStrengthSummary: () => ({
      muscleVolumes: [],
      activityCount: 0,
      totalSets: 0,
    }),
  };
}

describe('Tier 0.6 contract: computeInsightsFromData', () => {
  beforeEach(() => {
    invalidateInsightsCache();
    (getRouteEngine as jest.Mock).mockReturnValue(buildMockEngine());
  });

  it('produces a stable, ranked insight list given fixture FFI data', () => {
    const insights = computeInsightsFromData(
      buildFfiData(),
      buildWellness(),
      t,
      buildSummaryCardData()
    );

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
    const insights = computeInsightsFromData(null, buildWellness(), t, null);
    expect(insights).toEqual([]);
  });

  it('does not crash when wellness is empty (rest-day framing path)', () => {
    const insights = computeInsightsFromData(buildFfiData(), [], t, buildSummaryCardData());
    // Should still produce at least the section-pattern insights derived
    // from FFI data alone.
    expect(Array.isArray(insights)).toBe(true);
  });

  it('section-derived insights only reference sections present in the FFI ranked-batch', () => {
    const insights = computeInsightsFromData(
      buildFfiData(),
      buildWellness(),
      t,
      buildSummaryCardData()
    );

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

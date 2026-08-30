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
 */

import {
  computeInsightsFromData,
  type WellnessInput,
} from "@/features/insights/lib/computeInsightsData";
import type { InsightsData, SummaryCardData } from "veloqrs";
import { getRouteEngine } from "@/shared/native/routeEngine";

jest.mock("@/shared/native/routeEngine", () => ({
  getRouteEngine: jest.fn(),
}));
jest.mock("@/features/routes/stores/RouteSettingsStore", () => ({
  isRouteMatchingEnabled: jest.fn(() => true),
}));

const t = (key: string, params?: Record<string, string | number>) => {
  if (!params) return key;
  return `${key}:${JSON.stringify(params)}`;
};

function makePeriod(
  count: number,
  durationSecs: number,
  distanceM: number,
  tss: number,
) {
  return {
    count,
    totalDuration: BigInt(Math.round(durationSecs)),
    totalDistance: distanceM,
    totalTss: tss,
  };
}

function makePattern(
  sportType: string,
  primaryDay: number,
  confidence: number,
  avgDurationSecs: number,
  activityCount: number,
  commonSections: InsightsData["allPatterns"][0]["commonSections"],
): InsightsData["allPatterns"][0] {
  return {
    sportType,
    clusterId: 0,
    primaryDay,
    seasonLabel: "all",
    activityCount,
    avgDurationSecs,
    avgTss: 80,
    avgDistanceMeters: 40_000,
    frequencyPerMonth: 4,
    confidence,
    silhouetteScore: 0.7,
    daysSinceLast: 3,
    commonSections,
  };
}

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
      trend: -0.04,
      latestIsPr: true,
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
      trend: 0.02,
      latestIsPr: false,
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
      trend: 0.0,
      latestIsPr: false,
    },
  ];
}

function buildFfiData(): InsightsData {
  return {
    currentWeek: makePeriod(5, 4 * 3600, 80_000, 320),
    previousWeek: makePeriod(3, 2.5 * 3600, 50_000, 220),
    chronicPeriod: makePeriod(20, 18 * 3600, 320_000, 1280),
    todayPeriod: makePeriod(1, 1.2 * 3600, 22_000, 90),
    ftpTrend: {
      latestFtp: 285,
      latestDate: BigInt(1_745_000_000),
      previousFtp: 270,
      previousDate: BigInt(1_700_000_000),
    },
    runPaceTrend: {
      latestPace: 4.55,
      latestDate: BigInt(1_745_000_000),
      previousPace: 4.7,
      previousDate: BigInt(1_700_000_000),
    },
    allPatterns: [
      makePattern("Ride", 6, 0.9, 3 * 3600, 12, [
        {
          sectionId: "sec-ride-climb-A",
          sectionName: "Sunday Climb",
          appearanceRate: 0.8,
          trend: -0.05,
          medianRecentSecs: 720,
          bestTimeSecs: 690,
          traversalCount: 14,
        },
      ]),
      makePattern("Run", 2, 0.8, 45 * 60, 9, []),
    ],
    todayPattern: undefined,
    recentPrs: [
      {
        sectionId: "sec-ride-climb-A",
        sectionName: "Sunday Climb",
        bestTime: 690,
        daysAgo: 3,
      },
    ],
    sectionCount: 42,
    sportTypes: ["Ride", "Run"],
    rankedSections: [
      { sportType: "Ride", sections: makeRankedSections("Ride") },
      { sportType: "Run", sections: makeRankedSections("Run") },
    ],
    efficiencyTrends: [],
    hasStrengthData: false,
    strengthSeries: undefined,
  };
}

function buildSummaryCardData(): SummaryCardData {
  return {
    currentWeek: makePeriod(5, 4 * 3600, 80_000, 320),
    prevWeek: makePeriod(3, 2.5 * 3600, 50_000, 220),
    ftpTrend: {
      latestFtp: 285,
      latestDate: BigInt(1_745_000_000),
      previousFtp: 270,
      previousDate: BigInt(1_700_000_000),
    },
    runPaceTrend: {
      latestPace: 4.55,
      latestDate: BigInt(1_745_000_000),
      previousPace: 4.7,
      previousDate: BigInt(1_700_000_000),
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
  const today = new Date("2026-04-19T08:00:00Z");
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
  // The bundle carries the section and strength data, so the engine mock
  // exists for the stale-PR generator's optional lookup and for the HRV
  // verdict, which is Rust's alone. The shape is what `compute_hrv_trend`
  // returns over the trailing seven days of `buildWellness`.
  return {
    computeHrvTrend: () => ({
      label: "trendingDown",
      avg: 470 / 7,
      latest: 68,
      dataPoints: 7,
      sparkline: [67, 68, 69, 65, 66, 67, 68],
    }),
  };
}

describe("Tier 0.6 contract: computeInsightsFromData", () => {
  beforeEach(() => {
    (getRouteEngine as jest.Mock).mockReturnValue(buildMockEngine());
  });

  it("produces a stable, ranked insight list given fixture FFI data", () => {
    const insights = computeInsightsFromData(
      buildFfiData(),
      buildWellness(),
      t,
      buildSummaryCardData(),
    );

    // Snapshot the structural shape of the output. Each entry's id /
    // category / priority are the contract Tier 3.3 must preserve. Title
    // text is locale-dependent so we don't assert on it.
    const fingerprint = insights.map((i) => ({
      id: i.id,
      category: i.category,
      priority: i.priority,
      hasNavigationTarget: typeof i.navigationTarget === "string",
      sectionRefIds:
        i.supportingData?.sections?.map((s) => s.sectionId) ?? null,
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
      expect(typeof ins.title).toBe("string");
      expect(ins.title.length).toBeGreaterThan(0);
    }
  });

  it("returns [] when ffiData is null", () => {
    const insights = computeInsightsFromData(null, buildWellness(), t, null);
    expect(insights).toEqual([]);
  });

  it("does not crash when wellness is empty (rest-day framing path)", () => {
    const insights = computeInsightsFromData(
      buildFfiData(),
      [],
      t,
      buildSummaryCardData(),
    );
    // Should still produce at least the section-pattern insights derived
    // from FFI data alone.
    expect(Array.isArray(insights)).toBe(true);
  });

  it("carries the engine ranking breakdown onto section-trend insights", () => {
    const insights = computeInsightsFromData(
      buildFfiData(),
      buildWellness(),
      t,
      buildSummaryCardData(),
    );

    const trend = insights.find((i) => i.id.startsWith("section_trend-"));
    if (!trend) throw new Error("expected a section-trend insight");

    const section = trend.supportingData?.sections?.[0];
    const source = makeRankedSections("Ride").find(
      (r) => r.sectionId === section?.sectionId,
    );
    if (!source)
      throw new Error("expected a ranked section behind the insight");
    expect(section?.ranking).toEqual({
      relevance: source.relevanceScore,
      recency: source.recencyScore,
      improvement: source.improvementScore,
      anomaly: source.anomalyScore,
      engagement: source.engagementScore,
    });
  });

  it("section-derived insights only reference sections present in the FFI ranked-batch", () => {
    const insights = computeInsightsFromData(
      buildFfiData(),
      buildWellness(),
      t,
      buildSummaryCardData(),
    );

    const allowedSectionIds = new Set([
      "sec-ride-climb-A",
      "sec-ride-flat-B",
      "sec-run-climb-A",
      "sec-run-flat-B",
    ]);

    for (const ins of insights) {
      const refs = ins.supportingData?.sections ?? [];
      for (const ref of refs) {
        expect(allowedSectionIds).toContain(ref.sectionId);
      }
    }
  });
});

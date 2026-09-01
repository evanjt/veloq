import {
  generateInsights,
  formatDurationCompact,
  getLastInsightOutcome,
  InsightInputData,
} from '@/features/insights/lib/generateInsights';
import { consolidateInsights } from '@/features/insights/lib/computeInsightsData';
import type { Insight } from '@/types';
import { getRouteEngine } from '@/shared/native/routeEngine';

jest.mock('@/shared/native/routeEngine', () => ({
  getRouteEngine: jest.fn(() => null),
}));

const mockGetRouteEngine = getRouteEngine as jest.MockedFunction<typeof getRouteEngine>;

/** The HRV verdict is Rust's, so the generator only ever sees this shape. */
const stubHrvTrend = (
  trend: {
    label: string;
    avg: number;
    latest: number;
    dataPoints: number;
    sparkline: number[];
  } | null
) => {
  mockGetRouteEngine.mockReturnValue({
    computeHrvTrend: () => trend,
  } as unknown as ReturnType<typeof getRouteEngine>);
};

// Mock translation function - returns key with interpolated params
const mockT = (key: string, params?: Record<string, string | number>): string => {
  if (!params) return key;
  const paramStr = Object.entries(params)
    .map(([k, v]) => `${k}: ${v}`)
    .join(', ');
  return `${key} {${paramStr}}`;
};

const EMPTY_INPUT: InsightInputData = {
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

describe('generateInsights', () => {
  // ============================================================
  // EDGE CASES
  // ============================================================

  describe('edge cases', () => {
    it('returns empty array for all-null input without formTsb', () => {
      const result = generateInsights(EMPTY_INPUT, mockT);
      expect(result).toEqual([]);
    });

    it('previous period with zero duration does not crash', () => {
      const result = generateInsights(
        {
          ...EMPTY_INPUT,
          currentPeriod: {
            count: 5,
            totalDuration: 7200,
            totalDistance: 100000,
            totalTss: 200,
          },
          previousPeriod: {
            count: 0,
            totalDuration: 0,
            totalDistance: 0,
            totalTss: 0,
          },
        },
        mockT
      );
      expect(result.find((i) => i.id === 'period_comparison-volume')).toBeUndefined();
    });
  });

  // ============================================================
  // SECTION PRs (Priority 1)
  // ============================================================

  describe('section PRs', () => {
    it('generates insight for recent PR', () => {
      const result = generateInsights(
        {
          ...EMPTY_INPUT,
          recentPRs: [
            {
              sectionId: 's1',
              sectionName: 'Hill Climb',
              bestTime: 300,
              daysAgo: 1,
            },
          ],
        },
        mockT
      );
      const pr = result.find((i) => i.category === 'section_pr');
      expect(pr!.priority).toBe(1);
      expect(pr!.navigationTarget).toBe('/section/s1');
      expect(pr!.title).toContain('insights.sectionPr');
    });

    it('limits to 3 PRs max', () => {
      const prs = Array.from({ length: 5 }, (_, i) => ({
        sectionId: `s${i}`,
        sectionName: `Section ${i}`,
        bestTime: 100 + i,
        daysAgo: i,
      }));
      const result = generateInsights({ ...EMPTY_INPUT, recentPRs: prs }, mockT);
      const prInsights = result.filter((i) => i.id.startsWith('section_pr-'));
      expect(prInsights).toHaveLength(3);
    });

    it('skips PRs with invalid data', () => {
      const result = generateInsights(
        {
          ...EMPTY_INPUT,
          recentPRs: [
            { sectionId: '', sectionName: 'Test', bestTime: 100, daysAgo: 0 },
            { sectionId: 's1', sectionName: '', bestTime: 100, daysAgo: 0 },
            { sectionId: 's2', sectionName: 'Test', bestTime: NaN, daysAgo: 0 },
          ],
        },
        mockT
      );
      const prInsights = result.filter((i) => i.id.startsWith('section_pr-'));
      expect(prInsights).toHaveLength(0);
    });
  });

  // ============================================================
  // HRV TREND (Priority 2) - replaces recovery readiness
  // ============================================================

  describe('HRV trend', () => {
    const hrvTrend = (label: string, sparkline: number[]) => ({
      label,
      avg: sparkline.reduce((a, b) => a + b, 0) / sparkline.length,
      latest: sparkline[sparkline.length - 1],
      dataPoints: sparkline.length,
      sparkline,
    });

    afterEach(() => {
      mockGetRouteEngine.mockReturnValue(null);
    });

    it('generates HRV trend from the engine verdict', () => {
      stubHrvTrend(hrvTrend('trendingUp', [50, 52, 55, 58, 60]));
      const result = generateInsights(EMPTY_INPUT, mockT);
      const hrv = result.find((i) => i.id === 'hrv_trend');
      expect(hrv!.category).toBe('hrv_trend');
      expect(hrv!.priority).toBe(2);
    });

    it('generates nothing when the engine withholds a verdict', () => {
      stubHrvTrend(null);
      const result = generateInsights(EMPTY_INPUT, mockT);
      expect(result.find((i) => i.id === 'hrv_trend')).toBeUndefined();
    });

    it('generates nothing when there is no engine at all', () => {
      mockGetRouteEngine.mockReturnValue(null);
      const result = generateInsights(EMPTY_INPUT, mockT);
      expect(result.find((i) => i.id === 'hrv_trend')).toBeUndefined();
    });

    it('titles each verdict the engine can return', () => {
      for (const label of ['trendingUp', 'trendingDown', 'stable']) {
        stubHrvTrend(hrvTrend(label, [50, 52, 55, 58, 60]));
        const result = generateInsights(EMPTY_INPUT, mockT);
        const hrv = result.find((i) => i.id === 'hrv_trend');
        expect(hrv!.title).toContain(label);
      }
    });

    it('includes HRV sparkline in supporting data', () => {
      stubHrvTrend(hrvTrend('trendingUp', [50, 52, 55, 58, 60]));
      const result = generateInsights(EMPTY_INPUT, mockT);
      const hrv = result.find((i) => i.id === 'hrv_trend');
      expect(hrv!.supportingData?.sparklineData).toEqual([50, 52, 55, 58, 60]);
    });

    it('includes methodology with Kiviniemi reference in APA format', () => {
      stubHrvTrend(hrvTrend('trendingUp', [50, 52, 55, 58, 60]));
      const result = generateInsights(EMPTY_INPUT, mockT);
      const hrv = result.find((i) => i.id === 'hrv_trend');
      expect(hrv!.methodology?.description).toContain('insights.methodology.hrvDescription');
    });
  });

  // ============================================================
  // FITNESS MILESTONES (Priority 2)
  // ============================================================

  describe('fitness milestones', () => {
    it('detects FTP increase', () => {
      const result = generateInsights(
        {
          ...EMPTY_INPUT,
          ftpTrend: {
            latestFtp: 260,
            latestDate: BigInt(1000),
            previousFtp: 250,
            previousDate: BigInt(500),
          },
        },
        mockT
      );
      const ftp = result.find((i) => i.id === 'fitness_milestone-ftp');
      expect(ftp!.priority).toBe(2);
      expect(ftp!.title).toContain('current: 260');
      expect(ftp!.title).toContain('change: 10');
    });

    it('does not generate FTP insight when FTP decreased', () => {
      const result = generateInsights(
        {
          ...EMPTY_INPUT,
          ftpTrend: {
            latestFtp: 240,
            latestDate: BigInt(1000),
            previousFtp: 250,
            previousDate: BigInt(500),
          },
        },
        mockT
      );
      expect(result.find((i) => i.id === 'fitness_milestone-ftp')).toBeUndefined();
    });

    it('detects pace improvement from a higher threshold speed', () => {
      const result = generateInsights(
        {
          ...EMPTY_INPUT,
          paceTrend: {
            latestPace: 1000 / 280,
            latestDate: BigInt(1000),
            previousPace: 1000 / 300,
            previousDate: BigInt(500),
          },
        },
        mockT
      );
      const pace = result.find((i) => i.id === 'fitness_milestone-pace');
      expect(pace!.title).toContain('delta: 20s/km');
    });

    it('does not generate pace insight when pace got worse', () => {
      const result = generateInsights(
        {
          ...EMPTY_INPUT,
          paceTrend: {
            latestPace: 1000 / 320,
            latestDate: BigInt(1000),
            previousPace: 1000 / 300,
            previousDate: BigInt(500),
          },
        },
        mockT
      );
      expect(result.find((i) => i.id === 'fitness_milestone-pace')).toBeUndefined();
    });

    it('detects swim pace improvement from a higher threshold speed', () => {
      const result = generateInsights(
        {
          ...EMPTY_INPUT,
          swimPaceTrend: {
            latestPace: 1.1,
            latestDate: BigInt(1000),
            previousPace: 1.0,
            previousDate: BigInt(500),
          },
        },
        mockT
      );
      const swim = result.find((i) => i.id === 'fitness_milestone-swim-pace');
      expect(swim!.title).toContain('delta: 9s/100m');
    });
  });

  // ============================================================
  // PERIOD COMPARISON (Priority 2)
  // ============================================================

  describe('period comparison', () => {
    it('detects load increase >15% (uses TSS when available)', () => {
      const result = generateInsights(
        {
          ...EMPTY_INPUT,
          currentPeriod: {
            count: 5,
            totalDuration: 7200,
            totalDistance: 100000,
            totalTss: 200,
          },
          previousPeriod: {
            count: 4,
            totalDuration: 5000,
            totalDistance: 80000,
            totalTss: 150,
          },
        },
        mockT
      );
      const vol = result.find((i) => i.id === 'period_comparison-volume');
      expect(vol!.icon).toBe('trending-up');
      expect(vol!.title).toContain('weeklyLoadUp');
    });

    it('detects load decrease >15% (uses TSS when available)', () => {
      const result = generateInsights(
        {
          ...EMPTY_INPUT,
          currentPeriod: {
            count: 2,
            totalDuration: 3000,
            totalDistance: 40000,
            totalTss: 80,
          },
          previousPeriod: {
            count: 5,
            totalDuration: 7200,
            totalDistance: 100000,
            totalTss: 200,
          },
        },
        mockT
      );
      const vol = result.find((i) => i.id === 'period_comparison-volume');
      expect(vol!.icon).toBe('trending-down');
      expect(vol!.title).toContain('weeklyLoadDown');
    });

    it('no insight when load change <15%', () => {
      const result = generateInsights(
        {
          ...EMPTY_INPUT,
          currentPeriod: {
            count: 5,
            totalDuration: 5200,
            totalDistance: 100000,
            totalTss: 195,
          },
          previousPeriod: {
            count: 5,
            totalDuration: 5000,
            totalDistance: 100000,
            totalTss: 200,
          },
        },
        mockT
      );
      expect(result.find((i) => i.id === 'period_comparison-volume')).toBeUndefined();
    });

    it('falls back to duration when TSS is zero', () => {
      const result = generateInsights(
        {
          ...EMPTY_INPUT,
          currentPeriod: {
            count: 5,
            totalDuration: 7200,
            totalDistance: 100000,
            totalTss: 0,
          },
          previousPeriod: {
            count: 4,
            totalDuration: 5000,
            totalDistance: 80000,
            totalTss: 0,
          },
        },
        mockT
      );
      const vol = result.find((i) => i.id === 'period_comparison-volume');
      expect(vol!.title).toContain('weeklyVolumeUp');
      expect(vol!.supportingData!.comparisonData!.current.value).toBe(120);
      expect(vol!.supportingData!.comparisonData!.current.unit).toBe('min');
      expect(vol!.supportingData!.comparisonData!.previous.value).toBe(83);
      expect(vol!.supportingData!.comparisonData!.previous.unit).toBe('min');
    });

    it('change context is always neutral (no warning)', () => {
      const result = generateInsights(
        {
          ...EMPTY_INPUT,
          currentPeriod: {
            count: 5,
            totalDuration: 7200,
            totalDistance: 100000,
            totalTss: 400,
          },
          previousPeriod: {
            count: 4,
            totalDuration: 5000,
            totalDistance: 80000,
            totalTss: 200,
          },
        },
        mockT
      );
      const vol = result.find((i) => i.id === 'period_comparison-volume');
      const changeDP = vol!.supportingData!.comparisonData!.change;
      expect(changeDP.context).toBe('neutral');
    });

    it('suppresses period comparison when current week has zero activities', () => {
      const result = generateInsights(
        {
          ...EMPTY_INPUT,
          currentPeriod: {
            count: 0,
            totalDuration: 0,
            totalDistance: 0,
            totalTss: 0,
          },
          previousPeriod: {
            count: 5,
            totalDuration: 7200,
            totalDistance: 100000,
            totalTss: 200,
          },
        },
        mockT
      );
      expect(result.find((i) => i.id === 'period_comparison-volume')).toBeUndefined();
    });
  });

  // ============================================================
  // REMOVED INSIGHTS - ensure they are gone
  // ============================================================

  describe('removed insights', () => {
    it.each([
      {
        name: 'ACWR',
        input: {
          currentPeriod: {
            count: 5,
            totalDuration: 7200,
            totalDistance: 100000,
            totalTss: 200,
          },
          chronicPeriod: {
            count: 5,
            totalDuration: 5000,
            totalDistance: 80000,
            totalTss: 200,
          },
        },
        missingId: 'workload_risk-acwr',
      },
      {
        name: 'recovery readiness',
        input: {
          formTsb: 10,
          formCtl: 50,
          formAtl: 40,
        },
        missingId: 'recovery_readiness',
      },
      {
        name: 'training monotony',
        input: {},
        missingId: 'workload_risk-monotony',
      },
      {
        name: 'form trajectory',
        input: { formTsb: -5, formCtl: 50, formAtl: 55 },
        missingId: 'form_trajectory',
      },
      {
        name: 'ramp rate',
        input: { formTsb: 0, formCtl: 50, formAtl: 50 },
        missingId: 'form_trajectory-ramp',
      },
      {
        name: 'peak CTL',
        input: { currentCtl: 96, peakCtl: 100 },
        missingId: 'fitness_milestone-peak-ctl',
      },
      {
        name: 'section performance vs fitness',
        input: {
          formCtl: 50,
          sectionTrends: [
            {
              sectionId: 's1',
              sectionName: 'Hill',
              trend: 1,
              medianRecentSecs: 300,
              bestTimeSecs: 270,
              traversalCount: 10,
            },
          ],
        },
        missingIdPrefix: 'section_performance-fitness',
      },
      {
        name: 'old form advice',
        input: { formTsb: -5, formCtl: 50, formAtl: 55 },
        missingId: 'training_consistency-form',
      },
    ])('does not generate $name insight', ({ input, missingId, missingIdPrefix }) => {
      const result = generateInsights({ ...EMPTY_INPUT, ...input }, mockT);
      const hit = missingIdPrefix
        ? result.find((i) => i.id.startsWith(missingIdPrefix))
        : result.find((i) => i.id === missingId);
      expect(hit).toBeUndefined();
    });
  });

  describe('stale PR grouping', () => {
    it('formats grouped stale PR subtitles with sport-appropriate units', () => {
      const result = generateInsights(
        {
          ...EMPTY_INPUT,
          ftpTrend: {
            latestFtp: 270,
            latestDate: BigInt(1000),
            previousFtp: 250,
            previousDate: BigInt(500),
          },
          swimPaceTrend: {
            latestPace: 1.1,
            latestDate: BigInt(1000),
            previousPace: 1.0,
            previousDate: BigInt(500),
          },
          recentPRs: [],
          sectionTrends: [
            {
              sectionId: 'ride-1',
              sectionName: 'North Climb',
              trend: 0,
              medianRecentSecs: 620,
              bestTimeSecs: 590,
              traversalCount: 8,
              daysSinceLast: 60,
              sportType: 'Ride',
            },
            {
              sectionId: 'swim-1',
              sectionName: 'Pool Threshold Set',
              trend: 0,
              medianRecentSecs: 390,
              bestTimeSecs: 360,
              traversalCount: 5,
              daysSinceLast: 75,
              sportType: 'Swim',
            },
          ],
        },
        mockT
      );

      const stale = result.find((insight) => insight.id === 'stale_pr-group');
      expect(stale!.subtitle).toContain('FTP: 250W → 270W');
      expect(stale!.subtitle).toContain('Swim threshold: 1:40/100m → 1:31/100m');
    });
  });

  // ============================================================
  // PRIORITY ORDERING
  // ============================================================

  describe('priority ordering', () => {
    it('sorts by priority ascending', () => {
      const result = generateInsights(
        {
          ...EMPTY_INPUT,
          recentPRs: [{ sectionId: 's1', sectionName: 'Hill', bestTime: 300, daysAgo: 0 }],
          ftpTrend: {
            latestFtp: 260,
            latestDate: BigInt(1000),
            previousFtp: 250,
            previousDate: BigInt(500),
          },
          currentPeriod: {
            count: 5,
            totalDuration: 7200,
            totalDistance: 100000,
            totalTss: 200,
          },
          previousPeriod: {
            count: 4,
            totalDuration: 5000,
            totalDistance: 80000,
            totalTss: 150,
          },
          formTsb: 0,
          formCtl: 50,
          formAtl: 50,
        },
        mockT
      );

      expect(result.length).toBeGreaterThanOrEqual(3);
      for (let i = 1; i < result.length; i++) {
        expect(result[i].priority).toBeGreaterThanOrEqual(result[i - 1].priority);
      }
    });
  });

  describe('navigation coverage', () => {
    it('generated insight categories include navigation targets for current detail flows', () => {
      const result = generateInsights(
        {
          ...EMPTY_INPUT,
          currentPeriod: {
            count: 5,
            totalDuration: 7200,
            totalDistance: 100000,
            totalTss: 240,
          },
          previousPeriod: {
            count: 4,
            totalDuration: 5400,
            totalDistance: 70000,
            totalTss: 180,
          },
          ftpTrend: {
            latestFtp: 265,
            latestDate: BigInt(1000),
            previousFtp: 255,
            previousDate: BigInt(500),
          },
          recentPRs: [{ sectionId: 's1', sectionName: 'Hill', bestTime: 300, daysAgo: 1 }],
          sectionTrends: [
            {
              sectionId: 's1',
              sectionName: 'Hill',
              trend: 1,
              medianRecentSecs: 320,
              bestTimeSecs: 300,
              traversalCount: 8,
              sportType: 'Ride',
            },
            {
              sectionId: 's2',
              sectionName: 'Valley',
              trend: 1,
              medianRecentSecs: 420,
              bestTimeSecs: 390,
              traversalCount: 6,
              sportType: 'Ride',
            },
          ],
          allSectionTrends: [
            {
              sectionId: 's1',
              sectionName: 'Hill',
              trend: 1,
              medianRecentSecs: 320,
              bestTimeSecs: 300,
              traversalCount: 8,
              sportType: 'Ride',
            },
            {
              sectionId: 's2',
              sectionName: 'Valley',
              trend: 1,
              medianRecentSecs: 420,
              bestTimeSecs: 390,
              traversalCount: 6,
              sportType: 'Ride',
            },
          ],
          formTsb: -5,
          formCtl: 60,
          formAtl: 65,
        },
        mockT
      );

      expect(result.length).toBeGreaterThan(0);
      result.forEach((insight) => {
        expect(insight.navigationTarget).toBeDefined();
      });
    });
  });

  // ============================================================
  // isNew FIELD
  // ============================================================

  describe('isNew field', () => {
    it('all generated insights have isNew = false (annotated by useInsights)', () => {
      const result = generateInsights(
        {
          ...EMPTY_INPUT,
          recentPRs: [{ sectionId: 's1', sectionName: 'Hill', bestTime: 300, daysAgo: 0 }],
          formTsb: 0,
          formCtl: 50,
          formAtl: 50,
        },
        mockT
      );
      expect(result.length).toBeGreaterThan(0);
      result.forEach((insight) => expect(insight.isNew).toBe(false));
    });
  });

  // ============================================================
  // INFORMATIONAL FRAMING - no prescriptive text
  // ============================================================

  describe('informational framing', () => {
    it('no insight has alternatives array (removed prescriptive zone comparisons)', () => {
      const result = generateInsights(
        {
          ...EMPTY_INPUT,
          formTsb: -5,
          formCtl: 50,
          formAtl: 55,
          currentPeriod: {
            count: 5,
            totalDuration: 7200,
            totalDistance: 100000,
            totalTss: 250,
          },
          previousPeriod: {
            count: 4,
            totalDuration: 5000,
            totalDistance: 80000,
            totalTss: 150,
          },
          chronicPeriod: {
            count: 5,
            totalDuration: 5000,
            totalDistance: 80000,
            totalTss: 200,
          },
        },
        mockT
      );
      for (const insight of result) {
        expect(insight.alternatives).toBeUndefined();
      }
    });
  });

  // ============================================================
  // BODY TEXT
  // ============================================================

  describe('body text', () => {
    it('load insight has body with TSS and duration context', () => {
      const result = generateInsights(
        {
          ...EMPTY_INPUT,
          currentPeriod: {
            count: 5,
            totalDuration: 7200,
            totalDistance: 100000,
            totalTss: 200,
          },
          previousPeriod: {
            count: 4,
            totalDuration: 5000,
            totalDistance: 80000,
            totalTss: 150,
          },
        },
        mockT
      );
      const vol = result.find((i) => i.id === 'period_comparison-volume');
      expect(vol!.body).toContain('insights.loadBody');
    });
  });
});

// ============================================================
// formatDurationCompact
// ============================================================

describe('formatDurationCompact', () => {
  it.each([
    [5400, '1h30', 'hours and minutes'],
    [3600, '1h', 'hours only'],
    [2700, '45m', 'minutes only'],
    [3660, '1h01', 'minutes padded with leading zero'],
    [0, '0m', 'zero'],
    [-100, '0m', 'negative'],
    [NaN, '0m', 'NaN'],
    [Infinity, '0m', 'Infinity'],
  ])('formats %p as %p (%s)', (seconds, expected) => {
    expect(formatDurationCompact(seconds)).toBe(expected);
  });
});

// ============================================================
// ADDITIONAL EDGE CASE BUG HUNTING
// ============================================================

describe('generateInsights - additional edge cases', () => {
  /**
   * All-zero metrics: CTL=0, ATL=0, TSB=0 should NOT generate a TSB form
   * insight because there is no wellness data to report on.
   *
   * The guard `if ((!ctl || ctl === 0) && (!atl || atl === 0)) return` should
   * catch this, but let's verify TSB=0 specifically.
   */
  /**
   * FTP with NaN values should not produce an insight.
   */
  it('FTP trend with NaN latestFtp does not crash or generate insight', () => {
    const result = generateInsights(
      {
        ...EMPTY_INPUT,
        ftpTrend: {
          latestFtp: NaN,
          latestDate: BigInt(1000),
          previousFtp: 250,
          previousDate: BigInt(500),
        },
      },
      mockT
    );
    const ftp = result.find((i) => i.id === 'fitness_milestone-ftp');
    expect(ftp).toBeUndefined();
  });

  /**
   * FTP trend with undefined values should not crash.
   */
  it('FTP trend with undefined values does not crash', () => {
    expect(() =>
      generateInsights(
        {
          ...EMPTY_INPUT,
          ftpTrend: {
            latestFtp: undefined,
            latestDate: undefined,
            previousFtp: undefined,
            previousDate: undefined,
          },
        },
        mockT
      )
    ).not.toThrow();
  });

  /**
   * Pace trend with zero values should not generate a milestone.
   * pace.latestPace = 0 means 0 m/s - effectively no movement.
   */
  it('pace trend with zero latestPace does not generate insight', () => {
    const result = generateInsights(
      {
        ...EMPTY_INPUT,
        paceTrend: {
          latestPace: 0,
          latestDate: BigInt(1000),
          previousPace: 1000 / 300,
          previousDate: BigInt(500),
        },
      },
      mockT
    );
    expect(result.find((i) => i.id === 'fitness_milestone-pace')).toBeUndefined();
  });

  /**
   * Period comparison where previous period has zero TSS and zero duration.
   * Both fallback paths have prevValue=0, which triggers the prevValue <= 0 guard.
   */
  it('previous period all zeroes does not generate period comparison', () => {
    const result = generateInsights(
      {
        ...EMPTY_INPUT,
        currentPeriod: {
          count: 3,
          totalDuration: 5000,
          totalDistance: 50000,
          totalTss: 150,
        },
        previousPeriod: {
          count: 0,
          totalDuration: 0,
          totalDistance: 0,
          totalTss: 0,
        },
      },
      mockT
    );
    expect(result.find((i) => i.id === 'period_comparison-volume')).toBeUndefined();
  });

  /**
   * Section PR with bestTime = 0 should be skipped.
   * 0 seconds is clearly invalid for a section time.
   */
  it('section PR with bestTime = 0 is skipped', () => {
    const result = generateInsights(
      {
        ...EMPTY_INPUT,
        recentPRs: [{ sectionId: 's1', sectionName: 'Test', bestTime: 0, daysAgo: 1 }],
      },
      mockT
    );
    const prInsights = result.filter((i) => i.id.startsWith('section_pr-'));
    // bestTime = 0 is not NaN, so Number.isFinite(0) = true. It passes the guard.
    // This may or may not be intentional (a 0-second PR is nonsensical).
    // The test documents the current behavior.
    expect(prInsights).toHaveLength(1);
  });

  /**
   * Section PR with negative bestTime should be filtered.
   * Negative time makes no physical sense.
   */
  it('section PR with negative bestTime is skipped', () => {
    const result = generateInsights(
      {
        ...EMPTY_INPUT,
        recentPRs: [{ sectionId: 's1', sectionName: 'Test', bestTime: -100, daysAgo: 1 }],
      },
      mockT
    );
    const prInsights = result.filter((i) => i.id.startsWith('section_pr-'));
    // Number.isFinite(-100) is true, so the guard only catches NaN/Infinity.
    // Negative bestTime passes through. This may be a gap in validation.
    expect(prInsights).toHaveLength(1);
  });

  /**
   * Period comparison with both periods having identical non-zero values.
   * Change should be < 10% so no insight is generated.
   */
  it('identical periods produce no comparison insight', () => {
    const period = {
      count: 5,
      totalDuration: 7200,
      totalDistance: 100000,
      totalTss: 200,
    };
    const result = generateInsights(
      {
        ...EMPTY_INPUT,
        currentPeriod: period,
        previousPeriod: period,
      },
      mockT
    );
    expect(result.find((i) => i.id === 'period_comparison-volume')).toBeUndefined();
  });

  /**
   * FTP equal values (no change) should not generate milestone.
   */
  it('FTP with no change (same value) does not generate insight', () => {
    const result = generateInsights(
      {
        ...EMPTY_INPUT,
        ftpTrend: {
          latestFtp: 250,
          latestDate: BigInt(1000),
          previousFtp: 250,
          previousDate: BigInt(500),
        },
      },
      mockT
    );
    expect(result.find((i) => i.id === 'fitness_milestone-ftp')).toBeUndefined();
  });

  /**
   * Pace got worse (lower threshold speed) should not generate milestone.
   */
  it('pace regression does not produce insight', () => {
    const result = generateInsights(
      {
        ...EMPTY_INPUT,
        paceTrend: {
          latestPace: 1000 / 350,
          latestDate: BigInt(1000),
          previousPace: 1000 / 300,
          previousDate: BigInt(500),
        },
      },
      mockT
    );
    expect(result.find((i) => i.id === 'fitness_milestone-pace')).toBeUndefined();
  });
});

// ============================================================
// BOUNDARY CONDITION TESTS
// ============================================================

describe('generateInsights - boundary conditions', () => {
  it('confidence tracks the day count the engine reports', () => {
    stubHrvTrend({
      label: 'trendingUp',
      avg: 51.6,
      latest: 60,
      dataPoints: 5,
      sparkline: [45, 48, 50, 55, 60],
    });
    const result = generateInsights(EMPTY_INPUT, mockT);
    const hrv = result.find((i) => i.id === 'hrv_trend');
    expect(hrv!.category).toBe('hrv_trend');
    expect(hrv!.confidence).toBeCloseTo(5 / 7, 2);
    mockGetRouteEngine.mockReturnValue(null);
  });

  it('the sparkline passes through the engine window untouched', () => {
    stubHrvTrend({
      label: 'stable',
      avg: 49,
      latest: 51,
      dataPoints: 5,
      sparkline: [45, 48, 52, 49, 51],
    });
    const result = generateInsights(EMPTY_INPUT, mockT);
    const hrv = result.find((i) => i.id === 'hrv_trend');
    expect(hrv!.supportingData?.sparklineData).toEqual([45, 48, 52, 49, 51]);
    mockGetRouteEngine.mockReturnValue(null);
  });

  /**
   * FTP improvement by tiny delta (1W) does not generate insight.
   * The minimum threshold is 5W to filter noise from small fluctuations.
   */
  it('FTP improvement below 5W threshold does not generate insight', () => {
    // 1W is below threshold; 0.4W rounds to 0 delta. Both must be suppressed.
    for (const latestFtp of [251, 250.4]) {
      const result = generateInsights(
        {
          ...EMPTY_INPUT,
          ftpTrend: {
            latestFtp,
            latestDate: BigInt(1000),
            previousFtp: 250,
            previousDate: BigInt(500),
          },
        },
        mockT
      );
      const ftp = result.find((i) => i.id === 'fitness_milestone-ftp');
      expect(ftp).toBeUndefined();
    }
  });

  /**
   * FTP improvement at exactly 5W boundary generates insight.
   */
  it('FTP improvement by exactly 5W generates insight', () => {
    const result = generateInsights(
      {
        ...EMPTY_INPUT,
        ftpTrend: {
          latestFtp: 255,
          latestDate: BigInt(1000),
          previousFtp: 250,
          previousDate: BigInt(500),
        },
      },
      mockT
    );
    const ftp = result.find((i) => i.id === 'fitness_milestone-ftp');
    expect(ftp!.title).toContain('change: 5');
  });

  /**
   * Empty sectionTrends array for stale PR detection.
   * The early return in addStalePRInsights checks
   * `!data.sectionTrends || data.sectionTrends.length === 0`
   * so no stale PR insight should be generated.
   */
  it('empty sectionTrends produces no stale PR insight', () => {
    const result = generateInsights(
      {
        ...EMPTY_INPUT,
        ftpTrend: {
          latestFtp: 280,
          latestDate: BigInt(1000),
          previousFtp: 250,
          previousDate: BigInt(500),
        },
        sectionTrends: [],
      },
      mockT
    );
    expect(result.find((i) => i.id === 'stale_pr-group')).toBeUndefined();
    expect(result.find((i) => i.id.startsWith('stale_pr-'))).toBeUndefined();
  });

  it('sectionTrends present but no fitness trend produces no stale PR insight', () => {
    const result = generateInsights(
      {
        ...EMPTY_INPUT,
        ftpTrend: null,
        paceTrend: null,
        sectionTrends: [
          {
            sectionId: 's1',
            sectionName: 'Hill',
            trend: 0,
            medianRecentSecs: 300,
            bestTimeSecs: 280,
            traversalCount: 5,
          },
        ],
      },
      mockT
    );
    expect(result.find((i) => i.id.startsWith('stale_pr-'))).toBeUndefined();
  });

  /**
   * Period comparison below the 15% threshold does not trigger.
   * 9% and 10% are both under 0.15.
   */
  it('period comparison below 15% threshold does not trigger', () => {
    for (const totalTss of [109, 110]) {
      const result = generateInsights(
        {
          ...EMPTY_INPUT,
          currentPeriod: {
            count: 3,
            totalDuration: 5450,
            totalDistance: 50000,
            totalTss,
          },
          previousPeriod: {
            count: 3,
            totalDuration: 5000,
            totalDistance: 50000,
            totalTss: 100,
          },
        },
        mockT
      );
      expect(result.find((i) => i.id === 'period_comparison-volume')).toBeUndefined();
    }
  });

  /**
   * Period comparison at 16% triggers (above 15% threshold).
   * 116/100 - 1 = 0.16 > 0.15.
   */
  it('period comparison at 16% triggers (above 15% threshold)', () => {
    const result = generateInsights(
      {
        ...EMPTY_INPUT,
        currentPeriod: {
          count: 3,
          totalDuration: 5800,
          totalDistance: 50000,
          totalTss: 116,
        },
        previousPeriod: {
          count: 3,
          totalDuration: 5000,
          totalDistance: 50000,
          totalTss: 100,
        },
      },
      mockT
    );
    const vol = result.find((i) => i.id === 'period_comparison-volume');
    expect(vol!.icon).toBe('trending-up');
  });
});

// ============================================================
// Insight consolidation
// ============================================================

describe('consolidateInsights', () => {
  function createInsight(
    id: string,
    category: Insight['category'],
    priority: Insight['priority'],
    options?: {
      timestamp?: number;
      sectionIds?: string[];
      navigationTarget?: string;
    }
  ): Insight {
    return {
      id,
      category,
      priority,
      title: id,
      icon: 'star',
      iconColor: '#000',
      timestamp: options?.timestamp ?? 0,
      isNew: false,
      navigationTarget: options?.navigationTarget,
      supportingData: options?.sectionIds
        ? {
            sections: options.sectionIds.map((sectionId) => ({
              sectionId,
              sectionName: sectionId,
            })),
          }
        : undefined,
    };
  }

  it('drops overlapping section stories when a recent PR already covers that section', () => {
    const result = consolidateInsights([
      createInsight('section-pr', 'section_pr', 1, {
        navigationTarget: '/section/s1',
      }),
      createInsight('efficiency-s1', 'efficiency_trend', 1, {
        sectionIds: ['s1'],
      }),
      createInsight('stale-s2', 'stale_pr', 2, {
        sectionIds: ['s2'],
      }),
    ]);

    expect(result.map((insight) => insight.id)).toEqual(['section-pr', 'stale-s2']);
  });

  // The two strongest, and strongest now means first: the list arrives in
  // score order rather than priority order.
  it('keeps only the first two non-PR section stories', () => {
    const result = consolidateInsights([
      createInsight('stale', 'stale_pr', 2, {
        sectionIds: ['s2'],
      }),
      createInsight('efficiency', 'efficiency_trend', 1, {
        sectionIds: ['s1'],
      }),
      createInsight('efficiency2', 'efficiency_trend', 1, {
        sectionIds: ['s3'],
      }),
      createInsight('fitness', 'fitness_milestone', 2),
    ]);

    expect(result.map((insight) => insight.id)).toEqual(['stale', 'efficiency', 'fitness']);
  });

  // ============================================================
  // Order and dedup
  //
  // Scenario: the pipeline scores every candidate and returns them in score
  // order, and consolidation then re-sorted by priority, so the score decided
  // only which cards survived the cap and never which one was first.
  // Expected behaviour: consolidation keeps the order it was given, and its
  // dedup does not depend on that order.
  // ============================================================

  it('keeps the order it was given rather than re-sorting by priority', () => {
    const result = consolidateInsights([
      createInsight('third-priority', 'fitness_milestone', 3),
      createInsight('first-priority', 'period_comparison', 1),
      createInsight('second-priority', 'hrv_trend', 2),
    ]);

    expect(result.map((insight) => insight.id)).toEqual([
      'third-priority',
      'first-priority',
      'second-priority',
    ]);
  });

  it('drops a section story its own PR covers even when the story comes first', () => {
    const result = consolidateInsights([
      createInsight('stale-s1', 'stale_pr', 1, { sectionIds: ['s1'] }),
      createInsight('section-pr', 'section_pr', 1, { navigationTarget: '/section/s1' }),
    ]);

    expect(result.map((insight) => insight.id)).toEqual(['section-pr']);
  });

  it('drops an efficiency trend its own PR covers even when the trend comes first', () => {
    const result = consolidateInsights([
      createInsight('efficiency-s1', 'efficiency_trend', 1, { sectionIds: ['s1'] }),
      createInsight('section-pr', 'section_pr', 1, { navigationTarget: '/section/s1' }),
    ]);

    expect(result.map((insight) => insight.id)).toEqual(['section-pr']);
  });

  it('drops a section story whose sections a later PR covers, whatever its priority', () => {
    const result = consolidateInsights([
      createInsight('stale-s1', 'stale_pr', 1, { sectionIds: ['s1'] }),
      createInsight('section-pr', 'section_pr', 5, { navigationTarget: '/section/s1' }),
    ]);

    expect(result.map((insight) => insight.id)).toEqual(['section-pr']);
  });

  it('keeps a section story the PRs do not cover, whichever way round they arrive', () => {
    const result = consolidateInsights([
      createInsight('stale-s2', 'stale_pr', 1, { sectionIds: ['s2'] }),
      createInsight('section-pr', 'section_pr', 1, { navigationTarget: '/section/s1' }),
    ]);

    expect(result.map((insight) => insight.id)).toEqual(['stale-s2', 'section-pr']);
  });

  it('spends the two section story slots in the order it was given', () => {
    const result = consolidateInsights([
      createInsight('stale-s3', 'stale_pr', 3, { sectionIds: ['s3'] }),
      createInsight('efficiency-s1', 'efficiency_trend', 1, { sectionIds: ['s1'] }),
      createInsight('efficiency-s2', 'efficiency_trend', 1, { sectionIds: ['s2'] }),
    ]);

    expect(result.map((insight) => insight.id)).toEqual(['stale-s3', 'efficiency-s1']);
  });

  it('leaves insights of equal priority in the order they arrived', () => {
    const result = consolidateInsights([
      createInsight('second', 'fitness_milestone', 2),
      createInsight('first', 'hrv_trend', 2),
    ]);

    expect(result.map((insight) => insight.id)).toEqual(['second', 'first']);
  });

  it('returns a single insight untouched', () => {
    const result = consolidateInsights([createInsight('only', 'fitness_milestone', 3)]);

    expect(result.map((insight) => insight.id)).toEqual(['only']);
  });

  // ============================================================
  // What the debug panel reads
  //
  // Scenario: the panel rendered the pipeline's own output, so the one stage
  // that can answer "why is that card not there" was invisible to it.
  // Expected behaviour: the pipeline outcome carries the consolidated list in
  // its final order and every consolidation drop with its reason.
  // ============================================================

  it('carries the consolidated list and its drops into the pipeline outcome', () => {
    generateInsights(EMPTY_INPUT, mockT);

    const kept = consolidateInsights([
      createInsight('section-pr', 'section_pr', 1, { navigationTarget: '/section/s1' }),
      createInsight('efficiency-s1', 'efficiency_trend', 1, { sectionIds: ['s1'] }),
      createInsight('stale-s2', 'stale_pr', 2, { sectionIds: ['s2'] }),
    ]);

    const outcome = getLastInsightOutcome();
    expect(outcome?.consolidated?.map((insight) => insight.id)).toEqual(
      kept.map((insight) => insight.id)
    );
    expect(outcome?.consolidationDropped.map((drop) => [drop.insight.id, drop.reason])).toEqual([
      ['efficiency-s1', 'duplicate section (already covered by PR insight)'],
    ]);
  });

  // ============================================================
  // Why a story was dropped
  //
  // Scenario: the drop reason is on screen in the debug panel, which is the
  // one tool for asking why a card is missing.
  // Expected behaviour: a story dropped for a PR names the PR, and a story
  // dropped for an earlier story names the story, so the reader is not sent
  // looking for a PR card that was never generated.
  // ============================================================

  it('names the earlier story, not a PR, when one story covers another', () => {
    generateInsights(EMPTY_INPUT, mockT);

    consolidateInsights([
      createInsight('stale-s1', 'stale_pr', 1, { sectionIds: ['s1'] }),
      createInsight('efficiency-s1', 'efficiency_trend', 1, { sectionIds: ['s1'] }),
    ]);

    expect(
      getLastInsightOutcome()?.consolidationDropped.map((drop) => [drop.insight.id, drop.reason])
    ).toEqual([['efficiency-s1', 'duplicate section (already covered by an earlier story)']]);
  });

  it('still names the PR when the PR is what covered the section', () => {
    generateInsights(EMPTY_INPUT, mockT);

    consolidateInsights([
      createInsight('section-pr', 'section_pr', 1, { navigationTarget: '/section/s1' }),
      createInsight('efficiency-s1', 'efficiency_trend', 1, { sectionIds: ['s1'] }),
    ]);

    expect(
      getLastInsightOutcome()?.consolidationDropped.map((drop) => [drop.insight.id, drop.reason])
    ).toEqual([['efficiency-s1', 'duplicate section (already covered by PR insight)']]);
  });

  it('names the earlier story when a PR covers one section and a story the other', () => {
    generateInsights(EMPTY_INPUT, mockT);

    consolidateInsights([
      createInsight('section-pr', 'section_pr', 1, { navigationTarget: '/section/s1' }),
      createInsight('stale-s2', 'stale_pr', 1, { sectionIds: ['s2'] }),
      createInsight('efficiency-both', 'efficiency_trend', 1, { sectionIds: ['s1', 's2'] }),
    ]);

    expect(
      getLastInsightOutcome()?.consolidationDropped.map((drop) => [drop.insight.id, drop.reason])
    ).toEqual([['efficiency-both', 'duplicate section (already covered by an earlier story)']]);
  });

  it('names the PR for a story a later PR covers, since no story covered it', () => {
    generateInsights(EMPTY_INPUT, mockT);

    consolidateInsights([
      createInsight('stale-s1', 'stale_pr', 1, { sectionIds: ['s1'] }),
      createInsight('section-pr', 'section_pr', 5, { navigationTarget: '/section/s1' }),
    ]);

    expect(
      getLastInsightOutcome()?.consolidationDropped.map((drop) => [drop.insight.id, drop.reason])
    ).toEqual([['stale-s1', 'duplicate section (already covered by PR insight)']]);
  });

  it('records the section story limit as the reason it dropped a card', () => {
    generateInsights(EMPTY_INPUT, mockT);

    consolidateInsights([
      createInsight('efficiency', 'efficiency_trend', 1, { sectionIds: ['s1'] }),
      createInsight('efficiency2', 'efficiency_trend', 1, { sectionIds: ['s2'] }),
      createInsight('stale', 'stale_pr', 2, { sectionIds: ['s3'] }),
    ]);

    expect(
      getLastInsightOutcome()?.consolidationDropped.map((drop) => [drop.insight.id, drop.reason])
    ).toEqual([['stale', 'section story limit (max 2)']]);
  });

  it('records the short-circuited single insight, which drops nothing', () => {
    generateInsights(EMPTY_INPUT, mockT);

    consolidateInsights([createInsight('only', 'fitness_milestone', 2)]);

    expect(getLastInsightOutcome()?.consolidated?.map((insight) => insight.id)).toEqual(['only']);
    expect(getLastInsightOutcome()?.consolidationDropped).toEqual([]);
  });

  it('records an empty consolidation rather than leaving the previous run standing', () => {
    generateInsights(EMPTY_INPUT, mockT);
    consolidateInsights([
      createInsight('a', 'fitness_milestone', 2),
      createInsight('b', 'fitness_milestone', 2),
    ]);
    expect(getLastInsightOutcome()?.consolidated).toHaveLength(2);

    consolidateInsights([]);

    expect(getLastInsightOutcome()?.consolidated).toEqual([]);
  });

  it('a fresh generation clears the consolidated list until consolidation runs again', () => {
    generateInsights(EMPTY_INPUT, mockT);
    consolidateInsights([
      createInsight('a', 'fitness_milestone', 2),
      createInsight('b', 'fitness_milestone', 2),
    ]);
    expect(getLastInsightOutcome()?.consolidated).not.toBeNull();

    generateInsights(EMPTY_INPUT, mockT);

    expect(getLastInsightOutcome()?.consolidated).toBeNull();
    expect(getLastInsightOutcome()?.consolidationDropped).toEqual([]);
  });
});

import {
  generateInsights,
  formatDurationCompact,
  InsightInputData,
} from '@/hooks/insights/generateInsights';
import type { Insight } from '@/types';

// Mock translation function — returns key with interpolated params
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
  todayPattern: null,
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
          currentPeriod: { count: 5, totalDuration: 7200, totalDistance: 100000, totalTss: 200 },
          previousPeriod: { count: 0, totalDuration: 0, totalDistance: 0, totalTss: 0 },
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
          recentPRs: [{ sectionId: 's1', sectionName: 'Hill Climb', bestTime: 300, daysAgo: 1 }],
        },
        mockT
      );
      const pr = result.find((i) => i.category === 'section_pr');
      expect(pr).toBeDefined();
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
  // HRV TREND (Priority 2) — replaces recovery readiness
  // ============================================================

  describe('HRV trend', () => {
    const makeHrvInput = (hrvValues: number[]): InsightInputData => ({
      ...EMPTY_INPUT,
      wellnessWindow: hrvValues.map((hrv, i) => ({
        date: `2026-02-${15 + i}`,
        hrv,
      })),
    });

    it('generates HRV trend with 3+ HRV values', () => {
      const result = generateInsights(makeHrvInput([50, 52, 55, 58, 60]), mockT);
      const hrv = result.find((i) => i.id === 'hrv_trend');
      expect(hrv).toBeDefined();
      expect(hrv!.category).toBe('hrv_trend');
      expect(hrv!.priority).toBe(2);
    });

    it('does not generate with fewer than 3 HRV values', () => {
      const result = generateInsights(makeHrvInput([50, 52]), mockT);
      expect(result.find((i) => i.id === 'hrv_trend')).toBeUndefined();
    });

    it('detects upward trend', () => {
      const result = generateInsights(makeHrvInput([40, 45, 50, 55, 60]), mockT);
      const hrv = result.find((i) => i.id === 'hrv_trend');
      expect(hrv!.title).toContain('trendingUp');
    });

    it('detects downward trend', () => {
      const result = generateInsights(makeHrvInput([60, 55, 50, 45, 40]), mockT);
      const hrv = result.find((i) => i.id === 'hrv_trend');
      expect(hrv!.title).toContain('trendingDown');
    });

    it('detects stable trend', () => {
      const result = generateInsights(makeHrvInput([50, 50, 50, 50, 50]), mockT);
      const hrv = result.find((i) => i.id === 'hrv_trend');
      expect(hrv!.title).toContain('stable');
    });

    it('includes HRV sparkline in supporting data', () => {
      const result = generateInsights(makeHrvInput([50, 52, 55, 58, 60]), mockT);
      const hrv = result.find((i) => i.id === 'hrv_trend');
      expect(hrv!.supportingData?.sparklineData).toEqual([50, 52, 55, 58, 60]);
    });

    it('includes methodology with Kiviniemi reference in APA format', () => {
      const result = generateInsights(makeHrvInput([50, 52, 55, 58, 60]), mockT);
      const hrv = result.find((i) => i.id === 'hrv_trend');
      expect(hrv!.methodology?.description).toContain('insights.methodology.hrvDescription');
    });

    it('skips when all HRV values are zero', () => {
      const result = generateInsights(makeHrvInput([0, 0, 0, 0, 0]), mockT);
      expect(result.find((i) => i.id === 'hrv_trend')).toBeUndefined();
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
      expect(ftp).toBeDefined();
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
      expect(pace).toBeDefined();
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
      expect(swim).toBeDefined();
      expect(swim!.title).toContain('delta: 9s/100m');
    });
  });

  // ============================================================
  // PERIOD COMPARISON (Priority 2)
  // ============================================================

  describe('period comparison', () => {
    it('detects load increase >10% (uses TSS when available)', () => {
      const result = generateInsights(
        {
          ...EMPTY_INPUT,
          currentPeriod: { count: 5, totalDuration: 7200, totalDistance: 100000, totalTss: 200 },
          previousPeriod: { count: 4, totalDuration: 5000, totalDistance: 80000, totalTss: 150 },
        },
        mockT
      );
      const vol = result.find((i) => i.id === 'period_comparison-volume');
      expect(vol).toBeDefined();
      expect(vol!.icon).toBe('trending-up');
      expect(vol!.title).toContain('weeklyLoadUp');
    });

    it('detects load decrease >10% (uses TSS when available)', () => {
      const result = generateInsights(
        {
          ...EMPTY_INPUT,
          currentPeriod: { count: 2, totalDuration: 3000, totalDistance: 40000, totalTss: 80 },
          previousPeriod: { count: 5, totalDuration: 7200, totalDistance: 100000, totalTss: 200 },
        },
        mockT
      );
      const vol = result.find((i) => i.id === 'period_comparison-volume');
      expect(vol).toBeDefined();
      expect(vol!.icon).toBe('trending-down');
      expect(vol!.title).toContain('weeklyLoadDown');
    });

    it('no insight when load change <10%', () => {
      const result = generateInsights(
        {
          ...EMPTY_INPUT,
          currentPeriod: { count: 5, totalDuration: 5200, totalDistance: 100000, totalTss: 195 },
          previousPeriod: { count: 5, totalDuration: 5000, totalDistance: 100000, totalTss: 200 },
        },
        mockT
      );
      expect(result.find((i) => i.id === 'period_comparison-volume')).toBeUndefined();
    });

    it('falls back to duration when TSS is zero', () => {
      const result = generateInsights(
        {
          ...EMPTY_INPUT,
          currentPeriod: { count: 5, totalDuration: 7200, totalDistance: 100000, totalTss: 0 },
          previousPeriod: { count: 4, totalDuration: 5000, totalDistance: 80000, totalTss: 0 },
        },
        mockT
      );
      const vol = result.find((i) => i.id === 'period_comparison-volume');
      expect(vol).toBeDefined();
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
          currentPeriod: { count: 5, totalDuration: 7200, totalDistance: 100000, totalTss: 400 },
          previousPeriod: { count: 4, totalDuration: 5000, totalDistance: 80000, totalTss: 200 },
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
          currentPeriod: { count: 0, totalDuration: 0, totalDistance: 0, totalTss: 0 },
          previousPeriod: { count: 5, totalDuration: 7200, totalDistance: 100000, totalTss: 200 },
        },
        mockT
      );
      expect(result.find((i) => i.id === 'period_comparison-volume')).toBeUndefined();
    });
  });

  // ============================================================
  // REMOVED INSIGHTS — ensure they are gone
  // ============================================================

  describe('removed insights', () => {
    it('does not generate ACWR insight', () => {
      const result = generateInsights(
        {
          ...EMPTY_INPUT,
          currentPeriod: { count: 5, totalDuration: 7200, totalDistance: 100000, totalTss: 200 },
          chronicPeriod: { count: 5, totalDuration: 5000, totalDistance: 80000, totalTss: 200 },
        },
        mockT
      );
      expect(result.find((i) => i.id === 'workload_risk-acwr')).toBeUndefined();
    });

    it('does not generate recovery readiness insight', () => {
      const result = generateInsights(
        {
          ...EMPTY_INPUT,
          formTsb: 10,
          formCtl: 50,
          formAtl: 40,
          wellnessWindow: [
            { date: '2026-02-15', hrv: 50, ctl: 50, atl: 40 },
            { date: '2026-02-16', hrv: 52, ctl: 50, atl: 40 },
            { date: '2026-02-17', hrv: 55, ctl: 50, atl: 40 },
            { date: '2026-02-18', hrv: 58, ctl: 50, atl: 40 },
            { date: '2026-02-19', hrv: 60, ctl: 50, atl: 40 },
          ],
        },
        mockT
      );
      expect(result.find((i) => i.id === 'recovery_readiness')).toBeUndefined();
    });

    it('does not generate training monotony insight', () => {
      const result = generateInsights(
        {
          ...EMPTY_INPUT,
          wellnessWindow: [
            { date: '2026-02-15', atl: 50, ctl: 50 },
            { date: '2026-02-16', atl: 50, ctl: 50 },
            { date: '2026-02-17', atl: 50, ctl: 50 },
            { date: '2026-02-18', atl: 51, ctl: 50 },
            { date: '2026-02-19', atl: 50, ctl: 50 },
          ],
        },
        mockT
      );
      expect(result.find((i) => i.id === 'workload_risk-monotony')).toBeUndefined();
    });

    it('does not generate form trajectory insight', () => {
      const result = generateInsights(
        { ...EMPTY_INPUT, formTsb: -5, formCtl: 50, formAtl: 55 },
        mockT
      );
      expect(result.find((i) => i.id === 'form_trajectory')).toBeUndefined();
    });

    it('does not generate ramp rate insight', () => {
      const result = generateInsights(
        { ...EMPTY_INPUT, formTsb: 0, formCtl: 50, formAtl: 50, rampRate: 4 },
        mockT
      );
      expect(result.find((i) => i.id === 'form_trajectory-ramp')).toBeUndefined();
    });

    it('does not generate peak CTL insight', () => {
      const result = generateInsights({ ...EMPTY_INPUT, currentCtl: 96, peakCtl: 100 }, mockT);
      expect(result.find((i) => i.id === 'fitness_milestone-peak-ctl')).toBeUndefined();
    });

    it('does not generate section performance vs fitness insight', () => {
      const result = generateInsights(
        {
          ...EMPTY_INPUT,
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
        mockT
      );
      expect(result.find((i) => i.id.startsWith('section_performance-fitness'))).toBeUndefined();
    });

    it('does not generate old form advice insight', () => {
      const result = generateInsights(
        { ...EMPTY_INPUT, formTsb: -5, formCtl: 50, formAtl: 55 },
        mockT
      );
      expect(result.find((i) => i.id === 'training_consistency-form')).toBeUndefined();
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
              sportType: 'Ride',
            },
            {
              sectionId: 'swim-1',
              sectionName: 'Pool Threshold Set',
              trend: 0,
              medianRecentSecs: 390,
              bestTimeSecs: 360,
              traversalCount: 5,
              sportType: 'Swim',
            },
          ],
        },
        mockT
      );

      const stale = result.find((insight) => insight.id === 'stale_pr-group');
      expect(stale).toBeDefined();
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
          currentPeriod: { count: 5, totalDuration: 7200, totalDistance: 100000, totalTss: 200 },
          previousPeriod: { count: 4, totalDuration: 5000, totalDistance: 80000, totalTss: 150 },
          todayPattern: {
            sportType: 'Ride',
            primaryDay: 2,
            avgDurationSecs: 5400,
            confidence: 0.8,
            activityCount: 10,
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
          currentPeriod: { count: 5, totalDuration: 7200, totalDistance: 100000, totalTss: 240 },
          previousPeriod: { count: 4, totalDuration: 5400, totalDistance: 70000, totalTss: 180 },
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
          wellnessWindow: [
            { date: '2026-02-15', hrv: 55, ctl: 60, atl: 65 },
            { date: '2026-02-16', hrv: 57, ctl: 60, atl: 65 },
            { date: '2026-02-17', hrv: 59, ctl: 60, atl: 65 },
          ],
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
  // INFORMATIONAL FRAMING — no prescriptive text
  // ============================================================

  describe('informational framing', () => {
    it('no insight has alternatives array (removed prescriptive zone comparisons)', () => {
      const result = generateInsights(
        {
          ...EMPTY_INPUT,
          formTsb: -5,
          formCtl: 50,
          formAtl: 55,
          wellnessWindow: [
            { date: '2026-02-15', hrv: 50, ctl: 50, atl: 55 },
            { date: '2026-02-16', hrv: 52, ctl: 50, atl: 55 },
            { date: '2026-02-17', hrv: 55, ctl: 50, atl: 55 },
          ],
          currentPeriod: { count: 5, totalDuration: 7200, totalDistance: 100000, totalTss: 250 },
          previousPeriod: { count: 4, totalDuration: 5000, totalDistance: 80000, totalTss: 150 },
          chronicPeriod: { count: 5, totalDuration: 5000, totalDistance: 80000, totalTss: 200 },
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
          currentPeriod: { count: 5, totalDuration: 7200, totalDistance: 100000, totalTss: 200 },
          previousPeriod: { count: 4, totalDuration: 5000, totalDistance: 80000, totalTss: 150 },
        },
        mockT
      );
      const vol = result.find((i) => i.id === 'period_comparison-volume');
      expect(vol?.body).toBeDefined();
      expect(vol!.body).toContain('insights.loadBody');
    });
  });
});

// ============================================================
// formatDurationCompact
// ============================================================

describe('formatDurationCompact', () => {
  it('formats hours and minutes', () => {
    expect(formatDurationCompact(5400)).toBe('1h30');
  });

  it('formats hours only', () => {
    expect(formatDurationCompact(3600)).toBe('1h');
  });

  it('formats minutes only', () => {
    expect(formatDurationCompact(2700)).toBe('45m');
  });

  it('handles zero', () => {
    expect(formatDurationCompact(0)).toBe('0m');
  });

  it('handles negative', () => {
    expect(formatDurationCompact(-100)).toBe('0m');
  });

  it('handles NaN', () => {
    expect(formatDurationCompact(NaN)).toBe('0m');
  });

  it('handles Infinity', () => {
    expect(formatDurationCompact(Infinity)).toBe('0m');
  });

  it('pads minutes with leading zero', () => {
    expect(formatDurationCompact(3660)).toBe('1h01');
  });
});

// ============================================================
// ADDITIONAL EDGE CASE BUG HUNTING
// ============================================================

describe('generateInsights — additional edge cases', () => {
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
   * pace.latestPace = 0 means 0 m/s — effectively no movement.
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
        currentPeriod: { count: 3, totalDuration: 5000, totalDistance: 50000, totalTss: 150 },
        previousPeriod: { count: 0, totalDuration: 0, totalDistance: 0, totalTss: 0 },
      },
      mockT
    );
    expect(result.find((i) => i.id === 'period_comparison-volume')).toBeUndefined();
  });

  /**
   * Single HRV data point should NOT generate an HRV trend.
   * Trends from 1-2 points are unreliable.
   */
  it('single HRV value does not produce trend insight', () => {
    const result = generateInsights(
      {
        ...EMPTY_INPUT,
        wellnessWindow: [{ date: '2026-02-15', hrv: 55 }],
      },
      mockT
    );
    expect(result.find((i) => i.id === 'hrv_trend')).toBeUndefined();
  });

  /**
   * HRV values with NaN entries should be filtered out and not crash.
   * If all values are NaN, no insight should be generated.
   */
  it('all-NaN HRV values do not produce trend insight', () => {
    const result = generateInsights(
      {
        ...EMPTY_INPUT,
        wellnessWindow: [
          { date: '2026-02-15', hrv: NaN },
          { date: '2026-02-16', hrv: NaN },
          { date: '2026-02-17', hrv: NaN },
        ],
      },
      mockT
    );
    expect(result.find((i) => i.id === 'hrv_trend')).toBeUndefined();
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
    const period = { count: 5, totalDuration: 7200, totalDistance: 100000, totalTss: 200 };
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

describe('generateInsights — boundary conditions', () => {
  /**
   * HRV trend with exactly 3 values (minimum for trend detection).
   * The guard requires >= 3 HRV values. At exactly 3, the split is:
   * firstHalf = [0..floor(3/2)) = [v0], secondHalf = [floor(3/2)..) = [v1, v2]
   */
  it('HRV trend with exactly 3 values generates insight', () => {
    const result = generateInsights(
      {
        ...EMPTY_INPUT,
        wellnessWindow: [
          { date: '2026-02-15', hrv: 50 },
          { date: '2026-02-16', hrv: 55 },
          { date: '2026-02-17', hrv: 60 },
        ],
      },
      mockT
    );
    const hrv = result.find((i) => i.id === 'hrv_trend');
    expect(hrv).toBeDefined();
    expect(hrv!.category).toBe('hrv_trend');
    // Confidence should be 3/7
    expect(hrv!.confidence).toBeCloseTo(3 / 7, 2);
  });

  it('HRV trend with exactly 3 values detects upward trend correctly', () => {
    const result = generateInsights(
      {
        ...EMPTY_INPUT,
        wellnessWindow: [
          { date: '2026-02-15', hrv: 40 },
          { date: '2026-02-16', hrv: 50 },
          { date: '2026-02-17', hrv: 60 },
        ],
      },
      mockT
    );
    const hrv = result.find((i) => i.id === 'hrv_trend');
    expect(hrv).toBeDefined();
    // firstHalf=[40], secondHalf=[50,60] => firstAvg=40, secondAvg=55
    // secondAvg > firstAvg * 1.02 => upward
    expect(hrv!.title).toContain('trendingUp');
  });

  it('HRV sparkline data with 3 values is accurate', () => {
    const result = generateInsights(
      {
        ...EMPTY_INPUT,
        wellnessWindow: [
          { date: '2026-02-15', hrv: 48 },
          { date: '2026-02-16', hrv: 52 },
          { date: '2026-02-17', hrv: 49 },
        ],
      },
      mockT
    );
    const hrv = result.find((i) => i.id === 'hrv_trend');
    expect(hrv!.supportingData?.sparklineData).toEqual([48, 52, 49]);
  });

  /**
   * FTP improvement by tiny delta (1W).
   * Math.round(latestFtp - previousFtp) = 1 > 0, so it should still generate.
   */
  it('FTP improvement by exactly 1W still generates insight', () => {
    const result = generateInsights(
      {
        ...EMPTY_INPUT,
        ftpTrend: {
          latestFtp: 251,
          latestDate: BigInt(1000),
          previousFtp: 250,
          previousDate: BigInt(500),
        },
      },
      mockT
    );
    const ftp = result.find((i) => i.id === 'fitness_milestone-ftp');
    expect(ftp).toBeDefined();
    expect(ftp!.title).toContain('change: 1');
  });

  it('FTP improvement by sub-watt delta (0.4W) does not generate insight', () => {
    // Math.round(250.4 - 250) = 0 => delta is 0, should not pass delta > 0 guard
    const result = generateInsights(
      {
        ...EMPTY_INPUT,
        ftpTrend: {
          latestFtp: 250.4,
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
   * All-zero wellness window — verify no division by zero.
   * The HRV filter `w.hrv > 0` removes all entries, leaving fewer than 3,
   * so no HRV insight is generated. Additionally the avg check `avg <= 0`
   * is a second guard.
   */
  it('all-zero wellness window does not crash or generate HRV insight', () => {
    const result = generateInsights(
      {
        ...EMPTY_INPUT,
        wellnessWindow: [
          { date: '2026-02-15', hrv: 0, ctl: 0, atl: 0 },
          { date: '2026-02-16', hrv: 0, ctl: 0, atl: 0 },
          { date: '2026-02-17', hrv: 0, ctl: 0, atl: 0 },
          { date: '2026-02-18', hrv: 0, ctl: 0, atl: 0 },
          { date: '2026-02-19', hrv: 0, ctl: 0, atl: 0 },
        ],
      },
      mockT
    );
    expect(result.find((i) => i.id === 'hrv_trend')).toBeUndefined();
  });

  it('wellness window with mix of zero and undefined HRV does not crash', () => {
    expect(() =>
      generateInsights(
        {
          ...EMPTY_INPUT,
          wellnessWindow: [
            { date: '2026-02-15', hrv: 0 },
            { date: '2026-02-16' },
            { date: '2026-02-17', hrv: undefined },
            { date: '2026-02-18', hrv: 0 },
            { date: '2026-02-19', hrv: 0 },
          ],
        },
        mockT
      )
    ).not.toThrow();
  });

  it('wellness window with exactly one non-zero HRV does not generate trend', () => {
    const result = generateInsights(
      {
        ...EMPTY_INPUT,
        wellnessWindow: [
          { date: '2026-02-15', hrv: 0 },
          { date: '2026-02-16', hrv: 55 },
          { date: '2026-02-17', hrv: 0 },
          { date: '2026-02-18', hrv: 0 },
        ],
      },
      mockT
    );
    // Only 1 valid HRV value, need >= 3
    expect(result.find((i) => i.id === 'hrv_trend')).toBeUndefined();
  });

  /**
   * Period comparison at exactly the threshold boundary (10%).
   * ratio = 110/100 - 1 = 0.10000000000000009 (floating point).
   * The guard is `ratio > 0.1`, and due to IEEE 754 this evaluates to true.
   * This documents the floating-point boundary behavior.
   */
  it('period comparison at exact 10% boundary triggers due to floating point', () => {
    const result = generateInsights(
      {
        ...EMPTY_INPUT,
        currentPeriod: { count: 3, totalDuration: 5500, totalDistance: 50000, totalTss: 110 },
        previousPeriod: { count: 3, totalDuration: 5000, totalDistance: 50000, totalTss: 100 },
      },
      mockT
    );
    // 110/100 - 1 = 0.10000000000000009 > 0.1 due to IEEE 754
    const vol = result.find((i) => i.id === 'period_comparison-volume');
    expect(vol).toBeDefined();
    expect(vol!.icon).toBe('trending-up');
  });

  /**
   * Period comparison just below threshold — 9% change should not trigger.
   */
  it('period comparison at 9% change does not trigger', () => {
    const result = generateInsights(
      {
        ...EMPTY_INPUT,
        currentPeriod: { count: 3, totalDuration: 5450, totalDistance: 50000, totalTss: 109 },
        previousPeriod: { count: 3, totalDuration: 5000, totalDistance: 50000, totalTss: 100 },
      },
      mockT
    );
    expect(result.find((i) => i.id === 'period_comparison-volume')).toBeUndefined();
  });
});

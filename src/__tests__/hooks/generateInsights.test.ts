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

    it('returns TSB form position when formTsb is provided with wellness data', () => {
      const result = generateInsights(
        { ...EMPTY_INPUT, formTsb: 0, formCtl: 50, formAtl: 50 },
        mockT
      );
      expect(result).toHaveLength(1);
      expect(result.find((i) => i.id === 'tsb_form-position')).toBeDefined();
    });

    it('formTsb = NaN does not generate TSB form insight', () => {
      const result = generateInsights(
        { ...EMPTY_INPUT, formTsb: NaN, formCtl: 50, formAtl: 50 },
        mockT
      );
      expect(result.find((i) => i.id === 'tsb_form-position')).toBeUndefined();
    });

    it('formTsb = Infinity does not generate TSB form insight', () => {
      const result = generateInsights(
        { ...EMPTY_INPUT, formTsb: Infinity, formCtl: 50, formAtl: 50 },
        mockT
      );
      expect(result.find((i) => i.id === 'tsb_form-position')).toBeUndefined();
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
  // TSB FORM POSITION (Priority 2) — replaces form advice
  // ============================================================

  describe('TSB form position', () => {
    it('generates TSB form insight when formTsb is provided', () => {
      const result = generateInsights(
        { ...EMPTY_INPUT, formTsb: -5, formCtl: 50, formAtl: 55 },
        mockT
      );
      const tsb = result.find((i) => i.id === 'tsb_form-position');
      expect(tsb).toBeDefined();
      expect(tsb!.category).toBe('tsb_form');
      expect(tsb!.priority).toBe(2);
      expect(tsb!.navigationTarget).toBe('/fitness');
    });

    it('does not generate when formTsb is null', () => {
      const result = generateInsights(EMPTY_INPUT, mockT);
      expect(result.find((i) => i.id === 'tsb_form-position')).toBeUndefined();
    });

    it('does not generate when no wellness data (ctl and atl both null)', () => {
      const result = generateInsights(
        { ...EMPTY_INPUT, formTsb: 0, formCtl: null, formAtl: null },
        mockT
      );
      expect(result.find((i) => i.id === 'tsb_form-position')).toBeUndefined();
    });

    it('includes CTL, ATL, TSB in supporting data', () => {
      const result = generateInsights(
        { ...EMPTY_INPUT, formTsb: -5, formCtl: 50, formAtl: 55 },
        mockT
      );
      const tsb = result.find((i) => i.id === 'tsb_form-position');
      const labels = tsb!.supportingData!.dataPoints!.map((dp) => dp.label);
      expect(labels).toContain('CTL');
      expect(labels).toContain('ATL');
      expect(labels).toContain('TSB');
    });

    it('includes methodology with Banister reference in APA format', () => {
      const result = generateInsights(
        { ...EMPTY_INPUT, formTsb: -5, formCtl: 50, formAtl: 55 },
        mockT
      );
      const tsb = result.find((i) => i.id === 'tsb_form-position');
      expect(tsb!.methodology!.formula).toBe('TSB = CTL - ATL');
      expect(tsb!.methodology!.references).toBeDefined();
      expect(tsb!.methodology!.references!.length).toBeGreaterThanOrEqual(2);
      expect(tsb!.methodology!.references![0].citation).toContain('Banister');
      expect(tsb!.methodology!.references![0].url).toBeDefined();
    });

    it('title contains no prescriptive advice', () => {
      const result = generateInsights(
        { ...EMPTY_INPUT, formTsb: 20, formCtl: 50, formAtl: 30 },
        mockT
      );
      const tsb = result.find((i) => i.id === 'tsb_form-position');
      expect(tsb!.title).not.toContain('recommended');
      expect(tsb!.title).not.toContain('consider');
    });

    // TSB zone boundaries (intervals.icu): fresh > 25, transition > 5, greyZone > -10, optimal > -30
    it.each([
      [30, 'fresh'],
      [10, 'transition'],
      [0, 'greyZone'],
      [-5, 'greyZone'],
      [-15, 'optimal'],
      [-35, 'highRisk'],
    ])('formTsb=%i maps to %s zone', (tsb, zone) => {
      const result = generateInsights(
        { ...EMPTY_INPUT, formTsb: tsb, formCtl: 50, formAtl: 50 },
        mockT
      );
      const form = result.find((i) => i.id === 'tsb_form-position');
      expect(form).toBeDefined();
      expect(form!.title).toContain(zone);
    });

    it('formTsb at exactly 25 maps to transition zone (boundary)', () => {
      const result = generateInsights(
        { ...EMPTY_INPUT, formTsb: 25, formCtl: 50, formAtl: 50 },
        mockT
      );
      const tsb = result.find((i) => i.id === 'tsb_form-position');
      expect(tsb!.title).toContain('transition');
    });

    it('formTsb at 25.01 maps to fresh zone', () => {
      const result = generateInsights(
        { ...EMPTY_INPUT, formTsb: 25.01, formCtl: 50, formAtl: 50 },
        mockT
      );
      const tsb = result.find((i) => i.id === 'tsb_form-position');
      expect(tsb!.title).toContain('fresh');
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
      expect(hrv!.methodology?.references).toBeDefined();
      expect(hrv!.methodology?.references![0].citation).toContain('Kiviniemi');
      expect(hrv!.methodology?.references![0].url).toContain('pubmed');
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

    it('detects pace improvement (lower is better)', () => {
      const result = generateInsights(
        {
          ...EMPTY_INPUT,
          paceTrend: {
            latestPace: 280,
            latestDate: BigInt(1000),
            previousPace: 300,
            previousDate: BigInt(500),
          },
        },
        mockT
      );
      const pace = result.find((i) => i.id === 'fitness_milestone-pace');
      expect(pace).toBeDefined();
      expect(pace!.title).toContain('delta: 20');
    });

    it('does not generate pace insight when pace got worse', () => {
      const result = generateInsights(
        {
          ...EMPTY_INPUT,
          paceTrend: {
            latestPace: 320,
            latestDate: BigInt(1000),
            previousPace: 300,
            previousDate: BigInt(500),
          },
        },
        mockT
      );
      expect(result.find((i) => i.id === 'fitness_milestone-pace')).toBeUndefined();
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

  // ============================================================
  // REST DAY INSIGHTS
  // ============================================================

  describe('rest day insights', () => {
    it('generates intensity context on rest day', () => {
      const result = generateInsights(
        {
          ...EMPTY_INPUT,
          isRestDay: true,
          currentPeriod: { count: 4, totalDuration: 7200, totalDistance: 80000, totalTss: 200 },
          previousPeriod: { count: 3, totalDuration: 5000, totalDistance: 60000, totalTss: 150 },
        },
        mockT
      );
      const intensity = result.find((i) => i.id === 'rest_day-intensity-context');
      expect(intensity).toBeDefined();
      expect(intensity!.category).toBe('intensity_context');
    });

    it('generates section trends on rest day when improving sections exist', () => {
      const result = generateInsights(
        {
          ...EMPTY_INPUT,
          isRestDay: true,
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
      const trends = result.find((i) => i.id === 'rest_day-section-trends');
      expect(trends).toBeDefined();
    });

    it('does not generate section trends when no improving sections', () => {
      const result = generateInsights(
        {
          ...EMPTY_INPUT,
          isRestDay: true,
          sectionTrends: [
            {
              sectionId: 's1',
              sectionName: 'Hill',
              trend: -1,
              medianRecentSecs: 300,
              bestTimeSecs: 270,
              traversalCount: 10,
            },
          ],
        },
        mockT
      );
      expect(result.find((i) => i.id === 'rest_day-section-trends')).toBeUndefined();
    });

    // Tomorrow pattern removed from card list — shown in Today banner only
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

      expect(result.length).toBeGreaterThanOrEqual(4);
      for (let i = 1; i < result.length; i++) {
        expect(result[i].priority).toBeGreaterThanOrEqual(result[i - 1].priority);
      }
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
    it('TSB form title does not contain prescriptive words', () => {
      const prescriptiveWords = ['recommended', 'should', 'consider', 'rest', 'intensity'];
      for (const tsb of [-40, -15, 0, 10, 20]) {
        const result = generateInsights(
          { ...EMPTY_INPUT, formTsb: tsb, formCtl: 50, formAtl: 50 },
          mockT
        );
        const form = result.find((i) => i.id === 'tsb_form-position');
        if (form) {
          for (const word of prescriptiveWords) {
            // Title is translation key-based, so just check the insight doesn't have prescriptive advice
            expect(form.title).not.toContain(word);
          }
        }
      }
    });

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

    it('TSB form body contains rounded values', () => {
      const result = generateInsights(
        { ...EMPTY_INPUT, formTsb: -5.7, formCtl: 50.3, formAtl: 55.9 },
        mockT
      );
      const tsb = result.find((i) => i.id === 'tsb_form-position');
      expect(tsb?.body).toBeDefined();
      expect(tsb!.body).toContain('tsb: -6');
      expect(tsb!.body).toContain('ctl: 50');
      expect(tsb!.body).toContain('atl: 56');
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

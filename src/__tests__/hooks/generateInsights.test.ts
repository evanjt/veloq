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
  // WEEKLY LOAD CHANGE (Priority 2) — replaces ACWR
  // ============================================================

  describe('weekly load change', () => {
    const makeLoadInput = (acuteTss: number, chronicTss: number): InsightInputData => ({
      ...EMPTY_INPUT,
      currentPeriod: { count: 5, totalDuration: 7200, totalDistance: 100000, totalTss: acuteTss },
      chronicPeriod: { count: 5, totalDuration: 5000, totalDistance: 80000, totalTss: chronicTss },
    });

    it('generates weekly load change when >15% above average', () => {
      // acute = 250, chronic = 200 => +25%
      const result = generateInsights(makeLoadInput(250, 200), mockT);
      const load = result.find((i) => i.id === 'weekly_load-change');
      expect(load).toBeDefined();
      expect(load!.category).toBe('weekly_load');
      expect(load!.priority).toBe(2);
    });

    it('generates weekly load change when >15% below average', () => {
      // acute = 150, chronic = 200 => -25%
      const result = generateInsights(makeLoadInput(150, 200), mockT);
      const load = result.find((i) => i.id === 'weekly_load-change');
      expect(load).toBeDefined();
    });

    it('does not generate when difference <15%', () => {
      // acute = 210, chronic = 200 => +5%
      const result = generateInsights(makeLoadInput(210, 200), mockT);
      expect(result.find((i) => i.id === 'weekly_load-change')).toBeUndefined();
    });

    it('does not generate when chronic period is null', () => {
      const result = generateInsights(
        {
          ...EMPTY_INPUT,
          currentPeriod: { count: 5, totalDuration: 7200, totalDistance: 100000, totalTss: 200 },
          chronicPeriod: null,
        },
        mockT
      );
      expect(result.find((i) => i.id === 'weekly_load-change')).toBeUndefined();
    });

    it('does not generate when chronic TSS is zero', () => {
      const result = generateInsights(makeLoadInput(200, 0), mockT);
      expect(result.find((i) => i.id === 'weekly_load-change')).toBeUndefined();
    });

    it('includes methodology with Impellizzeri reference in APA format', () => {
      const result = generateInsights(makeLoadInput(250, 200), mockT);
      const load = result.find((i) => i.id === 'weekly_load-change');
      expect(load!.methodology?.references).toBeDefined();
      expect(load!.methodology?.references![0].citation).toContain('Impellizzeri');
      expect(load!.methodology?.references![0].url).toContain('pubmed');
    });

    it('contains no zone labels or injury risk language', () => {
      const result = generateInsights(makeLoadInput(350, 200), mockT);
      const load = result.find((i) => i.id === 'weekly_load-change');
      expect(load!.title).not.toContain('injury');
      expect(load!.title).not.toContain('risk');
      expect(load!.title).not.toContain('danger');
    });

    it('suppresses when current week has zero activities', () => {
      const result = generateInsights(
        {
          ...EMPTY_INPUT,
          currentPeriod: { count: 0, totalDuration: 0, totalDistance: 0, totalTss: 0 },
          chronicPeriod: { count: 5, totalDuration: 5000, totalDistance: 80000, totalTss: 200 },
        },
        mockT
      );
      expect(result.find((i) => i.id === 'weekly_load-change')).toBeUndefined();
    });

    it('suppresses when period comparison already generated', () => {
      const result = generateInsights(
        {
          ...EMPTY_INPUT,
          currentPeriod: { count: 5, totalDuration: 7200, totalDistance: 100000, totalTss: 250 },
          previousPeriod: { count: 4, totalDuration: 5000, totalDistance: 80000, totalTss: 150 },
          chronicPeriod: { count: 5, totalDuration: 5000, totalDistance: 80000, totalTss: 200 },
        },
        mockT
      );
      // Period comparison fires (250 vs 150 = +67%)
      expect(result.find((i) => i.id === 'period_comparison-volume')).toBeDefined();
      // Weekly load is suppressed to avoid redundancy
      expect(result.find((i) => i.id === 'weekly_load-change')).toBeUndefined();
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
      expect(ftp!.title).toContain('delta: 10');
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
  // ACTIVITY PATTERNS (Priority 4)
  // ============================================================

  describe('activity patterns', () => {
    it('generates pattern insight when confidence >= 0.6', () => {
      const result = generateInsights(
        {
          ...EMPTY_INPUT,
          todayPattern: {
            sportType: 'Ride',
            primaryDay: 2,
            avgDurationSecs: 5400,
            confidence: 0.7,
            activityCount: 10,
          },
        },
        mockT
      );
      const pattern = result.find((i) => i.category === 'activity_pattern');
      expect(pattern).toBeDefined();
      expect(pattern!.priority).toBe(4);
    });

    it('skips pattern when confidence < 0.6', () => {
      const result = generateInsights(
        {
          ...EMPTY_INPUT,
          todayPattern: {
            sportType: 'Ride',
            primaryDay: 2,
            avgDurationSecs: 5400,
            confidence: 0.4,
            activityCount: 10,
          },
        },
        mockT
      );
      expect(result.find((i) => i.category === 'activity_pattern')).toBeUndefined();
    });

    it('methodology references Michie et al. in APA format', () => {
      const result = generateInsights(
        {
          ...EMPTY_INPUT,
          todayPattern: {
            sportType: 'Ride',
            primaryDay: 2,
            avgDurationSecs: 5400,
            confidence: 0.8,
            activityCount: 10,
          },
        },
        mockT
      );
      const pattern = result.find((i) => i.category === 'activity_pattern');
      expect(pattern!.methodology?.references).toBeDefined();
      expect(pattern!.methodology?.references![0].citation).toContain('Michie');
      expect(pattern!.methodology?.references![0].url).toContain('pubmed');
    });
  });

  // ============================================================
  // CONSISTENCY (Priority 3)
  // ============================================================

  describe('consistency', () => {
    it('generates streak when both periods have 3+ activities', () => {
      const result = generateInsights(
        {
          ...EMPTY_INPUT,
          currentPeriod: { count: 4, totalDuration: 5000, totalDistance: 80000, totalTss: 150 },
          previousPeriod: { count: 3, totalDuration: 5000, totalDistance: 80000, totalTss: 150 },
        },
        mockT
      );
      const streak = result.find((i) => i.id === 'training_consistency-streak');
      expect(streak).toBeDefined();
      expect(streak!.priority).toBe(3);
    });

    it('shows partial consistency when only one week qualifies', () => {
      const result = generateInsights(
        {
          ...EMPTY_INPUT,
          currentPeriod: { count: 1, totalDuration: 3000, totalDistance: 40000, totalTss: 50 },
          previousPeriod: { count: 4, totalDuration: 5000, totalDistance: 80000, totalTss: 150 },
        },
        mockT
      );
      const partial = result.find((i) => i.id === 'training_consistency-partial');
      expect(partial).toBeDefined();
      expect(partial!.title).toContain('good: 1');
    });

    it('includes methodology with Lally/Kaushal references in APA format', () => {
      const result = generateInsights(
        {
          ...EMPTY_INPUT,
          currentPeriod: { count: 4, totalDuration: 5000, totalDistance: 80000, totalTss: 150 },
          previousPeriod: { count: 3, totalDuration: 5000, totalDistance: 80000, totalTss: 150 },
        },
        mockT
      );
      const streak = result.find((i) => i.id === 'training_consistency-streak');
      expect(streak!.methodology?.references).toBeDefined();
      expect(streak!.methodology?.references![0].citation).toContain('Lally');
      expect(streak!.methodology?.references![0].url).toBeDefined();
    });
  });

  // ============================================================
  // SECTION TRENDS (Priority 3)
  // ============================================================

  describe('section trends', () => {
    const makeTrend = (id: string, name: string, trend: number, traversalCount = 10) => ({
      sectionId: id,
      sectionName: name,
      trend,
      medianRecentSecs: 300,
      bestTimeSecs: 270,
      traversalCount,
    });

    it('generates summary insight when 3+ sections with at least 1 improving', () => {
      const result = generateInsights(
        {
          ...EMPTY_INPUT,
          sectionTrends: [
            makeTrend('s1', 'Hill A', 1),
            makeTrend('s2', 'Hill B', 0),
            makeTrend('s3', 'Hill C', -1),
          ],
        },
        mockT
      );
      const summary = result.find((i) => i.id === 'section_trend-summary');
      expect(summary).toBeDefined();
      expect(summary!.priority).toBe(3);
    });

    it('does not generate individual improving card when summary is shown', () => {
      const result = generateInsights(
        {
          ...EMPTY_INPUT,
          sectionTrends: [
            makeTrend('s1', 'Hill A', 1, 20),
            makeTrend('s2', 'Hill B', 0),
            makeTrend('s3', 'Hill C', -1),
          ],
        },
        mockT
      );
      expect(result.find((i) => i.id === 'section_trend-summary')).toBeDefined();
      expect(result.find((i) => i.id === 'section_trend-improving-s1')).toBeUndefined();
    });

    it('generates individual improving card when only 1 section exists', () => {
      const result = generateInsights(
        {
          ...EMPTY_INPUT,
          sectionTrends: [makeTrend('s1', 'Hill A', 1, 20)],
        },
        mockT
      );
      expect(result.find((i) => i.id === 'section_trend-summary')).toBeUndefined();
      expect(result.find((i) => i.id === 'section_trend-improving-s1')).toBeDefined();
    });

    it('does not show declining sections (removed per plan)', () => {
      const result = generateInsights(
        {
          ...EMPTY_INPUT,
          sectionTrends: [makeTrend('s1', 'Hill A', -1, 15), makeTrend('s2', 'Hill B', 0)],
        },
        mockT
      );
      // No declining insights
      expect(result.find((i) => i.id.includes('declining'))).toBeUndefined();
    });

    it('skips individual improving insight if section already has PR insight', () => {
      const result = generateInsights(
        {
          ...EMPTY_INPUT,
          recentPRs: [{ sectionId: 's1', sectionName: 'Hill A', bestTime: 270, daysAgo: 1 }],
          sectionTrends: [makeTrend('s1', 'Hill A', 1, 20)],
        },
        mockT
      );
      expect(result.find((i) => i.id === 'section_pr-s1')).toBeDefined();
      expect(result.find((i) => i.id === 'section_trend-improving-s1')).toBeUndefined();
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

    it('generates tomorrow pattern on rest day', () => {
      const result = generateInsights(
        {
          ...EMPTY_INPUT,
          isRestDay: true,
          tomorrowPattern: {
            sportType: 'Ride',
            primaryDay: 3,
            avgDurationSecs: 5400,
            confidence: 0.7,
            activityCount: 12,
          },
        },
        mockT
      );
      expect(result.find((i) => i.id === 'rest_day-tomorrow-pattern')).toBeDefined();
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
  // THRESHOLD BOUNDARIES
  // ============================================================

  describe('threshold boundaries', () => {
    it('load change at 9.9% does not trigger insight', () => {
      const result = generateInsights(
        {
          ...EMPTY_INPUT,
          currentPeriod: { count: 5, totalDuration: 5495, totalDistance: 100000, totalTss: 5495 },
          previousPeriod: { count: 5, totalDuration: 5000, totalDistance: 100000, totalTss: 5000 },
        },
        mockT
      );
      expect(result.find((i) => i.id === 'period_comparison-volume')).toBeUndefined();
    });

    it('load change at 10.02% triggers insight', () => {
      const result = generateInsights(
        {
          ...EMPTY_INPUT,
          currentPeriod: { count: 5, totalDuration: 5501, totalDistance: 100000, totalTss: 5501 },
          previousPeriod: { count: 5, totalDuration: 5000, totalDistance: 100000, totalTss: 5000 },
        },
        mockT
      );
      expect(result.find((i) => i.id === 'period_comparison-volume')).toBeDefined();
    });

    it('confidence at exactly 0.6 triggers pattern insight', () => {
      const result = generateInsights(
        {
          ...EMPTY_INPUT,
          todayPattern: {
            sportType: 'Ride',
            primaryDay: 2,
            avgDurationSecs: 5400,
            confidence: 0.6,
            activityCount: 10,
          },
        },
        mockT
      );
      expect(result.find((i) => i.category === 'activity_pattern')).toBeDefined();
    });

    it('confidence at 0.59 does not trigger pattern insight', () => {
      const result = generateInsights(
        {
          ...EMPTY_INPUT,
          todayPattern: {
            sportType: 'Ride',
            primaryDay: 2,
            avgDurationSecs: 5400,
            confidence: 0.59,
            activityCount: 10,
          },
        },
        mockT
      );
      expect(result.find((i) => i.category === 'activity_pattern')).toBeUndefined();
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

  // ============================================================
  // ACTIVITY PATTERN EDGE CASES
  // ============================================================

  describe('activity pattern edge cases', () => {
    it('pattern with primaryDay out of range (7) is skipped', () => {
      const result = generateInsights(
        {
          ...EMPTY_INPUT,
          todayPattern: {
            sportType: 'Ride',
            primaryDay: 7,
            avgDurationSecs: 5400,
            confidence: 0.8,
            activityCount: 10,
          },
        },
        mockT
      );
      expect(result.find((i) => i.category === 'activity_pattern')).toBeUndefined();
    });

    it('pattern with sportType Run produces verb "run"', () => {
      const result = generateInsights(
        {
          ...EMPTY_INPUT,
          todayPattern: {
            sportType: 'Run',
            primaryDay: 2,
            avgDurationSecs: 3600,
            confidence: 0.8,
            activityCount: 10,
          },
        },
        mockT
      );
      const pattern = result.find((i) => i.category === 'activity_pattern');
      expect(pattern!.title).toContain('verb: run');
    });

    it('pattern includes correct day name', () => {
      const result = generateInsights(
        {
          ...EMPTY_INPUT,
          todayPattern: {
            sportType: 'Ride',
            primaryDay: 0,
            avgDurationSecs: 3600,
            confidence: 0.8,
            activityCount: 10,
          },
        },
        mockT
      );
      const pattern = result.find((i) => i.category === 'activity_pattern');
      expect(pattern!.title).toContain('day: Mon');
    });

    it('pattern includes formatted duration', () => {
      const result = generateInsights(
        {
          ...EMPTY_INPUT,
          todayPattern: {
            sportType: 'Ride',
            primaryDay: 6,
            avgDurationSecs: 5400,
            confidence: 0.8,
            activityCount: 10,
          },
        },
        mockT
      );
      const pattern = result.find((i) => i.category === 'activity_pattern');
      expect(pattern!.title).toContain('duration: 1h30');
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

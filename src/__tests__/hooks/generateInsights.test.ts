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

    it('returns form advice when formTsb is provided with wellness data', () => {
      const result = generateInsights(
        { ...EMPTY_INPUT, formTsb: 0, formCtl: 50, formAtl: 50 },
        mockT
      );
      // Form trajectory (priority 3) + form advice (priority 5)
      expect(result).toHaveLength(2);
      expect(result.find((i) => i.id === 'training_consistency-form')).toBeDefined();
      expect(result.find((i) => i.id === 'form_trajectory')).toBeDefined();
    });

    it('formTsb = NaN does not generate form insight', () => {
      const result = generateInsights(
        { ...EMPTY_INPUT, formTsb: NaN, formCtl: 50, formAtl: 50 },
        mockT
      );
      expect(result.find((i) => i.id === 'training_consistency-form')).toBeUndefined();
    });

    it('formTsb = Infinity does not generate form insight', () => {
      const result = generateInsights(
        { ...EMPTY_INPUT, formTsb: Infinity, formCtl: 50, formAtl: 50 },
        mockT
      );
      expect(result.find((i) => i.id === 'training_consistency-form')).toBeUndefined();
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
      // previousPeriod.totalDuration <= 0, so the guard returns early — no volume insight
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
      const prInsights = result.filter((i) => i.category === 'section_pr');
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
      const prInsights = result.filter((i) => i.category === 'section_pr');
      expect(prInsights).toHaveLength(0);
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

    it('detects peak CTL (within 5%)', () => {
      const result = generateInsights(
        {
          ...EMPTY_INPUT,
          currentCtl: 96,
          peakCtl: 100,
        },
        mockT
      );
      const peak = result.find((i) => i.id === 'fitness_milestone-peak-ctl');
      expect(peak).toBeDefined();
    });

    it('does not generate peak CTL when too far below', () => {
      const result = generateInsights(
        {
          ...EMPTY_INPUT,
          currentCtl: 80,
          peakCtl: 100,
        },
        mockT
      );
      expect(result.find((i) => i.id === 'fitness_milestone-peak-ctl')).toBeUndefined();
    });
  });

  // ============================================================
  // PERIOD COMPARISON (Priority 3)
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
      expect(vol!.title).toContain('weeklyLoadUp'); // TSS-based key
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
      expect(vol!.title).toContain('weeklyLoadDown'); // TSS-based key
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
      expect(vol!.title).toContain('weeklyVolumeUp'); // Duration-based fallback
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
  });

  // ============================================================
  // CONSISTENCY (Priority 5)
  // ============================================================

  describe('consistency streak', () => {
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
      expect(streak!.priority).toBe(5);
    });

    it('no streak when a period has fewer than 3 activities', () => {
      const result = generateInsights(
        {
          ...EMPTY_INPUT,
          currentPeriod: { count: 2, totalDuration: 5000, totalDistance: 80000, totalTss: 150 },
          previousPeriod: { count: 5, totalDuration: 5000, totalDistance: 80000, totalTss: 150 },
        },
        mockT
      );
      expect(result.find((i) => i.id === 'training_consistency-streak')).toBeUndefined();
    });
  });

  // ============================================================
  // FORM ADVICE (Priority 5)
  // ============================================================

  describe('form advice', () => {
    it('generates form advice when formTsb is provided with wellness data', () => {
      const result = generateInsights(
        { ...EMPTY_INPUT, formTsb: -5, formCtl: 50, formAtl: 55 },
        mockT
      );
      const form = result.find((i) => i.id === 'training_consistency-form');
      expect(form).toBeDefined();
      expect(form!.navigationTarget).toBe('/fitness');
    });

    it('does not generate form advice when formTsb is null', () => {
      const result = generateInsights(EMPTY_INPUT, mockT);
      expect(result.find((i) => i.id === 'training_consistency-form')).toBeUndefined();
    });

    it.each([
      [20, 'fresh'],
      [10, 'grey'],
      [-5, 'optimal'],
      [-20, 'tired'],
      [-50, 'overreaching'],
    ])('formTsb=%i maps to %s zone', (tsb, zone) => {
      const result = generateInsights(
        { ...EMPTY_INPUT, formTsb: tsb, formCtl: 50, formAtl: 50 },
        mockT
      );
      const form = result.find((i) => i.id === 'training_consistency-form');
      expect(form!.title).toContain(zone);
    });

    it('form insight not generated when no wellness data (ctl and atl both null)', () => {
      const result = generateInsights(
        { ...EMPTY_INPUT, formTsb: 0, formCtl: null, formAtl: null },
        mockT
      );
      expect(result.find((i) => i.id === 'training_consistency-form')).toBeUndefined();
    });
  });

  // ============================================================
  // THRESHOLD BOUNDARIES
  // ============================================================

  describe('threshold boundaries', () => {
    // VOLUME_CHANGE_THRESHOLD = 0.1 (10%)
    // Check uses strict greater than: ratio > 0.1
    // NOTE: IEEE 754 floating point means 5500/5000 - 1 = 0.10000000000000009 (not exactly 0.1),
    //       so it triggers. Use 9.9% to test below threshold.
    it('load change at 9.9% does not trigger insight', () => {
      // If TSS is present, it's used. Set TSS to match duration ratio.
      // ratio = 5495/5000 - 1 = 0.099 — below 0.1 threshold
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
      // ratio = 5501/5000 - 1 = 0.1002 > 0.1
      const result = generateInsights(
        {
          ...EMPTY_INPUT,
          currentPeriod: { count: 5, totalDuration: 5501, totalDistance: 100000, totalTss: 5501 },
          previousPeriod: { count: 5, totalDuration: 5000, totalDistance: 100000, totalTss: 5000 },
        },
        mockT
      );
      const vol = result.find((i) => i.id === 'period_comparison-volume');
      expect(vol).toBeDefined();
      expect(vol!.icon).toBe('trending-up');
      expect(vol!.title).toContain('weeklyLoadUp');
    });

    it('load decrease at -9.9% does not trigger insight', () => {
      // ratio = 4505/5000 - 1 = -0.099 — above -0.1 threshold (closer to zero)
      const result = generateInsights(
        {
          ...EMPTY_INPUT,
          currentPeriod: { count: 5, totalDuration: 4505, totalDistance: 100000, totalTss: 4505 },
          previousPeriod: { count: 5, totalDuration: 5000, totalDistance: 100000, totalTss: 5000 },
        },
        mockT
      );
      expect(result.find((i) => i.id === 'period_comparison-volume')).toBeUndefined();
    });

    it('load decrease at -10.02% triggers insight', () => {
      // ratio = 4499/5000 - 1 = -0.1002 < -0.1
      const result = generateInsights(
        {
          ...EMPTY_INPUT,
          currentPeriod: { count: 5, totalDuration: 4499, totalDistance: 100000, totalTss: 4499 },
          previousPeriod: { count: 5, totalDuration: 5000, totalDistance: 100000, totalTss: 5000 },
        },
        mockT
      );
      const vol = result.find((i) => i.id === 'period_comparison-volume');
      expect(vol).toBeDefined();
      expect(vol!.icon).toBe('trending-down');
      expect(vol!.title).toContain('weeklyLoadDown');
    });

    // PATTERN_CONFIDENCE_THRESHOLD = 0.6
    // Check uses strict less than: confidence < 0.6
    it('confidence at exactly 0.6 triggers pattern insight', () => {
      // confidence = 0.6, check is < 0.6, so 0.6 is NOT less than 0.6 — triggers
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
      // confidence = 0.59 < 0.6, so returns early
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

    // PEAK_CTL_PROXIMITY = 0.05 (within 5%)
    // Check uses >=: currentCtl >= peakCtl * (1 - 0.05) = peakCtl * 0.95
    it('CTL at exactly 95% of peak triggers peak CTL insight', () => {
      // currentCtl = 95, peakCtl = 100
      // 95 >= 100 * 0.95 = 95 — triggers (>= boundary)
      const result = generateInsights(
        {
          ...EMPTY_INPUT,
          currentCtl: 95,
          peakCtl: 100,
        },
        mockT
      );
      expect(result.find((i) => i.id === 'fitness_milestone-peak-ctl')).toBeDefined();
    });

    it('CTL at 94% of peak does not trigger', () => {
      // currentCtl = 94, peakCtl = 100
      // 94 < 100 * 0.95 = 95 — does not trigger
      const result = generateInsights(
        {
          ...EMPTY_INPUT,
          currentCtl: 94,
          peakCtl: 100,
        },
        mockT
      );
      expect(result.find((i) => i.id === 'fitness_milestone-peak-ctl')).toBeUndefined();
    });

    // Form zone boundaries: fresh > 15, grey > 5, optimal > -10, tired > -30
    it('formTsb at exactly 15 maps to grey zone (boundary between fresh and grey)', () => {
      // resolveFormZone: tsb > 15 => fresh, else tsb > 5 => grey
      // 15 is NOT > 15, so falls to grey
      const result = generateInsights(
        { ...EMPTY_INPUT, formTsb: 15, formCtl: 50, formAtl: 50 },
        mockT
      );
      const form = result.find((i) => i.id === 'training_consistency-form');
      expect(form).toBeDefined();
      expect(form!.title).toContain('grey');
    });

    it('formTsb at 15.01 maps to fresh zone', () => {
      const result = generateInsights(
        { ...EMPTY_INPUT, formTsb: 15.01, formCtl: 50, formAtl: 50 },
        mockT
      );
      const form = result.find((i) => i.id === 'training_consistency-form');
      expect(form).toBeDefined();
      expect(form!.title).toContain('fresh');
    });

    it('formTsb at exactly 5 maps to optimal zone (boundary between grey and optimal)', () => {
      // 5 is NOT > 5, so falls to optimal
      const result = generateInsights(
        { ...EMPTY_INPUT, formTsb: 5, formCtl: 50, formAtl: 50 },
        mockT
      );
      const form = result.find((i) => i.id === 'training_consistency-form');
      expect(form).toBeDefined();
      expect(form!.title).toContain('optimal');
    });

    it('formTsb at exactly -10 maps to tired zone (boundary between optimal and tired)', () => {
      // -10 is NOT > -10, so falls to tired
      const result = generateInsights(
        { ...EMPTY_INPUT, formTsb: -10, formCtl: 50, formAtl: 50 },
        mockT
      );
      const form = result.find((i) => i.id === 'training_consistency-form');
      expect(form).toBeDefined();
      expect(form!.title).toContain('tired');
    });

    it('formTsb at exactly -30 maps to overreaching zone (boundary between tired and overreaching)', () => {
      // -30 is NOT > -30, so falls to overreaching
      const result = generateInsights(
        { ...EMPTY_INPUT, formTsb: -30, formCtl: 50, formAtl: 50 },
        mockT
      );
      const form = result.find((i) => i.id === 'training_consistency-form');
      expect(form).toBeDefined();
      expect(form!.title).toContain('overreaching');
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

    it('pattern with primaryDay negative (-1) is skipped', () => {
      const result = generateInsights(
        {
          ...EMPTY_INPUT,
          todayPattern: {
            sportType: 'Ride',
            primaryDay: -1,
            avgDurationSecs: 5400,
            confidence: 0.8,
            activityCount: 10,
          },
        },
        mockT
      );
      expect(result.find((i) => i.category === 'activity_pattern')).toBeUndefined();
    });

    it('pattern with negative avgDurationSecs is skipped', () => {
      const result = generateInsights(
        {
          ...EMPTY_INPUT,
          todayPattern: {
            sportType: 'Ride',
            primaryDay: 2,
            avgDurationSecs: -100,
            confidence: 0.8,
            activityCount: 10,
          },
        },
        mockT
      );
      expect(result.find((i) => i.category === 'activity_pattern')).toBeUndefined();
    });

    it('pattern with zero avgDurationSecs is skipped', () => {
      const result = generateInsights(
        {
          ...EMPTY_INPUT,
          todayPattern: {
            sportType: 'Ride',
            primaryDay: 2,
            avgDurationSecs: 0,
            confidence: 0.8,
            activityCount: 10,
          },
        },
        mockT
      );
      expect(result.find((i) => i.category === 'activity_pattern')).toBeUndefined();
    });

    it('pattern with NaN avgDurationSecs is skipped', () => {
      const result = generateInsights(
        {
          ...EMPTY_INPUT,
          todayPattern: {
            sportType: 'Ride',
            primaryDay: 2,
            avgDurationSecs: NaN,
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
      expect(pattern).toBeDefined();
      expect(pattern!.title).toContain('verb: run');
    });

    it('pattern with sportType Ride produces verb "ride"', () => {
      const result = generateInsights(
        {
          ...EMPTY_INPUT,
          todayPattern: {
            sportType: 'Ride',
            primaryDay: 4,
            avgDurationSecs: 5400,
            confidence: 0.8,
            activityCount: 10,
          },
        },
        mockT
      );
      const pattern = result.find((i) => i.category === 'activity_pattern');
      expect(pattern).toBeDefined();
      expect(pattern!.title).toContain('verb: ride');
    });

    it('pattern with unknown sportType defaults to verb "ride"', () => {
      const result = generateInsights(
        {
          ...EMPTY_INPUT,
          todayPattern: {
            sportType: 'Swim',
            primaryDay: 1,
            avgDurationSecs: 3600,
            confidence: 0.8,
            activityCount: 10,
          },
        },
        mockT
      );
      const pattern = result.find((i) => i.category === 'activity_pattern');
      expect(pattern).toBeDefined();
      expect(pattern!.title).toContain('verb: ride');
    });

    it('pattern includes correct day name', () => {
      // primaryDay 0 = Mon, 6 = Sun
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
      expect(pattern).toBeDefined();
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
      expect(pattern).toBeDefined();
      expect(pattern!.title).toContain('duration: 1h30');
    });
  });

  // ============================================================
  // SECTION TRENDS (Priority 2)
  // ============================================================

  describe('section trends', () => {
    const makeTrend = (
      id: string,
      name: string,
      trend: number,
      traversalCount = 10
    ): {
      sectionId: string;
      sectionName: string;
      trend: number;
      medianRecentSecs: number;
      bestTimeSecs: number;
      traversalCount: number;
    } => ({
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
      expect(summary!.priority).toBe(2);
      expect(summary!.title).toContain('improving: 1');
      expect(summary!.title).toContain('total: 3');
      expect(summary!.navigationTarget).toBe('/routes');
    });

    it('does not generate summary with fewer than 3 sections', () => {
      const result = generateInsights(
        {
          ...EMPTY_INPUT,
          sectionTrends: [makeTrend('s1', 'Hill A', 1), makeTrend('s2', 'Hill B', 0)],
        },
        mockT
      );
      expect(result.find((i) => i.id === 'section_trend-summary')).toBeUndefined();
    });

    it('does not generate summary when no sections are improving', () => {
      const result = generateInsights(
        {
          ...EMPTY_INPUT,
          sectionTrends: [
            makeTrend('s1', 'Hill A', 0),
            makeTrend('s2', 'Hill B', 0),
            makeTrend('s3', 'Hill C', -1),
          ],
        },
        mockT
      );
      expect(result.find((i) => i.id === 'section_trend-summary')).toBeUndefined();
    });

    it('generates individual improving insight for top section by traversal count', () => {
      const result = generateInsights(
        {
          ...EMPTY_INPUT,
          sectionTrends: [
            makeTrend('s1', 'Hill A', 1, 5),
            makeTrend('s2', 'Hill B', 1, 20), // most traversals
          ],
        },
        mockT
      );
      const improving = result.find((i) => i.id === 'section_trend-improving-s2');
      expect(improving).toBeDefined();
      expect(improving!.icon).toBe('trending-up');
      expect(improving!.navigationTarget).toBe('/section/s2');
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
      // Should have PR insight but not a duplicate improving insight
      expect(result.find((i) => i.id === 'section_pr-s1')).toBeDefined();
      expect(result.find((i) => i.id === 'section_trend-improving-s1')).toBeUndefined();
    });

    it('shows declining insight only when no sections are improving', () => {
      const result = generateInsights(
        {
          ...EMPTY_INPUT,
          sectionTrends: [makeTrend('s1', 'Hill A', -1, 15), makeTrend('s2', 'Hill B', 0)],
        },
        mockT
      );
      const declining = result.find((i) => i.id === 'section_trend-declining-s1');
      expect(declining).toBeDefined();
      expect(declining!.icon).toBe('trending-down');
      expect(declining!.priority).toBe(4); // lower priority than improving
    });

    it('does not show declining insight when improving sections exist', () => {
      const result = generateInsights(
        {
          ...EMPTY_INPUT,
          sectionTrends: [makeTrend('s1', 'Hill A', 1), makeTrend('s2', 'Hill B', -1)],
        },
        mockT
      );
      expect(result.find((i) => i.id === 'section_trend-declining-s2')).toBeUndefined();
    });

    it('empty sectionTrends array produces no section trend insights', () => {
      const result = generateInsights(EMPTY_INPUT, mockT);
      const trendInsights = result.filter((i) => i.id.startsWith('section_trend'));
      expect(trendInsights).toHaveLength(0);
    });

    it('summary body includes section names', () => {
      const result = generateInsights(
        {
          ...EMPTY_INPUT,
          sectionTrends: [
            makeTrend('s1', 'Col du Galibier', 1),
            makeTrend('s2', "Alpe d'Huez", 1),
            makeTrend('s3', 'Mont Ventoux', 0),
          ],
        },
        mockT
      );
      const summary = result.find((i) => i.id === 'section_trend-summary');
      expect(summary?.body).toContain('Col du Galibier');
      expect(summary?.body).toContain("Alpe d'Huez");
    });

    it('improving insight body includes duration values', () => {
      const result = generateInsights(
        {
          ...EMPTY_INPUT,
          sectionTrends: [makeTrend('s1', 'Hill A', 1)],
        },
        mockT
      );
      const improving = result.find((i) => i.id === 'section_trend-improving-s1');
      expect(improving?.body).toContain('median: 5m');
      expect(improving?.body).toContain('best: 4m');
    });
  });

  // ============================================================
  // PRIORITY ORDERING
  // ============================================================

  describe('priority ordering', () => {
    it('sorts PRs before milestones before comparisons before patterns before consistency', () => {
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

      // Should have: PR(1), FTP(2), Volume(3), Pattern(4), Streak(5), Form(5)
      expect(result.length).toBeGreaterThanOrEqual(5);
      for (let i = 1; i < result.length; i++) {
        expect(result[i].priority).toBeGreaterThanOrEqual(result[i - 1].priority);
      }
    });

    it('contains all priority levels 1-5 when all data present', () => {
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

      const priorities = new Set(result.map((i) => i.priority));
      expect(priorities.has(1)).toBe(true); // section_pr
      expect(priorities.has(2)).toBe(true); // fitness_milestone
      expect(priorities.has(3)).toBe(true); // period_comparison
      expect(priorities.has(4)).toBe(true); // activity_pattern
      expect(priorities.has(5)).toBe(true); // training_consistency
    });
  });

  // ============================================================
  // isNew FIELD
  // ============================================================

  describe('isNew field', () => {
    it('all generated insights have isNew = true', () => {
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
      result.forEach((insight) => expect(insight.isNew).toBe(true));
    });

    it('insights from every category have isNew = true', () => {
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
      result.forEach((insight) => expect(insight.isNew).toBe(true));
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
      expect(vol!.body).toContain('insights.loadBody'); // TSS-based body
    });

    it('load body contains TSS and duration values', () => {
      const result = generateInsights(
        {
          ...EMPTY_INPUT,
          currentPeriod: { count: 5, totalDuration: 7200, totalDistance: 100000, totalTss: 200 },
          previousPeriod: { count: 4, totalDuration: 5000, totalDistance: 80000, totalTss: 150 },
        },
        mockT
      );
      const vol = result.find((i) => i.id === 'period_comparison-volume');
      // mockT formats as "key {k: v, ...}" so body should contain TSS and duration values
      expect(vol!.body).toContain('currentTss: 200');
      expect(vol!.body).toContain('previousTss: 150');
      expect(vol!.body).toContain('currentDuration: 2h');
      expect(vol!.body).toContain('previousDuration: 1h23');
    });

    it('load decrease also has body', () => {
      const result = generateInsights(
        {
          ...EMPTY_INPUT,
          currentPeriod: { count: 2, totalDuration: 3000, totalDistance: 40000, totalTss: 80 },
          previousPeriod: { count: 5, totalDuration: 7200, totalDistance: 100000, totalTss: 200 },
        },
        mockT
      );
      const vol = result.find((i) => i.id === 'period_comparison-volume');
      expect(vol?.body).toBeDefined();
      expect(vol!.body).toContain('insights.loadBody'); // TSS-based body
    });

    it('form advice has body with TSB/CTL/ATL values', () => {
      const result = generateInsights(
        { ...EMPTY_INPUT, formTsb: -5, formCtl: 50, formAtl: 55 },
        mockT
      );
      const form = result.find((i) => i.id === 'training_consistency-form');
      expect(form?.body).toBeDefined();
      expect(form!.body).toContain('formBody');
    });

    it('form body contains rounded TSB, CTL, ATL values', () => {
      const result = generateInsights(
        { ...EMPTY_INPUT, formTsb: -5.7, formCtl: 50.3, formAtl: 55.9 },
        mockT
      );
      const form = result.find((i) => i.id === 'training_consistency-form');
      expect(form?.body).toBeDefined();
      // mockT renders params, so body should contain rounded values
      expect(form!.body).toContain('tsb: -6');
      expect(form!.body).toContain('ctl: 50');
      expect(form!.body).toContain('atl: 56');
    });
  });

  // ============================================================
  // FORM ADVICE ALTERNATIVES (Phase 4a)
  // ============================================================

  describe('form advice alternatives', () => {
    it('provides alternatives array with 5 form zones', () => {
      const result = generateInsights(
        { ...EMPTY_INPUT, formTsb: -5, formCtl: 50, formAtl: 55 },
        mockT
      );
      const form = result.find((i) => i.id === 'training_consistency-form');
      expect(form!.alternatives).toBeDefined();
      expect(form!.alternatives).toHaveLength(5);
    });

    it('marks the correct zone as selected', () => {
      const result = generateInsights(
        { ...EMPTY_INPUT, formTsb: -5, formCtl: 50, formAtl: 55 },
        mockT
      );
      const form = result.find((i) => i.id === 'training_consistency-form');
      const selected = form!.alternatives!.filter((a) => a.isSelected);
      expect(selected).toHaveLength(1);
      expect(selected[0].key).toBe('optimal');
    });

    it('includes supportingData with CTL, ATL, TSB', () => {
      const result = generateInsights(
        { ...EMPTY_INPUT, formTsb: -5, formCtl: 50, formAtl: 55 },
        mockT
      );
      const form = result.find((i) => i.id === 'training_consistency-form');
      expect(form!.supportingData?.dataPoints).toBeDefined();
      const labels = form!.supportingData!.dataPoints!.map((dp) => dp.label);
      expect(labels).toContain('CTL');
      expect(labels).toContain('ATL');
      expect(labels).toContain('TSB');
    });

    it('includes methodology with Banister reference', () => {
      const result = generateInsights(
        { ...EMPTY_INPUT, formTsb: -5, formCtl: 50, formAtl: 55 },
        mockT
      );
      const form = result.find((i) => i.id === 'training_consistency-form');
      expect(form!.methodology).toBeDefined();
      expect(form!.methodology!.formula).toBe('TSB = CTL - ATL');
      expect(form!.methodology!.reference).toContain('Banister');
    });
  });

  // ============================================================
  // RECOVERY READINESS (Priority 2, Phase 2)
  // ============================================================

  describe('recovery readiness', () => {
    const makeWellnessWindow = (hrvValues: number[], tsb = 0): InsightInputData => ({
      ...EMPTY_INPUT,
      formTsb: tsb,
      formCtl: 50,
      formAtl: 50 - tsb,
      wellnessWindow: hrvValues.map((hrv, i) => ({
        date: `2026-02-${15 + i}`,
        hrv,
        ctl: 50,
        atl: 50 - tsb,
      })),
    });

    it('generates recovery insight with 3+ HRV values', () => {
      const result = generateInsights(makeWellnessWindow([50, 52, 55, 58, 60]), mockT);
      const recovery = result.find((i) => i.id === 'recovery_readiness');
      expect(recovery).toBeDefined();
      expect(recovery!.category).toBe('recovery_readiness');
      expect(recovery!.priority).toBe(2);
    });

    it('does not generate recovery insight with fewer than 3 HRV values', () => {
      const result = generateInsights(makeWellnessWindow([50, 52]), mockT);
      expect(result.find((i) => i.id === 'recovery_readiness')).toBeUndefined();
    });

    it('selects wellRecovered when HRV above baseline and TSB positive', () => {
      // HRV values where last value is >5% above average, TSB > 5
      const result = generateInsights(makeWellnessWindow([50, 50, 50, 50, 60], 10), mockT);
      const recovery = result.find((i) => i.id === 'recovery_readiness');
      expect(recovery).toBeDefined();
      const selected = recovery!.alternatives!.find((a) => a.isSelected);
      expect(selected!.key).toBe('wellRecovered');
    });

    it('selects recoveryNeeded when HRV below baseline and TSB very negative', () => {
      // HRV declining, TSB between -20 and -30
      const result = generateInsights(makeWellnessWindow([60, 58, 55, 52, 48], -25), mockT);
      const recovery = result.find((i) => i.id === 'recovery_readiness');
      expect(recovery).toBeDefined();
      const selected = recovery!.alternatives!.find((a) => a.isSelected);
      expect(selected!.key).toBe('recoveryNeeded');
    });

    it('includes HRV sparkline in supporting data', () => {
      const result = generateInsights(makeWellnessWindow([50, 52, 55, 58, 60]), mockT);
      const recovery = result.find((i) => i.id === 'recovery_readiness');
      expect(recovery!.supportingData?.sparklineData).toEqual([50, 52, 55, 58, 60]);
    });

    it('includes methodology with Plews reference', () => {
      const result = generateInsights(makeWellnessWindow([50, 52, 55, 58, 60]), mockT);
      const recovery = result.find((i) => i.id === 'recovery_readiness');
      expect(recovery!.methodology?.reference).toContain('Plews');
    });

    it('has 5 alternatives', () => {
      const result = generateInsights(makeWellnessWindow([50, 52, 55, 58, 60]), mockT);
      const recovery = result.find((i) => i.id === 'recovery_readiness');
      expect(recovery!.alternatives).toHaveLength(5);
    });

    it('skips when all HRV values are zero', () => {
      const result = generateInsights(makeWellnessWindow([0, 0, 0, 0, 0]), mockT);
      expect(result.find((i) => i.id === 'recovery_readiness')).toBeUndefined();
    });
  });

  // ============================================================
  // ACWR (Priority 2, Phase 2)
  // ============================================================

  describe('ACWR', () => {
    const makeAcwrInput = (acuteTss: number, chronicTss: number): InsightInputData => ({
      ...EMPTY_INPUT,
      currentPeriod: { count: 5, totalDuration: 7200, totalDistance: 100000, totalTss: acuteTss },
      chronicPeriod: { count: 5, totalDuration: 5000, totalDistance: 80000, totalTss: chronicTss },
    });

    it('generates ACWR insight when both periods available', () => {
      const result = generateInsights(makeAcwrInput(200, 200), mockT);
      const acwr = result.find((i) => i.id === 'workload_risk-acwr');
      expect(acwr).toBeDefined();
      expect(acwr!.category).toBe('workload_risk');
      expect(acwr!.priority).toBe(2);
    });

    it('does not generate ACWR when chronic period is null', () => {
      const result = generateInsights(
        {
          ...EMPTY_INPUT,
          currentPeriod: { count: 5, totalDuration: 7200, totalDistance: 100000, totalTss: 200 },
          chronicPeriod: null,
        },
        mockT
      );
      expect(result.find((i) => i.id === 'workload_risk-acwr')).toBeUndefined();
    });

    it('does not generate ACWR when chronic TSS is zero', () => {
      const result = generateInsights(makeAcwrInput(200, 0), mockT);
      expect(result.find((i) => i.id === 'workload_risk-acwr')).toBeUndefined();
    });

    it('selects undertrained zone when ACWR < 0.8', () => {
      // acute = 100, chronic = 200 => ACWR = 0.5
      const result = generateInsights(makeAcwrInput(100, 200), mockT);
      const acwr = result.find((i) => i.id === 'workload_risk-acwr');
      const selected = acwr!.alternatives!.find((a) => a.isSelected);
      expect(selected!.key).toBe('undertrained');
    });

    it('selects sweetSpot zone when ACWR 0.8-1.3', () => {
      // acute = 200, chronic = 200 => ACWR = 1.0
      const result = generateInsights(makeAcwrInput(200, 200), mockT);
      const acwr = result.find((i) => i.id === 'workload_risk-acwr');
      const selected = acwr!.alternatives!.find((a) => a.isSelected);
      expect(selected!.key).toBe('sweetSpot');
    });

    it('selects highLoad zone when ACWR 1.3-1.5', () => {
      // acute = 280, chronic = 200 => ACWR = 1.4
      const result = generateInsights(makeAcwrInput(280, 200), mockT);
      const acwr = result.find((i) => i.id === 'workload_risk-acwr');
      const selected = acwr!.alternatives!.find((a) => a.isSelected);
      expect(selected!.key).toBe('highLoad');
    });

    it('selects spikeRisk zone when ACWR > 1.5', () => {
      // acute = 350, chronic = 200 => ACWR = 1.75
      const result = generateInsights(makeAcwrInput(350, 200), mockT);
      const acwr = result.find((i) => i.id === 'workload_risk-acwr');
      const selected = acwr!.alternatives!.find((a) => a.isSelected);
      expect(selected!.key).toBe('spikeRisk');
    });

    it('has 4 alternatives', () => {
      const result = generateInsights(makeAcwrInput(200, 200), mockT);
      const acwr = result.find((i) => i.id === 'workload_risk-acwr');
      expect(acwr!.alternatives).toHaveLength(4);
    });

    it('includes methodology with Gabbett reference', () => {
      const result = generateInsights(makeAcwrInput(200, 200), mockT);
      const acwr = result.find((i) => i.id === 'workload_risk-acwr');
      expect(acwr!.methodology?.reference).toContain('Gabbett');
    });
  });

  // ============================================================
  // TRAINING MONOTONY (Priority 3, Phase 2)
  // ============================================================

  describe('training monotony', () => {
    const makeMonotonyInput = (atlValues: number[]): InsightInputData => ({
      ...EMPTY_INPUT,
      wellnessWindow: atlValues.map((atl, i) => ({
        date: `2026-02-${15 + i}`,
        atl,
        ctl: 50,
      })),
    });

    it('generates monotony insight with 3+ daily load values', () => {
      const result = generateInsights(makeMonotonyInput([50, 55, 60, 45, 52]), mockT);
      const monotony = result.find((i) => i.id === 'workload_risk-monotony');
      expect(monotony).toBeDefined();
      expect(monotony!.category).toBe('workload_risk');
      expect(monotony!.priority).toBe(3);
    });

    it('does not generate with fewer than 3 load values', () => {
      const result = generateInsights(makeMonotonyInput([50, 55]), mockT);
      expect(result.find((i) => i.id === 'workload_risk-monotony')).toBeUndefined();
    });

    it('detects high monotony when all loads are similar', () => {
      // Identical loads -> stddev ~0 -> monotony very high
      // Use slightly different values to avoid division by zero
      const result = generateInsights(makeMonotonyInput([50, 50, 50, 51, 50]), mockT);
      const monotony = result.find((i) => i.id === 'workload_risk-monotony');
      expect(monotony).toBeDefined();
      expect(monotony!.title).toContain('highMonotony');
    });

    it('detects good variety when loads vary significantly', () => {
      // High variation relative to mean -> low monotony (mean/stddev < 1.5)
      const result = generateInsights(makeMonotonyInput([10, 100, 10, 100, 10]), mockT);
      const monotony = result.find((i) => i.id === 'workload_risk-monotony');
      expect(monotony).toBeDefined();
      expect(monotony!.title).toContain('goodVariety');
    });

    it('includes methodology with Foster reference', () => {
      const result = generateInsights(makeMonotonyInput([50, 55, 60, 45, 52]), mockT);
      const monotony = result.find((i) => i.id === 'workload_risk-monotony');
      expect(monotony!.methodology?.reference).toContain('Foster');
    });

    it('skips when all load values are zero', () => {
      const result = generateInsights(makeMonotonyInput([0, 0, 0, 0, 0]), mockT);
      expect(result.find((i) => i.id === 'workload_risk-monotony')).toBeUndefined();
    });
  });

  // ============================================================
  // FORM TRAJECTORY (Priority 3, Phase 2)
  // ============================================================

  describe('form trajectory', () => {
    it('generates form trajectory when CTL and ATL available', () => {
      const result = generateInsights(
        { ...EMPTY_INPUT, formTsb: -5, formCtl: 50, formAtl: 55 },
        mockT
      );
      const trajectory = result.find((i) => i.id === 'form_trajectory');
      expect(trajectory).toBeDefined();
      expect(trajectory!.category).toBe('form_trajectory');
      expect(trajectory!.priority).toBe(3);
    });

    it('does not generate when CTL and ATL are both zero', () => {
      const result = generateInsights(
        { ...EMPTY_INPUT, formTsb: 0, formCtl: 0, formAtl: 0 },
        mockT
      );
      expect(result.find((i) => i.id === 'form_trajectory')).toBeUndefined();
    });

    it('detects improving form when ATL >> CTL (ATL decays faster)', () => {
      // ATL much higher than CTL means ATL will decay faster, TSB will rise
      const result = generateInsights(
        { ...EMPTY_INPUT, formTsb: -20, formCtl: 50, formAtl: 70 },
        mockT
      );
      const trajectory = result.find((i) => i.id === 'form_trajectory');
      expect(trajectory).toBeDefined();
      expect(trajectory!.title).toContain('improving');
    });

    it('includes sparkline from wellness window TSB values', () => {
      const result = generateInsights(
        {
          ...EMPTY_INPUT,
          formTsb: -5,
          formCtl: 50,
          formAtl: 55,
          wellnessWindow: [
            { date: '2026-02-15', ctl: 48, atl: 58 },
            { date: '2026-02-16', ctl: 49, atl: 57 },
            { date: '2026-02-17', ctl: 50, atl: 55 },
          ],
        },
        mockT
      );
      const trajectory = result.find((i) => i.id === 'form_trajectory');
      expect(trajectory!.supportingData?.sparklineData).toEqual([-10, -8, -5]);
    });

    it('includes methodology with Banister reference', () => {
      const result = generateInsights(
        { ...EMPTY_INPUT, formTsb: -5, formCtl: 50, formAtl: 55 },
        mockT
      );
      const trajectory = result.find((i) => i.id === 'form_trajectory');
      expect(trajectory!.methodology?.reference).toContain('Banister');
    });

    it('does not generate when formCtl is null', () => {
      const result = generateInsights(
        { ...EMPTY_INPUT, formTsb: -5, formCtl: null, formAtl: 55 },
        mockT
      );
      expect(result.find((i) => i.id === 'form_trajectory')).toBeUndefined();
    });
  });

  // ============================================================
  // RAMP RATE (Priority 3, Phase 2)
  // ============================================================

  describe('ramp rate', () => {
    it('generates ramp rate insight when rampRate available', () => {
      const result = generateInsights({ ...EMPTY_INPUT, rampRate: 3.5, formCtl: 60 }, mockT);
      const ramp = result.find((i) => i.id === 'form_trajectory-ramp');
      expect(ramp).toBeDefined();
      expect(ramp!.category).toBe('form_trajectory');
      expect(ramp!.priority).toBe(3);
    });

    it('does not generate when rampRate is null', () => {
      const result = generateInsights(EMPTY_INPUT, mockT);
      expect(result.find((i) => i.id === 'form_trajectory-ramp')).toBeUndefined();
    });

    it('does not generate when rampRate is NaN', () => {
      const result = generateInsights({ ...EMPTY_INPUT, rampRate: NaN }, mockT);
      expect(result.find((i) => i.id === 'form_trajectory-ramp')).toBeUndefined();
    });

    it('selects detraining when ramp < 1', () => {
      const result = generateInsights({ ...EMPTY_INPUT, rampRate: 0.5 }, mockT);
      const ramp = result.find((i) => i.id === 'form_trajectory-ramp');
      const selected = ramp!.alternatives!.find((a) => a.isSelected);
      expect(selected!.key).toBe('detraining');
    });

    it('selects maintenance when ramp 1-3', () => {
      const result = generateInsights({ ...EMPTY_INPUT, rampRate: 2.0 }, mockT);
      const ramp = result.find((i) => i.id === 'form_trajectory-ramp');
      const selected = ramp!.alternatives!.find((a) => a.isSelected);
      expect(selected!.key).toBe('maintenance');
    });

    it('selects building when ramp 3-5', () => {
      const result = generateInsights({ ...EMPTY_INPUT, rampRate: 4.0 }, mockT);
      const ramp = result.find((i) => i.id === 'form_trajectory-ramp');
      const selected = ramp!.alternatives!.find((a) => a.isSelected);
      expect(selected!.key).toBe('building');
    });

    it('selects aggressive when ramp > 5', () => {
      const result = generateInsights({ ...EMPTY_INPUT, rampRate: 6.0 }, mockT);
      const ramp = result.find((i) => i.id === 'form_trajectory-ramp');
      const selected = ramp!.alternatives!.find((a) => a.isSelected);
      expect(selected!.key).toBe('aggressive');
    });

    it('has 4 alternatives', () => {
      const result = generateInsights({ ...EMPTY_INPUT, rampRate: 3.5 }, mockT);
      const ramp = result.find((i) => i.id === 'form_trajectory-ramp');
      expect(ramp!.alternatives).toHaveLength(4);
    });

    it('includes methodology with Coggan reference', () => {
      const result = generateInsights({ ...EMPTY_INPUT, rampRate: 3.5 }, mockT);
      const ramp = result.find((i) => i.id === 'form_trajectory-ramp');
      expect(ramp!.methodology?.reference).toContain('Coggan');
    });
  });

  // ============================================================
  // SECTION PERFORMANCE VS FITNESS (Priority 2, Phase 2)
  // ============================================================

  describe('section performance vs fitness', () => {
    it('generates insight when CTL positive and improving sections exist', () => {
      const result = generateInsights(
        {
          ...EMPTY_INPUT,
          formCtl: 65,
          sectionTrends: [
            {
              sectionId: 's1',
              sectionName: 'Hill A',
              trend: 1,
              medianRecentSecs: 300,
              bestTimeSecs: 270,
              traversalCount: 10,
            },
          ],
        },
        mockT
      );
      const perf = result.find((i) => i.id.startsWith('section_performance-fitness'));
      expect(perf).toBeDefined();
      expect(perf!.category).toBe('section_performance');
      expect(perf!.priority).toBe(2);
    });

    it('does not generate when CTL is zero', () => {
      const result = generateInsights(
        {
          ...EMPTY_INPUT,
          formCtl: 0,
          sectionTrends: [
            {
              sectionId: 's1',
              sectionName: 'Hill A',
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

    it('does not generate when no improving sections', () => {
      const result = generateInsights(
        {
          ...EMPTY_INPUT,
          formCtl: 65,
          sectionTrends: [
            {
              sectionId: 's1',
              sectionName: 'Hill A',
              trend: -1,
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

    it('picks highest traversal count section', () => {
      const result = generateInsights(
        {
          ...EMPTY_INPUT,
          formCtl: 65,
          sectionTrends: [
            {
              sectionId: 's1',
              sectionName: 'Hill A',
              trend: 1,
              medianRecentSecs: 300,
              bestTimeSecs: 270,
              traversalCount: 5,
            },
            {
              sectionId: 's2',
              sectionName: 'Hill B',
              trend: 1,
              medianRecentSecs: 300,
              bestTimeSecs: 270,
              traversalCount: 20,
            },
          ],
        },
        mockT
      );
      const perf = result.find((i) => i.id.startsWith('section_performance-fitness'));
      expect(perf!.id).toContain('s2');
      expect(perf!.navigationTarget).toBe('/section/s2');
    });
  });

  // ============================================================
  // REST DAY CONTENT (Phase 5)
  // ============================================================

  describe('rest day content', () => {
    it('generates recovery progress when HRV trending up on rest day', () => {
      const result = generateInsights(
        {
          ...EMPTY_INPUT,
          isRestDay: true,
          wellnessWindow: [
            { date: '2026-02-15', hrv: 40 },
            { date: '2026-02-16', hrv: 42 },
            { date: '2026-02-17', hrv: 48 },
            { date: '2026-02-18', hrv: 52 },
          ],
        },
        mockT
      );
      const recovery = result.find((i) => i.id === 'rest_day-recovery-progress');
      expect(recovery).toBeDefined();
      expect(recovery!.category).toBe('recovery_readiness');
    });

    it('does not generate recovery progress when HRV declining', () => {
      const result = generateInsights(
        {
          ...EMPTY_INPUT,
          isRestDay: true,
          wellnessWindow: [
            { date: '2026-02-15', hrv: 60 },
            { date: '2026-02-16', hrv: 55 },
            { date: '2026-02-17', hrv: 50 },
            { date: '2026-02-18', hrv: 45 },
          ],
        },
        mockT
      );
      expect(result.find((i) => i.id === 'rest_day-recovery-progress')).toBeUndefined();
    });

    it('generates section deep dive on rest day when sections available', () => {
      const result = generateInsights(
        {
          ...EMPTY_INPUT,
          isRestDay: true,
          sectionTrends: [
            {
              sectionId: 's1',
              sectionName: 'Hill A',
              trend: 1,
              medianRecentSecs: 300,
              bestTimeSecs: 270,
              traversalCount: 10,
            },
          ],
        },
        mockT
      );
      const deepDive = result.find((i) => i.id === 'rest_day-section-deep-dive');
      expect(deepDive).toBeDefined();
      expect(deepDive!.category).toBe('section_performance');
    });

    it('generates tomorrow pattern on rest day', () => {
      const result = generateInsights(
        {
          ...EMPTY_INPUT,
          isRestDay: true,
          tomorrowPattern: {
            sportType: 'Ride',
            primaryDay: 6,
            avgDurationSecs: 5400,
            confidence: 0.7,
            activityCount: 12,
          },
        },
        mockT
      );
      const tomorrow = result.find((i) => i.id === 'rest_day-tomorrow-pattern');
      expect(tomorrow).toBeDefined();
      expect(tomorrow!.category).toBe('activity_pattern');
    });

    it('skips tomorrow pattern when confidence too low', () => {
      const result = generateInsights(
        {
          ...EMPTY_INPUT,
          isRestDay: true,
          tomorrowPattern: {
            sportType: 'Ride',
            primaryDay: 6,
            avgDurationSecs: 5400,
            confidence: 0.4,
            activityCount: 12,
          },
        },
        mockT
      );
      expect(result.find((i) => i.id === 'rest_day-tomorrow-pattern')).toBeUndefined();
    });

    it('does not generate rest day content when isRestDay is false', () => {
      const result = generateInsights(
        {
          ...EMPTY_INPUT,
          isRestDay: false,
          wellnessWindow: [
            { date: '2026-02-15', hrv: 40 },
            { date: '2026-02-16', hrv: 42 },
            { date: '2026-02-17', hrv: 48 },
            { date: '2026-02-18', hrv: 52 },
          ],
        },
        mockT
      );
      expect(result.find((i) => i.id.startsWith('rest_day'))).toBeUndefined();
    });
  });

  // ============================================================
  // SUPPORTING DATA AND METHODOLOGY (Phase 4)
  // ============================================================

  describe('supporting data on existing insights', () => {
    it('section PR insight includes supporting data', () => {
      const result = generateInsights(
        {
          ...EMPTY_INPUT,
          recentPRs: [{ sectionId: 's1', sectionName: 'Hill', bestTime: 300, daysAgo: 1 }],
        },
        mockT
      );
      const pr = result.find((i) => i.id === 'section_pr-s1');
      expect(pr!.supportingData).toBeDefined();
      expect(pr!.supportingData!.dataPoints!.length).toBeGreaterThan(0);
      expect(pr!.supportingData!.sections!.length).toBe(1);
    });

    it('section PR insight includes methodology', () => {
      const result = generateInsights(
        {
          ...EMPTY_INPUT,
          recentPRs: [{ sectionId: 's1', sectionName: 'Hill', bestTime: 300, daysAgo: 1 }],
        },
        mockT
      );
      const pr = result.find((i) => i.id === 'section_pr-s1');
      expect(pr!.methodology).toBeDefined();
      expect(pr!.methodology!.name).toContain('record');
    });

    it('period comparison includes comparison data', () => {
      const result = generateInsights(
        {
          ...EMPTY_INPUT,
          currentPeriod: { count: 5, totalDuration: 7200, totalDistance: 100000, totalTss: 200 },
          previousPeriod: { count: 4, totalDuration: 5000, totalDistance: 80000, totalTss: 150 },
        },
        mockT
      );
      const vol = result.find((i) => i.id === 'period_comparison-volume');
      expect(vol!.supportingData?.comparisonData).toBeDefined();
      expect(vol!.supportingData!.comparisonData!.current).toBeDefined();
      expect(vol!.supportingData!.comparisonData!.previous).toBeDefined();
      expect(vol!.supportingData!.comparisonData!.change).toBeDefined();
    });

    it('FTP increase includes supporting data with values', () => {
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
      expect(ftp!.supportingData?.dataPoints).toBeDefined();
      const currentFtp = ftp!.supportingData!.dataPoints!.find((dp) => dp.value === 260);
      expect(currentFtp).toBeDefined();
    });

    it('activity pattern includes methodology', () => {
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
      expect(pattern!.methodology).toBeDefined();
      expect(pattern!.methodology!.name).toContain('K-means');
    });

    it('section trend includes supporting sections', () => {
      const result = generateInsights(
        {
          ...EMPTY_INPUT,
          sectionTrends: [
            {
              sectionId: 's1',
              sectionName: 'Hill A',
              trend: 1,
              medianRecentSecs: 300,
              bestTimeSecs: 270,
              traversalCount: 10,
            },
            {
              sectionId: 's2',
              sectionName: 'Hill B',
              trend: 0,
              medianRecentSecs: 300,
              bestTimeSecs: 270,
              traversalCount: 8,
            },
            {
              sectionId: 's3',
              sectionName: 'Hill C',
              trend: -1,
              medianRecentSecs: 300,
              bestTimeSecs: 270,
              traversalCount: 5,
            },
          ],
        },
        mockT
      );
      const summary = result.find((i) => i.id === 'section_trend-summary');
      expect(summary!.supportingData?.sections).toBeDefined();
      expect(summary!.supportingData!.sections!.length).toBe(3);
    });
  });
});

// ============================================================
// formatDurationCompact
// ============================================================

describe('formatDurationCompact', () => {
  it.each([
    [0, '0m'],
    [-1, '0m'],
    [NaN, '0m'],
    [Infinity, '0m'],
    [60, '1m'],
    [300, '5m'],
    [3600, '1h'],
    [5400, '1h30'],
    [3660, '1h01'],
    [7200, '2h'],
  ])('formats %d seconds as %s', (secs, expected) => {
    expect(formatDurationCompact(secs)).toBe(expected);
  });
});

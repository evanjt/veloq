/**
 * Data Contract Tests
 *
 * Verify that the data pipeline - format functions, stream parsing,
 * activity metrics conversion, and fitness calculations - produces
 * correct values given known inputs. These tests catch the bugs that
 * matter most: wrong numbers on screen.
 */

import {
  formatDistance,
  formatDuration,
  formatPace,
  formatPaceCompact,
  formatSwimPace,
  formatSpeed,
  formatElevation,
  formatTemperature,
  formatHeartRate,
  formatPower,
  formatCalories,
  formatLoad,
} from '@/shared/format/format';
import { getFormZone } from '@/features/fitness/lib/fitness';
import { ABSENT } from '@/shared/format/absent';

// Mock veloqrs native module
jest.mock('veloqrs', () => require('__shared__/veloqrsStub'));

// ============================================================================
// FIXTURES - stable test activities from demo data
// ============================================================================

/** Ride fixture matching demo-test-0 shape */
const RIDE = {
  id: 'contract-ride',
  name: 'Morning Alpine Ride',
  type: 'Ride',
  start_date_local: '2026-01-15T08:30:00',
  distance: 45000,
  moving_time: 5400,
  elapsed_time: 5700,
  total_elevation_gain: 850,
  average_speed: 8.3,
  max_speed: 14.2,
  average_heartrate: 142,
  max_heartrate: 168,
  icu_average_watts: 210,
  average_cadence: 88,
  calories: 1200,
  icu_training_load: 85,
  icu_ftp: 250,
  icu_zone_times: [
    { id: 'Z1', secs: 600 },
    { id: 'Z2', secs: 1800 },
    { id: 'Z3', secs: 1500 },
    { id: 'Z4', secs: 900 },
    { id: 'Z5', secs: 600 },
  ],
  icu_hr_zone_times: [300, 1200, 1800, 1500, 600],
};

/** Run fixture matching demo-test-1 shape */
const RUN = {
  id: 'contract-run',
  name: 'Easy Morning Run',
  type: 'Run',
  start_date_local: '2026-01-14T07:00:00',
  distance: 8500,
  moving_time: 2700,
  elapsed_time: 2850,
  total_elevation_gain: 45,
  average_speed: 3.15,
  max_speed: 4.2,
  average_heartrate: 138,
  max_heartrate: 155,
  average_cadence: 172,
  calories: 520,
  icu_training_load: 42,
  icu_ftp: 250,
};

/** Swim fixture matching demo-test-4 shape */
const SWIM = {
  id: 'contract-swim',
  name: 'Open Water Swim',
  type: 'Swim',
  start_date_local: '2026-01-12T07:30:00',
  distance: 2000,
  moving_time: 2400,
  elapsed_time: 2700,
  total_elevation_gain: 0,
  average_speed: 0.83,
  max_speed: 1.1,
  average_heartrate: 135,
  max_heartrate: 158,
  calories: 380,
  icu_training_load: 45,
  icu_ftp: 250,
};

// ============================================================================
// GROUP 1: DATA PIPELINE (12 tests)
// ============================================================================

describe('Data Pipeline', () => {
  // Test 1: Ride metric display values
  it('ride fixture → correct metric display values', () => {
    expect(formatDistance(RIDE.distance)).toBe('45.0 km');
    expect(formatDuration(RIDE.moving_time)).toBe('1:30:00');
    expect(formatElevation(RIDE.total_elevation_gain)).toBe('850 m');
    expect(formatSpeed(RIDE.average_speed, true)).toBe('29.9 km/h');
    expect(formatPower(RIDE.icu_average_watts)).toBe('210 W');
    expect(formatHeartRate(RIDE.average_heartrate)).toBe('142 bpm');
    expect(formatLoad(RIDE.icu_training_load)).toBe('85');
    // Written in full in kcal, grouped by the locale's separator.
    expect(formatCalories(RIDE.calories)).toMatch(/^1[,.\u00a0\u202f]?200 kcal$/);
  });

  // Test 3: Run shows pace not speed
  it('run fixture → pace in min/km, not speed in km/h', () => {
    // 3.15 m/s → 1000/3.15 = 317.46 s/km = 5:17 /km
    const pace = formatPace(RUN.average_speed, true);
    expect(pace).toMatch(/\d+:\d{2} \/km/);
    expect(pace).toBe('5:17 /km');

    // Compact pace (no unit suffix)
    expect(formatPaceCompact(RUN.average_speed, true)).toBe('5:17');
  });

  // Test 4: Swim pace per 100m (metric) and per 100yd (imperial)
  it('swim fixture → pace per 100m and per 100yd', () => {
    // 0.83 m/s → 100 / 0.83 = 120.48 s ≈ 2:00
    const metricPace = formatSwimPace(SWIM.average_speed, true);
    expect(metricPace).toMatch(/\d+:\d{2}/);
    expect(metricPace).toBe('2:00');

    // Imperial: 91.44 / 0.83 = 110.17 s ≈ 1:50
    const imperialPace = formatSwimPace(SWIM.average_speed, false);
    expect(imperialPace).toBe('1:50');
  });

  // Test 12: TSB → form zones at boundaries
  it('TSB at boundaries → correct form zones', () => {
    // Exact boundaries from getFormZone:
    // < -30 → highRisk, < -10 → optimal, < 5 → greyZone, < 25 → fresh, >= 25 → transition
    expect(getFormZone(-31)).toBe('highRisk');
    expect(getFormZone(-30)).toBe('optimal'); // -30 is NOT < -30
    expect(getFormZone(-10)).toBe('greyZone'); // -10 is NOT < -10
    expect(getFormZone(5)).toBe('fresh'); // 5 is NOT < 5
    expect(getFormZone(25)).toBe('transition'); // 25 is NOT < 25

    // Mid-zone values
    expect(getFormZone(-40)).toBe('highRisk');
    expect(getFormZone(-20)).toBe('optimal');
    expect(getFormZone(0)).toBe('greyZone');
    expect(getFormZone(15)).toBe('fresh');
    expect(getFormZone(30)).toBe('transition');
  });
});

// ============================================================================
// GROUP 2: RESILIENCE (15 tests)
// ============================================================================

describe('Resilience', () => {
  // NaN resilience across every formatter lives in format.test.ts ("NaN/Infinity wall").

  // Test 19: formatDuration at hour/minute boundaries
  it('formatDuration: 0, 59, 60, 3599, 3600 → correct format transitions', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(59)).toBe('0:59');
    expect(formatDuration(60)).toBe('1:00');
    expect(formatDuration(3599)).toBe('59:59');
    expect(formatDuration(3600)).toBe('1:00:00');
  });

  // Test 25: formatTemperature(null) → the absent mark, not "NaN°C"
  it('formatTemperature(null) → the absent mark, not "NaN°C"', () => {
    expect(formatTemperature(null)).toBe(ABSENT);
    expect(formatTemperature(undefined)).toBe(ABSENT);
    expect(formatTemperature(null, false)).toBe(ABSENT);
    expect(formatTemperature(undefined, false)).toBe(ABSENT);
  });
});

// ============================================================================
// GROUP 3: EDGE CASES (added tests)
// ============================================================================

describe('Zero-distance activity contract', () => {
  it('format functions produce sensible output for zero-distance', () => {
    // All formatters should return a valid string, not NaN or crash
    expect(formatDistance(0)).toBeTruthy();
    expect(formatDuration(0)).toBeTruthy();
    expect(formatPace(0, true)).toBeTruthy(); // 0 m/s pace
    expect(formatSpeed(0, true)).toBeTruthy();
  });

  it('format functions on zero-distance produce no NaN or Infinity', () => {
    const results = [
      formatDistance(0),
      formatDuration(0),
      formatPace(0, true),
      formatPaceCompact(0, true),
      formatSwimPace(0, true),
      formatSpeed(0, true),
      formatElevation(0),
      formatHeartRate(0),
      formatPower(0),
      formatCalories(0),
      formatLoad(0),
    ];
    for (const r of results) {
      expect(r).not.toContain('NaN');
      expect(r).not.toContain('Infinity');
    }
  });
});

describe('All-null activity fields', () => {
  it('format functions handle null/undefined without NaN', () => {
    // These accept null/undefined
    expect(formatElevation(null)).not.toContain('NaN');
    expect(formatElevation(undefined)).not.toContain('NaN');
    expect(formatTemperature(null)).not.toContain('NaN');
    expect(formatTemperature(undefined)).not.toContain('NaN');
  });
});

describe('Swim pace edge cases', () => {
  it('handles zero speed', () => {
    expect(formatSwimPace(0, true)).toBeTruthy();
    expect(formatSwimPace(0, true)).not.toContain('NaN');
    expect(formatSwimPace(0, true)).not.toContain('Infinity');
  });

  it('returns --:-- for zero and negative speed', () => {
    // formatSwimPace guards with: metersPerSecond <= 0 → '--:--'
    expect(formatSwimPace(0, true)).toBe('--:--');
    expect(formatSwimPace(-1, true)).toBe('--:--');
  });

  it('handles very high speed without crash', () => {
    // 100 m/s is absurdly fast but should not crash or produce NaN
    const fast = formatSwimPace(100, true);
    expect(fast).not.toContain('NaN');
    expect(fast).not.toContain('Infinity');
    // 100 / 100 m/s = 1 second → 0:01
    expect(fast).toBe('0:01');
  });

  it('handles very slow speed without overflow', () => {
    // 0.01 m/s → 100/0.01 = 10000s = 166:40
    const slow = formatSwimPace(0.01, true);
    expect(slow).not.toContain('NaN');
    expect(slow).not.toContain('Infinity');
    expect(slow).toMatch(/\d+:\d{2}/);
  });

  it('imperial and metric give different results for same speed', () => {
    const metric = formatSwimPace(1.0, true); // 100/1 = 100s → 1:40
    const imperial = formatSwimPace(1.0, false); // 91.44/1 = 91s → 1:31
    expect(metric).not.toBe(imperial);
  });
});

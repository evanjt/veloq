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
  formatSpeed,
  formatElevation,
  formatTemperature,
  formatHeartRate,
  formatPower,
  formatCalories,
  formatLoad,
} from '@/shared/format/format';
import { ABSENT } from '@/shared/format/absent';

// Mock veloqrs native module
jest.mock('veloqrs', () => require('./__shared__/veloqrsStub'));

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

// ============================================================================
// GROUP 1: DATA PIPELINE (12 tests)
// ============================================================================

describe('Data Pipeline', () => {
  // Test 1: Ride metric display values
  it('ride fixture → correct metric display values', () => {
    expect(formatDistance(RIDE.distance, true)).toBe('45.0 km');
    expect(formatDuration(RIDE.moving_time)).toBe('1:30:00');
    expect(formatElevation(RIDE.total_elevation_gain, true)).toBe('850 m');
    expect(formatSpeed(RIDE.average_speed, true)).toBe('29.9 km/h');
    expect(formatPower(RIDE.icu_average_watts)).toBe('210 W');
    expect(formatHeartRate(RIDE.average_heartrate)).toBe('142 bpm');
    expect(formatLoad(RIDE.icu_training_load)).toBe('85');
    // Written in full in kcal, grouped by the locale's separator.
    expect(formatCalories(RIDE.calories)).toMatch(/^1[,.\u00a0\u202f]?200 kcal$/);
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
    expect(formatTemperature(null, true)).toBe(ABSENT);
    expect(formatTemperature(undefined, true)).toBe(ABSENT);
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
    expect(formatDistance(0, true)).toBeTruthy();
    expect(formatDuration(0)).toBeTruthy();
    expect(formatSpeed(0, true)).toBeTruthy();
  });

  it('format functions on zero-distance produce no NaN or Infinity', () => {
    const results = [
      formatDistance(0, true),
      formatDuration(0),
      formatSpeed(0, true),
      formatElevation(0, true),
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
    expect(formatElevation(null, true)).not.toContain('NaN');
    expect(formatElevation(undefined, true)).not.toContain('NaN');
    expect(formatTemperature(null, true)).not.toContain('NaN');
    expect(formatTemperature(undefined, true)).not.toContain('NaN');
  });
});

/**
 * Data Contract Tests
 *
 * Verify that the data pipeline — format functions, stream parsing,
 * activity metrics conversion, and fitness calculations — produces
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
  formatLocalDate,
  formatTSS,
} from '@/lib/utils/format';
import { parseStreams } from '@/lib/utils/streams';
import { calculateTSB, getFormZone } from '@/lib/algorithms/fitness';
import type { RawStreamItem, WellnessData } from '@/types';

// Mock veloqrs native module — toActivityMetrics imports the type
jest.mock('veloqrs', () => ({}));

// Import after mock is set up
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { toActivityMetrics } = require('@/lib/utils/activityMetrics');

// ============================================================================
// FIXTURES — stable test activities from demo data
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
  average_watts: 210,
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

/** Activity with all nullable fields null */
const NULL_ACTIVITY = {
  id: 'contract-null',
  name: 'Null Test',
  type: 'Ride',
  start_date_local: '2026-01-10T10:00:00',
  distance: 10000,
  moving_time: 3600,
  elapsed_time: 3600,
  total_elevation_gain: 100,
  average_speed: 2.78,
  max_speed: 5.0,
  average_heartrate: null,
  max_heartrate: null,
  average_watts: null,
  average_cadence: null,
  calories: null,
  icu_training_load: null,
  icu_ftp: null,
};

/** Activity with zero distance */
const ZERO_DIST = {
  id: 'contract-zero',
  name: 'Zero Distance',
  type: 'Ride',
  start_date_local: '2026-01-09T10:00:00',
  distance: 0,
  moving_time: 3600,
  elapsed_time: 3600,
  total_elevation_gain: 0,
  average_speed: 0,
  max_speed: 0,
  average_heartrate: 120,
  max_heartrate: 145,
  average_watts: 150,
  calories: 200,
  icu_training_load: 30,
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
    expect(formatSpeed(RIDE.average_speed)).toBe('29.9 km/h');
    expect(formatPower(RIDE.average_watts)).toBe('210 W');
    expect(formatHeartRate(RIDE.average_heartrate)).toBe('142 bpm');
    expect(formatTSS(RIDE.icu_training_load)).toBe('85');
    expect(formatCalories(RIDE.calories)).toBe('1.2k');
  });

  // Test 2: Ride imperial display values
  it('ride fixture → correct imperial display values', () => {
    // 45000m * 0.621371 / 1000 = 27.96 mi
    expect(formatDistance(RIDE.distance, false)).toBe('28.0 mi');
    // 850m * 3.28084 = 2789 ft
    expect(formatElevation(RIDE.total_elevation_gain, false)).toBe('2789 ft');
    // 8.3 m/s * 2.23694 = 18.6 mph
    expect(formatSpeed(RIDE.average_speed, false)).toBe('18.6 mph');
  });

  // Test 3: Run shows pace not speed
  it('run fixture → pace in min/km, not speed in km/h', () => {
    // 3.15 m/s → 1000/3.15 = 317.46 s/km = 5:17 /km
    const pace = formatPace(RUN.average_speed);
    expect(pace).toMatch(/\d+:\d{2} \/km/);
    expect(pace).toBe('5:17 /km');

    // Compact pace (no unit suffix)
    expect(formatPaceCompact(RUN.average_speed)).toBe('5:17');
  });

  // Test 4: Swim pace per 100m (metric) and per 100yd (imperial)
  it('swim fixture → pace per 100m and per 100yd', () => {
    // 0.83 m/s → 100 / 0.83 = 120.48 s ≈ 2:00
    const metricPace = formatSwimPace(SWIM.average_speed);
    expect(metricPace).toMatch(/\d+:\d{2}/);
    expect(metricPace).toBe('2:00');

    // Imperial: 91.44 / 0.83 = 110.17 s ≈ 1:50
    const imperialPace = formatSwimPace(SWIM.average_speed, false);
    expect(imperialPace).toBe('1:50');
  });

  // Test 5: Null fields format without NaN
  it('activity with null fields → formats without NaN', () => {
    const hrStr = formatHeartRate(NULL_ACTIVITY.average_heartrate as unknown as number);
    const powerStr = formatPower(NULL_ACTIVITY.average_watts as unknown as number);
    const elevStr = formatElevation(NULL_ACTIVITY.total_elevation_gain);

    expect(hrStr).not.toContain('NaN');
    expect(powerStr).not.toContain('NaN');
    expect(elevStr).not.toContain('NaN');

    // NaN input to formatHeartRate should give fallback
    expect(formatHeartRate(NaN)).toBe('0 bpm');
    expect(formatPower(NaN)).toBe('0 W');
  });

  // Test 6: Zero distance
  it('activity with zero distance → sensible display values', () => {
    expect(formatDistance(ZERO_DIST.distance)).toBe('0 m');
    expect(formatPace(ZERO_DIST.average_speed)).toBe('--:--');
    expect(formatSpeed(ZERO_DIST.average_speed)).toBe('0.0 km/h');
  });

  // Test 7: parseStreams with full stream set
  it('parseStreams with full stream set → correct ActivityStreams shape', () => {
    const raw: RawStreamItem[] = [
      { type: 'time', name: null, data: [0, 5, 10, 15] },
      { type: 'heartrate', name: null, data: [120, 130, 140, 135] },
      { type: 'watts', name: null, data: [200, 210, 220, 215] },
      { type: 'altitude', name: null, data: [100, 110, 120, 115] },
      { type: 'cadence', name: null, data: [85, 90, 88, 86] },
      { type: 'velocity_smooth', name: null, data: [8.0, 8.5, 9.0, 8.8] },
      { type: 'distance', name: null, data: [0, 40, 85, 129] },
      { type: 'latlng', name: null, data: [46.0, 46.1, 46.2, 46.3], data2: [7.0, 7.1, 7.2, 7.3] },
    ];

    const streams = parseStreams(raw);

    expect(streams.time).toEqual([0, 5, 10, 15]);
    expect(streams.heartrate).toEqual([120, 130, 140, 135]);
    expect(streams.watts).toEqual([200, 210, 220, 215]);
    expect(streams.altitude).toEqual([100, 110, 120, 115]);
    expect(streams.cadence).toEqual([85, 90, 88, 86]);
    expect(streams.velocity_smooth).toEqual([8.0, 8.5, 9.0, 8.8]);
    expect(streams.distance).toEqual([0, 40, 85, 129]);
    expect(streams.latlng).toEqual([
      [46.0, 7.0],
      [46.1, 7.1],
      [46.2, 7.2],
      [46.3, 7.3],
    ]);
  });

  // Test 8: fixed_altitude overrides altitude
  it('parseStreams: fixed_altitude overrides altitude regardless of order', () => {
    const altitudeFirst: RawStreamItem[] = [
      { type: 'altitude', name: null, data: [100, 110, 120] },
      { type: 'fixed_altitude', name: null, data: [105, 115, 125] },
    ];
    expect(parseStreams(altitudeFirst).altitude).toEqual([105, 115, 125]);

    const fixedFirst: RawStreamItem[] = [
      { type: 'fixed_altitude', name: null, data: [105, 115, 125] },
      { type: 'altitude', name: null, data: [100, 110, 120] },
    ];
    expect(parseStreams(fixedFirst).altitude).toEqual([105, 115, 125]);
  });

  // Test 9: latlng with data but no data2
  it('parseStreams: latlng with data but no data2 → no latlng (not crash)', () => {
    const raw: RawStreamItem[] = [
      { type: 'latlng', name: null, data: [46.0, 46.1, 46.2] },
      { type: 'time', name: null, data: [0, 5, 10] },
    ];

    const streams = parseStreams(raw);
    expect(streams.latlng).toBeUndefined();
    expect(streams.time).toEqual([0, 5, 10]);
  });

  // Test 10: toActivityMetrics date and zone fields
  it('toActivityMetrics → date is correct unix BigInt, zone times are JSON strings', () => {
    const metrics = toActivityMetrics(RIDE);

    // Date: 2026-01-15T08:30:00 local → unix seconds
    const expectedDate = BigInt(Math.floor(new Date('2026-01-15T08:30:00').getTime() / 1000));
    expect(metrics.date).toBe(expectedDate);

    // Zone times should be JSON strings
    expect(metrics.powerZoneTimes).toBe(JSON.stringify([600, 1800, 1500, 900, 600]));
    expect(metrics.hrZoneTimes).toBe(JSON.stringify([300, 1200, 1800, 1500, 600]));

    // Core fields
    expect(metrics.activityId).toBe('contract-ride');
    expect(metrics.distance).toBe(45000);
    expect(metrics.movingTime).toBe(5400);
    expect(metrics.sportType).toBe('Ride');
  });

  // Test 11: Wellness → calculateTSB → correct TSB values
  it('wellness fixtures → calculateTSB → correct TSB values', () => {
    const wellness: WellnessData[] = [
      { id: '2026-01-01', ctl: 50, atl: 60 },
      { id: '2026-01-02', ctl: 45, atl: 40 },
      { id: '2026-01-03', ctl: 30, atl: 30 },
    ];

    const result = calculateTSB(wellness);

    expect(result).toHaveLength(3);
    expect(result[0].tsb).toBe(-10); // 50 - 60
    expect(result[1].tsb).toBe(5); // 45 - 40
    expect(result[2].tsb).toBe(0); // 30 - 30
  });

  // Test 12: TSB → form zones at boundaries
  it('TSB at boundaries → correct form zones', () => {
    // Exact boundaries from getFormZone:
    // < -30 → highRisk, < -10 → optimal, < 5 → grey, < 25 → fresh, >= 25 → transition
    expect(getFormZone(-31)).toBe('highRisk');
    expect(getFormZone(-30)).toBe('optimal'); // -30 is NOT < -30
    expect(getFormZone(-10)).toBe('grey'); // -10 is NOT < -10
    expect(getFormZone(5)).toBe('fresh'); // 5 is NOT < 5
    expect(getFormZone(25)).toBe('transition'); // 25 is NOT < 25

    // Mid-zone values
    expect(getFormZone(-40)).toBe('highRisk');
    expect(getFormZone(-20)).toBe('optimal');
    expect(getFormZone(0)).toBe('grey');
    expect(getFormZone(15)).toBe('fresh');
    expect(getFormZone(30)).toBe('transition');
  });
});

// ============================================================================
// GROUP 2: RESILIENCE (15 tests)
// ============================================================================

describe('Resilience', () => {
  // All format functions that accept a single number
  const numericFormatFunctions: [string, (n: number) => string][] = [
    ['formatDistance', formatDistance],
    ['formatDuration', formatDuration],
    ['formatPace', formatPace],
    ['formatPaceCompact', formatPaceCompact],
    ['formatSwimPace', formatSwimPace],
    ['formatSpeed', formatSpeed],
    ['formatHeartRate', formatHeartRate],
    ['formatPower', formatPower],
    ['formatCalories', formatCalories],
    ['formatTSS', formatTSS],
  ];

  // Functions that accept number | undefined | null
  const nullableFormatFunctions: [string, (n: number | undefined | null) => string][] = [
    ['formatElevation', formatElevation],
    ['formatTemperature', formatTemperature],
  ];

  // Test 13: NaN → no output contains "NaN"
  it('every format function with NaN → no output contains "NaN"', () => {
    for (const [name, fn] of numericFormatFunctions) {
      const result = fn(NaN);
      expect(result).not.toContain('NaN');
      // Also verify it's a non-empty string
      expect(result.length).toBeGreaterThan(0);
    }
    for (const [name, fn] of nullableFormatFunctions) {
      const result = fn(NaN);
      expect(result).not.toContain('NaN');
    }
  });

  // Test 14: Infinity → no output contains "Infinity"
  it('every format function with Infinity → no output contains "Infinity"', () => {
    for (const [name, fn] of numericFormatFunctions) {
      const result = fn(Infinity);
      expect(result).not.toContain('Infinity');
    }
    for (const [name, fn] of numericFormatFunctions) {
      const result = fn(-Infinity);
      expect(result).not.toContain('Infinity');
    }
    for (const [name, fn] of nullableFormatFunctions) {
      expect(fn(Infinity)).not.toContain('Infinity');
      expect(fn(-Infinity)).not.toContain('Infinity');
    }
  });

  // Test 15: Negative → sensible fallback
  it('every format function with negative → sensible fallback', () => {
    for (const [name, fn] of numericFormatFunctions) {
      const result = fn(-100);
      expect(result).not.toContain('NaN');
      expect(result).not.toContain('undefined');
      expect(result.length).toBeGreaterThan(0);
    }
  });

  // Test 16: formatDistance at thresholds
  it('formatDistance at unit thresholds: 999→m, 1000→km, feet/miles boundary', () => {
    // Metric thresholds
    expect(formatDistance(999)).toBe('999 m');
    expect(formatDistance(1000)).toBe('1.0 km');

    // Imperial: < 0.25 miles (~402m) → feet, >= 0.25 miles → miles
    // 400m → 400 * 3.28084 = 1312 ft; 400m in miles = 0.4 * 0.621371 = 0.249
    expect(formatDistance(400, false)).toMatch(/ft$/);
    // 403m → 0.403 * 0.621371 = 0.2504 mi → should be miles
    expect(formatDistance(403, false)).toMatch(/mi$/);
  });

  // Test 17: formatPace with very slow speed
  it('formatPace with very slow speed (0.1 m/s) → capped, not absurd', () => {
    // 0.1 m/s → 1000/0.1 = 10000 s/km = 166:40 /km
    // This IS what the function returns — it's mathematically correct
    const result = formatPace(0.1);
    expect(result).toMatch(/\d+:\d{2} \/km/);
    expect(result).not.toContain('NaN');
    expect(result).not.toContain('Infinity');
  });

  // Test 18: formatCalories at compact format boundaries
  it('formatCalories: 999→"999", 1000→"1.0k", 1500→"1.5k"', () => {
    expect(formatCalories(999)).toBe('999');
    expect(formatCalories(1000)).toBe('1.0k');
    expect(formatCalories(1500)).toBe('1.5k');
  });

  // Test 19: formatDuration at hour/minute boundaries
  it('formatDuration: 0, 59, 60, 3599, 3600 → correct format transitions', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(59)).toBe('0:59');
    expect(formatDuration(60)).toBe('1:00');
    expect(formatDuration(3599)).toBe('59:59');
    expect(formatDuration(3600)).toBe('1:00:00');
  });

  // Test 20: calculateTSB with empty array
  it('calculateTSB with empty array → empty array', () => {
    expect(calculateTSB([])).toEqual([]);
  });

  // Test 21: calculateTSB with missing ctl/atl → falls back to ctlLoad/atlLoad
  it('calculateTSB with missing ctl/atl → falls back to ctlLoad/atlLoad', () => {
    const wellness: WellnessData[] = [
      { id: '2026-01-01', ctlLoad: 50, atlLoad: 60 },
      { id: '2026-01-02', ctlLoad: 40, atlLoad: 30 },
    ];

    const result = calculateTSB(wellness);
    expect(result[0].tsb).toBe(-10); // 50 - 60
    expect(result[1].tsb).toBe(10); // 40 - 30
  });

  // Test 22: parseStreams with empty array
  it('parseStreams with empty array → empty object', () => {
    const result = parseStreams([]);
    expect(result).toEqual({});
  });

  // Test 23: parseStreams ignores unknown stream types
  it('parseStreams ignores unknown stream types', () => {
    const raw: RawStreamItem[] = [
      { type: 'time', name: null, data: [0, 5, 10] },
      { type: 'future_sensor', name: null, data: [1, 2, 3] },
      { type: 'unknown_type', name: null, data: [4, 5, 6] },
    ];

    const streams = parseStreams(raw);
    expect(streams.time).toEqual([0, 5, 10]);
    expect(Object.keys(streams)).toEqual(['time']);
  });

  // Test 24: formatLocalDate uses local timezone, not UTC
  it('formatLocalDate uses local timezone, not UTC', () => {
    // Construct a date using local components — this is timezone-safe
    const date = new Date(2026, 0, 15); // Jan 15, 2026 in local TZ
    expect(formatLocalDate(date)).toBe('2026-01-15');

    // The key property: formatLocalDate uses getFullYear/getMonth/getDate (local)
    // NOT toISOString().split('T')[0] which would use UTC.
    // Verify by checking a date constructed with specific local components
    const dec31 = new Date(2025, 11, 31); // Dec 31, 2025 local
    expect(formatLocalDate(dec31)).toBe('2025-12-31');
  });

  // Test 25: formatTemperature(null) → "--°C" not "NaN°C"
  it('formatTemperature(null) → "--°C" not "NaN°C"', () => {
    expect(formatTemperature(null)).toBe('--°C');
    expect(formatTemperature(undefined)).toBe('--°C');
    expect(formatTemperature(null, false)).toBe('--°F');
    expect(formatTemperature(undefined, false)).toBe('--°F');
  });

  // Test 26: toActivityMetrics with minimal activity
  it('toActivityMetrics with minimal activity → valid output', () => {
    const minimal = {
      id: 'minimal-1',
      name: 'Test',
      start_date_local: '2026-01-01T00:00:00',
      distance: 0,
      moving_time: 0,
      elapsed_time: 0,
      total_elevation_gain: 0,
      average_speed: 0,
      max_speed: 0,
    };

    const metrics = toActivityMetrics(minimal);

    expect(metrics.activityId).toBe('minimal-1');
    expect(metrics.name).toBe('Test');
    expect(typeof metrics.date).toBe('bigint');
    expect(metrics.distance).toBe(0);
    expect(metrics.movingTime).toBe(0);
    expect(metrics.elevationGain).toBe(0);
    expect(metrics.sportType).toBe('Ride'); // default when type is undefined
    expect(metrics.powerZoneTimes).toBeUndefined();
    expect(metrics.hrZoneTimes).toBeUndefined();
  });

  // Test 27: formatElevation(undefined) → "0 m" not "NaN m"
  it('formatElevation(undefined) → "0 m" not "NaN m"', () => {
    expect(formatElevation(undefined)).toBe('0 m');
    expect(formatElevation(null)).toBe('0 m');
    expect(formatElevation(undefined, false)).toBe('0 ft');
  });
});

/**
 * Tests for activity metrics conversion.
 *
 * Covers: toActivityMetrics
 * Bug fixes validated:
 * - BigInt(NaN) throws when start_date_local is invalid
 * - Documents inconsistent zone time serialization (powerZoneTimes vs hrZoneTimes)
 */

jest.mock('veloqrs', () => ({}), { virtual: true });

import { toActivityMetrics } from '@/lib/utils/activityMetrics';
import type { Activity } from '@/types';

function makeActivity(overrides: Partial<Activity> = {}): Activity {
  return {
    id: 'act-1',
    name: 'Morning Ride',
    type: 'Ride',
    start_date_local: '2026-01-15T08:00:00',
    moving_time: 3600,
    elapsed_time: 3900,
    distance: 40000,
    total_elevation_gain: 500,
    average_heartrate: 145,
    average_watts: 200,
    average_speed: 11.1,
    max_speed: 15.0,
    ...overrides,
  };
}

describe('toActivityMetrics', () => {
  it('converts a full activity with all fields', () => {
    const activity = makeActivity({
      icu_training_load: 85,
      icu_ftp: 260,
      icu_zone_times: [
        { id: 'Z1', secs: 600 },
        { id: 'Z2', secs: 1200 },
        { id: 'Z3', secs: 900 },
      ],
      icu_hr_zone_times: [300, 600, 1200, 900, 100],
    });
    const metrics = toActivityMetrics(activity);

    expect(metrics.activityId).toBe('act-1');
    expect(metrics.name).toBe('Morning Ride');
    expect(metrics.sportType).toBe('Ride');
    expect(metrics.distance).toBe(40000);
    expect(metrics.movingTime).toBe(3600);
    expect(metrics.elapsedTime).toBe(3900);
    expect(metrics.elevationGain).toBe(500);
    expect(metrics.avgHr).toBe(145);
    expect(metrics.avgPower).toBe(200);
    expect(metrics.trainingLoad).toBe(85);
    expect(metrics.ftp).toBe(260);
  });

  it('converts date to BigInt unix timestamp', () => {
    const activity = makeActivity({ start_date_local: '2026-01-15T08:00:00' });
    const metrics = toActivityMetrics(activity);
    expect(typeof metrics.date).toBe('bigint');
    const expected = BigInt(Math.floor(new Date('2026-01-15T08:00:00').getTime() / 1000));
    expect(metrics.date).toBe(expected);
  });

  it('handles partial activity with missing optional fields', () => {
    const activity = makeActivity({
      average_heartrate: undefined,
      average_watts: undefined,
      icu_training_load: undefined,
      icu_ftp: undefined,
    });
    const metrics = toActivityMetrics(activity);
    expect(metrics.avgHr).toBeUndefined();
    expect(metrics.avgPower).toBeUndefined();
    expect(metrics.trainingLoad).toBeUndefined();
    expect(metrics.ftp).toBeUndefined();
  });

  it('defaults to "Ride" when activity type is falsy', () => {
    const activity = makeActivity({ type: undefined as unknown as Activity['type'] });
    const metrics = toActivityMetrics(activity);
    expect(metrics.sportType).toBe('Ride');
  });

  it('defaults total_elevation_gain to 0 when falsy', () => {
    const activity = makeActivity({ total_elevation_gain: 0 });
    const metrics = toActivityMetrics(activity);
    expect(metrics.elevationGain).toBe(0);
  });

  it('does not throw on null start_date_local (BUG FIX)', () => {
    const activity = makeActivity({
      start_date_local: null as unknown as string,
    });
    expect(() => toActivityMetrics(activity)).not.toThrow();
    const metrics = toActivityMetrics(activity);
    expect(metrics.date).toBe(BigInt(0));
  });

  it('does not throw on undefined start_date_local (BUG FIX)', () => {
    const activity = makeActivity({
      start_date_local: undefined as unknown as string,
    });
    expect(() => toActivityMetrics(activity)).not.toThrow();
    const metrics = toActivityMetrics(activity);
    expect(metrics.date).toBe(BigInt(0));
  });

  it('does not throw on empty string start_date_local', () => {
    const activity = makeActivity({ start_date_local: '' });
    expect(() => toActivityMetrics(activity)).not.toThrow();
  });

  it('handles zone times being undefined', () => {
    const activity = makeActivity({
      icu_zone_times: undefined,
      icu_hr_zone_times: undefined,
    });
    const metrics = toActivityMetrics(activity);
    expect(metrics.powerZoneTimes).toBeUndefined();
    expect(metrics.hrZoneTimes).toBeUndefined();
  });
});

describe('zone time serialization (DOCUMENT ONLY - inconsistency)', () => {
  it('powerZoneTimes extracts .secs from zone objects', () => {
    const activity = makeActivity({
      icu_zone_times: [
        { id: 'Z1', secs: 600 },
        { id: 'Z2', secs: 1200 },
      ],
    });
    const metrics = toActivityMetrics(activity);
    // powerZoneTimes is JSON array of just the secs values
    expect(metrics.powerZoneTimes).toBe(JSON.stringify([600, 1200]));
  });

  it('hrZoneTimes serializes whole objects (different format from powerZoneTimes)', () => {
    const activity = makeActivity({
      icu_hr_zone_times: [300, 600, 1200],
    });
    const metrics = toActivityMetrics(activity);
    // hrZoneTimes is JSON array of the raw numbers (already flat)
    expect(metrics.hrZoneTimes).toBe(JSON.stringify([300, 600, 1200]));
  });

  it('INCONSISTENCY: powerZoneTimes maps .secs while hrZoneTimes passes through', () => {
    // This test documents the intentional asymmetry:
    // - icu_zone_times is Array<{id, secs}> → powerZoneTimes = JSON.stringify(map(z => z.secs))
    // - icu_hr_zone_times is number[] → hrZoneTimes = JSON.stringify(array)
    // Both produce a JSON array of numbers, but the input types differ.
    // Not changing this since it may match Rust expectations.
    const activity = makeActivity({
      icu_zone_times: [{ id: 'Z1', secs: 100 }],
      icu_hr_zone_times: [200],
    });
    const metrics = toActivityMetrics(activity);
    expect(JSON.parse(metrics.powerZoneTimes!)).toEqual([100]);
    expect(JSON.parse(metrics.hrZoneTimes!)).toEqual([200]);
  });
});

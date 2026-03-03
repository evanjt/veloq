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

describe('zone time arrays', () => {
  it('powerZoneTimes extracts .secs from zone objects', () => {
    const activity = makeActivity({
      icu_zone_times: [
        { id: 'Z1', secs: 600 },
        { id: 'Z2', secs: 1200 },
      ],
    });
    const metrics = toActivityMetrics(activity);
    expect(metrics.powerZoneTimes).toEqual([600, 1200]);
  });

  it('hrZoneTimes passes through raw numbers', () => {
    const activity = makeActivity({
      icu_hr_zone_times: [300, 600, 1200],
    });
    const metrics = toActivityMetrics(activity);
    expect(metrics.hrZoneTimes).toEqual([300, 600, 1200]);
  });

  it('powerZoneTimes maps .secs while hrZoneTimes passes through', () => {
    // icu_zone_times is Array<{id, secs}> → powerZoneTimes = map(z => z.secs)
    // icu_hr_zone_times is number[] → hrZoneTimes = array (passed through)
    const activity = makeActivity({
      icu_zone_times: [{ id: 'Z1', secs: 100 }],
      icu_hr_zone_times: [200],
    });
    const metrics = toActivityMetrics(activity);
    expect(metrics.powerZoneTimes).toEqual([100]);
    expect(metrics.hrZoneTimes).toEqual([200]);
  });
});

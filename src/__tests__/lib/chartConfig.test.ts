import { CHART_CONFIGS, getAvailableCharts } from '@/lib/utils/chartConfig';
import type { ActivityStreams } from '@/types';

describe('CHART_CONFIGS', () => {
  it('has all expected chart types', () => {
    const expectedIds = [
      'power',
      'heartrate',
      'cadence',
      'speed',
      'pace',
      'elevation',
      'distance',
      'temp',
      'moving_time',
      'elapsed_time',
    ];
    expect(Object.keys(CHART_CONFIGS).sort()).toEqual(expectedIds.sort());
  });

  it('every config has id, label, icon, and color', () => {
    for (const [key, config] of Object.entries(CHART_CONFIGS)) {
      expect(config.id).toBe(key);
      expect(config.label).toBeTruthy();
      expect(config.icon).toBeTruthy();
      expect(config.color).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });

  it('speed getStream converts m/s to km/h', () => {
    const streams: ActivityStreams = { velocity_smooth: [1, 10] };
    const data = CHART_CONFIGS.speed.getStream!(streams);
    expect(data).toEqual([3.6, 36]);
  });

  it('pace getStream converts m/s to min/km', () => {
    const streams: ActivityStreams = { velocity_smooth: [5, 0] };
    const data = CHART_CONFIGS.pace.getStream!(streams);
    // 5 m/s = 200s/km = 3.333 min/km; 0 m/s = 0
    expect(data![0]).toBeCloseTo(1000 / 5 / 60, 5);
    expect(data![1]).toBe(0);
  });

  it('distance getStream converts meters to km', () => {
    const streams: ActivityStreams = { distance: [0, 1000, 5000] };
    const data = CHART_CONFIGS.distance.getStream!(streams);
    expect(data).toEqual([0, 1, 5]);
  });

  it('elevation convertToImperial converts m to ft', () => {
    const ft = CHART_CONFIGS.elevation.convertToImperial!(100);
    expect(ft).toBeCloseTo(328.084, 1);
  });

  it('speed convertToImperial converts km/h to mph', () => {
    const mph = CHART_CONFIGS.speed.convertToImperial!(100);
    expect(mph).toBeCloseTo(62.1371, 1);
  });

  it('pace formatValue formats minutes:seconds', () => {
    // 4.5 min/km = 4:30
    expect(CHART_CONFIGS.pace.formatValue!(4.5, true)).toBe('4:30');
    // 3.0833 min/km = 3:05
    expect(CHART_CONFIGS.pace.formatValue!(3.0833, true)).toBe('3:05');
  });
});

describe('getAvailableCharts', () => {
  it('returns charts that have stream data', () => {
    const streams: ActivityStreams = {
      watts: [100, 200, 300],
      heartrate: [120, 130, 140],
      velocity_smooth: [3, 4, 5],
    };
    const available = getAvailableCharts(streams);
    const ids = available.map((c) => c.id);
    expect(ids).toContain('power');
    expect(ids).toContain('heartrate');
    expect(ids).toContain('speed');
    expect(ids).toContain('pace');
  });

  it('excludes charts without data', () => {
    const streams: ActivityStreams = { heartrate: [120, 130] };
    const available = getAvailableCharts(streams);
    const ids = available.map((c) => c.id);
    expect(ids).toContain('heartrate');
    expect(ids).not.toContain('power');
    expect(ids).not.toContain('elevation');
  });

  it('returns empty for empty streams', () => {
    const available = getAvailableCharts({});
    expect(available).toHaveLength(0);
  });

  it('excludes non-primary charts (distance, temp, moving_time, elapsed_time)', () => {
    const streams: ActivityStreams = {
      distance: [0, 100, 200],
      altitude: [100, 200, 300],
    };
    const available = getAvailableCharts(streams);
    const ids = available.map((c) => c.id);
    // altitude maps to elevation (primary), distance is not primary
    expect(ids).toContain('elevation');
    expect(ids).not.toContain('distance');
  });
});

/**
 * Tests for CombinedPlot data-prep helpers.
 * Pure functions, but we need to provide minimal chart-config mocks because
 * the helpers consume a config record keyed by ChartTypeId.
 *
 * `@/hooks` is mocked to avoid pulling the `veloqrs` native TurboModule into
 * the node-based test environment. `combinedPlotData.ts` only needs the
 * zone-color constants from `@/hooks`.
 */

jest.mock('@/hooks', () => ({
  POWER_ZONE_COLORS: ['#808080', '#3B82F6', '#22C55E', '#F59E0B', '#EF4444', '#8B5CF6', '#DB2777'],
  HR_ZONE_COLORS: ['#808080', '#3B82F6', '#22C55E', '#F59E0B', '#EF4444', '#8B5CF6', '#DB2777'],
}));

import {
  buildChartData,
  computeAllAverages,
  computeIntervalBands,
  type SeriesInfo,
} from '@/lib/charts/combinedPlotData';
import type { ChartConfig, ChartTypeId } from '@/lib';
import type { ActivityStreams, ActivityInterval } from '@/types';

function powerConfig(): ChartConfig {
  return {
    id: 'power',
    label: 'Power',
    color: '#FB923C',
    unit: 'W',
    streamKey: 'watts',
    getStream: (s: ActivityStreams) => s.watts ?? [],
    formatValue: (v: number) => Math.round(v).toString(),
  } as unknown as ChartConfig;
}

function heartRateConfig(): ChartConfig {
  return {
    id: 'heartrate',
    label: 'HR',
    color: '#EF4444',
    unit: 'bpm',
    streamKey: 'heartrate',
    getStream: (s: ActivityStreams) => s.heartrate ?? [],
    formatValue: (v: number) => Math.round(v).toString(),
  } as unknown as ChartConfig;
}

function altitudeConfig(): ChartConfig {
  return {
    id: 'altitude',
    label: 'Altitude',
    color: '#8B5CF6',
    unit: 'm',
    unitImperial: 'ft',
    streamKey: 'altitude',
    defaultMetric: 'gain',
    getStream: (s: ActivityStreams) => s.altitude ?? [],
    formatValue: (v: number) => Math.round(v).toString(),
    convertToImperial: (v: number) => v * 3.28084,
  } as unknown as ChartConfig;
}

function streams(overrides: Partial<ActivityStreams> = {}): ActivityStreams {
  return {
    time: Array.from({ length: 10 }, (_, i) => i * 10),
    distance: Array.from({ length: 10 }, (_, i) => i * 100),
    watts: [100, 120, 150, 180, 200, 210, 220, 205, 180, 160],
    heartrate: [120, 130, 140, 150, 155, 160, 162, 158, 150, 145],
    altitude: [100, 105, 112, 120, 115, 118, 125, 130, 128, 135],
    ...overrides,
  } as ActivityStreams;
}

describe('buildChartData', () => {
  it('returns empty result when x-source is empty', () => {
    const result = buildChartData(
      streams({ time: [], distance: [] }),
      ['power'],
      { power: powerConfig() } as Record<ChartTypeId, ChartConfig>,
      true,
      null,
      'distance'
    );
    expect(result.chartData).toEqual([]);
    expect(result.seriesInfo).toEqual([]);
  });

  it('returns empty result when no selected chart has stream data', () => {
    const configs = { power: powerConfig() } as unknown as Record<ChartTypeId, ChartConfig>;
    const result = buildChartData(
      streams({ watts: [] }),
      ['power'],
      configs,
      true,
      null,
      'distance'
    );
    expect(result.chartData).toEqual([]);
    expect(result.seriesInfo).toEqual([]);
  });

  it('builds chart data for a single series with distance axis', () => {
    const configs = { power: powerConfig() } as unknown as Record<ChartTypeId, ChartConfig>;
    const result = buildChartData(streams(), ['power'], configs, true, null, 'distance');
    expect(result.chartData.length).toBeGreaterThan(0);
    expect(result.seriesInfo).toHaveLength(1);
    expect(result.seriesInfo[0].id).toBe('power');
    // Power range should have valid min/max
    expect(result.seriesInfo[0].range.min).toBe(100);
    expect(result.seriesInfo[0].range.max).toBe(220);
  });

  it('builds chart data for multiple selected series', () => {
    const configs = {
      power: powerConfig(),
      heartrate: heartRateConfig(),
    } as unknown as Record<ChartTypeId, ChartConfig>;
    const result = buildChartData(
      streams(),
      ['power', 'heartrate'],
      configs,
      true,
      null,
      'distance'
    );
    expect(result.seriesInfo).toHaveLength(2);
    // Each point should have an x plus two normalized series values
    result.chartData.forEach((p) => {
      expect(typeof p.x).toBe('number');
      expect(p.power).toBeGreaterThanOrEqual(0);
      expect(p.power).toBeLessThanOrEqual(1);
      expect(p.heartrate).toBeGreaterThanOrEqual(0);
      expect(p.heartrate).toBeLessThanOrEqual(1);
    });
  });

  it('appends a preview series when not already selected', () => {
    const configs = {
      power: powerConfig(),
      heartrate: heartRateConfig(),
    } as unknown as Record<ChartTypeId, ChartConfig>;
    const result = buildChartData(streams(), ['power'], configs, true, 'heartrate', 'distance');
    expect(result.seriesInfo).toHaveLength(2);
    const hr = result.seriesInfo.find((s) => s.id === 'heartrate');
    expect(hr?.isPreview).toBe(true);
  });

  it('skips the preview series when it is already in selectedCharts', () => {
    const configs = {
      power: powerConfig(),
      heartrate: heartRateConfig(),
    } as unknown as Record<ChartTypeId, ChartConfig>;
    const result = buildChartData(
      streams(),
      ['power', 'heartrate'],
      configs,
      true,
      'heartrate',
      'distance'
    );
    expect(result.seriesInfo).toHaveLength(2);
    // Neither should be flagged as preview (already selected)
    result.seriesInfo.forEach((s) => expect(s.isPreview).toBeFalsy());
  });

  it('switches x-axis between distance (km/mi) and time (seconds)', () => {
    const configs = { power: powerConfig() } as unknown as Record<ChartTypeId, ChartConfig>;
    const distanceResult = buildChartData(streams(), ['power'], configs, true, null, 'distance');
    const timeResult = buildChartData(streams(), ['power'], configs, true, null, 'time');
    expect(distanceResult.maxX).not.toBe(timeResult.maxX);
    // Time stream has values 0..90 seconds
    expect(timeResult.maxX).toBe(90);
  });

  it('converts distance to miles when isMetric is false', () => {
    const configs = { power: powerConfig() } as unknown as Record<ChartTypeId, ChartConfig>;
    const metric = buildChartData(streams(), ['power'], configs, true, null, 'distance');
    const imperial = buildChartData(streams(), ['power'], configs, false, null, 'distance');
    expect(imperial.maxX).toBeLessThan(metric.maxX);
    expect(imperial.maxX).toBeCloseTo(metric.maxX * 0.621371, 3);
  });
});

describe('computeAllAverages', () => {
  it('returns empty array when streams have no data for configured charts', () => {
    const configs = {
      power: powerConfig(),
    } as unknown as Record<ChartTypeId, ChartConfig>;
    const result = computeAllAverages(configs, streams({ watts: [] }), true);
    expect(result).toEqual([]);
  });

  it('computes arithmetic mean for standard metrics', () => {
    const configs = {
      power: powerConfig(),
    } as unknown as Record<ChartTypeId, ChartConfig>;
    const result = computeAllAverages(configs, streams(), true);
    expect(result).toHaveLength(1);
    // mean([100,120,150,180,200,210,220,205,180,160]) = 172.5 → rounds to "173"
    expect(result[0].value).toBe('173');
    expect(result[0].unit).toBe('W');
  });

  it('computes cumulative positive deltas for gain metrics (altitude)', () => {
    const configs = {
      altitude: altitudeConfig(),
    } as unknown as Record<ChartTypeId, ChartConfig>;
    const result = computeAllAverages(configs, streams(), true);
    // Deltas: +5, +7, +8, -5, +3, +7, +5, -2, +7 → sum of positives = 42
    expect(result[0].value).toBe('+42');
  });

  it('skips NaN and Infinity values', () => {
    const configs = {
      power: powerConfig(),
    } as unknown as Record<ChartTypeId, ChartConfig>;
    const result = computeAllAverages(
      configs,
      streams({ watts: [100, NaN, 200, Infinity, -Infinity] }),
      true
    );
    // Valid values: [100, 200] → mean 150
    expect(result[0].value).toBe('150');
  });

  it('applies imperial conversion when isMetric is false', () => {
    const configs = {
      altitude: altitudeConfig(),
    } as unknown as Record<ChartTypeId, ChartConfig>;
    const metric = computeAllAverages(configs, streams(), true);
    const imperial = computeAllAverages(configs, streams(), false);
    // Gain of 42m * 3.28084 ≈ 137.8 → rounds to +138
    expect(metric[0].value).toBe('+42');
    expect(imperial[0].value).toBe('+138');
    expect(metric[0].unit).toBe('m');
    expect(imperial[0].unit).toBe('ft');
  });

  it('provides maxValueWidth for chip width stability during scrubbing', () => {
    const configs = {
      power: powerConfig(),
    } as unknown as Record<ChartTypeId, ChartConfig>;
    const result = computeAllAverages(configs, streams(), true);
    // Max raw value is 220, so maxValueWidth is "220"
    expect(result[0].maxValueWidth).toBe('220');
  });
});

describe('computeIntervalBands', () => {
  const defaultSeriesInfo: SeriesInfo[] = [
    {
      id: 'power',
      config: powerConfig(),
      rawData: [100, 200, 300],
      color: '#FB923C',
      range: { min: 100, max: 300, range: 200 },
    },
  ];

  it('returns empty array when intervals is empty or chart data length is zero', () => {
    expect(
      computeIntervalBands([], 0, streams(), 'distance', true, false, 'Ride', defaultSeriesInfo)
    ).toEqual([]);
    expect(
      computeIntervalBands(
        undefined,
        5,
        streams(),
        'distance',
        true,
        false,
        'Ride',
        defaultSeriesInfo
      )
    ).toEqual([]);
  });

  it('assigns distinct colors to WORK/RECOVERY/WARMUP/COOLDOWN', () => {
    const intervals: ActivityInterval[] = [
      { type: 'WARMUP', start_index: 0, end_index: 2 } as ActivityInterval,
      { type: 'WORK', start_index: 2, end_index: 5, zone: 3 } as ActivityInterval,
      { type: 'RECOVERY', start_index: 5, end_index: 7 } as ActivityInterval,
      { type: 'COOLDOWN', start_index: 7, end_index: 9 } as ActivityInterval,
    ];
    const bands = computeIntervalBands(
      intervals,
      10,
      streams(),
      'distance',
      true,
      false,
      'Ride',
      defaultSeriesInfo
    );
    expect(bands).toHaveLength(4);
    expect(bands[0].bandColor).toBe('#22C55E'); // WARMUP green
    expect(bands[1].isWork).toBe(true);
    expect(bands[2].bandColor).toBe('#808080'); // RECOVERY gray
    expect(bands[3].bandColor).toBe('#8B5CF6'); // COOLDOWN purple
  });

  it('computes avgNormY only for WORK intervals with a primary series', () => {
    const intervals: ActivityInterval[] = [
      {
        type: 'WORK',
        start_index: 0,
        end_index: 2,
        zone: 2,
        average_watts: 200,
      } as ActivityInterval,
      { type: 'RECOVERY', start_index: 2, end_index: 4 } as ActivityInterval,
    ];
    const bands = computeIntervalBands(
      intervals,
      10,
      streams(),
      'distance',
      true,
      false,
      'Ride',
      defaultSeriesInfo
    );
    // WORK: (200 - 100) / 200 = 0.5
    expect(bands[0].avgNormY).toBeCloseTo(0.5, 3);
    expect(bands[1].avgNormY).toBeNull();
  });

  it('falls back to primary color when WORK interval has no zone', () => {
    const intervals: ActivityInterval[] = [
      { type: 'WORK', start_index: 0, end_index: 2 } as ActivityInterval,
    ];
    const bands = computeIntervalBands(
      intervals,
      10,
      streams(),
      'distance',
      true,
      false,
      'Ride',
      defaultSeriesInfo
    );
    expect(bands[0].isWork).toBe(true);
    expect(bands[0].bandColor).toBeDefined();
  });
});

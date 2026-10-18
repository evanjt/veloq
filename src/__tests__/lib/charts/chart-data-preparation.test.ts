/**
 * Tests for the activity stream lanes' data-prep helpers.
 * Pure functions, but we need to provide minimal chart-config mocks because
 * the helpers consume a config record keyed by ChartTypeId.
 */

import {
  buildChartData,
  computeAllAverages,
  computeIntervalBands,
} from '@/features/stats/lib/combinedPlotData';
import { type ChartConfig, type ChartTypeId } from '@/features/activity/lib/chartConfig';
import type { ActivityStreams, ActivityInterval } from '@/types';
import { minMaxBuckets } from '@/shared/charts/minMaxBuckets';
import { streamsFromArrays, type StreamArrays } from '@/features/activity/lib/streams';

function powerConfig(): ChartConfig {
  return {
    id: 'power',
    label: 'Power',
    stream: 'power',
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
    stream: 'heartrate',
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
    stream: 'elevation',
    unit: 'm',
    unitImperial: 'ft',
    streamKey: 'altitude',
    defaultMetric: 'gain',
    getStream: (s: ActivityStreams) => s.altitude ?? [],
    formatValue: (v: number) => Math.round(v).toString(),
    convertToImperial: (v: number) => v * 3.28084,
  } as unknown as ChartConfig;
}

function streams(overrides: StreamArrays = {}): ActivityStreams {
  return streamsFromArrays({
    time: Array.from({ length: 10 }, (_, i) => i * 10),
    distance: Array.from({ length: 10 }, (_, i) => i * 100),
    watts: [100, 120, 150, 180, 200, 210, 220, 205, 180, 160],
    heartrate: [120, 130, 140, 150, 155, 160, 162, 158, 150, 145],
    altitude: [100, 105, 112, 120, 115, 118, 125, 130, 128, 135],
    ...overrides,
  });
}

describe('why buildChartData has nothing to draw', () => {
  const configs = { power: powerConfig() } as Record<ChartTypeId, ChartConfig>;

  it('names a missing distance stream when the axis is distance and time exists', () => {
    const result = buildChartData(
      streams({ distance: [] }),
      ['power'],
      configs,
      true,
      'distance',
      300
    );
    expect(result.emptyCause).toBe('noDistance');
  });

  it('names an activity with no samples at all', () => {
    const result = buildChartData(
      streams({ time: [], distance: [] }),
      ['power'],
      configs,
      true,
      'time',
      300
    );
    expect(result.emptyCause).toBe('noSamples');
  });

  it('names chosen metrics the activity did not record', () => {
    const result = buildChartData(streams({ watts: [] }), ['power'], configs, true, 'time', 300);
    expect(result.emptyCause).toBe('noMetrics');
  });

  it('names nothing when there is a series to draw', () => {
    const result = buildChartData(streams(), ['power'], configs, true, 'distance', 300);
    expect(result.emptyCause).toBeNull();
  });
});

describe('buildChartData', () => {
  it('returns empty result when x-source is empty', () => {
    const result = buildChartData(
      streams({ time: [], distance: [] }),
      ['power'],
      { power: powerConfig() } as Record<ChartTypeId, ChartConfig>,
      true,
      'distance',
      300
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
      'distance',
      300
    );
    expect(result.chartData).toEqual([]);
    expect(result.seriesInfo).toEqual([]);
  });

  it('builds chart data for a single series with distance axis', () => {
    const configs = { power: powerConfig() } as unknown as Record<ChartTypeId, ChartConfig>;
    const result = buildChartData(streams(), ['power'], configs, true, 'distance', 300);
    expect(result.chartData.length).toBeGreaterThan(0);
    expect(result.seriesInfo).toHaveLength(1);
    expect(result.seriesInfo[0].id).toBe('power');
    // The lane runs from the lowest sample to the highest, in watts
    expect(result.seriesInfo[0].domain).toEqual([100, 220]);
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
      'distance',
      300
    );
    expect(result.seriesInfo).toHaveLength(2);
    // Each point has an x and each series in its own units, inside its own lane
    const [power, heartrate] = result.seriesInfo;
    result.chartData.forEach((p) => {
      expect(typeof p.x).toBe('number');
      expect(p.power).toBeGreaterThanOrEqual(power.domain[0]);
      expect(p.power).toBeLessThanOrEqual(power.domain[1]);
      expect(p.heartrate).toBeGreaterThanOrEqual(heartrate.domain[0]);
      expect(p.heartrate).toBeLessThanOrEqual(heartrate.domain[1]);
    });
  });

  it('switches x-axis between distance (km/mi) and time (seconds)', () => {
    const configs = { power: powerConfig() } as unknown as Record<ChartTypeId, ChartConfig>;
    const distanceResult = buildChartData(streams(), ['power'], configs, true, 'distance', 300);
    const timeResult = buildChartData(streams(), ['power'], configs, true, 'time', 300);
    expect(distanceResult.maxX).not.toBe(timeResult.maxX);
    // Time stream has values 0..90 seconds
    expect(timeResult.maxX).toBe(90);
  });

  it('converts distance to miles when isMetric is false', () => {
    const configs = { power: powerConfig() } as unknown as Record<ChartTypeId, ChartConfig>;
    const metric = buildChartData(streams(), ['power'], configs, true, 'distance', 300);
    const imperial = buildChartData(streams(), ['power'], configs, false, 'distance', 300);
    expect(imperial.maxX).toBeLessThan(metric.maxX);
    expect(imperial.maxX).toBeCloseTo(metric.maxX * 0.621371, 3);
  });
});

describe('computeAllAverages', () => {
  it('returns empty array when streams have no data for configured charts', () => {
    const configs = {
      power: powerConfig(),
    } as unknown as Record<ChartTypeId, ChartConfig>;
    const result = computeAllAverages(configs, streams({ watts: [] }), true, 0);
    expect(result).toEqual([]);
  });

  it('computes arithmetic mean for standard metrics', () => {
    const configs = {
      power: powerConfig(),
    } as unknown as Record<ChartTypeId, ChartConfig>;
    const result = computeAllAverages(configs, streams(), true, 0);
    expect(result).toHaveLength(1);
    // mean([100,120,150,180,200,210,220,205,180,160]) = 172.5 → rounds to "173"
    expect(result[0].value).toBe('173');
    expect(result[0].unit).toBe('W');
  });

  it('uses the activity gain instead of noisy altitude steps', () => {
    const configs = {
      altitude: altitudeConfig(),
    } as unknown as Record<ChartTypeId, ChartConfig>;
    const result = computeAllAverages(
      configs,
      streams({ altitude: [100, 200, 123, 245] }),
      true,
      145
    );
    expect(result[0].value).toBe('+145');
  });

  it('skips NaN and Infinity values', () => {
    const configs = {
      power: powerConfig(),
    } as unknown as Record<ChartTypeId, ChartConfig>;
    const result = computeAllAverages(
      configs,
      streams({ watts: [100, NaN, 200, Infinity, -Infinity] }),
      true,
      0
    );
    // Valid values: [100, 200] → mean 150
    expect(result[0].value).toBe('150');
  });

  it('applies imperial conversion when isMetric is false', () => {
    const configs = {
      altitude: altitudeConfig(),
    } as unknown as Record<ChartTypeId, ChartConfig>;
    const metric = computeAllAverages(configs, streams(), true, 42);
    const imperial = computeAllAverages(configs, streams(), false, 42);
    expect(metric[0].value).toBe('+42');
    expect(imperial[0].value).toBe('+138');
    expect(metric[0].unit).toBe('m');
    expect(imperial[0].unit).toBe('ft');
  });

  it('provides maxValueWidth for chip width stability during scrubbing', () => {
    const configs = {
      power: powerConfig(),
    } as unknown as Record<ChartTypeId, ChartConfig>;
    const result = computeAllAverages(configs, streams(), true, 0);
    // Max raw value is 220, so maxValueWidth is "220"
    expect(result[0].maxValueWidth).toBe('220');
  });
});

describe('computeIntervalBands', () => {
  it('returns empty array when intervals is empty or chart data length is zero', () => {
    expect(computeIntervalBands([], 0, streams(), 'distance', true, 'Ride')).toEqual([]);
    expect(computeIntervalBands(undefined, 5, streams(), 'distance', true, 'Ride')).toEqual([]);
  });

  it('assigns a distinct colour token to WORK/RECOVERY/WARMUP/COOLDOWN', () => {
    const intervals: ActivityInterval[] = [
      { type: 'WARMUP', start_index: 0, end_index: 2 } as ActivityInterval,
      { type: 'WORK', start_index: 2, end_index: 5, zone: 3 } as ActivityInterval,
      { type: 'RECOVERY', start_index: 5, end_index: 7 } as ActivityInterval,
      { type: 'COOLDOWN', start_index: 7, end_index: 9 } as ActivityInterval,
    ];
    const bands = computeIntervalBands(intervals, 10, streams(), 'distance', true, 'Ride');
    expect(bands).toHaveLength(4);
    expect(bands[0].bandColour).toEqual({ kind: 'role', role: 'warmup' });
    expect(bands[1].bandColour).toEqual({ kind: 'zone', scale: 'power', zone: 3 });
    expect(bands[1].isWork).toBe(true);
    expect(bands[2].bandColour).toEqual({ kind: 'role', role: 'recovery' });
    expect(bands[3].bandColour).toEqual({ kind: 'role', role: 'cooldown' });
  });

  it('carries the average power and heart rate of WORK intervals only', () => {
    const intervals: ActivityInterval[] = [
      {
        type: 'WORK',
        start_index: 0,
        end_index: 2,
        zone: 2,
        average_watts: 200,
        average_heartrate: 151,
      } as ActivityInterval,
      { type: 'RECOVERY', start_index: 2, end_index: 4 } as ActivityInterval,
    ];
    const bands = computeIntervalBands(intervals, 10, streams(), 'distance', true, 'Ride');
    expect(bands[0].averages).toEqual({ power: 200, heartrate: 151 });
    expect(bands[1].averages).toEqual({ power: null, heartrate: null });
  });

  it('falls back to the work role when a WORK interval has no zone', () => {
    const intervals: ActivityInterval[] = [
      { type: 'WORK', start_index: 0, end_index: 2 } as ActivityInterval,
    ];
    const bands = computeIntervalBands(intervals, 10, streams(), 'distance', true, 'Ride');
    expect(bands[0].isWork).toBe(true);
    expect(bands[0].bandColour).toEqual({ kind: 'role', role: 'work' });
  });
});

/**
 * Golden baseline for the shape `buildChartData` hands to the chart layer.
 *
 * The fixture is a 900-sample ride, long enough to exercise thinning and
 * varied enough that a normalisation or colour-resolution change moves the
 * numbers. Regenerate by deleting the snapshot file and re-running.
 */
describe('buildChartData golden', () => {
  // Far narrower than the ride is long, so every pixel thins several samples.
  const GOLDEN_WIDTH = 60;

  function rideStreams(): ActivityStreams {
    const samples = 900;
    const time: number[] = [];
    const distance: number[] = [];
    const watts: number[] = [];
    const heartrate: number[] = [];
    const altitude: number[] = [];

    for (let i = 0; i < samples; i++) {
      const t = i;
      const climb = Math.sin(i / 140) * 60;
      const surge = Math.sin(i / 23) * 45;
      time.push(t);
      distance.push(Math.round(i * 7.8 * 100) / 100);
      watts.push(Math.round(195 + surge + climb * 0.8));
      heartrate.push(Math.round(142 + surge * 0.28 + climb * 0.2));
      altitude.push(Math.round((540 + climb + Math.sin(i / 47) * 8) * 10) / 10);
    }

    return streamsFromArrays({ time, distance, watts, heartrate, altitude });
  }

  function goldenConfigs(): Record<ChartTypeId, ChartConfig> {
    return {
      power: powerConfig(),
      heartrate: heartRateConfig(),
      elevation: altitudeConfig(),
    } as unknown as Record<ChartTypeId, ChartConfig>;
  }

  // The config objects carry functions, which serialise as [Function] and say
  // nothing. Project the series down to the fields the chart layer reads, and
  // flatten each point to one line so a diff stays readable.
  function summarise(result: ReturnType<typeof buildChartData>) {
    return {
      maxX: result.maxX,
      pointCount: result.chartData.length,
      indexMap: result.indexMap.join(','),
      chartData: result.chartData.map((point) =>
        Object.entries(point)
          .map(([key, value]) => `${key}=${value.toFixed(6)}`)
          .join(' ')
      ),
      seriesInfo: result.seriesInfo.map((s) => ({
        id: s.id,
        stream: s.config.stream,
        domain: s.domain,
        kind: s.kind,
        rawDataLength: s.rawData.length,
      })),
    };
  }

  it('matches the golden for a metric distance axis', () => {
    const result = buildChartData(
      rideStreams(),
      ['power', 'heartrate', 'elevation'],
      goldenConfigs(),
      true,
      'distance',
      GOLDEN_WIDTH
    );

    expect(summarise(result)).toMatchSnapshot();
  });

  it('matches the golden for an imperial time axis', () => {
    const result = buildChartData(
      rideStreams(),
      ['power', 'heartrate', 'elevation'],
      goldenConfigs(),
      false,
      'time',
      GOLDEN_WIDTH
    );

    expect(summarise(result)).toMatchSnapshot();
  });
});

/**
 * Scenario: an hour of flat power at one sample a second with a 20 second
 * sprint in it, drawn 300 pixels wide.
 * Expected behaviour: the sprint's peak is drawn, and every drawn point reads
 * back the raw sample it came from through `indexMap`.
 */
describe('thinning keeps a short spike', () => {
  const SAMPLES = 5000;
  const SPIKE_START = 2503;
  const SPIKE_LENGTH = 20;
  const SPIKE_PEAK = 900;

  const time = Array.from({ length: SAMPLES }, (_, i) => i);
  const distance = Array.from({ length: SAMPLES }, (_, i) => i * 8);
  const watts = Array.from({ length: SAMPLES }, (_, i) =>
    i >= SPIKE_START && i < SPIKE_START + SPIKE_LENGTH
      ? 600 + (i === SPIKE_START + 9 ? SPIKE_PEAK - 600 : 0)
      : 200
  );

  function sprintStreams(): ActivityStreams {
    return streamsFromArrays({ time, distance, watts });
  }

  const configs = { power: powerConfig() } as unknown as Record<ChartTypeId, ChartConfig>;

  it('draws the peak of a 20 sample sprint in a 5,000 sample ride', () => {
    const result = buildChartData(sprintStreams(), ['power'], configs, true, 'time', 300);
    const drawnPeak = Math.max(...result.chartData.map((p) => p.power));
    expect(drawnPeak).toBe(SPIKE_PEAK);
    const peakIndex = result.chartData.findIndex((p) => p.power === SPIKE_PEAK);
    expect(watts[result.indexMap[peakIndex]]).toBe(SPIKE_PEAK);
  });

  it('keeps no more than five points per pixel and fewer than the input', () => {
    const result = buildChartData(sprintStreams(), ['power'], configs, true, 'distance', 300);
    expect(result.chartData.length).toBeLessThanOrEqual(5 * 300);
    expect(result.chartData.length).toBeLessThan(SAMPLES);
    expect(result.indexMap).toHaveLength(result.chartData.length);
  });

  it('maps every drawn point to the raw sample with its value and x', () => {
    const result = buildChartData(sprintStreams(), ['power'], configs, true, 'time', 300);
    result.chartData.forEach((point, i) => {
      const raw = result.indexMap[i];
      expect(point.x).toBe(time[raw]);
      expect(point.power).toBe(watts[raw]);
    });
    expect(result.indexMap).toEqual([...result.indexMap].sort((a, b) => a - b));
  });

  it('keeps the dip of a second series in the same pass', () => {
    const heartrate = Array.from({ length: SAMPLES }, (_, i) => (i === 4321 ? 60 : 140));
    const streams = streamsFromArrays({ time, distance, watts, heartrate });
    const both = { power: powerConfig(), heartrate: heartRateConfig() } as unknown as Record<
      ChartTypeId,
      ChartConfig
    >;
    const result = buildChartData(streams, ['power', 'heartrate'], both, true, 'time', 300);
    expect(result.indexMap).toContain(4321);
    expect(Math.max(...result.chartData.map((p) => p.power))).toBe(SPIKE_PEAK);
  });

  it('keeps a run of missing samples as a break in the line', () => {
    const gappy = watts.map((v, i) => (i >= 1000 && i < 1100 ? NaN : v));
    const streams = streamsFromArrays({ time, watts: gappy });
    const result = buildChartData(streams, ['power'], configs, true, 'time', 300);
    const gapIndices = result.indexMap.filter((_, i) => Number.isNaN(result.chartData[i].power));
    expect(gapIndices.length).toBeGreaterThan(0);
    expect(gapIndices.every((raw) => raw >= 1000 && raw < 1100)).toBe(true);
  });

  it('returns a series shorter than the pixel width whole', () => {
    const result = buildChartData(streams(), ['power'], configs, true, 'time', 300);
    expect(result.indexMap).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });
});

describe('minMaxBuckets', () => {
  it('keeps first, lowest, highest and last of each span in order', () => {
    const x = [0, 1, 2, 3, 4, 5, 6, 7];
    const values = [5, 9, 1, 5, 5, 0, 7, 5];
    expect(minMaxBuckets(x, values, 2)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(minMaxBuckets(x, [5, 5, 9, 5, 1, 5, 5, 5], 1)).toEqual([0, 2, 4, 7]);
  });

  it('keeps one missing sample per span so the line breaks', () => {
    const x = Array.from({ length: 12 }, (_, i) => i);
    const values = [1, 1, NaN, NaN, NaN, 1, 1, 1, 1, 1, 1, 1];
    const kept = minMaxBuckets(x, values, 2);
    expect(kept.filter((i) => Number.isNaN(values[i]))).toEqual([2]);
  });

  it('returns nothing for an empty stream and the whole of a short one', () => {
    expect(minMaxBuckets([], [], 300)).toEqual([]);
    expect(minMaxBuckets([0, 1, 2], [3, 4, 5], 3)).toEqual([0, 1, 2]);
  });

  it('puts every sample in one span when x does not move', () => {
    const x = [4, 4, 4, 4, 4, 4];
    expect(minMaxBuckets(x, [3, 8, 2, 3, 3, 6], 2)).toEqual([0, 1, 2, 5]);
  });

  it('carries a sample with a non-finite x into the span before it', () => {
    const x = [0, 1, NaN, 3, 4, 5];
    expect(minMaxBuckets(x, [1, 1, 9, 1, 1, 1], 1)).toEqual([0, 2, 5]);
  });
});

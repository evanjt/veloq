/**
 * Scenario: a heart-rate strap or speed sensor drops out, so the stream carries
 * nulls, an imperial swimmer reads pace per 100 yd, and a run stops at lights.
 * Expected behaviour: the scrub chip reads '-' over a missing sample for every
 * metric, pace included, rather than NaN or a 0:00 pace nobody ran, and swim
 * pace per 100 yd agrees with `formatSwimPace` for the same speed. The idle
 * chip formats as the scrub does, and its pace is the pace of the mean moving
 * speed, so a stop neither reads as a faster pace nor stretches the axis.
 */

import {
  CHART_CONFIGS,
  chartConfigsFor,
  type ChartConfig,
  type ChartTypeId,
} from '@/features/activity/lib/chartConfig';
import { parseStreams } from '@/features/activity/lib/streams';
import {
  buildChartData,
  computeAllAverages,
  formatScrubValue,
  seriesAverage,
} from '@/features/stats/lib/combinedPlotData';
import { paceMinutesFromSpeed } from '@/shared/math/kinematics';
import {
  formatPaceCompact,
  formatSpeed,
  formatSwimPace,
  formatTemperature,
  YARDS_100_IN_METRES,
} from '@/shared/format/format';
import { stoppedSpeedMs } from '@/shared/recording';
import type { RawStreamItem } from '@/types';

function streamsWithGap() {
  return parseStreams([
    { type: 'heartrate', data: [150, null, 152] },
    { type: 'watts', data: [200, null, 210] },
    { type: 'cadence', data: [90, null, 91] },
    { type: 'velocity_smooth', data: [3.0, null, 0] },
    { type: 'ga_velocity', data: [3.1, null, 3.2] },
  ] as unknown as RawStreamItem[]);
}

function scrub(id: keyof typeof CHART_CONFIGS, index: number, isMetric = true) {
  const config = CHART_CONFIGS[id];
  const raw = config.getStream?.(streamsWithGap()) ?? [];
  return formatScrubValue(config, raw[index], isMetric);
}

describe('the scrub chip over a missing sample', () => {
  it.each(['heartrate', 'power', 'cadence', 'speed', 'pace', 'gap'] as const)(
    'reads - for %s at a null sample',
    (id) => {
      expect(scrub(id, 1)).toBe('-');
      expect(scrub(id, 1, false)).toBe('-');
    }
  );

  it('still formats the finite neighbours', () => {
    expect(scrub('heartrate', 0)).toBe('150');
    expect(scrub('power', 2)).toBe('210');
    expect(scrub('speed', 0)).toBe('10.8');
    expect(scrub('pace', 0)).toBe('5:33');
  });

  it('keeps a stop at 0 and a dropout at NaN in the pace stream', () => {
    const pace = CHART_CONFIGS.pace.getStream?.(streamsWithGap()) ?? [];
    expect(pace[2]).toBe(0);
    expect(Number.isNaN(pace[1])).toBe(true);
  });

  it('reads - over a stop and a crawl, for pace, GAP and swim pace', () => {
    const streams = parseStreams([
      { type: 'velocity_smooth', data: [3, 3, 0, 0.05] },
      { type: 'ga_velocity', data: [3, 3, 0, 0.05] },
    ] as unknown as RawStreamItem[]);
    for (const isMetric of [true, false]) {
      for (const id of ['pace', 'gap'] as const) {
        const config = CHART_CONFIGS[id];
        const raw = config.getStream?.(streams) ?? [];
        expect(formatScrubValue(config, raw[2], isMetric)).toBe('-');
        expect(formatScrubValue(config, raw[3], isMetric)).toBe('-');
        expect(formatScrubValue(config, raw[0], isMetric)).not.toBe('-');
      }
      const swim = chartConfigsFor('Swim').pace;
      const raw = swim.getStream?.({ velocity_smooth: [1, 1, 0, 0.05] }) ?? [];
      expect(formatScrubValue(swim, raw[2], isMetric)).toBe('-');
      expect(formatScrubValue(swim, raw[3], isMetric)).toBe('-');
      expect(formatScrubValue(swim, raw[0], isMetric)).not.toBe('-');
    }
  });

  it('reads a stop as 0.0 on the speed series', () => {
    expect(scrub('speed', 2)).toBe('0.0');
  });

  it('treats a sample at the stop threshold as moving and one just under as a stop', () => {
    const at = 0.5 / 3.6;
    const pace = CHART_CONFIGS.pace.getStream?.({ velocity_smooth: [at, at * 0.99] }) ?? [];
    expect(formatScrubValue(CHART_CONFIGS.pace, pace[0], true)).not.toBe('-');
    expect(formatScrubValue(CHART_CONFIGS.pace, pace[1], true)).toBe('-');
  });

  it('draws a stopped pace sample as NaN and leaves the speed point finite', () => {
    const streams = { distance: [0, 3, 6, 9], velocity_smooth: [3, 3, 0, 0] };
    const { chartData } = buildChartData(
      streams as never,
      ['pace', 'speed'],
      CHART_CONFIGS,
      true,
      null,
      'distance'
    );
    expect(chartData[0].pace).toBeCloseTo(chartData[1].pace);
    expect(Number.isNaN(chartData[2].pace)).toBe(true);
    expect(Number.isFinite(chartData[2].speed)).toBe(true);
  });

  it('reads - for an index past the end of the stream', () => {
    expect(formatScrubValue(CHART_CONFIGS.heartrate, undefined, true)).toBe('-');
  });
});

describe('swim pace per 100 yd', () => {
  const swim = chartConfigsFor('Swim').pace;

  it('converts 2:00 per 100 m to 1:50 per 100 yd', () => {
    expect(swim.convertToImperial?.(2.0)).toBeCloseTo(1.8288, 6);
    expect(formatScrubValue(swim, 2.0, false)).toBe('1:50');
  });

  it('agrees with formatSwimPace for the same speed', () => {
    for (const speed of [0.6, 0.8333, 1.0, 1.25, 1.6]) {
      const perHundredMetres = swim.getStream?.({ velocity_smooth: [speed] })?.[0] ?? NaN;
      expect(formatScrubValue(swim, perHundredMetres, false)).toBe(formatSwimPace(speed, false));
      expect(formatScrubValue(swim, perHundredMetres, true)).toBe(formatSwimPace(speed, true));
    }
  });

  it('shares one yards constant with formatSwimPace', () => {
    expect(YARDS_100_IN_METRES).toBe(91.44);
    expect(formatSwimPace(YARDS_100_IN_METRES / 110, false)).toBe('1:50');
  });

  it('labels the swim pace per 100 and leaves other sports on per km', () => {
    expect(swim.unit).toBe('/100m');
    expect(swim.unitImperial).toBe('/100yd');
    expect(chartConfigsFor('Run').pace.unit).toBe(CHART_CONFIGS.pace.unit);
  });
});

describe('the chart converts units as the shared formatters do', () => {
  it.each([1.2, 2.5, 3.0, 4.4, 6.1])('agrees at %d m/s in both unit systems', (speed) => {
    const streams = { velocity_smooth: [speed] };
    for (const isMetric of [true, false]) {
      const kph = CHART_CONFIGS.speed.getStream?.(streams)?.[0];
      expect(
        `${formatScrubValue(CHART_CONFIGS.speed, kph, isMetric)} ${isMetric ? 'km/h' : 'mph'}`
      ).toBe(formatSpeed(speed, isMetric));
      const pace = CHART_CONFIGS.pace.getStream?.(streams)?.[0];
      expect(formatScrubValue(CHART_CONFIGS.pace, pace, isMetric)).toBe(
        formatPaceCompact(speed, isMetric)
      );
    }
  });

  it('reads temperature in Fahrenheit as formatTemperature does', () => {
    for (const celsius of [-5, 0, 12.4, 30]) {
      expect(`${formatScrubValue(CHART_CONFIGS.temp, celsius, false)}°F`).toBe(
        formatTemperature(celsius, false)
      );
    }
  });
});

function idleChip(
  configs: Record<ChartTypeId, ChartConfig>,
  streams: Parameters<typeof computeAllAverages>[1],
  id: ChartTypeId,
  isMetric = true
) {
  return computeAllAverages(configs, streams, isMetric).find((chip) => chip.id === id);
}

describe('the idle chip formats as the scrub does', () => {
  it('agrees with a scrub of the same value in both unit systems', () => {
    const streams = { heartrate: [150, 150], altitude: [100, 100], temp: [12.4, 12.4] };
    for (const isMetric of [true, false]) {
      for (const [id, value] of [
        ['heartrate', 150],
        ['temp', 12.4],
      ] as const) {
        const chip = idleChip(CHART_CONFIGS, streams, id, isMetric);
        const scrubbed = formatScrubValue(CHART_CONFIGS[id], value, isMetric);
        expect(chip?.value).toBe(scrubbed);
        expect(chip?.maxValueWidth).toBe(scrubbed);
      }
    }
  });

  it('reads the absent mark where the formatter gives nothing, as the scrub does', () => {
    const blank = { ...CHART_CONFIGS.heartrate, formatValue: () => '' };
    const configs = { heartrate: blank } as unknown as Record<ChartTypeId, ChartConfig>;
    const chip = idleChip(configs, { heartrate: [150, 150] }, 'heartrate');
    expect(formatScrubValue(blank, 150, true)).toBe('-');
    expect(chip?.value).toBe('-');
    expect(chip?.maxValueWidth).toBe('-');
  });

  it('keeps the + on elevation gain, converted for an imperial athlete', () => {
    const streams = { altitude: [100, 110, 105, 120] };
    expect(idleChip(CHART_CONFIGS, streams, 'elevation')?.value).toBe('+25');
    expect(idleChip(CHART_CONFIGS, streams, 'elevation', false)?.value).toBe(
      `+${formatScrubValue(CHART_CONFIGS.elevation, 25, false)}`
    );
    expect(idleChip(CHART_CONFIGS, streams, 'elevation')?.maxValueWidth).toBe('+25');
  });
});

describe('the idle pace chip over a run with stops', () => {
  const stopped = { velocity_smooth: [3, 3, 0, 0] };
  const crawling = { velocity_smooth: [3, 3, 0.05, 0.05] };

  it.each([
    ['stopped', stopped],
    ['crawling', crawling],
  ])('reads the moving pace and speed when %s', (_name, streams) => {
    for (const isMetric of [true, false]) {
      expect(idleChip(CHART_CONFIGS, streams, 'pace', isMetric)?.value).toBe(
        formatPaceCompact(3, isMetric)
      );
      expect(
        `${idleChip(CHART_CONFIGS, streams, 'speed', isMetric)?.value} ${isMetric ? 'km/h' : 'mph'}`
      ).toBe(formatSpeed(3, isMetric));
    }
  });

  it('is the pace of the mean speed, not the mean of the paces', () => {
    const streams = { velocity_smooth: [2, 4] };
    expect(idleChip(CHART_CONFIGS, streams, 'pace')?.value).toBe(formatPaceCompact(3, true));
  });

  it('sizes the chip for the slowest moving pace, not the crawl', () => {
    expect(idleChip(CHART_CONFIGS, crawling, 'pace')?.maxValueWidth).toBe('5:33');
  });

  it('reads the moving grade adjusted pace', () => {
    const streams = parseStreams([
      { type: 'ga_velocity', data: [3, 3, 0, 0.05] },
    ] as unknown as RawStreamItem[]);
    expect(idleChip(CHART_CONFIGS, streams, 'gap')?.value).toBe('5:33');
  });

  it('reads a swim pace per 100 of the moving speed', () => {
    const swim = chartConfigsFor('Swim');
    const streams = { velocity_smooth: [1, 1, 0, 0.05] };
    for (const isMetric of [true, false]) {
      expect(idleChip(swim, streams, 'pace', isMetric)?.value).toBe(formatSwimPace(1, isMetric));
    }
  });

  it('reads the absent mark for a pace with no moving sample', () => {
    const chip = idleChip(CHART_CONFIGS, { velocity_smooth: [0, 0.05] }, 'pace');
    expect(chip?.value).toBe('-');
  });

  it('draws the average line at the moving pace', () => {
    const pace = CHART_CONFIGS.pace.getStream?.(stopped) ?? [];
    expect(seriesAverage(CHART_CONFIGS.pace, pace)).toBeCloseTo(paceMinutesFromSpeed(3), 9);
    expect(seriesAverage(CHART_CONFIGS.heartrate, [140, NaN, 160])).toBe(150);
    expect(seriesAverage(CHART_CONFIGS.pace, [])).toBeNull();
  });

  it('leaves stops and crawls out of the pace axis', () => {
    const streams = { distance: [0, 3, 6, 8.5, 8.6], velocity_smooth: [3, 3, 2.5, 0.05, 0] };
    const { seriesInfo } = buildChartData(streams, ['pace'], CHART_CONFIGS, true, null, 'distance');
    expect(seriesInfo[0].range.min).toBeCloseTo(paceMinutesFromSpeed(3), 9);
    expect(seriesInfo[0].range.max).toBeCloseTo(paceMinutesFromSpeed(2.5), 9);
  });
});

describe('the idle chips drop stops by the sport the activity was', () => {
  const chip = (type: Parameters<typeof chartConfigsFor>[0], id: ChartTypeId, v: number[]) =>
    computeAllAverages(chartConfigsFor(type), { velocity_smooth: v }, true).find((m) => m.id === id)
      ?.value;

  it('leaves a ride standstill drift of 1.5 km/h out of the speed chip', () => {
    expect(chip('Ride', 'speed', [8, 8, 0.42, 0.42])).toBe('28.8');
  });

  it('leaves a run drift of 0.9 km/h out of the pace chip', () => {
    expect(chip('Run', 'pace', [3, 3, 0.25, 0.25])).toBe('5:33');
  });

  it('keeps a walk at 0.72 km/h, above walking stop speed', () => {
    expect(chip('Walk', 'speed', [1.2, 1.2, 0.2, 0.2])).toBe('2.5');
  });

  it('keeps an open-water swim at 3:20 per 100 m rather than reading a dash', () => {
    expect(chip('Swim', 'pace', [0.5, 0.5, 0, 0])).toBe('3:20');
  });

  it('gives each sport family its recorder default and every other sport the lowest', () => {
    expect(stoppedSpeedMs('Ride')).toBeCloseTo(2 / 3.6, 9);
    expect(stoppedSpeedMs('Run')).toBeCloseTo(1 / 3.6, 9);
    expect(stoppedSpeedMs('Walk')).toBeCloseTo(0.5 / 3.6, 9);
    for (const other of ['Swim', 'Kayaking', 'NotASport']) {
      expect(stoppedSpeedMs(other as never)).toBeCloseTo(0.5 / 3.6, 9);
    }
  });

  it('keeps the config identity stable per sport', () => {
    expect(chartConfigsFor('Ride')).toBe(chartConfigsFor('Ride'));
  });
});

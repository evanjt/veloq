/**
 * Pure data-prep helpers for the activity stream lanes.
 *
 * Thinning, each lane's extent, averages, the lane stack and the interval
 * band math, out of `ActivityStreams.tsx` so the component only draws. No
 * React and no Skia, so these are tested in isolation.
 */

import { IntervalKind } from 'veloqrs';

import type { ChartConfig, ChartTypeId } from '@/features/activity';
import { measuresPower } from '@/shared/activity/activityUtils';
import type { ActivityStreams, ActivityInterval, ActivityType } from '@/types';
import { finiteExtent, type Extent } from '@/shared/charts/extent';
import { minMaxBuckets } from '@/shared/charts/minMaxBuckets';
import { KM_TO_MI, MPS_TO_KPH } from '@/shared/format/format';
import { paceMinutesFromSpeed, speedFromPaceMinutes } from '@/shared/math/kinematics';
import { ABSENT } from '@/shared/format/absent';

/**
 * One input series derived from a chart config + streams. The colour is not
 * copied out of the config: the chart layer already holds the config and
 * resolves the colour itself.
 */
export interface DataSeries {
  id: ChartTypeId;
  config: ChartConfig;
  rawData: ArrayLike<number>;
}

/**
 * One sample as the chart shows it, in the athlete's units. A missing sample
 * reads '-', the chart's absent mark, rather than NaN.
 */
export function formatScrubValue(
  config: ChartConfig,
  raw: number | undefined,
  isMetric: boolean
): string {
  if (raw == null || !Number.isFinite(raw)) return ABSENT;
  if (isStoppedSample(config, raw)) return ABSENT;
  const value = !isMetric && config.convertToImperial ? config.convertToImperial(raw) : raw;
  const formatted = config.formatValue
    ? config.formatValue(value, isMetric)
    : Math.round(value).toString();
  return formatted || ABSENT;
}

/** The unit a series' values are printed in, under the athlete's unit setting. */
export function seriesUnit(config: ChartConfig, isMetric: boolean): string {
  return isMetric ? config.unit || '' : config.unitImperial || config.unit || '';
}

type Motion = NonNullable<ChartConfig['motion']>;

/** A sample of a speed or pace series in m/s. */
function sampleSpeed(motion: Motion, value: number): number {
  return motion.kind === 'pace'
    ? speedFromPaceMinutes(value, motion.perMetres)
    : value / MPS_TO_KPH;
}

/**
 * A finite sample of a pace series at or under the stop threshold. A stop has
 * no pace, so the scrub reads it as absent and the line leaves it out. A speed
 * series keeps its stops, where 0.0 km/h is a real reading.
 */
function isStoppedSample(config: ChartConfig, raw: number): boolean {
  const motion = config.motion;
  return (
    motion?.kind === 'pace' &&
    Number.isFinite(raw) &&
    sampleSpeed(motion, raw) < motion.stoppedBelowMs
  );
}

/** The finite samples of a series, less its stops when it is a speed or pace. */
function movingSamples(config: ChartConfig, rawData: ArrayLike<number>): number[] {
  const motion = config.motion;
  const kept: number[] = [];
  for (let i = 0; i < rawData.length; i++) {
    const v = rawData[i];
    if (v === undefined || !Number.isFinite(v)) continue;
    if (motion && sampleSpeed(motion, v) < motion.stoppedBelowMs) continue;
    kept.push(v);
  }
  return kept;
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/**
 * A series' average in its own units, or null with nothing to average. A
 * speed averages over moving samples, and a pace is the pace of that mean
 * speed rather than the mean of the paces, which a stop would pull towards 0.
 */
export function seriesAverage(config: ChartConfig, rawData: ArrayLike<number>): number | null {
  const samples = movingSamples(config, rawData);
  if (samples.length === 0) return null;
  const motion = config.motion;
  if (motion?.kind !== 'pace') return mean(samples);
  return paceMinutesFromSpeed(mean(samples.map((v) => sampleSpeed(motion, v))), motion.perMetres);
}

/**
 * A series' y extent. A pace leaves its stops out, which read as pace 0 and a
 * crawl as hours per kilometre, either of which would flatten the moving pace.
 */
export function seriesExtent(config: ChartConfig, rawData: ArrayLike<number>): Extent | null {
  return finiteExtent(config.motion?.kind === 'pace' ? movingSamples(config, rawData) : rawData);
}

/** How a lane draws its stream: a line, a grey context area, or a fill either side of zero. */
export type LaneKind = 'line' | 'context' | 'signed';

/** A drawn stream with the y extent of its own lane, in its own units. */
export interface SeriesInfo extends DataSeries {
  /** The lane's [bottom, top] in the stream's units. No two streams share one. */
  domain: [number, number];
  kind: LaneKind;
}

/** A lane's plot height when the page scrolls, and its title above it. */
export const LANE_PLOT_HEIGHT = 56;
export const LANE_TITLE_HEIGHT = 18;
/** The distance or time axis under the last lane. */
export const LANE_AXIS_HEIGHT = 20;
/** No lane is squeezed below its two tick labels when a fixed height is shared out. */
const LANE_MIN_PLOT_HEIGHT = 32;

/**
 * The height of each lane's plot and of the whole stack. With no height given
 * every lane is the lane height and the stack grows, since the page scrolls;
 * given one, as the full screen view gives, the lanes share what the titles
 * and the axis leave. `titleHeight` is the title as the text size draws it.
 */
export function laneStack(
  count: number,
  height?: number,
  titleHeight: number = LANE_TITLE_HEIGHT
): { plotHeight: number; height: number } {
  const lanes = Math.max(1, count);
  const plotHeight =
    height === undefined
      ? LANE_PLOT_HEIGHT
      : Math.max(
          LANE_MIN_PLOT_HEIGHT,
          Math.floor((height - LANE_AXIS_HEIGHT - lanes * titleHeight) / lanes)
        );
  return { plotHeight, height: lanes * (titleHeight + plotHeight) + LANE_AXIS_HEIGHT };
}

function laneKind(config: ChartConfig): LaneKind {
  return config.lane ?? 'line';
}

/**
 * A lane's [bottom, top] from its stream's extent. A quantity measured from
 * zero starts at zero, grade spans zero either side, and every other stream
 * fills its lane from its lowest sample to its highest. A flat stream is given
 * a unit either side, so its line sits mid-lane rather than on the floor.
 */
export function laneDomain(config: ChartConfig, extent: Extent | null): [number, number] {
  if (!extent) return [0, 1];
  let low = extent.min;
  let high = extent.max;
  if (config.zeroBased || config.lane === 'signed') low = Math.min(low, 0);
  if (config.lane === 'signed') high = Math.max(high, 0);
  if (high === low) return low === 0 ? [0, 1] : [low - 1, high + 1];
  return [low, high];
}

/** Per-series metric value exposed to parent for display in chips. */
export interface ChartMetricValue {
  id: ChartTypeId;
  label: string;
  value: string;
  unit: string;
  /** Longest formatted value (for stable chip width during scrubbing) */
  maxValueWidth?: string | undefined;
  /** The value is the activity's average rather than the sample under a scrub. */
  isAverage?: boolean | undefined;
  /** The value is the activity's elevation gain rather than the altitude under a scrub. */
  isGain?: boolean | undefined;
}

/**
 * Why a chart has nothing to draw: the distance axis on an activity with time
 * but no distance, an activity with no samples on either axis, or chosen
 * metrics the activity did not record.
 */
export type EmptyPlotCause = 'noDistance' | 'noSamples' | 'noMetrics';

/** Output of {@link buildChartData}. */
export interface ChartDataResult {
  chartData: Record<string, number>[];
  seriesInfo: SeriesInfo[];
  indexMap: number[];
  maxX: number;
  /** Null when there is a series to draw. */
  emptyCause: EmptyPlotCause | null;
}

/**
 * What a band's colour means, rather than what it looks like. The chart layer
 * turns this into a swatch through `resolveBandColour`.
 */
export type BandColourToken =
  | { kind: 'zone'; scale: 'power' | 'hr'; zone: number }
  | { kind: 'role'; role: 'work' | 'recovery' | 'warmup' | 'cooldown' | 'other' };

/**
 * What an interval's colour means, read once for the band behind the chart,
 * the chip that keys it and the table row that lists it. A WORK interval with
 * a zone takes the zone on `scale`; every other kind takes its role, and
 * recovery and rest are one role.
 */
export function intervalBandToken(
  interval: Pick<ActivityInterval, 'kind' | 'zone'>,
  scale: 'power' | 'hr'
): BandColourToken {
  switch (interval.kind) {
    case IntervalKind.Work:
      return interval.zone != null && interval.zone >= 1
        ? { kind: 'zone', scale, zone: interval.zone }
        : { kind: 'role', role: 'work' };
    case IntervalKind.Recovery:
    case IntervalKind.Rest:
      return { kind: 'role', role: 'recovery' };
    case IntervalKind.Warmup:
      return { kind: 'role', role: 'warmup' };
    case IntervalKind.Cooldown:
      return { kind: 'role', role: 'cooldown' };
    default:
      return { kind: 'role', role: 'other' };
  }
}

/** The band behind every lane for a single interval. */
export interface IntervalBand {
  startX: number;
  endX: number;
  bandColour: BandColourToken;
  /**
   * A WORK interval's average power and heart rate, which the power and heart
   * rate lanes mark across it. Null where the interval is not WORK or carries none.
   */
  averages: { power: number | null; heartrate: number | null };
  isWork: boolean;
}

/** A distance in metres as km or miles. */
function distanceInUnit(metres: number, isMetric: boolean): number {
  const km = metres / 1000;
  return isMetric ? km : km * KM_TO_MI;
}

function emptyResult(emptyCause: EmptyPlotCause): ChartDataResult {
  return { chartData: [], seriesInfo: [], indexMap: [], maxX: 1, emptyCause };
}

/**
 * Thin the selected streams for drawing, each at its own lane's extent.
 *
 * For each selected chart, reads the raw stream via `config.getStream` and
 * emits its value at every kept sample, in its own units, beside an x value
 * (distance in km/mi or time in seconds). `buckets` is the plot width in
 * layout pixels: each series keeps its extremes per pixel, so a short spike
 * is drawn at any length of activity. A stopped pace sample is NaN, so the
 * line breaks there.
 */
export function buildChartData(
  streams: ActivityStreams,
  selectedCharts: ChartTypeId[],
  chartConfigs: Record<ChartTypeId, ChartConfig>,
  isMetric: boolean,
  xAxisMode: 'distance' | 'time',
  buckets: number
): ChartDataResult {
  // Choose x-axis source array based on mode
  const xSource = xAxisMode === 'time' ? streams.time || [] : streams.distance || [];
  if (xSource.length === 0) {
    const hasTime = (streams.time?.length ?? 0) > 0;
    return emptyResult(xAxisMode === 'distance' && hasTime ? 'noDistance' : 'noSamples');
  }

  const drawnSeries: { info: SeriesInfo; drawn: Float64Array }[] = [];
  for (const chartId of selectedCharts) {
    const config = chartConfigs[chartId];
    if (!config) continue;
    const rawData = config.getStream?.(streams);
    if (!rawData || rawData.length === 0) continue;
    const drawn = new Float64Array(xSource.length);
    for (let i = 0; i < xSource.length; i++) {
      const rawVal = rawData[i];
      drawn[i] =
        rawVal === undefined || !Number.isFinite(rawVal) || isStoppedSample(config, rawVal)
          ? NaN
          : rawVal;
    }
    drawnSeries.push({
      info: {
        id: chartId,
        config,
        rawData,
        domain: laneDomain(config, seriesExtent(config, rawData)),
        kind: laneKind(config),
      },
      drawn,
    });
  }

  if (drawnSeries.length === 0) return emptyResult('noMetrics');

  // Thin each series to its first, lowest, highest and last sample per pixel,
  // and draw the union so every lane keeps its spikes on one shared x.
  const kept = new Set<number>();
  for (const { drawn } of drawnSeries) {
    for (const i of minMaxBuckets(xSource, drawn, buckets)) kept.add(i);
  }
  const indices = [...kept].sort((a, b) => a - b);

  const points = indices.map((i) => {
    const xRaw = xSource[i] ?? NaN;
    const point: Record<string, number> = {
      x: xAxisMode === 'time' ? xRaw : distanceInUnit(xRaw, isMetric),
    };
    for (const { info, drawn } of drawnSeries) point[info.id] = drawn[i] ?? NaN;
    return point;
  });

  // A non-finite x sample would otherwise carry NaN into the axis domain.
  const computedMaxX = finiteExtent(points.map((p) => p.x))?.max ?? 1;

  return {
    chartData: points,
    seriesInfo: drawnSeries.map(({ info }) => info),
    indexMap: indices,
    maxX: computedMaxX,
    emptyCause: null,
  };
}

/**
 * Compute average values for every available chart type (not just selected).
 *
 * For altitude (`defaultMetric === 'gain'`) the idle value is the activity's
 * elevation gain with a `+` prefix. For everything else, it is `seriesAverage`.
 * Both format through `formatScrubValue`, so the idle chip and a scrub of the
 * same value read alike.
 *
 * Returns one entry per available chart, including a `maxValueWidth` string
 * so callers can lock the chip width during scrubbing.
 */
export function computeAllAverages(
  chartConfigs: Record<ChartTypeId, ChartConfig>,
  streams: ActivityStreams,
  isMetric: boolean,
  elevationGain: number | null | undefined
): ChartMetricValue[] {
  const results: ChartMetricValue[] = [];
  for (const chartId of Object.keys(chartConfigs) as ChartTypeId[]) {
    const config = chartConfigs[chartId];
    if (!config) continue;
    const rawData = config.getStream?.(streams);
    if (!rawData || rawData.length === 0) continue;
    // Every sample a scrub can read, so the chip is locked to the widest. A
    // pace scrub reads a stop as absent, so its stops are left out.
    const scrubExtent = seriesExtent(config, rawData);
    if (!scrubExtent && !finiteExtent(rawData)) continue;
    const maxFormatted = formatScrubValue(config, scrubExtent?.max, isMetric);

    let formatted: string;
    let widest: string;
    if (config.defaultMetric === 'gain') {
      const gain = elevationGain != null && Number.isFinite(elevationGain) ? elevationGain : 0;
      formatted = `+${formatScrubValue(config, gain, isMetric)}`;
      // The gain holds while idle and a scrub shows altitude, so the chip
      // takes the wider of the two.
      widest = formatted.length >= maxFormatted.length ? formatted : maxFormatted;
    } else {
      formatted = formatScrubValue(config, seriesAverage(config, rawData) ?? undefined, isMetric);
      widest = maxFormatted;
    }

    const unit = seriesUnit(config, isMetric);

    results.push({
      id: chartId,
      label: config.label,
      value: formatted,
      unit,
      maxValueWidth: widest,
      // The gain is a total and carries its own '+'.
      isAverage: config.defaultMetric !== 'gain',
      isGain: config.defaultMetric === 'gain',
    });
  }
  return results;
}

/** The first sample at or after `second`, or the last sample when it is past the end. */
function firstAtOrAfter(seconds: ArrayLike<number>, second: number): number {
  let lo = 0;
  let hi = seconds.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (seconds[mid] < second) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** The last sample at or before `second`, or the first sample when it is before the start. */
function lastAtOrBefore(seconds: ArrayLike<number>, second: number): number {
  const at = firstAtOrAfter(seconds, second);
  if (seconds[at] <= second) return at;
  return Math.max(0, at - 1);
}

/**
 * Where an interval starts and ends in the stream the chart is drawing.
 *
 * `startIndex` and `endIndex` are intervals.icu's, into the response as it
 * was sent. Both stream readers drop every sample without a coordinate before
 * the chart sees it, so a raw index is one sample late for every drop before
 * it, and the clamp hides the overshoot on the last interval. The seconds are
 * index-free and survive the reduction, so they are the anchor when the lap
 * carries them and the chart has a time stream the length of its series.
 */
function intervalIndices(
  interval: ActivityInterval,
  seconds: ArrayLike<number>,
  length: number
): { startIdx: number; endIdx: number } {
  const last = length - 1;
  if (seconds.length === length && interval.startTime != null && interval.endTime != null) {
    const startIdx = firstAtOrAfter(seconds, interval.startTime);
    return { startIdx, endIdx: Math.max(startIdx, lastAtOrBefore(seconds, interval.endTime)) };
  }
  return {
    startIdx: Math.max(0, Math.min(interval.startIndex, last)),
    endIdx: Math.max(0, Math.min(interval.endIndex, last)),
  };
}

/** A finite average, or null. */
function finiteOrNull(value: number | null | undefined): number | null {
  return value != null && Number.isFinite(value) ? value : null;
}

/**
 * Compute the interval bands behind every lane.
 *
 * Each interval becomes a colour token and, for a WORK interval, its average
 * power and heart rate for the lanes that draw those streams. A WORK interval
 * inside a zone carries the zone number and which scale it indexes, so the
 * chart layer can pick the swatch for the current theme.
 */
export function computeIntervalBands(
  intervals: ActivityInterval[] | undefined,
  chartDataLength: number,
  streams: ActivityStreams,
  xAxisMode: 'distance' | 'time',
  isMetric: boolean,
  activityType: ActivityType | undefined
): IntervalBand[] {
  if (!intervals || intervals.length === 0 || chartDataLength === 0) return [];
  const xSource = xAxisMode === 'time' ? streams.time || [] : streams.distance || [];
  if (xSource.length === 0) return [];

  const hasPowerZones = activityType ? measuresPower(activityType) : false;

  // The bands are placed against `time`, not against the axis being drawn, so
  // the distance axis is read at the index the seconds lookup returns.
  const seconds = streams.time || [];

  return intervals.map((interval) => {
    const { startIdx, endIdx } = intervalIndices(interval, seconds, xSource.length);

    let startX: number;
    let endX: number;
    if (xAxisMode === 'time') {
      startX = xSource[startIdx];
      endX = xSource[endIdx];
    } else {
      startX = distanceInUnit(xSource[startIdx], isMetric);
      endX = distanceInUnit(xSource[endIdx], isMetric);
    }

    const isWork = interval.kind === IntervalKind.Work;

    const bandColour = intervalBandToken(interval, hasPowerZones ? 'power' : 'hr');
    const averages = isWork
      ? {
          power: finiteOrNull(interval.averageWatts),
          heartrate: finiteOrNull(interval.averageHeartrate),
        }
      : { power: null, heartrate: null };

    return { startX, endX, bandColour, averages, isWork };
  });
}

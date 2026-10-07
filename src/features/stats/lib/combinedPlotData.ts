/**
 * Pure data-prep helpers for the combined activity chart.
 *
 * Extracts normalization, averages, and interval band math out of
 * `CombinedPlot.tsx` so the component focuses on rendering. No React,
 * no Victory, no Skia - pure TypeScript so these can be unit tested in
 * isolation.
 */

import { type ChartConfig, type ChartTypeId } from '@/features/activity';
import { measuresPower } from '@/shared/activity/activityUtils';
import type { ActivityStreams, ActivityInterval, ActivityType } from '@/types';
import { CHART_CONFIG } from '@/constants';
import { finiteExtent, type Extent } from '@/shared/charts/extent';
import { KM_TO_MI, MPS_TO_KPH } from '@/shared/format/format';
import { paceMinutesFromSpeed, speedFromPaceMinutes } from '@/shared/math/kinematics';

/**
 * One input series derived from a chart config + streams. The colour is not
 * copied out of the config: the chart layer already holds the config and
 * resolves the colour itself.
 */
export interface DataSeries {
  id: ChartTypeId;
  config: ChartConfig;
  rawData: number[];
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
  if (raw == null || !Number.isFinite(raw)) return '-';
  if (isStoppedSample(config, raw)) return '-';
  const value = !isMetric && config.convertToImperial ? config.convertToImperial(raw) : raw;
  const formatted = config.formatValue
    ? config.formatValue(value, isMetric)
    : Math.round(value).toString();
  return formatted || '-';
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
function movingSamples(config: ChartConfig, rawData: readonly number[]): number[] {
  const finite = rawData.filter((v) => Number.isFinite(v));
  const motion = config.motion;
  if (!motion) return finite;
  return finite.filter((v) => sampleSpeed(motion, v) >= motion.stoppedBelowMs);
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/**
 * A series' average in its own units, or null with nothing to average. A
 * speed averages over moving samples, and a pace is the pace of that mean
 * speed rather than the mean of the paces, which a stop would pull towards 0.
 */
export function seriesAverage(config: ChartConfig, rawData: readonly number[]): number | null {
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
export function seriesExtent(config: ChartConfig, rawData: readonly number[]): Extent | null {
  return finiteExtent(config.motion?.kind === 'pace' ? movingSamples(config, rawData) : rawData);
}

/** A series with its min/max range and an optional "preview" flag. */
export interface SeriesInfo extends DataSeries {
  range: { min: number; max: number; range: number };
  isPreview?: boolean;
}

/** Per-series metric value exposed to parent for display in chips. */
export interface ChartMetricValue {
  id: ChartTypeId;
  label: string;
  value: string;
  unit: string;
  color: string;
  /** Longest formatted value (for stable chip width during scrubbing) */
  maxValueWidth?: string | undefined;
}

/** Output of {@link buildChartData}. */
export interface ChartDataResult {
  chartData: Record<string, number>[];
  seriesInfo: SeriesInfo[];
  indexMap: number[];
  maxX: number;
}

/**
 * What a band's colour means, rather than what it looks like. The chart layer
 * turns this into a swatch through `resolveBandColour`.
 */
export type BandColourToken =
  | { kind: 'zone'; scale: 'power' | 'hr'; zone: number }
  | { kind: 'role'; role: 'work' | 'recovery' | 'warmup' | 'cooldown' | 'other' };

/** Zone-colored band behind the chart for a single interval. */
export interface IntervalBand {
  startX: number;
  endX: number;
  bandColour: BandColourToken;
  bandOpacity: number;
  /** Normalized Y (0..1) of the interval's average value, or null for non-WORK intervals. */
  avgNormY: number | null;
  isWork: boolean;
}

const EMPTY_RESULT: ChartDataResult = {
  chartData: [],
  seriesInfo: [],
  indexMap: [],
  maxX: 1,
};

/**
 * Downsample + normalize stream data across all selected series.
 *
 * For each selected chart, reads the raw stream via `config.getStream`,
 * computes its min/max, then emits normalized [0,1] values alongside an
 * x-axis value (distance in km/mi or time in seconds).
 *
 * If `previewMetricId` is provided and not already in `selectedCharts`, it
 * is appended as a "preview" series (rendered with reduced opacity at the
 * call site).
 */
export function buildChartData(
  streams: ActivityStreams,
  selectedCharts: ChartTypeId[],
  chartConfigs: Record<ChartTypeId, ChartConfig>,
  isMetric: boolean,
  previewMetricId: ChartTypeId | null | undefined,
  xAxisMode: 'distance' | 'time'
): ChartDataResult {
  // Choose x-axis source array based on mode
  const xSource = xAxisMode === 'time' ? streams.time || [] : streams.distance || [];
  if (xSource.length === 0) return EMPTY_RESULT;

  // Determine which charts to render (selected + preview if unselected)
  const chartsToRender = [...selectedCharts];
  if (previewMetricId && !selectedCharts.includes(previewMetricId)) {
    chartsToRender.push(previewMetricId);
  }

  // Collect all series data
  const series: (DataSeries & { isPreview?: boolean })[] = [];
  for (const chartId of chartsToRender) {
    const config = chartConfigs[chartId];
    if (!config) continue;
    const rawData = config.getStream?.(streams);
    if (!rawData || rawData.length === 0) continue;
    series.push({
      id: chartId,
      config,
      rawData,
      isPreview: chartId === previewMetricId && !selectedCharts.includes(chartId),
    });
  }

  if (series.length === 0) return EMPTY_RESULT;

  // Downsample and normalize
  const maxPoints = CHART_CONFIG.MAX_DATA_POINTS;
  const step = Math.max(1, Math.floor(xSource.length / maxPoints));
  const points: Record<string, number>[] = [];
  const indices: number[] = [];

  // Calculate min/max for each series for normalization
  const seriesRanges = series.map((s) => {
    // A stream with no finite sample normalises against a flat range. Its points
    // are non-finite anyway, so the chart draws a gap rather than a floor line.
    // A pace with no moving sample does the same, its stops on the floor.
    const extent = seriesExtent(s.config, s.rawData);
    if (!extent) return { min: 0, max: 0, range: 1 };
    return { min: extent.min, max: extent.max, range: extent.max - extent.min || 1 };
  });

  for (let i = 0; i < xSource.length; i += step) {
    let xValue: number;
    if (xAxisMode === 'time') {
      // Time in seconds (raw)
      xValue = xSource[i];
    } else {
      // Distance in km or miles
      const distKm = xSource[i] / 1000;
      xValue = isMetric ? distKm : distKm * KM_TO_MI;
    }

    const point: Record<string, number> = { x: xValue };

    // Add normalized value for each series (0-1 range)
    series.forEach((s, idx) => {
      const rawVal = s.rawData[i] ?? 0;
      if (isStoppedSample(s.config, rawVal)) {
        point[s.id] = NaN;
        return;
      }
      const { min, range } = seriesRanges[idx];
      const normalized = (rawVal - min) / range;
      point[s.id] = Math.max(0, Math.min(1, normalized));
    });

    points.push(point);
    indices.push(i);
  }

  // A non-finite x sample would otherwise carry NaN into the axis domain.
  const computedMaxX = finiteExtent(points.map((p) => p.x))?.max ?? 1;

  return {
    chartData: points,
    seriesInfo: series.map((s, idx) => ({ ...s, range: seriesRanges[idx] })),
    indexMap: indices,
    maxX: computedMaxX,
  };
}

/**
 * Compute average values for every available chart type (not just selected).
 *
 * For altitude (`defaultMetric === 'gain'`) the "average" is the cumulative
 * positive delta (total elevation gain) with a `+` prefix. For everything
 * else, it is `seriesAverage`. Both format through `formatScrubValue`, so the
 * idle chip and a scrub of the same value read alike.
 *
 * Returns one entry per available chart, including a `maxValueWidth` string
 * so callers can lock the chip width during scrubbing.
 */
export function computeAllAverages(
  chartConfigs: Record<ChartTypeId, ChartConfig>,
  streams: ActivityStreams,
  isMetric: boolean
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
      // Sum of positive deltas (elevation gain)
      let gain = 0;
      for (let i = 1; i < rawData.length; i++) {
        // Both samples must be real. A null neighbour differences to a whole
        // sample's worth of fabricated gain.
        if (!Number.isFinite(rawData[i]) || !Number.isFinite(rawData[i - 1])) continue;
        const delta = rawData[i] - rawData[i - 1];
        if (delta > 0) gain += delta;
      }
      formatted = `+${formatScrubValue(config, gain, isMetric)}`;
      // The gain holds while idle and a scrub shows altitude, so the chip
      // takes the wider of the two.
      widest = formatted.length >= maxFormatted.length ? formatted : maxFormatted;
    } else {
      formatted = formatScrubValue(config, seriesAverage(config, rawData) ?? undefined, isMetric);
      widest = maxFormatted;
    }

    const unit = isMetric ? config.unit || '' : config.unitImperial || config.unit || '';

    results.push({
      id: chartId,
      label: config.label,
      value: formatted,
      unit,
      color: config.color,
      maxValueWidth: widest,
    });
  }
  return results;
}

/** The first sample at or after `second`, or the last sample when it is past the end. */
function firstAtOrAfter(seconds: number[], second: number): number {
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
function lastAtOrBefore(seconds: number[], second: number): number {
  const at = firstAtOrAfter(seconds, second);
  if (seconds[at] <= second) return at;
  return Math.max(0, at - 1);
}

/**
 * Where an interval starts and ends in the stream the chart is drawing.
 *
 * `start_index` and `end_index` are intervals.icu's, into the response as it
 * was sent. Both stream readers drop every sample without a coordinate before
 * the chart sees it, so a raw index is one sample late for every drop before
 * it, and the clamp hides the overshoot on the last interval. The seconds are
 * index-free and survive the reduction, so they are the anchor when the body
 * carries them.
 */
function intervalIndices(
  interval: ActivityInterval,
  seconds: number[],
  length: number
): { startIdx: number; endIdx: number } {
  const last = length - 1;
  if (seconds.length === length && interval.start_time != null && interval.end_time != null) {
    const startIdx = firstAtOrAfter(seconds, interval.start_time);
    return { startIdx, endIdx: Math.max(startIdx, lastAtOrBefore(seconds, interval.end_time)) };
  }
  return {
    startIdx: Math.max(0, Math.min(interval.start_index, last)),
    endIdx: Math.max(0, Math.min(interval.end_index, last)),
  };
}

/**
 * Compute the interval bands behind the chart.
 *
 * Each interval becomes a colour token plus an opacity and a normalized Y
 * position for the dashed-line indicator (WORK only). A WORK interval inside
 * a zone carries the zone number and which scale it indexes, so the chart
 * layer can pick the swatch for the current theme.
 */
export function computeIntervalBands(
  intervals: ActivityInterval[] | undefined,
  chartDataLength: number,
  streams: ActivityStreams,
  xAxisMode: 'distance' | 'time',
  isMetric: boolean,
  activityType: ActivityType | undefined,
  seriesInfo: SeriesInfo[]
): IntervalBand[] {
  if (!intervals || intervals.length === 0 || chartDataLength === 0) return [];
  const xSource = xAxisMode === 'time' ? streams.time || [] : streams.distance || [];
  if (xSource.length === 0) return [];

  const hasPowerZones = activityType ? measuresPower(activityType) : false;

  // Find the series whose avg values we'll use for dashed lines
  // Prefer the first selected series (power for cycling users, HR for runners)
  const primarySeries = seriesInfo[0];

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
      const toUnit = (v: number) => {
        const km = v / 1000;
        return isMetric ? km : km * KM_TO_MI;
      };
      startX = toUnit(xSource[startIdx]);
      endX = toUnit(xSource[endIdx]);
    }

    const isWork = interval.type === 'WORK';
    const isRecovery = interval.type === 'RECOVERY' || interval.type === 'REST';

    let bandColour: BandColourToken;
    let bandOpacity: number;
    if (isWork && interval.zone != null && interval.zone >= 1) {
      bandColour = { kind: 'zone', scale: hasPowerZones ? 'power' : 'hr', zone: interval.zone };
      bandOpacity = 0.35;
    } else if (isWork) {
      bandColour = { kind: 'role', role: 'work' };
      bandOpacity = 0.3;
    } else if (isRecovery) {
      bandColour = { kind: 'role', role: 'recovery' };
      bandOpacity = 0.15;
    } else if (interval.type === 'WARMUP') {
      bandColour = { kind: 'role', role: 'warmup' };
      bandOpacity = 0.15;
    } else if (interval.type === 'COOLDOWN') {
      bandColour = { kind: 'role', role: 'cooldown' };
      bandOpacity = 0.15;
    } else {
      bandColour = { kind: 'role', role: 'other' };
      bandOpacity = 0.08;
    }

    // Normalized avg Y for dashed line (only for WORK intervals)
    let avgNormY: number | null = null;
    if (isWork && primarySeries) {
      // Pick the avg value that matches the primary series type
      const avgRaw =
        primarySeries.id === 'power'
          ? interval.average_watts
          : primarySeries.id === 'heartrate'
            ? interval.average_heartrate
            : null;
      if (avgRaw != null && Number.isFinite(avgRaw)) {
        const { min, range } = primarySeries.range;
        avgNormY = Math.max(0, Math.min(1, (avgRaw - min) / range));
      }
    }

    return { startX, endX, bandColour, bandOpacity, avgNormY, isWork };
  });
}

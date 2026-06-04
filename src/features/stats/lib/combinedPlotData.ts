/**
 * Pure data-prep helpers for the combined activity chart.
 *
 * Extracts normalization, averages, and interval band math out of
 * `CombinedPlot.tsx` so the component focuses on rendering. No React,
 * no Victory, no Skia — pure TypeScript so these can be unit tested in
 * isolation.
 */

import type { ChartConfig, ChartTypeId } from '@/lib';
import { isCyclingActivity } from '@/lib';
import type { ActivityStreams, ActivityInterval, ActivityType } from '@/types';
import { CHART_CONFIG } from '@/constants';
import { colors, darkColors } from '@/theme';
import { POWER_ZONE_COLORS, HR_ZONE_COLORS } from '@/hooks';

/** One input series derived from a chart config + streams. */
export interface DataSeries {
  id: ChartTypeId;
  config: ChartConfig;
  rawData: number[];
  color: string;
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
  maxValueWidth?: string;
}

/** Output of {@link buildChartData}. */
export interface ChartDataResult {
  chartData: Record<string, number>[];
  seriesInfo: SeriesInfo[];
  indexMap: number[];
  maxX: number;
}

/** Zone-colored band behind the chart for a single interval. */
export interface IntervalBand {
  startX: number;
  endX: number;
  bandColor: string;
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
      color: config.color,
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
    const values = s.rawData.filter((v) => !isNaN(v) && isFinite(v));
    const min = Math.min(...values);
    const max = Math.max(...values);
    return { min, max, range: max - min || 1 };
  });

  for (let i = 0; i < xSource.length; i += step) {
    let xValue: number;
    if (xAxisMode === 'time') {
      // Time in seconds (raw)
      xValue = xSource[i];
    } else {
      // Distance in km or miles
      const distKm = xSource[i] / 1000;
      xValue = isMetric ? distKm : distKm * 0.621371;
    }

    const point: Record<string, number> = { x: xValue };

    // Add normalized value for each series (0-1 range)
    series.forEach((s, idx) => {
      const rawVal = s.rawData[i] ?? 0;
      const { min, range } = seriesRanges[idx];
      const normalized = (rawVal - min) / range;
      point[s.id] = Math.max(0, Math.min(1, normalized));
    });

    points.push(point);
    indices.push(i);
  }

  const xValues = points.map((p) => p.x);
  const computedMaxX = Math.max(...xValues);

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
 * else, it is an arithmetic mean of valid samples.
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

    const validValues = rawData.filter((v) => !isNaN(v) && isFinite(v));
    if (validValues.length === 0) continue;

    let computed: number;
    let valuePrefix = '';

    if (config.defaultMetric === 'gain') {
      // Sum of positive deltas (elevation gain)
      let gain = 0;
      for (let i = 1; i < rawData.length; i++) {
        const delta = rawData[i] - rawData[i - 1];
        if (delta > 0 && isFinite(delta)) gain += delta;
      }
      computed = gain;
      valuePrefix = '+';
    } else {
      computed = validValues.reduce((sum, v) => sum + v, 0) / validValues.length;
    }

    if (!isMetric && config.convertToImperial) {
      computed = config.convertToImperial(computed);
    }
    const formatted =
      valuePrefix +
      (config.formatValue
        ? config.formatValue(computed, isMetric)
        : Math.round(computed).toString());

    // Compute widest formatted value for stable chip width
    let maxFormatted: string;
    if (config.defaultMetric === 'gain') {
      // Gain is fixed — use it as max width; also check max altitude for scrub case
      let maxRaw = Math.max(...validValues);
      if (!isMetric && config.convertToImperial) {
        maxRaw = config.convertToImperial(maxRaw);
      }
      const maxAltFormatted = config.formatValue
        ? config.formatValue(maxRaw, isMetric)
        : Math.round(maxRaw).toString();
      // Use the wider of gain formatted or max altitude formatted
      maxFormatted = formatted.length >= maxAltFormatted.length ? formatted : maxAltFormatted;
    } else {
      let maxRaw = Math.max(...validValues);
      if (!isMetric && config.convertToImperial) {
        maxRaw = config.convertToImperial(maxRaw);
      }
      maxFormatted = config.formatValue
        ? config.formatValue(maxRaw, isMetric)
        : Math.round(maxRaw).toString();
    }

    const unit = isMetric ? config.unit || '' : config.unitImperial || config.unit || '';

    results.push({
      id: chartId,
      label: config.label,
      value: formatted,
      unit,
      color: config.color,
      maxValueWidth: maxFormatted,
    });
  }
  return results;
}

/**
 * Compute zone-colored interval bands for the chart.
 *
 * Each interval is mapped to a background color (WORK gets the power/HR
 * zone color, RECOVERY/REST get a neutral gray, WARMUP/COOLDOWN get
 * distinct colors) plus an opacity and a normalized Y position for the
 * dashed-line indicator (WORK only).
 */
export function computeIntervalBands(
  intervals: ActivityInterval[] | undefined,
  chartDataLength: number,
  streams: ActivityStreams,
  xAxisMode: 'distance' | 'time',
  isMetric: boolean,
  isDark: boolean,
  activityType: ActivityType | undefined,
  seriesInfo: SeriesInfo[]
): IntervalBand[] {
  if (!intervals || intervals.length === 0 || chartDataLength === 0) return [];
  const xSource = xAxisMode === 'time' ? streams.time || [] : streams.distance || [];
  if (xSource.length === 0) return [];

  const isCycling = activityType ? isCyclingActivity(activityType) : false;

  // Find the series whose avg values we'll use for dashed lines
  // Prefer the first selected series (power for cycling users, HR for runners)
  const primarySeries = seriesInfo[0];

  return intervals.map((interval) => {
    const startIdx = Math.max(0, Math.min(interval.start_index, xSource.length - 1));
    const endIdx = Math.max(0, Math.min(interval.end_index, xSource.length - 1));

    let startX: number;
    let endX: number;
    if (xAxisMode === 'time') {
      startX = xSource[startIdx];
      endX = xSource[endIdx];
    } else {
      const toUnit = (v: number) => {
        const km = v / 1000;
        return isMetric ? km : km * 0.621371;
      };
      startX = toUnit(xSource[startIdx]);
      endX = toUnit(xSource[endIdx]);
    }

    const isWork = interval.type === 'WORK';
    const isRecovery = interval.type === 'RECOVERY' || interval.type === 'REST';

    // Zone color
    let bandColor: string;
    let bandOpacity: number;
    if (isWork && interval.zone != null && interval.zone >= 1) {
      const zoneArr = isCycling ? POWER_ZONE_COLORS : HR_ZONE_COLORS;
      bandColor = zoneArr[Math.min(interval.zone - 1, zoneArr.length - 1)];
      if (isDark && interval.zone === 7) bandColor = darkColors.zone7;
      bandOpacity = 0.35;
    } else if (isWork) {
      bandColor = colors.primary;
      bandOpacity = 0.3;
    } else if (isRecovery) {
      bandColor = '#808080';
      bandOpacity = 0.15;
    } else if (interval.type === 'WARMUP') {
      bandColor = '#22C55E';
      bandOpacity = 0.15;
    } else if (interval.type === 'COOLDOWN') {
      bandColor = '#8B5CF6';
      bandOpacity = 0.15;
    } else {
      bandColor = '#808080';
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
      if (avgRaw != null && isFinite(avgRaw)) {
        const { min, range } = primarySeries.range;
        avgNormY = Math.max(0, Math.min(1, (avgRaw - min) / range));
      }
    }

    return { startX, endX, bandColor, bandOpacity, avgNormY, isWork };
  });
}

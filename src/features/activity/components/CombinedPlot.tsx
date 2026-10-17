import React, { useMemo, useRef, useCallback } from 'react';
import { View, StyleSheet } from 'react-native';
import { useTheme, useMetricSystem } from '@/shared/app';
import { vec, Line as SkiaLine, DashPathEffect, Rect } from '@shopify/react-native-skia';
import { GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useSharedValue,
  useAnimatedReaction,
  runOnJS,
  useDerivedValue,
  useAnimatedStyle,
} from 'react-native-reanimated';
import * as haptics from '@/shared/ui/haptics';
import { useGestureCallback } from '@/shared/ui/useGestureCallback';
import { useTranslation } from 'react-i18next';
import { chartStreamColour, chartStyles, colorWithOpacity, ink, layout, opacity } from '@/theme';
import {
  chartTypeLabel,
  type ChartConfig,
  type ChartTypeId,
} from '@/features/activity/lib/chartConfig';
import type { ActivityStreams, ActivityInterval, ActivityType } from '@/types';
import { ChartErrorBoundary, EmptyState } from '@/shared/ui';
import {
  ChartCanvas,
  ChartSurface,
  CurveArea,
  CurveLine,
  lanesSummary,
  seriesTable,
  useMeasuredWidth,
  useScrubPan,
  type SummarySeries,
} from '@/shared/charts';
import {
  buildChartData,
  computeAllAverages,
  computeIntervalBands,
  formatScrubValue,
  seriesAverage,
  seriesUnit,
  resolveBandColour,
  type ChartMetricValue,
  type EmptyPlotCause,
} from '@/features/stats';
import { ChartXAxisLabel, type ChartXAxisLabelHandle } from './ChartXAxisLabel';
import { ChartYAxisLabel } from './ChartYAxisLabel';
import { useSeriesAccessors } from './useSeriesAccessors';
import { ABSENT } from '@/shared/format/absent';
import { formatDecimal } from '@/shared/format';
import { formatDuration } from '@/shared/format/format';

export type { ChartMetricValue };

interface CombinedPlotProps {
  streams: ActivityStreams;
  elevationGain: number | null | undefined;
  selectedCharts: ChartTypeId[];
  chartConfigs: Record<ChartTypeId, ChartConfig>;
  height?: number | undefined;
  onPointSelect?: ((index: number | null) => void) | undefined;
  onInteractionChange?: ((isInteracting: boolean) => void) | undefined;
  /** When set, show Y-axis for this metric (for long-press preview in multi-metric mode) */
  previewMetricId?: ChartTypeId | null | undefined;
  /** X-axis mode: 'distance' (default) or 'time' */
  xAxisMode?: 'distance' | 'time' | undefined;
  /** Interval data - when provided, renders zone-colored bands behind the chart */
  intervals?: ActivityInterval[] | undefined;
  /** Activity type - needed for zone color selection (power vs HR) */
  activityType?: ActivityType | undefined;
  /** Called with per-series values when scrubbing or averages when idle */
  onMetricsChange?: ((metrics: ChartMetricValue[], isScrubbing: boolean) => void) | undefined;
}

const CHART_PADDING = { top: 2, bottom: 20 } as const;
const NORMALISED_DOMAIN: [number, number] = [0, 1];
const xOf = (d: Record<string, number>) => d.x;

const EMPTY_CAUSE_KEYS = {
  noDistance: 'activity.chartNoDistance',
  noSamples: 'activity.chartNoSamples',
  noMetrics: 'activity.chartNoMetrics',
} as const satisfies Record<EmptyPlotCause, string>;

export const CombinedPlot = React.memo(function CombinedPlot({
  streams,
  elevationGain,
  selectedCharts,
  chartConfigs,
  height = 180,
  onPointSelect,
  onInteractionChange,
  previewMetricId,
  xAxisMode = 'distance',
  intervals,
  activityType,
  onMetricsChange,
}: CombinedPlotProps) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const isMetric = useMetricSystem();

  // Shared values for UI thread gesture tracking (native 120Hz performance)
  const touchX = useSharedValue(-1); // -1 means not touching
  const xValuesShared = useSharedValue<number[]>([]);
  const chartBoundsShared = useSharedValue({ left: 0, right: 1 });

  // The scrub position lives in the axis label that draws it. Held here it
  // rendered the chart root per index, and the root is what rebuilds every
  // Skia path.
  const xAxisLabel = useRef<ChartXAxisLabelHandle>(null);

  const onPointSelectRef = useRef(onPointSelect);
  const onInteractionChangeRef = useRef(onInteractionChange);
  const onMetricsChangeRef = useRef(onMetricsChange);
  const isActiveRef = useRef(false);
  onPointSelectRef.current = onPointSelect;
  onInteractionChangeRef.current = onInteractionChange;
  onMetricsChangeRef.current = onMetricsChange;

  // Track last notified index to avoid redundant updates
  const lastNotifiedIdx = useRef<number | null>(null);

  // The plot spans the container, so its width in layout pixels is the
  // number of buckets the streams are thinned to.
  const { width: plotWidth, onLayout } = useMeasuredWidth();
  const buckets = Math.max(1, Math.round(plotWidth));

  // Build normalised data for all selected series (+ preview if unselected)
  const { chartData, seriesInfo, indexMap, maxX, emptyCause } = useMemo(
    () =>
      buildChartData(
        streams,
        selectedCharts,
        chartConfigs,
        isMetric,
        previewMetricId,
        xAxisMode,
        buckets
      ),
    [streams, selectedCharts, chartConfigs, isMetric, previewMetricId, xAxisMode, buckets]
  );

  const series = useSeriesAccessors(seriesInfo);

  // Sync x-values to shared value for UI thread access
  React.useEffect(() => {
    xValuesShared.value = chartData.map((d) => d.x);
  }, [chartData, xValuesShared]);

  // Derive the selected index on UI thread using chartBounds
  // Maps touch pixel → x-value domain → binary search for nearest data point
  const selectedIdx = useDerivedValue(() => {
    'worklet';
    const xVals = xValuesShared.value;
    const len = xVals.length;
    const bounds = chartBoundsShared.value;
    const chartWidth = bounds.right - bounds.left;

    if (touchX.value < 0 || chartWidth <= 0 || len === 0) return -1;

    // Map touch pixel to x-value in data space
    const chartX = touchX.value - bounds.left;
    const ratio = Math.max(0, Math.min(1, chartX / chartWidth));
    const xMin = xVals[0];
    const xMax = xVals[len - 1];
    const targetX = xMin + ratio * (xMax - xMin);

    // Binary search for nearest x-value
    let lo = 0;
    let hi = len - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (xVals[mid] < targetX) lo = mid + 1;
      else hi = mid;
    }
    // Check left neighbor to find closest
    if (lo > 0 && Math.abs(xVals[lo - 1] - targetX) < Math.abs(xVals[lo] - targetX)) {
      return lo - 1;
    }
    return lo;
  }, []);

  // Bridge to JS only when index changes (for metrics panel and parent notification)
  // Calculate averages for display when not scrubbing
  // Compute averages for ALL available chart types (not just selected)
  const allAverages = useMemo(
    () => computeAllAverages(chartConfigs, streams, isMetric, elevationGain),
    [chartConfigs, streams, isMetric, elevationGain]
  );

  const updateMetricsOnJS = useCallback(
    (idx: number) => {
      if (idx < 0 || chartData.length === 0 || seriesInfo.length === 0) {
        if (lastNotifiedIdx.current !== null) {
          isActiveRef.current = false;
          xAxisLabel.current?.setScrub(null);
          lastNotifiedIdx.current = null;
          if (onPointSelectRef.current) onPointSelectRef.current(null);
          if (onInteractionChangeRef.current) onInteractionChangeRef.current(false);
          // Re-emit all averages when scrub ends
          if (onMetricsChangeRef.current && allAverages.length > 0) {
            onMetricsChangeRef.current(allAverages, false);
          }
        }
        return;
      }

      // Skip if same index
      if (idx === lastNotifiedIdx.current) return;
      lastNotifiedIdx.current = idx;

      if (!isActiveRef.current) {
        isActiveRef.current = true;
        if (onInteractionChangeRef.current) onInteractionChangeRef.current(true);
        // Haptic feedback on interaction start
        haptics.light();
      }

      // Build metric values with actual data (not normalised)
      const originalIdx = indexMap[idx];
      const values = seriesInfo.map((s) => ({
        id: s.id,
        label: s.config.label,
        value: formatScrubValue(s.config, s.rawData[originalIdx], isMetric),
        unit: seriesUnit(s.config, isMetric),
      }));

      xAxisLabel.current?.setScrub(chartData[idx]?.x ?? 0);

      // Emit scrub values for selected series + averages for unselected
      if (onMetricsChangeRef.current) {
        const scrubIds = new Set(values.map((v) => v.id));
        // Carry maxValueWidth from allAverages into scrub values for stable chip width
        const valuesWithMax = values.map((v) => ({
          ...v,
          maxValueWidth: allAverages.find((a) => a.id === v.id)?.maxValueWidth,
        }));
        const merged = [...valuesWithMax, ...allAverages.filter((a) => !scrubIds.has(a.id))];
        onMetricsChangeRef.current(merged, true);
      }

      // Notify parent of original data index for map sync
      if (onPointSelectRef.current && idx < indexMap.length) {
        onPointSelectRef.current(indexMap[idx]);
      }
    },
    [chartData, seriesInfo, indexMap, isMetric, allAverages]
  );

  // React to index changes and bridge to JS for metrics updates
  const scrubOnJS = useGestureCallback(updateMetricsOnJS);
  useAnimatedReaction(
    () => selectedIdx.value,
    (idx) => {
      runOnJS(scrubOnJS)(idx);
    },
    [scrubOnJS]
  );

  // Position stays on the UI thread; only an index change bridges to JS.
  const gesture = useScrubPan(touchX);

  // Animated crosshair style - follows finger directly for smooth tracking
  const crosshairStyle = useAnimatedStyle(() => {
    'worklet';
    // Use touchX directly so crosshair always follows the finger exactly
    if (touchX.value < 0) {
      return { opacity: 0, transform: [{ translateX: 0 }] };
    }

    // Clamp to chart bounds
    const bounds = chartBoundsShared.value;
    const xPos = Math.max(bounds.left, Math.min(bounds.right, touchX.value));

    return {
      opacity: 1,
      transform: [{ translateX: xPos }],
    };
  }, []);

  const xUnit = xAxisMode === 'time' ? '' : isMetric ? 'km' : 'mi';

  // Emit all averages to parent when not scrubbing
  React.useEffect(() => {
    if (!isActiveRef.current && onMetricsChangeRef.current && allAverages.length > 0) {
      onMetricsChangeRef.current(allAverages, false);
    }
  }, [allAverages]);

  // Format Y-axis values for single metric display
  const formatYAxisValue = useCallback(
    (value: number, series: (typeof seriesInfo)[0]) => {
      if (!series?.config) return ABSENT;
      return formatScrubValue(series.config, value, isMetric);
    },
    [isMetric]
  );

  // Always show Y-axis (for first selected metric, or preview if active)
  const yAxisSeries = previewMetricId
    ? seriesInfo.find((s) => s.id === previewMetricId)
    : seriesInfo[0];

  // Always show color accent when any metric is displayed (helps identify the data type)
  const showYAxisAccent = seriesInfo.length > 0;

  // Calculate normalised average position and raw value for the Y-axis series (for average line + label)
  const yAxisAvgInfo = useMemo(() => {
    if (!yAxisSeries) return null;
    const rawAvg = seriesAverage(yAxisSeries.config, yAxisSeries.rawData);
    if (rawAvg == null) return null;
    const { min, range } = yAxisSeries.range;
    return { normalised: (rawAvg - min) / range, raw: rawAvg };
  }, [yAxisSeries]);

  // What a screen reader hears and the Show data sheet lists: each drawn stream at each plotted
  // point, in its own unit. A stop on a pace stream is a gap, as the line draws it.
  const reading = useMemo(() => {
    const title = t('charts.activityPlot');
    const xLabel = (x: number) =>
      xAxisMode === 'time' ? formatDuration(x) : `${formatDecimal(x, 2)} ${xUnit}`;
    const lanes: SummarySeries[] = seriesInfo
      .filter((s) => !s.isPreview)
      .map((s) => {
        const unit = seriesUnit(s.config, isMetric);
        return {
          name: chartTypeLabel(s.config, t),
          unit: unit || undefined,
          points: chartData.map((d, i) => {
            const sample = indexMap[i];
            const raw = sample === undefined ? undefined : s.rawData[sample];
            return {
              label: xLabel(d.x ?? 0),
              key: String(i),
              value:
                raw === undefined || formatScrubValue(s.config, raw, isMetric) === ABSENT
                  ? null
                  : raw,
            };
          }),
          format: (v) => {
            const value = formatScrubValue(s.config, v, isMetric);
            return unit ? `${value} ${unit}` : value;
          },
        };
      });
    const xHeader = t(xAxisMode === 'time' ? 'charts.column.time' : 'charts.column.distance');
    return {
      summary: lanesSummary(title, lanes, t),
      table: seriesTable(title, xUnit ? `${xHeader} (${xUnit})` : xHeader, lanes),
    };
  }, [chartData, seriesInfo, indexMap, isMetric, xAxisMode, xUnit, t]);

  // Compute interval bands when interval data is provided
  const intervalBands = useMemo(
    () =>
      computeIntervalBands(
        intervals,
        chartData.length,
        streams,
        xAxisMode,
        isMetric,
        activityType,
        seriesInfo
      ),
    [intervals, chartData, streams, xAxisMode, isMetric, activityType, seriesInfo]
  );

  if (chartData.length === 0 || seriesInfo.length === 0) {
    return (
      <View style={[styles.placeholder, { height }]}>
        <EmptyState
          variant="inline"
          title={t('activity.noDataAvailable')}
          description={emptyCause ? t(EMPTY_CAUSE_KEYS[emptyCause]) : undefined}
        />
      </View>
    );
  }

  // Nothing is drawn until the width the streams are thinned to is known.
  if (plotWidth === 0) {
    return <View style={[styles.container, { height }]} onLayout={onLayout} />;
  }

  return (
    <ChartErrorBoundary height={height} chartName="Activity Chart">
      <View style={[styles.container, { height }]} onLayout={onLayout}>
        {/* Chart area - full height, metrics displayed in parent chips */}
        <ChartSurface summary={reading.summary} table={reading.table} testID="activity-plot">
          <GestureDetector gesture={gesture}>
            <View style={[chartStyles.chartWrapper, { height }]}>
              <ChartCanvas
                data={chartData as Record<string, number>[]}
                x={xOf}
                series={series}
                yDomain={NORMALISED_DOMAIN}
                padding={CHART_PADDING}
                grid={5}
              >
                {({ runs, bounds, xFor, yFor }) => {
                  // Sync chartBounds and point coordinates for UI thread crosshair
                  if (
                    bounds.left !== chartBoundsShared.value.left ||
                    bounds.right !== chartBoundsShared.value.right
                  ) {
                    chartBoundsShared.value = {
                      left: bounds.left,
                      right: bounds.right,
                    };
                  }

                  const chartH = bounds.bottom - bounds.top;

                  return (
                    <>
                      {/* Interval zone bands (behind stream data) */}
                      {intervalBands.map((band, i) => {
                        const x1 = xFor(band.startX);
                        const x2 = xFor(band.endX);
                        return (
                          <Rect
                            key={`ib-${i}`}
                            x={x1}
                            y={bounds.top}
                            width={Math.max(1, x2 - x1)}
                            height={chartH}
                            color={resolveBandColour(band.bandColour, isDark)}
                            opacity={band.bandOpacity}
                          />
                        );
                      })}

                      {/* Zone color strip at bottom of each WORK interval */}
                      {intervalBands.map((band, i) => {
                        if (!band.isWork) return null;
                        const x1 = xFor(band.startX);
                        const x2 = xFor(band.endX);
                        return (
                          <Rect
                            key={`zs-${i}`}
                            x={x1}
                            y={bounds.bottom - 4}
                            width={Math.max(1, x2 - x1)}
                            height={4}
                            color={resolveBandColour(band.bandColour, isDark)}
                            opacity={0.85}
                          />
                        );
                      })}

                      {/* A wash under each stream whose own scale starts at zero */}
                      {seriesInfo.map((series) =>
                        (runs[series.id] ?? []).map((run, i) => (
                          <CurveArea
                            key={`area-${series.id}-${i}`}
                            points={run}
                            yDomain={[series.range.min, series.range.max]}
                            y0={bounds.bottom}
                            color={chartStreamColour(series.config.stream, isDark)}
                            isDark={isDark}
                          />
                        ))
                      )}

                      {/* Stream line strokes - hairline casing for clarity */}
                      {seriesInfo.map((series) => {
                        const width = series.isPreview ? 0.75 : 1;
                        return (runs[series.id] ?? []).map((run, i) => (
                          <React.Fragment key={`line-${series.id}-${i}`}>
                            <CurveLine
                              points={run}
                              color={
                                isDark
                                  ? colorWithOpacity(ink.black, opacity.disabled)
                                  : colorWithOpacity(ink.black, opacity.tint2)
                              }
                              strokeWidth={width + 0.75}
                            />
                            <CurveLine
                              points={run}
                              color={chartStreamColour(series.config.stream, isDark)}
                              strokeWidth={width}
                            />
                          </React.Fragment>
                        ));
                      })}

                      {/* Dashed average lines per WORK interval */}
                      {intervalBands.map((band, i) => {
                        if (!band.isWork || band.avgNormY == null) return null;
                        const x1 = xFor(band.startX);
                        const x2 = xFor(band.endX);
                        const y = yFor(band.avgNormY);
                        return (
                          <SkiaLine
                            key={`ia-${i}`}
                            p1={vec(x1, y)}
                            p2={vec(x2, y)}
                            color={resolveBandColour(band.bandColour, isDark)}
                            strokeWidth={2}
                            opacity={0.8}
                          >
                            <DashPathEffect intervals={[4, 3]} />
                          </SkiaLine>
                        );
                      })}

                      {/* Y-axis reference lines: min, max, avg */}
                      {yAxisSeries ? (
                        <>
                          <SkiaLine
                            p1={vec(bounds.left, bounds.top)}
                            p2={vec(bounds.right, bounds.top)}
                            color={chartStreamColour(yAxisSeries.config.stream, isDark)}
                            strokeWidth={0.5}
                            opacity={0.2}
                          />
                          <SkiaLine
                            p1={vec(bounds.left, bounds.bottom)}
                            p2={vec(bounds.right, bounds.bottom)}
                            color={chartStreamColour(yAxisSeries.config.stream, isDark)}
                            strokeWidth={0.5}
                            opacity={0.2}
                          />
                          {yAxisAvgInfo != null && (
                            <SkiaLine
                              p1={vec(bounds.left, yFor(yAxisAvgInfo.normalised))}
                              p2={vec(bounds.right, yFor(yAxisAvgInfo.normalised))}
                              color={chartStreamColour(yAxisSeries.config.stream, isDark)}
                              strokeWidth={1}
                              opacity={0.4}
                            >
                              <DashPathEffect intervals={[4, 4]} />
                            </SkiaLine>
                          )}
                        </>
                      ) : null}
                    </>
                  );
                }}
              </ChartCanvas>

              {/* Animated crosshair */}
              <Animated.View
                style={[styles.crosshair, crosshairStyle, isDark && styles.crosshairDark]}
                pointerEvents="none"
              />

              {/* X-axis labels in the bottom gutter, the scrub position between them */}
              <ChartXAxisLabel
                ref={xAxisLabel}
                xAxisMode={xAxisMode}
                maxX={maxX}
                xUnit={xUnit}
                isDark={isDark}
              />

              {/* Y-axis labels sitting on reference lines */}
              {yAxisSeries ? (
                <ChartYAxisLabel
                  yAxisSeries={yAxisSeries}
                  yAxisAvgInfo={yAxisAvgInfo}
                  showYAxisAccent={showYAxisAccent}
                  chartPaddingTop={CHART_PADDING.top}
                  chartPaddingBottom={CHART_PADDING.bottom}
                  height={height}
                  isDark={isDark}
                  unit={seriesUnit(yAxisSeries.config, isMetric)}
                  formatYAxisValue={formatYAxisValue}
                />
              ) : null}
            </View>
          </GestureDetector>
        </ChartSurface>
      </View>
    </ChartErrorBoundary>
  );
});

const styles = StyleSheet.create({
  container: {},
  crosshair: {
    position: 'absolute',
    top: 8,
    bottom: 20,
    width: 2,
    backgroundColor: colorWithOpacity(ink.black, opacity.dim),
    borderRadius: layout.borderRadiusFull,
  },
  crosshairDark: {
    backgroundColor: colorWithOpacity(ink.white, opacity.disabled),
  },
  placeholder: {
    justifyContent: 'center',
  },
});

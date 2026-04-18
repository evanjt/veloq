import React, { useMemo, useRef, useState, useCallback } from 'react';
import { View, StyleSheet, Text } from 'react-native';
import { useTheme } from '@/hooks';
import { CartesianChart, Area, Line } from 'victory-native';
import {
  LinearGradient,
  vec,
  Line as SkiaLine,
  DashPathEffect,
  Rect,
} from '@shopify/react-native-skia';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useSharedValue,
  useAnimatedReaction,
  runOnJS,
  useDerivedValue,
  useAnimatedStyle,
  withSpring,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { useTranslation } from 'react-i18next';
import { colors, typography, layout, chartStyles } from '@/theme';
import { useMetricSystem } from '@/hooks';
import type { ChartConfig, ChartTypeId } from '@/lib';
import type { ActivityStreams, ActivityInterval, ActivityType } from '@/types';
import { CHART_CONFIG } from '@/constants';
import { ChartErrorBoundary } from '@/components/ui';
import {
  buildChartData,
  computeAllAverages,
  computeIntervalBands,
  type ChartMetricValue,
} from '@/lib/charts/combinedPlotData';
import { ChartXAxisLabel } from './ChartXAxisLabel';
import { ChartYAxisLabel } from './ChartYAxisLabel';
import { ChartDistanceIndicator } from './ChartDistanceIndicator';

export type { ChartMetricValue };

interface CombinedPlotProps {
  streams: ActivityStreams;
  selectedCharts: ChartTypeId[];
  chartConfigs: Record<ChartTypeId, ChartConfig>;
  height?: number;
  onPointSelect?: (index: number | null) => void;
  onInteractionChange?: (isInteracting: boolean) => void;
  /** When set, show Y-axis for this metric (for long-press preview in multi-metric mode) */
  previewMetricId?: ChartTypeId | null;
  /** X-axis mode: 'distance' (default) or 'time' */
  xAxisMode?: 'distance' | 'time';
  /** Called when user taps the x-axis pill to toggle mode */
  onXAxisModeToggle?: () => void;
  /** Whether the x-axis mode can be toggled (has both distance and time data) */
  canToggleXAxis?: boolean;
  /** Interval data — when provided, renders zone-colored bands behind the chart */
  intervals?: ActivityInterval[];
  /** Activity type — needed for zone color selection (power vs HR) */
  activityType?: ActivityType;
  /** Called with per-series values when scrubbing or averages when idle */
  onMetricsChange?: (metrics: ChartMetricValue[], isScrubbing: boolean) => void;
}

interface MetricValue {
  id: ChartTypeId;
  label: string;
  value: string;
  unit: string;
  color: string;
}

/** Victory Native chart bounds structure */
interface ChartBounds {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** Series info type used by this component (mirrors the lib type). */
type SeriesInfo = ReturnType<typeof buildChartData>['seriesInfo'][number];

const CHART_PADDING = { left: 0, right: 0, top: 2, bottom: 20 } as const;
const NORMALIZED_DOMAIN = { y: [0, 1] as [number, number] };

export const CombinedPlot = React.memo(function CombinedPlot({
  streams,
  selectedCharts,
  chartConfigs,
  height = 180,
  onPointSelect,
  onInteractionChange,
  previewMetricId,
  xAxisMode = 'distance',
  onXAxisModeToggle,
  canToggleXAxis = false,
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
  // Store Victory Native's actual rendered x-coordinates for smooth crosshair
  const pointXCoordsShared = useSharedValue<number[]>([]);

  // React state for metrics panel (bridges to JS only for text updates)
  const [metricValues, setMetricValues] = useState<MetricValue[]>([]);
  const [currentX, setCurrentX] = useState<number | null>(null);
  const [isActive, setIsActive] = useState(false);

  const onPointSelectRef = useRef(onPointSelect);
  const onInteractionChangeRef = useRef(onInteractionChange);
  const onMetricsChangeRef = useRef(onMetricsChange);
  const isActiveRef = useRef(false);
  onPointSelectRef.current = onPointSelect;
  onInteractionChangeRef.current = onInteractionChange;
  onMetricsChangeRef.current = onMetricsChange;

  // Track last notified index to avoid redundant updates
  const lastNotifiedIdx = useRef<number | null>(null);

  // Build normalized data for all selected series (+ preview if unselected)
  const { chartData, seriesInfo, indexMap, maxX } = useMemo(
    () =>
      buildChartData(streams, selectedCharts, chartConfigs, isMetric, previewMetricId, xAxisMode),
    [streams, selectedCharts, chartConfigs, isMetric, previewMetricId, xAxisMode]
  );

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
  const updateMetricsOnJS = useCallback(
    (idx: number) => {
      if (idx < 0 || chartData.length === 0 || seriesInfo.length === 0) {
        if (lastNotifiedIdx.current !== null) {
          setIsActive(false);
          isActiveRef.current = false;
          setCurrentX(null);
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
        setIsActive(true);
        isActiveRef.current = true;
        if (onInteractionChangeRef.current) onInteractionChangeRef.current(true);
        // Haptic feedback on interaction start
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }

      // Build metric values with actual data (not normalized)
      const originalIdx = indexMap[idx];
      const values = seriesInfo.map((s) => {
        let rawVal = s.rawData[originalIdx] ?? 0;

        // Apply imperial conversion if needed
        if (!isMetric && s.config.convertToImperial) {
          rawVal = s.config.convertToImperial(rawVal);
        }

        // Format the value
        let formatted: string;
        if (s.config.formatValue) {
          formatted = s.config.formatValue(rawVal, isMetric);
        } else {
          formatted = Math.round(rawVal).toString();
        }

        return {
          id: s.id,
          label: s.config.label,
          value: formatted,
          unit: isMetric ? s.config.unit || '' : s.config.unitImperial || s.config.unit || '',
          color: s.color,
        };
      });

      setMetricValues(values);
      setCurrentX(chartData[idx]?.x ?? 0);

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
    [chartData, seriesInfo, indexMap, isMetric]
  );

  // React to index changes and bridge to JS for metrics updates
  useAnimatedReaction(
    () => selectedIdx.value,
    (idx) => {
      runOnJS(updateMetricsOnJS)(idx);
    },
    [updateMetricsOnJS]
  );

  // Gesture handler - updates shared values on UI thread (no JS bridge for position)
  // Use activateAfterLongPress to require a brief hold before scrubbing starts
  // This prevents accidental scrubbing when scrolling the page
  const gesture = Gesture.Pan()
    .activateAfterLongPress(CHART_CONFIG.LONG_PRESS_DURATION)
    .onStart((e) => {
      'worklet';
      touchX.value = e.x;
    })
    .onUpdate((e) => {
      'worklet';
      touchX.value = e.x;
    })
    .onEnd(() => {
      'worklet';
      touchX.value = -1;
    });

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

  // Calculate averages for display when not scrubbing
  const averageValues = useMemo(() => {
    return seriesInfo.map((s) => {
      const validValues = s.rawData.filter((v) => !isNaN(v) && isFinite(v));
      if (validValues.length === 0) return { id: s.id, avg: 0, formatted: '-' };

      let avg = validValues.reduce((sum, v) => sum + v, 0) / validValues.length;

      if (!isMetric && s.config.convertToImperial) {
        avg = s.config.convertToImperial(avg);
      }

      const formatted = s.config.formatValue
        ? s.config.formatValue(avg, isMetric)
        : Math.round(avg).toString();

      return { id: s.id, avg, formatted };
    });
  }, [seriesInfo, isMetric]);

  // Compute averages for ALL available chart types (not just selected)
  const allAverages = useMemo(
    () => computeAllAverages(chartConfigs, streams, isMetric),
    [chartConfigs, streams, isMetric]
  );

  // Emit all averages to parent when not scrubbing
  React.useEffect(() => {
    if (!isActiveRef.current && onMetricsChangeRef.current && allAverages.length > 0) {
      onMetricsChangeRef.current(allAverages, false);
    }
  }, [allAverages]);

  // Format Y-axis values for single metric display
  const formatYAxisValue = useCallback(
    (value: number, series: (typeof seriesInfo)[0]) => {
      // Guard against invalid values or missing config
      if (!Number.isFinite(value) || !series?.config) {
        return '-';
      }
      let displayValue = value;
      if (!isMetric && series.config.convertToImperial) {
        displayValue = series.config.convertToImperial(value);
      }
      if (series.config.formatValue) {
        const formatted = series.config.formatValue(displayValue, isMetric);
        // Guard against formatValue returning empty/invalid string
        return formatted || '-';
      }
      return Math.round(displayValue).toString();
    },
    [isMetric]
  );

  // Always show Y-axis (for first selected metric, or preview if active)
  const yAxisSeries = previewMetricId
    ? seriesInfo.find((s) => s.id === previewMetricId)
    : seriesInfo[0];

  // Always show color accent when any metric is displayed (helps identify the data type)
  const showYAxisAccent = seriesInfo.length > 0;

  // Calculate normalized average position and raw value for the Y-axis series (for average line + label)
  const yAxisAvgInfo = useMemo(() => {
    if (!yAxisSeries) return null;
    const validValues = yAxisSeries.rawData.filter((v) => !isNaN(v) && isFinite(v));
    if (validValues.length === 0) return null;
    const rawAvg = validValues.reduce((sum, v) => sum + v, 0) / validValues.length;
    const { min, range } = yAxisSeries.range;
    return { normalized: (rawAvg - min) / range, raw: rawAvg };
  }, [yAxisSeries]);

  // Compute interval bands when interval data is provided
  const intervalBands = useMemo(
    () =>
      computeIntervalBands(
        intervals,
        chartData.length,
        streams,
        xAxisMode,
        isMetric,
        isDark,
        activityType,
        seriesInfo
      ),
    [intervals, chartData, streams, xAxisMode, isMetric, isDark, activityType, seriesInfo]
  );

  if (chartData.length === 0 || seriesInfo.length === 0) {
    return (
      <View style={[styles.placeholder, { height }]}>
        <Text style={[styles.placeholderText, isDark && chartStyles.textDark]}>
          {t('activity.noDataAvailable')}
        </Text>
      </View>
    );
  }

  // Build yKeys array for CartesianChart
  const yKeys = seriesInfo.map((s) => s.id);

  return (
    <ChartErrorBoundary height={height} label="Activity Chart">
      <View style={[styles.container, { height }]}>
        {/* Chart area — full height, metrics displayed in parent chips */}
        <GestureDetector gesture={gesture}>
          <View style={[chartStyles.chartWrapper, { height }]}>
            {/* Victory Native requires string literal types for yKeys,
              but ChartTypeId[] is dynamically computed. Cast is unavoidable. */}
            <CartesianChart
              data={chartData}
              xKey="x"
              yKeys={yKeys as string[]}
              domain={NORMALIZED_DOMAIN}
              padding={CHART_PADDING}
            >
              {({
                points,
                chartBounds,
              }: {
                points: Record<string, Array<{ x: number }>>;
                chartBounds: ChartBounds;
              }) => {
                // Sync chartBounds and point coordinates for UI thread crosshair
                if (
                  chartBounds.left !== chartBoundsShared.value.left ||
                  chartBounds.right !== chartBoundsShared.value.right
                ) {
                  chartBoundsShared.value = {
                    left: chartBounds.left,
                    right: chartBounds.right,
                  };
                }
                // Sync actual point x-coordinates for accurate crosshair positioning
                if (seriesInfo.length > 0) {
                  const firstSeriesPoints = points[seriesInfo[0].id];
                  if (firstSeriesPoints) {
                    const newCoords = firstSeriesPoints.map((p) => p.x);
                    if (
                      newCoords.length !== pointXCoordsShared.value.length ||
                      newCoords[0] !== pointXCoordsShared.value[0]
                    ) {
                      pointXCoordsShared.value = newCoords;
                    }
                  }
                }

                const chartWidth = chartBounds.right - chartBounds.left;
                const chartH = chartBounds.bottom - chartBounds.top;
                const xMin = chartData[0]?.x ?? 0;
                const xMax = chartData[chartData.length - 1]?.x ?? 1;
                const xRange = xMax - xMin || 1;

                const toPixelX = (xVal: number) =>
                  chartBounds.left + ((xVal - xMin) / xRange) * chartWidth;
                const toPixelY = (normVal: number) => chartBounds.top + (1 - normVal) * chartH;

                return (
                  <>
                    {/* Interval zone bands (behind stream data) */}
                    {intervalBands.map((band, i) => {
                      const x1 = toPixelX(band.startX);
                      const x2 = toPixelX(band.endX);
                      return (
                        <Rect
                          key={`ib-${i}`}
                          x={x1}
                          y={chartBounds.top}
                          width={Math.max(1, x2 - x1)}
                          height={chartH}
                          color={band.bandColor}
                          opacity={band.bandOpacity}
                        />
                      );
                    })}

                    {/* Zone color strip at bottom of each WORK interval */}
                    {intervalBands.map((band, i) => {
                      if (!band.isWork) return null;
                      const x1 = toPixelX(band.startX);
                      const x2 = toPixelX(band.endX);
                      return (
                        <Rect
                          key={`zs-${i}`}
                          x={x1}
                          y={chartBounds.bottom - 4}
                          width={Math.max(1, x2 - x1)}
                          height={4}
                          color={band.bandColor}
                          opacity={0.85}
                        />
                      );
                    })}

                    {/* Stream area fills — rich gradient beneath lines */}
                    {seriesInfo.map((series) => {
                      const isMulti = seriesInfo.length > 1;
                      const topAlpha = series.isPreview ? '30' : isMulti ? '70' : '90';
                      const bottomAlpha = series.isPreview ? '08' : isMulti ? '10' : '15';
                      return (
                        <Area
                          key={`area-${series.id}`}
                          points={points[series.id] as Parameters<typeof Area>[0]['points']}
                          y0={chartBounds.bottom}
                          curveType="natural"
                        >
                          <LinearGradient
                            start={vec(0, chartBounds.top)}
                            end={vec(0, chartBounds.bottom)}
                            colors={[series.color + topAlpha, series.color + bottomAlpha]}
                          />
                        </Area>
                      );
                    })}

                    {/* Stream line strokes — hairline casing for clarity */}
                    {seriesInfo.map((series) => {
                      const width = series.isPreview ? 0.75 : 1;
                      return (
                        <React.Fragment key={`line-${series.id}`}>
                          <Line
                            points={points[series.id] as Parameters<typeof Line>[0]['points']}
                            color={isDark ? 'rgba(0,0,0,0.5)' : 'rgba(0,0,0,0.15)'}
                            strokeWidth={width + 0.75}
                            curveType="natural"
                          />
                          <Line
                            points={points[series.id] as Parameters<typeof Line>[0]['points']}
                            color={series.color}
                            strokeWidth={width}
                            curveType="natural"
                          />
                        </React.Fragment>
                      );
                    })}

                    {/* Dashed average lines per WORK interval */}
                    {intervalBands.map((band, i) => {
                      if (!band.isWork || band.avgNormY == null) return null;
                      const x1 = toPixelX(band.startX);
                      const x2 = toPixelX(band.endX);
                      const y = toPixelY(band.avgNormY);
                      return (
                        <SkiaLine
                          key={`ia-${i}`}
                          p1={vec(x1, y)}
                          p2={vec(x2, y)}
                          color={band.bandColor}
                          strokeWidth={2}
                          opacity={0.8}
                        >
                          <DashPathEffect intervals={[4, 3]} />
                        </SkiaLine>
                      );
                    })}

                    {/* Y-axis reference lines: min, max, avg */}
                    {yAxisSeries && (
                      <>
                        {/* Max reference line */}
                        <SkiaLine
                          p1={vec(chartBounds.left, chartBounds.top)}
                          p2={vec(chartBounds.right, chartBounds.top)}
                          color={yAxisSeries.color}
                          strokeWidth={0.5}
                          opacity={0.2}
                        />
                        {/* Min reference line */}
                        <SkiaLine
                          p1={vec(chartBounds.left, chartBounds.bottom)}
                          p2={vec(chartBounds.right, chartBounds.bottom)}
                          color={yAxisSeries.color}
                          strokeWidth={0.5}
                          opacity={0.2}
                        />
                        {/* Avg dashed line */}
                        {yAxisAvgInfo != null && (
                          <SkiaLine
                            p1={vec(
                              chartBounds.left,
                              chartBounds.top +
                                (1 - yAxisAvgInfo.normalized) *
                                  (chartBounds.bottom - chartBounds.top)
                            )}
                            p2={vec(
                              chartBounds.right,
                              chartBounds.top +
                                (1 - yAxisAvgInfo.normalized) *
                                  (chartBounds.bottom - chartBounds.top)
                            )}
                            color={yAxisSeries.color}
                            strokeWidth={1}
                            opacity={0.4}
                          >
                            <DashPathEffect intervals={[4, 4]} />
                          </SkiaLine>
                        )}
                      </>
                    )}
                  </>
                );
              }}
            </CartesianChart>

            {/* Animated crosshair */}
            <Animated.View
              style={[styles.crosshair, crosshairStyle, isDark && styles.crosshairDark]}
              pointerEvents="none"
            />

            {/* X-axis labels with hint */}
            <ChartXAxisLabel xAxisMode={xAxisMode} maxX={maxX} isDark={isDark} />

            {/* Y-axis labels sitting on reference lines */}
            {yAxisSeries && (
              <ChartYAxisLabel
                yAxisSeries={yAxisSeries}
                yAxisAvgInfo={yAxisAvgInfo}
                showYAxisAccent={showYAxisAccent}
                chartPaddingTop={CHART_PADDING.top}
                chartPaddingBottom={CHART_PADDING.bottom}
                height={height}
                isDark={isDark}
                formatYAxisValue={formatYAxisValue}
              />
            )}

            {/* X-axis indicator - overlaid on bottom right of chart */}
            <ChartDistanceIndicator
              xAxisMode={xAxisMode}
              currentX={currentX}
              isActive={isActive}
              maxX={maxX}
              xUnit={xUnit}
              isDark={isDark}
              canToggleXAxis={canToggleXAxis}
              onXAxisModeToggle={onXAxisModeToggle}
            />
          </View>
        </GestureDetector>
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
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    borderRadius: 1,
  },
  crosshairDark: {
    backgroundColor: 'rgba(255, 255, 255, 0.5)',
  },
  placeholder: {
    backgroundColor: colors.background,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: layout.borderRadiusSm,
  },
  placeholderText: {
    fontSize: typography.bodyCompact.fontSize,
    color: colors.textSecondary,
  },
});

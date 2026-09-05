import React, { useMemo, useRef, useState, useCallback } from 'react';
import { View, StyleSheet, Text } from 'react-native';
import { useTheme, useMetricSystem } from '@/shared/app';
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
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { useTranslation } from 'react-i18next';
import { colors, typography, layout, chartStyles } from '@/theme';
import { type ChartConfig, type ChartTypeId } from '@/features/activity/lib/chartConfig';
import type { ActivityStreams, ActivityInterval, ActivityType } from '@/types';
import { CHART_CONFIG } from '@/constants';
import { ChartErrorBoundary } from '@/shared/ui';
import { ChartCanvas, CurveArea, CurveLine } from '@/shared/charts';
import {
  buildChartData,
  computeAllAverages,
  computeIntervalBands,
  resolveBandColour,
  type ChartMetricValue,
} from '@/features/stats';
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
  /** Interval data - when provided, renders zone-colored bands behind the chart */
  intervals?: ActivityInterval[];
  /** Activity type - needed for zone color selection (power vs HR) */
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

const CHART_PADDING = { top: 2, bottom: 20 } as const;
const NORMALISED_DOMAIN: [number, number] = [0, 1];
const xOf = (d: Record<string, number>) => d.x;

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
  const [, setMetricValues] = useState<MetricValue[]>([]);
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
          color: s.config.color,
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
        activityType,
        seriesInfo
      ),
    [intervals, chartData, streams, xAxisMode, isMetric, activityType, seriesInfo]
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

  const series = Object.fromEntries(
    seriesInfo.map((s) => [s.id, (d: Record<string, number>) => d[s.id]])
  ) as Record<string, (d: Record<string, number>) => number>;

  return (
    <ChartErrorBoundary height={height} label="Activity Chart">
      <View style={[styles.container, { height }]}>
        {/* Chart area - full height, metrics displayed in parent chips */}
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
              {({ points, bounds, xFor, yFor }) => {
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

                    {/* Stream area fills - rich gradient beneath lines */}
                    {seriesInfo.map((series) => {
                      const isMulti = seriesInfo.length > 1;
                      const topAlpha = series.isPreview ? '30' : isMulti ? '70' : '90';
                      const bottomAlpha = series.isPreview ? '08' : isMulti ? '10' : '15';
                      return (
                        <CurveArea
                          key={`area-${series.id}`}
                          points={points[series.id] ?? []}
                          y0={bounds.bottom}
                        >
                          <LinearGradient
                            start={vec(0, bounds.top)}
                            end={vec(0, bounds.bottom)}
                            colors={[
                              series.config.color + topAlpha,
                              series.config.color + bottomAlpha,
                            ]}
                          />
                        </CurveArea>
                      );
                    })}

                    {/* Stream line strokes - hairline casing for clarity */}
                    {seriesInfo.map((series) => {
                      const width = series.isPreview ? 0.75 : 1;
                      return (
                        <React.Fragment key={`line-${series.id}`}>
                          <CurveLine
                            points={points[series.id] ?? []}
                            color={isDark ? 'rgba(0,0,0,0.5)' : 'rgba(0,0,0,0.15)'}
                            strokeWidth={width + 0.75}
                          />
                          <CurveLine
                            points={points[series.id] ?? []}
                            color={series.config.color}
                            strokeWidth={width}
                          />
                        </React.Fragment>
                      );
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
                    {yAxisSeries && (
                      <>
                        <SkiaLine
                          p1={vec(bounds.left, bounds.top)}
                          p2={vec(bounds.right, bounds.top)}
                          color={yAxisSeries.config.color}
                          strokeWidth={0.5}
                          opacity={0.2}
                        />
                        <SkiaLine
                          p1={vec(bounds.left, bounds.bottom)}
                          p2={vec(bounds.right, bounds.bottom)}
                          color={yAxisSeries.config.color}
                          strokeWidth={0.5}
                          opacity={0.2}
                        />
                        {yAxisAvgInfo != null && (
                          <SkiaLine
                            p1={vec(bounds.left, yFor(yAxisAvgInfo.normalized))}
                            p2={vec(bounds.right, yFor(yAxisAvgInfo.normalized))}
                            color={yAxisSeries.config.color}
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
            </ChartCanvas>

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

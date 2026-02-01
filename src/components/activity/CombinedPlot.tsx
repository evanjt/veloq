import React, { useMemo, useRef, useState, useCallback } from 'react';
import { View, StyleSheet, Text } from 'react-native';
import { useTheme } from '@/hooks';
import { CartesianChart, Area } from 'victory-native';
import { LinearGradient, vec, Line as SkiaLine, DashPathEffect } from '@shopify/react-native-skia';
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
import { colors, darkColors, typography, layout, shadows } from '@/theme';
import { useMetricSystem } from '@/hooks';
import type { ChartConfig, ChartTypeId } from '@/lib';
import type { ActivityStreams } from '@/types';
import { CHART_CONFIG } from '@/constants';
import { ChartErrorBoundary } from '@/components/ui';

interface DataSeries {
  id: ChartTypeId;
  config: ChartConfig;
  rawData: number[];
  color: string;
}

interface CombinedPlotProps {
  streams: ActivityStreams;
  selectedCharts: ChartTypeId[];
  chartConfigs: Record<ChartTypeId, ChartConfig>;
  height?: number;
  onPointSelect?: (index: number | null) => void;
  onInteractionChange?: (isInteracting: boolean) => void;
  /** When set, show Y-axis for this metric (for long-press preview in multi-metric mode) */
  previewMetricId?: ChartTypeId | null;
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

export const CombinedPlot = React.memo(function CombinedPlot({
  streams,
  selectedCharts,
  chartConfigs,
  height = 180,
  onPointSelect,
  onInteractionChange,
  previewMetricId,
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
  const [currentDistance, setCurrentDistance] = useState<number | null>(null);
  const [isActive, setIsActive] = useState(false);

  const onPointSelectRef = useRef(onPointSelect);
  const onInteractionChangeRef = useRef(onInteractionChange);
  const isActiveRef = useRef(false);
  onPointSelectRef.current = onPointSelect;
  onInteractionChangeRef.current = onInteractionChange;

  // Track last notified index to avoid redundant updates
  const lastNotifiedIdx = useRef<number | null>(null);

  // Build normalized data for all selected series (+ preview if unselected)
  const { chartData, seriesInfo, indexMap, maxDist } = useMemo(() => {
    const distance = streams.distance || [];
    if (distance.length === 0) {
      return {
        chartData: [],
        seriesInfo: [] as (DataSeries & {
          range: { min: number; max: number; range: number };
          isPreview?: boolean;
        })[],
        indexMap: [] as number[],
        maxDist: 1,
      };
    }

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

    if (series.length === 0) {
      return {
        chartData: [],
        seriesInfo: [] as (DataSeries & {
          range: { min: number; max: number; range: number };
          isPreview?: boolean;
        })[],
        indexMap: [] as number[],
        maxDist: 1,
      };
    }

    // Downsample and normalize
    const maxPoints = CHART_CONFIG.MAX_DATA_POINTS;
    const step = Math.max(1, Math.floor(distance.length / maxPoints));
    const points: Record<string, number>[] = [];
    const indices: number[] = [];

    // Calculate min/max for each series for normalization
    const seriesRanges = series.map((s) => {
      const values = s.rawData.filter((v) => !isNaN(v) && isFinite(v));
      const min = Math.min(...values);
      const max = Math.max(...values);
      return { min, max, range: max - min || 1 };
    });

    for (let i = 0; i < distance.length; i += step) {
      const distKm = distance[i] / 1000;
      const xValue = isMetric ? distKm : distKm * 0.621371;

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

    const distances = points.map((p) => p.x);
    const computedMaxDist = Math.max(...distances);

    return {
      chartData: points,
      seriesInfo: series.map((s, idx) => ({ ...s, range: seriesRanges[idx] })),
      indexMap: indices,
      maxDist: computedMaxDist,
      xValues: distances,
    };
  }, [streams, selectedCharts, chartConfigs, isMetric, previewMetricId]);

  // Sync x-values to shared value for UI thread access
  React.useEffect(() => {
    xValuesShared.value = chartData.map((d) => d.x);
  }, [chartData, xValuesShared]);

  // Derive the selected index on UI thread using chartBounds
  const selectedIdx = useDerivedValue(() => {
    'worklet';
    const len = xValuesShared.value.length;
    const bounds = chartBoundsShared.value;
    const chartWidth = bounds.right - bounds.left;

    if (touchX.value < 0 || chartWidth <= 0 || len === 0) return -1;

    // Map touch position to chart area, then to array index
    const chartX = touchX.value - bounds.left;
    const ratio = Math.max(0, Math.min(1, chartX / chartWidth));
    const idx = Math.round(ratio * (len - 1));

    return Math.min(Math.max(0, idx), len - 1);
  }, []);

  // Bridge to JS only when index changes (for metrics panel and parent notification)
  const updateMetricsOnJS = useCallback(
    (idx: number) => {
      if (idx < 0 || chartData.length === 0 || seriesInfo.length === 0) {
        if (lastNotifiedIdx.current !== null) {
          setIsActive(false);
          isActiveRef.current = false;
          setCurrentDistance(null);
          lastNotifiedIdx.current = null;
          if (onPointSelectRef.current) onPointSelectRef.current(null);
          if (onInteractionChangeRef.current) onInteractionChangeRef.current(false);
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
      setCurrentDistance(chartData[idx]?.x ?? 0);

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

  const distanceUnit = isMetric ? 'km' : 'mi';

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

  // Calculate normalized average position for the Y-axis series (for average line)
  const yAxisAvgNormalized = useMemo(() => {
    if (!yAxisSeries) return null;
    const validValues = yAxisSeries.rawData.filter((v) => !isNaN(v) && isFinite(v));
    if (validValues.length === 0) return null;
    const rawAvg = validValues.reduce((sum, v) => sum + v, 0) / validValues.length;
    const { min, range } = yAxisSeries.range;
    return (rawAvg - min) / range;
  }, [yAxisSeries]);

  if (chartData.length === 0 || seriesInfo.length === 0) {
    return (
      <View style={[styles.placeholder, { height }]}>
        <Text style={[styles.placeholderText, isDark && styles.textDark]}>
          {t('activity.noDataAvailable')}
        </Text>
      </View>
    );
  }

  // Build yKeys array for CartesianChart
  const yKeys = seriesInfo.map((s) => s.id);
  const chartHeight = height - 40; // Reserve space for metrics panel

  return (
    <ChartErrorBoundary height={height} label="Activity Chart">
      <View style={[styles.container, { height }]}>
        {/* Hero Metrics Panel - shows current values when scrubbing, averages otherwise */}
        <View style={styles.metricsPanel}>
          {seriesInfo.map((series, idx) => {
            const displayValue = isActive && metricValues.length > idx ? metricValues[idx] : null;
            const avgData = averageValues[idx];
            const unit = isMetric
              ? series.config.unit
              : series.config.unitImperial || series.config.unit;

            return (
              <View key={series.id} style={styles.metricItem}>
                <View style={styles.metricValueRow}>
                  <Text style={[styles.metricValue, { color: series.color }]}>
                    {displayValue?.value ?? avgData?.formatted ?? '-'}
                  </Text>
                  <Text style={[styles.metricUnit, isDark && styles.metricUnitDark]}>{unit}</Text>
                </View>
                <Text style={[styles.metricLabel, isDark && styles.metricLabelDark]}>
                  {isActive ? series.config.label : t('activity.avg')}
                </Text>
              </View>
            );
          })}
        </View>

        {/* Chart area */}
        <GestureDetector gesture={gesture}>
          <View style={[styles.chartWrapper, { height: chartHeight }]}>
            {/* Victory Native requires string literal types for yKeys,
              but ChartTypeId[] is dynamically computed. Cast is unavoidable. */}
            <CartesianChart
              data={chartData}
              xKey="x"
              yKeys={yKeys as string[]}
              domain={{ y: [0, 1] }}
              padding={{ left: 0, right: 0, top: 2, bottom: 20 }}
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

                return (
                  <>
                    {seriesInfo.map((series) => {
                      // Preview series gets slightly lower opacity to indicate temporary
                      const baseOpacity = seriesInfo.length > 1 ? 0.7 : 0.85;
                      const opacity = series.isPreview ? 0.5 : baseOpacity;
                      return (
                        <Area
                          key={series.id}
                          points={points[series.id] as Parameters<typeof Area>[0]['points']}
                          y0={chartBounds.bottom}
                          curveType="natural"
                          opacity={opacity}
                        >
                          <LinearGradient
                            start={vec(0, chartBounds.top)}
                            end={vec(0, chartBounds.bottom)}
                            colors={[series.color + 'CC', series.color + '30']}
                          />
                        </Area>
                      );
                    })}
                    {/* Subtle average line for the Y-axis metric */}
                    {yAxisSeries && yAxisAvgNormalized != null && (
                      <SkiaLine
                        p1={vec(
                          chartBounds.left,
                          chartBounds.top +
                            (1 - yAxisAvgNormalized) * (chartBounds.bottom - chartBounds.top)
                        )}
                        p2={vec(
                          chartBounds.right,
                          chartBounds.top +
                            (1 - yAxisAvgNormalized) * (chartBounds.bottom - chartBounds.top)
                        )}
                        color={yAxisSeries.color}
                        strokeWidth={1}
                        opacity={0.4}
                      >
                        <DashPathEffect intervals={[4, 4]} />
                      </SkiaLine>
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
            <View style={styles.xAxis} pointerEvents="none">
              <Text style={[styles.xLabel, isDark && styles.xLabelDark]}>0</Text>
              <Text style={[styles.xAxisHint, isDark && styles.xAxisHintDark]}>
                {t('activity.chartHint', 'Hold to scrub • Hold chip for axis')}
              </Text>
              <Text style={[styles.xLabel, isDark && styles.xLabelDark]}>
                {(maxDist / 2).toFixed(1)}
              </Text>
            </View>

            {/* Y-axis labels - always shown for first metric (or preview) */}
            {yAxisSeries && (
              <View style={styles.yAxis} pointerEvents="none">
                <Text
                  style={[
                    styles.yLabel,
                    styles.yLabelTop,
                    isDark && styles.yLabelDark,
                    showYAxisAccent && { borderLeftWidth: 2, borderLeftColor: yAxisSeries.color },
                  ]}
                >
                  {formatYAxisValue(yAxisSeries.range.max, yAxisSeries)}
                </Text>
                <Text
                  style={[
                    styles.yLabel,
                    styles.yLabelBottom,
                    isDark && styles.yLabelDark,
                    showYAxisAccent && { borderLeftWidth: 2, borderLeftColor: yAxisSeries.color },
                  ]}
                >
                  {formatYAxisValue(yAxisSeries.range.min, yAxisSeries)}
                </Text>
              </View>
            )}

            {/* Distance indicator - overlaid on bottom right of chart */}
            <View
              style={[styles.distanceIndicator, isDark && styles.distanceIndicatorDark]}
              pointerEvents="none"
            >
              <Text style={[styles.distanceText, isDark && styles.distanceTextDark]}>
                {isActive && currentDistance !== null
                  ? `${currentDistance.toFixed(2)} ${distanceUnit}`
                  : `${maxDist.toFixed(1)} ${distanceUnit}`}
              </Text>
            </View>
          </View>
        </GestureDetector>
      </View>
    </ChartErrorBoundary>
  );
});

const styles = StyleSheet.create({
  container: {},
  metricsPanel: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    paddingVertical: 4,
    paddingHorizontal: 4,
    minHeight: 40,
  },
  metricItem: {
    alignItems: 'center',
    flex: 1,
  },
  metricValueRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  metricValue: {
    fontSize: 22,
    fontWeight: '700',
    letterSpacing: -0.5,
  },
  metricUnit: {
    fontSize: typography.label.fontSize,
    fontWeight: '500',
    color: colors.textSecondary,
    marginLeft: 2,
  },
  metricUnitDark: {
    color: darkColors.textSecondary,
  },
  metricLabel: {
    fontSize: typography.pillLabel.fontSize,
    fontWeight: '500',
    color: colors.textSecondary,
    marginTop: 1,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  metricLabelDark: {
    color: darkColors.textMuted,
  },
  distanceIndicator: {
    position: 'absolute',
    bottom: 24,
    right: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    // Platform-optimized shadow
    ...shadows.pill,
  },
  distanceIndicatorDark: {
    backgroundColor: darkColors.surfaceOverlay,
  },
  distanceText: {
    fontSize: typography.label.fontSize,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  distanceTextDark: {
    color: darkColors.textPrimary,
  },
  chartWrapper: {
    flex: 1,
    position: 'relative',
  },
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
  textDark: {
    color: darkColors.textSecondary,
  },
  xAxis: {
    position: 'absolute',
    bottom: 2,
    left: 4,
    right: 4,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  xLabel: {
    fontSize: typography.micro.fontSize,
    fontWeight: '500',
    color: colors.textSecondary,
  },
  xAxisHint: {
    fontSize: typography.micro.fontSize,
    fontWeight: '400',
    color: colors.textMuted,
    fontStyle: 'italic',
  },
  xAxisHintDark: {
    color: darkColors.textMuted,
  },
  xLabelDark: {
    color: darkColors.textMuted,
  },
  yAxis: {
    position: 'absolute',
    left: 4,
    top: 0,
    bottom: 20,
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  yLabel: {
    fontSize: typography.micro.fontSize,
    fontWeight: '500',
    color: colors.textSecondary,
    backgroundColor: 'rgba(255, 255, 255, 0.8)',
    paddingHorizontal: 3,
    paddingVertical: 1,
    borderRadius: 3,
    overflow: 'hidden',
  },
  yLabelTop: {
    // Offset down so label is centered on the top line
    marginTop: -2,
  },
  yLabelBottom: {
    // Offset up so label is centered on the bottom line
    marginBottom: -4,
  },
  yLabelDark: {
    color: darkColors.textMuted,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
  },
});

import React, { useMemo, useRef, useState, useCallback } from 'react';
import { View, StyleSheet, Text, TouchableOpacity } from 'react-native';
import { useTheme } from '@/hooks';
import { CartesianChart, Area } from 'victory-native';
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
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { colors, darkColors, typography, layout, shadows, chartStyles } from '@/theme';
import { useMetricSystem, POWER_ZONE_COLORS, HR_ZONE_COLORS } from '@/hooks';
import type { ChartConfig, ChartTypeId } from '@/lib';
import { formatDuration, isCyclingActivity } from '@/lib';
import type { ActivityStreams, ActivityInterval, ActivityType } from '@/types';
import { CHART_CONFIG } from '@/constants';
import { ChartErrorBoundary } from '@/components/ui';

interface DataSeries {
  id: ChartTypeId;
  config: ChartConfig;
  rawData: number[];
  color: string;
}

/** Per-series metric value exposed to parent for display in chips */
export interface ChartMetricValue {
  id: ChartTypeId;
  label: string;
  value: string;
  unit: string;
  color: string;
  /** Longest formatted value (for stable chip width during scrubbing) */
  maxValueWidth?: string;
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
  const { chartData, seriesInfo, indexMap, maxX } = useMemo(() => {
    // Choose x-axis source array based on mode
    const xSource = xAxisMode === 'time' ? streams.time || [] : streams.distance || [];
    if (xSource.length === 0) {
      return {
        chartData: [],
        seriesInfo: [] as (DataSeries & {
          range: { min: number; max: number; range: number };
          isPreview?: boolean;
        })[],
        indexMap: [] as number[],
        maxX: 1,
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
        maxX: 1,
      };
    }

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
  }, [streams, selectedCharts, chartConfigs, isMetric, previewMetricId, xAxisMode]);

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
        const merged = [
          ...valuesWithMax,
          ...allAverages.filter((a) => !scrubIds.has(a.id)),
        ];
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
  const allAverages = useMemo((): ChartMetricValue[] => {
    const results: ChartMetricValue[] = [];
    for (const chartId of Object.keys(chartConfigs) as ChartTypeId[]) {
      const config = chartConfigs[chartId];
      if (!config) continue;
      const rawData = config.getStream?.(streams);
      if (!rawData || rawData.length === 0) continue;

      const validValues = rawData.filter((v) => !isNaN(v) && isFinite(v));
      if (validValues.length === 0) continue;

      let avg = validValues.reduce((sum, v) => sum + v, 0) / validValues.length;
      if (!isMetric && config.convertToImperial) {
        avg = config.convertToImperial(avg);
      }
      const formatted = config.formatValue
        ? config.formatValue(avg, isMetric)
        : Math.round(avg).toString();

      // Compute widest formatted value (max of stream) for stable chip width
      let maxRaw = Math.max(...validValues);
      if (!isMetric && config.convertToImperial) {
        maxRaw = config.convertToImperial(maxRaw);
      }
      const maxFormatted = config.formatValue
        ? config.formatValue(maxRaw, isMetric)
        : Math.round(maxRaw).toString();

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
  }, [chartConfigs, streams, isMetric]);

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

  // Calculate normalized average position for the Y-axis series (for average line)
  const yAxisAvgNormalized = useMemo(() => {
    if (!yAxisSeries) return null;
    const validValues = yAxisSeries.rawData.filter((v) => !isNaN(v) && isFinite(v));
    if (validValues.length === 0) return null;
    const rawAvg = validValues.reduce((sum, v) => sum + v, 0) / validValues.length;
    const { min, range } = yAxisSeries.range;
    return (rawAvg - min) / range;
  }, [yAxisSeries]);

  // Compute interval bands when interval data is provided
  const intervalBands = useMemo(() => {
    if (!intervals || intervals.length === 0 || chartData.length === 0) return [];
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
        if (isDark && interval.zone === 7) bandColor = '#B0B0B0';
        bandOpacity = 0.35;
      } else if (isWork) {
        bandColor = colors.primary;
        bandOpacity = 0.30;
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
  }, [intervals, chartData, streams, xAxisMode, isMetric, isDark, activityType, seriesInfo]);

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
                const toPixelY = (normVal: number) =>
                  chartBounds.top + (1 - normVal) * chartH;

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

                    {/* Stream area fills */}
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
              <Text style={[styles.xLabel, isDark && styles.xLabelDark]}>
                {xAxisMode === 'time' ? '0:00' : '0'}
              </Text>
              <Text style={[styles.xAxisHint, isDark && styles.xAxisHintDark]}>
                {t('activity.chartHint', 'Hold to scrub • Hold chip for axis')}
              </Text>
              <Text style={[styles.xLabel, isDark && styles.xLabelDark]}>
                {xAxisMode === 'time' ? formatDuration(maxX) : maxX.toFixed(1)}
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

            {/* X-axis indicator - overlaid on bottom right of chart */}
            {canToggleXAxis && onXAxisModeToggle ? (
              <TouchableOpacity
                style={[
                  styles.distanceIndicator,
                  styles.distanceIndicatorTappable,
                  isDark && styles.distanceIndicatorDark,
                  isDark && styles.distanceIndicatorTappableDark,
                ]}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  onXAxisModeToggle();
                }}
                activeOpacity={0.7}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Text style={[styles.distanceText, isDark && styles.distanceTextDark]}>
                  {xAxisMode === 'time'
                    ? formatDuration(isActive && currentX !== null ? currentX : maxX)
                    : isActive && currentX !== null
                      ? `${currentX.toFixed(2)} ${xUnit}`
                      : `${maxX.toFixed(1)} ${xUnit}`}
                </Text>
                <MaterialCommunityIcons
                  name="swap-horizontal"
                  size={12}
                  color={isDark ? darkColors.textSecondary : colors.textSecondary}
                  style={styles.swapIcon}
                />
              </TouchableOpacity>
            ) : (
              <View
                style={[styles.distanceIndicator, isDark && styles.distanceIndicatorDark]}
                pointerEvents="none"
              >
                <Text style={[styles.distanceText, isDark && styles.distanceTextDark]}>
                  {xAxisMode === 'time'
                    ? formatDuration(isActive && currentX !== null ? currentX : maxX)
                    : isActive && currentX !== null
                      ? `${currentX.toFixed(2)} ${xUnit}`
                      : `${maxX.toFixed(1)} ${xUnit}`}
                </Text>
              </View>
            )}
          </View>
        </GestureDetector>
      </View>
    </ChartErrorBoundary>
  );
});

const styles = StyleSheet.create({
  container: {},
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
  distanceIndicatorTappable: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: 'rgba(0, 0, 0, 0.1)',
  },
  distanceIndicatorTappableDark: {
    borderColor: 'rgba(255, 255, 255, 0.15)',
  },
  distanceIndicatorDark: {
    backgroundColor: darkColors.surfaceOverlay,
  },
  swapIcon: {
    marginLeft: 3,
  },
  distanceText: {
    fontSize: typography.label.fontSize,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  distanceTextDark: {
    color: darkColors.textPrimary,
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

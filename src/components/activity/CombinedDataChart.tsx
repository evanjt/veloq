import React, { useMemo, useRef, useState, useCallback } from 'react';
import { View, StyleSheet, useColorScheme } from 'react-native';
import { Text } from 'react-native-paper';
import { CartesianChart, Area } from 'victory-native';
import { LinearGradient, vec } from '@shopify/react-native-skia';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useSharedValue, useAnimatedReaction, runOnJS, useDerivedValue, useAnimatedStyle } from 'react-native-reanimated';
import { getLocales } from 'expo-localization';
import { colors, typography } from '@/theme';
import type { ChartConfig, ChartTypeId } from '@/lib/chartConfig';
import type { ActivityStreams } from '@/types';


interface DataSeries {
  id: ChartTypeId;
  config: ChartConfig;
  rawData: number[];
  color: string;
}

interface CombinedDataChartProps {
  streams: ActivityStreams;
  selectedCharts: ChartTypeId[];
  chartConfigs: Record<ChartTypeId, ChartConfig>;
  height?: number;
  onPointSelect?: (index: number | null) => void;
  onInteractionChange?: (isInteracting: boolean) => void;
}

interface TooltipData {
  distance: number;
  values: { id: ChartTypeId; label: string; value: string; unit: string; color: string }[];
}

function useMetricSystem(): boolean {
  try {
    const locales = getLocales();
    const locale = locales[0];
    const imperialCountries = ['US', 'LR', 'MM'];
    return !imperialCountries.includes(locale?.regionCode || '');
  } catch {
    return true;
  }
}

export function CombinedDataChart({
  streams,
  selectedCharts,
  chartConfigs,
  height = 180,
  onPointSelect,
  onInteractionChange,
}: CombinedDataChartProps) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const isMetric = useMetricSystem();

  // Shared values for UI thread gesture tracking (native 120Hz performance)
  const touchX = useSharedValue(-1); // -1 means not touching
  const xValuesShared = useSharedValue<number[]>([]);
  const chartBoundsShared = useSharedValue({ left: 0, right: 1 });
  // Store Victory Native's actual rendered x-coordinates for smooth crosshair
  const pointXCoordsShared = useSharedValue<number[]>([]);

  // React state for tooltip (bridges to JS only for text updates)
  const [tooltipData, setTooltipData] = useState<TooltipData | null>(null);
  const [isActive, setIsActive] = useState(false);

  const onPointSelectRef = useRef(onPointSelect);
  const onInteractionChangeRef = useRef(onInteractionChange);
  onPointSelectRef.current = onPointSelect;
  onInteractionChangeRef.current = onInteractionChange;

  // Track last notified index to avoid redundant updates
  const lastNotifiedIdx = useRef<number | null>(null);

  // Build normalized data for all selected series
  const { chartData, seriesInfo, indexMap, maxDist } = useMemo(() => {
    const distance = streams.distance || [];
    if (distance.length === 0) {
      return { chartData: [], seriesInfo: [] as (DataSeries & { range: { min: number; max: number; range: number } })[], indexMap: [] as number[], maxDist: 1 };
    }

    // Collect all series data
    const series: DataSeries[] = [];
    for (const chartId of selectedCharts) {
      const config = chartConfigs[chartId];
      if (!config) continue;
      const rawData = config.getStream(streams);
      if (!rawData || rawData.length === 0) continue;
      series.push({
        id: chartId,
        config,
        rawData,
        color: config.color,
      });
    }

    if (series.length === 0) {
      return { chartData: [], seriesInfo: [] as (DataSeries & { range: { min: number; max: number; range: number } })[], indexMap: [] as number[], maxDist: 1 };
    }

    // Downsample and normalize
    const maxPoints = 200;
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
  }, [streams, selectedCharts, chartConfigs, isMetric]);

  // Sync x-values to shared value for UI thread access
  React.useEffect(() => {
    xValuesShared.value = chartData.map(d => d.x);
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

  // Bridge to JS only when index changes (for tooltip text and parent notification)
  const updateTooltipOnJS = useCallback((idx: number) => {
    if (idx < 0 || chartData.length === 0 || seriesInfo.length === 0) {
      if (lastNotifiedIdx.current !== null) {
        setTooltipData(null);
        setIsActive(false);
        lastNotifiedIdx.current = null;
        if (onPointSelectRef.current) onPointSelectRef.current(null);
        if (onInteractionChangeRef.current) onInteractionChangeRef.current(false);
      }
      return;
    }

    // Skip if same index
    if (idx === lastNotifiedIdx.current) return;
    lastNotifiedIdx.current = idx;

    if (!isActive) {
      setIsActive(true);
      if (onInteractionChangeRef.current) onInteractionChangeRef.current(true);
    }

    // Build tooltip data with actual values (not normalized)
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
        unit: isMetric ? s.config.unit : (s.config.unitImperial || s.config.unit),
        color: s.color,
      };
    });

    setTooltipData({
      distance: chartData[idx]?.x ?? 0,
      values,
    });

    // Notify parent of original data index for map sync
    if (onPointSelectRef.current && idx < indexMap.length) {
      onPointSelectRef.current(indexMap[idx]);
    }
  }, [chartData, seriesInfo, indexMap, isMetric, isActive]);

  // React to index changes and bridge to JS for tooltip updates
  useAnimatedReaction(
    () => selectedIdx.value,
    (idx) => {
      runOnJS(updateTooltipOnJS)(idx);
    },
    [updateTooltipOnJS]
  );

  // Gesture handler - updates shared values on UI thread (no JS bridge for position)
  const gesture = Gesture.Pan()
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
    })
    .minDistance(0);

  // Animated crosshair style - uses actual point coordinates for accuracy, runs at 120Hz
  const crosshairStyle = useAnimatedStyle(() => {
    'worklet';
    const idx = selectedIdx.value;
    const coords = pointXCoordsShared.value;

    if (idx < 0 || coords.length === 0 || idx >= coords.length) {
      return { opacity: 0, transform: [{ translateX: 0 }] };
    }

    return {
      opacity: 1,
      transform: [{ translateX: coords[idx] }],
    };
  }, []);

  const distanceUnit = isMetric ? 'km' : 'mi';

  if (chartData.length === 0 || seriesInfo.length === 0) {
    return (
      <View style={[styles.placeholder, { height }]}>
        <Text style={[styles.placeholderText, isDark && styles.textDark]}>No data available</Text>
      </View>
    );
  }

  // Build yKeys array for CartesianChart
  const yKeys = seriesInfo.map((s) => s.id);

  return (
    <View style={[styles.container, { height }]}>
      <GestureDetector gesture={gesture}>
        <View style={styles.chartWrapper}>
          {/* Combined tooltip */}
          {isActive && tooltipData && (
            <View style={[styles.tooltip, isDark && styles.tooltipDark]} pointerEvents="none">
              <Text style={[styles.tooltipDistance, isDark && styles.tooltipTextDark]}>
                {tooltipData.distance.toFixed(2)} {distanceUnit}
              </Text>
              <View style={styles.tooltipValues}>
                {tooltipData.values.map((v) => (
                  <View key={v.id} style={styles.tooltipItem}>
                    <View style={[styles.tooltipDot, { backgroundColor: v.color }]} />
                    <Text style={[styles.tooltipValue, isDark && styles.tooltipTextDark]}>
                      {v.value}
                    </Text>
                    <Text style={[styles.tooltipUnit, isDark && styles.tooltipUnitDark]}>
                      {v.unit}
                    </Text>
                  </View>
                ))}
              </View>
            </View>
          )}

          <CartesianChart
            data={chartData}
            xKey="x"
            yKeys={yKeys as any}
            domain={{ y: [0, 1] }}
            padding={{ left: 0, right: 0, top: 4, bottom: 16 }}
          >
            {({ points, chartBounds }) => {
              // Sync chartBounds and point coordinates for UI thread crosshair
              if (chartBounds.left !== chartBoundsShared.value.left ||
                  chartBounds.right !== chartBoundsShared.value.right) {
                chartBoundsShared.value = { left: chartBounds.left, right: chartBounds.right };
              }
              // Sync actual point x-coordinates for accurate crosshair positioning
              if (seriesInfo.length > 0) {
                const firstSeriesPoints = (points as any)[seriesInfo[0].id];
                if (firstSeriesPoints) {
                  const newCoords = firstSeriesPoints.map((p: any) => p.x);
                  if (newCoords.length !== pointXCoordsShared.value.length ||
                      newCoords[0] !== pointXCoordsShared.value[0]) {
                    pointXCoordsShared.value = newCoords;
                  }
                }
              }

              return (
                <>
                  {seriesInfo.map((series) => (
                    <Area
                      key={series.id}
                      points={(points as any)[series.id]}
                      y0={chartBounds.bottom}
                      curveType="natural"
                      opacity={0.85}
                    >
                      <LinearGradient
                        start={vec(0, chartBounds.top)}
                        end={vec(0, chartBounds.bottom)}
                        colors={[series.color + 'DD', series.color + '50']}
                      />
                    </Area>
                  ))}
                </>
              );
            }}
          </CartesianChart>

          {/* Animated crosshair - runs at native 120Hz using synced point coordinates */}
          <Animated.View
            style={[styles.crosshair, crosshairStyle, isDark && styles.crosshairDark]}
            pointerEvents="none"
          />

          {/* Legend */}
          <View style={styles.legend} pointerEvents="none">
            {seriesInfo.map((s) => (
              <View key={s.id} style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: s.color }]} />
                <Text style={[styles.legendLabel, isDark && styles.legendLabelDark]}>
                  {s.config.label}
                </Text>
              </View>
            ))}
          </View>

          {/* X-axis labels */}
          <View style={styles.xAxisOverlay} pointerEvents="none">
            <Text style={[styles.overlayLabel, isDark && styles.overlayLabelDark]}>0</Text>
            <Text style={[styles.overlayLabel, isDark && styles.overlayLabelDark]}>
              {maxDist.toFixed(1)} {distanceUnit}
            </Text>
          </View>
        </View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {},
  chartWrapper: {
    flex: 1,
    position: 'relative',
  },
  crosshair: {
    position: 'absolute',
    top: 4,
    bottom: 16,
    width: 1.5,
    backgroundColor: '#666',
  },
  crosshairDark: {
    backgroundColor: '#AAA',
  },
  placeholder: {
    backgroundColor: colors.background,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 8,
  },
  placeholderText: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  textDark: {
    color: '#AAA',
  },
  tooltip: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 6,
    zIndex: 10,
  },
  tooltipDark: {
    backgroundColor: 'rgba(40, 40, 40, 0.95)',
  },
  tooltipDistance: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.textSecondary,
    marginBottom: 4,
  },
  tooltipValues: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  tooltipItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  tooltipDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 4,
  },
  tooltipValue: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  tooltipUnit: {
    fontSize: 11,
    color: colors.textSecondary,
    marginLeft: 2,
  },
  tooltipTextDark: {
    color: '#FFFFFF',
  },
  tooltipUnitDark: {
    color: '#AAA',
  },
  legend: {
    position: 'absolute',
    top: 4,
    right: 4,
    flexDirection: 'row',
    gap: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.8)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  legendDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 3,
  },
  legendLabel: {
    fontSize: 9,
    color: colors.textSecondary,
  },
  legendLabelDark: {
    color: '#AAA',
  },
  xAxisOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 2,
    right: 2,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  overlayLabel: {
    fontSize: 9,
    color: colors.textSecondary,
    backgroundColor: 'rgba(255, 255, 255, 0.7)',
    paddingHorizontal: 2,
    borderRadius: 2,
    overflow: 'hidden',
  },
  overlayLabelDark: {
    color: '#CCC',
    backgroundColor: 'rgba(30, 30, 30, 0.7)',
  },
});

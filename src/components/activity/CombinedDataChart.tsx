import React, { useMemo, useRef, useEffect } from 'react';
import { View, StyleSheet, useColorScheme } from 'react-native';
import { Text } from 'react-native-paper';
import { CartesianChart, Area, useChartPressState } from 'victory-native';
import { Circle, Line as SkiaLine, LinearGradient, vec } from '@shopify/react-native-skia';
import { getLocales } from 'expo-localization';
import { useDerivedValue, useAnimatedReaction, runOnJS } from 'react-native-reanimated';
import { colors, typography } from '@/theme';
import type { SharedValue } from 'react-native-reanimated';
import type { ChartConfig, ChartTypeId } from '@/lib/chartConfig';
import type { ActivityStreams } from '@/types';

const TOUCH_OFFSET_CORRECTION = 30;

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
  const [tooltipData, setTooltipData] = React.useState<TooltipData | null>(null);
  const onPointSelectRef = useRef(onPointSelect);
  const onInteractionChangeRef = useRef(onInteractionChange);
  onPointSelectRef.current = onPointSelect;
  onInteractionChangeRef.current = onInteractionChange;

  const chartBoundsRef = useRef({ left: 0, right: 0 });
  const { state, isActive } = useChartPressState({ x: 0, y: { y: 0 } });

  useEffect(() => {
    if (onInteractionChangeRef.current) {
      onInteractionChangeRef.current(isActive);
    }
  }, [isActive]);

  // Build normalized data for all selected series
  const { chartData, seriesInfo, indexMap, maxDist } = useMemo(() => {
    const distance = streams.distance || [];
    if (distance.length === 0) {
      return { chartData: [], seriesInfo: [] as DataSeries[], indexMap: [] as number[], maxDist: 1 };
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
      return { chartData: [], seriesInfo: [] as DataSeries[], indexMap: [] as number[], maxDist: 1 };
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
    return {
      chartData: points,
      seriesInfo: series.map((s, idx) => ({ ...s, range: seriesRanges[idx] })),
      indexMap: indices,
      maxDist: Math.max(...distances),
    };
  }, [streams, selectedCharts, chartConfigs, isMetric]);

  // Handle data lookup
  const handleDataLookup = React.useCallback(
    (matchedIndex: number) => {
      if (chartData.length === 0 || seriesInfo.length === 0) return;

      const bounds = chartBoundsRef.current;
      const chartWidth = bounds.right - bounds.left;

      let indexOffset = 25;
      if (chartWidth > 0 && chartData.length > 1) {
        const pixelsPerPoint = chartWidth / (chartData.length - 1);
        indexOffset = Math.round(TOUCH_OFFSET_CORRECTION / pixelsPerPoint);
      }

      const correctedIndex = Math.max(0, Math.min(chartData.length - 1, matchedIndex - indexOffset));
      const point = chartData[correctedIndex];

      if (point) {
        // Build tooltip data with actual values (not normalized)
        const originalIdx = indexMap[correctedIndex];
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
          distance: point.x,
          values,
        });

        if (onPointSelectRef.current && correctedIndex < indexMap.length) {
          onPointSelectRef.current(indexMap[correctedIndex]);
        }
      }
    },
    [chartData, seriesInfo, indexMap, isMetric]
  );

  const handleClearSelection = React.useCallback(() => {
    setTooltipData(null);
    if (onPointSelectRef.current) {
      onPointSelectRef.current(null);
    }
  }, []);

  useAnimatedReaction(
    () => ({
      matchedIndex: state.matchedIndex.value,
      active: isActive,
    }),
    (current) => {
      if (current.active) {
        runOnJS(handleDataLookup)(current.matchedIndex);
      } else {
        runOnJS(handleClearSelection)();
      }
    },
    [isActive, handleDataLookup, handleClearSelection]
  );

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
          chartPressState={state}
          gestureLongPressDelay={50}
        >
          {({ points, chartBounds }) => {
            chartBoundsRef.current = { left: chartBounds.left, right: chartBounds.right };

            return (
              <>
                {/* Render area for each series */}
                {seriesInfo.map((series) => (
                  <Area
                    key={series.id}
                    points={(points as any)[series.id]}
                    y0={chartBounds.bottom}
                    curveType="natural"
                    opacity={0.6}
                  >
                    <LinearGradient
                      start={vec(0, chartBounds.top)}
                      end={vec(0, chartBounds.bottom)}
                      colors={[series.color + '99', series.color + '10']}
                    />
                  </Area>
                ))}

                {/* Crosshair */}
                {isActive && (
                  <ActiveCrosshair
                    xPosition={state.x.position}
                    top={chartBounds.top}
                    bottom={chartBounds.bottom}
                    isDark={isDark}
                  />
                )}
              </>
            );
          }}
        </CartesianChart>

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
    </View>
  );
}

function ActiveCrosshair({
  xPosition,
  top,
  bottom,
  isDark,
}: {
  xPosition: SharedValue<number>;
  top: number;
  bottom: number;
  isDark: boolean;
}) {
  const correctedX = useDerivedValue(() => xPosition.value - TOUCH_OFFSET_CORRECTION);
  const lineStart = useDerivedValue(() => vec(correctedX.value, top));
  const lineEnd = useDerivedValue(() => vec(correctedX.value, bottom));

  return (
    <SkiaLine
      p1={lineStart}
      p2={lineEnd}
      color={isDark ? '#888' : '#666'}
      strokeWidth={1.5}
      style="stroke"
    />
  );
}

const styles = StyleSheet.create({
  container: {},
  chartWrapper: {
    flex: 1,
    position: 'relative',
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

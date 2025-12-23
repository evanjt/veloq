import React, { useMemo, useCallback, useState, useRef } from 'react';
import { View, StyleSheet, useColorScheme } from 'react-native';
import { Text } from 'react-native-paper';
import { CartesianChart, Line } from 'victory-native';
import { DashPathEffect, Line as SkiaLine } from '@shopify/react-native-skia';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useSharedValue, useAnimatedReaction, runOnJS, useDerivedValue, useAnimatedStyle } from 'react-native-reanimated';
import { colors, spacing } from '@/theme';
import { usePaceCurve, paceToMinPer100m } from '@/hooks';

interface SwimPaceCurveChartProps {
  /** Number of days to include (default 365) */
  days?: number;
  height?: number;
}

const CHART_COLOR = '#2196F3';
const CSS_LINE_COLOR = 'rgba(150, 150, 150, 0.6)';

// Format pace as min:sec per 100m
function formatPace100m(metersPerSecond: number): string {
  if (metersPerSecond <= 0 || !isFinite(metersPerSecond)) return '--:--';
  const { minutes, seconds } = paceToMinPer100m(metersPerSecond);
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

// Format time as mm:ss or h:mm:ss
function formatTime(totalSeconds: number): string {
  if (totalSeconds <= 0 || !isFinite(totalSeconds)) return '--:--';
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.round(totalSeconds % 60);
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

// Format distance
function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)}m`;
  if (meters < 10000) return `${(meters / 1000).toFixed(1)}km`;
  return `${Math.round(meters / 1000)}km`;
}

// Convert m/s to seconds per 100m
function speedToSecsPer100m(metersPerSecond: number): number {
  if (metersPerSecond <= 0) return 0;
  return 100 / metersPerSecond;
}

interface ChartPoint {
  x: number;
  y: number;
  distance: number;
  time: number;
  paceSecsPer100m: number;
  paceMs: number; // Original m/s for display
  [key: string]: unknown;
}

export function SwimPaceCurveChart({
  days = 365,
  height = 200,
}: SwimPaceCurveChartProps) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';

  const { data: curve, isLoading, error } = usePaceCurve({ sport: 'Swim', days });

  const [tooltipData, setTooltipData] = useState<ChartPoint | null>(null);
  const [isActive, setIsActive] = useState(false);

  // Shared values for gesture tracking
  const touchX = useSharedValue(-1);
  const chartBoundsShared = useSharedValue({ left: 0, right: 1 });
  const pointXCoordsShared = useSharedValue<number[]>([]);
  const lastNotifiedIdx = useRef<number | null>(null);

  // Process curve data - use distances directly from API
  const { chartData, cssPace, yDomain } = useMemo(() => {
    if (!curve?.distances || !curve?.times || curve.distances.length === 0) {
      return { chartData: [], cssPace: null, yDomain: [90, 180] as [number, number] };
    }

    const points: ChartPoint[] = [];

    for (let i = 0; i < curve.distances.length; i++) {
      const distance = curve.distances[i];
      const time = curve.times[i];
      const speed = curve.pace[i];
      if (distance > 0 && time > 0 && speed > 0) {
        const paceSecsPer100m = speedToSecsPer100m(speed);

        // Filter reasonable swim paces (50s to 4min per 100m) and reasonable distances
        if (paceSecsPer100m >= 50 && paceSecsPer100m <= 240 && distance >= 25) {
          points.push({ x: 0, y: 0, distance, paceSecsPer100m, paceMs: speed, time });
        }
      }
    }

    if (points.length === 0) {
      return { chartData: [], cssPace: null, yDomain: [90, 180] as [number, number] };
    }

    points.sort((a, b) => a.distance - b.distance);

    // Sample for smoother curve
    const sampled: typeof points = [];
    let lastDist = 0;
    for (const p of points) {
      const minGap = p.distance < 200 ? 10 : (p.distance < 1000 ? 50 : 100);
      if (p.distance - lastDist >= minGap) {
        sampled.push(p);
        lastDist = p.distance;
      }
    }

    // Use log scale for x-axis
    const data = sampled.map(p => ({
      ...p,
      x: Math.log10(p.distance),
      y: p.paceSecsPer100m,
    }));

    const cssSecsPer100m = curve.criticalSpeed ? speedToSecsPer100m(curve.criticalSpeed) : null;

    const paces = data.map(d => d.y);
    const minPace = Math.min(...paces);  // fastest
    const maxPace = Math.max(...paces);  // slowest
    const padding = (maxPace - minPace) * 0.1;

    return {
      chartData: data,
      cssPace: cssSecsPer100m,
      // Invert y domain: [max, min] puts faster paces (lower values) at TOP
      yDomain: [maxPace + padding, minPace - padding] as [number, number],
    };
  }, [curve]);

  // Derive selected index
  const selectedIdx = useDerivedValue(() => {
    'worklet';
    const len = chartData.length;
    const bounds = chartBoundsShared.value;
    const chartWidth = bounds.right - bounds.left;

    if (touchX.value < 0 || chartWidth <= 0 || len === 0) return -1;

    const chartX = touchX.value - bounds.left;
    const ratio = Math.max(0, Math.min(1, chartX / chartWidth));
    const idx = Math.round(ratio * (len - 1));

    return Math.min(Math.max(0, idx), len - 1);
  }, [chartData.length]);

  const updateTooltipOnJS = useCallback(
    (idx: number) => {
      if (idx < 0 || chartData.length === 0) {
        if (lastNotifiedIdx.current !== null) {
          setTooltipData(null);
          setIsActive(false);
          lastNotifiedIdx.current = null;
        }
        return;
      }

      if (idx === lastNotifiedIdx.current) return;
      lastNotifiedIdx.current = idx;

      if (!isActive) setIsActive(true);

      const point = chartData[idx];
      if (point) setTooltipData(point);
    },
    [chartData, isActive]
  );

  useAnimatedReaction(
    () => selectedIdx.value,
    (idx) => { runOnJS(updateTooltipOnJS)(idx); },
    [updateTooltipOnJS]
  );

  const gesture = Gesture.Pan()
    .onStart((e) => { 'worklet'; touchX.value = e.x; })
    .onUpdate((e) => { 'worklet'; touchX.value = e.x; })
    .onEnd(() => { 'worklet'; touchX.value = -1; })
    .minDistance(0);

  const crosshairStyle = useAnimatedStyle(() => {
    'worklet';
    // Use touchX directly so crosshair always follows the finger exactly
    if (touchX.value < 0) {
      return { opacity: 0, transform: [{ translateX: 0 }] };
    }

    // Clamp to chart bounds
    const bounds = chartBoundsShared.value;
    const xPos = Math.max(bounds.left, Math.min(bounds.right, touchX.value));

    return { opacity: 1, transform: [{ translateX: xPos }] };
  }, []);

  if (isLoading) {
    return (
      <View style={[styles.container, { height }]}>
        <Text style={[styles.title, isDark && styles.textLight]}>Swim Pace Curve</Text>
        <View style={styles.loadingContainer}>
          <Text style={[styles.loadingText, isDark && styles.textDark]}>Loading...</Text>
        </View>
      </View>
    );
  }

  if (error || chartData.length === 0) {
    return (
      <View style={[styles.container, { height }]}>
        <Text style={[styles.title, isDark && styles.textLight]}>Swim Pace Curve</Text>
        <View style={styles.emptyState}>
          <Text style={[styles.emptyText, isDark && styles.textDark]}>No swim pace data available</Text>
        </View>
      </View>
    );
  }

  // Display data - either selected point or latest
  const displayData = tooltipData || chartData[chartData.length - 1];

  return (
    <View style={[styles.container, { height }]}>
      {/* Header with values */}
      <View style={styles.header}>
        <Text style={[styles.title, isDark && styles.textLight]}>Swim Pace Curve</Text>
        <View style={styles.valuesRow}>
          <View style={styles.valueItem}>
            <Text style={[styles.valueLabel, isDark && styles.textDark]}>Distance</Text>
            <Text style={[styles.valueNumber, { color: CHART_COLOR }]}>
              {formatDistance(displayData.distance)}
            </Text>
          </View>
          <View style={styles.valueItem}>
            <Text style={[styles.valueLabel, isDark && styles.textDark]}>Time</Text>
            <Text style={[styles.valueNumber, isDark && styles.textLight]}>
              {formatTime(displayData.time)}
            </Text>
          </View>
          <View style={styles.valueItem}>
            <Text style={[styles.valueLabel, isDark && styles.textDark]}>Pace</Text>
            <Text style={[styles.valueNumber, { color: CHART_COLOR }]}>
              {formatPace100m(displayData.paceMs)}/100m
            </Text>
          </View>
        </View>
      </View>

      {/* Chart */}
      <GestureDetector gesture={gesture}>
        <View style={styles.chartWrapper}>
          <CartesianChart
            data={chartData}
            xKey="x"
            yKeys={['y']}
            domain={{ y: yDomain }}
            padding={{ left: 0, right: 0, top: 4, bottom: 0 }}
          >
            {({ points, chartBounds }) => {
              // Sync bounds for gesture
              if (chartBounds.left !== chartBoundsShared.value.left ||
                  chartBounds.right !== chartBoundsShared.value.right) {
                chartBoundsShared.value = { left: chartBounds.left, right: chartBounds.right };
              }
              const newCoords = points.y.filter(p => p.x != null).map(p => p.x as number);
              if (newCoords.length !== pointXCoordsShared.value.length) {
                pointXCoordsShared.value = newCoords;
              }

              return (
                <>
                  {/* CSS line */}
                  {cssPace && cssPace >= yDomain[0] && cssPace <= yDomain[1] && (
                    <SkiaLine
                      p1={{
                        x: chartBounds.left,
                        y: chartBounds.top + ((cssPace - yDomain[0]) / (yDomain[1] - yDomain[0])) * (chartBounds.bottom - chartBounds.top),
                      }}
                      p2={{
                        x: chartBounds.right,
                        y: chartBounds.top + ((cssPace - yDomain[0]) / (yDomain[1] - yDomain[0])) * (chartBounds.bottom - chartBounds.top),
                      }}
                      color={CSS_LINE_COLOR}
                      strokeWidth={1}
                    >
                      <DashPathEffect intervals={[6, 4]} />
                    </SkiaLine>
                  )}

                  {/* Pace curve */}
                  <Line
                    points={points.y}
                    color={CHART_COLOR}
                    strokeWidth={2.5}
                    curveType="natural"
                  />
                </>
              );
            }}
          </CartesianChart>

          {/* Crosshair */}
          <Animated.View
            style={[styles.crosshair, crosshairStyle, isDark && styles.crosshairDark]}
            pointerEvents="none"
          />

          {/* X-axis labels */}
          <View style={styles.xAxisOverlay} pointerEvents="none">
            <Text style={[styles.axisLabel, isDark && styles.axisLabelDark]}>100m</Text>
            <Text style={[styles.axisLabel, isDark && styles.axisLabelDark]}>200m</Text>
            <Text style={[styles.axisLabel, isDark && styles.axisLabelDark]}>400m</Text>
            <Text style={[styles.axisLabel, isDark && styles.axisLabelDark]}>800m</Text>
            <Text style={[styles.axisLabel, isDark && styles.axisLabelDark]}>1.5K</Text>
          </View>

          {/* Y-axis labels - note: axis is inverted so top is fastest (yDomain[1]), bottom is slowest (yDomain[0]) */}
          <View style={styles.yAxisOverlay} pointerEvents="none">
            <Text style={[styles.axisLabel, isDark && styles.axisLabelDark]}>
              {Math.floor(yDomain[1] / 60)}:{Math.round(yDomain[1] % 60).toString().padStart(2, '0')}
            </Text>
            <Text style={[styles.axisLabel, isDark && styles.axisLabelDark]}>
              {Math.floor((yDomain[0] + yDomain[1]) / 2 / 60)}:{Math.round((yDomain[0] + yDomain[1]) / 2 % 60).toString().padStart(2, '0')}
            </Text>
            <Text style={[styles.axisLabel, isDark && styles.axisLabelDark]}>
              {Math.floor(yDomain[0] / 60)}:{Math.round(yDomain[0] % 60).toString().padStart(2, '0')}
            </Text>
          </View>
        </View>
      </GestureDetector>

      {/* CSS Legend */}
      {cssPace && (
        <View style={styles.legend}>
          <View style={[styles.legendDash, { backgroundColor: CSS_LINE_COLOR }]} />
          <Text style={[styles.legendText, isDark && styles.textDark]}>
            CSS {Math.floor(cssPace / 60)}:{Math.round(cssPace % 60).toString().padStart(2, '0')}/100m
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {},
  title: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  textLight: { color: '#FFFFFF' },
  textDark: { color: '#888' },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  valuesRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  valueItem: {
    alignItems: 'flex-end',
  },
  valueLabel: {
    fontSize: 9,
    color: colors.textSecondary,
    marginBottom: 1,
  },
  valueNumber: {
    fontSize: 14,
    fontWeight: '700',
  },
  chartWrapper: {
    flex: 1,
    position: 'relative',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  crosshair: {
    position: 'absolute',
    top: 4,
    bottom: 20,
    width: 1.5,
    backgroundColor: '#666',
  },
  crosshairDark: {
    backgroundColor: '#AAA',
  },
  xAxisOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
  },
  yAxisOverlay: {
    position: 'absolute',
    top: 4,
    bottom: 20,
    left: 4,
    justifyContent: 'space-between',
  },
  axisLabel: {
    fontSize: 10,
    color: '#666',
    fontWeight: '500',
  },
  axisLabelDark: {
    color: '#AAA',
  },
  legend: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.xs,
    gap: 6,
  },
  legendDash: {
    width: 16,
    height: 2,
    borderRadius: 1,
  },
  legendText: {
    fontSize: 11,
    color: colors.textSecondary,
  },
});

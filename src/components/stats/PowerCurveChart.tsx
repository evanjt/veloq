import React, { useMemo, useCallback, useState, useRef } from 'react';
import { View, StyleSheet, useColorScheme } from 'react-native';
import { Text } from 'react-native-paper';
import { CartesianChart, Line } from 'victory-native';
import { DashPathEffect, Line as SkiaLine } from '@shopify/react-native-skia';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useSharedValue, useAnimatedReaction, runOnJS, useDerivedValue, useAnimatedStyle } from 'react-native-reanimated';
import { colors, spacing } from '@/theme';
import { usePowerCurve } from '@/hooks';

interface PowerCurveChartProps {
  sport?: string;
  /** Number of days to include (default 365) */
  days?: number;
  height?: number;
  /** Chart color override */
  color?: string;
  /** FTP value for threshold line */
  ftp?: number | null;
}

// Chart colors
const DEFAULT_COLOR = '#FF6B00';
const FTP_LINE_COLOR = 'rgba(150, 150, 150, 0.6)';

// Format duration for display
function formatDuration(secs: number): string {
  if (secs < 60) return `${Math.round(secs)}s`;
  if (secs < 3600) {
    const mins = Math.floor(secs / 60);
    const remainingSecs = Math.round(secs % 60);
    return remainingSecs > 0 ? `${mins}:${remainingSecs.toString().padStart(2, '0')}` : `${mins}m`;
  }
  const hours = Math.floor(secs / 3600);
  const mins = Math.floor((secs % 3600) / 60);
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}

// Format duration compact for axis labels
function formatDurationCompact(secs: number): string {
  if (secs < 60) return `${Math.round(secs)}s`;
  if (secs < 3600) return `${Math.round(secs / 60)}m`;
  return `${(secs / 3600).toFixed(1)}h`;
}

interface ChartPoint {
  x: number;
  y: number;
  secs: number;
  watts: number;
  [key: string]: unknown;
}

export const PowerCurveChart = React.memo(function PowerCurveChart({
  sport,
  days = 365,
  height = 200,
  color = DEFAULT_COLOR,
  ftp,
}: PowerCurveChartProps) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';

  const { data: curve, isLoading, error } = usePowerCurve({ sport, days });

  const [tooltipData, setTooltipData] = useState<ChartPoint | null>(null);
  const [isActive, setIsActive] = useState(false);

  // Shared values for gesture tracking
  const touchX = useSharedValue(-1);
  const chartBoundsShared = useSharedValue({ left: 0, right: 1 });
  const pointXCoordsShared = useSharedValue<number[]>([]);
  const lastNotifiedIdx = useRef<number | null>(null);

  // Process curve data for the line chart
  const { chartData, ftpValue, yDomain } = useMemo(() => {
    if (!curve?.secs || !curve?.watts || curve.watts.length === 0) {
      return { chartData: [], ftpValue: ftp ?? null, yDomain: [0, 400] as [number, number] };
    }

    // Build data points from the curve
    const points: { secs: number; watts: number }[] = [];

    for (let i = 0; i < curve.secs.length; i++) {
      const secs = curve.secs[i];
      const watts = curve.watts[i];
      if (watts > 0 && secs > 0) {
        points.push({ secs, watts });
      }
    }

    if (points.length === 0) {
      return { chartData: [], ftpValue: ftp ?? null, yDomain: [0, 400] as [number, number] };
    }

    // Sort by duration
    points.sort((a, b) => a.secs - b.secs);

    // Sample points using logarithmic spacing for smooth curve
    const sampled: typeof points = [];
    const logMin = Math.log10(Math.max(1, points[0].secs));
    const logMax = Math.log10(points[points.length - 1].secs);
    const numSamples = 60;

    for (let i = 0; i < numSamples; i++) {
      const logVal = logMin + (logMax - logMin) * (i / (numSamples - 1));
      const targetSecs = Math.pow(10, logVal);

      // Find closest point
      let closest = points[0];
      let minDiff = Math.abs(points[0].secs - targetSecs);
      for (const p of points) {
        const diff = Math.abs(p.secs - targetSecs);
        if (diff < minDiff) {
          minDiff = diff;
          closest = p;
        }
      }

      // Avoid duplicates
      if (sampled.length === 0 || sampled[sampled.length - 1].secs !== closest.secs) {
        sampled.push(closest);
      }
    }

    // Convert to chart format (use log of duration for x to spread out short durations)
    const data: ChartPoint[] = sampled.map(p => ({
      x: Math.log10(p.secs),
      y: p.watts,
      secs: p.secs,
      watts: p.watts,
    }));

    // Calculate Y domain
    const watts = data.map(d => d.y);
    const minWatts = Math.min(...watts);
    const maxWatts = Math.max(...watts);
    const padding = (maxWatts - minWatts) * 0.1;

    return {
      chartData: data,
      ftpValue: ftp ?? null,
      yDomain: [Math.max(0, minWatts - padding), maxWatts + padding] as [number, number],
    };
  }, [curve, ftp]);

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
    .minDistance(0)
    .activateAfterLongPress(300);

  const crosshairStyle = useAnimatedStyle(() => {
    'worklet';
    const idx = selectedIdx.value;
    const coords = pointXCoordsShared.value;

    if (idx < 0 || coords.length === 0 || idx >= coords.length) {
      return { opacity: 0, transform: [{ translateX: 0 }] };
    }

    return { opacity: 1, transform: [{ translateX: coords[idx] }] };
  }, []);

  if (isLoading) {
    return (
      <View style={[styles.container, { height }]}>
        <Text style={[styles.title, isDark && styles.textLight]}>Power Curve</Text>
        <View style={styles.loadingContainer}>
          <Text style={[styles.loadingText, isDark && styles.textDark]}>Loading...</Text>
        </View>
      </View>
    );
  }

  if (error || chartData.length === 0) {
    return (
      <View style={[styles.container, { height }]}>
        <Text style={[styles.title, isDark && styles.textLight]}>Power Curve</Text>
        <View style={styles.emptyState}>
          <Text style={[styles.emptyText, isDark && styles.textDark]}>No power data available</Text>
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
        <Text style={[styles.title, isDark && styles.textLight]}>Power Curve</Text>
        <View style={styles.valuesRow}>
          <View style={styles.valueItem}>
            <Text style={[styles.valueLabel, isDark && styles.textDark]}>Time</Text>
            <Text style={[styles.valueNumber, { color }]}>
              {formatDuration(displayData.secs)}
            </Text>
          </View>
          <View style={styles.valueItem}>
            <Text style={[styles.valueLabel, isDark && styles.textDark]}>Power</Text>
            <Text style={[styles.valueNumber, { color }]}>
              {Math.round(displayData.watts)}w
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
                  {/* FTP horizontal line */}
                  {ftpValue && ftpValue >= yDomain[0] && ftpValue <= yDomain[1] && (
                    <SkiaLine
                      p1={{
                        x: chartBounds.left,
                        y: chartBounds.top + ((yDomain[1] - ftpValue) / (yDomain[1] - yDomain[0])) * (chartBounds.bottom - chartBounds.top),
                      }}
                      p2={{
                        x: chartBounds.right,
                        y: chartBounds.top + ((yDomain[1] - ftpValue) / (yDomain[1] - yDomain[0])) * (chartBounds.bottom - chartBounds.top),
                      }}
                      color={FTP_LINE_COLOR}
                      strokeWidth={1}
                    >
                      <DashPathEffect intervals={[6, 4]} />
                    </SkiaLine>
                  )}

                  {/* Power curve line */}
                  <Line
                    points={points.y}
                    color={color}
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
            <Text style={[styles.axisLabel, isDark && styles.axisLabelDark]}>5s</Text>
            <Text style={[styles.axisLabel, isDark && styles.axisLabelDark]}>1m</Text>
            <Text style={[styles.axisLabel, isDark && styles.axisLabelDark]}>5m</Text>
            <Text style={[styles.axisLabel, isDark && styles.axisLabelDark]}>20m</Text>
            <Text style={[styles.axisLabel, isDark && styles.axisLabelDark]}>1h</Text>
          </View>

          {/* Y-axis labels */}
          <View style={styles.yAxisOverlay} pointerEvents="none">
            <Text style={[styles.axisLabel, isDark && styles.axisLabelDark]}>{Math.round(yDomain[1])}w</Text>
            <Text style={[styles.axisLabel, isDark && styles.axisLabelDark]}>{Math.round((yDomain[0] + yDomain[1]) / 2)}w</Text>
            <Text style={[styles.axisLabel, isDark && styles.axisLabelDark]}>{Math.round(yDomain[0])}w</Text>
          </View>
        </View>
      </GestureDetector>

      {/* FTP Legend */}
      {ftpValue && (
        <View style={styles.legend}>
          <View style={[styles.legendDash, { backgroundColor: FTP_LINE_COLOR }]} />
          <Text style={[styles.legendText, isDark && styles.textDark]}>
            FTP {ftpValue}w
          </Text>
        </View>
      )}
    </View>
  );
});

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

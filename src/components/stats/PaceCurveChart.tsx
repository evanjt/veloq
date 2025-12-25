import React, { useMemo, useCallback, useState, useRef } from 'react';
import { View, StyleSheet, useColorScheme, Switch, TouchableOpacity } from 'react-native';
import { Text } from 'react-native-paper';
import { CartesianChart, Line } from 'victory-native';
import { Circle, DashPathEffect, Line as SkiaLine } from '@shopify/react-native-skia';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useSharedValue, useAnimatedReaction, runOnJS, useDerivedValue, useAnimatedStyle } from 'react-native-reanimated';
import { router } from 'expo-router';
import { colors, spacing } from '@/theme';
import { usePaceCurve } from '@/hooks';
import { useActivities } from '@/hooks';

interface PaceCurveChartProps {
  sport?: string;
  days?: number;
  height?: number;
}

const CHART_COLOR = '#4CAF50';
const CS_LINE_COLOR = 'rgba(150, 150, 150, 0.6)';

// Standard distance markers for x-axis (in meters)
const X_AXIS_MARKERS = [
  { meters: 400, label: '400m' },
  { meters: 1000, label: '1km' },
  { meters: 5000, label: '5km' },
  { meters: 10000, label: '10km' },
  { meters: 21097.5, label: '21km' },
];

// Format pace as min:sec/km
function formatPace(secondsPerKm: number): string {
  if (secondsPerKm <= 0 || !isFinite(secondsPerKm)) return '--:--';
  const minutes = Math.floor(secondsPerKm / 60);
  const seconds = Math.round(secondsPerKm % 60);
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
  if (meters < 10000) return `${(meters / 1000).toFixed(2)}km`;
  return `${(meters / 1000).toFixed(1)}km`;
}

// Format date range
function formatDateRange(startDate?: string, endDate?: string): string {
  if (!startDate || !endDate) return '';
  const start = new Date(startDate);
  const end = new Date(endDate);
  const formatOpts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' };
  return `${start.toLocaleDateString('en-US', formatOpts)} - ${end.toLocaleDateString('en-US', formatOpts)}`;
}

// Convert m/s to seconds per km
function speedToSecsPerKm(metersPerSecond: number): number {
  if (metersPerSecond <= 0) return 0;
  return 1000 / metersPerSecond;
}

interface ChartPoint {
  x: number;         // log10(distance) for chart positioning
  y: number;         // pace in seconds/km
  distance: number;  // actual distance in meters
  time: number;      // time in seconds to cover this distance
  paceSecsPerKm: number;
  activityId?: string; // Activity that achieved this best effort
  [key: string]: unknown;
}

export function PaceCurveChart({
  sport = 'Run',
  days = 42,
  height = 220,
}: PaceCurveChartProps) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const isRunning = sport === 'Run';

  // GAP toggle state (only for running)
  const [showGap, setShowGap] = useState(false);

  const { data: curve, isLoading, error } = usePaceCurve({
    sport,
    days,
    gap: isRunning && showGap,
  });

  // Get activities to look up names for activity IDs
  // Fetch a wider range to cover all possible activities in the curve
  const daysAgo = new Date();
  daysAgo.setDate(daysAgo.getDate() - days);
  const { data: activities } = useActivities({
    oldest: daysAgo.toISOString().split('T')[0],
  });

  const [tooltipData, setTooltipData] = useState<ChartPoint | null>(null);
  const [persistedTooltip, setPersistedTooltip] = useState<ChartPoint | null>(null);
  const [isActive, setIsActive] = useState(false);
  // Track actual chart bounds from Victory Native for accurate axis label positioning
  const [actualChartBounds, setActualChartBounds] = useState({ left: 0, right: 0 });

  // Shared values for gesture tracking
  const touchX = useSharedValue(-1);
  const chartBoundsShared = useSharedValue({ left: 0, right: 1 });
  const xDomainShared = useSharedValue<[number, number]>([0, 1]);
  const xValuesShared = useSharedValue<number[]>([]);
  const lastNotifiedIdx = useRef<number | null>(null);

  // Build activity lookup map
  const activityMap = useMemo(() => {
    const map = new Map<string, { name: string; date: string }>();
    if (activities) {
      for (const activity of activities) {
        map.set(activity.id, {
          name: activity.name,
          date: activity.start_date_local,
        });
      }
    }
    return map;
  }, [activities]);

  // Process curve data - use distances directly from API
  const { chartData, criticalSpeedPace, yDomain, xDomain } = useMemo(() => {
    if (!curve?.distances || !curve?.times || curve.distances.length === 0) {
      return {
        chartData: [],
        criticalSpeedPace: null,
        yDomain: [240, 480] as [number, number],
        xDomain: [Math.log10(400), Math.log10(21000)] as [number, number],
      };
    }

    const points: ChartPoint[] = [];

    for (let i = 0; i < curve.distances.length; i++) {
      const distance = curve.distances[i];
      const time = curve.times[i];
      const speed = curve.pace[i];
      const activityId = curve.activity_ids?.[i];

      if (distance > 0 && time > 0 && speed > 0) {
        const paceSecsPerKm = speedToSecsPerKm(speed);

        // Filter to reasonable running paces (2:30-10:00 min/km = 150-600 sec/km)
        if (paceSecsPerKm >= 150 && paceSecsPerKm <= 600 && distance >= 100) {
          points.push({
            x: Math.log10(distance),
            y: paceSecsPerKm,
            distance,
            time,
            paceSecsPerKm,
            activityId,
          });
        }
      }
    }

    if (points.length === 0) {
      return {
        chartData: [],
        criticalSpeedPace: null,
        yDomain: [240, 480] as [number, number],
        xDomain: [Math.log10(400), Math.log10(21000)] as [number, number],
      };
    }

    // Sort by distance
    points.sort((a, b) => a.distance - b.distance);

    // Sample to reduce density while keeping shape
    const sampled: ChartPoint[] = [];
    let lastDist = 0;
    for (const p of points) {
      // Adaptive sampling: more points at shorter distances
      const minGap = p.distance < 1000 ? 30 : (p.distance < 5000 ? 100 : 300);
      if (p.distance - lastDist >= minGap) {
        sampled.push(p);
        lastDist = p.distance;
      }
    }

    // Critical speed in seconds/km
    const csSecsPerKm = curve.criticalSpeed ? speedToSecsPerKm(curve.criticalSpeed) : null;

    // Calculate y domain (pace range)
    // Note: For pace, LOWER seconds = FASTER, so we want min at TOP of chart
    const paces = sampled.map(d => d.y);
    const minPace = Math.min(...paces);  // fastest
    const maxPace = Math.max(...paces);  // slowest
    const padding = (maxPace - minPace) * 0.1;

    // Calculate x domain (log distance range)
    const minDist = Math.min(...sampled.map(d => d.distance));
    const maxDist = Math.max(...sampled.map(d => d.distance));

    return {
      chartData: sampled,
      criticalSpeedPace: csSecsPerKm,
      // Invert y domain: [max, min] puts faster paces (lower values) at TOP
      yDomain: [maxPace + padding, minPace - padding] as [number, number],
      xDomain: [Math.log10(minDist), Math.log10(maxDist)] as [number, number],
    };
  }, [curve]);

  // Sync xDomain and x values to shared values for worklet access
  React.useEffect(() => {
    xDomainShared.value = xDomain;
    xValuesShared.value = chartData.map(d => d.x);
  }, [xDomain, chartData, xDomainShared, xValuesShared]);

  // Calculate x-axis label positions based on actual chart bounds from Victory Native
  const xAxisLabelPositions = useMemo(() => {
    const chartAreaWidth = actualChartBounds.right - actualChartBounds.left;
    if (chartAreaWidth <= 0 || chartData.length === 0) return [];

    const [xMin, xMax] = xDomain;
    const xRange = xMax - xMin;

    return X_AXIS_MARKERS.map(marker => {
      const logDist = Math.log10(marker.meters);
      const ratio = (logDist - xMin) / xRange;
      // Only show if within the data range
      if (ratio < -0.05 || ratio > 1.05) return null;
      return {
        label: marker.label,
        // Position relative to chart bounds, not wrapper width
        position: actualChartBounds.left + (ratio * chartAreaWidth),
      };
    }).filter(Boolean) as { label: string; position: number }[];
  }, [actualChartBounds, xDomain, chartData.length]);

  // Derive selected index from touch position using log-scale x values
  const selectedIdx = useDerivedValue(() => {
    'worklet';
    const xValues = xValuesShared.value;
    const len = xValues.length;
    const bounds = chartBoundsShared.value;
    const chartWidthVal = bounds.right - bounds.left;
    const [xMin, xMax] = xDomainShared.value;

    if (touchX.value < 0 || chartWidthVal <= 0 || len === 0) return -1;

    // Convert touch position to log-scale x value
    const chartX = touchX.value - bounds.left;
    const ratio = Math.max(0, Math.min(1, chartX / chartWidthVal));
    const targetX = xMin + ratio * (xMax - xMin);

    // Find the closest data point by x value (binary search would be better but this is simple)
    let closestIdx = 0;
    let closestDiff = Math.abs(xValues[0] - targetX);
    for (let i = 1; i < len; i++) {
      const diff = Math.abs(xValues[i] - targetX);
      if (diff < closestDiff) {
        closestDiff = diff;
        closestIdx = i;
      }
    }

    return closestIdx;
  }, []);

  const updateTooltipOnJS = useCallback(
    (idx: number) => {
      if (idx < 0 || chartData.length === 0) {
        if (lastNotifiedIdx.current !== null) {
          // Persist the last selected point when scrub ends
          if (tooltipData) {
            setPersistedTooltip(tooltipData);
          }
          setTooltipData(null);
          setIsActive(false);
          lastNotifiedIdx.current = null;
        }
        return;
      }

      if (idx === lastNotifiedIdx.current) return;
      lastNotifiedIdx.current = idx;

      if (!isActive) {
        setIsActive(true);
        // Clear persisted when starting a new scrub
        setPersistedTooltip(null);
      }

      const point = chartData[idx];
      if (point) setTooltipData(point);
    },
    [chartData, isActive, tooltipData]
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
    .activateAfterLongPress(700);

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
        <Text style={[styles.title, isDark && styles.textLight]}>Pace Curve</Text>
        <View style={styles.loadingContainer}>
          <Text style={[styles.loadingText, isDark && styles.textDark]}>Loading...</Text>
        </View>
      </View>
    );
  }

  if (error || chartData.length === 0) {
    return (
      <View style={[styles.container, { height }]}>
        <Text style={[styles.title, isDark && styles.textLight]}>Pace Curve</Text>
        <View style={styles.emptyState}>
          <Text style={[styles.emptyText, isDark && styles.textDark]}>No pace data available</Text>
        </View>
      </View>
    );
  }

  // Display data - either selected point, persisted point, or latest (longest distance)
  const displayData = tooltipData || persistedTooltip || chartData[chartData.length - 1];

  // Get activity info for the selected point
  const selectedActivity = displayData?.activityId ? activityMap.get(displayData.activityId) : null;

  // Navigate to activity when tapped
  const handleActivityTap = useCallback(() => {
    if (displayData?.activityId) {
      router.push(`/activity/${displayData.activityId}`);
    }
  }, [displayData?.activityId]);

  return (
    <View style={[styles.container, { height }]}>
      {/* Header with title and GAP toggle */}
      <View style={styles.header}>
        <Text style={[styles.title, isDark && styles.textLight]}>Pace Curve</Text>
        {/* GAP toggle (running only) */}
        {isRunning && (
          <View style={styles.gapToggle}>
            <Text style={[styles.gapLabel, isDark && styles.textDark]}>GAP</Text>
            <Switch
              value={showGap}
              onValueChange={setShowGap}
              trackColor={{ false: isDark ? '#444' : '#DDD', true: colors.primary }}
              thumbColor={showGap ? '#FFF' : (isDark ? '#AAA' : '#FFF')}
              style={styles.gapSwitch}
            />
          </View>
        )}
      </View>

      {/* Values row */}
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
            {formatPace(displayData.paceSecsPerKm)}/km
          </Text>
        </View>
      </View>

      {/* Activity info row - shows which activity achieved this best effort */}
      {selectedActivity && (
        <TouchableOpacity onPress={handleActivityTap} style={styles.activityRow} activeOpacity={0.7}>
          <View style={[styles.activityPill, isDark && styles.activityPillDark]}>
            <Text style={styles.activityLabel} numberOfLines={1}>
              {selectedActivity.name} →
            </Text>
          </View>
        </TouchableOpacity>
      )}

      {/* Chart */}
      <GestureDetector gesture={gesture}>
        <View style={styles.chartWrapper}>
          <CartesianChart
            data={chartData}
            xKey="x"
            yKeys={['y']}
            domain={{ x: xDomain, y: yDomain }}
            padding={{ left: 0, right: 0, top: 4, bottom: 0 }}
          >
            {({ points, chartBounds }) => {
              // Sync bounds for gesture and x-axis label positioning
              if (chartBounds.left !== chartBoundsShared.value.left ||
                  chartBounds.right !== chartBoundsShared.value.right) {
                chartBoundsShared.value = { left: chartBounds.left, right: chartBounds.right };
                // Also sync to React state for x-axis labels (only if changed to avoid loops)
                if (chartBounds.left !== actualChartBounds.left || chartBounds.right !== actualChartBounds.right) {
                  setActualChartBounds({ left: chartBounds.left, right: chartBounds.right });
                }
              }

              return (
                <>
                  {/* Critical Speed line */}
                  {criticalSpeedPace && criticalSpeedPace >= yDomain[0] && criticalSpeedPace <= yDomain[1] && (
                    <SkiaLine
                      p1={{
                        x: chartBounds.left,
                        y: chartBounds.top + ((criticalSpeedPace - yDomain[0]) / (yDomain[1] - yDomain[0])) * (chartBounds.bottom - chartBounds.top),
                      }}
                      p2={{
                        x: chartBounds.right,
                        y: chartBounds.top + ((criticalSpeedPace - yDomain[0]) / (yDomain[1] - yDomain[0])) * (chartBounds.bottom - chartBounds.top),
                      }}
                      color={CS_LINE_COLOR}
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

          {/* X-axis labels - positioned based on log scale */}
          <View style={styles.xAxisOverlay} pointerEvents="none">
            {xAxisLabelPositions.map((item, idx) => (
              <Text
                key={idx}
                style={[
                  styles.axisLabel,
                  isDark && styles.axisLabelDark,
                  { position: 'absolute', left: item.position - 15 },
                ]}
              >
                {item.label}
              </Text>
            ))}
          </View>

          {/* Y-axis labels - note: axis is inverted so top is fastest (yDomain[1]), bottom is slowest (yDomain[0]) */}
          <View style={styles.yAxisOverlay} pointerEvents="none">
            <Text style={[styles.axisLabel, isDark && styles.axisLabelDark]}>{formatPace(yDomain[1])}</Text>
            <Text style={[styles.axisLabel, isDark && styles.axisLabelDark]}>{formatPace((yDomain[0] + yDomain[1]) / 2)}</Text>
            <Text style={[styles.axisLabel, isDark && styles.axisLabelDark]}>{formatPace(yDomain[0])}</Text>
          </View>
        </View>
      </GestureDetector>

      {/* Model info */}
      <View style={styles.footer}>
        <View style={styles.modelInfo}>
          <Text style={[styles.dateRange, isDark && styles.textDark]}>
            {curve?.days ? `${curve.days} days: ` : ''}{formatDateRange(curve?.startDate, curve?.endDate)}
          </Text>
          {criticalSpeedPace && (
            <Text style={[styles.modelStats, isDark && styles.textDark]}>
              CS {formatPace(criticalSpeedPace)}/km ({curve?.criticalSpeed?.toFixed(2)} m/s)
              {curve?.dPrime ? `  D' ${curve.dPrime.toFixed(0)}m` : ''}
              {curve?.r2 ? `  R² ${curve.r2.toFixed(4)}` : ''}
            </Text>
          )}
        </View>
      </View>
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
    marginBottom: spacing.xs,
  },
  gapToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  gapLabel: {
    fontSize: 12,
    fontWeight: '500',
    color: colors.textSecondary,
  },
  gapSwitch: {
    transform: [{ scale: 0.8 }],
  },
  valuesRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: spacing.xs,
  },
  valueItem: {
    alignItems: 'center',
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
  activityRow: {
    marginBottom: spacing.xs,
    alignItems: 'center',
  },
  activityPill: {
    backgroundColor: 'rgba(76, 175, 80, 0.15)',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(76, 175, 80, 0.3)',
  },
  activityPillDark: {
    backgroundColor: 'rgba(76, 175, 80, 0.2)',
    borderColor: 'rgba(76, 175, 80, 0.4)',
  },
  activityLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#4CAF50',
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
    height: 16,
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
  footer: {
    marginTop: spacing.xs,
  },
  modelInfo: {
    alignItems: 'center',
  },
  dateRange: {
    fontSize: 10,
    color: colors.textSecondary,
    marginBottom: 2,
  },
  modelStats: {
    fontSize: 10,
    color: colors.textSecondary,
  },
});

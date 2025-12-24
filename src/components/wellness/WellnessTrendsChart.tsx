import React, { useMemo, useState, useCallback } from 'react';
import { View, StyleSheet, useColorScheme, LayoutChangeEvent } from 'react-native';
import { Text } from 'react-native-paper';
import { CartesianChart, Line } from 'victory-native';
import { Circle, Line as SkiaLine } from '@shopify/react-native-skia';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useSharedValue, useAnimatedStyle, runOnJS } from 'react-native-reanimated';
import { colors, spacing } from '@/theme';
import type { WellnessData } from '@/types';

interface WellnessTrendsChartProps {
  data?: WellnessData[];
  height?: number;
}

// Colors for different metrics
const METRIC_COLORS = {
  hrv: '#E91E63', // Pink
  rhr: '#FF5722', // Orange
  sleep: '#9C27B0', // Purple
  sleepScore: '#3F51B5', // Indigo
  weight: '#607D8B', // Blue Grey
};

interface MetricChartData {
  x: number;
  value: number;
  date: string;
  rawValue: number;
}

interface MetricConfig {
  key: string;
  data: MetricChartData[];
  color: string;
  label: string;
  unit: string;
  formatValue: (v: number) => string;
}

/** Victory Native chart bounds structure */
interface ChartBounds {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** Victory Native chart point - we only need x and y for our rendering */
interface ChartPoint {
  x: number;
  y: number | undefined;
}

function formatSleepDuration(hours: number): string {
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return `${h}h ${m}m`;
}

// Individual sparkline that receives selected index from parent
function MetricSparkline({
  data,
  color,
  height,
  isDark,
  label,
  unit,
  formatValue,
  selectedIdx,
  totalDays,
}: {
  data: MetricChartData[];
  color: string;
  height: number;
  isDark: boolean;
  label: string;
  unit: string;
  formatValue: (v: number) => string;
  selectedIdx: number | null;
  totalDays: number;
}) {
  if (data.length === 0) return null;

  const minValue = Math.min(...data.map(d => d.value));
  const maxValue = Math.max(...data.map(d => d.value));
  const range = maxValue - minValue || 1;

  // Add some padding to the domain
  const yMin = minValue - range * 0.15;
  const yMax = maxValue + range * 0.15;

  // Latest value and average
  const latestValue = data[data.length - 1];
  const avgValue = data.reduce((sum, d) => sum + d.rawValue, 0) / data.length;

  // Get value for selected date
  const selectedPoint = useMemo(() => {
    if (selectedIdx === null) return null;
    return data.find(d => d.x === selectedIdx) || null;
  }, [selectedIdx, data]);

  const displayValue = selectedPoint || latestValue;
  const isSelected = selectedIdx !== null;

  return (
    <View style={[styles.metricRow, isDark && styles.metricRowDark]}>
      <View style={styles.metricInfo}>
        <View style={[styles.metricDot, { backgroundColor: color }]} />
        <Text style={[styles.metricLabel, isDark && styles.textDark]}>{label}</Text>
      </View>

      <View style={styles.sparklineContainer}>
        <View style={{ height }}>
          {(CartesianChart as any)({
            data,
            xKey: 'x',
            yKeys: ['value'],
            domain: { x: [0, totalDays - 1], y: [yMin, yMax] },
            padding: { left: 4, right: 4, top: 8, bottom: 8 },
            children: ({ points, chartBounds }: { points: { value: Array<{ x: number; y: number | undefined }> }; chartBounds: ChartBounds }) => (
              <>
                <Line
                  points={points.value as Parameters<typeof Line>[0]['points']}
                  color={color}
                  strokeWidth={2}
                  curveType="natural"
                />
                {selectedIdx !== null && selectedPoint && (
                  <>
                    {/* Vertical line at selected position */}
                    <SkiaLine
                      p1={{ x: chartBounds.left + (selectedIdx / (totalDays - 1)) * (chartBounds.right - chartBounds.left), y: chartBounds.top }}
                      p2={{ x: chartBounds.left + (selectedIdx / (totalDays - 1)) * (chartBounds.right - chartBounds.left), y: chartBounds.bottom }}
                      color={isDark ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.2)'}
                      strokeWidth={1}
                    />
                    {/* Dot at the data point */}
                    {points.value[data.findIndex(d => d.x === selectedIdx)] && (
                      <Circle
                        cx={points.value[data.findIndex(d => d.x === selectedIdx)]?.x || 0}
                        cy={points.value[data.findIndex(d => d.x === selectedIdx)]?.y || 0}
                        r={5}
                        color={color}
                      />
                    )}
                  </>
                )}
              </>
            ),
          })}
        </View>
      </View>

      <View style={styles.metricValues}>
        <Text style={[styles.metricValue, isSelected ? { color } : isDark && styles.textLight]}>
          {displayValue ? formatValue(displayValue.rawValue) : '-'}
        </Text>
        <Text style={[styles.metricUnit, isDark && styles.textDark]}>{unit}</Text>
        {!isSelected && (
          <Text style={[styles.metricAvg, isDark && styles.textDark]}>
            avg {formatValue(avgValue)}
          </Text>
        )}
      </View>
    </View>
  );
}

export const WellnessTrendsChart = React.memo(function WellnessTrendsChart({ data, height = 200 }: WellnessTrendsChartProps) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);

  // Shared values for gesture
  const activeX = useSharedValue(0);
  const isActive = useSharedValue(false);

  // Process data for each metric
  const { sortedData, hrvData, rhrData, sleepData, sleepScoreData, weightData, totalDays } = useMemo(() => {
    if (!data || data.length === 0) {
      return { sortedData: [], hrvData: [], rhrData: [], sleepData: [], sleepScoreData: [], weightData: [], totalDays: 0 };
    }

    // Sort by date ascending
    const sorted = [...data].sort((a, b) => a.id.localeCompare(b.id));
    const totalDays = sorted.length;

    const hrvData: MetricChartData[] = [];
    const rhrData: MetricChartData[] = [];
    const sleepData: MetricChartData[] = [];
    const sleepScoreData: MetricChartData[] = [];
    const weightData: MetricChartData[] = [];

    sorted.forEach((d, idx) => {
      if (d.hrv != null) {
        hrvData.push({ x: idx, value: d.hrv, date: d.id, rawValue: d.hrv });
      }
      if (d.restingHR != null) {
        rhrData.push({ x: idx, value: d.restingHR, date: d.id, rawValue: d.restingHR });
      }
      if (d.sleepSecs != null) {
        const hours = d.sleepSecs / 3600;
        sleepData.push({ x: idx, value: hours, date: d.id, rawValue: hours });
      }
      if (d.sleepScore != null) {
        sleepScoreData.push({ x: idx, value: d.sleepScore, date: d.id, rawValue: d.sleepScore });
      }
      if (d.weight != null) {
        weightData.push({ x: idx, value: d.weight, date: d.id, rawValue: d.weight });
      }
    });

    return { sortedData: sorted, hrvData, rhrData, sleepData, sleepScoreData, weightData, totalDays };
  }, [data]);

  const hasHrv = hrvData.length > 0;
  const hasRhr = rhrData.length > 0;
  const hasSleep = sleepData.length > 0;
  const hasSleepScore = sleepScoreData.length > 0;
  const hasWeight = weightData.length > 0;
  const hasAnyData = hasHrv || hasRhr || hasSleep || hasSleepScore || hasWeight;

  // Calculate x position to index
  const leftPadding = 75 + 8; // metricInfo width + margin
  const rightPadding = 55 + 8; // metricValues width + margin
  const chartWidth = containerWidth - leftPadding - rightPadding;

  const updateSelectedIdx = useCallback((x: number) => {
    if (chartWidth <= 0 || totalDays <= 0) return;
    const relativeX = x - leftPadding;
    const ratio = Math.max(0, Math.min(1, relativeX / chartWidth));
    const idx = Math.round(ratio * (totalDays - 1));
    setSelectedIdx(idx);
  }, [chartWidth, totalDays, leftPadding]);

  const clearSelection = useCallback(() => {
    setSelectedIdx(null);
  }, []);

  // Gesture handler
  const gesture = Gesture.Pan()
    .onStart((e) => {
      isActive.value = true;
      activeX.value = e.x;
      runOnJS(updateSelectedIdx)(e.x);
    })
    .onUpdate((e) => {
      activeX.value = e.x;
      runOnJS(updateSelectedIdx)(e.x);
    })
    .onEnd(() => {
      isActive.value = false;
      runOnJS(clearSelection)();
    })
    .minDistance(0)
    .activateAfterLongPress(300);

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    setContainerWidth(e.nativeEvent.layout.width);
  }, []);

  // Selected date for header
  const selectedDate = useMemo(() => {
    if (selectedIdx === null || !sortedData[selectedIdx]) return null;
    return sortedData[selectedIdx].id;
  }, [selectedIdx, sortedData]);

  if (!data || data.length === 0 || !hasAnyData) {
    return (
      <View style={[styles.container, { height }]}>
        <View style={styles.emptyState}>
          <Text style={[styles.emptyText, isDark && styles.textDark]}>
            No trend data available
          </Text>
          <Text style={[styles.emptyHint, isDark && styles.textDark]}>
            HRV, sleep, and resting HR trends will appear here when data is logged
          </Text>
        </View>
      </View>
    );
  }

  const sparklineHeight = 50;

  return (
    <View style={styles.container} onLayout={onLayout}>
      {/* Date header - shows selected date or "Today" */}
      <View style={styles.dateHeader}>
        <Text style={[styles.dateText, isDark && styles.textLight]}>
          {selectedDate
            ? new Date(selectedDate).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
            : 'Today'}
        </Text>
        {selectedIdx !== null && (
          <Text style={[styles.dateHint, isDark && styles.textDark]}>
            Drag to explore
          </Text>
        )}
      </View>

      <GestureDetector gesture={gesture}>
        <View>
          {/* HRV Chart */}
          {hasHrv && (
            <MetricSparkline
              data={hrvData}
              color={METRIC_COLORS.hrv}
              height={sparklineHeight}
              isDark={isDark}
              label="HRV"
              unit="ms"
              formatValue={(v) => Math.round(v).toString()}
              selectedIdx={selectedIdx}
              totalDays={totalDays}
            />
          )}

          {/* RHR Chart */}
          {hasRhr && (
            <MetricSparkline
              data={rhrData}
              color={METRIC_COLORS.rhr}
              height={sparklineHeight}
              isDark={isDark}
              label="Resting HR"
              unit="bpm"
              formatValue={(v) => Math.round(v).toString()}
              selectedIdx={selectedIdx}
              totalDays={totalDays}
            />
          )}

          {/* Sleep Chart */}
          {hasSleep && (
            <MetricSparkline
              data={sleepData}
              color={METRIC_COLORS.sleep}
              height={sparklineHeight}
              isDark={isDark}
              label="Sleep"
              unit=""
              formatValue={(v) => formatSleepDuration(v)}
              selectedIdx={selectedIdx}
              totalDays={totalDays}
            />
          )}

          {/* Sleep Score Chart */}
          {hasSleepScore && (
            <MetricSparkline
              data={sleepScoreData}
              color={METRIC_COLORS.sleepScore}
              height={sparklineHeight}
              isDark={isDark}
              label="Sleep Score"
              unit=""
              formatValue={(v) => Math.round(v).toString()}
              selectedIdx={selectedIdx}
              totalDays={totalDays}
            />
          )}

          {/* Weight Chart */}
          {hasWeight && (
            <MetricSparkline
              data={weightData}
              color={METRIC_COLORS.weight}
              height={sparklineHeight}
              isDark={isDark}
              label="Weight"
              unit="kg"
              formatValue={(v) => v.toFixed(1)}
              selectedIdx={selectedIdx}
              totalDays={totalDays}
            />
          )}
        </View>
      </GestureDetector>

      {/* Period label */}
      <Text style={[styles.periodLabel, isDark && styles.textDark]}>
        Last {data.length} days
      </Text>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {},
  dateHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.xs,
  },
  dateText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  dateHint: {
    fontSize: 10,
    color: colors.textSecondary,
    fontStyle: 'italic',
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xl,
  },
  emptyText: {
    fontSize: 14,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  emptyHint: {
    fontSize: 12,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  textLight: {
    color: '#FFFFFF',
  },
  textDark: {
    color: '#AAA',
  },
  metricRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(0, 0, 0, 0.08)',
  },
  metricRowDark: {
    borderBottomColor: 'rgba(255, 255, 255, 0.1)',
  },
  metricInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    width: 75,
  },
  metricDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: spacing.xs,
  },
  metricLabel: {
    fontSize: 11,
    color: colors.textSecondary,
    fontWeight: '500',
  },
  sparklineContainer: {
    flex: 1,
    marginHorizontal: spacing.sm,
    position: 'relative',
  },
  metricValues: {
    alignItems: 'flex-end',
    width: 55,
  },
  metricValue: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  metricUnit: {
    fontSize: 9,
    color: colors.textSecondary,
    marginTop: -2,
  },
  metricAvg: {
    fontSize: 8,
    color: colors.textSecondary,
    marginTop: 2,
  },
  periodLabel: {
    fontSize: 10,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
});

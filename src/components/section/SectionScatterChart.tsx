/**
 * Scatter chart for section performance data.
 * Fixed-width chart showing all traversals at a glance with LOESS trend lines.
 * Forward and reverse directions share a single Y axis.
 */

import React, { useMemo, useState, useCallback, useRef } from 'react';
import { View, StyleSheet, TouchableOpacity, Dimensions } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { CartesianChart, type PointsArray } from 'victory-native';
import { Circle, Path, Skia } from '@shopify/react-native-skia';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  useAnimatedReaction,
  runOnJS,
} from 'react-native-reanimated';
import { navigateTo } from '@/lib';
import {
  formatPace,
  formatSpeed,
  formatDuration,
  isRunningActivity,
  getActivityColor,
  formatShortDate as formatShortDateLib,
} from '@/lib';
import { CHART_CONFIG } from '@/constants';
import { loessSmooth } from '@/lib/utils/smoothing';
import { colors, darkColors } from '@/theme';
import type { ActivityType, RoutePoint, PerformanceDataPoint } from '@/types';
import type { DirectionBestRecord, DirectionSummaryStats } from '@/components/routes/performance';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CHART_WIDTH = SCREEN_WIDTH - 32;
const CHART_HEIGHT = 120;
const CHART_PADDING = { left: 40, right: 20, top: 12, bottom: 12 } as const;

/** Format date with 2-digit year (e.g., "Jan 15 '24") */
function formatShortDate(date: Date): string {
  const base = formatShortDateLib(date);
  const year = date.getFullYear().toString().slice(-2);
  return `${base} '${year}`;
}

/** Format date for axis labels */
function formatAxisDate(date: Date): string {
  const month = date.toLocaleDateString(undefined, { month: 'short' });
  const year = date.getFullYear().toString().slice(-2);
  return `${month} '${year}`;
}

export interface SectionScatterChartProps {
  chartData: (PerformanceDataPoint & { x: number })[];
  activityType: ActivityType;
  isDark: boolean;
  bestForwardRecord: DirectionBestRecord | null;
  bestReverseRecord: DirectionBestRecord | null;
  forwardStats: DirectionSummaryStats | null;
  reverseStats: DirectionSummaryStats | null;
  onActivitySelect?: (activityId: string | null, activityPoints?: RoutePoint[]) => void;
  onScrubChange?: (scrubbing: boolean) => void;
}

export function SectionScatterChart({
  chartData,
  activityType,
  isDark,
  bestForwardRecord,
  bestReverseRecord,
  forwardStats,
  reverseStats,
  onActivitySelect,
  onScrubChange,
}: SectionScatterChartProps) {
  const { t } = useTranslation();
  const showPace = isRunningActivity(activityType);
  const activityColor = getActivityColor(activityType);
  const sectionDistance = chartData[0]?.sectionDistance || 0;

  const [selectedPoint, setSelectedPoint] = useState<(PerformanceDataPoint & { x: number }) | null>(
    null
  );

  const formatSpeedValue = useCallback(
    (speed: number) => (showPace ? formatPace(speed) : formatSpeed(speed)),
    [showPace]
  );

  // Separate forward/reverse, compute positions, find PRs
  const {
    forwardPoints,
    reversePoints,
    allPoints,
    forwardBestIdx,
    reverseBestIdx,
    minSpeed,
    maxSpeed,
  } = useMemo(() => {
    if (chartData.length === 0) {
      return {
        forwardPoints: [] as (PerformanceDataPoint & { x: number })[],
        reversePoints: [] as (PerformanceDataPoint & { x: number })[],
        allPoints: [] as (PerformanceDataPoint & { x: number })[],
        forwardBestIdx: -1,
        reverseBestIdx: -1,
        minSpeed: 0,
        maxSpeed: 1,
      };
    }

    const sorted = [...chartData].sort((a, b) => a.date.getTime() - b.date.getTime());
    const firstTime = sorted[0].date.getTime();
    const lastTime = sorted[sorted.length - 1].date.getTime();
    const timeRange = lastTime - firstTime || 1;

    // Normalize x to 0-1
    const positioned = sorted.map((p) => ({
      ...p,
      x: 0.05 + ((p.date.getTime() - firstTime) / timeRange) * 0.9,
    }));

    const fwd: (PerformanceDataPoint & { x: number })[] = [];
    const rev: (PerformanceDataPoint & { x: number })[] = [];
    let fwdBest = -1;
    let fwdBestSpeed = -Infinity;
    let revBest = -1;
    let revBestSpeed = -Infinity;

    for (const p of positioned) {
      if (p.direction === 'reverse') {
        if (p.speed > revBestSpeed) {
          revBestSpeed = p.speed;
          revBest = rev.length;
        }
        rev.push(p);
      } else {
        if (p.speed > fwdBestSpeed) {
          fwdBestSpeed = p.speed;
          fwdBest = fwd.length;
        }
        fwd.push(p);
      }
    }

    const speeds = positioned.map((p) => p.speed);
    const min = Math.min(...speeds);
    const max = Math.max(...speeds);
    const padding = (max - min) * 0.15 || 0.5;

    return {
      forwardPoints: fwd,
      reversePoints: rev,
      allPoints: positioned,
      forwardBestIdx: fwdBest,
      reverseBestIdx: revBest,
      minSpeed: Math.max(0, min - padding),
      maxSpeed: max + padding,
    };
  }, [chartData]);

  // Compute LOESS trend lines
  const { forwardTrendPath, reverseTrendPath } = useMemo(() => {
    const buildTrendPath = (points: (PerformanceDataPoint & { x: number })[]) => {
      if (points.length < 3) return null;
      const xs = points.map((p) => p.x);
      const ys = points.map((p) => p.speed);
      const trend = loessSmooth(xs, ys, undefined, Math.min(40, points.length * 2));
      if (trend.length < 2) return null;
      return trend;
    };

    return {
      forwardTrendPath: buildTrendPath(forwardPoints),
      reverseTrendPath: buildTrendPath(reversePoints),
    };
  }, [forwardPoints, reversePoints]);

  // Time axis labels
  const timeAxisLabels = useMemo(() => {
    if (allPoints.length < 2) return [];
    const firstDate = allPoints[0].date;
    const lastDate = allPoints[allPoints.length - 1].date;
    const monthsInRange =
      (lastDate.getFullYear() - firstDate.getFullYear()) * 12 +
      (lastDate.getMonth() - firstDate.getMonth());
    const monthStep = monthsInRange > 18 ? 3 : monthsInRange > 6 ? 2 : 1;

    const firstTime = firstDate.getTime();
    const lastTime = lastDate.getTime();
    const timeRange = lastTime - firstTime || 1;

    const labels: { date: Date; position: number }[] = [];
    const currentMonth = new Date(firstDate.getFullYear(), firstDate.getMonth(), 1);
    while (currentMonth <= lastDate) {
      if (currentMonth >= firstDate || currentMonth.getMonth() === firstDate.getMonth()) {
        const pos = 0.05 + ((currentMonth.getTime() - firstTime) / timeRange) * 0.9;
        labels.push({ date: new Date(currentMonth), position: pos });
      }
      currentMonth.setMonth(currentMonth.getMonth() + monthStep);
    }

    // Filter labels that are too close
    const chartContentW = CHART_WIDTH - CHART_PADDING.left - CHART_PADDING.right;
    const minSpacing = 70 / chartContentW;
    return labels
      .sort((a, b) => a.position - b.position)
      .filter(
        (label, idx, arr) =>
          idx === 0 || Math.abs(label.position - arr[idx - 1].position) >= minSpacing
      );
  }, [allPoints]);

  // Build Skia path from LOESS data (mapped through chart coordinates)
  const buildSkiaPath = useCallback(
    (
      trend: { x: number; y: number }[],
      chartBounds: { left: number; right: number; top: number; bottom: number }
    ) => {
      if (!trend || trend.length < 2) return null;

      const xScale = (x: number) =>
        chartBounds.left + ((x - 0) / (1 - 0)) * (chartBounds.right - chartBounds.left);
      const yScale = (y: number) =>
        chartBounds.top +
        ((maxSpeed - y) / (maxSpeed - minSpeed)) * (chartBounds.bottom - chartBounds.top);

      const path = Skia.Path.Make();
      path.moveTo(xScale(trend[0].x), yScale(trend[0].y));

      // Catmull-Rom to cubic Bezier for smooth curve
      for (let i = 0; i < trend.length - 1; i++) {
        const p0 = i > 0 ? trend[i - 1] : trend[i];
        const p1 = trend[i];
        const p2 = trend[i + 1];
        const p3 = i < trend.length - 2 ? trend[i + 2] : trend[i + 1];

        const cp1x = xScale(p1.x) + (xScale(p2.x) - xScale(p0.x)) / 6;
        const cp1y = yScale(p1.y) + (yScale(p2.y) - yScale(p0.y)) / 6;
        const cp2x = xScale(p2.x) - (xScale(p3.x) - xScale(p1.x)) / 6;
        const cp2y = yScale(p2.y) - (yScale(p3.y) - yScale(p1.y)) / 6;

        path.cubicTo(cp1x, cp1y, cp2x, cp2y, xScale(p2.x), yScale(p2.y));
      }

      return path;
    },
    [minSpeed, maxSpeed]
  );

  const handlePointPress = useCallback(
    (point: PerformanceDataPoint & { x: number }) => {
      setSelectedPoint(point);
      onActivitySelect?.(point.activityId, point.lapPoints);
    },
    [onActivitySelect]
  );

  // Map a pixel X position to the closest data point and select it
  const lastNotifiedIdx = useRef(-1);
  const selectPointAtX = useCallback(
    (locationX: number) => {
      if (allPoints.length === 0) return;
      const chartContentW = CHART_WIDTH - CHART_PADDING.left - CHART_PADDING.right;
      const tapX = locationX - CHART_PADDING.left;
      const normalizedX = Math.max(0, Math.min(1, tapX / chartContentW));

      let closestIdx = 0;
      let closestDist = Infinity;
      for (let i = 0; i < allPoints.length; i++) {
        const dist = Math.abs(allPoints[i].x - normalizedX);
        if (dist < closestDist) {
          closestDist = dist;
          closestIdx = i;
        }
      }
      if (closestIdx !== lastNotifiedIdx.current) {
        lastNotifiedIdx.current = closestIdx;
        const closest = allPoints[closestIdx];
        if (closest) handlePointPress(closest);
      }
    },
    [allPoints, handlePointPress]
  );

  // Shared value for scrub crosshair position
  const touchX = useSharedValue(-1);
  const [isScrubbing, setIsScrubbing] = useState(false);

  const onGestureStart = useCallback(() => {
    onScrubChange?.(true);
  }, [onScrubChange]);

  const onGestureEnd = useCallback(() => {
    onScrubChange?.(false);
    lastNotifiedIdx.current = -1;
  }, [onScrubChange]);

  // Pan gesture for scrubbing (long-press to activate)
  const panGesture = useMemo(
    () =>
      Gesture.Pan()
        .activateAfterLongPress(CHART_CONFIG.LONG_PRESS_DURATION)
        .onStart((e) => {
          'worklet';
          touchX.value = e.x;
          runOnJS(onGestureStart)();
          runOnJS(setIsScrubbing)(true);
        })
        .onUpdate((e) => {
          'worklet';
          touchX.value = e.x;
        })
        .onEnd(() => {
          'worklet';
          touchX.value = -1;
          runOnJS(onGestureEnd)();
          runOnJS(setIsScrubbing)(false);
        }),
    [touchX, onGestureStart, onGestureEnd]
  );

  // Tap gesture for point selection
  const tapGesture = useMemo(
    () =>
      Gesture.Tap()
        .maxDuration(200)
        .onEnd((e) => {
          'worklet';
          runOnJS(selectPointAtX)(e.x);
        }),
    [selectPointAtX]
  );

  // Combined gesture — allows ScrollView to handle scroll momentum
  const nativeGesture = useMemo(() => Gesture.Native(), []);
  const composedGesture = useMemo(
    () => Gesture.Simultaneous(nativeGesture, Gesture.Simultaneous(tapGesture, panGesture)),
    [nativeGesture, tapGesture, panGesture]
  );

  // Animated reaction: map touch X to closest data point during scrub
  useAnimatedReaction(
    () => touchX.value,
    (x) => {
      if (x >= 0) {
        runOnJS(selectPointAtX)(x);
      }
    },
    [selectPointAtX]
  );

  // Crosshair style
  const crosshairStyle = useAnimatedStyle(() => {
    if (touchX.value < 0) {
      return { opacity: 0, transform: [{ translateX: 0 }] };
    }
    return {
      opacity: 1,
      transform: [{ translateX: touchX.value }],
    };
  }, []);

  if (chartData.length < 1) return null;

  const hasForward = forwardPoints.length > 0;
  const hasReverse = reversePoints.length > 0;

  const renderStatsRow = (
    direction: 'forward' | 'reverse',
    stats: DirectionSummaryStats | null,
    bestRecord: DirectionBestRecord | null,
    pointCount: number,
    color: string
  ) => {
    if (pointCount === 0) return null;

    return (
      <View style={styles.statsRow}>
        <View style={styles.statsLeft}>
          <MaterialCommunityIcons
            name={direction === 'forward' ? 'arrow-right' : 'arrow-left'}
            size={14}
            color={color}
          />
          <Text style={[styles.statsDirection, isDark && styles.textLight]}>
            {direction === 'forward' ? t('sections.forward') : t('sections.reverse')}
          </Text>
          <View style={[styles.countBadge, { backgroundColor: color + '20' }]}>
            <Text style={[styles.countText, { color }]}>{pointCount}</Text>
          </View>
        </View>
        <View style={styles.statsMiddle}>
          {stats?.avgTime != null && (
            <Text style={[styles.statsValue, isDark && styles.textMuted]}>
              {showPace && sectionDistance > 0
                ? `${formatPace(sectionDistance / stats.avgTime)} ${t('sections.avg')}`
                : `${formatDuration(stats.avgTime)} ${t('sections.avg')}`}
            </Text>
          )}
        </View>
        {bestRecord && (
          <View style={styles.prBadge}>
            <MaterialCommunityIcons name="trophy" size={11} color={colors.chartGold} />
            <Text style={styles.prTime}>
              {showPace
                ? (bestRecord as any).bestPace
                  ? formatPace((bestRecord as any).bestPace)
                  : formatDuration(bestRecord.bestTime)
                : formatDuration(bestRecord.bestTime)}
            </Text>
          </View>
        )}
      </View>
    );
  };

  return (
    <View style={[styles.container, isDark && styles.containerDark]}>
      {/* Forward stats row above chart */}
      {hasForward &&
        renderStatsRow(
          'forward',
          forwardStats,
          bestForwardRecord,
          forwardPoints.length,
          activityColor
        )}

      {/* Chart */}
      <View style={styles.chartWrapper}>
        <View style={StyleSheet.absoluteFill}>
          <CartesianChart
            data={allPoints as unknown as Record<string, unknown>[]}
            xKey={'x' as never}
            yKeys={['speed'] as never}
            domain={{ x: [0, 1], y: [minSpeed, maxSpeed] }}
            padding={CHART_PADDING}
          >
            {
              (({
                points,
                chartBounds,
              }: {
                points: { speed: PointsArray };
                chartBounds: { left: number; right: number; top: number; bottom: number };
              }) => {
                // Build trend paths using chart coordinate system
                const fwdPath = forwardTrendPath
                  ? buildSkiaPath(forwardTrendPath, chartBounds)
                  : null;
                const revPath = reverseTrendPath
                  ? buildSkiaPath(reverseTrendPath, chartBounds)
                  : null;

                // Track which allPoints index maps to forward/reverse
                let fwdIdx = 0;
                let revIdx = 0;

                return (
                  <>
                    {/* LOESS trend lines */}
                    {fwdPath && (
                      <Path
                        path={fwdPath}
                        color={activityColor}
                        style="stroke"
                        strokeWidth={2}
                        opacity={0.6}
                      />
                    )}
                    {revPath && (
                      <Path
                        path={revPath}
                        color={colors.reverseDirection}
                        style="stroke"
                        strokeWidth={2}
                        opacity={0.6}
                      />
                    )}

                    {/* Scatter points */}
                    {points.speed.map((point: PointsArray[number], idx: number) => {
                      if (point.x == null || point.y == null) return null;

                      const dataPoint = allPoints[idx];
                      if (!dataPoint) return null;

                      const isReverse = dataPoint.direction === 'reverse';
                      const dotColor = isReverse ? colors.reverseDirection : activityColor;

                      // Determine if this is the best in its direction
                      let isBest = false;
                      if (isReverse) {
                        if (revIdx === reverseBestIdx) isBest = true;
                        revIdx++;
                      } else {
                        if (fwdIdx === forwardBestIdx) isBest = true;
                        fwdIdx++;
                      }

                      const isSelected =
                        selectedPoint?.activityId === dataPoint.activityId &&
                        selectedPoint?.id === dataPoint.id;

                      if (isSelected) {
                        return (
                          <React.Fragment key={`pt-${idx}`}>
                            <Circle cx={point.x} cy={point.y} r={7} color={colors.chartCyan} />
                            <Circle cx={point.x} cy={point.y} r={4} color={dotColor} />
                          </React.Fragment>
                        );
                      }

                      if (isBest) {
                        return (
                          <React.Fragment key={`pt-${idx}`}>
                            <Circle cx={point.x} cy={point.y} r={7} color={colors.chartGold} />
                            <Circle cx={point.x} cy={point.y} r={4} color={dotColor} />
                          </React.Fragment>
                        );
                      }

                      return (
                        <Circle
                          key={`pt-${idx}`}
                          cx={point.x}
                          cy={point.y}
                          r={4}
                          color={dotColor}
                          opacity={0.4}
                        />
                      );
                    })}
                  </>
                );
              }) as any
            }
          </CartesianChart>
        </View>

        {/* Gesture target for tap + long-press scrub */}
        <GestureDetector gesture={composedGesture}>
          <Animated.View style={styles.tapTarget} />
        </GestureDetector>

        {/* Crosshair (visible during scrubbing) */}
        <Animated.View style={[styles.crosshair, crosshairStyle]} pointerEvents="none" />

        {/* Y-axis labels */}
        <View style={styles.yAxisOverlay} pointerEvents="none">
          <Text style={[styles.axisLabel, isDark && styles.axisLabelDark]}>
            {formatSpeedValue(maxSpeed)}
          </Text>
          <Text style={[styles.axisLabel, isDark && styles.axisLabelDark]}>
            {formatSpeedValue(minSpeed)}
          </Text>
        </View>
      </View>

      {/* Time axis */}
      {timeAxisLabels.length > 0 && (
        <View style={styles.timeAxis}>
          {timeAxisLabels.map((label, idx) => (
            <Text
              key={idx}
              style={[
                styles.timeAxisLabel,
                isDark && styles.axisLabelDark,
                idx === 0 && styles.timeAxisLabelFirst,
                idx === timeAxisLabels.length - 1 && styles.timeAxisLabelLast,
              ]}
            >
              {formatAxisDate(label.date)}
            </Text>
          ))}
        </View>
      )}

      {/* Reverse stats row below chart */}
      {hasReverse &&
        renderStatsRow(
          'reverse',
          reverseStats,
          bestReverseRecord,
          reversePoints.length,
          colors.reverseDirection
        )}

      {/* Tooltip */}
      <View style={styles.tooltipContainer}>
        {selectedPoint ? (
          <TouchableOpacity
            style={[styles.selectedTooltip, isDark && styles.selectedTooltipDark]}
            onPress={() => navigateTo(`/activity/${selectedPoint.activityId}`)}
            activeOpacity={0.7}
          >
            <View style={styles.tooltipLeft}>
              <Text style={[styles.tooltipName, isDark && styles.textLight]} numberOfLines={1}>
                {selectedPoint.activityName}
              </Text>
              <View style={styles.tooltipMeta}>
                <Text style={[styles.tooltipDate, isDark && styles.textMuted]}>
                  {formatShortDate(selectedPoint.date)}
                </Text>
                {selectedPoint.sectionTime != null && (
                  <Text style={[styles.tooltipDate, isDark && styles.textMuted]}>
                    {' \u00b7 '}
                    {formatDuration(selectedPoint.sectionTime)}
                  </Text>
                )}
                {selectedPoint.direction === 'reverse' && (
                  <View style={styles.reverseBadge}>
                    <MaterialCommunityIcons
                      name="swap-horizontal"
                      size={10}
                      color={colors.reverseDirection}
                    />
                  </View>
                )}
              </View>
            </View>
            <View style={styles.tooltipRight}>
              <Text
                style={[
                  styles.tooltipSpeed,
                  {
                    color:
                      selectedPoint.direction === 'reverse'
                        ? colors.reverseDirection
                        : activityColor,
                  },
                ]}
              >
                {formatSpeedValue(selectedPoint.speed)}
              </Text>
              <MaterialCommunityIcons
                name="chevron-right"
                size={14}
                color={isDark ? darkColors.textMuted : colors.border}
              />
            </View>
          </TouchableOpacity>
        ) : (
          <View style={styles.tooltipPlaceholder}>
            <Text style={[styles.chartHint, isDark && styles.textMuted]}>
              {t('sections.scrubHint')}
            </Text>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    overflow: 'hidden',
  },
  containerDark: {
    backgroundColor: darkColors.surfaceCard,
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  statsLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  statsDirection: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  countBadge: {
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 8,
    marginLeft: 2,
  },
  countText: {
    fontSize: 10,
    fontWeight: '700',
  },
  statsMiddle: {
    flex: 1,
    alignItems: 'center',
  },
  statsValue: {
    fontSize: 11,
    color: colors.textMuted,
  },
  prBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  prTime: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.chartGold,
  },
  chartWrapper: {
    height: CHART_HEIGHT,
    width: CHART_WIDTH,
  },
  tapTarget: {
    ...StyleSheet.absoluteFillObject,
  },
  crosshair: {
    position: 'absolute',
    top: CHART_PADDING.top,
    bottom: CHART_PADDING.bottom,
    width: 1,
    backgroundColor: colors.textMuted,
  },
  yAxisOverlay: {
    position: 'absolute',
    left: 6,
    top: CHART_PADDING.top,
    bottom: CHART_PADDING.bottom,
    justifyContent: 'space-between',
  },
  timeAxis: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: CHART_PADDING.left,
    paddingBottom: 4,
  },
  timeAxisLabel: {
    fontSize: 9,
    color: colors.textMuted,
  },
  timeAxisLabelFirst: {
    textAlign: 'left',
  },
  timeAxisLabelLast: {
    textAlign: 'right',
  },
  axisLabel: {
    fontSize: 9,
    color: colors.textMuted,
  },
  axisLabelDark: {
    color: darkColors.textMuted,
  },
  tooltipContainer: {
    minHeight: 52,
    paddingHorizontal: 12,
    paddingBottom: 10,
  },
  tooltipPlaceholder: {
    justifyContent: 'center',
    alignItems: 'center',
    height: 44,
  },
  chartHint: {
    fontSize: 11,
    color: colors.textMuted,
    textAlign: 'center',
  },
  selectedTooltip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.background,
    padding: 10,
    borderRadius: 8,
  },
  selectedTooltipDark: {
    backgroundColor: darkColors.surfaceElevated,
  },
  tooltipLeft: {
    flex: 1,
    marginRight: 8,
  },
  tooltipName: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textPrimary,
    marginBottom: 1,
  },
  tooltipMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  tooltipDate: {
    fontSize: 11,
    color: colors.textMuted,
  },
  reverseBadge: {
    padding: 1,
  },
  tooltipRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  tooltipSpeed: {
    fontSize: 14,
    fontWeight: '700',
  },
  textLight: {
    color: darkColors.textPrimary,
  },
  textMuted: {
    color: darkColors.textMuted,
  },
});

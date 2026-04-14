/**
 * Scatter chart for section performance data.
 * Fixed-width chart showing all traversals at a glance with LOESS trend lines.
 * Forward and reverse directions share a single Y axis.
 */

import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { View, StyleSheet, TouchableOpacity, Dimensions, type ViewStyle } from 'react-native';
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
import { navigateTo, getIntlLocale } from '@/lib';
import {
  formatPace,
  formatSpeed,
  formatDuration,
  isRunningActivity,
  formatShortDate as formatShortDateLib,
  formatPerformanceDelta,
} from '@/lib';
import { CHART_CONFIG } from '@/constants';
import { gaussianSmooth } from '@/lib/utils/smoothing';
import { colors, darkColors } from '@/theme';
import type { ActivityType, RoutePoint, PerformanceDataPoint } from '@/types';
import type { DirectionBestRecord, DirectionSummaryStats } from '@/components/routes/performance';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CHART_WIDTH = SCREEN_WIDTH - 32;
const CHART_HEIGHT = 120;
const CHART_PADDING = { left: 12, right: 8, top: 12, bottom: 12 } as const;
const MINI_HEIGHT = 56;
const MINI_PADDING = { left: 4, right: 4, top: 4, bottom: 4 } as const;

/** Format date with 2-digit year (e.g., "Jan 15 '24") */
function formatShortDate(date: Date): string {
  const base = formatShortDateLib(date);
  const year = date.getFullYear().toString().slice(-2);
  return `${base} '${year}`;
}

/** Format date for axis labels — includes day when labels share the same month */
function formatAxisDate(date: Date, includeDay: boolean): string {
  const month = date.toLocaleDateString(getIntlLocale(), { month: 'short' });
  const year = date.getFullYear().toString().slice(-2);
  if (includeDay) {
    return `${month} ${date.getDate()} '${year}`;
  }
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
  onExcludeActivity?: (activityId: string) => void;
  onIncludeActivity?: (activityId: string) => void;
  onSetAsReference?: (activityId: string) => void;
  referenceActivityId?: string;
  showExcluded?: boolean;
  hasExcluded?: boolean;
  onToggleShowExcluded?: () => void;
  /** When true, hides tooltip/scrub hint and disables long-press scrub gesture */
  compact?: boolean;
  /** When true, renders a minimal chart: no text overlays, no gestures, smaller dots */
  mini?: boolean;
  /** External style for controlling width in flex layouts */
  containerStyle?: ViewStyle;
  /** Activity ID to highlight with an orange ring (e.g., the activity that navigated here) */
  highlightedActivityId?: string;
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
  onExcludeActivity,
  onIncludeActivity,
  onSetAsReference,
  referenceActivityId,
  showExcluded,
  hasExcluded,
  onToggleShowExcluded,
  compact,
  mini,
  containerStyle,
  highlightedActivityId,
}: SectionScatterChartProps) {
  const { t } = useTranslation();
  const showPace = isRunningActivity(activityType);
  const activityColor = colors.primary;
  const sectionDistance = chartData[0]?.sectionDistance || 0;

  const effectiveHeight = mini ? MINI_HEIGHT : CHART_HEIGHT;
  const effectivePadding = mini ? MINI_PADDING : CHART_PADDING;
  const dotRadius = mini ? 3 : 4;
  const prRingRadius = mini ? 4.5 : 6;

  const [selectedPoint, setSelectedPoint] = useState<(PerformanceDataPoint & { x: number }) | null>(
    null
  );

  // Clear selection when chart data changes (e.g., sport type filter switch)
  useEffect(() => {
    setSelectedPoint(null);
  }, [chartData]);

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

    // Guard against non-Date values (e.g., raw bigint timestamps from FFI)
    const validData = chartData.filter((p) => p.date instanceof Date && !isNaN(p.date.getTime()));
    if (validData.length === 0) {
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

    const sorted = [...validData].sort((a, b) => a.date.getTime() - b.date.getTime());
    const firstTime = sorted[0].date.getTime();
    const lastTime = sorted[sorted.length - 1].date.getTime();
    const timeRange = lastTime - firstTime || 1;

    // Normalize x to 0-1 (small edge margin so dots aren't clipped)
    const positioned = sorted.map((p) => ({
      ...p,
      x: 0.02 + ((p.date.getTime() - firstTime) / timeRange) * 0.96,
    }));

    const fwd: (PerformanceDataPoint & { x: number })[] = [];
    const rev: (PerformanceDataPoint & { x: number })[] = [];
    let fwdBest = -1;
    let fwdBestSpeed = -Infinity;
    let revBest = -1;
    let revBestSpeed = -Infinity;

    for (const p of positioned) {
      if (p.direction === 'reverse') {
        if (!p.isExcluded && p.speed > revBestSpeed) {
          revBestSpeed = p.speed;
          revBest = rev.length;
        }
        rev.push(p);
      } else {
        if (!p.isExcluded && p.speed > fwdBestSpeed) {
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

  // Compute Gaussian kernel trend lines with confidence bands for all point counts (≥2)
  const { forwardTrend, reverseTrend } = useMemo(() => {
    const buildTrend = (points: (PerformanceDataPoint & { x: number })[]) => {
      if (points.length < 2) return null;
      const xs = points.map((p) => p.x);
      const ys = points.map((p) => p.speed);

      const trend = gaussianSmooth(xs, ys, 200);
      if (trend.length < 2) return null;

      const yMin = Math.min(...ys);
      const yMax = Math.max(...ys);
      const yPad = (yMax - yMin) * 0.15 || 0.5;

      return trend.map((p) => ({
        x: p.x,
        y: Math.max(yMin - yPad, Math.min(yMax + yPad, p.y)),
        upper: Math.min(yMax + yPad, p.y + p.std),
        lower: Math.max(yMin - yPad, p.y - p.std),
      }));
    };

    return {
      forwardTrend: buildTrend(forwardPoints),
      reverseTrend: buildTrend(reversePoints),
    };
  }, [forwardPoints, reversePoints]);

  // Time axis labels: start, middle, end — include day when months repeat
  const timeAxisLabels = useMemo(() => {
    if (allPoints.length < 2) return [];
    const firstDate = allPoints[0].date;
    const lastDate = allPoints[allPoints.length - 1].date;
    const midDate = new Date((firstDate.getTime() + lastDate.getTime()) / 2);
    return [firstDate, midDate, lastDate];
  }, [allPoints]);

  const axisLabelsNeedDay = useMemo(() => {
    if (timeAxisLabels.length < 2) return false;
    const monthKeys = timeAxisLabels.map((d) => `${d.getFullYear()}-${d.getMonth()}`);
    return monthKeys[0] === monthKeys[1] || monthKeys[1] === monthKeys[2];
  }, [timeAxisLabels]);

  const handlePointPress = useCallback(
    (point: PerformanceDataPoint & { x: number }) => {
      setSelectedPoint(point);
      onActivitySelect?.(point.activityId, point.lapPoints);
    },
    [onActivitySelect]
  );

  // Map a pixel X position to the closest data point (X-only, for scrubbing)
  const lastNotifiedIdx = useRef(-1);
  const selectPointAtX = useCallback(
    (locationX: number) => {
      if (allPoints.length === 0) return;
      const chartContentW = CHART_WIDTH - effectivePadding.left - effectivePadding.right;
      const tapX = locationX - effectivePadding.left;
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

  // Map pixel (X, Y) to the closest data point using 2D distance (for taps)
  const selectPointAtXY = useCallback(
    (locationX: number, locationY: number) => {
      if (allPoints.length === 0) return;
      const chartContentW = CHART_WIDTH - effectivePadding.left - effectivePadding.right;
      const chartContentH = effectiveHeight - effectivePadding.top - effectivePadding.bottom;
      const normalizedX = Math.max(
        0,
        Math.min(1, (locationX - effectivePadding.left) / chartContentW)
      );
      const normalizedY = Math.max(
        0,
        Math.min(1, (locationY - effectivePadding.top) / chartContentH)
      );
      // Y in chart goes top=maxSpeed, bottom=minSpeed → invert to get speed-space
      const speedRange = maxSpeed - minSpeed || 1;

      let closestIdx = 0;
      let closestDist = Infinity;
      for (let i = 0; i < allPoints.length; i++) {
        const dx = allPoints[i].x - normalizedX;
        // Normalize speed to 0-1 range, invert Y (top of chart = high speed)
        const pointNormY = 1 - (allPoints[i].speed - minSpeed) / speedRange;
        const dy = pointNormY - normalizedY;
        const dist = dx * dx + dy * dy;
        if (dist < closestDist) {
          closestDist = dist;
          closestIdx = i;
        }
      }
      lastNotifiedIdx.current = closestIdx;
      const closest = allPoints[closestIdx];
      if (closest) handlePointPress(closest);
    },
    [allPoints, handlePointPress, minSpeed, maxSpeed]
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

  // Tap gesture for point selection (uses 2D distance for better outlier targeting)
  const tapGesture = useMemo(
    () =>
      Gesture.Tap()
        .maxDuration(200)
        .onEnd((e) => {
          'worklet';
          runOnJS(selectPointAtXY)(e.x, e.y);
        }),
    [selectPointAtXY]
  );

  // Combined gesture — allows ScrollView to handle scroll momentum
  // In compact mode, skip pan (scrub) gesture entirely; in mini mode, skip all gestures
  const nativeGesture = useMemo(() => Gesture.Native(), []);
  const composedGesture = useMemo(
    () =>
      compact || mini
        ? Gesture.Simultaneous(nativeGesture, tapGesture)
        : Gesture.Simultaneous(nativeGesture, Gesture.Simultaneous(tapGesture, panGesture)),
    [nativeGesture, tapGesture, panGesture, compact, mini]
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
    <View style={[styles.container, isDark && styles.containerDark, containerStyle]}>
      {/* Eye toggle for excluded activities */}
      {!mini && hasExcluded && onToggleShowExcluded && (
        <View style={styles.eyeToggleRow}>
          <TouchableOpacity
            onPress={onToggleShowExcluded}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            style={styles.eyeToggle}
          >
            <MaterialCommunityIcons
              name={showExcluded ? 'eye' : 'eye-off'}
              size={16}
              color={isDark ? darkColors.textSecondary : colors.textSecondary}
            />
          </TouchableOpacity>
        </View>
      )}
      {/* Forward stats row above chart */}
      {!mini &&
        hasForward &&
        renderStatsRow(
          'forward',
          forwardStats,
          bestForwardRecord,
          forwardPoints.length,
          activityColor
        )}

      {/* Chart */}
      <View style={[styles.chartWrapper, { height: effectiveHeight }]}>
        <View style={StyleSheet.absoluteFill}>
          <CartesianChart
            data={allPoints as unknown as Record<string, unknown>[]}
            xKey={'x' as never}
            yKeys={['speed'] as never}
            domain={{ x: [0, 1], y: [minSpeed, maxSpeed] }}
            padding={effectivePadding}
          >
            {
              (({
                points,
                chartBounds,
              }: {
                points: { speed: PointsArray };
                chartBounds: { left: number; right: number; top: number; bottom: number };
              }) => {
                // Build trend + band paths using chart coordinate system
                const xScale = (x: number) =>
                  chartBounds.left + (x / 1) * (chartBounds.right - chartBounds.left);
                const yScale = (y: number) =>
                  chartBounds.top +
                  ((maxSpeed - y) / (maxSpeed - minSpeed)) * (chartBounds.bottom - chartBounds.top);

                const buildPaths = (
                  trend: { x: number; y: number; upper: number; lower: number }[] | null
                ) => {
                  if (!trend || trend.length < 2) return { line: null, band: null };
                  const line = Skia.Path.Make();
                  line.moveTo(xScale(trend[0].x), yScale(trend[0].y));
                  for (let i = 1; i < trend.length; i++) {
                    line.lineTo(xScale(trend[i].x), yScale(trend[i].y));
                  }
                  // Band: upper edge forward, then lower edge backward (closed shape)
                  const band = Skia.Path.Make();
                  band.moveTo(xScale(trend[0].x), yScale(trend[0].upper));
                  for (let i = 1; i < trend.length; i++) {
                    band.lineTo(xScale(trend[i].x), yScale(trend[i].upper));
                  }
                  for (let i = trend.length - 1; i >= 0; i--) {
                    band.lineTo(xScale(trend[i].x), yScale(trend[i].lower));
                  }
                  band.close();
                  return { line, band };
                };

                const fwd = buildPaths(forwardTrend);
                const rev = buildPaths(reverseTrend);

                // Track which allPoints index maps to forward/reverse
                let fwdIdx = 0;
                let revIdx = 0;

                return (
                  <>
                    {/* Confidence bands (drawn first, behind everything) */}
                    {fwd.band && (
                      <Path path={fwd.band} color={activityColor} style="fill" opacity={0.08} />
                    )}
                    {rev.band && (
                      <Path
                        path={rev.band}
                        color={colors.reverseDirection}
                        style="fill"
                        opacity={0.08}
                      />
                    )}
                    {/* Trend lines */}
                    {fwd.line && (
                      <Path
                        path={fwd.line}
                        color={activityColor}
                        style="stroke"
                        strokeWidth={2}
                        opacity={0.6}
                      />
                    )}
                    {rev.line && (
                      <Path
                        path={rev.line}
                        color={colors.reverseDirection}
                        style="stroke"
                        strokeWidth={2}
                        opacity={0.6}
                      />
                    )}

                    {/* Scatter points */}
                    {(() => {
                      const highlight: { x: number; y: number }[] = [];

                      const dots = points.speed.map((point: PointsArray[number], idx: number) => {
                        if (point.x == null || point.y == null) return null;

                        const dataPoint = allPoints[idx];
                        if (!dataPoint) return null;

                        const isReverse = dataPoint.direction === 'reverse';
                        const dotColor = isReverse ? colors.reverseDirection : activityColor;
                        const isPointExcluded = dataPoint.isExcluded === true;

                        // Determine if this is the best in its direction
                        let isBest = false;
                        if (!isPointExcluded) {
                          if (isReverse) {
                            if (revIdx === reverseBestIdx) isBest = true;
                            revIdx++;
                          } else {
                            if (fwdIdx === forwardBestIdx) isBest = true;
                            fwdIdx++;
                          }
                        }

                        // Track highlighted point for rendering last (on top)
                        const isHighlighted =
                          highlightedActivityId != null &&
                          dataPoint.activityId === highlightedActivityId;
                        if (isHighlighted && highlight.length === 0) {
                          highlight.push({ x: point.x, y: point.y });
                        }

                        const isSelected =
                          selectedPoint?.activityId === dataPoint.activityId &&
                          selectedPoint?.id === dataPoint.id;

                        if (isSelected) {
                          return (
                            <React.Fragment key={`pt-${idx}`}>
                              <Circle
                                cx={point.x}
                                cy={point.y}
                                r={dotRadius + 3}
                                color={colors.chartCyan}
                              />
                              <Circle cx={point.x} cy={point.y} r={dotRadius} color={dotColor} />
                            </React.Fragment>
                          );
                        }

                        // Skip highlighted point in main loop — rendered on top below
                        if (isHighlighted) return null;

                        if (isPointExcluded) {
                          return (
                            <Circle
                              key={`pt-${idx}`}
                              cx={point.x}
                              cy={point.y}
                              r={dotRadius - 1}
                              color={isDark ? darkColors.textSecondary : colors.textSecondary}
                              opacity={0.25}
                            />
                          );
                        }

                        if (isBest) {
                          return (
                            <React.Fragment key={`pt-${idx}`}>
                              <Circle cx={point.x} cy={point.y} r={dotRadius} color={dotColor} />
                              <Circle
                                cx={point.x}
                                cy={point.y}
                                r={prRingRadius}
                                color={colors.chartGold}
                                style="stroke"
                                strokeWidth={1.5}
                              />
                            </React.Fragment>
                          );
                        }

                        return (
                          <Circle
                            key={`pt-${idx}`}
                            cx={point.x}
                            cy={point.y}
                            r={dotRadius}
                            color={dotColor}
                            opacity={0.7}
                          />
                        );
                      });

                      const hp = highlight[0];
                      return (
                        <>
                          {dots}
                          {hp && (
                            <React.Fragment key="highlighted-activity">
                              <Circle
                                cx={hp.x}
                                cy={hp.y}
                                r={dotRadius + 3}
                                color={colors.primary}
                                style="stroke"
                                strokeWidth={1.5}
                              />
                              <Circle
                                cx={hp.x}
                                cy={hp.y}
                                r={dotRadius + 1}
                                color={colors.primary}
                              />
                            </React.Fragment>
                          )}
                        </>
                      );
                    })()}
                  </>
                );
              }) as any
            }
          </CartesianChart>
        </View>

        {/* Gesture target for tap + long-press scrub */}
        {!mini && (
          <GestureDetector gesture={composedGesture}>
            <Animated.View style={styles.tapTarget} />
          </GestureDetector>
        )}

        {/* Crosshair (visible during scrubbing) */}
        {!mini && <Animated.View style={[styles.crosshair, crosshairStyle]} pointerEvents="none" />}

        {/* Y-axis labels */}
        {!mini && (
          <View style={styles.yAxisOverlay} pointerEvents="none">
            <Text style={[styles.axisLabel, isDark && styles.axisLabelDark]}>
              {formatSpeedValue(maxSpeed)}
            </Text>
            <Text style={[styles.axisLabel, isDark && styles.axisLabelDark]}>
              {formatSpeedValue(minSpeed)}
            </Text>
          </View>
        )}
      </View>

      {/* Time axis: start / middle / end */}
      {!mini && timeAxisLabels.length > 0 && (
        <View style={styles.timeAxis}>
          {timeAxisLabels.map((date, idx) => (
            <Text
              key={idx}
              style={[
                styles.timeAxisLabel,
                isDark && styles.axisLabelDark,
                idx === 0 && styles.timeAxisLabelFirst,
                idx === 1 && styles.timeAxisLabelMiddle,
                idx === timeAxisLabels.length - 1 && styles.timeAxisLabelLast,
              ]}
            >
              {formatAxisDate(date, axisLabelsNeedDay)}
            </Text>
          ))}
        </View>
      )}

      {/* Reverse stats row below chart */}
      {!mini &&
        hasReverse &&
        renderStatsRow(
          'reverse',
          reverseStats,
          bestReverseRecord,
          reversePoints.length,
          colors.reverseDirection
        )}

      {/* Tooltip — hidden in compact mode */}
      {!compact && (
        <View style={styles.tooltipContainer}>
          {selectedPoint ? (
            <TouchableOpacity
              style={[styles.selectedTooltip, isDark && styles.selectedTooltipDark]}
              onPress={() => navigateTo(`/activity/${selectedPoint.activityId}`)}
              activeOpacity={0.7}
            >
              <View style={styles.tooltipLeft}>
                <View style={styles.tooltipNameRow}>
                  {selectedPoint.isBest && (
                    <MaterialCommunityIcons
                      name="trophy"
                      size={13}
                      color={colors.chartGold}
                      style={{ marginRight: 3 }}
                    />
                  )}
                  <Text style={[styles.tooltipName, isDark && styles.textLight]} numberOfLines={1}>
                    {selectedPoint.activityName}
                  </Text>
                  {(selectedPoint.lapCount ?? 0) > 1 && (
                    <View style={styles.lapBadge}>
                      <Text style={styles.lapBadgeText}>{selectedPoint.lapCount}x</Text>
                    </View>
                  )}
                </View>
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
                  {(() => {
                    const delta = formatPerformanceDelta({
                      isBest: selectedPoint.isBest === true,
                      showPace: showPace,
                      currentSpeed: selectedPoint.speed,
                      bestSpeed: selectedPoint.bestSpeed,
                      timeDelta:
                        selectedPoint.sectionTime != null && selectedPoint.bestTime != null
                          ? selectedPoint.sectionTime - selectedPoint.bestTime
                          : undefined,
                    });
                    if (delta.deltaDisplay) {
                      return (
                        <Text
                          style={[
                            styles.tooltipDelta,
                            { color: delta.isFaster ? colors.success : colors.error },
                          ]}
                        >
                          {' \u00b7 '}
                          {delta.deltaDisplay}
                        </Text>
                      );
                    }
                    return null;
                  })()}
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
                {onSetAsReference && !selectedPoint.isExcluded && (
                  <TouchableOpacity
                    onPress={() => onSetAsReference(selectedPoint.activityId)}
                    hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                    style={styles.referenceButton}
                    accessibilityLabel="Set as reference"
                    accessibilityRole="button"
                  >
                    <MaterialCommunityIcons
                      name={
                        selectedPoint.activityId === referenceActivityId ? 'star' : 'star-outline'
                      }
                      size={18}
                      color={
                        selectedPoint.activityId === referenceActivityId
                          ? colors.primary
                          : isDark
                            ? darkColors.textSecondary
                            : colors.textSecondary
                      }
                    />
                  </TouchableOpacity>
                )}
                {selectedPoint.isExcluded && onIncludeActivity ? (
                  <TouchableOpacity
                    onPress={() => {
                      onIncludeActivity(selectedPoint.activityId);
                      setSelectedPoint(null);
                      onActivitySelect?.(null);
                    }}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    style={styles.excludeButton}
                  >
                    <MaterialCommunityIcons name="undo" size={16} color={colors.primary} />
                  </TouchableOpacity>
                ) : (
                  onExcludeActivity &&
                  !selectedPoint.isExcluded && (
                    <TouchableOpacity
                      onPress={() => {
                        onExcludeActivity(selectedPoint.activityId);
                        setSelectedPoint(null);
                        onActivitySelect?.(null);
                      }}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      style={styles.excludeButton}
                    >
                      <MaterialCommunityIcons
                        name="close-circle-outline"
                        size={16}
                        color={isDark ? darkColors.textSecondary : colors.textSecondary}
                      />
                    </TouchableOpacity>
                  )
                )}
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
      )}
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
  eyeToggleRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: 12,
    paddingBottom: 4,
  },
  eyeToggle: {
    padding: 4,
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
    left: CHART_PADDING.left + 2,
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
  timeAxisLabelMiddle: {
    textAlign: 'center',
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
  tooltipNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  tooltipName: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textPrimary,
    marginBottom: 1,
    flex: 1,
  },
  lapBadge: {
    backgroundColor: colors.textMuted + '20',
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 4,
    marginLeft: 4,
  },
  lapBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  tooltipDelta: {
    fontSize: 11,
    fontWeight: '600',
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
  referenceButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 2,
  },
  excludeButton: {
    padding: 2,
    marginLeft: 4,
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

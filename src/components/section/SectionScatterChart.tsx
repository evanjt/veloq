/**
 * Scatter chart for section performance data.
 * Fixed-width chart showing all traversals at a glance with LOESS trend lines.
 * Forward and reverse directions share a single Y axis.
 */

import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { View, StyleSheet, TouchableOpacity, Dimensions, type ViewStyle } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { CartesianChart, type PointsArray } from 'victory-native';
import { Circle, Path, Skia } from '@shopify/react-native-skia';
import { GestureDetector } from 'react-native-gesture-handler';
import Animated from 'react-native-reanimated';
import { formatDuration, formatPace, formatSpeed, isRunningActivity } from '@/lib';
import {
  splitAndPositionChartData,
  buildTrendWithBand,
  type TrendBandPoint,
} from '@/lib/charts/scatterData';
import { computeTimeAxisLabels, axisLabelsNeedDay, formatAxisDate } from '@/lib/charts/timeAxis';
import { useScatterGestures } from '@/hooks/charts/useScatterGestures';
import { colors, darkColors } from '@/theme';
import type { ActivityType, RoutePoint, PerformanceDataPoint } from '@/types';
import type { DirectionBestRecord, DirectionSummaryStats } from '@/components/routes/performance';
import { StatsRow } from './StatsRow';
import { PerformanceTooltip } from './PerformanceTooltip';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CHART_WIDTH = SCREEN_WIDTH - 32;
const CHART_HEIGHT = 120;
const CHART_PADDING = { left: 12, right: 8, top: 12, bottom: 12 } as const;
const MINI_HEIGHT = 56;
const MINI_PADDING = { left: 4, right: 4, top: 4, bottom: 4 } as const;

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
  /** When true, Y-axis shows time (inverted: shorter = higher) instead of speed */
  useTimeAxis?: boolean;
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
  useTimeAxis,
}: SectionScatterChartProps) {
  const showPace = isRunningActivity(activityType);
  const activityColor = isDark ? '#FC4C02' : colors.primary;
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

  // Separate forward/reverse, compute positions, find PRs (pure fn in @/lib/charts/scatterData)
  // Gold ring = highest point on displayed axis (speed for sections, time for routes)
  const {
    forwardPoints,
    reversePoints,
    allPoints,
    forwardBestIdx,
    reverseBestIdx,
    minSpeed,
    maxSpeed,
    minTime,
    maxTime,
  } = useMemo(
    () => splitAndPositionChartData(chartData, useTimeAxis ? 'time' : 'speed'),
    [chartData, useTimeAxis]
  );

  const yMin = useTimeAxis ? maxTime : minSpeed;
  const yMax = useTimeAxis ? minTime : maxSpeed;

  // Compute Gaussian kernel trend lines with confidence bands for all point counts (≥2)
  const { forwardTrend, reverseTrend } = useMemo(
    () => ({
      forwardTrend: buildTrendWithBand(forwardPoints, 200, useTimeAxis ? 'sectionTime' : 'speed'),
      reverseTrend: buildTrendWithBand(reversePoints, 200, useTimeAxis ? 'sectionTime' : 'speed'),
    }),
    [forwardPoints, reversePoints]
  );

  // Time axis labels: start, middle, end — include day when months repeat
  const timeAxisLabels = useMemo(() => computeTimeAxisLabels(allPoints), [allPoints]);
  const needsDayLabel = useMemo(() => axisLabelsNeedDay(timeAxisLabels), [timeAxisLabels]);

  const handlePointPress = useCallback(
    (point: PerformanceDataPoint & { x: number }) => {
      setSelectedPoint(point);
      onActivitySelect?.(point.activityId, point.lapPoints);
    },
    [onActivitySelect]
  );

  const { composedGesture, crosshairStyle } = useScatterGestures({
    allPoints,
    chartWidth: CHART_WIDTH,
    chartHeight: effectiveHeight,
    padding: effectivePadding,
    minSpeed,
    maxSpeed,
    compact,
    mini,
    onPointSelected: handlePointPress,
    onScrubChange,
  });

  if (chartData.length < 1) return null;

  const hasForward = forwardPoints.length > 0;
  const hasReverse = reversePoints.length > 0;

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
      {!mini && hasForward && (
        <StatsRow
          direction="forward"
          stats={forwardStats}
          bestRecord={bestForwardRecord}
          pointCount={forwardPoints.length}
          color={activityColor}
          showPace={showPace}
          sectionDistance={sectionDistance}
          isDark={isDark}
        />
      )}

      {/* Chart */}
      <View style={[styles.chartWrapper, { height: effectiveHeight }]}>
        <View style={StyleSheet.absoluteFill}>
          <CartesianChart
            data={allPoints as unknown as Record<string, unknown>[]}
            xKey={'x' as never}
            yKeys={[useTimeAxis ? 'sectionTime' : 'speed'] as never}
            domain={{ x: [0, 1], y: [yMin, yMax] }}
            padding={effectivePadding}
          >
            {
              (({
                points,
                chartBounds,
              }: {
                points: { speed: PointsArray; sectionTime: PointsArray };
                chartBounds: { left: number; right: number; top: number; bottom: number };
              }) => {
                const yField = useTimeAxis ? points.sectionTime : points.speed;
                // Build trend + band paths using chart coordinate system
                const xScale = (x: number) =>
                  chartBounds.left + (x / 1) * (chartBounds.right - chartBounds.left);
                const yScale = (y: number) =>
                  chartBounds.top +
                  ((yMax - y) / (yMax - yMin)) * (chartBounds.bottom - chartBounds.top);

                const buildPaths = (trend: TrendBandPoint[] | null) => {
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

                      const dots = yField.map((point: PointsArray[number], idx: number) => {
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
                                color={colors.chartGreen}
                                style="stroke"
                                strokeWidth={1.5}
                              />
                              <Circle
                                cx={hp.x}
                                cy={hp.y}
                                r={dotRadius + 1}
                                color={colors.chartGreen}
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
              {useTimeAxis ? formatDuration(minTime) : formatSpeedValue(maxSpeed)}
            </Text>
            <Text style={[styles.axisLabel, isDark && styles.axisLabelDark]}>
              {useTimeAxis ? formatDuration(maxTime) : formatSpeedValue(minSpeed)}
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
              {formatAxisDate(date, needsDayLabel)}
            </Text>
          ))}
        </View>
      )}

      {/* Reverse stats row below chart */}
      {!mini && hasReverse && (
        <StatsRow
          direction="reverse"
          stats={reverseStats}
          bestRecord={bestReverseRecord}
          pointCount={reversePoints.length}
          color={colors.reverseDirection}
          showPace={showPace}
          sectionDistance={sectionDistance}
          isDark={isDark}
        />
      )}

      {/* Tooltip — hidden in compact mode */}
      {!compact && (
        <PerformanceTooltip
          selectedPoint={selectedPoint}
          isDark={isDark}
          showPace={showPace}
          activityColor={activityColor}
          referenceActivityId={referenceActivityId}
          onSetAsReference={onSetAsReference}
          onExcludeActivity={onExcludeActivity}
          onIncludeActivity={onIncludeActivity}
          onClearSelection={() => {
            setSelectedPoint(null);
            onActivitySelect?.(null);
          }}
        />
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
});

/**
 * Scatter chart for section performance data.
 * Fixed-width chart showing one direction at a time, with an engine trend
 * and confidence band on that direction's Y axis.
 */

import { useMetricSystem } from '@/shared/app';
import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { View, Pressable, StyleSheet, type ViewStyle, useWindowDimensions } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';

import { DENSE_TEXT_SCALE } from '@/shared/ui/DenseText';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Circle, Path, Skia } from '@shopify/react-native-skia';
import {
  ChartCanvas,
  bandSvgPath,
  chartBoundsFor,
  polylineSvgPath,
  useChartGestures,
  xForValue,
  yForValue,
} from '@/shared/charts';
import { GestureDetector } from 'react-native-gesture-handler';
import Animated from 'react-native-reanimated';
import { isPaceSport, isSwimmingActivity } from '@/shared/activity/activityUtils';
import { formatAxisDate, formatDuration } from '@/shared/format/format';
import { formatSectionSpeed } from '@/features/routes/lib/sectionSpeedFormat';
import {
  splitAndPositionChartData,
  placeEngineTrend,
  nearestScatterPointIndex,
  resolveChartDirection,
  type ChartDirection,
  type TrendBandPoint,
} from '@/features/routes/lib/scatterData';
import { computeTimeAxisLabels, axisLabelsNeedDay } from '@/features/stats';
import { colors, darkColors, layout, typography, spacing } from '@/theme';
import type { FfiSectionTrendCurves } from 'veloqrs';
import type { ActivityType, RoutePoint, PerformanceDataPoint } from '@/types';
import type {
  DirectionBestRecord,
  DirectionSummaryStats,
} from '@/features/routes/lib/performanceTypes';
import { StatsRow } from './StatsRow';
import { PerformanceTooltip } from './PerformanceTooltip';
import { pressable, pressRipple, ToggleButton } from '@/shared/ui';

/** Horizontal room the chart leaves at the window edge. */
const CHART_INSET = 32;
const CHART_HEIGHT = 120;
const CHART_PADDING = { left: 12, right: 8, top: 12, bottom: 12 } as const;
const MINI_HEIGHT = 56;
const MINI_PADDING = { left: 4, right: 4, top: 4, bottom: 4 } as const;
const X_DOMAIN: [number, number] = [0, 1];
const NO_SERIES = {} as Record<never, (p: PerformanceDataPoint) => number>;
const xOf = (p: { x: number }) => p.x;

export interface SectionScatterChartProps {
  chartData: (PerformanceDataPoint & { x: number })[];
  activityType: ActivityType;
  isDark: boolean;
  bestForwardRecord: DirectionBestRecord | null;
  bestReverseRecord: DirectionBestRecord | null;
  bestForwardIsRecord: boolean;
  bestReverseIsRecord: boolean;
  forwardStats: DirectionSummaryStats | null;
  reverseStats: DirectionSummaryStats | null;
  onActivitySelect?:
    | ((activityId: string | null, activityPoints?: RoutePoint[]) => void)
    | undefined;
  onExcludeActivity?: ((activityId: string) => void) | undefined;
  onIncludeActivity?: ((activityId: string) => void) | undefined;
  onSetAsReference?: ((activityId: string) => void) | undefined;
  referenceActivityId?: string | undefined;
  showExcluded?: boolean | undefined;
  hasExcluded?: boolean | undefined;
  onToggleShowExcluded?: (() => void) | undefined;
  /** When true, hides tooltip/scrub hint and disables long-press scrub gesture */
  compact?: boolean | undefined;
  /** When true, renders a minimal chart: no text overlays, no gestures, smaller dots */
  mini?: boolean | undefined;
  /** External style for controlling width in flex layouts */
  containerStyle?: ViewStyle | undefined;
  /** Activity ID to highlight with a green ring (e.g., the activity that navigated here) */
  highlightedActivityId?: string | undefined;
  /** When true, Y-axis shows time (inverted: shorter = higher) instead of speed */
  useTimeAxis?: boolean | undefined;
  /** The engine's trend curves for the counted attempts. */
  trendCurves: FfiSectionTrendCurves;
  /**
   * The direction shown, when a parent owns the direction control. The chart
   * then draws no direction toggles of its own.
   */
  selectedDirection?: ChartDirection | undefined;
}

export function SectionScatterChart({
  chartData,
  activityType,
  isDark,
  bestForwardRecord,
  bestReverseRecord,
  bestForwardIsRecord,
  bestReverseIsRecord,
  forwardStats,
  reverseStats,
  onActivitySelect,
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
  trendCurves,
  selectedDirection: controlledDirection,
}: SectionScatterChartProps) {
  const isSwimming = isSwimmingActivity(activityType);
  const showPace = isPaceSport(activityType) || isSwimming;
  const activityColor = isDark ? darkColors.primary : colors.primary;
  // The ring is the only thing that says "personal best" or "this activity",
  // so it is a mark and owes 3:1 rather than a chart tone.
  const prMarkColor = isDark ? darkColors.chartGoldMark : colors.chartGoldMark;
  const highlightMarkColor = isDark ? darkColors.chartGreenMark : colors.chartGreenMark;

  const effectiveHeight = mini ? MINI_HEIGHT : CHART_HEIGHT;
  const effectivePadding = mini ? MINI_PADDING : CHART_PADDING;
  const dotRadius = mini ? 3 : 4;
  const prRingRadius = mini ? 4.5 : 6;

  const [selectedPoint, setSelectedPoint] = useState<(PerformanceDataPoint & { x: number }) | null>(
    null
  );
  const [requestedDirection, setRequestedDirection] = useState<ChartDirection | null>(null);
  const { t } = useTranslation();

  // Clear selection when chart data changes (e.g., sport type filter switch).
  // Clearing while rendering keeps the previous selection out of the first
  // frame drawn against the new data.
  const [selectionFor, setSelectionFor] = useState(chartData);
  const [selectionDirection, setSelectionDirection] = useState(controlledDirection);
  if (chartData !== selectionFor || controlledDirection !== selectionDirection) {
    setSelectionFor(chartData);
    setSelectionDirection(controlledDirection);
    setSelectedPoint(null);
  }

  const isMetric = useMetricSystem();
  const { width: windowWidth } = useWindowDimensions();
  const chartWidth = windowWidth - CHART_INSET;

  const formatSpeedValue = useCallback(
    (speed: number) => formatSectionSpeed(speed, activityType, isMetric),
    [activityType, isMetric]
  );

  // Separate forward/reverse, compute positions, find PRs (pure fn in lib/scatterData)
  // Gold ring = the points the engine flags as a record, whichever axis is shown
  const { forwardPoints, reversePoints, allPoints, domains } = useMemo(
    () => splitAndPositionChartData(chartData),
    [chartData]
  );
  const hasForward = domains.forward !== null;
  const hasReverse = domains.reverse !== null;
  const originDirection =
    allPoints.find((point) => point.activityId === highlightedActivityId)?.direction === 'reverse'
      ? 'reverse'
      : 'forward';
  const selectedDirection =
    controlledDirection ??
    resolveChartDirection(requestedDirection, originDirection, hasForward, hasReverse);
  const drawnPoints = useMemo(
    () =>
      allPoints.filter(
        (point) => (point.direction === 'reverse' ? 'reverse' : 'forward') === selectedDirection
      ),
    [allPoints, selectedDirection]
  );
  const { minSpeed, maxSpeed, minTime, maxTime } = domains[selectedDirection] ?? {
    minSpeed: 0,
    maxSpeed: 1,
    minTime: 0,
    maxTime: 1,
  };

  const yMin = useTimeAxis ? maxTime : minSpeed;
  const yMax = useTimeAxis ? minTime : maxSpeed;
  const yDomain = useMemo<[number, number]>(() => [yMin, yMax], [yMin, yMax]);

  /** The value each point is drawn at, and the one a tap is resolved against. */
  const yOf = useCallback(
    (p: PerformanceDataPoint) => (useTimeAxis ? p.sectionTime : p.speed),
    [useTimeAxis]
  );

  // Trend lines with confidence bands: the engine's curves placed on the
  // chart's x axis.
  const selectedTrend = useMemo(
    () =>
      placeEngineTrend(
        selectedDirection === 'reverse'
          ? useTimeAxis
            ? trendCurves.reverseTime
            : trendCurves.reverseSpeed
          : useTimeAxis
            ? trendCurves.forwardTime
            : trendCurves.forwardSpeed,
        allPoints
      ),
    [trendCurves, allPoints, useTimeAxis, selectedDirection]
  );

  // Time axis labels: start, middle, end - include day when months repeat
  const timeAxisLabels = useMemo(() => computeTimeAxisLabels(allPoints), [allPoints]);
  const needsDayLabel = useMemo(() => axisLabelsNeedDay(timeAxisLabels), [timeAxisLabels]);

  const handlePointPress = useCallback(
    (point: PerformanceDataPoint & { x: number }) => {
      setSelectedPoint(point);
      onActivitySelect?.(point.activityId, point.lapPoints);
    },
    [onActivitySelect]
  );

  // Points carry a normalised x, so turn them into pixels once for the scrub
  // to snap against.
  const pointXCoords = useMemo(() => {
    const contentWidth = chartWidth - effectivePadding.left - effectivePadding.right;
    return drawnPoints.map((point) => effectivePadding.left + point.x * contentWidth);
  }, [drawnPoints, effectivePadding, chartWidth]);

  // The tap has to resolve against the axis the chart drew, so the points go
  // in on the same accessor and domain the dots are placed with.
  const tapPoints = useMemo(
    () => drawnPoints.map((p) => ({ x: p.x, y: yOf(p) })),
    [drawnPoints, yOf]
  );

  // Trend and band paths are pixels, so they only move when the box or the
  // domain does. Rebuilding them inside the render prop re-parsed the SVG
  // strings on every scrub tick.
  const trendPaths = useMemo(() => {
    const bounds = chartBoundsFor(chartWidth, effectiveHeight, effectivePadding);
    const xFor = (value: number) => xForValue(value, X_DOMAIN, bounds);
    const yFor = (value: number) => yForValue(value, yDomain, bounds);
    const build = (trend: TrendBandPoint[] | null) => {
      if (!trend || trend.length < 2) return { line: null, band: null };
      const linePts = trend.map((p) => ({ x: xFor(p.x), y: yFor(p.y) }));
      // Band: upper edge forward, then lower edge backward (closed shape)
      const upperPts = trend.map((p) => ({ x: xFor(p.x), y: yFor(p.upper) }));
      const lowerPts = trend.map((p) => ({ x: xFor(p.x), y: yFor(p.lower) }));
      return {
        line: Skia.Path.MakeFromSVGString(polylineSvgPath(linePts)),
        band: Skia.Path.MakeFromSVGString(bandSvgPath(upperPts, lowerPts)),
      };
    };
    return build(selectedTrend);
  }, [selectedTrend, chartWidth, effectiveHeight, effectivePadding, yDomain]);

  // Taps match on 2D distance so an outlier high above the trend is reachable.
  const resolveTapIndex = useCallback(
    (x: number, y: number) => {
      const contentWidth = chartWidth - effectivePadding.left - effectivePadding.right;
      const contentHeight = effectiveHeight - effectivePadding.top - effectivePadding.bottom;
      return nearestScatterPointIndex(
        tapPoints,
        {
          x: Math.max(0, Math.min(1, (x - effectivePadding.left) / contentWidth)),
          y: Math.max(0, Math.min(1, (y - effectivePadding.top) / contentHeight)),
        },
        yDomain
      );
    },
    [tapPoints, effectivePadding, effectiveHeight, chartWidth, yDomain]
  );

  const { gesture, crosshairStyle, syncBounds, syncXCoords } = useChartGestures<
    PerformanceDataPoint & { x: number }
  >({
    data: drawnPoints,
    enabled: !mini,
    scrubEnabled: !compact,
    crosshairMode: 'finger',
    onSelect: handlePointPress,
    resolveTapIndex,
  });

  useEffect(() => {
    syncBounds({ left: 0, right: chartWidth, top: 0, bottom: effectiveHeight });
    syncXCoords(pointXCoords, (value) => value);
  }, [syncBounds, syncXCoords, pointXCoords, effectiveHeight, chartWidth]);

  if (chartData.length < 1) return null;

  return (
    <View style={[styles.container, isDark && styles.containerDark, containerStyle]}>
      {/* Eye toggle for excluded activities */}
      {!mini && hasExcluded && onToggleShowExcluded && (
        <View style={styles.eyeToggleRow}>
          <Pressable
            onPress={onToggleShowExcluded}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            style={pressable(styles.eyeToggle)}
            android_ripple={pressRipple}
          >
            <MaterialCommunityIcons
              name={showExcluded ? 'eye' : 'eye-off'}
              size={16}
              color={isDark ? darkColors.textSecondary : colors.textSecondary}
            />
          </Pressable>
        </View>
      )}
      {!mini && controlledDirection === undefined && hasForward && hasReverse && (
        <View style={styles.directionControl}>
          {(['forward', 'reverse'] as const).map((direction) => (
            <ToggleButton
              key={direction}
              testID={`section-chart-direction-${direction}`}
              label={t(direction === 'reverse' ? 'sections.reverse' : 'sections.forward')}
              selected={selectedDirection === direction}
              onPress={() => {
                setRequestedDirection(direction);
                setSelectedPoint(null);
                onActivitySelect?.(null);
              }}
              style={{
                borderColor: direction === 'reverse' ? colors.reverseDirection : activityColor,
              }}
            />
          ))}
        </View>
      )}
      {/* Forward stats row above chart */}
      {!mini && selectedDirection === 'forward' && forwardPoints.length > 0 && (
        <StatsRow
          direction="forward"
          stats={forwardStats}
          bestRecord={bestForwardRecord}
          bestIsRecord={bestForwardIsRecord}
          pointCount={forwardPoints.length}
          color={activityColor}
          showPace={showPace}
          isDark={isDark}
        />
      )}

      {/* Chart */}
      <View style={{ width: chartWidth, height: effectiveHeight }}>
        <View style={StyleSheet.absoluteFill}>
          <ChartCanvas
            data={drawnPoints}
            x={xOf}
            series={NO_SERIES}
            xDomain={X_DOMAIN}
            yDomain={yDomain}
            padding={effectivePadding}
            grid={5}
          >
            {({ xFor, yFor }) => {
              return (
                <>
                  {/* Confidence bands (drawn first, behind everything) */}
                  {trendPaths.band && (
                    <Path
                      path={trendPaths.band}
                      color={
                        selectedDirection === 'reverse' ? colors.reverseDirection : activityColor
                      }
                      style="fill"
                      opacity={0.08}
                    />
                  )}
                  {/* Trend lines */}
                  {trendPaths.line && (
                    <Path
                      path={trendPaths.line}
                      color={
                        selectedDirection === 'reverse' ? colors.reverseDirection : activityColor
                      }
                      style="stroke"
                      strokeWidth={2}
                      opacity={0.6}
                    />
                  )}

                  {/* Scatter points */}
                  {(() => {
                    const highlight: { x: number; y: number }[] = [];

                    const dots = drawnPoints.map((dataPoint, idx) => {
                      const yValue = yOf(dataPoint);
                      if (yValue == null || !Number.isFinite(yValue)) return null;
                      const point = { x: xFor(dataPoint.x), y: yFor(yValue) };

                      const isReverse = dataPoint.direction === 'reverse';
                      const dotColor = isReverse ? colors.reverseDirection : activityColor;
                      const isPointExcluded = dataPoint.isExcluded === true;

                      const isBest = !isPointExcluded && dataPoint.isBest === true;

                      // Track highlighted point for rendering last (on top)
                      const isHighlighted =
                        highlightedActivityId != null &&
                        dataPoint.activityId === highlightedActivityId;
                      if (isHighlighted && highlight.length === 0) {
                        highlight.push(point);
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

                      // Skip highlighted point in main loop - rendered on top below
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

                      if (dataPoint.outsideDistanceBand === true) {
                        return (
                          <Circle
                            key={`pt-${idx}`}
                            cx={point.x}
                            cy={point.y}
                            r={dotRadius - 0.75}
                            color={dotColor}
                            style="stroke"
                            strokeWidth={1.5}
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
                              color={prMarkColor}
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
                              color={highlightMarkColor}
                              style="stroke"
                              strokeWidth={1.5}
                            />
                            <Circle
                              cx={hp.x}
                              cy={hp.y}
                              r={dotRadius + 1}
                              color={highlightMarkColor}
                            />
                          </React.Fragment>
                        )}
                      </>
                    );
                  })()}
                </>
              );
            }}
          </ChartCanvas>
        </View>

        {/* Gesture target for tap + long-press scrub */}
        {!mini && (
          <GestureDetector gesture={gesture}>
            <Animated.View style={styles.tapTarget} />
          </GestureDetector>
        )}

        {/* Crosshair (visible during scrubbing) */}
        {!mini && <Animated.View style={[styles.crosshair, crosshairStyle]} pointerEvents="none" />}

        {/* Y-axis labels */}
        {!mini && (
          <View style={styles.yAxisOverlay} pointerEvents="none">
            <Text
              maxFontSizeMultiplier={DENSE_TEXT_SCALE}
              style={[styles.axisLabel, isDark && styles.axisLabelDark]}
            >
              {useTimeAxis ? formatDuration(minTime) : formatSpeedValue(maxSpeed)}
            </Text>
            <Text
              maxFontSizeMultiplier={DENSE_TEXT_SCALE}
              style={[styles.axisLabel, isDark && styles.axisLabelDark]}
            >
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
              maxFontSizeMultiplier={DENSE_TEXT_SCALE}
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
      {!mini && selectedDirection === 'reverse' && reversePoints.length > 0 && (
        <StatsRow
          direction="reverse"
          stats={reverseStats}
          bestRecord={bestReverseRecord}
          bestIsRecord={bestReverseIsRecord}
          pointCount={reversePoints.length}
          color={colors.reverseDirection}
          showPace={showPace}
          isDark={isDark}
        />
      )}

      {/* Tooltip - hidden in compact mode */}
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
    borderRadius: layout.borderRadiusMd,
    overflow: 'hidden',
  },
  containerDark: {
    backgroundColor: darkColors.surfaceCard,
  },
  eyeToggleRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: spacing.smPlus,
    paddingBottom: spacing.xs,
  },
  eyeToggle: {
    padding: spacing.xs,
  },
  directionControl: {
    flexDirection: 'row',
    alignSelf: 'center',
    gap: spacing.xs,
    borderRadius: layout.borderRadiusMd,
    backgroundColor: colors.backgroundAlt,
    marginBottom: spacing.xs,
  },
  tapTarget: {
    ...StyleSheet.absoluteFill,
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
    paddingBottom: spacing.xs,
  },
  timeAxisLabel: {
    fontSize: typography.pillLabel.fontSize,
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
    fontSize: typography.pillLabel.fontSize,
    color: colors.textMuted,
  },
  axisLabelDark: {
    color: darkColors.textMuted,
  },
});

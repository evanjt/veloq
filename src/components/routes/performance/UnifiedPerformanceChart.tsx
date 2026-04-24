/**
 * Unified performance chart for route and section detail pages.
 *
 * Shows speed/pace over time with collapsible swim lanes for forward/reverse
 * directions. Each lane shows traversal count and can be collapsed.
 */

import React, { useState, useMemo, useCallback, useRef } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  Pressable,
  LayoutAnimation,
  Dimensions,
  PixelRatio,
  ScrollView,
} from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { navigateTo } from '@/lib';
import {
  detectGaps,
  buildGapCompression,
  calculateChartWidth,
  DEFAULT_COMPRESSED_GAP_DAYS,
  DEFAULT_GAP_THRESHOLD_DAYS,
} from '@/lib/charts/gapCompression';
import { splitIntoLanes, type LaneData } from '@/lib/charts/unifiedPerformanceData';
import { formatShortDateWithYear } from '@/lib/charts/dateFormatting';
import { formatAxisDate } from '@/lib/charts/timeAxis';
import { LaneHeader } from './LaneHeader';
import { CartesianChart, Line, type PointsArray } from 'victory-native';
import { Circle } from '@shopify/react-native-skia';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  useAnimatedReaction,
  useAnimatedRef,
  useAnimatedScrollHandler,
  scrollTo,
  runOnJS,
} from 'react-native-reanimated';
import {
  formatPace,
  formatSpeed,
  formatDuration,
  isRunningActivity,
  getActivityColor,
} from '@/lib';
import { CHART_CONFIG } from '@/constants';
import { colors, darkColors, chartStyles } from '@/theme';
import type { ActivityType, RoutePoint, PerformanceDataPoint } from '@/types';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CHART_PADDING_LEFT = 40;
const CHART_PADDING_RIGHT = 20;
const MIN_POINT_SPACING = 50; // Minimum pixels between points
const BASE_CHART_WIDTH = SCREEN_WIDTH - 32; // Default chart width
// Metal/GPU texture limit is 8192px — Skia canvas backing texture is scaled by pixelRatio
const MAX_CHART_WIDTH = Math.floor(8192 / PixelRatio.get()) - 1;

const LANE_HEIGHT = 80;

/** Summary statistics to display in the chart header */
export interface ChartSummaryStats {
  bestTime: number | null;
  avgTime: number | null;
  totalActivities: number;
  lastActivity: Date | null;
  currentTime?: number | null;
  bestDate?: Date | null;
}

/** Per-direction best record for display in lane header */
export interface DirectionBestRecord {
  bestTime: number;
  bestSpeed?: number; // Speed (m/s) for routes where distance varies
  bestPace?: number; // Pace (s/km) for running sections
  activityDate: Date;
}

/** Per-direction summary stats for lane header display */
export interface DirectionSummaryStats {
  /** Average time across all traversals in this direction */
  avgTime: number | null;
  /** Average speed across all traversals (for routes where distance varies) */
  avgSpeed?: number | null;
  /** Date of most recent traversal in this direction */
  lastActivity: Date | null;
  /** Number of traversals in this direction */
  count: number;
}

export interface UnifiedPerformanceChartProps {
  chartData: (PerformanceDataPoint & { x: number })[];
  activityType: ActivityType;
  isDark: boolean;
  minSpeed: number;
  maxSpeed: number;
  bestIndex: number;
  hasReverseRuns: boolean;
  tooltipBadgeType: 'match' | 'time';
  onActivitySelect?: (activityId: string | null, activityPoints?: RoutePoint[]) => void;
  /** Called when scrubbing state changes - useful for deferring expensive updates during scrub */
  onScrubChange?: (isScrubbing: boolean) => void;
  selectedActivityId?: string | null;
  summaryStats?: ChartSummaryStats;
  currentIndex?: number;
  variant?: 'route' | 'activity';
  embedded?: boolean;
  /** Best record in forward/same direction (for lane header PR display) */
  bestForwardRecord?: DirectionBestRecord | null;
  /** Best record in reverse direction (for lane header PR display) */
  bestReverseRecord?: DirectionBestRecord | null;
  /** Summary stats for forward direction (avgTime, lastActivity, count) */
  forwardStats?: DirectionSummaryStats | null;
  /** Summary stats for reverse direction (avgTime, lastActivity, count) */
  reverseStats?: DirectionSummaryStats | null;
  /** Force linear time axis with regular ticks (no gap compression) */
  linearTimeAxis?: boolean;
}

const CHART_PADDING = { left: 40, right: 20, top: 16, bottom: 12 } as const;

export function UnifiedPerformanceChart({
  chartData,
  activityType,
  isDark,
  bestIndex,
  hasReverseRuns,
  tooltipBadgeType,
  onActivitySelect,
  onScrubChange,
  summaryStats,
  currentIndex,
  variant = 'route',
  embedded = false,
  bestForwardRecord,
  bestReverseRecord,
  forwardStats,
  reverseStats,
  linearTimeAxis = false,
}: UnifiedPerformanceChartProps) {
  const { t } = useTranslation();
  const showPace = isRunningActivity(activityType);
  const activityColor = getActivityColor(activityType);

  // Get section distance from chart data for pace calculations
  const sectionDistance = chartData[0]?.sectionDistance || 0;

  // Track selected point for tooltip
  const [selectedPoint, setSelectedPoint] = useState<(PerformanceDataPoint & { x: number }) | null>(
    null
  );
  const [isScrubbing, setIsScrubbing] = useState(false);

  // Gesture tracking for scrubbing
  const touchX = useSharedValue(-1);
  const scrollOffsetX = useSharedValue(0); // Track scroll position for accurate scrub positioning
  const forwardScrollRef = useAnimatedRef<Animated.ScrollView>();
  const reverseScrollRef = useAnimatedRef<Animated.ScrollView>();
  const timeAxisScrollRef = useAnimatedRef<Animated.ScrollView>();
  const lastNotifiedIdx = useRef<number>(-1);
  const activeScroller = useSharedValue<number>(0); // 0=none, 1=forward, 2=reverse, 3=timeAxis

  // All scroll handlers run on UI thread - no JS bridge
  const handleForwardScroll = useAnimatedScrollHandler({
    onScroll: (event) => {
      'worklet';
      const offsetX = event.contentOffset.x;
      scrollOffsetX.value = offsetX;
      if (activeScroller.value === 0 || activeScroller.value === 1) {
        activeScroller.value = 1;
        scrollTo(reverseScrollRef, offsetX, 0, false);
        scrollTo(timeAxisScrollRef, offsetX, 0, false);
      }
    },
    onEndDrag: () => {
      'worklet';
      activeScroller.value = 0;
    },
    onMomentumEnd: () => {
      'worklet';
      activeScroller.value = 0;
    },
  });

  const handleReverseScroll = useAnimatedScrollHandler({
    onScroll: (event) => {
      'worklet';
      const offsetX = event.contentOffset.x;
      scrollOffsetX.value = offsetX;
      if (activeScroller.value === 0 || activeScroller.value === 2) {
        activeScroller.value = 2;
        scrollTo(forwardScrollRef, offsetX, 0, false);
        scrollTo(timeAxisScrollRef, offsetX, 0, false);
      }
    },
    onEndDrag: () => {
      'worklet';
      activeScroller.value = 0;
    },
    onMomentumEnd: () => {
      'worklet';
      activeScroller.value = 0;
    },
  });

  const handleTimeAxisScroll = useAnimatedScrollHandler({
    onScroll: (event) => {
      'worklet';
      const offsetX = event.contentOffset.x;
      if (activeScroller.value === 0 || activeScroller.value === 3) {
        activeScroller.value = 3;
        scrollTo(forwardScrollRef, offsetX, 0, false);
        scrollTo(reverseScrollRef, offsetX, 0, false);
      }
    },
    onEndDrag: () => {
      'worklet';
      activeScroller.value = 0;
    },
    onMomentumEnd: () => {
      'worklet';
      activeScroller.value = 0;
    },
  });

  // Lane expansion state
  const [forwardExpanded, setForwardExpanded] = useState(true);
  const [reverseExpanded, setReverseExpanded] = useState(true);

  // State for individually expanded gaps (by index)
  const [expandedGaps, setExpandedGaps] = useState<Set<number>>(new Set());

  // Detect gaps in data globally (must be before chartWidth calculation)
  const detectedGaps = useMemo(() => {
    if (chartData.length < 2 || linearTimeAxis) return [];
    return detectGaps(chartData, DEFAULT_GAP_THRESHOLD_DAYS);
  }, [chartData, linearTimeAxis]);

  // Toggle individual gap expansion
  const toggleGap = useCallback((gapIndex: number) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpandedGaps((prev) => {
      const next = new Set(prev);
      if (next.has(gapIndex)) {
        next.delete(gapIndex);
      } else {
        next.add(gapIndex);
      }
      return next;
    });
  }, []);

  // Calculate dynamic chart width based on number of points and expanded gaps
  const chartWidth = useMemo(
    () =>
      calculateChartWidth(chartData.length, detectedGaps, expandedGaps, {
        minPointSpacing: MIN_POINT_SPACING,
        baseChartWidth: BASE_CHART_WIDTH,
        maxChartWidth: MAX_CHART_WIDTH,
        chartPaddingLeft: CHART_PADDING_LEFT,
        chartPaddingRight: CHART_PADDING_RIGHT,
        compressedGapDays: DEFAULT_COMPRESSED_GAP_DAYS,
      }),
    [chartData.length, detectedGaps, expandedGaps]
  );

  const chartContentWidth = chartWidth - CHART_PADDING_LEFT - CHART_PADDING_RIGHT;
  const isScrollable = chartWidth > BASE_CHART_WIDTH;

  // Build compressed time mapping: dateToX + gap positions + time-axis labels
  const { dateToX, gaps, timeAxisLabels } = useMemo(
    () =>
      buildGapCompression(chartData, detectedGaps, expandedGaps, chartWidth, {
        baseChartWidth: BASE_CHART_WIDTH,
        chartPaddingLeft: CHART_PADDING_LEFT,
        chartPaddingRight: CHART_PADDING_RIGHT,
      }),
    [chartData, detectedGaps, expandedGaps, chartWidth]
  );

  // Split data by direction, using date-based X positioning
  const { forwardLane, reverseLane } = useMemo(
    () => splitIntoLanes(chartData, dateToX, currentIndex),
    [chartData, currentIndex, dateToX]
  );

  const hasForward = forwardLane.points.length > 0;
  const hasReverse = reverseLane.points.length > 0;
  // Always show swim lanes - provides consistent UI and shows direction context
  const showSwimLanes = true;

  const formatSpeedValue = useCallback(
    (speed: number) => (showPace ? formatPace(speed) : formatSpeed(speed)),
    [showPace]
  );

  const toggleForward = useCallback(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setForwardExpanded((prev) => !prev);
  }, []);

  const toggleReverse = useCallback(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setReverseExpanded((prev) => !prev);
  }, []);

  const handlePointPress = useCallback(
    (point: PerformanceDataPoint & { x: number }) => {
      setSelectedPoint(point);
      if (onActivitySelect) {
        onActivitySelect(point.activityId, point.lapPoints);
      }
    },
    [onActivitySelect]
  );

  const clearSelection = useCallback(() => {
    setSelectedPoint(null);
    setIsScrubbing(false);
    if (onActivitySelect) {
      onActivitySelect(null, undefined);
    }
  }, [onActivitySelect]);

  // Update selection based on touch X position (for scrubbing)
  // Takes the touch X relative to the visible area and the current scroll offset
  // Searches ALL data points across both lanes - user wants cross-lane scrubbing
  const updateSelectionFromTouch = useCallback(
    (x: number, scrollOffset: number) => {
      if (chartData.length === 0) return;

      // Account for scroll offset: touch position + scroll offset = position in chart content
      const chartX = x + scrollOffset - CHART_PADDING_LEFT;
      const normalizedX = Math.max(0, Math.min(1, chartX / chartContentWidth));

      // Find the closest data point across ALL lanes by comparing normalized X positions
      let closestIdx = 0;
      let closestDist = Infinity;
      chartData.forEach((point, idx) => {
        const pointX = dateToX(point.date);
        const dist = Math.abs(pointX - normalizedX);
        if (dist < closestDist) {
          closestDist = dist;
          closestIdx = idx;
        }
      });

      // Only notify if index changed
      if (closestIdx !== lastNotifiedIdx.current) {
        lastNotifiedIdx.current = closestIdx;
        const point = chartData[closestIdx];
        if (point) {
          setSelectedPoint(point);
          if (onActivitySelect) {
            onActivitySelect(point.activityId, point.lapPoints);
          }
        }
      }
    },
    [chartData, chartContentWidth, dateToX, onActivitySelect]
  );

  // Animated reaction to update selection when touchX changes
  // Only react to touchX changes, read scrollOffset inside callback
  useAnimatedReaction(
    () => touchX.value,
    (x) => {
      if (x >= 0) {
        runOnJS(updateSelectionFromTouch)(x, scrollOffsetX.value);
      }
    },
    [updateSelectionFromTouch]
  );

  // Callbacks for gesture state changes
  const onGestureStart = useCallback(() => {
    onScrubChange?.(true);
  }, [onScrubChange]);

  const onGestureEnd = useCallback(() => {
    onScrubChange?.(false);
  }, [onScrubChange]);

  // Pan gesture for scrubbing
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

  // Tap gesture to clear selection
  // Use maxDuration and maxDistance to prevent interfering with scroll momentum
  const tapGesture = useMemo(
    () =>
      Gesture.Tap()
        .maxDuration(200) // Only register quick taps
        .onEnd(() => {
          'worklet';
          runOnJS(clearSelection)();
        }),
    [clearSelection]
  );

  // Combined gesture - use Native() to allow ScrollView to handle scroll momentum properly.
  // Note: `Gesture.Native()` must be created per-instance — it carries a handlerTag
  // that the native side mutates on initialize(). A shared module-level instance
  // causes handler-tag collisions across mounts.
  const nativeGesture = useMemo(() => Gesture.Native(), []);
  const composedGesture = useMemo(
    () => Gesture.Simultaneous(nativeGesture, Gesture.Simultaneous(tapGesture, panGesture)),
    [nativeGesture, tapGesture, panGesture]
  );

  // Crosshair animation - accounts for scroll offset so crosshair appears at touch position
  const crosshairStyle = useAnimatedStyle(() => {
    if (touchX.value < 0) {
      return { opacity: 0, transform: [{ translateX: 0 }] };
    }
    // Add scroll offset: touch position is relative to visible viewport,
    // but crosshair is inside scrollable content, so we need to offset
    return {
      opacity: 1,
      transform: [{ translateX: touchX.value + scrollOffsetX.value }],
    };
  }, []);

  // Time span display - use calendar days for accurate day counting
  const timeRangeDisplay = useMemo(() => {
    if (chartData.length < 2) return null;
    const firstDate = chartData[0].date;
    const lastDate = chartData[chartData.length - 1].date;
    // Compare calendar days, not elapsed milliseconds
    const firstDay = new Date(firstDate.getFullYear(), firstDate.getMonth(), firstDate.getDate());
    const lastDay = new Date(lastDate.getFullYear(), lastDate.getMonth(), lastDate.getDate());
    const daysDiff = Math.round((lastDay.getTime() - firstDay.getTime()) / (1000 * 60 * 60 * 24));
    if (daysDiff < 7) return null;
    if (daysDiff < 60) return { value: `${daysDiff}`, label: t('time.days') };
    if (daysDiff < 365) return { value: `${Math.round(daysDiff / 30)}`, label: t('time.months') };
    return {
      value: `${Math.round((daysDiff / 365) * 10) / 10}`,
      label: t('time.years'),
    };
  }, [chartData, t]);

  if (chartData.length < 1) return null;

  const renderLaneChart = useCallback(
    (lane: LaneData, color: string, direction: 'forward' | 'reverse') => {
      if (lane.points.length === 0) return null;

      // Find selected point index in this lane
      const selectedLaneIdx = selectedPoint
        ? lane.points.findIndex((p) => p.activityId === selectedPoint.activityId)
        : -1;

      return (
        <View style={chartStyles.chartWrapper}>
          <View style={StyleSheet.absoluteFill}>
            <CartesianChart
              data={lane.points as unknown as Record<string, unknown>[]}
              xKey={'x' as never}
              yKeys={['speed'] as never}
              domain={{
                x: [0, 1], // Normalized date range (0-1)
                y: [lane.minSpeed, lane.maxSpeed],
              }}
              padding={CHART_PADDING}
            >
              {
                (({ points }: { points: { speed: PointsArray } }) => (
                  <>
                    {/* No connecting lines - dots are positioned by date */}
                    {/* Data points */}
                    {points.speed.map((point: PointsArray[number], idx: number) => {
                      if (point.x == null || point.y == null) return null;
                      const isBest = idx === lane.bestIndex;
                      const isCurrent = idx === lane.currentIndex;
                      const isSelected = idx === selectedLaneIdx;

                      // Selected point (cyan ring like PR gold ring)
                      if (isSelected) {
                        return (
                          <React.Fragment key={`point-${idx}`}>
                            <Circle cx={point.x} cy={point.y} r={8} color={colors.chartCyan} />
                            <Circle cx={point.x} cy={point.y} r={5} color={color} />
                          </React.Fragment>
                        );
                      }

                      // Best point (gold ring with colored center)
                      if (isBest && !isCurrent) {
                        return (
                          <React.Fragment key={`point-${idx}`}>
                            <Circle cx={point.x} cy={point.y} r={8} color={colors.chartGold} />
                            <Circle cx={point.x} cy={point.y} r={5} color={color} />
                          </React.Fragment>
                        );
                      }

                      // Current point (cyan ring with colored center)
                      if (isCurrent) {
                        return (
                          <React.Fragment key={`point-${idx}`}>
                            <Circle cx={point.x} cy={point.y} r={9} color={colors.chartCyan} />
                            <Circle cx={point.x} cy={point.y} r={5} color={color} />
                          </React.Fragment>
                        );
                      }

                      // Regular point
                      return (
                        <Circle
                          key={`point-${idx}`}
                          cx={point.x}
                          cy={point.y}
                          r={5}
                          color={color}
                        />
                      );
                    })}
                  </>
                )) as any
              }
            </CartesianChart>
          </View>

          {/* Single tap target — finds nearest point by X coordinate */}
          <Pressable
            style={styles.tapTargetContainer}
            onPress={(e) => {
              const tapX = e.nativeEvent.locationX - CHART_PADDING_LEFT;
              const normalizedX = Math.max(0, Math.min(1, tapX / chartContentWidth));
              let closest = lane.points[0];
              let closestDist = Infinity;
              for (const pt of lane.points) {
                const dist = Math.abs(pt.x - normalizedX);
                if (dist < closestDist) {
                  closestDist = dist;
                  closest = pt;
                }
              }
              if (closest) handlePointPress(closest);
            }}
          />

          {/* Y-axis labels */}
          <View style={styles.yAxisOverlay} pointerEvents="none">
            <Text style={[styles.axisLabel, isDark && styles.axisLabelDark]}>
              {formatSpeedValue(lane.maxSpeed)}
            </Text>
            <Text style={[styles.axisLabel, isDark && styles.axisLabelDark]}>
              {formatSpeedValue(lane.minSpeed)}
            </Text>
          </View>

          {/* Gap indicators - show edges and fill when expanded */}
          {gaps.length > 0 && (
            <View style={styles.gapLinesOverlay} pointerEvents="none">
              {gaps.map((gap, idx) => {
                const chartContentW = chartWidth - CHART_PADDING_LEFT - CHART_PADDING_RIGHT;
                const startPixelX = CHART_PADDING_LEFT + gap.startX * chartContentW;
                const endPixelX = CHART_PADDING_LEFT + gap.endX * chartContentW;
                const gapWidth = endPixelX - startPixelX;

                if (gap.isExpanded) {
                  // Expanded: show two edge lines (label is in time axis below)
                  const lineColor = isDark ? '#666666' : '#999999';

                  return (
                    <View key={`gap-expanded-${idx}`}>
                      {/* Left edge line */}
                      <View
                        style={[
                          styles.gapEdgeLine,
                          { left: startPixelX, backgroundColor: lineColor },
                        ]}
                      />
                      {/* Right edge line */}
                      <View
                        style={[
                          styles.gapEdgeLine,
                          { left: endPixelX, backgroundColor: lineColor },
                        ]}
                      />
                    </View>
                  );
                } else {
                  // Compressed: single center line
                  const pixelX = CHART_PADDING_LEFT + gap.xPosition * chartContentW + 4;
                  return (
                    <View
                      key={`gap-line-${idx}`}
                      style={[
                        styles.gapVerticalLine,
                        isDark && styles.gapVerticalLineDark,
                        { left: pixelX },
                      ]}
                    />
                  );
                }
              })}
            </View>
          )}
        </View>
      );
    },
    [handlePointPress, formatSpeedValue, isDark, gaps, chartWidth, chartContentWidth, selectedPoint]
  );

  // Single direction mode (no swim lanes needed)
  if (!showSwimLanes) {
    const singleLane = hasForward ? forwardLane : reverseLane;
    const laneColor = hasForward ? activityColor : colors.reverseDirection;

    return (
      <View style={[!embedded && styles.container, !embedded && isDark && styles.containerDark]}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={[styles.title, isDark && styles.textLight]}>
            {t('sections.performanceOverTime')}
          </Text>
          <View style={styles.legend}>
            {variant === 'activity' && currentIndex !== undefined && currentIndex >= 0 && (
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: colors.chartCyan }]} />
                <Text style={[styles.legendText, isDark && styles.textMuted]}>
                  {t('sections.current')}
                </Text>
              </View>
            )}
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: colors.chartGold }]} />
              <Text style={[styles.legendText, isDark && styles.textMuted]}>
                {t('sections.best')}
              </Text>
            </View>
          </View>
        </View>

        {/* Summary stats */}
        {summaryStats && summaryStats.totalActivities > 0 && (
          <View style={styles.summaryRow}>
            {variant === 'activity' ? (
              <>
                <View style={styles.summaryItem}>
                  <Text style={[styles.summaryValue, { color: colors.chartCyan }]}>
                    {summaryStats.currentTime ? formatDuration(summaryStats.currentTime) : '-'}
                  </Text>
                  <Text style={[styles.summaryLabel, isDark && styles.textMuted]}>
                    {t('sections.current')}
                  </Text>
                </View>
                <View style={styles.summaryItem}>
                  <Text style={[styles.summaryValue, { color: colors.chartGold }]}>
                    {summaryStats.bestTime
                      ? showPace && sectionDistance > 0
                        ? formatPace(sectionDistance / summaryStats.bestTime)
                        : formatDuration(summaryStats.bestTime)
                      : '-'}
                  </Text>
                  <Text style={[styles.summaryLabel, isDark && styles.textMuted]}>
                    {showPace ? t('sections.bestPace') : t('sections.best')}
                  </Text>
                </View>
                <View style={styles.summaryItem}>
                  <Text style={[styles.summaryValue, isDark && styles.textLight]}>
                    {summaryStats.bestDate ? formatShortDateWithYear(summaryStats.bestDate) : '-'}
                  </Text>
                  <Text style={[styles.summaryLabel, isDark && styles.textMuted]}>
                    {t('routes.bestOn')}
                  </Text>
                </View>
                {timeRangeDisplay && (
                  <View style={styles.summaryItem}>
                    <Text style={[styles.summaryValue, isDark && styles.textLight]}>
                      {timeRangeDisplay.value}
                    </Text>
                    <Text style={[styles.summaryLabel, isDark && styles.textMuted]}>
                      {timeRangeDisplay.label}
                    </Text>
                  </View>
                )}
              </>
            ) : (
              <>
                <View style={styles.summaryItem}>
                  <Text style={[styles.summaryValue, { color: colors.chartGold }]}>
                    {summaryStats.bestTime
                      ? showPace && sectionDistance > 0
                        ? formatPace(sectionDistance / summaryStats.bestTime)
                        : formatDuration(summaryStats.bestTime)
                      : '-'}
                  </Text>
                  <Text style={[styles.summaryLabel, isDark && styles.textMuted]}>
                    {showPace ? t('sections.bestPace') : t('sections.bestTime')}
                  </Text>
                </View>
                <View style={styles.summaryItem}>
                  <Text style={[styles.summaryValue, isDark && styles.textLight]}>
                    {summaryStats.avgTime
                      ? showPace && sectionDistance > 0
                        ? formatPace(sectionDistance / summaryStats.avgTime)
                        : formatDuration(summaryStats.avgTime)
                      : '-'}
                  </Text>
                  <Text style={[styles.summaryLabel, isDark && styles.textMuted]}>
                    {showPace ? t('sections.averagePace') : t('sections.averageTime')}
                  </Text>
                </View>
                <View style={styles.summaryItem}>
                  <Text style={[styles.summaryValue, isDark && styles.textLight]}>
                    {summaryStats.lastActivity
                      ? formatShortDateWithYear(summaryStats.lastActivity)
                      : '-'}
                  </Text>
                  <Text style={[styles.summaryLabel, isDark && styles.textMuted]}>
                    {t('sections.lastActivity')}
                  </Text>
                </View>
                <View style={styles.summaryItem}>
                  <Text style={[styles.summaryValue, isDark && styles.textLight]}>
                    {summaryStats.totalActivities}
                  </Text>
                  <Text style={[styles.summaryLabel, isDark && styles.textMuted]}>
                    {t('sections.traversals')}
                  </Text>
                </View>
              </>
            )}
          </View>
        )}

        {/* Chart with gesture handling */}
        <GestureDetector gesture={composedGesture}>
          <Animated.View style={{ height: LANE_HEIGHT + 20 }}>
            {renderLaneChart(singleLane, laneColor, hasForward ? 'forward' : 'reverse')}
            {/* Crosshair */}
            <Animated.View
              style={[styles.crosshair, crosshairStyle, isDark && styles.crosshairDark]}
              pointerEvents="none"
            />
          </Animated.View>
        </GestureDetector>

        {/* Time axis with multiple labels */}
        {timeAxisLabels.length > 0 && (
          <View style={styles.timeAxis}>
            {timeAxisLabels.map((label, idx) => (
              <Text
                key={idx}
                style={[
                  styles.axisLabel,
                  isDark && styles.axisLabelDark,
                  styles.timeAxisLabel,
                  idx === 0 && styles.timeAxisLabelFirst,
                  idx === timeAxisLabels.length - 1 && styles.timeAxisLabelLast,
                ]}
              >
                {formatAxisDate(label.date, false)}
              </Text>
            ))}
          </View>
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
                    {formatShortDateWithYear(selectedPoint.date)}
                  </Text>
                  {tooltipBadgeType === 'time' && selectedPoint.sectionTime != null && (
                    <Text style={[styles.tooltipDate, isDark && styles.textMuted]}>
                      {' · '}
                      {formatDuration(selectedPoint.sectionTime)}
                    </Text>
                  )}
                </View>
              </View>
              <View style={styles.tooltipRight}>
                <Text style={[styles.tooltipSpeed, { color: laneColor }]}>
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

  // Swim lanes mode (both directions) - stats are now shown per-lane
  return (
    <View style={[!embedded && styles.container, !embedded && isDark && styles.containerDark]}>
      {/* Forward Lane - hidden if no forward data */}
      {hasForward && (
        <>
          {/* Forward Lane Header (fixed) */}
          <LaneHeader
            direction="forward"
            label={t('sections.forward')}
            avgLabel={t('sections.avg')}
            color={activityColor}
            count={forwardLane.points.length}
            expanded={forwardExpanded}
            onToggle={toggleForward}
            showPace={showPace}
            sectionDistance={sectionDistance}
            isDark={isDark}
            bestRecord={bestForwardRecord}
            stats={forwardStats}
          />

          {/* Forward Lane Chart (scrollable with gesture handling) */}
          {forwardExpanded && (
            <>
              <GestureDetector gesture={composedGesture}>
                <Animated.ScrollView
                  ref={forwardScrollRef}
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  scrollEnabled={isScrollable && !isScrubbing}
                  onScroll={handleForwardScroll}
                  scrollEventThrottle={8}
                  decelerationRate={0.999}
                  nestedScrollEnabled={true}
                >
                  <Animated.View style={{ height: LANE_HEIGHT, width: chartWidth }}>
                    {renderLaneChart(forwardLane, activityColor, 'forward')}
                    {/* Crosshair */}
                    <Animated.View
                      style={[styles.crosshair, crosshairStyle, isDark && styles.crosshairDark]}
                      pointerEvents="none"
                    />
                  </Animated.View>
                </Animated.ScrollView>
              </GestureDetector>
            </>
          )}
        </>
      )}

      {/* Reverse Lane - hidden if no reverse data */}
      {hasReverse && (
        <>
          {/* Reverse Lane Header (fixed) */}
          <LaneHeader
            direction="reverse"
            label={t('sections.reverse')}
            avgLabel={t('sections.avg')}
            color={colors.reverseDirection}
            count={reverseLane.points.length}
            expanded={reverseExpanded}
            onToggle={toggleReverse}
            showPace={showPace}
            sectionDistance={sectionDistance}
            isDark={isDark}
            bestRecord={bestReverseRecord}
            stats={reverseStats}
          />

          {/* Reverse Lane Chart (scrollable with gesture handling, synced with forward) */}
          {reverseExpanded && (
            <>
              <GestureDetector gesture={composedGesture}>
                <Animated.ScrollView
                  ref={reverseScrollRef}
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  scrollEnabled={isScrollable && !isScrubbing}
                  onScroll={handleReverseScroll}
                  scrollEventThrottle={8}
                  decelerationRate={0.999}
                  nestedScrollEnabled={true}
                >
                  <Animated.View style={{ height: LANE_HEIGHT, width: chartWidth }}>
                    {renderLaneChart(reverseLane, colors.reverseDirection, 'reverse')}
                    {/* Crosshair */}
                    <Animated.View
                      style={[styles.crosshair, crosshairStyle, isDark && styles.crosshairDark]}
                      pointerEvents="none"
                    />
                  </Animated.View>
                </Animated.ScrollView>
              </GestureDetector>
            </>
          )}
        </>
      )}

      {/* Time axis - scrolls with charts, two rows: dates on top, gap markers below */}
      <Animated.ScrollView
        ref={timeAxisScrollRef}
        horizontal
        showsHorizontalScrollIndicator={isScrollable}
        scrollEnabled={isScrollable}
        onScroll={handleTimeAxisScroll}
        scrollEventThrottle={8}
        decelerationRate={0.999}
        nestedScrollEnabled={true}
        style={styles.timeAxisScroll}
      >
        <View style={[styles.timeAxisContent, { width: chartWidth }]}>
          {/* Date labels row (top) */}
          {timeAxisLabels.map((label, idx) => {
            const chartContentW = chartWidth - CHART_PADDING_LEFT - CHART_PADDING_RIGHT;
            const leftPos = CHART_PADDING_LEFT + label.position * chartContentW;
            return (
              <Text
                key={`label-${idx}`}
                style={[
                  styles.timeAxisDateLabel,
                  isDark && styles.axisLabelDark,
                  { left: leftPos - 20 },
                ]}
              >
                {formatAxisDate(label.date, false)}
              </Text>
            );
          })}
          {/* Gap markers row (bottom) - icon above day count */}
          {gaps.map((gap, idx) => {
            const chartContentW = chartWidth - CHART_PADDING_LEFT - CHART_PADDING_RIGHT;

            if (gap.isExpanded) {
              // Expanded: span full width of gap
              const startPixelX = CHART_PADDING_LEFT + gap.startX * chartContentW;
              const endPixelX = CHART_PADDING_LEFT + gap.endX * chartContentW;
              const gapPixelWidth = endPixelX - startPixelX;

              return (
                <Pressable
                  key={`gap-${idx}`}
                  style={[
                    styles.gapMarkerExpanded,
                    isDark && styles.gapMarkerExpandedDark,
                    { left: startPixelX, width: gapPixelWidth },
                  ]}
                  onPress={() => toggleGap(gap.gapIndex)}
                >
                  <MaterialCommunityIcons
                    name="arrow-collapse-horizontal"
                    size={12}
                    color={isDark ? '#aaa' : '#666'}
                  />
                  <Text
                    style={[
                      styles.gapMarkerExpandedText,
                      isDark && styles.gapMarkerExpandedTextDark,
                    ]}
                  >
                    {t('time.dayAbbrev', { count: gap.gapDays })}
                  </Text>
                  <MaterialCommunityIcons
                    name="arrow-collapse-horizontal"
                    size={12}
                    color={isDark ? '#aaa' : '#666'}
                  />
                </Pressable>
              );
            } else {
              // Compressed: centered small marker
              const pixelX = CHART_PADDING_LEFT + gap.xPosition * chartContentW + 4;
              return (
                <Pressable
                  key={`gap-${idx}`}
                  style={[
                    styles.gapMarkerInAxisBottom,
                    isDark && styles.gapMarkerInAxisDark,
                    { left: pixelX - 12 },
                  ]}
                  onPress={() => toggleGap(gap.gapIndex)}
                  hitSlop={{ top: 5, bottom: 5, left: 10, right: 10 }}
                >
                  <MaterialCommunityIcons
                    name="arrow-expand-horizontal"
                    size={10}
                    color={isDark ? darkColors.textMuted : colors.textMuted}
                  />
                  <Text style={[styles.gapMarkerText, isDark && styles.gapMarkerTextDark]}>
                    {t('time.dayAbbrev', { count: gap.gapDays })}
                  </Text>
                </Pressable>
              );
            }
          })}
        </View>
      </Animated.ScrollView>

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
                  {formatShortDateWithYear(selectedPoint.date)}
                </Text>
                {tooltipBadgeType === 'time' && selectedPoint.sectionTime != null && (
                  <Text style={[styles.tooltipDate, isDark && styles.textMuted]}>
                    {' · '}
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
    marginTop: 12,
    overflow: 'hidden',
  },
  containerDark: {
    backgroundColor: darkColors.surfaceCard,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 8,
  },
  title: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  legend: {
    flexDirection: 'row',
    gap: 8,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  legendDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  legendText: {
    fontSize: 10,
    color: colors.textMuted,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  summaryItem: {
    alignItems: 'center',
    flex: 1,
  },
  summaryValue: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  summaryLabel: {
    fontSize: 10,
    color: colors.textMuted,
    marginTop: 1,
  },
  tapTargetContainer: {
    ...StyleSheet.absoluteFillObject,
    paddingLeft: 40,
    paddingRight: 20,
  },
  yAxisOverlay: {
    position: 'absolute',
    left: 6,
    top: 16,
    bottom: 12,
    justifyContent: 'space-between',
  },
  timeAxis: {
    height: 32,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    position: 'relative',
  },
  timeAxisScroll: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  timeAxisContent: {
    height: 44,
    position: 'relative',
  },
  timeAxisLabel: {
    position: 'absolute',
    bottom: 8,
    fontSize: 9,
    color: colors.textMuted,
  },
  timeAxisDateLabel: {
    position: 'absolute',
    top: 4,
    width: 40,
    fontSize: 9,
    color: colors.textMuted,
    textAlign: 'center',
  },
  gapMarkerInAxisDark: {
    backgroundColor: darkColors.surfaceElevated,
    borderColor: darkColors.border,
  },
  gapMarkerInAxisBottom: {
    position: 'absolute',
    top: 18,
    width: 24,
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 0,
    paddingHorizontal: 2,
    paddingVertical: 2,
    backgroundColor: colors.surface,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: colors.border,
    opacity: 0.9,
  },
  gapMarkerExpanded: {
    position: 'absolute',
    top: 18,
    height: 22,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingHorizontal: 4,
    backgroundColor: colors.surface,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: colors.border,
    opacity: 0.9,
  },
  gapMarkerExpandedDark: {
    backgroundColor: darkColors.surfaceElevated,
    borderColor: darkColors.border,
  },
  gapMarkerExpandedText: {
    fontSize: 9,
    fontWeight: '500',
    color: colors.textMuted,
  },
  gapMarkerExpandedTextDark: {
    color: darkColors.textMuted,
  },
  gapLinesOverlay: {
    ...StyleSheet.absoluteFillObject,
    pointerEvents: 'none',
  },
  gapVerticalLine: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 0,
    borderLeftWidth: 1,
    borderLeftColor: colors.textMuted,
    opacity: 0.4,
  },
  gapVerticalLineDark: {
    borderLeftColor: '#888888',
    opacity: 0.5,
  },
  gapEdgeLine: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 2,
  },
  gapMarkerText: {
    fontSize: 8,
    color: colors.textMuted,
  },
  gapMarkerTextDark: {
    color: darkColors.textMuted,
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
  crosshair: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 2,
    backgroundColor: colors.textPrimary,
    opacity: 0.6,
    marginLeft: -1, // Center the crosshair on the touch point
  },
  crosshairDark: {
    backgroundColor: darkColors.textPrimary,
  },
});

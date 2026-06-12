/**
 * Unified performance chart for route and section detail pages.
 *
 * Shows speed/pace over time with collapsible swim lanes for forward/reverse
 * directions. Each lane shows traversal count and can be collapsed.
 */

import React, { useState, useMemo, useCallback, useRef } from 'react';
import {
  View,
  TouchableOpacity,
  Pressable,
  LayoutAnimation,
  Dimensions,
  ScrollView,
} from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
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

import { isRunningActivity, getActivityColor } from '@/features/activity/lib/activityUtils';
import { navigateTo } from '@/shared/app/navigation';
import { formatPace, formatSpeed, formatDuration } from '@/shared/format/format';
import { formatShortDateWithYear, formatAxisDate } from '@/features/stats';
import { CHART_CONFIG } from '@/constants';
import { colors, darkColors } from '@/theme';
import type { ActivityType, RoutePoint, PerformanceDataPoint } from '@/types';
import { LaneHeader } from './LaneHeader';
import { PerformanceLaneChart } from './PerformanceLaneChart';
import { useUnifiedChartLayout } from './useUnifiedChartLayout';
import { styles } from './unifiedPerformanceChart.styles';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CHART_PADDING_LEFT = 40;
// Gap-marker icon tint, used by both expanded-marker chevrons
const GAP_MARKER_ICON = { light: '#666', dark: '#aaa' } as const;
const CHART_PADDING_RIGHT = 20;
const BASE_CHART_WIDTH = SCREEN_WIDTH - 32;

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

  const {
    chartWidth,
    chartContentWidth,
    isScrollable,
    dateToX,
    gaps,
    timeAxisLabels,
    forwardLane,
    reverseLane,
    hasForward,
    hasReverse,
  } = useUnifiedChartLayout(chartData, currentIndex, linearTimeAxis, expandedGaps);

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

  // Early return after all hooks (Rules of Hooks): chartData may be empty
  // before data loads.
  if (chartData.length < 1) return null;

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
            <PerformanceLaneChart
              lane={singleLane}
              color={laneColor}
              selectedPoint={selectedPoint}
              chartWidth={chartWidth}
              chartContentWidth={chartContentWidth}
              gaps={gaps}
              isDark={isDark}
              onPointPress={handlePointPress}
              formatSpeedValue={formatSpeedValue}
            />
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
                    <PerformanceLaneChart
                      lane={forwardLane}
                      color={activityColor}
                      selectedPoint={selectedPoint}
                      chartWidth={chartWidth}
                      chartContentWidth={chartContentWidth}
                      gaps={gaps}
                      isDark={isDark}
                      onPointPress={handlePointPress}
                      formatSpeedValue={formatSpeedValue}
                    />
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
                    <PerformanceLaneChart
                      lane={reverseLane}
                      color={colors.reverseDirection}
                      selectedPoint={selectedPoint}
                      chartWidth={chartWidth}
                      chartContentWidth={chartContentWidth}
                      gaps={gaps}
                      isDark={isDark}
                      onPointPress={handlePointPress}
                      formatSpeedValue={formatSpeedValue}
                    />
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
                    color={isDark ? GAP_MARKER_ICON.dark : GAP_MARKER_ICON.light}
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
                    color={isDark ? GAP_MARKER_ICON.dark : GAP_MARKER_ICON.light}
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

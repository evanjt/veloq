/**
 * Unified performance chart for route and section detail pages.
 * Shows speed/pace over time with gesture-based scrubbing and map highlighting.
 *
 * This component extracts the common chart logic from both route and section detail pages.
 * The key difference is the tooltip badge: routes show match %, sections show time.
 */

import React, { useState, useRef, useMemo, useCallback, useEffect } from 'react';
import { View, StyleSheet, TouchableOpacity, Dimensions } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { router, Href } from 'expo-router';
import { CartesianChart, Line } from 'victory-native';
import { Circle } from '@shopify/react-native-skia';
import { Gesture, GestureDetector, ScrollView } from 'react-native-gesture-handler';
import {
  useSharedValue,
  useDerivedValue,
  useAnimatedStyle,
  useAnimatedReaction,
  runOnJS,
} from 'react-native-reanimated';
import Animated from 'react-native-reanimated';
import {
  formatPace,
  formatSpeed,
  formatDuration,
  isRunningActivity,
  getActivityColor,
  formatShortDate as formatShortDateLib,
} from '@/lib';
import { colors, darkColors } from '@/theme';
import { CHART_CONFIG } from '@/constants';
import type { ActivityType, RoutePoint, PerformanceDataPoint } from '@/types';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CHART_HEIGHT = 120; // Reduced from 160
const MIN_POINT_WIDTH = 64; // Wider spacing so 6+ points triggers scrolling on most phones

// Direction colors
const REVERSE_COLOR = colors.reverseDirection;

function formatShortDate(date: Date): string {
  return formatShortDateLib(date);
}

/** Summary statistics to display in the chart header */
export interface ChartSummaryStats {
  bestTime: number | null;
  avgTime: number | null;
  totalActivities: number;
  lastActivity: Date | null;
  /** Current activity time - for activity detail context */
  currentTime?: number | null;
  /** Best activity date - for "Best On" display */
  bestDate?: Date | null;
}

export interface UnifiedPerformanceChartProps {
  /** Pre-processed chart data points */
  chartData: (PerformanceDataPoint & { x: number })[];
  /** Activity type for color and pace/speed formatting */
  activityType: ActivityType;
  /** Whether dark mode is active */
  isDark: boolean;
  /** Min speed for Y-axis domain */
  minSpeed: number;
  /** Max speed for Y-axis domain */
  maxSpeed: number;
  /** Index of the best (fastest) data point */
  bestIndex: number;
  /** Whether any data points are in reverse direction */
  hasReverseRuns: boolean;
  /** What to show in tooltip badge: match percentage (routes) or section time */
  tooltipBadgeType: 'match' | 'time';
  /** Callback when an activity is selected via scrubbing */
  onActivitySelect?: (activityId: string | null, activityPoints?: RoutePoint[]) => void;
  /** Currently selected/highlighted activity ID */
  selectedActivityId?: string | null;
  /** Optional summary stats to show in header */
  summaryStats?: ChartSummaryStats;
  /** Index of current activity being viewed (for activity detail context) */
  currentIndex?: number;
  /** Variant: 'route' for route page, 'activity' for activity detail - affects stats display */
  variant?: 'route' | 'activity';
  /** When true, removes card styling (used when embedded in parent card) */
  embedded?: boolean;
}

export function UnifiedPerformanceChart({
  chartData,
  activityType,
  isDark,
  minSpeed,
  maxSpeed,
  bestIndex,
  hasReverseRuns,
  tooltipBadgeType,
  onActivitySelect,
  selectedActivityId,
  summaryStats,
  currentIndex,
  variant = 'route',
  embedded = false,
}: UnifiedPerformanceChartProps) {
  const { t } = useTranslation();
  const showPace = isRunningActivity(activityType);
  const activityColor = getActivityColor(activityType);
  const scrollViewRef = useRef<ScrollView>(null);

  // Tooltip state - persists after scrubbing ends so user can tap
  const [tooltipData, setTooltipData] = useState<(PerformanceDataPoint & { x: number }) | null>(
    null
  );
  const [isActive, setIsActive] = useState(false);
  const [isPersisted, setIsPersisted] = useState(false);

  // Gesture tracking
  const touchX = useSharedValue(-1);
  const scrollOffsetX = useSharedValue(0);
  const chartBoundsShared = useSharedValue({ left: 0, right: 1 });
  const lastNotifiedIdx = useRef<number | null>(null);

  // Calculate chart width based on number of points (for scrolling)
  const chartWidth = useMemo(() => {
    const screenWidth = SCREEN_WIDTH - 32;
    const dataWidth = chartData.length * MIN_POINT_WIDTH;
    return Math.max(screenWidth, dataWidth);
  }, [chartData.length]);

  const needsScrolling = chartWidth > SCREEN_WIDTH - 32;

  // Scroll to the end (latest dates) on mount when scrolling is needed
  const scrollToEnd = useCallback(() => {
    if (needsScrolling && scrollViewRef.current) {
      scrollViewRef.current.scrollToEnd({ animated: false });
    }
  }, [needsScrolling]);

  // Scroll to end on initial mount
  useEffect(() => {
    if (needsScrolling) {
      // Small delay to ensure layout is complete
      const timer = setTimeout(scrollToEnd, 100);
      return () => clearTimeout(timer);
    }
  }, [needsScrolling, scrollToEnd]);

  // Find currently selected index for highlighting
  const selectedIndex = useMemo(() => {
    if (!selectedActivityId) return -1;
    return chartData.findIndex((d) => d.id === selectedActivityId);
  }, [selectedActivityId, chartData]);

  const formatSpeedValue = useCallback(
    (speed: number) => {
      if (showPace) {
        return formatPace(speed);
      }
      return formatSpeed(speed);
    },
    [showPace]
  );

  // Derive selected index on UI thread
  const selectedIdx = useDerivedValue(() => {
    'worklet';
    const len = chartData.length;
    const bounds = chartBoundsShared.value;
    const chartWidthPx = bounds.right - bounds.left;

    if (touchX.value < 0 || chartWidthPx <= 0 || len === 0) return -1;

    const chartX = touchX.value - bounds.left;
    const ratio = Math.max(0, Math.min(1, chartX / chartWidthPx));
    const idx = Math.round(ratio * (len - 1));

    return Math.min(Math.max(0, idx), len - 1);
  }, [chartData.length]);

  // Update tooltip on JS thread
  const updateTooltipOnJS = useCallback(
    (idx: number, gestureEnded = false) => {
      if (gestureEnded) {
        if (tooltipData) {
          setIsActive(false);
          setIsPersisted(true);
          if (onActivitySelect && tooltipData) {
            // Use activityId (not id) for map highlighting - id may include lap suffix
            onActivitySelect(tooltipData.activityId, tooltipData.lapPoints);
          }
        }
        lastNotifiedIdx.current = null;
        return;
      }

      if (idx < 0 || chartData.length === 0) {
        return;
      }

      if (isPersisted) {
        setIsPersisted(false);
      }

      if (idx === lastNotifiedIdx.current) return;
      lastNotifiedIdx.current = idx;

      if (!isActive) {
        setIsActive(true);
      }

      const point = chartData[idx];
      if (point) {
        setTooltipData(point);
        if (onActivitySelect) {
          onActivitySelect(point.id, point.lapPoints);
        }
      }
    },
    [chartData, isActive, isPersisted, tooltipData, onActivitySelect]
  );

  const handleGestureEnd = useCallback(() => {
    updateTooltipOnJS(-1, true);
  }, [updateTooltipOnJS]);

  useAnimatedReaction(
    () => selectedIdx.value,
    (idx) => {
      if (idx >= 0) {
        runOnJS(updateTooltipOnJS)(idx, false);
      }
    },
    [updateTooltipOnJS]
  );

  const clearPersistedTooltip = useCallback(() => {
    if (isPersisted) {
      setIsPersisted(false);
      setTooltipData(null);
      if (onActivitySelect) {
        onActivitySelect(null, undefined);
      }
    }
  }, [isPersisted, onActivitySelect]);

  // Pan gesture with long press activation for scrubbing
  // Account for scroll offset when calculating position within scrollable chart
  const panGesture = Gesture.Pan()
    .activateAfterLongPress(CHART_CONFIG.LONG_PRESS_DURATION)
    .onStart((e) => {
      'worklet';
      touchX.value = e.x + scrollOffsetX.value;
    })
    .onUpdate((e) => {
      'worklet';
      touchX.value = e.x + scrollOffsetX.value;
    })
    .onEnd(() => {
      'worklet';
      touchX.value = -1;
      runOnJS(handleGestureEnd)();
    });

  // Tap gesture to dismiss persisted tooltip
  const tapGesture = Gesture.Tap().onEnd(() => {
    'worklet';
    runOnJS(clearPersistedTooltip)();
  });

  // Simultaneous: both gestures can work - tap for quick dismiss, pan after long press
  const gesture = Gesture.Simultaneous(tapGesture, panGesture);

  // Track scroll position for accurate scrubbing
  const handleScroll = useCallback(
    (event: { nativeEvent: { contentOffset: { x: number } } }) => {
      scrollOffsetX.value = event.nativeEvent.contentOffset.x;
    },
    [scrollOffsetX]
  );

  // Animated crosshair
  const crosshairStyle = useAnimatedStyle(() => {
    'worklet';
    const idx = selectedIdx.value;
    const bounds = chartBoundsShared.value;
    const len = chartData.length;

    if (idx < 0 || len === 0) {
      return { opacity: 0, transform: [{ translateX: 0 }] };
    }

    const chartWidthPx = bounds.right - bounds.left;
    // Domain is [-0.5, len-0.5], so data points at idx are at x=idx
    // Ratio should be (idx + 0.5) / len to account for 0.5 padding on each side
    const xPos = bounds.left + ((idx + 0.5) / len) * chartWidthPx;

    return {
      opacity: 1,
      transform: [{ translateX: xPos }],
    };
  }, [chartData.length]);

  // Allow single data point charts (for new custom sections with 1 activity)
  if (chartData.length < 1) return null;

  const getPointColor = (direction: 'same' | 'reverse') => {
    return direction === 'reverse' ? REVERSE_COLOR : activityColor;
  };

  // Calculate time range for display
  const timeRangeDisplay = useMemo(() => {
    if (chartData.length < 2) return null;
    const firstDate = chartData[0].date;
    const lastDate = chartData[chartData.length - 1].date;
    const daysDiff = Math.round((lastDate.getTime() - firstDate.getTime()) / (1000 * 60 * 60 * 24));
    if (daysDiff < 7) {
      return null; // Don't show for very short spans
    } else if (daysDiff < 60) {
      return { value: `${daysDiff}`, label: t('time.days') };
    } else if (daysDiff < 365) {
      const months = Math.round(daysDiff / 30);
      return { value: `${months}`, label: t('time.months') };
    } else {
      const years = Math.round((daysDiff / 365) * 10) / 10;
      return { value: `${years}`, label: t('time.years') };
    }
  }, [chartData, t]);

  const chartContent = (
    <View style={[styles.chartInner, { width: chartWidth }]}>
      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
      <CartesianChart
        data={chartData as unknown as Record<string, unknown>[]}
        xKey={'x' as never}
        yKeys={['speed'] as never}
        domain={{ x: [-0.5, chartData.length - 0.5], y: [minSpeed, maxSpeed] }}
        padding={{ left: 32, right: 24, top: 40, bottom: 18 }}
      >
        {
          (({ points, chartBounds }: any) => {
            if (
              chartBounds.left !== chartBoundsShared.value.left ||
              chartBounds.right !== chartBoundsShared.value.right
            ) {
              chartBoundsShared.value = {
                left: chartBounds.left,
                right: chartBounds.right,
              };
            }

            const samePoints = points.speed.filter(
              (_: any, idx: number) => chartData[idx]?.direction === 'same'
            );
            const reversePoints = points.speed.filter(
              (_: any, idx: number) => chartData[idx]?.direction === 'reverse'
            );

            return (
              <>
                {/* Line connecting 'same' direction points */}
                {samePoints.length > 1 && (
                  <Line
                    points={samePoints}
                    color={activityColor}
                    strokeWidth={1.5}
                    curveType="monotoneX"
                    opacity={0.4}
                  />
                )}
                {/* Line connecting 'reverse' direction points */}
                {reversePoints.length > 1 && (
                  <Line
                    points={reversePoints}
                    color={REVERSE_COLOR}
                    strokeWidth={1.5}
                    curveType="monotoneX"
                    opacity={0.4}
                  />
                )}
                {/* Regular points */}
                {points.speed.map((point: any, idx: number) => {
                  if (point.x == null || point.y == null) return null;
                  const isSelected = idx === selectedIndex;
                  const isBest = idx === bestIndex;
                  const isCurrent = idx === currentIndex;
                  // Skip special points - they'll be drawn last
                  if (isSelected || isBest || isCurrent) return null;
                  const d = chartData[idx];
                  const pointColor = d ? getPointColor(d.direction) : activityColor;
                  return (
                    <Circle
                      key={`point-${idx}`}
                      cx={point.x}
                      cy={point.y}
                      r={5}
                      color={pointColor}
                    />
                  );
                })}
                {/* Best performance - gold (if not also current or selected) */}
                {bestIndex !== selectedIndex &&
                  bestIndex !== currentIndex &&
                  points.speed[bestIndex] &&
                  points.speed[bestIndex].x != null &&
                  points.speed[bestIndex].y != null && (
                    <>
                      <Circle
                        cx={points.speed[bestIndex].x!}
                        cy={points.speed[bestIndex].y!}
                        r={8}
                        color={colors.chartGold}
                      />
                      <Circle
                        cx={points.speed[bestIndex].x!}
                        cy={points.speed[bestIndex].y!}
                        r={4}
                        color={colors.textOnDark}
                      />
                    </>
                  )}
                {/* Current activity - cyan (if not selected) */}
                {currentIndex !== undefined &&
                  currentIndex >= 0 &&
                  currentIndex !== selectedIndex &&
                  points.speed[currentIndex] &&
                  points.speed[currentIndex].x != null &&
                  points.speed[currentIndex].y != null && (
                    <>
                      <Circle
                        cx={points.speed[currentIndex].x!}
                        cy={points.speed[currentIndex].y!}
                        r={9}
                        color={colors.chartCyan}
                      />
                      <Circle
                        cx={points.speed[currentIndex].x!}
                        cy={points.speed[currentIndex].y!}
                        r={4}
                        color={colors.textOnDark}
                      />
                    </>
                  )}
                {/* Selected activity - cyan larger (scrubbing) */}
                {selectedIndex >= 0 &&
                  points.speed[selectedIndex] &&
                  points.speed[selectedIndex].x != null &&
                  points.speed[selectedIndex].y != null && (
                    <>
                      <Circle
                        cx={points.speed[selectedIndex].x!}
                        cy={points.speed[selectedIndex].y!}
                        r={10}
                        color={colors.chartCyan}
                      />
                      <Circle
                        cx={points.speed[selectedIndex].x!}
                        cy={points.speed[selectedIndex].y!}
                        r={5}
                        color={colors.textOnDark}
                      />
                    </>
                  )}
              </>
            );
          }) as any
        }
      </CartesianChart>

      {/* Crosshair */}
      <Animated.View
        style={[styles.crosshair, crosshairStyle, isDark && styles.crosshairDark]}
        pointerEvents="none"
      />

      {/* Y-axis labels */}
      <View style={styles.yAxisOverlay} pointerEvents="none">
        <Text style={[styles.axisLabel, isDark && styles.axisLabelDark]}>
          {formatSpeedValue(maxSpeed)}
        </Text>
        <Text style={[styles.axisLabel, isDark && styles.axisLabelDark]}>
          {formatSpeedValue((minSpeed + maxSpeed) / 2)}
        </Text>
        <Text style={[styles.axisLabel, isDark && styles.axisLabelDark]}>
          {formatSpeedValue(minSpeed)}
        </Text>
      </View>

      {/* X-axis labels (dates) */}
      <View
        style={[styles.xAxisOverlay, { width: chartWidth - 32 - 24, left: 32 }]}
        pointerEvents="none"
      >
        {chartData.length > 0 && (
          <>
            <Text style={[styles.axisLabel, isDark && styles.axisLabelDark]}>
              {formatShortDate(chartData[0].date)}
            </Text>
            {chartData.length >= 5 && (
              <Text style={[styles.axisLabel, isDark && styles.axisLabelDark]}>
                {formatShortDate(chartData[Math.floor(chartData.length / 2)].date)}
              </Text>
            )}
            <Text style={[styles.axisLabel, isDark && styles.axisLabelDark]}>
              {formatShortDate(chartData[chartData.length - 1].date)}
            </Text>
          </>
        )}
      </View>
    </View>
  );

  return (
    <View style={[!embedded && styles.chartCard, !embedded && isDark && styles.chartCardDark]}>
      {/* Compact header with title + summary stats */}
      <View style={styles.chartHeader}>
        <View style={styles.headerTop}>
          <Text style={[styles.chartTitle, isDark && styles.textLight]}>
            {t('sections.performanceOverTime')}
          </Text>
          <View style={styles.chartLegend}>
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
            {hasReverseRuns && (
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: REVERSE_COLOR }]} />
                <Text style={[styles.legendText, isDark && styles.textMuted]}>
                  {t('sections.reverse')}
                </Text>
              </View>
            )}
          </View>
        </View>
        {/* Compact summary stats row - different layout for route vs activity variant */}
        {summaryStats && summaryStats.totalActivities > 0 && variant === 'route' && (
          <View style={styles.summaryRow}>
            <View style={styles.summaryItem}>
              <Text style={[styles.summaryValue, { color: colors.chartGold }]}>
                {summaryStats.bestTime ? formatDuration(summaryStats.bestTime) : '-'}
              </Text>
              <Text style={[styles.summaryLabel, isDark && styles.textMuted]}>Best</Text>
            </View>
            <View style={styles.summaryItem}>
              <Text style={[styles.summaryValue, isDark && styles.textLight]}>
                {summaryStats.avgTime ? formatDuration(Math.round(summaryStats.avgTime)) : '-'}
              </Text>
              <Text style={[styles.summaryLabel, isDark && styles.textMuted]}>Avg</Text>
            </View>
            <View style={styles.summaryItem}>
              <Text style={[styles.summaryValue, isDark && styles.textLight]}>
                {summaryStats.totalActivities}
              </Text>
              <Text style={[styles.summaryLabel, isDark && styles.textMuted]}>
                {timeRangeDisplay ? timeRangeDisplay.label : 'Total'}
              </Text>
            </View>
            <View style={styles.summaryItem}>
              <Text style={[styles.summaryValue, isDark && styles.textLight]}>
                {summaryStats.lastActivity ? formatShortDate(summaryStats.lastActivity) : '-'}
              </Text>
              <Text style={[styles.summaryLabel, isDark && styles.textMuted]}>Last</Text>
            </View>
          </View>
        )}
        {/* Activity variant: Current, Best, Best On, Time Range */}
        {summaryStats && summaryStats.totalActivities > 0 && variant === 'activity' && (
          <View style={styles.summaryRow}>
            <View style={styles.summaryItem}>
              <Text style={[styles.summaryValue, { color: colors.chartCyan }]}>
                {summaryStats.currentTime ? formatDuration(summaryStats.currentTime) : '-'}
              </Text>
              <Text style={[styles.summaryLabel, isDark && styles.textMuted]}>Current</Text>
            </View>
            <View style={styles.summaryItem}>
              <Text style={[styles.summaryValue, { color: colors.chartGold }]}>
                {summaryStats.bestTime ? formatDuration(summaryStats.bestTime) : '-'}
              </Text>
              <Text style={[styles.summaryLabel, isDark && styles.textMuted]}>Best</Text>
            </View>
            <View style={styles.summaryItem}>
              <Text style={[styles.summaryValue, isDark && styles.textLight]}>
                {summaryStats.bestDate ? formatShortDate(summaryStats.bestDate) : '-'}
              </Text>
              <Text style={[styles.summaryLabel, isDark && styles.textMuted]}>Best On</Text>
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
          </View>
        )}
      </View>

      {/* Chart with horizontal scrolling */}
      <GestureDetector gesture={gesture}>
        <View style={styles.chartContainer}>
          <ScrollView
            ref={scrollViewRef}
            horizontal
            showsHorizontalScrollIndicator={needsScrolling}
            contentContainerStyle={{ width: chartWidth }}
            onContentSizeChange={scrollToEnd}
            onScroll={handleScroll}
            scrollEventThrottle={16}
          >
            {chartContent}
          </ScrollView>
        </View>
      </GestureDetector>

      {/* Selected activity tooltip - fixed position below chart */}
      <View style={styles.tooltipContainer}>
        {(isActive || isPersisted) && tooltipData ? (
          <TouchableOpacity
            style={[styles.selectedTooltip, isDark && styles.selectedTooltipDark]}
            onPress={() => router.push(`/activity/${tooltipData.activityId}` as Href)}
            activeOpacity={0.7}
          >
            <View style={styles.tooltipLeft}>
              <Text style={[styles.tooltipName, isDark && styles.textLight]} numberOfLines={1}>
                {tooltipData.activityName}
              </Text>
              <View style={styles.tooltipMeta}>
                <Text style={[styles.tooltipDate, isDark && styles.textMuted]}>
                  {formatShortDate(tooltipData.date)}
                </Text>
                {tooltipData.lapNumber != null &&
                  tooltipData.totalLaps != null &&
                  tooltipData.totalLaps > 1 && (
                    <Text style={[styles.tooltipDate, isDark && styles.textMuted]}>
                      {' · Lap '}
                      {tooltipData.lapNumber}/{tooltipData.totalLaps}
                    </Text>
                  )}
                {tooltipBadgeType === 'match' && tooltipData.matchPercentage != null && (
                  <View
                    style={[styles.matchBadgeSmall, { backgroundColor: colors.success + '20' }]}
                  >
                    <Text style={[styles.matchBadgeText, { color: colors.success }]}>
                      {Math.round(tooltipData.matchPercentage)}%
                    </Text>
                  </View>
                )}
                {tooltipBadgeType === 'time' && tooltipData.sectionTime != null && (
                  <Text style={[styles.tooltipDate, isDark && styles.textMuted]}>
                    {' · '}
                    {formatDuration(tooltipData.sectionTime)}
                  </Text>
                )}
                {tooltipData.direction === 'reverse' && (
                  <View style={styles.reverseBadge}>
                    <MaterialCommunityIcons
                      name="swap-horizontal"
                      size={10}
                      color={REVERSE_COLOR}
                    />
                  </View>
                )}
              </View>
            </View>
            <View style={styles.tooltipRight}>
              <Text
                style={[
                  styles.tooltipSpeed,
                  { color: tooltipData.direction === 'reverse' ? REVERSE_COLOR : activityColor },
                ]}
              >
                {formatSpeedValue(tooltipData.speed)}
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
              {needsScrolling ? t('sections.scrubHintScrollable') : t('sections.scrubHint')}
            </Text>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  chartCard: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    marginTop: 12,
    paddingTop: 8,
  },
  chartCardDark: {
    backgroundColor: darkColors.surfaceCard,
  },
  chartHeader: {
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 6,
  },
  headerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  chartTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  timeRangeText: {
    fontSize: 11,
    color: colors.textMuted,
  },
  chartLegend: {
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
    marginTop: 8,
    paddingTop: 8,
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
  chartContainer: {
    height: CHART_HEIGHT,
    overflow: 'visible',
  },
  chartInner: {
    height: CHART_HEIGHT,
    position: 'relative',
    overflow: 'visible',
  },
  crosshair: {
    position: 'absolute',
    top: 40,
    bottom: 18,
    width: 1,
    backgroundColor: 'rgba(0, 188, 212, 0.5)',
  },
  crosshairDark: {
    backgroundColor: 'rgba(0, 188, 212, 0.7)',
  },
  yAxisOverlay: {
    position: 'absolute',
    left: 4,
    top: 40,
    bottom: 18,
    justifyContent: 'space-between',
  },
  xAxisOverlay: {
    position: 'absolute',
    bottom: 2,
    flexDirection: 'row',
    justifyContent: 'space-between',
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
  matchBadgeSmall: {
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 3,
  },
  matchBadgeText: {
    fontSize: 10,
    fontWeight: '600',
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

/**
 * Unified performance chart for route and section detail pages.
 * Shows speed/pace over time with gesture-based scrubbing and map highlighting.
 *
 * This component extracts the common chart logic from both route and section detail pages.
 * The key difference is the tooltip badge: routes show match %, sections show time.
 */

import React, { useState, useRef, useMemo, useCallback } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Dimensions,
} from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { router, Href } from 'expo-router';
import { CartesianChart, Line } from 'victory-native';
import { Circle } from '@shopify/react-native-skia';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
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
import type { ActivityType, RoutePoint, PerformanceDataPoint } from '@/types';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CHART_HEIGHT = 160;
const MIN_POINT_WIDTH = 40;

// Direction colors
const REVERSE_COLOR = colors.reverseDirection;

function formatShortDate(date: Date): string {
  return formatShortDateLib(date);
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
}: UnifiedPerformanceChartProps) {
  const { t } = useTranslation();
  const showPace = isRunningActivity(activityType);
  const activityColor = getActivityColor(activityType);

  // Tooltip state - persists after scrubbing ends so user can tap
  const [tooltipData, setTooltipData] = useState<(PerformanceDataPoint & { x: number }) | null>(null);
  const [isActive, setIsActive] = useState(false);
  const [isPersisted, setIsPersisted] = useState(false);

  // Gesture tracking
  const touchX = useSharedValue(-1);
  const chartBoundsShared = useSharedValue({ left: 0, right: 1 });
  const lastNotifiedIdx = useRef<number | null>(null);

  // Calculate chart width based on number of points (for scrolling)
  const chartWidth = useMemo(() => {
    const screenWidth = SCREEN_WIDTH - 32;
    const dataWidth = chartData.length * MIN_POINT_WIDTH;
    return Math.max(screenWidth, dataWidth);
  }, [chartData.length]);

  const needsScrolling = chartWidth > SCREEN_WIDTH - 32;

  // Find currently selected index for highlighting
  const selectedIndex = useMemo(() => {
    if (!selectedActivityId) return -1;
    return chartData.findIndex(d => d.id === selectedActivityId);
  }, [selectedActivityId, chartData]);

  const formatSpeedValue = useCallback((speed: number) => {
    if (showPace) {
      return formatPace(speed);
    }
    return formatSpeed(speed);
  }, [showPace]);

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
  const updateTooltipOnJS = useCallback((idx: number, gestureEnded = false) => {
    if (gestureEnded) {
      if (tooltipData) {
        setIsActive(false);
        setIsPersisted(true);
        if (onActivitySelect && tooltipData) {
          onActivitySelect(tooltipData.id, tooltipData.lapPoints);
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
  }, [chartData, isActive, isPersisted, tooltipData, onActivitySelect]);

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
  const panGesture = Gesture.Pan()
    .activateAfterLongPress(300)
    .onStart((e) => {
      'worklet';
      touchX.value = e.x;
    })
    .onUpdate((e) => {
      'worklet';
      touchX.value = e.x;
    })
    .onEnd(() => {
      'worklet';
      touchX.value = -1;
      runOnJS(handleGestureEnd)();
    });

  // Tap gesture to dismiss persisted tooltip
  const tapGesture = Gesture.Tap()
    .onEnd(() => {
      'worklet';
      runOnJS(clearPersistedTooltip)();
    });

  const gesture = Gesture.Race(panGesture, tapGesture);

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
    const xPos = bounds.left + (idx / (len - 1)) * chartWidthPx;

    return {
      opacity: 1,
      transform: [{ translateX: xPos }],
    };
  }, [chartData.length]);

  if (chartData.length < 2) return null;

  const getPointColor = (direction: 'same' | 'reverse') => {
    return direction === 'reverse' ? REVERSE_COLOR : activityColor;
  };

  const chartContent = (
    <GestureDetector gesture={gesture}>
      <View style={[styles.chartInner, { width: chartWidth }]}>
        <CartesianChart
          data={chartData}
          xKey="x"
          yKeys={['speed']}
          domain={{ y: [minSpeed, maxSpeed] }}
          padding={{ left: 35, right: 16, top: 40, bottom: 24 }}
        >
          {({ points, chartBounds }) => {
            if (chartBounds.left !== chartBoundsShared.value.left ||
                chartBounds.right !== chartBoundsShared.value.right) {
              chartBoundsShared.value = { left: chartBounds.left, right: chartBounds.right };
            }

            const samePoints = points.speed.filter((_, idx) => chartData[idx]?.direction === 'same');
            const reversePoints = points.speed.filter((_, idx) => chartData[idx]?.direction === 'reverse');

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
                {points.speed.map((point, idx) => {
                  if (point.x == null || point.y == null) return null;
                  const isSelected = idx === selectedIndex;
                  const isBest = idx === bestIndex;
                  if (isSelected || isBest) return null;
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
                {/* Best performance - gold */}
                {bestIndex !== selectedIndex &&
                 points.speed[bestIndex] &&
                 points.speed[bestIndex].x != null && points.speed[bestIndex].y != null && (
                  <>
                    <Circle
                      cx={points.speed[bestIndex].x!}
                      cy={points.speed[bestIndex].y!}
                      r={8}
                      color="#FFB300"
                    />
                    <Circle
                      cx={points.speed[bestIndex].x!}
                      cy={points.speed[bestIndex].y!}
                      r={4}
                      color="#FFFFFF"
                    />
                  </>
                )}
                {/* Selected activity - cyan */}
                {selectedIndex >= 0 &&
                 points.speed[selectedIndex] &&
                 points.speed[selectedIndex].x != null && points.speed[selectedIndex].y != null && (
                  <>
                    <Circle
                      cx={points.speed[selectedIndex].x!}
                      cy={points.speed[selectedIndex].y!}
                      r={10}
                      color="#00BCD4"
                    />
                    <Circle
                      cx={points.speed[selectedIndex].x!}
                      cy={points.speed[selectedIndex].y!}
                      r={5}
                      color="#FFFFFF"
                    />
                  </>
                )}
              </>
            );
          }}
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
        <View style={[styles.xAxisOverlay, { width: chartWidth - 35 - 16, left: 35 }]} pointerEvents="none">
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
    </GestureDetector>
  );

  return (
    <View style={[styles.chartCard, isDark && styles.chartCardDark]}>
      <View style={styles.chartHeader}>
        <Text style={[styles.chartTitle, isDark && styles.textLight]}>
          {t('sections.performanceOverTime')}
        </Text>
        <View style={styles.chartLegend}>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: '#FFB300' }]} />
            <Text style={[styles.legendText, isDark && styles.textMuted]}>{t('sections.best')}</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: activityColor }]} />
            <Text style={[styles.legendText, isDark && styles.textMuted]}>{t('sections.same')}</Text>
          </View>
          {hasReverseRuns && (
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: REVERSE_COLOR }]} />
              <Text style={[styles.legendText, isDark && styles.textMuted]}>{t('sections.reverse')}</Text>
            </View>
          )}
        </View>
      </View>

      {/* Hint for interaction */}
      {!isActive && !isPersisted && (
        <Text style={[styles.chartHint, isDark && styles.textMuted]}>
          {needsScrolling ? t('sections.scrubHintScrollable') : t('sections.scrubHint')}
        </Text>
      )}

      {/* Selected activity tooltip - tappable */}
      {(isActive || isPersisted) && tooltipData && (
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
              {/* Badge differs based on type */}
              {tooltipBadgeType === 'match' && tooltipData.matchPercentage != null && (
                <View style={[styles.matchBadgeSmall, { backgroundColor: colors.success + '20' }]}>
                  <Text style={[styles.matchBadgeText, { color: colors.success }]}>
                    {Math.round(tooltipData.matchPercentage)}%
                  </Text>
                </View>
              )}
              {tooltipBadgeType === 'time' && tooltipData.sectionTime != null && (
                <Text style={[styles.tooltipDate, isDark && styles.textMuted]}>
                  {' · '}{formatDuration(tooltipData.sectionTime)}
                </Text>
              )}
              {tooltipData.direction === 'reverse' && (
                <View style={styles.reverseBadge}>
                  <MaterialCommunityIcons name="swap-horizontal" size={10} color={REVERSE_COLOR} />
                </View>
              )}
            </View>
          </View>
          <View style={styles.tooltipRight}>
            <Text style={[styles.tooltipSpeed, { color: tooltipData.direction === 'reverse' ? REVERSE_COLOR : activityColor }]}>
              {formatSpeedValue(tooltipData.speed)}
            </Text>
            <MaterialCommunityIcons name="chevron-right" size={16} color={isDark ? '#555' : '#CCC'} />
          </View>
        </TouchableOpacity>
      )}

      {/* Chart with optional horizontal scrolling */}
      <View style={styles.chartContainer}>
        {needsScrolling ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={true}
            contentContainerStyle={{ width: chartWidth }}
          >
            {chartContent}
          </ScrollView>
        ) : (
          chartContent
        )}
      </View>

      {/* Best stats */}
      {chartData[bestIndex] && (
        <View style={[styles.bestStats, isDark && styles.bestStatsDark]}>
          <View style={styles.bestStatItem}>
            <Text style={[styles.bestStatValue, { color: '#FFB300' }]}>
              {formatSpeedValue(chartData[bestIndex].speed)}
            </Text>
            <Text style={[styles.bestStatLabel, isDark && styles.textMuted]}>
              {showPace ? t('sections.bestPace') : t('sections.bestSpeed')}
            </Text>
          </View>
          <View style={styles.bestStatItem}>
            <Text style={[styles.bestStatValue, isDark && styles.textLight]}>
              {formatShortDate(chartData[bestIndex].date)}
            </Text>
            <Text style={[styles.bestStatLabel, isDark && styles.textMuted]}>
              {t('sections.date')}
            </Text>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  chartCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    marginHorizontal: 16,
    marginTop: 16,
    overflow: 'hidden',
  },
  chartCardDark: {
    backgroundColor: darkColors.surfaceCard,
  },
  chartHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
  },
  chartTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  chartLegend: {
    flexDirection: 'row',
    gap: 12,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  legendText: {
    fontSize: 11,
    color: colors.textMuted,
  },
  chartHint: {
    fontSize: 12,
    color: colors.textMuted,
    textAlign: 'center',
    paddingHorizontal: 16,
    paddingBottom: 4,
  },
  selectedTooltip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#F5F5F5',
    marginHorizontal: 16,
    marginBottom: 8,
    padding: 12,
    borderRadius: 10,
  },
  selectedTooltipDark: {
    backgroundColor: darkColors.surfaceElevated,
  },
  tooltipLeft: {
    flex: 1,
    marginRight: 12,
  },
  tooltipName: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textPrimary,
    marginBottom: 2,
  },
  tooltipMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  tooltipDate: {
    fontSize: 12,
    color: colors.textMuted,
  },
  matchBadgeSmall: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  matchBadgeText: {
    fontSize: 11,
    fontWeight: '600',
  },
  reverseBadge: {
    padding: 2,
  },
  tooltipRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  tooltipSpeed: {
    fontSize: 16,
    fontWeight: '700',
  },
  chartContainer: {
    height: CHART_HEIGHT,
  },
  chartInner: {
    height: CHART_HEIGHT,
    position: 'relative',
  },
  crosshair: {
    position: 'absolute',
    top: 40,
    bottom: 24,
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
    bottom: 24,
    justifyContent: 'space-between',
  },
  xAxisOverlay: {
    position: 'absolute',
    bottom: 6,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  axisLabel: {
    fontSize: 10,
    color: colors.textMuted,
  },
  axisLabelDark: {
    color: darkColors.textMuted,
  },
  bestStats: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  bestStatsDark: {
    borderTopColor: darkColors.border,
  },
  bestStatItem: {
    alignItems: 'center',
  },
  bestStatValue: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  bestStatLabel: {
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 2,
  },
  textLight: {
    color: darkColors.textPrimary,
  },
  textMuted: {
    color: darkColors.textMuted,
  },
});

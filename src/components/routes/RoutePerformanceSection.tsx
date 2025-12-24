/**
 * Route performance section for activity detail view.
 * Shows route match info and performance chart over time.
 */

import React, { useMemo, useRef, useCallback, useState } from 'react';
import { View, StyleSheet, useColorScheme, TouchableOpacity } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router, type Href } from 'expo-router';
import { CartesianChart, Line, Scatter } from 'victory-native';
import { Circle } from '@shopify/react-native-skia';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useSharedValue, useDerivedValue, useAnimatedStyle, useAnimatedReaction, runOnJS } from 'react-native-reanimated';
import Animated from 'react-native-reanimated';
import { useRoutePerformances } from '@/hooks';
import { formatSpeed, formatPace, formatRelativeDate, isRunningActivity, getActivityColor } from '@/lib';
import { colors, spacing } from '@/theme';
import type { ActivityType } from '@/types';
import type { RoutePerformancePoint } from '@/hooks/routes/useRoutePerformances';

interface RoutePerformanceSectionProps {
  activityId: string;
  activityType: ActivityType;
}

const CHART_HEIGHT = 160;

function formatShortDate(date: Date): string {
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function getDirectionIcon(direction: string): string {
  switch (direction) {
    case 'reverse':
      return 'swap-horizontal';
    case 'partial':
      return 'arrow-split-vertical';
    default:
      return 'arrow-right';
  }
}

function getDirectionLabel(direction: string): string {
  switch (direction) {
    case 'reverse':
      return 'Reverse';
    case 'partial':
      return 'Partial';
    default:
      return '';
  }
}

export function RoutePerformanceSection({ activityId, activityType }: RoutePerformanceSectionProps) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';

  const { routeGroup, performances, isLoading, best, currentRank } = useRoutePerformances(activityId);

  // Tooltip state - persists after scrubbing ends so user can tap
  const [tooltipData, setTooltipData] = useState<RoutePerformancePoint | null>(null);
  const [isActive, setIsActive] = useState(false);
  const [isPersisted, setIsPersisted] = useState(false); // True when tooltip persists after gesture ends

  // Gesture tracking
  const touchX = useSharedValue(-1);
  const chartBoundsShared = useSharedValue({ left: 0, right: 1 });
  const pointXCoordsShared = useSharedValue<number[]>([]);
  const lastNotifiedIdx = useRef<number | null>(null);

  // Prepare chart data
  const chartData = useMemo(() => {
    return performances.map((p, idx) => ({
      x: idx,
      speed: p.speed,
      date: p.date,
      name: p.name,
      isCurrent: p.isCurrent,
      isBest: best?.activityId === p.activityId,
      activityId: p.activityId,
    }));
  }, [performances, best]);

  // Find indices
  const { currentIndex, bestIndex, minSpeed, maxSpeed } = useMemo(() => {
    const currIdx = chartData.findIndex((d) => d.isCurrent);
    const bestIdx = chartData.findIndex((d) => d.isBest);
    const speeds = chartData.map(d => d.speed);
    const min = speeds.length > 0 ? Math.min(...speeds) : 0;
    const max = speeds.length > 0 ? Math.max(...speeds) : 1;
    // Add padding to domain
    const padding = (max - min) * 0.15 || 0.5;
    return {
      currentIndex: currIdx,
      bestIndex: bestIdx,
      minSpeed: Math.max(0, min - padding),
      maxSpeed: max + padding,
    };
  }, [chartData]);

  const showPace = isRunningActivity(activityType);
  const activityColor = getActivityColor(activityType);

  // Format speed/pace for display
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
    const chartWidth = bounds.right - bounds.left;

    if (touchX.value < 0 || chartWidth <= 0 || len === 0) return -1;

    const chartX = touchX.value - bounds.left;
    const ratio = Math.max(0, Math.min(1, chartX / chartWidth));
    const idx = Math.round(ratio * (len - 1));

    return Math.min(Math.max(0, idx), len - 1);
  }, [chartData.length]);

  // Update tooltip on JS thread
  const updateTooltipOnJS = useCallback((idx: number, gestureEnded = false) => {
    if (idx < 0 || performances.length === 0) {
      if (gestureEnded && tooltipData) {
        // Gesture ended - persist the last tooltip for tapping
        setIsActive(false);
        setIsPersisted(true);
        lastNotifiedIdx.current = null;
      } else if (!isPersisted) {
        // Only clear if not in persisted mode
        setTooltipData(null);
        setIsActive(false);
        lastNotifiedIdx.current = null;
      }
      return;
    }

    // New gesture started - clear persisted state
    if (isPersisted) {
      setIsPersisted(false);
    }

    if (idx === lastNotifiedIdx.current) return;
    lastNotifiedIdx.current = idx;

    if (!isActive) {
      setIsActive(true);
    }

    const point = performances[idx];
    if (point) {
      setTooltipData(point);
    }
  }, [performances, isActive, isPersisted, tooltipData]);

  // Handle gesture end - persist tooltip
  const handleGestureEnd = useCallback(() => {
    updateTooltipOnJS(-1, true);
  }, [updateTooltipOnJS]);

  useAnimatedReaction(
    () => selectedIdx.value,
    (idx) => {
      runOnJS(updateTooltipOnJS)(idx, false);
    },
    [updateTooltipOnJS]
  );

  // Gesture handler
  const gesture = Gesture.Pan()
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
    })
    .minDistance(0);

  // Animated crosshair
  const crosshairStyle = useAnimatedStyle(() => {
    'worklet';
    const coords = pointXCoordsShared.value;
    const idx = selectedIdx.value;

    if (idx < 0 || coords.length === 0 || idx >= coords.length) {
      return { opacity: 0, transform: [{ translateX: 0 }] };
    }

    return {
      opacity: 1,
      transform: [{ translateX: coords[idx] }],
    };
  }, []);

  // Navigate to activity when tapping tooltip
  const handleActivityPress = useCallback(() => {
    if (tooltipData) {
      router.push(`/activity/${tooltipData.activityId}` as Href);
    }
  }, [tooltipData]);

  const handleRoutePress = useCallback(() => {
    if (routeGroup) {
      router.push(`/route/${routeGroup.id}` as Href);
    }
  }, [routeGroup]);

  // Don't show if no route match or still loading
  if (!routeGroup || isLoading) {
    return null;
  }

  // Get current activity performance
  const currentPerformance = performances.find((p) => p.isCurrent);
  const displayPerformance = tooltipData || currentPerformance;

  // Get match percentage for current activity
  const currentMatch = currentPerformance?.matchPercentage;

  return (
    <View style={[styles.container, isDark && styles.containerDark]}>
      {/* Section Title */}
      <View style={styles.sectionTitle}>
        <Text style={[styles.sectionTitleText, isDark && styles.textMuted]}>MATCHED ROUTE</Text>
        {currentMatch !== undefined && (
          <View style={[styles.matchBadge, { backgroundColor: colors.success + '20' }]}>
            <Text style={[styles.matchText, { color: colors.success }]}>
              {Math.round(currentMatch)}% match
            </Text>
          </View>
        )}
      </View>

      {/* Route Header */}
      <TouchableOpacity style={styles.header} onPress={handleRoutePress} activeOpacity={0.7}>
        <View style={styles.headerLeft}>
          <View style={[styles.iconBadge, { backgroundColor: activityColor + '20' }]}>
            <MaterialCommunityIcons name="map-marker-path" size={16} color={activityColor} />
          </View>
          <View>
            <Text style={[styles.routeName, isDark && styles.textLight]} numberOfLines={1}>
              {routeGroup.name}
            </Text>
            <Text style={[styles.routeMeta, isDark && styles.textMuted]}>
              {routeGroup.activityCount} activities
              {currentRank && ` · #${currentRank} fastest`}
            </Text>
          </View>
        </View>
        <MaterialCommunityIcons name="chevron-right" size={20} color={isDark ? '#555' : '#CCC'} />
      </TouchableOpacity>

      {/* Performance Chart */}
      {chartData.length > 1 && (
        <GestureDetector gesture={gesture}>
          <View style={styles.chartContainer}>
            {/* Tooltip showing selected activity - persists after gesture for tapping */}
            {(isActive || isPersisted) && tooltipData && (
              <TouchableOpacity
                style={[styles.tooltip, isDark && styles.tooltipDark]}
                onPress={handleActivityPress}
                activeOpacity={0.7}
              >
                <View style={styles.tooltipContent}>
                  <View style={styles.tooltipHeader}>
                    <Text style={[styles.tooltipValue, { color: activityColor }]}>
                      {formatSpeedValue(tooltipData.speed)}
                    </Text>
                    {tooltipData.direction !== 'same' && (
                      <View style={[styles.directionBadge, tooltipData.direction === 'reverse' && styles.directionReverse]}>
                        <MaterialCommunityIcons
                          name={getDirectionIcon(tooltipData.direction) as any}
                          size={10}
                          color={tooltipData.direction === 'reverse' ? '#E91E63' : '#FF9800'}
                        />
                        <Text style={styles.directionText}>
                          {getDirectionLabel(tooltipData.direction)}
                        </Text>
                      </View>
                    )}
                  </View>
                  <Text style={[styles.tooltipLabel, isDark && styles.textMuted]} numberOfLines={1}>
                    {tooltipData.name}
                  </Text>
                  <View style={styles.tooltipFooter}>
                    <Text style={[styles.tooltipDate, isDark && styles.textMuted]}>
                      {formatShortDate(tooltipData.date)}
                    </Text>
                    <Text style={[styles.tooltipMatch, { color: colors.success }]}>
                      {Math.round(tooltipData.matchPercentage)}%
                    </Text>
                    <Text style={styles.tooltipArrow}>→</Text>
                  </View>
                </View>
              </TouchableOpacity>
            )}

            <CartesianChart
              data={chartData}
              xKey="x"
              yKeys={['speed']}
              domain={{ y: [minSpeed, maxSpeed] }}
              padding={{ left: 35, right: 8, top: 40, bottom: 24 }}
            >
              {({ points, chartBounds }) => {
                // Sync chartBounds for gesture handling
                if (chartBounds.left !== chartBoundsShared.value.left ||
                    chartBounds.right !== chartBoundsShared.value.right) {
                  chartBoundsShared.value = { left: chartBounds.left, right: chartBounds.right };
                }
                // Sync point x-coordinates
                const newCoords = points.speed.map(p => p.x ?? 0);
                if (newCoords.length !== pointXCoordsShared.value.length) {
                  pointXCoordsShared.value = newCoords;
                }

                return (
                  <>
                    {/* Line connecting points */}
                    <Line
                      points={points.speed}
                      color={isDark ? '#444' : '#DDD'}
                      strokeWidth={1.5}
                      curveType="monotoneX"
                    />
                    {/* Regular points */}
                    {points.speed.map((point, idx) => {
                      if (point.x == null || point.y == null) return null;
                      const d = chartData[idx];
                      if (d?.isBest || d?.isCurrent) return null; // Skip, render separately
                      return (
                        <Circle
                          key={`point-${idx}`}
                          cx={point.x}
                          cy={point.y}
                          r={5}
                          color={activityColor}
                        />
                      );
                    })}
                    {/* Best performance - gold color */}
                    {bestIndex >= 0 && points.speed[bestIndex] &&
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
                    {/* Current activity - highlighted */}
                    {currentIndex >= 0 && currentIndex !== bestIndex &&
                     points.speed[currentIndex] &&
                     points.speed[currentIndex].x != null && points.speed[currentIndex].y != null && (
                      <>
                        <Circle
                          cx={points.speed[currentIndex].x!}
                          cy={points.speed[currentIndex].y!}
                          r={8}
                          color={activityColor}
                          opacity={0.3}
                        />
                        <Circle
                          cx={points.speed[currentIndex].x!}
                          cy={points.speed[currentIndex].y!}
                          r={5}
                          color={activityColor}
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

            {/* Y-axis labels (pace/speed) */}
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
            <View style={styles.xAxisOverlay} pointerEvents="none">
              {chartData.length > 0 && (
                <>
                  <Text style={[styles.axisLabel, isDark && styles.axisLabelDark]}>
                    {formatShortDate(chartData[0].date)}
                  </Text>
                  {/* Show middle date if we have enough points */}
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
      )}

      {/* Stats Row */}
      <View style={[styles.statsRow, isDark && styles.statsRowDark]}>
        <View style={styles.stat}>
          <Text style={[styles.statValue, isDark && styles.textLight]}>
            {displayPerformance ? formatSpeedValue(displayPerformance.speed) : '-'}
          </Text>
          <Text style={[styles.statLabel, isDark && styles.textMuted]}>
            {(isActive || isPersisted) && tooltipData ? 'Selected' : `This ${showPace ? 'pace' : 'speed'}`}
          </Text>
        </View>
        <View style={[styles.statDivider, isDark && styles.statDividerDark]} />
        <View style={styles.stat}>
          <Text style={[styles.statValue, { color: '#FFB300' }]}>
            {best ? formatSpeedValue(best.speed) : '-'}
          </Text>
          <Text style={[styles.statLabel, isDark && styles.textMuted]}>Best</Text>
        </View>
        <View style={[styles.statDivider, isDark && styles.statDividerDark]} />
        <View style={styles.stat}>
          <Text style={[styles.statValue, isDark && styles.textLight]}>
            {best ? formatRelativeDate(best.date.toISOString()) : '-'}
          </Text>
          <Text style={[styles.statLabel, isDark && styles.textMuted]}>Best on</Text>
        </View>
      </View>

      {/* Legend */}
      <View style={styles.legend}>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: '#FFB300' }]} />
          <Text style={[styles.legendText, isDark && styles.textMuted]}>Best</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: activityColor }]} />
          <Text style={[styles.legendText, isDark && styles.textMuted]}>This activity</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    marginHorizontal: spacing.md,
    marginTop: spacing.md,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  containerDark: {
    backgroundColor: '#1E1E1E',
  },
  sectionTitle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.xs,
  },
  sectionTitleText: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.5,
    color: colors.textSecondary,
  },
  matchBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  matchText: {
    fontSize: 11,
    fontWeight: '600',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.md,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: spacing.sm,
  },
  iconBadge: {
    width: 32,
    height: 32,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  routeName: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  routeMeta: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 1,
  },
  textLight: {
    color: '#FFFFFF',
  },
  textMuted: {
    color: '#888',
  },
  chartContainer: {
    height: CHART_HEIGHT,
    position: 'relative',
  },
  tooltip: {
    position: 'absolute',
    top: 4,
    right: spacing.md,
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    zIndex: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  tooltipDark: {
    backgroundColor: 'rgba(40, 40, 40, 0.95)',
  },
  tooltipContent: {
    alignItems: 'flex-end',
  },
  tooltipHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  tooltipValue: {
    fontSize: 14,
    fontWeight: '700',
  },
  tooltipLabel: {
    fontSize: 11,
    color: colors.textSecondary,
    maxWidth: 120,
  },
  tooltipFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 2,
  },
  tooltipDate: {
    fontSize: 10,
    color: colors.textSecondary,
  },
  tooltipMatch: {
    fontSize: 10,
    fontWeight: '600',
  },
  tooltipArrow: {
    fontSize: 10,
    color: colors.primary,
  },
  directionBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 152, 0, 0.15)',
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 4,
    gap: 2,
  },
  directionReverse: {
    backgroundColor: 'rgba(233, 30, 99, 0.15)',
  },
  directionText: {
    fontSize: 9,
    fontWeight: '600',
    color: '#FF9800',
  },
  crosshair: {
    position: 'absolute',
    top: 40,
    bottom: 24,
    width: 1.5,
    backgroundColor: '#666',
  },
  crosshairDark: {
    backgroundColor: '#AAA',
  },
  yAxisOverlay: {
    position: 'absolute',
    top: 40,
    bottom: 24,
    left: 4,
    justifyContent: 'space-between',
  },
  xAxisOverlay: {
    position: 'absolute',
    bottom: 4,
    left: 35,
    right: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  axisLabel: {
    fontSize: 9,
    color: colors.textSecondary,
  },
  axisLabelDark: {
    color: '#888',
  },
  statsRow: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: 'rgba(0, 0, 0, 0.05)',
    paddingVertical: spacing.md,
  },
  statsRowDark: {
    borderTopColor: 'rgba(255, 255, 255, 0.08)',
  },
  stat: {
    flex: 1,
    alignItems: 'center',
  },
  statValue: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  statLabel: {
    fontSize: 11,
    color: colors.textSecondary,
    marginTop: 2,
  },
  statDivider: {
    width: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.08)',
  },
  statDividerDark: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },
  legend: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.md,
    paddingBottom: spacing.sm,
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
    fontSize: 10,
    color: colors.textSecondary,
  },
});

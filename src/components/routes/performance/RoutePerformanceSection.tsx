/**
 * Route performance section for activity detail view.
 * Shows route match info and performance chart over time.
 * Includes toggle to switch between matched routes and matched sections.
 */

import React, { useMemo, useRef, useCallback, useState } from 'react';
import {
  View,
  StyleSheet,
  useColorScheme,
  TouchableOpacity,
  ScrollView,
  Dimensions,
  Pressable,
} from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router, type Href } from 'expo-router';
import { CartesianChart, Line, Scatter } from 'victory-native';
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
import { useTranslation } from 'react-i18next';
import { useRoutePerformances, useSectionMatches } from '@/hooks';
import {
  formatSpeed,
  formatPace,
  formatRelativeDate,
  formatDistance,
  isRunningActivity,
  getActivityColor,
  getActivityIcon,
} from '@/lib';
import { colors, darkColors, opacity, spacing, layout, typography } from '@/theme';
import type { ActivityType, FrequentSection } from '@/types';
import type { RoutePerformancePoint } from '@/hooks/routes/useRoutePerformances';
import type { SectionMatch } from '@/hooks/routes/useSectionMatches';
import { StatsRow } from './StatsRow';
import { ChartLegend } from './ChartLegend';
import { SectionMatchRow } from './SectionMatchRow';

// Colors for direction in chart
const SAME_COLOR = '#2196F3'; // Blue - distinct from green/yellow/purple
const REVERSE_COLOR = '#E91E63'; // Pink - distinct from blue

interface RoutePerformanceSectionProps {
  activityId: string;
  activityType: ActivityType;
}

const CHART_HEIGHT = 160;
const MIN_POINT_WIDTH = 40; // Minimum pixels per data point
const SCREEN_WIDTH = Dimensions.get('window').width;

function formatShortDate(date: Date): string {
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function getDirectionIcon(direction: string) {
  switch (direction) {
    case 'reverse':
      return 'swap-horizontal' as const;
    case 'partial':
      return 'arrow-split-vertical' as const;
    default:
      return 'arrow-right' as const;
  }
}

type ViewMode = 'route' | 'sections';

export function RoutePerformanceSection({
  activityId,
  activityType,
}: RoutePerformanceSectionProps) {
  const { t } = useTranslation();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';

  // View mode toggle state
  const [viewMode, setViewMode] = useState<ViewMode>('route');

  const { routeGroup, performances, isLoading, best, currentRank } =
    useRoutePerformances(activityId);
  const { sections: sectionMatches, count: sectionCount } = useSectionMatches(activityId);

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
      direction: p.direction,
    }));
  }, [performances, best]);

  // Check if we have any reverse runs for legend
  const hasReverseRuns = useMemo(() => {
    return performances.some((p) => p.direction === 'reverse');
  }, [performances]);

  // Calculate chart width - ensure enough space for each data point
  const chartWidth = useMemo(() => {
    const containerWidth = SCREEN_WIDTH - spacing.md * 2; // Account for margins
    const minWidth = chartData.length * MIN_POINT_WIDTH;
    return Math.max(containerWidth, minWidth);
  }, [chartData.length]);

  const needsScroll = chartWidth > SCREEN_WIDTH - spacing.md * 2;

  // Find indices
  const { currentIndex, bestIndex, minSpeed, maxSpeed } = useMemo(() => {
    const currIdx = chartData.findIndex((d) => d.isCurrent);
    const bestIdx = chartData.findIndex((d) => d.isBest);
    const speeds = chartData.map((d) => d.speed);
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

  // Use a distinct color for "this activity" that won't conflict with other colors
  // Cyan/teal stands out from gold (best), green (match badges), and activity colors
  const currentActivityColor = '#00BCD4'; // Cyan

  // Format speed/pace for display
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
    const chartWidth = bounds.right - bounds.left;

    if (touchX.value < 0 || chartWidth <= 0 || len === 0) return -1;

    const chartX = touchX.value - bounds.left;
    const ratio = Math.max(0, Math.min(1, chartX / chartWidth));
    const idx = Math.round(ratio * (len - 1));

    return Math.min(Math.max(0, idx), len - 1);
  }, [chartData.length]);

  // Update tooltip on JS thread
  const updateTooltipOnJS = useCallback(
    (idx: number, gestureEnded = false) => {
      // Gesture ended - persist the current tooltip for tapping
      if (gestureEnded) {
        if (tooltipData) {
          setIsActive(false);
          setIsPersisted(true);
        }
        lastNotifiedIdx.current = null;
        return;
      }

      // Invalid index during active gesture - ignore (don't clear)
      if (idx < 0 || performances.length === 0) {
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
    },
    [performances, isActive, isPersisted, tooltipData]
  );

  // Handle gesture end - persist tooltip
  const handleGestureEnd = useCallback(() => {
    updateTooltipOnJS(-1, true);
  }, [updateTooltipOnJS]);

  useAnimatedReaction(
    () => selectedIdx.value,
    (idx) => {
      // Only update tooltip for valid indices during active gesture
      // Skip idx === -1 here - let handleGestureEnd manage that case to avoid race condition
      if (idx >= 0) {
        runOnJS(updateTooltipOnJS)(idx, false);
      }
    },
    [updateTooltipOnJS]
  );

  // Clear persisted tooltip
  const clearPersistedTooltip = useCallback(() => {
    if (isPersisted) {
      setIsPersisted(false);
      setTooltipData(null);
    }
  }, [isPersisted]);

  // Gesture handler - combines pan for scrubbing and tap to dismiss
  const panGesture = Gesture.Pan()
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
    .minDistance(0)
    .activateAfterLongPress(700);

  // Tap gesture to dismiss persisted tooltip when tapping on chart
  const tapGesture = Gesture.Tap().onEnd(() => {
    'worklet';
    runOnJS(clearPersistedTooltip)();
  });

  const gesture = Gesture.Race(panGesture, tapGesture);

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

  // Don't show if no route match AND no sections, or still loading
  const hasRoute = !!routeGroup;
  const hasSections = sectionCount > 0;

  if ((!hasRoute && !hasSections) || isLoading) {
    return null;
  }

  // If only one type available, force that view mode
  const effectiveViewMode = !hasRoute ? 'sections' : !hasSections ? 'route' : viewMode;
  const showToggle = hasRoute && hasSections;

  // Get current activity performance
  const currentPerformance = performances.find((p) => p.isCurrent);
  const displayPerformance = tooltipData || currentPerformance;

  // Get match percentage for current activity
  const currentMatch = currentPerformance?.matchPercentage;

  return (
    <View style={[styles.container, isDark && styles.containerDark]}>
      {/* Toggle Header */}
      <View style={styles.toggleHeader}>
        {showToggle ? (
          <View style={[styles.toggleContainer, isDark && styles.toggleContainerDark]}>
            <Pressable
              style={[
                styles.toggleButton,
                effectiveViewMode === 'route' && styles.toggleButtonActive,
                effectiveViewMode === 'route' && { backgroundColor: activityColor + '20' },
              ]}
              onPress={() => setViewMode('route')}
            >
              <MaterialCommunityIcons
                name="map-marker-path"
                size={14}
                color={effectiveViewMode === 'route' ? activityColor : isDark ? '#888' : '#666'}
              />
              <Text
                style={[
                  styles.toggleText,
                  effectiveViewMode === 'route' && { color: activityColor },
                  isDark && effectiveViewMode !== 'route' && styles.textMuted,
                ]}
              >
                {t('routes.matchedRoute')}
              </Text>
            </Pressable>
            <Pressable
              style={[
                styles.toggleButton,
                effectiveViewMode === 'sections' && styles.toggleButtonActive,
                effectiveViewMode === 'sections' && { backgroundColor: activityColor + '20' },
              ]}
              onPress={() => setViewMode('sections')}
            >
              <MaterialCommunityIcons
                name="road-variant"
                size={14}
                color={effectiveViewMode === 'sections' ? activityColor : isDark ? '#888' : '#666'}
              />
              <Text
                style={[
                  styles.toggleText,
                  effectiveViewMode === 'sections' && { color: activityColor },
                  isDark && effectiveViewMode !== 'sections' && styles.textMuted,
                ]}
              >
                {t('trainingScreen.sections')} ({sectionCount})
              </Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.sectionTitle}>
            <Text style={[styles.sectionTitleText, isDark && styles.textMuted]}>
              {effectiveViewMode === 'route'
                ? t('routes.matchedRoute')
                : t('trainingScreen.sections')}
            </Text>
            {effectiveViewMode === 'route' && currentMatch !== undefined && (
              <View style={[styles.matchBadge, { backgroundColor: colors.success + '20' }]}>
                <Text style={[styles.matchText, { color: colors.success }]}>
                  {Math.round(currentMatch)}% {t('routes.match')}
                </Text>
              </View>
            )}
          </View>
        )}
      </View>

      {/* Route View */}
      {effectiveViewMode === 'route' && routeGroup && (
        <>
          {/* Show match badge when toggle is shown */}
          {showToggle && currentMatch !== undefined && (
            <View style={styles.matchBadgeRow}>
              <View style={[styles.matchBadge, { backgroundColor: colors.success + '20' }]}>
                <Text style={[styles.matchText, { color: colors.success }]}>
                  {Math.round(currentMatch)}% {t('routes.match')}
                </Text>
              </View>
            </View>
          )}

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
                  {routeGroup.activityCount} {t('routes.activities')}
                  {currentRank && ` · ${t('routes.fastest', { rank: currentRank })}`}
                </Text>
              </View>
            </View>
            <MaterialCommunityIcons
              name="chevron-right"
              size={20}
              color={isDark ? '#555' : '#CCC'}
            />
          </TouchableOpacity>

          {/* Selected activity info - OUTSIDE gesture area so it's tappable */}
          {(isActive || isPersisted) && tooltipData && (
            <TouchableOpacity
              style={[styles.selectedActivity, isDark && styles.selectedActivityDark]}
              onPress={handleActivityPress}
              activeOpacity={0.7}
            >
              <View style={styles.selectedActivityLeft}>
                <View
                  style={[
                    styles.selectedActivityIcon,
                    { backgroundColor: currentActivityColor + '20' },
                  ]}
                >
                  <MaterialCommunityIcons
                    name="lightning-bolt"
                    size={16}
                    color={currentActivityColor}
                  />
                </View>
                <View style={styles.selectedActivityInfo}>
                  <Text
                    style={[styles.selectedActivityName, isDark && styles.textLight]}
                    numberOfLines={1}
                  >
                    {tooltipData.name}
                  </Text>
                  <View style={styles.selectedActivityMeta}>
                    <Text style={[styles.selectedActivityDate, isDark && styles.textMuted]}>
                      {formatShortDate(tooltipData.date)}
                    </Text>
                    <View
                      style={[
                        styles.selectedMatchBadge,
                        { backgroundColor: colors.success + '20' },
                      ]}
                    >
                      <Text style={[styles.selectedMatchText, { color: colors.success }]}>
                        {Math.round(tooltipData.matchPercentage)}%
                      </Text>
                    </View>
                    {tooltipData.direction !== 'same' && (
                      <View
                        style={[
                          styles.directionBadge,
                          tooltipData.direction === 'reverse' && styles.directionReverse,
                        ]}
                      >
                        <MaterialCommunityIcons
                          name={getDirectionIcon(tooltipData.direction)}
                          size={10}
                          color={tooltipData.direction === 'reverse' ? '#E91E63' : '#FF9800'}
                        />
                      </View>
                    )}
                  </View>
                </View>
              </View>
              <View style={styles.selectedActivityRight}>
                <Text style={[styles.selectedActivitySpeed, { color: currentActivityColor }]}>
                  {formatSpeedValue(tooltipData.speed)}
                </Text>
                <MaterialCommunityIcons
                  name="chevron-right"
                  size={18}
                  color={isDark ? '#555' : '#CCC'}
                />
              </View>
            </TouchableOpacity>
          )}

          {/* Performance Chart */}
          {chartData.length > 1 && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={needsScroll}
              scrollEnabled={needsScroll}
              contentContainerStyle={{ width: chartWidth }}
              style={styles.chartScrollContainer}
            >
              <GestureDetector gesture={gesture}>
                <View style={[styles.chartContainer, { width: chartWidth }]}>
                  <CartesianChart
                    data={chartData}
                    xKey="x"
                    yKeys={['speed']}
                    domain={{ y: [minSpeed, maxSpeed] }}
                    padding={{ left: 35, right: 8, top: 40, bottom: 24 }}
                  >
                    {({ points, chartBounds }) => {
                      // Sync chartBounds for gesture handling
                      if (
                        chartBounds.left !== chartBoundsShared.value.left ||
                        chartBounds.right !== chartBoundsShared.value.right
                      ) {
                        chartBoundsShared.value = {
                          left: chartBounds.left,
                          right: chartBounds.right,
                        };
                      }
                      // Sync point x-coordinates
                      const newCoords = points.speed.map((p) => p.x ?? 0);
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
                          {/* Regular points - colored by direction */}
                          {points.speed.map((point, idx) => {
                            if (point.x == null || point.y == null) return null;
                            const d = chartData[idx];
                            if (d?.isBest || d?.isCurrent) return null; // Skip, render separately
                            const pointColor =
                              d?.direction === 'reverse' ? REVERSE_COLOR : SAME_COLOR;
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
                          {/* Best performance - gold color */}
                          {bestIndex >= 0 &&
                            points.speed[bestIndex] &&
                            points.speed[bestIndex].x != null &&
                            points.speed[bestIndex].y != null && (
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
                          {/* Current activity - highlighted with distinct cyan color */}
                          {currentIndex >= 0 &&
                            currentIndex !== bestIndex &&
                            points.speed[currentIndex] &&
                            points.speed[currentIndex].x != null &&
                            points.speed[currentIndex].y != null && (
                              <>
                                <Circle
                                  cx={points.speed[currentIndex].x!}
                                  cy={points.speed[currentIndex].y!}
                                  r={8}
                                  color={currentActivityColor}
                                  opacity={0.3}
                                />
                                <Circle
                                  cx={points.speed[currentIndex].x!}
                                  cy={points.speed[currentIndex].y!}
                                  r={5}
                                  color={currentActivityColor}
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
            </ScrollView>
          )}

          {/* Stats Row */}
          <StatsRow
            currentSpeed={displayPerformance?.speed ?? null}
            bestSpeed={best?.speed ?? null}
            bestDate={best?.date ?? null}
            formatSpeedValue={formatSpeedValue}
            showPace={showPace}
            isTooltipActive={(isActive || isPersisted) && tooltipData !== null}
            isDark={isDark}
            currentActivityColor={currentActivityColor}
          />

          {/* Legend */}
          <ChartLegend
            currentActivityColor={currentActivityColor}
            hasReverseRuns={hasReverseRuns}
            isDark={isDark}
          />
        </>
      )}

      {/* Sections View */}
      {effectiveViewMode === 'sections' && sectionMatches.length > 0 && (
        <View style={styles.sectionsContainer}>
          {sectionMatches.map((match, index) => (
            <SectionMatchRow
              key={match.section.id}
              match={match}
              activityType={activityType}
              isDark={isDark}
              isLast={index === sectionMatches.length - 1}
            />
          ))}
        </View>
      )}
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
    backgroundColor: darkColors.surface,
  },
  toggleHeader: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.xs,
  },
  toggleContainer: {
    flexDirection: 'row',
    backgroundColor: opacity.overlay.light,
    borderRadius: layout.borderRadiusSm,
    padding: 2,
  },
  toggleContainerDark: {
    backgroundColor: opacity.overlayDark.medium,
  },
  toggleButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: layout.borderRadiusSm - 1,
  },
  toggleButtonActive: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 1,
  },
  toggleText: {
    fontSize: typography.label.fontSize,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  sectionTitle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionTitleText: {
    fontSize: typography.label.fontSize,
    fontWeight: '600',
    letterSpacing: 0.5,
    color: colors.textSecondary,
  },
  matchBadgeRow: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.xs,
    flexDirection: 'row',
  },
  matchBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: 10,
  },
  matchText: {
    fontSize: typography.label.fontSize,
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
    borderRadius: layout.borderRadiusSm,
    justifyContent: 'center',
    alignItems: 'center',
  },
  routeName: {
    fontSize: typography.bodySmall.fontSize,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  routeMeta: {
    fontSize: typography.caption.fontSize,
    color: colors.textSecondary,
    marginTop: 1,
  },
  textLight: {
    color: colors.textOnDark,
  },
  textMuted: {
    color: darkColors.textMuted,
  },
  selectedActivity: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(0, 188, 212, 0.08)',
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
    padding: spacing.sm,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(0, 188, 212, 0.2)',
  },
  selectedActivityDark: {
    backgroundColor: 'rgba(0, 188, 212, 0.12)',
    borderColor: 'rgba(0, 188, 212, 0.3)',
  },
  selectedActivityLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: spacing.sm,
  },
  selectedActivityIcon: {
    width: 32,
    height: 32,
    borderRadius: layout.borderRadiusSm,
    justifyContent: 'center',
    alignItems: 'center',
  },
  selectedActivityInfo: {
    flex: 1,
  },
  selectedActivityName: {
    fontSize: typography.bodyCompact.fontSize,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  selectedActivityMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: 2,
  },
  selectedActivityDate: {
    fontSize: typography.label.fontSize,
    color: colors.textSecondary,
  },
  selectedMatchBadge: {
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 6,
  },
  selectedMatchText: {
    fontSize: typography.micro.fontSize,
    fontWeight: '600',
  },
  selectedActivityRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  selectedActivitySpeed: {
    fontSize: typography.bodySmall.fontSize,
    fontWeight: '700',
  },
  chartScrollContainer: {
    maxHeight: CHART_HEIGHT,
  },
  chartContainer: {
    height: CHART_HEIGHT,
    position: 'relative',
  },
  directionBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 152, 0, 0.15)',
    paddingHorizontal: spacing.xs,
    paddingVertical: 1,
    borderRadius: spacing.xs,
    gap: 2,
  },
  directionReverse: {
    backgroundColor: 'rgba(233, 30, 99, 0.15)',
  },
  directionText: {
    fontSize: typography.pillLabel.fontSize,
    fontWeight: '600',
    color: '#FF9800',
  },
  crosshair: {
    position: 'absolute',
    top: 40,
    bottom: 24,
    width: 1.5,
    backgroundColor: colors.textSecondary,
  },
  crosshairDark: {
    backgroundColor: darkColors.textSecondary,
  },
  yAxisOverlay: {
    position: 'absolute',
    top: 40,
    bottom: 24,
    left: spacing.xs,
    justifyContent: 'space-between',
  },
  xAxisOverlay: {
    position: 'absolute',
    bottom: spacing.xs,
    left: 35,
    right: spacing.sm,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  axisLabel: {
    fontSize: typography.pillLabel.fontSize,
    color: colors.textSecondary,
  },
  axisLabelDark: {
    color: darkColors.textMuted,
  },
  // Sections view styles
  sectionsContainer: {
    paddingBottom: spacing.xs,
  },
});

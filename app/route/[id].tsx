import React, { useMemo, useCallback, useState, useEffect, useRef } from 'react';
import { View, ScrollView, StyleSheet, useColorScheme, Pressable, Dimensions, StatusBar, TouchableOpacity, TextInput, Alert, Keyboard } from 'react-native';
import { Text, IconButton, ActivityIndicator } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, router, Href } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { CartesianChart, Line } from 'victory-native';
import { Circle } from '@shopify/react-native-skia';
import Svg, { Polyline } from 'react-native-svg';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useSharedValue, useDerivedValue, useAnimatedStyle, useAnimatedReaction, runOnJS } from 'react-native-reanimated';
import Animated from 'react-native-reanimated';
import { useRouteMatchStore } from '@/providers';
import { useActivities } from '@/hooks';
import { RouteMapView } from '@/components/routes';
import {
  formatDistance,
  formatRelativeDate,
  getActivityIcon,
  getActivityColor,
  formatDuration,
  formatSpeed,
  formatPace,
  isRunningActivity,
  saveCustomRouteName,
  loadCustomRouteNames,
  getRouteDisplayName,
} from '@/lib';
import { colors, spacing, layout } from '@/theme';
import type { Activity, ActivityType, RoutePoint } from '@/types';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const MAP_HEIGHT = Math.round(SCREEN_HEIGHT * 0.45); // 45% of screen for hero map

// Color for reverse direction activities
const REVERSE_COLOR = '#9C27B0'; // Purple
const SAME_COLOR_DEFAULT = '#4CAF50'; // Green (same direction)
const CONSENSUS_COLOR = '#FF9800'; // Orange for the consensus/main route

interface ActivityRowProps {
  activity: Activity;
  isDark: boolean;
  matchPercentage?: number;
  direction?: string;
  /** Route points for this activity's GPS trace */
  activityPoints?: RoutePoint[];
  /** Representative route points (full route for comparison) */
  routePoints?: RoutePoint[];
  /** Whether this row is currently highlighted */
  isHighlighted?: boolean;
  /** Distance of the overlapping section in meters */
  overlapDistance?: number;
  /** Total distance of the route in meters (for context) */
  routeDistance?: number;
}

/** Mini route trace component for activity list - shows both route reference and activity trace */
function MiniRouteTrace({
  activityPoints,
  routePoints,
  activityColor,
  routeColor,
  isHighlighted,
}: {
  /** Points from the individual activity's GPS trace */
  activityPoints: RoutePoint[];
  /** Points from the representative route (full route) */
  routePoints?: RoutePoint[];
  /** Color for the activity trace */
  activityColor: string;
  /** Color for the route reference (shown underneath) */
  routeColor: string;
  isHighlighted?: boolean;
}) {
  if (activityPoints.length < 2) return null;

  const width = 36;
  const height = 36;
  const padding = 3;

  // Combine all points to calculate shared bounds
  const allPoints = routePoints && routePoints.length > 0
    ? [...activityPoints, ...routePoints]
    : activityPoints;

  const lats = allPoints.map(p => p.lat);
  const lngs = allPoints.map(p => p.lng);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);

  const latRange = maxLat - minLat || 1;
  const lngRange = maxLng - minLng || 1;

  // Scale function using shared bounds
  const scalePoints = (points: RoutePoint[]) =>
    points.map(p => ({
      x: ((p.lng - minLng) / lngRange) * (width - padding * 2) + padding,
      y: (1 - (p.lat - minLat) / latRange) * (height - padding * 2) + padding,
    }));

  const activityScaled = scalePoints(activityPoints);
  const activityString = activityScaled.map(p => `${p.x},${p.y}`).join(' ');

  const routeScaled = routePoints && routePoints.length > 1
    ? scalePoints(routePoints)
    : null;
  const routeString = routeScaled
    ? routeScaled.map(p => `${p.x},${p.y}`).join(' ')
    : null;

  return (
    <View style={[
      miniTraceStyles.container,
      isHighlighted && miniTraceStyles.highlighted,
    ]}>
      <Svg width={width} height={height}>
        {/* Route reference underneath (faded - the full route for comparison) */}
        {routeString && (
          <Polyline
            points={routeString}
            fill="none"
            stroke={routeColor}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity={isHighlighted ? 0.3 : 0.2}
          />
        )}
        {/* Activity trace on top (prominent - this activity's actual path) */}
        <Polyline
          points={activityString}
          fill="none"
          stroke={activityColor}
          strokeWidth={isHighlighted ? 3 : 2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={0.85}
        />
      </Svg>
    </View>
  );
}

const miniTraceStyles = StyleSheet.create({
  container: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: 'rgba(0, 0, 0, 0.03)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  highlighted: {
    backgroundColor: 'rgba(0, 188, 212, 0.15)',
    borderWidth: 1,
    borderColor: '#00BCD4',
  },
});

/** Data point for the performance chart - can be an activity or a lap */
interface PerformanceDataPoint {
  /** Unique ID for this data point */
  id: string;
  /** Activity ID this point belongs to */
  activityId: string;
  /** Lap number (1 if single lap per activity) */
  lapNumber: number;
  /** Total laps in this activity */
  totalLaps: number;
  /** Speed in m/s */
  speed: number;
  /** Date of the activity */
  date: Date;
  /** Activity name */
  activityName: string;
  /** Direction (same/reverse) */
  direction: 'same' | 'reverse';
  /** Match percentage (0-100) */
  matchPercentage: number;
  /** Points for this lap (for map highlighting) */
  lapPoints?: RoutePoint[];
}

interface PerformanceChartProps {
  activities: Activity[];
  activityType: ActivityType;
  isDark: boolean;
  matches: Record<string, { matchPercentage?: number; direction?: string }>;
  /** Signatures for getting activity GPS traces */
  signatures: Record<string, { points?: RoutePoint[] }>;
  /** Callback when an activity is selected via scrubbing */
  onActivitySelect?: (activityId: string | null, activityPoints?: RoutePoint[]) => void;
  /** Currently selected/highlighted activity ID */
  selectedActivityId?: string | null;
}

function formatShortDate(date: Date): string {
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// Chart constants
const CHART_HEIGHT = 160;
const MIN_POINT_WIDTH = 40; // Minimum width per data point

function PerformanceProgressionChart({
  activities,
  activityType,
  isDark,
  matches,
  signatures,
  onActivitySelect,
  selectedActivityId,
}: PerformanceChartProps) {
  const showPace = isRunningActivity(activityType);
  const activityColor = getActivityColor(activityType);

  // Tooltip state - persists after scrubbing ends so user can tap
  const [tooltipData, setTooltipData] = useState<PerformanceDataPoint | null>(null);
  const [isActive, setIsActive] = useState(false);
  const [isPersisted, setIsPersisted] = useState(false);

  // Gesture tracking
  const touchX = useSharedValue(-1);
  const chartBoundsShared = useSharedValue({ left: 0, right: 1 });
  const lastNotifiedIdx = useRef<number | null>(null);

  // Prepare chart data - ONE point per activity
  // Direction comes from route matching (whole activity), NOT segment detection
  const { chartData, minSpeed, maxSpeed, bestIndex, hasReverseRuns } = useMemo(() => {
    const dataPoints: (PerformanceDataPoint & { x: number })[] = [];

    // Sort activities by date first
    const sortedActivities = [...activities].sort(
      (a, b) => new Date(a.start_date_local).getTime() - new Date(b.start_date_local).getTime()
    );

    let hasAnyReverse = false;

    for (const activity of sortedActivities) {
      const activityPoints = signatures[activity.id]?.points;
      const match = matches[activity.id];
      // Direction comes from route matching algorithm - the WHOLE activity direction
      const direction = (match?.direction as 'same' | 'reverse') ?? 'same';
      const matchPercentage = match?.matchPercentage ?? 100;

      if (direction === 'reverse') hasAnyReverse = true;

      // Calculate activity speed (with safety check for division by zero)
      const activitySpeed = activity.moving_time > 0
        ? activity.distance / activity.moving_time
        : 0;

      // Each activity = ONE data point
      // No lap/segment detection - the route is a complete journey
      dataPoints.push({
        x: 0,
        id: activity.id,
        activityId: activity.id,
        lapNumber: 1,
        totalLaps: 1,
        speed: activitySpeed,
        date: new Date(activity.start_date_local),
        activityName: activity.name,
        direction,
        matchPercentage,
        lapPoints: activityPoints, // Full activity trace for map highlighting
      });
    }

    // Re-index after collecting all points
    const indexed = dataPoints.map((d, idx) => ({ ...d, x: idx }));

    const speeds = indexed.map(d => d.speed);
    const min = speeds.length > 0 ? Math.min(...speeds) : 0;
    const max = speeds.length > 0 ? Math.max(...speeds) : 1;
    const padding = (max - min) * 0.15 || 0.5;

    // Find best (fastest)
    let bestIdx = 0;
    for (let i = 1; i < indexed.length; i++) {
      if (indexed[i].speed > indexed[bestIdx].speed) {
        bestIdx = i;
      }
    }

    return {
      chartData: indexed,
      minSpeed: Math.max(0, min - padding),
      maxSpeed: max + padding,
      bestIndex: bestIdx,
      hasReverseRuns: hasAnyReverse,
    };
  }, [activities, matches, signatures]);

  // Calculate chart width based on number of points (for scrolling)
  const chartWidth = useMemo(() => {
    const screenWidth = SCREEN_WIDTH - 32; // Account for padding
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
    // Gesture ended - persist the current tooltip for tapping
    if (gestureEnded) {
      if (tooltipData) {
        setIsActive(false);
        setIsPersisted(true);
        // Notify parent of final selection
        if (onActivitySelect && tooltipData) {
          onActivitySelect(tooltipData.id, tooltipData.lapPoints);
        }
      }
      lastNotifiedIdx.current = null;
      return;
    }

    // Invalid index during active gesture - ignore (don't clear)
    if (idx < 0 || chartData.length === 0) {
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

    const point = chartData[idx];
    if (point) {
      setTooltipData(point);
      // Notify parent for map highlighting
      if (onActivitySelect) {
        onActivitySelect(point.id, point.lapPoints);
      }
    }
  }, [chartData, isActive, isPersisted, tooltipData, onActivitySelect]);

  // Handle gesture end - persist tooltip
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

  // Clear persisted tooltip
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
  // Quick swipes pass through to ScrollView for horizontal scrolling
  const panGesture = Gesture.Pan()
    .activateAfterLongPress(300) // Only activate after 300ms hold
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

  // Animated crosshair - calculate position from selected index
  const crosshairStyle = useAnimatedStyle(() => {
    'worklet';
    const idx = selectedIdx.value;
    const bounds = chartBoundsShared.value;
    const len = chartData.length;

    if (idx < 0 || len === 0) {
      return { opacity: 0, transform: [{ translateX: 0 }] };
    }

    // Calculate x position from index
    const chartWidthPx = bounds.right - bounds.left;
    const xPos = bounds.left + (idx / (len - 1)) * chartWidthPx;

    return {
      opacity: 1,
      transform: [{ translateX: xPos }],
    };
  }, [chartData.length]);

  if (chartData.length < 2) return null;

  // Get point color based on direction
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
            // Sync chartBounds for gesture handling
            if (chartBounds.left !== chartBoundsShared.value.left ||
                chartBounds.right !== chartBoundsShared.value.right) {
              chartBoundsShared.value = { left: chartBounds.left, right: chartBounds.right };
            }

            // Separate points by direction for distinct lines
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
                {/* Regular points - colored by direction */}
                {points.speed.map((point, idx) => {
                  if (point.x == null || point.y == null) return null;
                  const isSelected = idx === selectedIndex;
                  const isBest = idx === bestIndex;
                  // Skip if selected or best (render separately for layering)
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
                {/* Best performance - gold (render after regular) */}
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
                {/* Selected activity - cyan (render on top) */}
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
          Performance Over Time
        </Text>
        <View style={styles.chartLegend}>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: '#FFB300' }]} />
            <Text style={[styles.legendText, isDark && styles.textMuted]}>Best</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: activityColor }]} />
            <Text style={[styles.legendText, isDark && styles.textMuted]}>Same</Text>
          </View>
          {hasReverseRuns && (
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: REVERSE_COLOR }]} />
              <Text style={[styles.legendText, isDark && styles.textMuted]}>Reverse</Text>
            </View>
          )}
        </View>
      </View>

      {/* Hint for interaction */}
      {!isActive && !isPersisted && (
        <Text style={[styles.chartHint, isDark && styles.textMuted]}>
          {needsScrolling ? 'Swipe to scroll • Hold to scrub' : 'Hold to scrub through activities'}
        </Text>
      )}

      {/* Selected activity info - tappable */}
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
              <View style={[styles.matchBadgeSmall, { backgroundColor: colors.success + '20' }]}>
                <Text style={[styles.matchBadgeText, { color: colors.success }]}>
                  {Math.round(tooltipData.matchPercentage)}%
                </Text>
              </View>
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
              Best {showPace ? 'pace' : 'speed'}
            </Text>
          </View>
          <View style={styles.bestStatItem}>
            <Text style={[styles.bestStatValue, isDark && styles.textLight]}>
              {formatShortDate(chartData[bestIndex].date)}
            </Text>
            <Text style={[styles.bestStatLabel, isDark && styles.textMuted]}>
              Date
            </Text>
          </View>
        </View>
      )}
    </View>
  );
}

function ActivityRow({
  activity,
  isDark,
  matchPercentage,
  direction,
  activityPoints,
  routePoints,
  isHighlighted,
  overlapDistance,
  routeDistance,
}: ActivityRowProps) {
  const handlePress = () => {
    router.push(`/activity/${activity.id}`);
  };

  // Determine trace color based on direction
  const isReverse = direction === 'reverse';
  // Activity trace: cyan for highlighted, purple for reverse, blue for same
  const traceColor = isHighlighted ? '#00BCD4' : (isReverse ? REVERSE_COLOR : '#2196F3');
  const badgeColor = isReverse ? REVERSE_COLOR : colors.success;

  // Format overlap distance for display (e.g., "200m / 1.0km")
  const overlapDisplay = useMemo(() => {
    if (!overlapDistance || !routeDistance) return null;
    const overlapKm = overlapDistance / 1000;
    const routeKm = routeDistance / 1000;
    // Show in meters if < 1km, otherwise km
    const overlapStr = overlapKm < 1
      ? `${Math.round(overlapDistance)}m`
      : `${overlapKm.toFixed(1)}km`;
    const routeStr = routeKm < 1
      ? `${Math.round(routeDistance)}m`
      : `${routeKm.toFixed(1)}km`;
    return `${overlapStr} / ${routeStr}`;
  }, [overlapDistance, routeDistance]);

  return (
    <Pressable
      onPress={handlePress}
      style={({ pressed }) => [
        styles.activityRow,
        isDark && styles.activityRowDark,
        isHighlighted && styles.activityRowHighlighted,
        pressed && styles.activityRowPressed,
      ]}
    >
      {/* Mini route trace showing route reference (orange) vs activity trace */}
      {activityPoints && activityPoints.length > 1 ? (
        <MiniRouteTrace
          activityPoints={activityPoints}
          routePoints={routePoints}
          activityColor={traceColor}
          routeColor={CONSENSUS_COLOR}
          isHighlighted={isHighlighted}
        />
      ) : (
        <View style={[styles.activityIcon, { backgroundColor: traceColor + '20' }]}>
          <MaterialCommunityIcons
            name={getActivityIcon(activity.type)}
            size={18}
            color={traceColor}
          />
        </View>
      )}
      <View style={styles.activityInfo}>
        <View style={styles.activityNameRow}>
          <Text style={[styles.activityName, isDark && styles.textLight]} numberOfLines={1}>
            {activity.name}
          </Text>
          {/* Match percentage badge with direction-based color */}
          {matchPercentage !== undefined && (
            <View style={[styles.matchBadge, { backgroundColor: badgeColor + '15' }]}>
              <Text style={[styles.matchText, { color: badgeColor }]}>
                {Math.round(matchPercentage)}%
              </Text>
              {isReverse && (
                <MaterialCommunityIcons name="swap-horizontal" size={10} color={badgeColor} />
              )}
            </View>
          )}
        </View>
        <View style={styles.activityMetaRow}>
          <Text style={[styles.activityDate, isDark && styles.textMuted]}>
            {formatRelativeDate(activity.start_date_local)}
          </Text>
          {/* Overlap distance indicator - shows matched section vs route distance */}
          {overlapDisplay && (
            <Text style={[styles.overlapText, isDark && styles.textMuted]}>
              {overlapDisplay}
            </Text>
          )}
        </View>
      </View>
      <View style={styles.activityStats}>
        <Text style={[styles.activityDistance, isDark && styles.textLight]}>
          {formatDistance(activity.distance)}
        </Text>
        <Text style={[styles.activityTime, isDark && styles.textMuted]}>
          {formatDuration(activity.moving_time)}
        </Text>
      </View>
      <MaterialCommunityIcons
        name="chevron-right"
        size={20}
        color={isDark ? '#555' : '#CCC'}
      />
    </Pressable>
  );
}

export default function RouteDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const insets = useSafeAreaInsets();

  // State for highlighted activity
  const [highlightedActivityId, setHighlightedActivityId] = useState<string | null>(null);
  const [highlightedActivityPoints, setHighlightedActivityPoints] = useState<RoutePoint[] | undefined>(undefined);

  // State for route renaming
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [customName, setCustomName] = useState<string | null>(null);
  const nameInputRef = useRef<TextInput>(null);

  // Load custom route names on mount
  useEffect(() => {
    loadCustomRouteNames().then((names) => {
      if (id && names[id]) {
        setCustomName(names[id]);
      }
    });
  }, [id]);

  // Handle activity selection from chart scrubbing
  const handleActivitySelect = useCallback((activityId: string | null, activityPoints?: RoutePoint[]) => {
    setHighlightedActivityId(activityId);
    setHighlightedActivityPoints(activityPoints);
  }, []);

  // Handle starting to edit the route name
  const handleStartEditing = useCallback(() => {
    const currentName = customName || routeGroup?.name || '';
    setEditName(currentName);
    setIsEditing(true);
    // Focus input after a short delay to ensure it's rendered
    setTimeout(() => {
      nameInputRef.current?.focus();
    }, 100);
  }, [customName, routeGroup?.name]);

  // Handle saving the edited route name
  const handleSaveName = useCallback(async () => {
    const trimmedName = editName.trim();
    if (trimmedName && id) {
      await saveCustomRouteName(id, trimmedName);
      setCustomName(trimmedName);
    }
    setIsEditing(false);
    Keyboard.dismiss();
  }, [editName, id]);

  // Handle canceling the edit
  const handleCancelEdit = useCallback(() => {
    setIsEditing(false);
    setEditName('');
    Keyboard.dismiss();
  }, []);

  const routeGroup = useRouteMatchStore((s) =>
    s.cache?.groups.find((g) => g.id === id) || null
  );

  // Get match data for all activities in this route
  const matches = useRouteMatchStore((s) => s.cache?.matches || {});

  // Get signatures for route points
  const signatures = useRouteMatchStore((s) => s.cache?.signatures || {});

  // Fetch activities for this route
  // Extend date range by 1 day on each side to handle timezone edge cases
  // and ensure we capture all activities in the group
  const { oldest, newest } = React.useMemo(() => {
    if (!routeGroup) return { oldest: undefined, newest: undefined };

    // Parse first date and go back 1 day
    const firstDate = new Date(routeGroup.firstDate);
    firstDate.setDate(firstDate.getDate() - 1);

    // Parse last date and go forward 1 day
    const lastDate = new Date(routeGroup.lastDate);
    lastDate.setDate(lastDate.getDate() + 1);

    // Format as YYYY-MM-DD
    const formatDate = (d: Date) => d.toISOString().split('T')[0];

    return {
      oldest: formatDate(firstDate),
      newest: formatDate(lastDate),
    };
  }, [routeGroup?.firstDate, routeGroup?.lastDate]);

  const { data: allActivities, isLoading } = useActivities({
    oldest,
    newest,
    includeStats: false,
  });

  // Filter to only activities in this route group (deduplicated)
  const routeActivities = React.useMemo(() => {
    if (!routeGroup || !allActivities) return [];
    const idsSet = new Set(routeGroup.activityIds);
    // Filter and deduplicate by ID (in case API returns duplicates)
    const seen = new Set<string>();
    return allActivities.filter((a) => {
      if (!idsSet.has(a.id) || seen.has(a.id)) return false;
      seen.add(a.id);
      return true;
    });
  }, [routeGroup, allActivities]);

  if (!routeGroup) {
    return (
      <View style={[styles.container, isDark && styles.containerDark]}>
        <View style={[styles.floatingHeader, { paddingTop: insets.top }]}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => router.back()}
            activeOpacity={0.7}
          >
            <MaterialCommunityIcons name="arrow-left" size={24} color={isDark ? '#FFFFFF' : colors.textPrimary} />
          </TouchableOpacity>
        </View>
        <View style={styles.emptyContainer}>
          <MaterialCommunityIcons
            name="map-marker-question-outline"
            size={48}
            color={isDark ? '#444' : '#CCC'}
          />
          <Text style={[styles.emptyText, isDark && styles.textLight]}>
            Route not found
          </Text>
        </View>
      </View>
    );
  }

  const activityColor = getActivityColor(routeGroup.type);
  const iconName = getActivityIcon(routeGroup.type);
  const hasMapData = routeGroup.signature?.points && routeGroup.signature.points.length > 1;

  return (
    <View style={[styles.container, isDark && styles.containerDark]}>
      <StatusBar barStyle="light-content" />
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Hero Map Section */}
        <View style={styles.heroSection}>
          {/* Map - full bleed */}
          <View style={styles.mapContainer}>
            {hasMapData ? (
              <RouteMapView
                routeGroup={routeGroup}
                height={MAP_HEIGHT}
                interactive={false}
                highlightedActivityId={highlightedActivityId}
                highlightedLapPoints={highlightedActivityPoints}
                enableFullscreen={true}
              />
            ) : (
              <View style={[styles.mapPlaceholder, { height: MAP_HEIGHT, backgroundColor: activityColor + '20' }]}>
                <MaterialCommunityIcons name="map-marker-path" size={48} color={activityColor} />
              </View>
            )}
          </View>

          {/* Gradient overlay at bottom */}
          <LinearGradient
            colors={['transparent', 'rgba(0,0,0,0.7)']}
            style={styles.mapGradient}
            pointerEvents="none"
          />

          {/* Floating header - just back button */}
          <View style={[styles.floatingHeader, { paddingTop: insets.top }]}>
            <TouchableOpacity
              style={styles.backButton}
              onPress={() => router.back()}
              activeOpacity={0.7}
            >
              <MaterialCommunityIcons name="arrow-left" size={24} color="#FFFFFF" />
            </TouchableOpacity>
          </View>

          {/* Route info overlay at bottom */}
          <View style={styles.infoOverlay}>
            <View style={styles.routeNameRow}>
              <View style={[styles.typeIcon, { backgroundColor: activityColor }]}>
                <MaterialCommunityIcons name={iconName} size={16} color="#FFFFFF" />
              </View>
              {isEditing ? (
                <View style={styles.editNameContainer}>
                  <TextInput
                    ref={nameInputRef}
                    style={styles.editNameInput}
                    value={editName}
                    onChangeText={setEditName}
                    onSubmitEditing={handleSaveName}
                    onBlur={handleCancelEdit}
                    placeholder="Route name"
                    placeholderTextColor="rgba(255,255,255,0.5)"
                    returnKeyType="done"
                    autoFocus
                    selectTextOnFocus
                  />
                  <TouchableOpacity onPress={handleSaveName} style={styles.editNameButton}>
                    <MaterialCommunityIcons name="check" size={20} color="#4CAF50" />
                  </TouchableOpacity>
                  <TouchableOpacity onPress={handleCancelEdit} style={styles.editNameButton}>
                    <MaterialCommunityIcons name="close" size={20} color="#FF5252" />
                  </TouchableOpacity>
                </View>
              ) : (
                <TouchableOpacity onPress={handleStartEditing} style={styles.nameEditTouchable} activeOpacity={0.7}>
                  <Text style={styles.heroRouteName} numberOfLines={1}>
                    {customName || routeGroup.name}
                  </Text>
                  <MaterialCommunityIcons name="pencil" size={14} color="rgba(255,255,255,0.6)" style={styles.editIcon} />
                </TouchableOpacity>
              )}
            </View>

            {/* Stats row */}
            <View style={styles.heroStatsRow}>
              <Text style={styles.heroStat}>{formatDistance(routeGroup.signature.distance)}</Text>
              <Text style={styles.heroStatDivider}>·</Text>
              <Text style={styles.heroStat}>{routeGroup.activityCount} activities</Text>
              <Text style={styles.heroStatDivider}>·</Text>
              <Text style={styles.heroStat}>{formatRelativeDate(routeGroup.lastDate)}</Text>
            </View>
          </View>
        </View>

        {/* Content below hero */}
        <View style={styles.contentSection}>
          {/* Performance progression chart - scrubbing highlights map with lap-level granularity */}
          {routeActivities.length >= 2 && (
            <View style={styles.chartSection}>
              <PerformanceProgressionChart
                activities={routeActivities}
                activityType={routeGroup.type}
                isDark={isDark}
                matches={matches}
                signatures={signatures}
                onActivitySelect={handleActivitySelect}
                selectedActivityId={highlightedActivityId}
              />
            </View>
          )}

          {/* Activities list */}
          <View style={styles.activitiesSection}>
          <Text style={[styles.sectionTitle, isDark && styles.textLight]}>
            Activities
          </Text>

          {isLoading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="small" color={colors.primary} />
            </View>
          ) : routeActivities.length === 0 ? (
            <Text style={[styles.emptyActivities, isDark && styles.textMuted]}>
              No activities found
            </Text>
          ) : (
            <View style={[styles.activitiesCard, isDark && styles.activitiesCardDark]}>
              {routeActivities.map((activity, index) => {
                const match = matches[activity.id];
                // Representative activity doesn't have a match entry, show 100%
                const isRepresentative = routeGroup?.activityIds[0] === activity.id;
                const matchPercentage = match?.matchPercentage ?? (isRepresentative ? 100 : undefined);
                const direction = match?.direction ?? (isRepresentative ? 'same' : undefined);
                // Get overlap distance - for representative, use route distance
                const overlapDistance = match?.overlapDistance ?? (isRepresentative ? routeGroup?.signature?.distance : undefined);
                const routeDistance = routeGroup?.signature?.distance;
                // Get route points from signature for this activity
                const activityPoints = signatures[activity.id]?.points;
                // Get representative route points (full route, not truncated consensus)
                const routePoints = routeGroup?.signature?.points;
                const isHighlighted = highlightedActivityId === activity.id;
                return (
                  <React.Fragment key={activity.id}>
                    <Pressable
                      onPressIn={() => setHighlightedActivityId(activity.id)}
                      onPressOut={() => setHighlightedActivityId(null)}
                    >
                      <ActivityRow
                        activity={activity}
                        isDark={isDark}
                        matchPercentage={matchPercentage}
                        direction={direction}
                        activityPoints={activityPoints}
                        routePoints={routePoints}
                        isHighlighted={isHighlighted}
                        overlapDistance={overlapDistance}
                        routeDistance={routeDistance}
                      />
                    </Pressable>
                    {index < routeActivities.length - 1 && (
                      <View style={[styles.divider, isDark && styles.dividerDark]} />
                    )}
                  </React.Fragment>
                );
              })}
            </View>
          )}
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  containerDark: {
    backgroundColor: '#121212',
  },
  textLight: {
    color: '#FFFFFF',
  },
  textMuted: {
    color: '#888',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: spacing.xl,
  },
  // Hero section styles
  heroSection: {
    height: MAP_HEIGHT,
    position: 'relative',
  },
  mapContainer: {
    flex: 1,
  },
  mapPlaceholder: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  mapGradient: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 120,
  },
  floatingHeader: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingBottom: spacing.sm,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  infoOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
  },
  routeNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  typeIcon: {
    width: 28,
    height: 28,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  heroRouteName: {
    flex: 1,
    fontSize: 20,
    fontWeight: '700',
    color: '#FFFFFF',
    textShadowColor: 'rgba(0, 0, 0, 0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  nameEditTouchable: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  editIcon: {
    marginLeft: 4,
  },
  editNameContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    borderRadius: 8,
    paddingHorizontal: spacing.sm,
    gap: spacing.xs,
  },
  editNameInput: {
    flex: 1,
    fontSize: 18,
    fontWeight: '600',
    color: '#FFFFFF',
    paddingVertical: 8,
  },
  editNameButton: {
    padding: 6,
    borderRadius: 6,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
  },
  heroStatsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
    flexWrap: 'wrap',
  },
  heroStat: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.9)',
    textShadowColor: 'rgba(0, 0, 0, 0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  heroStatDivider: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.5)',
    marginHorizontal: spacing.xs,
  },
  // Content section below hero
  contentSection: {
    padding: layout.screenPadding,
    paddingTop: spacing.lg,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 16,
    color: colors.textPrimary,
    marginTop: spacing.md,
  },
  chartSection: {
    marginBottom: spacing.lg,
  },
  chartCard: {
    backgroundColor: colors.surface,
    borderRadius: layout.borderRadius,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  chartCardDark: {
    backgroundColor: '#1E1E1E',
  },
  chartHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.xs,
  },
  chartTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  chartLegend: {
    flexDirection: 'row',
    gap: spacing.md,
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
  chartHint: {
    fontSize: 11,
    color: colors.textSecondary,
    textAlign: 'center',
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.xs,
  },
  chartContainer: {
    height: CHART_HEIGHT,
    position: 'relative',
    overflow: 'hidden',
  },
  chartInner: {
    height: CHART_HEIGHT,
    position: 'relative',
    overflow: 'hidden',
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
  selectedTooltip: {
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
  selectedTooltipDark: {
    backgroundColor: 'rgba(0, 188, 212, 0.12)',
    borderColor: 'rgba(0, 188, 212, 0.3)',
  },
  tooltipLeft: {
    flex: 1,
  },
  tooltipName: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  tooltipMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: 2,
  },
  tooltipDate: {
    fontSize: 11,
    color: colors.textSecondary,
  },
  reverseBadge: {
    backgroundColor: 'rgba(156, 39, 176, 0.15)',
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 4,
  },
  matchBadgeSmall: {
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 6,
  },
  matchBadgeText: {
    fontSize: 10,
    fontWeight: '600',
  },
  tooltipRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  tooltipSpeed: {
    fontSize: 15,
    fontWeight: '700',
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
  bestStats: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: 'rgba(0, 0, 0, 0.05)',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    gap: spacing.lg,
  },
  bestStatsDark: {
    borderTopColor: 'rgba(255, 255, 255, 0.08)',
  },
  bestStatItem: {
    flex: 1,
  },
  bestStatValue: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  bestStatLabel: {
    fontSize: 11,
    color: colors.textSecondary,
    marginTop: 2,
  },
  activitiesSection: {
    marginBottom: spacing.xl,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textPrimary,
    marginBottom: spacing.sm,
  },
  loadingContainer: {
    padding: spacing.xl,
    alignItems: 'center',
  },
  emptyActivities: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
    paddingVertical: spacing.lg,
  },
  activitiesCard: {
    backgroundColor: colors.surface,
    borderRadius: layout.borderRadius,
    overflow: 'hidden',
  },
  activitiesCardDark: {
    backgroundColor: '#1E1E1E',
  },
  activityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    gap: spacing.md,
  },
  activityRowDark: {},
  activityRowHighlighted: {
    backgroundColor: 'rgba(0, 188, 212, 0.1)',
  },
  activityRowPressed: {
    opacity: 0.7,
  },
  activityIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  activityInfo: {
    flex: 1,
  },
  activityNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  activityName: {
    fontSize: 15,
    fontWeight: '500',
    color: colors.textPrimary,
    flex: 1,
  },
  matchBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
    gap: 2,
  },
  matchText: {
    fontSize: 11,
    fontWeight: '600',
  },
  activityDate: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  activityMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 1,
  },
  overlapText: {
    fontSize: 11,
    color: colors.textSecondary,
    opacity: 0.7,
  },
  activityStats: {
    alignItems: 'flex-end',
  },
  activityDistance: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  activityTime: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  divider: {
    height: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.05)',
    marginLeft: 36 + spacing.md + spacing.md,
  },
  dividerDark: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },
});

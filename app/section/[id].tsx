/**
 * Section detail page.
 * Shows a frequently-traveled section with all activities that traverse it.
 */

import React, { useMemo, useCallback, useState, useEffect, useRef } from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  useColorScheme,
  Pressable,
  Dimensions,
  StatusBar,
  TouchableOpacity,
} from 'react-native';
import { Text, ActivityIndicator } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, router, Href } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { CartesianChart, Line } from 'victory-native';
import { Circle } from '@shopify/react-native-skia';
import Svg, { Polyline } from 'react-native-svg';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import {
  useSharedValue,
  useDerivedValue,
  useAnimatedStyle,
  useAnimatedReaction,
  runOnJS,
} from 'react-native-reanimated';
import Animated from 'react-native-reanimated';
import { useRouteMatchStore } from '@/providers';
import { useActivities } from '@/hooks';
import { SectionMapView } from '@/components/routes';
import {
  formatDistance,
  formatRelativeDate,
  getActivityIcon,
  getActivityColor,
  formatDuration,
  formatSpeed,
  formatPace,
  isRunningActivity,
} from '@/lib';
import { colors, darkColors, spacing, layout, typography, opacity } from '@/theme';
import type { Activity, ActivityType, RoutePoint, FrequentSection } from '@/types';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const MAP_HEIGHT = Math.round(SCREEN_HEIGHT * 0.45);

// Colors for direction
const REVERSE_COLOR = '#9C27B0';
const SAME_COLOR_DEFAULT = '#4CAF50';

interface ActivityRowProps {
  activity: Activity;
  isDark: boolean;
  direction?: string;
  /** Activity's trace points for the section */
  activityPoints?: RoutePoint[];
  /** Section polyline for reference */
  sectionPoints?: RoutePoint[];
  isHighlighted?: boolean;
  /** Distance of this activity's section traversal */
  sectionDistance?: number;
}

/** Mini trace component showing activity path over section */
function MiniSectionTrace({
  activityPoints,
  sectionPoints,
  activityColor,
  sectionColor,
  isHighlighted,
}: {
  activityPoints: RoutePoint[];
  sectionPoints?: RoutePoint[];
  activityColor: string;
  sectionColor: string;
  isHighlighted?: boolean;
}) {
  if (activityPoints.length < 2) return null;

  const width = 36;
  const height = 36;
  const padding = 3;

  const allPoints = sectionPoints && sectionPoints.length > 0
    ? [...activityPoints, ...sectionPoints]
    : activityPoints;

  const lats = allPoints.map(p => p.lat);
  const lngs = allPoints.map(p => p.lng);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);

  const latRange = maxLat - minLat || 1;
  const lngRange = maxLng - minLng || 1;

  const scalePoints = (points: RoutePoint[]) =>
    points.map(p => ({
      x: ((p.lng - minLng) / lngRange) * (width - padding * 2) + padding,
      y: (1 - (p.lat - minLat) / latRange) * (height - padding * 2) + padding,
    }));

  const activityScaled = scalePoints(activityPoints);
  const activityString = activityScaled.map(p => `${p.x},${p.y}`).join(' ');

  const sectionScaled = sectionPoints && sectionPoints.length > 1
    ? scalePoints(sectionPoints)
    : null;
  const sectionString = sectionScaled
    ? sectionScaled.map(p => `${p.x},${p.y}`).join(' ')
    : null;

  return (
    <View style={[
      miniTraceStyles.container,
      isHighlighted && miniTraceStyles.highlighted,
    ]}>
      <Svg width={width} height={height}>
        {/* Section reference underneath */}
        {sectionString && (
          <Polyline
            points={sectionString}
            fill="none"
            stroke={sectionColor}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity={isHighlighted ? 0.3 : 0.2}
          />
        )}
        {/* Activity trace on top */}
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

/** Chart data point */
interface PerformanceDataPoint {
  id: string;
  activityId: string;
  speed: number;
  date: Date;
  activityName: string;
  direction: 'same' | 'reverse';
  lapPoints?: RoutePoint[];
}

const CHART_HEIGHT = 160;
const MIN_POINT_WIDTH = 40;

function formatShortDate(date: Date): string {
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

interface PerformanceChartProps {
  activities: Activity[];
  section: FrequentSection;
  activityType: ActivityType;
  isDark: boolean;
  onActivitySelect?: (activityId: string | null, activityPoints?: RoutePoint[]) => void;
  selectedActivityId?: string | null;
}

function SectionPerformanceChart({
  activities,
  section,
  activityType,
  isDark,
  onActivitySelect,
  selectedActivityId,
}: PerformanceChartProps) {
  const showPace = isRunningActivity(activityType);
  const activityColor = getActivityColor(activityType);

  const [tooltipData, setTooltipData] = useState<PerformanceDataPoint | null>(null);
  const [isActive, setIsActive] = useState(false);
  const [isPersisted, setIsPersisted] = useState(false);

  const touchX = useSharedValue(-1);
  const chartBoundsShared = useSharedValue({ left: 0, right: 1 });
  const lastNotifiedIdx = useRef<number | null>(null);

  // Prepare chart data - use section portion data for speed calculation
  const { chartData, minSpeed, maxSpeed, bestIndex, hasReverseRuns } = useMemo(() => {
    const dataPoints: (PerformanceDataPoint & { x: number })[] = [];

    // Map activity portions for quick lookup
    const portionMap = new Map(
      section.activityPortions?.map(p => [p.activityId, p]) || []
    );

    // Sort activities by date
    const sortedActivities = [...activities].sort(
      (a, b) => new Date(a.start_date_local).getTime() - new Date(b.start_date_local).getTime()
    );

    let hasAnyReverse = false;

    for (const activity of sortedActivities) {
      const portion = portionMap.get(activity.id);
      const tracePoints = section.activityTraces?.[activity.id];

      // Use section portion distance and calculate speed from that
      const sectionDistance = portion?.distanceMeters || section.distanceMeters;
      const direction = (portion?.direction as 'same' | 'reverse') || 'same';

      if (direction === 'reverse') hasAnyReverse = true;

      // Estimate speed for this section (assuming proportional time)
      // Full activity speed as approximation
      const activitySpeed = activity.moving_time > 0
        ? activity.distance / activity.moving_time
        : 0;

      dataPoints.push({
        x: 0,
        id: activity.id,
        activityId: activity.id,
        speed: activitySpeed,
        date: new Date(activity.start_date_local),
        activityName: activity.name,
        direction,
        lapPoints: tracePoints,
      });
    }

    const indexed = dataPoints.map((d, idx) => ({ ...d, x: idx }));

    const speeds = indexed.map(d => d.speed);
    const min = speeds.length > 0 ? Math.min(...speeds) : 0;
    const max = speeds.length > 0 ? Math.max(...speeds) : 1;
    const padding = (max - min) * 0.15 || 0.5;

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
  }, [activities, section]);

  const chartWidth = useMemo(() => {
    const screenWidth = SCREEN_WIDTH - 32;
    const dataWidth = chartData.length * MIN_POINT_WIDTH;
    return Math.max(screenWidth, dataWidth);
  }, [chartData.length]);

  const needsScrolling = chartWidth > SCREEN_WIDTH - 32;

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

  const tapGesture = Gesture.Tap()
    .onEnd(() => {
      'worklet';
      runOnJS(clearPersistedTooltip)();
    });

  const gesture = Gesture.Race(panGesture, tapGesture);

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
                {samePoints.length > 1 && (
                  <Line
                    points={samePoints}
                    color={activityColor}
                    strokeWidth={1.5}
                    curveType="monotoneX"
                    opacity={0.4}
                  />
                )}
                {reversePoints.length > 1 && (
                  <Line
                    points={reversePoints}
                    color={REVERSE_COLOR}
                    strokeWidth={1.5}
                    curveType="monotoneX"
                    opacity={0.4}
                  />
                )}
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

        <Animated.View
          style={[styles.crosshair, crosshairStyle, isDark && styles.crosshairDark]}
          pointerEvents="none"
        />

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

      {!isActive && !isPersisted && (
        <Text style={[styles.chartHint, isDark && styles.textMuted]}>
          {needsScrolling ? 'Swipe to scroll • Hold to scrub' : 'Hold to scrub through activities'}
        </Text>
      )}

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
  direction,
  activityPoints,
  sectionPoints,
  isHighlighted,
  sectionDistance,
}: ActivityRowProps) {
  const handlePress = () => {
    router.push(`/activity/${activity.id}`);
  };

  const isReverse = direction === 'reverse';
  const traceColor = isHighlighted ? '#00BCD4' : (isReverse ? REVERSE_COLOR : '#2196F3');
  const activityColor = getActivityColor(activity.type);

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
      {activityPoints && activityPoints.length > 1 ? (
        <MiniSectionTrace
          activityPoints={activityPoints}
          sectionPoints={sectionPoints}
          activityColor={traceColor}
          sectionColor={activityColor}
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
          {isReverse && (
            <View style={[styles.directionBadge, { backgroundColor: REVERSE_COLOR + '15' }]}>
              <MaterialCommunityIcons name="swap-horizontal" size={10} color={REVERSE_COLOR} />
            </View>
          )}
        </View>
        <Text style={[styles.activityDate, isDark && styles.textMuted]}>
          {formatRelativeDate(activity.start_date_local)}
        </Text>
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

export default function SectionDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const insets = useSafeAreaInsets();

  const [highlightedActivityId, setHighlightedActivityId] = useState<string | null>(null);
  const [highlightedActivityPoints, setHighlightedActivityPoints] = useState<RoutePoint[] | undefined>(undefined);

  const handleActivitySelect = useCallback((activityId: string | null, activityPoints?: RoutePoint[]) => {
    setHighlightedActivityId(activityId);
    setHighlightedActivityPoints(activityPoints);
  }, []);

  // Get section from cache
  const section = useRouteMatchStore((s) =>
    s.cache?.frequentSections?.find((sec) => sec.id === id) || null
  );

  // Get date range for fetching activities
  const { oldest, newest } = useMemo(() => {
    if (!section?.activityIds.length) return { oldest: undefined, newest: undefined };
    // We need to load all activities in the section
    // Use a wide date range since we'll filter by IDs
    return {
      oldest: '2020-01-01',
      newest: new Date().toISOString().split('T')[0],
    };
  }, [section?.activityIds]);

  const { data: allActivities, isLoading } = useActivities({
    oldest,
    newest,
    includeStats: false,
  });

  // Filter to only activities in this section
  const sectionActivities = useMemo(() => {
    if (!section || !allActivities) return [];
    const idsSet = new Set(section.activityIds);
    const seen = new Set<string>();
    return allActivities.filter((a) => {
      if (!idsSet.has(a.id) || seen.has(a.id)) return false;
      seen.add(a.id);
      return true;
    });
  }, [section, allActivities]);

  // Map of activity portions for direction lookup
  const portionMap = useMemo(() => {
    if (!section?.activityPortions) return new Map();
    return new Map(section.activityPortions.map(p => [p.activityId, p]));
  }, [section?.activityPortions]);

  if (!section) {
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
            Section not found
          </Text>
        </View>
      </View>
    );
  }

  const activityColor = getActivityColor(section.sportType as ActivityType);
  const iconName = getActivityIcon(section.sportType as ActivityType);

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
          <View style={styles.mapContainer}>
            <SectionMapView
              section={section}
              height={MAP_HEIGHT}
              interactive={false}
              enableFullscreen={true}
            />
          </View>

          <LinearGradient
            colors={['transparent', 'rgba(0,0,0,0.7)']}
            style={styles.mapGradient}
            pointerEvents="none"
          />

          <View style={[styles.floatingHeader, { paddingTop: insets.top }]}>
            <TouchableOpacity
              style={styles.backButton}
              onPress={() => router.back()}
              activeOpacity={0.7}
            >
              <MaterialCommunityIcons name="arrow-left" size={24} color="#FFFFFF" />
            </TouchableOpacity>
          </View>

          <View style={styles.infoOverlay}>
            <View style={styles.sectionNameRow}>
              <View style={[styles.typeIcon, { backgroundColor: activityColor }]}>
                <MaterialCommunityIcons name={iconName} size={16} color="#FFFFFF" />
              </View>
              <Text style={styles.heroSectionName} numberOfLines={1}>
                {section.name || `Section ${section.id.split('_').pop()}`}
              </Text>
            </View>

            <View style={styles.heroStatsRow}>
              <Text style={styles.heroStat}>{formatDistance(section.distanceMeters)}</Text>
              <Text style={styles.heroStatDivider}>·</Text>
              <Text style={styles.heroStat}>{section.visitCount} traversals</Text>
              <Text style={styles.heroStatDivider}>·</Text>
              <Text style={styles.heroStat}>{section.routeIds.length} routes</Text>
            </View>
          </View>
        </View>

        {/* Content below hero */}
        <View style={styles.contentSection}>
          {/* Performance chart */}
          {sectionActivities.length >= 2 && (
            <View style={styles.chartSection}>
              <SectionPerformanceChart
                activities={sectionActivities}
                section={section}
                activityType={section.sportType as ActivityType}
                isDark={isDark}
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
            ) : sectionActivities.length === 0 ? (
              <Text style={[styles.emptyActivities, isDark && styles.textMuted]}>
                No activities found
              </Text>
            ) : (
              <View style={[styles.activitiesCard, isDark && styles.activitiesCardDark]}>
                {sectionActivities.map((activity, index) => {
                  const portion = portionMap.get(activity.id);
                  const tracePoints = section.activityTraces?.[activity.id];
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
                          direction={portion?.direction}
                          activityPoints={tracePoints}
                          sectionPoints={section.polyline}
                          isHighlighted={isHighlighted}
                          sectionDistance={portion?.distanceMeters}
                        />
                      </Pressable>
                      {index < sectionActivities.length - 1 && (
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
    backgroundColor: darkColors.background,
  },
  textLight: {
    color: colors.textOnDark,
  },
  textMuted: {
    color: darkColors.textSecondary,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: spacing.xl,
  },
  heroSection: {
    height: MAP_HEIGHT,
    position: 'relative',
  },
  mapContainer: {
    flex: 1,
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
  sectionNameRow: {
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
  heroSectionName: {
    flex: 1,
    fontSize: typography.statsValue.fontSize,
    fontWeight: '700',
    color: colors.textOnDark,
    textShadowColor: 'rgba(0, 0, 0, 0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  heroStatsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
    flexWrap: 'wrap',
  },
  heroStat: {
    fontSize: typography.bodySmall.fontSize,
    color: 'rgba(255, 255, 255, 0.9)',
    textShadowColor: 'rgba(0, 0, 0, 0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  heroStatDivider: {
    fontSize: typography.bodySmall.fontSize,
    color: 'rgba(255, 255, 255, 0.5)',
    marginHorizontal: spacing.xs,
  },
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
    fontSize: typography.body.fontSize,
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
    shadowRadius: spacing.sm,
    elevation: 2,
  },
  chartCardDark: {
    backgroundColor: darkColors.surface,
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
    fontSize: typography.bodySmall.fontSize,
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
    gap: spacing.xs,
  },
  legendDot: {
    width: spacing.sm,
    height: spacing.sm,
    borderRadius: spacing.xs,
  },
  legendText: {
    fontSize: typography.micro.fontSize,
    color: colors.textSecondary,
  },
  chartHint: {
    fontSize: typography.label.fontSize,
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
    fontSize: typography.bodyCompact.fontSize,
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
    fontSize: typography.label.fontSize,
    color: colors.textSecondary,
  },
  reverseBadge: {
    backgroundColor: 'rgba(156, 39, 176, 0.15)',
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 4,
  },
  tooltipRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  tooltipSpeed: {
    fontSize: typography.bodySmall.fontSize + 1,
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
    fontSize: typography.pillLabel.fontSize,
    color: colors.textSecondary,
  },
  axisLabelDark: {
    color: darkColors.textSecondary,
  },
  bestStats: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: opacity.overlay.light,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    gap: spacing.lg,
  },
  bestStatsDark: {
    borderTopColor: opacity.overlayDark.light,
  },
  bestStatItem: {
    flex: 1,
  },
  bestStatValue: {
    fontSize: typography.bodySmall.fontSize + 1,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  bestStatLabel: {
    fontSize: typography.label.fontSize,
    color: colors.textSecondary,
    marginTop: 2,
  },
  activitiesSection: {
    marginBottom: spacing.xl,
  },
  sectionTitle: {
    fontSize: typography.body.fontSize,
    fontWeight: '600',
    color: colors.textPrimary,
    marginBottom: spacing.sm,
  },
  loadingContainer: {
    padding: spacing.xl,
    alignItems: 'center',
  },
  emptyActivities: {
    fontSize: typography.bodySmall.fontSize,
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
    backgroundColor: darkColors.surface,
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
    fontSize: typography.bodySmall.fontSize + 1,
    fontWeight: '500',
    color: colors.textPrimary,
    flex: 1,
  },
  directionBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: layout.borderRadiusSm,
    gap: 2,
  },
  activityDate: {
    fontSize: typography.caption.fontSize,
    color: colors.textSecondary,
  },
  activityStats: {
    alignItems: 'flex-end',
  },
  activityDistance: {
    fontSize: typography.bodySmall.fontSize,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  activityTime: {
    fontSize: typography.caption.fontSize,
    color: colors.textSecondary,
  },
  divider: {
    height: 1,
    backgroundColor: opacity.overlay.light,
    marginLeft: 36 + spacing.md + spacing.md,
  },
  dividerDark: {
    backgroundColor: opacity.overlayDark.light,
  },
});

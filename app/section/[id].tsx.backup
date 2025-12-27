import React, { useMemo, useCallback, useState, useEffect, useRef } from 'react';
import { View, ScrollView, StyleSheet, useColorScheme, Pressable, Dimensions, StatusBar, TouchableOpacity } from 'react-native';
import { Text, ActivityIndicator } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, router, Href } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import MapLibreGL, { Camera, ShapeSource, LineLayer, MarkerView } from '@maplibre/maplibre-react-native';
import { CartesianChart, Line } from 'victory-native';
import { Circle } from '@shopify/react-native-skia';
import Svg, { Polyline } from 'react-native-svg';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useSharedValue, useDerivedValue, useAnimatedStyle, useAnimatedReaction, runOnJS } from 'react-native-reanimated';
import Animated from 'react-native-reanimated';
import { useRouteMatchStore, useMapPreferences } from '@/providers';
import { useActivities } from '@/hooks';
import {
  formatDistance,
  formatRelativeDate,
  getActivityIcon,
  getActivityColor,
  formatDuration,
  formatSpeed,
  formatPace,
  isRunningActivity,
  getGpsTracks,
} from '@/lib';
import { extractSectionOverlaps, type SectionOverlap } from '@/lib/sectionOverlap';
import { getMapStyle } from '@/components/maps';
import { colors, darkColors, spacing, layout, typography, opacity } from '@/theme';
import type { Activity, FrequentSection, RoutePoint, ActivityType } from '@/types';

const { MapView } = MapLibreGL;
const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const MAP_HEIGHT = Math.round(SCREEN_HEIGHT * 0.45);
const CHART_HEIGHT = 160;
const MIN_POINT_WIDTH = 40;

/** Mini trace component showing activity's path through section */
function MiniSectionTrace({
  overlapPoints,
  sectionPoints,
  activityColor,
  sectionColor,
  isHighlighted,
}: {
  overlapPoints: [number, number][];
  sectionPoints?: RoutePoint[];
  activityColor: string;
  sectionColor: string;
  isHighlighted?: boolean;
}) {
  if (overlapPoints.length < 2) return null;

  const width = 36;
  const height = 36;
  const padding = 3;

  // Combine all points for bounds calculation
  const allLats = [
    ...overlapPoints.map(p => p[0]),
    ...(sectionPoints?.map(p => p.lat) || []),
  ];
  const allLngs = [
    ...overlapPoints.map(p => p[1]),
    ...(sectionPoints?.map(p => p.lng) || []),
  ];

  const minLat = Math.min(...allLats);
  const maxLat = Math.max(...allLats);
  const minLng = Math.min(...allLngs);
  const maxLng = Math.max(...allLngs);

  const latRange = maxLat - minLat || 0.001;
  const lngRange = maxLng - minLng || 0.001;

  const scalePoint = (lat: number, lng: number) => ({
    x: ((lng - minLng) / lngRange) * (width - padding * 2) + padding,
    y: (1 - (lat - minLat) / latRange) * (height - padding * 2) + padding,
  });

  const overlapScaled = overlapPoints.map(([lat, lng]) => scalePoint(lat, lng));
  const overlapString = overlapScaled.map(p => `${p.x},${p.y}`).join(' ');

  const sectionScaled = sectionPoints?.map(p => scalePoint(p.lat, p.lng)) || [];
  const sectionString = sectionScaled.length > 1
    ? sectionScaled.map(p => `${p.x},${p.y}`).join(' ')
    : null;

  return (
    <View style={[miniTraceStyles.container, isHighlighted && miniTraceStyles.highlighted]}>
      <Svg width={width} height={height}>
        {/* Section reference underneath (faded) */}
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
        {/* Activity's actual path through section (prominent) */}
        <Polyline
          points={overlapString}
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

interface PerformanceDataPoint {
  id: string;
  activityId: string;
  speed: number;
  date: Date;
  activityName: string;
}

interface PerformanceChartProps {
  activities: Activity[];
  activityType: ActivityType;
  isDark: boolean;
  onActivitySelect?: (activityId: string | null) => void;
  selectedActivityId?: string | null;
}

function formatShortDate(date: Date): string {
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function SectionPerformanceChart({
  activities,
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

  const { chartData, minSpeed, maxSpeed, bestIndex } = useMemo(() => {
    const dataPoints: (PerformanceDataPoint & { x: number })[] = [];

    const sortedActivities = [...activities].sort(
      (a, b) => new Date(a.start_date_local).getTime() - new Date(b.start_date_local).getTime()
    );

    for (const activity of sortedActivities) {
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
    };
  }, [activities]);

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
    if (showPace) return formatPace(speed);
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
          onActivitySelect(tooltipData.id);
        }
      }
      lastNotifiedIdx.current = null;
      return;
    }

    if (idx < 0 || chartData.length === 0) return;

    if (isPersisted) setIsPersisted(false);
    if (idx === lastNotifiedIdx.current) return;
    lastNotifiedIdx.current = idx;
    if (!isActive) setIsActive(true);

    const point = chartData[idx];
    if (point) {
      setTooltipData(point);
      if (onActivitySelect) onActivitySelect(point.id);
    }
  }, [chartData, isActive, isPersisted, tooltipData, onActivitySelect]);

  const handleGestureEnd = useCallback(() => {
    updateTooltipOnJS(-1, true);
  }, [updateTooltipOnJS]);

  useAnimatedReaction(
    () => selectedIdx.value,
    (idx) => {
      if (idx >= 0) runOnJS(updateTooltipOnJS)(idx, false);
    },
    [updateTooltipOnJS]
  );

  const clearPersistedTooltip = useCallback(() => {
    if (isPersisted) {
      setIsPersisted(false);
      setTooltipData(null);
      if (onActivitySelect) onActivitySelect(null);
    }
  }, [isPersisted, onActivitySelect]);

  const panGesture = Gesture.Pan()
    .activateAfterLongPress(300)
    .onStart((e) => { 'worklet'; touchX.value = e.x; })
    .onUpdate((e) => { 'worklet'; touchX.value = e.x; })
    .onEnd(() => { 'worklet'; touchX.value = -1; runOnJS(handleGestureEnd)(); });

  const tapGesture = Gesture.Tap()
    .onEnd(() => { 'worklet'; runOnJS(clearPersistedTooltip)(); });

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

    return { opacity: 1, transform: [{ translateX: xPos }] };
  }, [chartData.length]);

  if (chartData.length < 2) return null;

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

            return (
              <>
                {points.speed.length > 1 && (
                  <Line
                    points={points.speed}
                    color={activityColor}
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
                {bestIndex !== selectedIndex &&
                 points.speed[bestIndex] &&
                 points.speed[bestIndex].x != null && points.speed[bestIndex].y != null && (
                  <>
                    <Circle cx={points.speed[bestIndex].x!} cy={points.speed[bestIndex].y!} r={8} color="#FFB300" />
                    <Circle cx={points.speed[bestIndex].x!} cy={points.speed[bestIndex].y!} r={4} color="#FFFFFF" />
                  </>
                )}
                {selectedIndex >= 0 &&
                 points.speed[selectedIndex] &&
                 points.speed[selectedIndex].x != null && points.speed[selectedIndex].y != null && (
                  <>
                    <Circle cx={points.speed[selectedIndex].x!} cy={points.speed[selectedIndex].y!} r={10} color="#00BCD4" />
                    <Circle cx={points.speed[selectedIndex].x!} cy={points.speed[selectedIndex].y!} r={5} color="#FFFFFF" />
                  </>
                )}
              </>
            );
          }}
        </CartesianChart>

        <Animated.View style={[styles.crosshair, crosshairStyle, isDark && styles.crosshairDark]} pointerEvents="none" />

        <View style={styles.yAxisOverlay} pointerEvents="none">
          <Text style={[styles.axisLabel, isDark && styles.axisLabelDark]}>{formatSpeedValue(maxSpeed)}</Text>
          <Text style={[styles.axisLabel, isDark && styles.axisLabelDark]}>{formatSpeedValue((minSpeed + maxSpeed) / 2)}</Text>
          <Text style={[styles.axisLabel, isDark && styles.axisLabelDark]}>{formatSpeedValue(minSpeed)}</Text>
        </View>

        <View style={[styles.xAxisOverlay, { width: chartWidth - 35 - 16, left: 35 }]} pointerEvents="none">
          {chartData.length > 0 && (
            <>
              <Text style={[styles.axisLabel, isDark && styles.axisLabelDark]}>{formatShortDate(chartData[0].date)}</Text>
              {chartData.length >= 5 && (
                <Text style={[styles.axisLabel, isDark && styles.axisLabelDark]}>{formatShortDate(chartData[Math.floor(chartData.length / 2)].date)}</Text>
              )}
              <Text style={[styles.axisLabel, isDark && styles.axisLabelDark]}>{formatShortDate(chartData[chartData.length - 1].date)}</Text>
            </>
          )}
        </View>
      </View>
    </GestureDetector>
  );

  return (
    <View style={[styles.chartCard, isDark && styles.chartCardDark]}>
      <View style={styles.chartHeader}>
        <Text style={[styles.chartTitle, isDark && styles.textLight]}>Performance Over Time</Text>
        <View style={styles.chartLegend}>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: '#FFB300' }]} />
            <Text style={[styles.legendText, isDark && styles.textMuted]}>Best</Text>
          </View>
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
            <Text style={[styles.tooltipName, isDark && styles.textLight]} numberOfLines={1}>{tooltipData.activityName}</Text>
            <Text style={[styles.tooltipDate, isDark && styles.textMuted]}>{formatShortDate(tooltipData.date)}</Text>
          </View>
          <View style={styles.tooltipRight}>
            <Text style={[styles.tooltipSpeed, { color: activityColor }]}>{formatSpeedValue(tooltipData.speed)}</Text>
            <MaterialCommunityIcons name="chevron-right" size={16} color={isDark ? '#555' : '#CCC'} />
          </View>
        </TouchableOpacity>
      )}

      <View style={styles.chartContainer}>
        {needsScrolling ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={true} contentContainerStyle={{ width: chartWidth }}>
            {chartContent}
          </ScrollView>
        ) : (
          chartContent
        )}
      </View>

      {chartData[bestIndex] && (
        <View style={[styles.bestStats, isDark && styles.bestStatsDark]}>
          <View style={styles.bestStatItem}>
            <Text style={[styles.bestStatValue, { color: '#FFB300' }]}>{formatSpeedValue(chartData[bestIndex].speed)}</Text>
            <Text style={[styles.bestStatLabel, isDark && styles.textMuted]}>Best {showPace ? 'pace' : 'speed'}</Text>
          </View>
          <View style={styles.bestStatItem}>
            <Text style={[styles.bestStatValue, isDark && styles.textLight]}>{formatShortDate(chartData[bestIndex].date)}</Text>
            <Text style={[styles.bestStatLabel, isDark && styles.textMuted]}>Date</Text>
          </View>
        </View>
      )}
    </View>
  );
}

interface ActivityRowProps {
  activity: Activity;
  isDark: boolean;
  sectionPoints?: RoutePoint[];
  overlap?: SectionOverlap;
  isHighlighted?: boolean;
}

function ActivityRow({ activity, isDark, sectionPoints, overlap, isHighlighted }: ActivityRowProps) {
  const handlePress = () => {
    router.push(`/activity/${activity.id}` as Href);
  };

  const activityColor = getActivityColor(activity.type);
  const traceColor = isHighlighted ? '#00BCD4' : activityColor;

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
      {overlap && overlap.overlapPoints.length > 1 ? (
        <MiniSectionTrace
          overlapPoints={overlap.overlapPoints}
          sectionPoints={sectionPoints}
          activityColor={traceColor}
          sectionColor={activityColor}
          isHighlighted={isHighlighted}
        />
      ) : (
        <View style={[styles.activityIcon, { backgroundColor: activityColor + '20' }]}>
          <MaterialCommunityIcons
            name={getActivityIcon(activity.type)}
            size={18}
            color={activityColor}
          />
        </View>
      )}
      <View style={styles.activityInfo}>
        <Text style={[styles.activityName, isDark && styles.textLight]} numberOfLines={1}>
          {activity.name}
        </Text>
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

function SectionMapView({
  section,
  height,
  highlightedOverlap,
}: {
  section: FrequentSection;
  height: number;
  highlightedOverlap?: SectionOverlap | null;
}) {
  const { getStyleForActivity } = useMapPreferences();
  const mapStyle = getStyleForActivity(section.sportType as ActivityType);
  const activityColor = getActivityColor(section.sportType as ActivityType);

  const bounds = useMemo(() => {
    if (!section.polyline || section.polyline.length === 0) return null;

    let minLat = Infinity, maxLat = -Infinity;
    let minLng = Infinity, maxLng = -Infinity;

    for (const point of section.polyline) {
      minLat = Math.min(minLat, point.lat);
      maxLat = Math.max(maxLat, point.lat);
      minLng = Math.min(minLng, point.lng);
      maxLng = Math.max(maxLng, point.lng);
    }

    // Include highlighted overlap in bounds
    if (highlightedOverlap) {
      for (const [lat, lng] of highlightedOverlap.overlapPoints) {
        minLat = Math.min(minLat, lat);
        maxLat = Math.max(maxLat, lat);
        minLng = Math.min(minLng, lng);
        maxLng = Math.max(maxLng, lng);
      }
    }

    const latPad = (maxLat - minLat) * 0.15;
    const lngPad = (maxLng - minLng) * 0.15;

    return {
      ne: [maxLng + lngPad, maxLat + latPad] as [number, number],
      sw: [minLng - lngPad, minLat - latPad] as [number, number],
    };
  }, [section.polyline, highlightedOverlap]);

  const sectionGeoJSON = useMemo(() => {
    if (!section.polyline || section.polyline.length === 0) return null;
    return {
      type: 'Feature' as const,
      properties: {},
      geometry: {
        type: 'LineString' as const,
        coordinates: section.polyline.map(p => [p.lng, p.lat]),
      },
    };
  }, [section.polyline]);

  const highlightGeoJSON = useMemo(() => {
    if (!highlightedOverlap || highlightedOverlap.overlapPoints.length < 2) return null;
    return {
      type: 'Feature' as const,
      properties: {},
      geometry: {
        type: 'LineString' as const,
        coordinates: highlightedOverlap.overlapPoints.map(([lat, lng]) => [lng, lat]),
      },
    };
  }, [highlightedOverlap]);

  const styleUrl = getMapStyle(mapStyle);
  const startPoint = section.polyline?.[0];
  const endPoint = section.polyline?.[section.polyline.length - 1];

  if (!bounds || !sectionGeoJSON) {
    return (
      <View style={[styles.mapPlaceholder, { height, backgroundColor: activityColor + '20' }]}>
        <MaterialCommunityIcons name="map-marker-off" size={32} color={activityColor} />
      </View>
    );
  }

  return (
    <View style={[styles.mapContainer, { height }]}>
      <MapView
        style={styles.map}
        mapStyle={styleUrl}
        logoEnabled={false}
        attributionEnabled={false}
        compassEnabled={false}
        scrollEnabled={false}
        zoomEnabled={false}
        rotateEnabled={false}
        pitchEnabled={false}
      >
        <Camera bounds={bounds} padding={{ paddingTop: 50, paddingRight: 50, paddingBottom: 50, paddingLeft: 50 }} animationDuration={0} />

        {/* Section polyline */}
        <ShapeSource id="sectionRoute" shape={sectionGeoJSON}>
          <LineLayer
            id="sectionLine"
            style={{
              lineColor: activityColor,
              lineWidth: highlightedOverlap ? 3 : 5,
              lineCap: 'round',
              lineJoin: 'round',
              lineOpacity: highlightedOverlap ? 0.4 : 1,
            }}
          />
        </ShapeSource>

        {/* Highlighted activity's path */}
        {highlightGeoJSON && (
          <ShapeSource id="highlightRoute" shape={highlightGeoJSON}>
            <LineLayer
              id="highlightLine"
              style={{
                lineColor: '#00BCD4',
                lineWidth: 5,
                lineCap: 'round',
                lineJoin: 'round',
              }}
            />
          </ShapeSource>
        )}

        {startPoint && (
          <MarkerView coordinate={[startPoint.lng, startPoint.lat]}>
            <View style={styles.markerContainer}>
              <View style={[styles.marker, styles.startMarker]}>
                <MaterialCommunityIcons name="play" size={12} color="#FFFFFF" />
              </View>
            </View>
          </MarkerView>
        )}

        {endPoint && (
          <MarkerView coordinate={[endPoint.lng, endPoint.lat]}>
            <View style={styles.markerContainer}>
              <View style={[styles.marker, styles.endMarker]}>
                <MaterialCommunityIcons name="flag-checkered" size={12} color="#FFFFFF" />
              </View>
            </View>
          </MarkerView>
        )}
      </MapView>
    </View>
  );
}

export default function SectionDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const insets = useSafeAreaInsets();

  const [highlightedActivityId, setHighlightedActivityId] = useState<string | null>(null);
  const [overlaps, setOverlaps] = useState<Map<string, SectionOverlap>>(new Map());
  const [loadingOverlaps, setLoadingOverlaps] = useState(false);

  const section = useRouteMatchStore((s) =>
    s.cache?.frequentSections?.find((sec) => sec.id === id) || null
  );

  const { oldest, newest } = useMemo(() => {
    if (!section || section.activityIds.length === 0) {
      return { oldest: undefined, newest: undefined };
    }
    const now = new Date();
    const yearAgo = new Date();
    yearAgo.setFullYear(yearAgo.getFullYear() - 1);

    return {
      oldest: yearAgo.toISOString().split('T')[0],
      newest: now.toISOString().split('T')[0],
    };
  }, [section]);

  const { data: allActivities, isLoading } = useActivities({
    oldest,
    newest,
    includeStats: false,
  });

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

  // Load GPS tracks and compute overlaps
  useEffect(() => {
    if (!section || sectionActivities.length === 0) return;

    const loadOverlaps = async () => {
      setLoadingOverlaps(true);
      try {
        const activityIds = sectionActivities.map(a => a.id);
        const tracks = await getGpsTracks(activityIds);

        if (tracks.size > 0 && section.polyline && section.polyline.length > 0) {
          const extractedOverlaps = extractSectionOverlaps(tracks, section.polyline);
          const overlapMap = new Map<string, SectionOverlap>();
          for (const overlap of extractedOverlaps) {
            overlapMap.set(overlap.activityId, overlap);
          }
          setOverlaps(overlapMap);
        }
      } catch (error) {
        console.error('Failed to load GPS overlaps:', error);
      } finally {
        setLoadingOverlaps(false);
      }
    };

    loadOverlaps();
  }, [section, sectionActivities]);

  const handleActivitySelect = useCallback((activityId: string | null) => {
    setHighlightedActivityId(activityId);
  }, []);

  const highlightedOverlap = highlightedActivityId ? overlaps.get(highlightedActivityId) : null;

  if (!section) {
    return (
      <View style={[styles.container, isDark && styles.containerDark]}>
        <View style={[styles.floatingHeader, { paddingTop: insets.top }]}>
          <TouchableOpacity style={styles.backButton} onPress={() => router.back()} activeOpacity={0.7}>
            <MaterialCommunityIcons name="arrow-left" size={24} color={isDark ? '#FFFFFF' : colors.textPrimary} />
          </TouchableOpacity>
        </View>
        <View style={styles.emptyContainer}>
          <MaterialCommunityIcons name="road-variant" size={48} color={isDark ? '#444' : '#CCC'} />
          <Text style={[styles.emptyText, isDark && styles.textLight]}>Section not found</Text>
        </View>
      </View>
    );
  }

  const activityColor = getActivityColor(section.sportType as ActivityType);
  const iconName = getActivityIcon(section.sportType as ActivityType);

  return (
    <View style={[styles.container, isDark && styles.containerDark]}>
      <StatusBar barStyle="light-content" />
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Hero Map Section */}
        <View style={styles.heroSection}>
          <SectionMapView section={section} height={MAP_HEIGHT} highlightedOverlap={highlightedOverlap} />

          <LinearGradient colors={['transparent', 'rgba(0,0,0,0.7)']} style={styles.mapGradient} pointerEvents="none" />

          <View style={[styles.floatingHeader, { paddingTop: insets.top }]}>
            <TouchableOpacity style={styles.backButton} onPress={() => router.back()} activeOpacity={0.7}>
              <MaterialCommunityIcons name="arrow-left" size={24} color="#FFFFFF" />
            </TouchableOpacity>
          </View>

          <View style={styles.infoOverlay}>
            <View style={styles.sectionNameRow}>
              <View style={[styles.typeIcon, { backgroundColor: activityColor }]}>
                <MaterialCommunityIcons name={iconName} size={16} color="#FFFFFF" />
              </View>
              <Text style={styles.heroSectionName} numberOfLines={2}>{section.name}</Text>
            </View>

            <View style={styles.heroStatsRow}>
              <Text style={styles.heroStat}>{formatDistance(section.distanceMeters)}</Text>
              <Text style={styles.heroStatDivider}>·</Text>
              <Text style={styles.heroStat}>{section.visitCount} visits</Text>
              <Text style={styles.heroStatDivider}>·</Text>
              <Text style={styles.heroStat}>{section.activityIds.length} activities</Text>
            </View>
          </View>
        </View>

        {/* Content below hero */}
        <View style={styles.contentSection}>
          {/* Performance Chart */}
          {sectionActivities.length >= 2 && (
            <View style={styles.chartSection}>
              <SectionPerformanceChart
                activities={sectionActivities}
                activityType={section.sportType as ActivityType}
                isDark={isDark}
                onActivitySelect={handleActivitySelect}
                selectedActivityId={highlightedActivityId}
              />
            </View>
          )}

          {/* Activities list */}
          <View style={styles.activitiesSection}>
            <Text style={[styles.sectionTitle, isDark && styles.textLight]}>Activities</Text>

            {isLoading || loadingOverlaps ? (
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="small" color={colors.primary} />
              </View>
            ) : sectionActivities.length === 0 ? (
              <Text style={[styles.emptyActivities, isDark && styles.textMuted]}>No activities found</Text>
            ) : (
              <View style={[styles.activitiesCard, isDark && styles.activitiesCardDark]}>
                {sectionActivities.map((activity, index) => {
                  const overlap = overlaps.get(activity.id);
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
                          sectionPoints={section.polyline}
                          overlap={overlap}
                          isHighlighted={isHighlighted}
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

          {section.routeIds.length > 0 && (
            <View style={styles.routesSection}>
              <Text style={[styles.sectionTitle, isDark && styles.textLight]}>
                Part of {section.routeIds.length} route{section.routeIds.length > 1 ? 's' : ''}
              </Text>
              <Text style={[styles.routesHint, isDark && styles.textMuted]}>
                This section appears in multiple routes you've completed
              </Text>
            </View>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  containerDark: { backgroundColor: darkColors.background },
  textLight: { color: colors.textOnDark },
  textMuted: { color: darkColors.textSecondary },
  scrollView: { flex: 1 },
  scrollContent: { paddingBottom: spacing.xl },
  heroSection: { height: MAP_HEIGHT, position: 'relative' },
  mapContainer: { flex: 1 },
  map: { flex: 1 },
  mapPlaceholder: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  mapGradient: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 120 },
  floatingHeader: { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.sm, paddingBottom: spacing.sm },
  backButton: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(0, 0, 0, 0.4)', justifyContent: 'center', alignItems: 'center' },
  infoOverlay: { position: 'absolute', bottom: 0, left: 0, right: 0, paddingHorizontal: spacing.md, paddingBottom: spacing.md },
  sectionNameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  typeIcon: { width: 28, height: 28, borderRadius: 8, justifyContent: 'center', alignItems: 'center' },
  heroSectionName: { flex: 1, fontSize: typography.statsValue.fontSize, fontWeight: '700', color: colors.textOnDark, textShadowColor: 'rgba(0, 0, 0, 0.5)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3 },
  heroStatsRow: { flexDirection: 'row', alignItems: 'center', marginTop: 6, flexWrap: 'wrap' },
  heroStat: { fontSize: typography.bodySmall.fontSize, color: 'rgba(255, 255, 255, 0.9)', textShadowColor: 'rgba(0, 0, 0, 0.5)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 2 },
  heroStatDivider: { fontSize: typography.bodySmall.fontSize, color: 'rgba(255, 255, 255, 0.5)', marginHorizontal: spacing.xs },
  contentSection: { padding: layout.screenPadding, paddingTop: spacing.lg },
  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emptyText: { fontSize: typography.body.fontSize, color: colors.textPrimary, marginTop: spacing.md },
  chartSection: { marginBottom: spacing.lg },
  chartCard: { backgroundColor: colors.surface, borderRadius: layout.borderRadius, overflow: 'hidden', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: spacing.sm, elevation: 2 },
  chartCardDark: { backgroundColor: darkColors.surface },
  chartHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: spacing.md, paddingTop: spacing.md, paddingBottom: spacing.xs },
  chartTitle: { fontSize: typography.bodySmall.fontSize, fontWeight: '600', color: colors.textPrimary },
  chartLegend: { flexDirection: 'row', gap: spacing.md },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  legendDot: { width: spacing.sm, height: spacing.sm, borderRadius: spacing.xs },
  legendText: { fontSize: typography.micro.fontSize, color: colors.textSecondary },
  chartHint: { fontSize: typography.label.fontSize, color: colors.textSecondary, textAlign: 'center', paddingHorizontal: spacing.md, paddingBottom: spacing.xs },
  chartContainer: { height: CHART_HEIGHT, position: 'relative', overflow: 'hidden' },
  chartInner: { height: CHART_HEIGHT, position: 'relative', overflow: 'hidden' },
  crosshair: { position: 'absolute', top: 40, bottom: 24, width: 1.5, backgroundColor: '#666' },
  crosshairDark: { backgroundColor: '#AAA' },
  selectedTooltip: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: 'rgba(0, 188, 212, 0.08)', marginHorizontal: spacing.md, marginBottom: spacing.sm, padding: spacing.sm, borderRadius: 10, borderWidth: 1, borderColor: 'rgba(0, 188, 212, 0.2)' },
  selectedTooltipDark: { backgroundColor: 'rgba(0, 188, 212, 0.12)', borderColor: 'rgba(0, 188, 212, 0.3)' },
  tooltipLeft: { flex: 1 },
  tooltipName: { fontSize: typography.bodyCompact.fontSize, fontWeight: '600', color: colors.textPrimary },
  tooltipDate: { fontSize: typography.label.fontSize, color: colors.textSecondary, marginTop: 2 },
  tooltipRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  tooltipSpeed: { fontSize: typography.bodySmall.fontSize + 1, fontWeight: '700' },
  yAxisOverlay: { position: 'absolute', top: 40, bottom: 24, left: 4, justifyContent: 'space-between' },
  xAxisOverlay: { position: 'absolute', bottom: 4, flexDirection: 'row', justifyContent: 'space-between' },
  axisLabel: { fontSize: typography.pillLabel.fontSize, color: colors.textSecondary },
  axisLabelDark: { color: darkColors.textSecondary },
  bestStats: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: opacity.overlay.light, paddingVertical: spacing.sm, paddingHorizontal: spacing.md, gap: spacing.lg },
  bestStatsDark: { borderTopColor: opacity.overlayDark.light },
  bestStatItem: { flex: 1 },
  bestStatValue: { fontSize: typography.bodySmall.fontSize + 1, fontWeight: '700', color: colors.textPrimary },
  bestStatLabel: { fontSize: typography.label.fontSize, color: colors.textSecondary, marginTop: 2 },
  activitiesSection: { marginBottom: spacing.xl },
  sectionTitle: { fontSize: typography.body.fontSize, fontWeight: '600', color: colors.textPrimary, marginBottom: spacing.sm },
  loadingContainer: { padding: spacing.xl, alignItems: 'center' },
  emptyActivities: { fontSize: typography.bodySmall.fontSize, color: colors.textSecondary, textAlign: 'center', paddingVertical: spacing.lg },
  activitiesCard: { backgroundColor: colors.surface, borderRadius: layout.borderRadius, overflow: 'hidden' },
  activitiesCardDark: { backgroundColor: darkColors.surface },
  activityRow: { flexDirection: 'row', alignItems: 'center', padding: spacing.md, gap: spacing.md },
  activityRowDark: {},
  activityRowHighlighted: { backgroundColor: 'rgba(0, 188, 212, 0.1)' },
  activityRowPressed: { opacity: 0.7 },
  activityIcon: { width: 36, height: 36, borderRadius: 10, justifyContent: 'center', alignItems: 'center' },
  activityInfo: { flex: 1 },
  activityName: { fontSize: typography.bodySmall.fontSize + 1, fontWeight: '500', color: colors.textPrimary },
  activityDate: { fontSize: typography.caption.fontSize, color: colors.textSecondary, marginTop: 1 },
  activityStats: { alignItems: 'flex-end' },
  activityDistance: { fontSize: typography.bodySmall.fontSize, fontWeight: '600', color: colors.textPrimary },
  activityTime: { fontSize: typography.caption.fontSize, color: colors.textSecondary },
  divider: { height: 1, backgroundColor: opacity.overlay.light, marginLeft: 36 + spacing.md + spacing.md },
  dividerDark: { backgroundColor: opacity.overlayDark.light },
  routesSection: { marginBottom: spacing.lg },
  routesHint: { fontSize: typography.bodySmall.fontSize, color: colors.textSecondary, marginTop: spacing.xs },
  markerContainer: { alignItems: 'center', justifyContent: 'center' },
  marker: { width: 24, height: 24, borderRadius: layout.borderRadius, justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: colors.textOnDark, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.3, shadowRadius: 2, elevation: 3 },
  startMarker: { backgroundColor: colors.success },
  endMarker: { backgroundColor: colors.error },
});

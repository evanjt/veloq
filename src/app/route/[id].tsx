import React, { useMemo, useCallback, useState, useEffect, useRef } from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  Pressable,
  Dimensions,
  StatusBar,
  TouchableOpacity,
  TextInput,
  Keyboard,
  Alert,
} from 'react-native';
import { Text, ActivityIndicator } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, router, Href } from 'expo-router';
import { logScreenRender } from '@/lib/debug/renderTimer';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { LinearGradient } from 'expo-linear-gradient';
import {
  useConsensusRoute,
  useRoutePerformances,
  useTheme,
  useMetricSystem,
  useCacheDays,
  useGpxExport,
} from '@/hooks';
import { fromUnixSeconds } from '@/lib/utils/ffiConversions';
import { useGroupDetail } from '@/hooks/routes/useRouteEngine';
import { getAllRouteDisplayNames, getRouteDisplayName } from '@/hooks/routes/useRouteGroups';
import { createSharedStyles } from '@/styles';
import { TAB_BAR_SAFE_PADDING } from '@/components/ui';

// Lazy load native module to avoid bundler errors
function getRouteEngine() {
  try {
    return require('veloqrs').routeEngine;
  } catch {
    return null;
  }
}

import {
  RouteMapView,
  MiniTraceView,
  DataRangeFooter,
  DebugInfoPanel,
  DebugWarningBanner,
} from '@/components/routes';
import { useDebugStore } from '@/providers';
import { useFFITimer } from '@/hooks/debug/useFFITimer';
import {
  UnifiedPerformanceChart,
  type DirectionSummaryStats,
} from '@/components/routes/performance';
import {
  formatDistance,
  formatRelativeDate,
  getActivityIcon,
  getActivityColor,
  formatDuration,
  formatPace,
  formatSpeed,
  isRunningActivity,
} from '@/lib';
import { colors, darkColors, spacing, layout, typography, opacity } from '@/theme';
import type { Activity, ActivityType, RoutePoint, PerformanceDataPoint } from '@/types';
import { toActivityType } from '@/types/routes';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');
const MAP_HEIGHT = Math.round(SCREEN_HEIGHT * 0.45); // 45% of screen for hero map

// Direction colors - using theme for consistency
const REVERSE_COLOR = colors.reverseDirection; // Pink
const SAME_COLOR_DEFAULT = colors.sameDirection; // Blue (same direction)
const CONSENSUS_COLOR = colors.consensusRoute; // Orange for the consensus/main route

interface ActivityRowProps {
  activity: Activity;
  isDark: boolean;
  isMetric: boolean;
  matchPercentage?: number;
  direction?: string;
  /** Route points for this activity's GPS trace */
  activityPoints?: RoutePoint[];
  /** Representative route points (full route for comparison) */
  routePoints?: RoutePoint[];
  /** Whether this row is currently highlighted */
  isHighlighted?: boolean;
  /** Total distance of the route in meters (for context) */
  routeDistance?: number;
  /** Is this the best performance (PR)? */
  isBest?: boolean;
  /** Rank of this performance (1 = best) */
  rank?: number;
  /** Time delta vs PR in seconds (positive = slower, negative = faster) */
  deltaFromPR?: number;
  /** Speed/pace for this route effort (m/s) */
  speed?: number;
  /** Duration for this route effort (seconds) */
  duration?: number;
  /** Best speed (PR) for pace delta calculation */
  bestSpeed?: number;
}

const ActivityRow = React.memo(function ActivityRow({
  activity,
  isDark,
  isMetric,
  matchPercentage,
  direction,
  activityPoints,
  routePoints,
  isHighlighted,
  routeDistance,
  isBest = false,
  rank,
  deltaFromPR,
  speed,
  duration,
  bestSpeed,
}: ActivityRowProps) {
  const { t } = useTranslation();
  const handlePress = () => {
    router.push(`/activity/${activity.id}`);
  };

  // Determine trace color based on direction
  const isReverse = direction === 'reverse';
  // Activity trace: cyan for highlighted, purple for reverse, blue for same
  const traceColor = isHighlighted
    ? colors.chartCyan
    : isReverse
      ? REVERSE_COLOR
      : colors.sameDirection;
  const badgeColor = isReverse ? REVERSE_COLOR : colors.success;

  // Use route-specific speed/duration if available, otherwise fall back to activity averages
  const displaySpeed =
    speed ?? (activity.moving_time > 0 ? activity.distance / activity.moving_time : 0);
  const displayDuration = duration ?? activity.moving_time;
  const showPace = isRunningActivity(activity.type);

  // Format delta from PR for display
  // For running: show pace delta (e.g., "+0:15 /km")
  // For cycling: show time delta (e.g., "+0:45")
  const { deltaDisplay, deltaColor } = useMemo(() => {
    if (isBest) return { deltaDisplay: null, deltaColor: colors.textSecondary };

    if (showPace && displaySpeed > 0 && bestSpeed && bestSpeed > 0) {
      // Calculate pace delta (seconds per km)
      const currentPace = 1000 / displaySpeed; // seconds per km
      const bestPace = 1000 / bestSpeed; // seconds per km
      const paceDelta = currentPace - bestPace; // positive = slower

      if (!Number.isFinite(paceDelta) || Math.abs(paceDelta) < 1) {
        return { deltaDisplay: null, deltaColor: colors.textSecondary };
      }

      const absDelta = Math.abs(paceDelta);
      const minutes = Math.floor(absDelta / 60);
      const seconds = Math.round(absDelta % 60);
      const sign = paceDelta > 0 ? '+' : '-';
      const formatted =
        minutes > 0
          ? `${sign}${minutes}:${seconds.toString().padStart(2, '0')}`
          : `${sign}${seconds}s`;

      return {
        deltaDisplay: formatted,
        deltaColor: paceDelta <= 0 ? colors.success : colors.error,
      };
    }

    // Fall back to time delta for non-running activities
    if (deltaFromPR === undefined || !Number.isFinite(deltaFromPR)) {
      return { deltaDisplay: null, deltaColor: colors.textSecondary };
    }

    const absDelta = Math.abs(deltaFromPR);
    const minutes = Math.floor(absDelta / 60);
    const seconds = Math.round(absDelta % 60);
    const sign = deltaFromPR > 0 ? '+' : '-';

    return {
      deltaDisplay: `${sign}${minutes}:${seconds.toString().padStart(2, '0')}`,
      deltaColor: deltaFromPR <= 0 ? colors.success : colors.error,
    };
  }, [isBest, showPace, displaySpeed, bestSpeed, deltaFromPR]);

  return (
    <Pressable
      onPress={handlePress}
      style={({ pressed }) => [
        styles.activityRow,
        isDark && styles.activityRowDark,
        isHighlighted && styles.activityRowHighlighted,
        pressed && styles.activityRowPressed,
        isBest && styles.activityRowBest,
      ]}
    >
      {/* Mini trace showing route reference (gold) vs activity trace */}
      {activityPoints && activityPoints.length > 1 ? (
        <MiniTraceView
          primaryPoints={activityPoints}
          referencePoints={routePoints}
          primaryColor={traceColor}
          referenceColor={CONSENSUS_COLOR}
          isHighlighted={isHighlighted}
          isDark={isDark}
          width={56}
          height={40}
        />
      ) : (
        <View
          style={[
            styles.activityIcon,
            { backgroundColor: traceColor + '20', width: 56, height: 40 },
          ]}
        >
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
          {/* PR indicator - small trophy icon (gold) */}
          {isBest && (
            <MaterialCommunityIcons
              name="trophy"
              size={14}
              color={colors.chartGold}
              style={{ marginLeft: 4 }}
            />
          )}
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
        </View>
      </View>
      <View style={styles.activityStats}>
        {/* Pace/speed prominently */}
        <Text style={[styles.activityDistance, isDark && styles.textLight]}>
          {showPace ? formatPace(displaySpeed) : formatSpeed(displaySpeed)}
        </Text>
        {/* Duration more subtle */}
        <Text style={[styles.activityTime, isDark && styles.textMuted]}>
          {formatDuration(displayDuration)}
        </Text>
        {/* Delta from PR */}
        {deltaDisplay && (
          <Text style={[styles.deltaText, { color: deltaColor }]}>{deltaDisplay}</Text>
        )}
      </View>
      <MaterialCommunityIcons
        name="chevron-right"
        size={20}
        color={isDark ? darkColors.textMuted : colors.divider}
      />
    </Pressable>
  );
});

export default function RouteDetailScreen() {
  // Performance timing
  const perfEndRef = useRef<(() => void) | null>(null);
  perfEndRef.current = logScreenRender('RouteDetailScreen');
  useEffect(() => {
    perfEndRef.current?.();
  });

  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { isDark, colors: themeColors } = useTheme();
  const isMetric = useMetricSystem();
  const shared = createSharedStyles(isDark);
  const insets = useSafeAreaInsets();

  // Get cached date range from sync store (consolidated calculation)
  const cacheDays = useCacheDays();
  const debugEnabled = useDebugStore((s) => s.enabled);
  const { getPageMetrics } = useFFITimer();
  const { exportGpx, exporting: gpxExporting } = useGpxExport();

  // State for highlighted activity
  const [highlightedActivityId, setHighlightedActivityId] = useState<string | null>(null);
  const [highlightedActivityPoints, setHighlightedActivityPoints] = useState<
    RoutePoint[] | undefined
  >(undefined);

  // State for route renaming
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [customName, setCustomName] = useState<string | null>(null);
  const nameInputRef = useRef<TextInput>(null);

  // Load custom route name from Rust engine on mount
  useEffect(() => {
    if (id) {
      const engine = getRouteEngine();
      const name = engine?.getRouteName(id);
      if (name) {
        setCustomName(name);
      }
    }
  }, [id]);

  // Handle activity selection from chart scrubbing
  const handleActivitySelect = useCallback(
    (activityId: string | null, activityPoints?: RoutePoint[]) => {
      setHighlightedActivityId(activityId);
      setHighlightedActivityPoints(activityPoints);
    },
    []
  );

  // Get route group from engine using lightweight on-demand query (with LRU caching)
  const { group: engineGroup } = useGroupDetail(id || null);

  // Rename function - calls engine directly (no need to load all groups)
  const renameRoute = useCallback((routeId: string, name: string) => {
    const engine = getRouteEngine();
    if (!engine) {
      throw new Error('Route engine not initialized');
    }
    engine.setRouteName(routeId, name);
    // Engine fires 'groups' event which triggers subscribers to refresh
  }, []);

  // Get performance data from engine metrics (no API call needed)
  // Activity metrics are cached in Rust engine's in-memory HashMap
  const {
    performances,
    best: bestPerformance,
    bestForwardRecord,
    bestReverseRecord,
    forwardStats,
    reverseStats,
    currentRank,
  } = useRoutePerformances(id, engineGroup?.groupId);

  // Get consensus route points from Rust engine
  const { points: consensusPoints } = useConsensusRoute(id);

  // Create a compatible routeGroup object with expected properties
  // Note: Native RouteGroup uses groupId, sportType, customName (different from extended type)
  // Names are stored in Rust (user-set or auto-generated on creation/migration)
  const routeGroupBase = useMemo(() => {
    if (!engineGroup) return null;
    return {
      id: engineGroup.groupId,
      name: engineGroup.customName ?? engineGroup.groupId,
      type: toActivityType(engineGroup.sportType || 'Ride'),
      activityIds: engineGroup.activityIds,
      activityCount: engineGroup.activityIds.length,
      firstDate: '', // Not available from engine
      lastDate: '', // Will be computed from activities
      signature: null as { points: any[]; distance: number } | null,
    };
  }, [engineGroup]);

  // Handle starting to edit the route name
  const handleStartEditing = useCallback(() => {
    const currentName = customName || routeGroupBase?.name || '';
    setEditName(currentName);
    setIsEditing(true);
    // Focus input after a short delay to ensure it's rendered
    setTimeout(() => {
      nameInputRef.current?.focus();
    }, 100);
  }, [customName, routeGroupBase?.name]);

  // Handle saving the edited route name
  // Uses renameRoute hook which triggers engine event for consistent UI updates
  const handleSaveName = useCallback(() => {
    // Dismiss keyboard and close edit UI immediately for responsive feel
    Keyboard.dismiss();
    setIsEditing(false);

    const trimmedName = editName.trim();
    if (!trimmedName || !id) {
      return;
    }

    // Check uniqueness against ALL route names (custom + auto-generated)
    const allDisplayNames = getAllRouteDisplayNames();
    const isDuplicate = Object.entries(allDisplayNames).some(
      ([existingId, name]) => existingId !== id && name === trimmedName
    );

    if (isDuplicate) {
      Alert.alert(t('routes.duplicateNameTitle'), t('routes.duplicateNameMessage'));
      return;
    }

    // Update local state immediately for instant feedback
    setCustomName(trimmedName);

    // Fire rename synchronously - Rust engine updates immediately
    try {
      renameRoute(id, trimmedName);
    } catch (error) {
      console.error('Failed to save route name:', error);
    }
  }, [editName, id, renameRoute, t]);

  // Handle canceling the edit
  const handleCancelEdit = useCallback(() => {
    setIsEditing(false);
    setEditName('');
    Keyboard.dismiss();
  }, []);

  // Build match data from performances array
  const performancesMap = useMemo(() => {
    const map: Record<
      string,
      { direction: string; matchPercentage: number | undefined; duration: number; speed: number }
    > = {};
    for (const perf of performances) {
      map[perf.activityId] = {
        direction: perf.direction,
        matchPercentage: perf.matchPercentage,
        duration: perf.duration,
        speed: perf.speed,
      };
    }
    return map;
  }, [performances]);

  // Load simplified GPS signatures for mini trace preview (single batch FFI call)
  const signatures = useMemo(() => {
    if (!engineGroup?.activityIds?.length) return {};
    try {
      const engine = getRouteEngine();
      if (!engine) return {};

      const activityIdSet = new Set(engineGroup.activityIds);
      const allSigs = engine.getAllMapSignatures();
      const result: Record<string, { points: Array<{ lat: number; lng: number }> }> = {};

      for (const sig of allSigs) {
        if (!activityIdSet.has(sig.activityId) || sig.coords.length < 4) continue;
        const points: Array<{ lat: number; lng: number }> = [];
        for (let i = 0; i < sig.coords.length - 1; i += 2) {
          points.push({ lat: sig.coords[i], lng: sig.coords[i + 1] });
        }
        result[sig.activityId] = { points };
      }
      return result;
    } catch {
      return {};
    }
  }, [engineGroup?.activityIds]);

  // Build activity list from engine metrics (no API call needed), sorted by fastest pace
  const routeActivities = React.useMemo(() => {
    if (!routeGroupBase) return [];
    const engine = getRouteEngine();
    if (!engine) return [];

    const metrics: {
      activityId: string;
      name: string;
      sportType: string;
      date: number;
      distance: number;
      movingTime: number;
      elapsedTime: number;
      elevationGain: number;
      avgHr: number | null;
    }[] = engine.getActivityMetricsForIds(routeGroupBase.activityIds);

    // Convert engine metrics to Activity-compatible objects
    const activities: Activity[] = metrics.map(
      (m): Activity => ({
        id: m.activityId,
        name: m.name,
        type: m.sportType as ActivityType,
        start_date_local: fromUnixSeconds(m.date)?.toISOString() ?? '',
        distance: m.distance,
        moving_time: m.movingTime,
        elapsed_time: m.elapsedTime,
        total_elevation_gain: m.elevationGain,
        average_speed: m.movingTime > 0 ? m.distance / m.movingTime : 0,
        max_speed: 0,
        average_heartrate: m.avgHr ?? undefined,
      })
    );

    // Build speed/pace lookup from performances
    const speedMap = new Map<string, number>();
    for (const perf of performances) {
      if (Number.isFinite(perf.speed)) {
        speedMap.set(perf.activityId, perf.speed);
      }
    }

    // Sort by fastest pace (highest speed first = PR at top)
    return activities.sort((a, b) => {
      const speedA = speedMap.get(a.id);
      const speedB = speedMap.get(b.id);
      if (speedA === undefined && speedB === undefined) return 0;
      if (speedA === undefined) return 1;
      if (speedB === undefined) return -1;
      return speedB - speedA;
    });
  }, [routeGroupBase, performances]);

  // Prepare chart data for UnifiedPerformanceChart using Rust engine performance data
  // This provides precise segment times instead of approximate activity averages
  const { chartData, minSpeed, maxSpeed, bestIndex, hasReverseRuns } = useMemo(() => {
    if (performances.length === 0) {
      return {
        chartData: [],
        minSpeed: 0,
        maxSpeed: 1,
        bestIndex: 0,
        hasReverseRuns: false,
      };
    }

    // Convert performances to chart data format
    // Filter out 'partial' directions and invalid speed values (NaN would crash SVG renderer)
    const validPerformances = performances.filter(
      (p) => p.direction !== 'partial' && Number.isFinite(p.speed)
    );
    const dataPoints: (PerformanceDataPoint & { x: number })[] = validPerformances.map(
      (perf, idx) => {
        const activityPoints = signatures[perf.activityId]?.points;
        return {
          x: idx,
          id: perf.activityId,
          activityId: perf.activityId,
          speed: perf.speed,
          date: perf.date,
          activityName: perf.name,
          direction: perf.direction as 'same' | 'reverse',
          matchPercentage: perf.matchPercentage,
          lapNumber: 1,
          totalLaps: validPerformances.length,
          lapPoints: activityPoints,
        };
      }
    );

    const speeds = dataPoints.map((d) => d.speed);
    const min = speeds.length > 0 ? Math.min(...speeds) : 0;
    const max = speeds.length > 0 ? Math.max(...speeds) : 1;
    const padding = (max - min) * 0.15 || 0.5;

    // Find best (fastest) - use the bestPerformance from Rust engine if available
    let bestIdx = 0;
    if (bestPerformance) {
      bestIdx = dataPoints.findIndex((d) => d.activityId === bestPerformance.activityId);
      if (bestIdx === -1) bestIdx = 0;
    } else {
      // Fallback to manual search
      for (let i = 1; i < dataPoints.length; i++) {
        if (dataPoints[i].speed > dataPoints[bestIdx].speed) {
          bestIdx = i;
        }
      }
    }

    const hasAnyReverse = dataPoints.some((d) => d.direction === 'reverse');

    return {
      chartData: dataPoints,
      minSpeed: Math.max(0, min - padding),
      maxSpeed: max + padding,
      bestIndex: bestIdx,
      hasReverseRuns: hasAnyReverse,
    };
  }, [performances, bestPerformance, signatures]);

  // Compute stats from activities since signature data isn't available
  // Must be called before any early return to maintain hooks order
  const routeStats = useMemo(() => {
    if (routeActivities.length === 0) return { distance: 0, lastDate: '' };
    const distances = routeActivities.map((a) => a.distance || 0);
    const avgDistance = distances.reduce((a, b) => a + b, 0) / distances.length;
    const dates = routeActivities.map((a) => new Date(a.start_date_local).getTime());
    const lastDate = new Date(Math.max(...dates)).toISOString();
    return { distance: avgDistance, lastDate };
  }, [routeActivities]);

  // Compute summary stats for the stats card
  const summaryStats = useMemo(() => {
    if (performances.length === 0) {
      return {
        bestTime: null,
        avgTime: null,
        totalActivities: 0,
        lastActivity: null,
      };
    }
    // Filter out invalid durations (NaN, undefined, non-finite)
    const validDurations = performances.map((p) => p.duration).filter((d) => Number.isFinite(d));
    const avgDuration =
      validDurations.length > 0
        ? validDurations.reduce((a, b) => a + b, 0) / validDurations.length
        : null;
    const dates = performances.map((p) => p.date.getTime());
    const lastActivityDate = new Date(Math.max(...dates));
    const bestTime = bestPerformance?.duration;
    return {
      bestTime: bestTime !== undefined && Number.isFinite(bestTime) ? bestTime : null,
      avgTime: avgDuration,
      totalActivities: performances.length,
      lastActivity: lastActivityDate,
    };
  }, [performances, bestPerformance]);

  // Final routeGroup with signature populated from consensus points
  const routeGroup = useMemo(() => {
    if (!routeGroupBase) return null;
    return {
      ...routeGroupBase,
      signature: consensusPoints
        ? {
            points: consensusPoints,
            distance: routeStats.distance,
          }
        : null,
    };
  }, [routeGroupBase, consensusPoints, routeStats.distance]);

  if (!routeGroup) {
    return (
      <View style={[styles.container, isDark && styles.containerDark]}>
        <View style={[styles.floatingHeader, { paddingTop: insets.top }]}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => router.back()}
            activeOpacity={0.7}
          >
            <MaterialCommunityIcons
              name="arrow-left"
              size={24}
              color={isDark ? colors.textOnDark : colors.textPrimary}
            />
          </TouchableOpacity>
        </View>
        <View style={styles.emptyContainer}>
          <MaterialCommunityIcons
            name="map-marker-question-outline"
            size={48}
            color={isDark ? darkColors.border : colors.divider}
          />
          <Text style={[styles.emptyText, isDark && styles.textLight]}>
            {t('routeDetail.routeNotFound')}
          </Text>
        </View>
      </View>
    );
  }

  const activityColor = getActivityColor(routeGroup.type);
  const iconName = getActivityIcon(routeGroup.type);
  // Map data check - without signatures, assume we have map data if we have activities
  const hasMapData = routeActivities.length > 0;

  return (
    <View testID="route-detail-screen" style={[styles.container, isDark && styles.containerDark]}>
      <StatusBar barStyle="light-content" />
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
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
                activitySignatures={signatures}
              />
            ) : (
              <View
                style={[
                  styles.mapPlaceholder,
                  { height: MAP_HEIGHT, backgroundColor: activityColor + '20' },
                ]}
              >
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

          {/* Floating header - back button and export */}
          <View style={[styles.floatingHeader, { paddingTop: insets.top }]}>
            <TouchableOpacity
              style={styles.backButton}
              onPress={() => router.back()}
              activeOpacity={0.7}
            >
              <MaterialCommunityIcons name="arrow-left" size={24} color={colors.textOnDark} />
            </TouchableOpacity>
            <View style={{ flex: 1 }} />
          </View>

          {/* Route info overlay at bottom */}
          <View style={styles.infoOverlay}>
            <View style={styles.routeNameRow}>
              <View style={[styles.typeIcon, { backgroundColor: activityColor }]}>
                <MaterialCommunityIcons name={iconName} size={16} color={colors.textOnDark} />
              </View>
              {isEditing ? (
                <View style={styles.editNameContainer}>
                  <TextInput
                    ref={nameInputRef}
                    style={styles.editNameInput}
                    value={editName}
                    onChangeText={setEditName}
                    onSubmitEditing={handleSaveName}
                    placeholder={t('routes.routeNamePlaceholder')}
                    placeholderTextColor="rgba(255,255,255,0.5)"
                    returnKeyType="done"
                    autoFocus
                    selectTextOnFocus
                  />
                  <TouchableOpacity onPress={handleSaveName} style={styles.editNameButton}>
                    <MaterialCommunityIcons name="check" size={20} color={colors.success} />
                  </TouchableOpacity>
                  <TouchableOpacity onPress={handleCancelEdit} style={styles.editNameButton}>
                    <MaterialCommunityIcons name="close" size={20} color={colors.error} />
                  </TouchableOpacity>
                </View>
              ) : (
                <TouchableOpacity
                  onPress={handleStartEditing}
                  style={styles.nameEditTouchable}
                  activeOpacity={0.7}
                >
                  <Text style={styles.heroRouteName} numberOfLines={1}>
                    {customName || routeGroup.name}
                  </Text>
                  <MaterialCommunityIcons
                    name="pencil"
                    size={14}
                    color="rgba(255,255,255,0.6)"
                    style={styles.editIcon}
                  />
                </TouchableOpacity>
              )}
            </View>

            {/* Stats row */}
            <View style={styles.heroStatsRow}>
              <Text style={styles.heroStat}>{formatDistance(routeStats.distance, isMetric)}</Text>
              <Text style={styles.heroStatDivider}>·</Text>
              <Text style={styles.heroStat}>{routeGroup.activityCount} activities</Text>
              <Text style={styles.heroStatDivider}>·</Text>
              <Text style={styles.heroStat}>
                {routeStats.lastDate ? formatRelativeDate(routeStats.lastDate) : '-'}
              </Text>
            </View>
          </View>
        </View>

        {/* Content below hero */}
        <View style={styles.contentSection}>
          {/* Performance progression chart - scrubbing highlights map */}
          {chartData.length >= 2 && (
            <View style={styles.chartSection}>
              <UnifiedPerformanceChart
                chartData={chartData}
                activityType={routeGroup.type}
                isDark={isDark}
                minSpeed={minSpeed}
                maxSpeed={maxSpeed}
                bestIndex={bestIndex}
                hasReverseRuns={hasReverseRuns}
                tooltipBadgeType="match"
                onActivitySelect={handleActivitySelect}
                summaryStats={summaryStats}
                selectedActivityId={highlightedActivityId}
                bestForwardRecord={bestForwardRecord}
                bestReverseRecord={bestReverseRecord}
                forwardStats={forwardStats}
                reverseStats={reverseStats}
              />
            </View>
          )}

          {/* Activities list */}
          <View style={styles.activitiesSection}>
            <View style={styles.activitiesHeader}>
              <Text style={[styles.sectionTitle, isDark && styles.textLight]}>
                {t('settings.activities')}
              </Text>
              {/* Legend */}
              <View style={styles.legend}>
                <View style={styles.legendItem}>
                  <View style={[styles.legendIndicator, { backgroundColor: colors.chartGold }]} />
                  <MaterialCommunityIcons name="trophy" size={12} color={colors.chartGold} />
                  <Text style={[styles.legendText, isDark && styles.textMuted]}>
                    {t('routes.pr')}
                  </Text>
                </View>
              </View>
            </View>

            {routeActivities.length === 0 ? (
              <Text style={[styles.emptyActivities, isDark && styles.textMuted]}>
                {t('feed.noActivities')}
              </Text>
            ) : (
              <View style={[styles.activitiesCard, isDark && styles.activitiesCardDark]}>
                {routeActivities.map((activity, index) => {
                  const perfData = performancesMap[activity.id];
                  // Get match data from performances array
                  const matchPercentage = perfData?.matchPercentage;
                  const direction = perfData?.direction;
                  const routeDistance = routeGroup?.signature?.distance;
                  // Get route points from signature for this activity
                  const activityPoints = signatures[activity.id]?.points;
                  // Get representative route points (full route, not truncated consensus)
                  const routePoints = routeGroup?.signature?.points;
                  const isHighlighted = highlightedActivityId === activity.id;
                  // Determine if this is the best performance (PR)
                  const isBest = bestPerformance?.activityId === activity.id;
                  // Get rank from performances array (returns undefined if not found)
                  const rankIdx = performances.findIndex((p) => p.activityId === activity.id);
                  const rank = rankIdx >= 0 ? rankIdx + 1 : undefined;
                  // Calculate delta from PR (time difference in seconds)
                  const activityDuration = perfData?.duration;
                  const bestDuration = bestPerformance?.duration;
                  const deltaFromPR =
                    activityDuration !== undefined &&
                    bestDuration !== undefined &&
                    Number.isFinite(activityDuration) &&
                    Number.isFinite(bestDuration)
                      ? activityDuration - bestDuration
                      : undefined;
                  return (
                    <React.Fragment key={activity.id}>
                      <Pressable
                        onPressIn={() => setHighlightedActivityId(activity.id)}
                        onPressOut={() => setHighlightedActivityId(null)}
                      >
                        <ActivityRow
                          activity={activity}
                          isDark={isDark}
                          isMetric={isMetric}
                          matchPercentage={matchPercentage}
                          direction={direction}
                          activityPoints={activityPoints}
                          routePoints={routePoints}
                          isHighlighted={isHighlighted}
                          routeDistance={routeDistance}
                          isBest={isBest}
                          rank={rank}
                          deltaFromPR={deltaFromPR}
                          speed={perfData?.speed}
                          duration={perfData?.duration}
                          bestSpeed={bestPerformance?.speed}
                        />
                      </Pressable>
                    </React.Fragment>
                  );
                })}
              </View>
            )}
          </View>

          {/* Export GPX button */}
          {consensusPoints && consensusPoints.length > 0 && (
            <TouchableOpacity
              testID="route-export-gpx"
              style={[styles.exportGpxButton, isDark && styles.exportGpxButtonDark]}
              onPress={() =>
                exportGpx({
                  name: customName || routeGroup?.name || 'Route',
                  points: consensusPoints.map((p) => ({
                    latitude: p.lat,
                    longitude: p.lng,
                  })),
                  sport: engineGroup?.sportType,
                })
              }
              disabled={gpxExporting}
              activeOpacity={0.7}
            >
              <MaterialCommunityIcons
                name={gpxExporting ? 'progress-download' : 'download'}
                size={20}
                color={colors.textOnPrimary}
              />
              <Text style={styles.exportGpxButtonText}>
                {gpxExporting ? t('export.exporting') : t('export.gpx')}
              </Text>
            </TouchableOpacity>
          )}

          {/* Data range footer */}
          <DataRangeFooter days={cacheDays} isDark={isDark} />

          {debugEnabled &&
            engineGroup &&
            (() => {
              const pageMetrics = getPageMetrics();
              const ffiEntries = pageMetrics.reduce<
                Record<string, { calls: number; totalMs: number; maxMs: number }>
              >((acc, m) => {
                if (!acc[m.name]) acc[m.name] = { calls: 0, totalMs: 0, maxMs: 0 };
                acc[m.name].calls++;
                acc[m.name].totalMs += m.durationMs;
                acc[m.name].maxMs = Math.max(acc[m.name].maxMs, m.durationMs);
                return acc;
              }, {});
              const warnings: Array<{ level: 'warn' | 'error'; message: string }> = [];
              const actCount = engineGroup.activityIds.length;
              if (actCount > 500)
                warnings.push({ level: 'error', message: `${actCount} activities (>500)` });
              else if (actCount > 100)
                warnings.push({ level: 'warn', message: `${actCount} activities (>100)` });
              for (const [name, m] of Object.entries(ffiEntries)) {
                if (m.maxMs > 200)
                  warnings.push({
                    level: 'error',
                    message: `${name}: ${m.maxMs.toFixed(0)}ms (max)`,
                  });
              }
              return (
                <>
                  {warnings.length > 0 && <DebugWarningBanner warnings={warnings} />}
                  <DebugInfoPanel
                    isDark={isDark}
                    entries={[
                      {
                        label: 'ID',
                        value:
                          engineGroup.groupId.length > 20
                            ? engineGroup.groupId.slice(0, 20) + '...'
                            : engineGroup.groupId,
                      },
                      { label: 'Type', value: engineGroup.sportType || '-' },
                      { label: 'Activities', value: String(actCount) },
                      {
                        label: 'Avg Distance',
                        value:
                          routeStats.distance > 0
                            ? formatDistance(routeStats.distance, isMetric)
                            : '-',
                      },
                      {
                        label: 'Best Time',
                        value:
                          bestPerformance?.duration != null
                            ? formatDuration(bestPerformance.duration)
                            : '-',
                      },
                      ...Object.entries(ffiEntries).map(([name, m]) => ({
                        label: name,
                        value: `${m.calls}x ${m.totalMs.toFixed(0)}ms`,
                      })),
                    ]}
                  />
                </>
              );
            })()}
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
    paddingBottom: spacing.xl + TAB_BAR_SAFE_PADDING,
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
    fontSize: typography.statsValue.fontSize,
    fontWeight: '700',
    color: colors.textOnDark,
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
    fontSize: typography.cardTitle.fontSize,
    fontWeight: '600',
    color: colors.textOnDark,
    paddingVertical: spacing.sm,
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
  // Export GPX button
  exportGpxButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
    borderRadius: 24,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    marginTop: spacing.lg,
    marginBottom: spacing.md,
    gap: spacing.xs,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 3,
  },
  exportGpxButtonDark: {
    backgroundColor: colors.primary,
  },
  exportGpxButtonText: {
    color: colors.textOnPrimary,
    fontSize: 15,
    fontWeight: '600' as const,
  },
  // Content section below hero
  contentSection: {
    padding: layout.screenPadding,
    paddingTop: spacing.lg,
  },
  // Summary stats card
  summaryCard: {
    backgroundColor: colors.surface,
    borderRadius: layout.borderRadius,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  summaryCardDark: {
    backgroundColor: darkColors.surface,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  summaryItem: {
    flex: 1,
  },
  summaryLabel: {
    fontSize: typography.caption.fontSize,
    color: colors.textSecondary,
    marginBottom: 2,
  },
  summaryValue: {
    fontSize: typography.body.fontSize,
    fontWeight: '600',
    color: colors.textPrimary,
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
  activitiesSection: {
    marginBottom: spacing.xl,
  },
  sectionTitle: {
    fontSize: typography.body.fontSize,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  activitiesHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  legend: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  legendIndicator: {
    width: 3,
    height: 12,
    borderRadius: 1.5,
  },
  legendText: {
    fontSize: typography.caption.fontSize,
    color: colors.textSecondary,
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
    // Individual rows now have their own card styling
  },
  activitiesCardDark: {
    // Individual rows now have their own card styling
  },
  activityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.sm,
    gap: spacing.sm,
    backgroundColor: colors.surface,
    marginBottom: spacing.xs,
    borderRadius: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 2,
    elevation: 1,
  },
  activityRowDark: {
    backgroundColor: darkColors.surface,
  },
  activityRowHighlighted: {
    backgroundColor: 'rgba(0, 188, 212, 0.1)',
  },
  activityRowPressed: {
    opacity: 0.7,
  },
  activityRowBest: {
    borderLeftWidth: 3,
    borderLeftColor: colors.chartGold,
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
  matchBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: layout.borderRadiusSm,
    gap: 2,
  },
  matchText: {
    fontSize: typography.label.fontSize,
    fontWeight: '600',
  },
  prBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: layout.borderRadiusSm,
    gap: 2,
  },
  prText: {
    fontSize: typography.label.fontSize,
    fontWeight: '700',
    color: colors.textOnDark,
  },
  rankBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: layout.borderRadiusSm,
  },
  rankText: {
    fontSize: typography.caption.fontSize,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  activityDate: {
    fontSize: typography.caption.fontSize,
    color: colors.textSecondary,
  },
  activityMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 1,
  },
  overlapText: {
    fontSize: typography.label.fontSize,
    color: colors.textSecondary,
    opacity: 0.7,
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
  deltaText: {
    fontSize: typography.caption.fontSize,
    fontWeight: '600',
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

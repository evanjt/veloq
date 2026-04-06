import React, { useMemo, useCallback, useState, useEffect, useRef } from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  Dimensions,
  StatusBar,
  TouchableOpacity,
  TextInput,
  Keyboard,
  Alert,
} from 'react-native';
import { Text } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, router } from 'expo-router';
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
import { getAllRouteDisplayNames } from '@/hooks/routes/useRouteGroups';
import { TAB_BAR_SAFE_PADDING, ScreenErrorBoundary } from '@/components/ui';
import { getRouteEngine } from '@/lib/native/routeEngine';

import {
  RouteMapView,
  DataRangeFooter,
  DebugInfoPanel,
  DebugWarningBanner,
} from '@/components/routes';
import { useDebugStore } from '@/providers';
import { useFFITimer } from '@/hooks/debug/useFFITimer';
import { SectionScatterChart } from '@/components/section';
import {
  formatDistance,
  formatRelativeDate,
  getActivityIcon,
  getActivityColor,
  formatDuration,
  isRunningActivity,
} from '@/lib';
import { colors, darkColors, spacing, layout, typography } from '@/theme';
import type { ActivityType, RoutePoint, PerformanceDataPoint } from '@/types';
import { toActivityType } from '@/types/routes';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');
const MAP_HEIGHT = Math.round(SCREEN_HEIGHT * 0.45); // 45% of screen for hero map

export default function RouteDetailScreen() {
  // Performance timing
  const perfEndRef = useRef<(() => void) | null>(null);
  perfEndRef.current = logScreenRender('RouteDetailScreen');
  useEffect(() => {
    perfEndRef.current?.();
  });

  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { isDark } = useTheme();
  const isMetric = useMetricSystem();
  const insets = useSafeAreaInsets();

  // Get cached date range from sync store (consolidated calculation)
  const cacheDays = useCacheDays();
  const debugEnabled = useDebugStore((s) => s.enabled);
  const { getPageMetrics } = useFFITimer();
  const { exportGpx, exporting: gpxExporting } = useGpxExport();

  // State for highlighted activity (chart scrubbing → map)
  const [highlightedActivityId, setHighlightedActivityId] = useState<string | null>(null);
  const [highlightedActivityPoints, setHighlightedActivityPoints] = useState<
    RoutePoint[] | undefined
  >(undefined);

  // Excluded activities state
  const [showExcluded, setShowExcluded] = useState(false);
  const [excludedActivityIds, setExcludedActivityIds] = useState<Set<string>>(new Set());

  // State for route renaming
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [customName, setCustomName] = useState<string | null>(null);
  const nameInputRef = useRef<TextInput>(null);

  useEffect(() => {
    if (id) {
      const engine = getRouteEngine();
      const names = engine?.getAllRouteNames() ?? {};
      if (names[id]) {
        setCustomName(names[id]);
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

  // Sport type selector state
  const [selectedSportType, setSelectedSportType] = useState<string | undefined>(undefined);

  // Rename function - calls engine directly (no need to load all groups)
  const renameRoute = useCallback((routeId: string, name: string) => {
    const engine = getRouteEngine();
    if (!engine) {
      throw new Error('Route engine not initialized');
    }
    engine.setRouteName(routeId, name);
    // Engine fires 'groups' event which triggers subscribers to refresh
  }, []);

  // Get unfiltered metrics to derive available sport types
  const { activityMetrics: allMetrics } = useRoutePerformances(id, engineGroup?.groupId);

  // Compute available sport types from all activity metrics
  const availableSportTypes = useMemo(() => {
    const types = new Set<string>();
    for (const m of allMetrics.values()) {
      if (m.sportType) types.add(m.sportType);
    }
    const sorted = Array.from(types).sort();
    return sorted;
  }, [allMetrics]);

  // Auto-select the group's primary sport type when sport types are available
  useEffect(() => {
    if (availableSportTypes.length > 1 && selectedSportType === undefined && engineGroup) {
      setSelectedSportType(engineGroup.sportType || availableSportTypes[0]);
    }
  }, [availableSportTypes, selectedSportType, engineGroup]);

  // Get performance data filtered by selected sport type (no API call needed)
  // Activity metrics are cached in Rust engine's in-memory HashMap
  const sportFilter = availableSportTypes.length > 1 ? selectedSportType : undefined;
  const {
    performances,
    best: bestPerformance,
    bestForwardRecord,
    bestReverseRecord,
    forwardStats,
    reverseStats,
    currentRank,
  } = useRoutePerformances(id, engineGroup?.groupId, sportFilter);

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
      if (__DEV__) console.error('Failed to save route name:', error);
    }
  }, [editName, id, renameRoute, t]);

  // Handle canceling the edit
  const handleCancelEdit = useCallback(() => {
    setIsEditing(false);
    setEditName('');
    Keyboard.dismiss();
  }, []);

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

  // Prepare chart data using Rust engine performance data
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
          sectionTime: Math.round(perf.duration),
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

  // Compute stats from performances
  const routeStats = useMemo(() => {
    if (performances.length === 0) return { distance: 0, lastDate: '' };
    const distances = performances.map((p) => p.distance || 0);
    const avgDistance = distances.reduce((a, b) => a + b, 0) / distances.length;
    const dates = performances.map((p) => p.date.getTime());
    const lastDate = new Date(Math.max(...dates)).toISOString();
    return { distance: avgDistance, lastDate };
  }, [performances]);

  // Load excluded activity IDs for this route
  useEffect(() => {
    if (!id) return;
    const engine = getRouteEngine();
    if (!engine) return;
    const ids = engine.getExcludedRouteActivityIds(id);
    setExcludedActivityIds(new Set(ids));
  }, [id]);

  const handleExcludeActivity = useCallback(
    (activityId: string) => {
      if (!id) return;
      const engine = getRouteEngine();
      if (!engine) return;
      engine.excludeActivityFromRoute(id, activityId);
      setExcludedActivityIds((prev) => new Set([...prev, activityId]));
    },
    [id]
  );

  const handleIncludeActivity = useCallback(
    (activityId: string) => {
      if (!id) return;
      const engine = getRouteEngine();
      if (!engine) return;
      engine.includeActivityInRoute(id, activityId);
      setExcludedActivityIds((prev) => {
        const next = new Set(prev);
        next.delete(activityId);
        return next;
      });
    },
    [id]
  );

  const handleToggleShowExcluded = useCallback(() => {
    setShowExcluded((v) => !v);
  }, []);

  // Enrich chart data with PR info for tooltip display
  const enrichedChartData = useMemo(() => {
    if (chartData.length === 0) return chartData;

    let fwdBestTime: number | undefined;
    let fwdBestSpeed: number | undefined;
    let revBestTime: number | undefined;
    let revBestSpeed: number | undefined;

    for (const p of chartData) {
      if (p.direction === 'reverse') {
        if (revBestSpeed === undefined || p.speed > revBestSpeed) {
          revBestSpeed = p.speed;
          revBestTime = p.sectionTime;
        }
      } else {
        if (fwdBestSpeed === undefined || p.speed > fwdBestSpeed) {
          fwdBestSpeed = p.speed;
          fwdBestTime = p.sectionTime;
        }
      }
    }

    return chartData.map((p) => {
      const isReverse = p.direction === 'reverse';
      const dirBestTime = isReverse ? revBestTime : fwdBestTime;
      const dirBestSpeed = isReverse ? revBestSpeed : fwdBestSpeed;
      const isBest = dirBestSpeed !== undefined && p.speed === dirBestSpeed;
      return {
        ...p,
        bestTime: dirBestTime,
        bestSpeed: dirBestSpeed,
        isBest,
        sectionTime: Math.round(p.sectionTime ?? 0) || undefined,
      };
    });
  }, [chartData]);

  // Build chart data points for excluded activities
  const excludedChartData = useMemo((): (PerformanceDataPoint & { x: number })[] => {
    if (!showExcluded || excludedActivityIds.size === 0 || !id) return [];
    try {
      const engine = getRouteEngine();
      if (!engine) return [];
      const result = engine.getExcludedRoutePerformances(id, sportFilter);
      if (!result?.performances?.length) return [];

      return result.performances
        .filter((p: any) => Number.isFinite(p.speed))
        .map((p: any) => ({
          x: 0,
          id: p.activityId,
          activityId: p.activityId,
          speed: p.speed,
          date: fromUnixSeconds(p.date) ?? new Date(),
          activityName: p.name,
          direction: (p.direction === 'reverse' ? 'reverse' : 'same') as 'same' | 'reverse',
          sectionTime: Math.round(p.duration),
          matchPercentage: p.matchPercentage,
          isExcluded: true,
        }));
    } catch (e) {
      if (__DEV__) console.warn('[RouteDetail] getExcludedRoutePerformances failed:', e);
      return [];
    }
  }, [showExcluded, excludedActivityIds, id, sportFilter]);

  // Merge excluded points into chart data when showing excluded
  const combinedChartData = useMemo(() => {
    if (excludedChartData.length === 0) return enrichedChartData;
    return [...enrichedChartData, ...excludedChartData];
  }, [enrichedChartData, excludedChartData]);

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

  // Use selected sport type for color/icon when filtering
  const displayType = sportFilter ? toActivityType(sportFilter) : routeGroup.type;
  const activityColor = getActivityColor(displayType);
  const iconName = getActivityIcon(displayType);
  // Map data check - have activities if we have performances
  const hasMapData = performances.length > 0;

  return (
    <ScreenErrorBoundary screenName="Route Detail">
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
            <View testID="route-detail-map" style={styles.mapContainer}>
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
                    {
                      height: MAP_HEIGHT,
                      backgroundColor: activityColor + '20',
                    },
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
                      testID="route-rename-input"
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
                    <TouchableOpacity
                      testID="route-rename-save"
                      onPress={handleSaveName}
                      style={styles.editNameButton}
                    >
                      <MaterialCommunityIcons name="check" size={20} color={colors.success} />
                    </TouchableOpacity>
                    <TouchableOpacity onPress={handleCancelEdit} style={styles.editNameButton}>
                      <MaterialCommunityIcons name="close" size={20} color={colors.error} />
                    </TouchableOpacity>
                  </View>
                ) : (
                  <TouchableOpacity
                    testID="route-rename-button"
                    onPress={handleStartEditing}
                    style={styles.nameEditTouchable}
                    activeOpacity={0.7}
                  >
                    <Text testID="route-detail-name" style={styles.heroRouteName} numberOfLines={1}>
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
              <View testID="route-detail-stats" style={styles.heroStatsRow}>
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

          {/* Sport type selector — shown when route has multiple sport types */}
          {availableSportTypes.length > 1 && (
            <View style={styles.sportTypeSelector}>
              {availableSportTypes.map((st) => {
                const isSelected = st === selectedSportType;
                const sportColor = getActivityColor(toActivityType(st));
                return (
                  <TouchableOpacity
                    key={st}
                    style={[
                      styles.sportTypePill,
                      isDark && styles.sportTypePillDark,
                      isSelected && { backgroundColor: sportColor },
                    ]}
                    onPress={() => setSelectedSportType(st)}
                    activeOpacity={0.7}
                  >
                    <MaterialCommunityIcons
                      name={getActivityIcon(toActivityType(st))}
                      size={16}
                      color={
                        isSelected
                          ? colors.textOnDark
                          : isDark
                            ? darkColors.textSecondary
                            : colors.textSecondary
                      }
                    />
                    <Text
                      style={[
                        styles.sportTypePillText,
                        isSelected
                          ? { color: colors.textOnDark }
                          : isDark
                            ? { color: darkColors.textSecondary }
                            : { color: colors.textSecondary },
                      ]}
                    >
                      {st}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}

          {/* Content below hero */}
          <View style={styles.contentSection}>
            {/* Performance scatter chart with eye toggle */}
            {combinedChartData.length >= 1 && (
              <View testID="route-detail-chart" style={styles.chartSection}>
                <SectionScatterChart
                  chartData={combinedChartData}
                  activityType={displayType}
                  isDark={isDark}
                  bestForwardRecord={bestForwardRecord}
                  bestReverseRecord={bestReverseRecord}
                  forwardStats={forwardStats}
                  reverseStats={reverseStats}
                  onActivitySelect={handleActivitySelect}
                  onExcludeActivity={handleExcludeActivity}
                  onIncludeActivity={handleIncludeActivity}
                  showExcluded={showExcluded}
                  hasExcluded={excludedActivityIds.size > 0}
                  onToggleShowExcluded={handleToggleShowExcluded}
                />
              </View>
            )}

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
                const warnings: Array<{
                  level: 'warn' | 'error';
                  message: string;
                }> = [];
                const actCount = engineGroup.activityIds.length;
                if (actCount > 500)
                  warnings.push({
                    level: 'error',
                    message: `${actCount} activities (>500)`,
                  });
                else if (actCount > 100)
                  warnings.push({
                    level: 'warn',
                    message: `${actCount} activities (>100)`,
                  });
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
    </ScreenErrorBoundary>
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
  // Sport type selector
  sportTypeSelector: {
    flexDirection: 'row',
    paddingHorizontal: layout.screenPadding,
    paddingTop: spacing.md,
    gap: spacing.sm,
  },
  sportTypePill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: colors.surface,
    gap: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  sportTypePillDark: {
    backgroundColor: darkColors.surface,
  },
  sportTypePillText: {
    fontSize: typography.label.fontSize,
    fontWeight: '600',
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
});

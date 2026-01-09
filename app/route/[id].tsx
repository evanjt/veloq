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
  TextInput,
  Keyboard,
} from 'react-native';
import { Text, ActivityIndicator } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, router, Href } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { LinearGradient } from 'expo-linear-gradient';
import { useActivities, useRouteGroups, useConsensusRoute } from '@/hooks';

// Lazy load native module to avoid bundler errors
function getRouteEngine() {
  try {
    return require('route-matcher-native').routeEngine;
  } catch {
    return null;
  }
}
import { RouteMapView, MiniTraceView } from '@/components/routes';
import { UnifiedPerformanceChart } from '@/components/routes/performance';
import {
  formatDistance,
  formatRelativeDate,
  getActivityIcon,
  getActivityColor,
  formatDuration,
} from '@/lib';
import { colors, darkColors, spacing, layout, typography, opacity } from '@/theme';
import type { Activity, ActivityType, RoutePoint, PerformanceDataPoint } from '@/types';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');
const MAP_HEIGHT = Math.round(SCREEN_HEIGHT * 0.45); // 45% of screen for hero map

// Direction colors - using theme for consistency
const REVERSE_COLOR = colors.reverseDirection; // Pink
const SAME_COLOR_DEFAULT = colors.sameDirection; // Blue (same direction)
const CONSENSUS_COLOR = colors.consensusRoute; // Orange for the consensus/main route

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
  const traceColor = isHighlighted ? '#00BCD4' : isReverse ? REVERSE_COLOR : '#2196F3';
  const badgeColor = isReverse ? REVERSE_COLOR : colors.success;

  // Format overlap distance for display (e.g., "200m / 1.0km")
  const overlapDisplay = useMemo(() => {
    if (!overlapDistance || !routeDistance) return null;
    const overlapKm = overlapDistance / 1000;
    const routeKm = routeDistance / 1000;
    // Show in meters if < 1km, otherwise km
    const overlapStr =
      overlapKm < 1 ? `${Math.round(overlapDistance)}m` : `${overlapKm.toFixed(1)}km`;
    const routeStr = routeKm < 1 ? `${Math.round(routeDistance)}m` : `${routeKm.toFixed(1)}km`;
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
      {/* Mini trace showing route reference (gold) vs activity trace */}
      {activityPoints && activityPoints.length > 1 ? (
        <MiniTraceView
          primaryPoints={activityPoints}
          referencePoints={routePoints}
          primaryColor={traceColor}
          referenceColor={CONSENSUS_COLOR}
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
            <Text style={[styles.overlapText, isDark && styles.textMuted]}>{overlapDisplay}</Text>
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
      <MaterialCommunityIcons name="chevron-right" size={20} color={isDark ? '#555' : '#CCC'} />
    </Pressable>
  );
}

export default function RouteDetailScreen() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const insets = useSafeAreaInsets();

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

  // Get route groups from engine
  const { groups: allGroups } = useRouteGroups({ minActivities: 1 });
  const engineGroup = useMemo(() => allGroups.find((g) => g.id === id) || null, [allGroups, id]);

  // Get consensus route points from Rust engine
  const { points: consensusPoints } = useConsensusRoute(id);

  // Create a compatible routeGroup object with expected properties
  // Note: signature is populated later once routeStats is computed
  const routeGroupBase = useMemo(() => {
    if (!engineGroup) return null;
    return {
      id: engineGroup.id,
      name: engineGroup.name || `${engineGroup.type || 'Ride'} Route`, // Use the generated name from useRouteGroups
      type: engineGroup.type || 'Ride',
      activityIds: engineGroup.activityIds,
      activityCount: engineGroup.activityCount,
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
  const handleSaveName = useCallback(() => {
    const trimmedName = editName.trim();
    if (trimmedName && id) {
      const engine = getRouteEngine();
      if (engine) engine.setRouteName(id, trimmedName);
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

  // Match data is not yet available from Rust engine
  const matches: Record<
    string,
    { direction: string; matchPercentage: number; overlapDistance?: number }
  > = {};

  // Get signature points for all activities in this group from Rust engine
  // Depends on engineGroup to ensure we re-fetch when engine data is ready
  const signatures = useMemo(() => {
    if (!id || !engineGroup) return {};
    try {
      const engine = getRouteEngine();
      if (!engine) return {};
      const sigMap = engine.getSignaturesForGroup(id) as Record<
        string,
        Array<{ lat: number; lng: number }>
      >;
      // Convert to expected format: { activity_id: { points: [{lat, lng}, ...] } }
      const result: Record<string, { points: Array<{ lat: number; lng: number }> }> = {};
      for (const [activityId, points] of Object.entries(sigMap)) {
        result[activityId] = { points };
      }
      return result;
    } catch {
      return {};
    }
  }, [id, engineGroup]);

  // Fetch activities for the past year (route groups can contain older activities)
  const { data: allActivities, isLoading } = useActivities({
    days: 365,
    includeStats: false,
  });

  // Filter to only activities in this route group (deduplicated)
  const routeActivities = React.useMemo(() => {
    if (!routeGroupBase || !allActivities) return [];
    const idsSet = new Set(routeGroupBase.activityIds);
    // Filter and deduplicate by ID (in case API returns duplicates)
    const seen = new Set<string>();
    return allActivities.filter((a) => {
      if (!idsSet.has(a.id) || seen.has(a.id)) return false;
      seen.add(a.id);
      return true;
    });
  }, [routeGroupBase, allActivities]);

  // Prepare chart data for UnifiedPerformanceChart
  // This is ONE point per activity - direction comes from route matching
  const { chartData, minSpeed, maxSpeed, bestIndex, hasReverseRuns } = useMemo(() => {
    const dataPoints: (PerformanceDataPoint & { x: number })[] = [];

    // Sort activities by date first
    const sortedActivities = [...routeActivities].sort(
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
      const activitySpeed = activity.moving_time > 0 ? activity.distance / activity.moving_time : 0;

      // Each activity = ONE data point
      dataPoints.push({
        x: 0,
        id: activity.id,
        activityId: activity.id,
        speed: activitySpeed,
        date: new Date(activity.start_date_local),
        activityName: activity.name,
        direction,
        matchPercentage,
        lapNumber: 1,
        totalLaps: 1,
        lapPoints: activityPoints,
      });
    }

    // Re-index after collecting all points
    const indexed = dataPoints.map((d, idx) => ({ ...d, x: idx }));

    const speeds = indexed.map((d) => d.speed);
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
  }, [routeActivities, matches, signatures]);

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
              color={isDark ? '#FFFFFF' : colors.textPrimary}
            />
          </TouchableOpacity>
        </View>
        <View style={styles.emptyContainer}>
          <MaterialCommunityIcons
            name="map-marker-question-outline"
            size={48}
            color={isDark ? '#444' : '#CCC'}
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
                    placeholder={t('routes.routeNamePlaceholder')}
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
              <Text style={styles.heroStat}>{formatDistance(routeStats.distance)}</Text>
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
                selectedActivityId={highlightedActivityId}
              />
            </View>
          )}

          {/* Activities list */}
          <View style={styles.activitiesSection}>
            <Text style={[styles.sectionTitle, isDark && styles.textLight]}>
              {t('settings.activities')}
            </Text>

            {isLoading ? (
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="small" color={colors.primary} />
              </View>
            ) : routeActivities.length === 0 ? (
              <Text style={[styles.emptyActivities, isDark && styles.textMuted]}>
                {t('feed.noActivities')}
              </Text>
            ) : (
              <View style={[styles.activitiesCard, isDark && styles.activitiesCardDark]}>
                {routeActivities.map((activity, index) => {
                  const match = matches[activity.id];
                  // Representative activity doesn't have a match entry, show 100%
                  const isRepresentative = routeGroup?.activityIds[0] === activity.id;
                  const matchPercentage =
                    match?.matchPercentage ?? (isRepresentative ? 100 : undefined);
                  const direction = match?.direction ?? (isRepresentative ? 'same' : undefined);
                  // Get overlap distance - for representative, use route distance
                  const overlapDistance =
                    match?.overlapDistance ??
                    (isRepresentative ? routeGroup?.signature?.distance : undefined);
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
  divider: {
    height: 1,
    backgroundColor: opacity.overlay.light,
    marginLeft: 36 + spacing.md + spacing.md,
  },
  dividerDark: {
    backgroundColor: opacity.overlayDark.light,
  },
});

/**
 * Section detail page.
 * Shows a frequently-traveled section with all activities that traverse it.
 */

import React, { useMemo, useCallback, useState, useEffect, useRef, memo } from 'react';
import { useSyncDateRange } from '@/providers/SyncDateRangeStore';
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
  InteractionManager,
} from 'react-native';
import { Text, ActivityIndicator } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, router } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { LinearGradient } from 'expo-linear-gradient';
import {
  useActivities,
  useSectionPerformances,
  useCustomSection,
  useCustomSections,
  useTheme,
  type ActivitySectionRecord,
} from '@/hooks';
import { useSectionDetail, useGroupSummaries } from '@/hooks/routes/useRouteEngine';
import { getAllSectionDisplayNames } from '@/hooks/routes/useUnifiedSections';
import { createSharedStyles } from '@/styles';
import { useDisabledSections } from '@/providers';
import { SectionMapView, MiniTraceView, DataRangeFooter } from '@/components/routes';
import { UnifiedPerformanceChart } from '@/components/routes/performance';
import { getRouteEngine } from '@/lib/native/routeEngine';
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
import type {
  Activity,
  ActivityType,
  RoutePoint,
  FrequentSection,
  PerformanceDataPoint,
} from '@/types';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');
const MAP_HEIGHT = Math.round(SCREEN_HEIGHT * 0.45);

// Direction colors - using theme for consistency
const REVERSE_COLOR = colors.reverseDirection;
const SAME_COLOR_DEFAULT = colors.sameDirection;

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
  /** Number of laps/traversals (for multi-lap display) */
  lapCount?: number;
  /** Actual section time in seconds (from stream data) */
  actualSectionTime?: number;
  /** Actual section pace in m/s (from stream data) */
  actualSectionPace?: number;
  /** Is this the best performance (PR)? */
  isBest?: boolean;
  /** Rank of this performance (1 = best) */
  rank?: number;
  /** Best time in seconds (for delta calculation) */
  bestTime?: number;
  /** Stable callback for highlight - receives activity ID, pass null to clear */
  onHighlightChange?: (activityId: string | null) => void;
}

// Memoized activity row to prevent unnecessary re-renders
const ActivityRow = memo(function ActivityRow({
  activity,
  isDark,
  direction,
  activityPoints,
  sectionPoints,
  isHighlighted,
  sectionDistance,
  lapCount,
  actualSectionTime,
  actualSectionPace,
  isBest = false,
  rank,
  bestTime,
  onHighlightChange,
}: ActivityRowProps) {
  const handlePress = useCallback(() => {
    router.push(`/activity/${activity.id}`);
  }, [activity.id]);

  // Create stable callbacks using activity.id (captured in closure)
  const handlePressIn = useCallback(() => {
    onHighlightChange?.(activity.id);
  }, [onHighlightChange, activity.id]);

  const handlePressOut = useCallback(() => {
    onHighlightChange?.(null);
  }, [onHighlightChange]);

  const isReverse = direction === 'reverse';
  const traceColor = isHighlighted
    ? colors.chartCyan
    : isReverse
      ? REVERSE_COLOR
      : colors.sameDirection;
  const activityColor = getActivityColor(activity.type);

  // Use actual section time/pace if available, otherwise fall back to proportional estimate
  const displayDistance = sectionDistance || activity.distance;
  let sectionTime: number;
  let sectionSpeed: number;

  if (actualSectionTime !== undefined && actualSectionPace !== undefined) {
    // Use actual measured values
    sectionTime = Math.round(actualSectionTime);
    sectionSpeed = actualSectionPace;
  } else {
    // Fall back to proportional estimate
    sectionTime =
      sectionDistance && activity.distance > 0
        ? Math.round(activity.moving_time * (sectionDistance / activity.distance))
        : activity.moving_time;
    sectionSpeed = sectionTime > 0 ? displayDistance / sectionTime : 0;
  }

  const showPace = isRunningActivity(activity.type);
  const showLapCount = lapCount !== undefined && lapCount > 1;

  // Calculate delta from best time
  const delta = useMemo(() => {
    if (bestTime === undefined || sectionTime === undefined || sectionTime <= 0) return null;
    const diff = sectionTime - bestTime;
    if (Math.abs(diff) < 1) return null; // Don't show for < 1s difference
    return diff;
  }, [bestTime, sectionTime]);

  // Format delta as +/-MM:SS or +/-SS
  const formatDelta = (seconds: number): string => {
    const absSeconds = Math.abs(seconds);
    const sign = seconds > 0 ? '+' : '-';
    if (absSeconds >= 60) {
      const mins = Math.floor(absSeconds / 60);
      const secs = Math.floor(absSeconds % 60);
      return `${sign}${mins}:${secs.toString().padStart(2, '0')}`;
    }
    return `${sign}${Math.floor(absSeconds)}s`;
  };

  return (
    <Pressable
      onPress={handlePress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      style={({ pressed }) => [
        styles.activityRow,
        isDark && styles.activityRowDark,
        isHighlighted && styles.activityRowHighlighted,
        pressed && styles.activityRowPressed,
      ]}
    >
      {activityPoints && activityPoints.length > 1 ? (
        <MiniTraceView
          primaryPoints={activityPoints}
          referencePoints={sectionPoints}
          primaryColor={traceColor}
          referenceColor={colors.consensusRoute}
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
          {/* PR badge for best performance */}
          {isBest && (
            <View style={[styles.prBadge, { backgroundColor: colors.primary }]}>
              <MaterialCommunityIcons name="trophy" size={12} color={colors.textOnDark} />
              <Text style={styles.prText}>PR</Text>
            </View>
          )}
          {/* Rank badge for non-best performances (top 10) */}
          {!isBest && rank !== undefined && rank <= 10 && (
            <View style={[styles.rankBadge, { backgroundColor: colors.textSecondary + '20' }]}>
              <Text
                style={[
                  styles.rankText,
                  {
                    color: isDark ? colors.textSecondary : colors.textSecondary,
                  },
                ]}
              >
                #{rank}
              </Text>
            </View>
          )}
          {isReverse && (
            <View style={[styles.directionBadge, { backgroundColor: REVERSE_COLOR + '15' }]}>
              <MaterialCommunityIcons name="swap-horizontal" size={10} color={REVERSE_COLOR} />
            </View>
          )}
          {showLapCount && (
            <View style={[styles.lapBadge, isDark && styles.lapBadgeDark]}>
              <Text style={[styles.lapBadgeText, isDark && styles.lapBadgeTextDark]}>
                {lapCount}x
              </Text>
            </View>
          )}
        </View>
        <View style={styles.activityMetaRow}>
          <Text style={[styles.activityDate, isDark && styles.textMuted]}>
            {formatRelativeDate(activity.start_date_local)}
          </Text>
          {showLapCount && (
            <Text style={[styles.traversalCount, isDark && styles.textMuted]}>
              · {lapCount} traversals
            </Text>
          )}
          {/* vs-PR delta */}
          {delta !== null && !isBest && (
            <Text style={[styles.deltaText, { color: delta <= 0 ? colors.success : colors.error }]}>
              {formatDelta(delta)}
            </Text>
          )}
        </View>
      </View>
      <View style={styles.activityStats}>
        <Text style={[styles.activityDistance, isDark && styles.textLight]}>
          {showPace ? formatPace(sectionSpeed) : formatSpeed(sectionSpeed)}
        </Text>
        <Text style={[styles.activityTime, isDark && styles.textMuted]}>
          {formatDuration(sectionTime)}
        </Text>
      </View>
      <MaterialCommunityIcons
        name="chevron-right"
        size={20}
        color={isDark ? darkColors.textMuted : colors.divider}
      />
    </Pressable>
  );
});

export default function SectionDetailScreen() {
  // Defer map loading until after interactions complete for faster perceived load
  useEffect(() => {
    const handle = InteractionManager.runAfterInteractions(() => {
      setMapReady(true);
    });
    return () => handle.cancel();
  }, []);

  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { isDark, colors: themeColors } = useTheme();
  const shared = createSharedStyles(isDark);
  const insets = useSafeAreaInsets();

  // Get cached date range for footer
  const syncOldest = useSyncDateRange((s) => s.oldest);
  const syncNewest = useSyncDateRange((s) => s.newest);
  const cacheDays = useMemo(() => {
    if (!syncOldest || !syncNewest) return 90; // default
    return Math.ceil(
      (new Date(syncNewest).getTime() - new Date(syncOldest).getTime()) / (1000 * 60 * 60 * 24)
    );
  }, [syncOldest, syncNewest]);

  const [highlightedActivityId, setHighlightedActivityId] = useState<string | null>(null);
  const [highlightedActivityPoints, setHighlightedActivityPoints] = useState<
    RoutePoint[] | undefined
  >(undefined);
  // Ref to track current highlighted activity (avoids stale closure in callbacks)
  const highlightedActivityIdRef = useRef<string | null>(null);
  // Track if user is actively scrubbing - used to defer expensive shadow track updates
  const [isScrubbing, setIsScrubbing] = useState(false);
  // Committed activity ID - only updates when scrubbing stops (for shadow track)
  const [committedActivityId, setCommittedActivityId] = useState<string | null>(null);
  // Pre-cached GPS tracks for fast scrubbing (loaded in background when section loads)
  const gpsTrackCacheRef = useRef<Map<string, [number, number][]>>(new Map());
  const [cacheReady, setCacheReady] = useState(false);
  // Activity traces computed from GPS tracks (for custom sections)
  const [computedActivityTraces, setComputedActivityTraces] = useState<
    Record<string, RoutePoint[]>
  >({});
  // Defer map loading until after first paint for faster perceived load
  const [mapReady, setMapReady] = useState(false);

  // State for section renaming
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [customName, setCustomName] = useState<string | null>(null);
  const nameInputRef = useRef<TextInput>(null);

  // Get section from engine (auto-detected) or custom sections storage
  // Custom section IDs start with "custom_" (e.g., "custom_1767268142052_qyfoos8")
  const isCustomId = id?.startsWith('custom_');

  // For auto-detected sections, use useSectionDetail which fetches full data on-demand (with LRU caching)
  const { section: engineSection } = useSectionDetail(!isCustomId ? id : null);

  // Pass the full ID - custom sections are stored with the "custom_" prefix
  const { section: customSection } = useCustomSection(isCustomId ? id : undefined);
  const { removeSection, renameSection } = useCustomSections();

  // Get route group summaries to compute routeIds for custom sections
  // Note: Group summaries don't include activityIds to save memory
  const { summaries: routeGroups } = useGroupSummaries({ minActivities: 1 });

  // Create a mapping from activity ID to route group IDs
  // Note: This is empty since summaries don't include activityIds
  // TODO: If routeIds are needed, fetch group details on-demand
  const activityToRouteIds = useMemo(() => {
    // Group summaries don't include activity IDs to save memory
    return new Map<string, string[]>();
  }, []);

  // Disabled sections state
  const { isDisabled, disable, enable } = useDisabledSections();
  const isSectionDisabled = id ? isDisabled(id) : false;

  // Check both sources - custom sections and engine-detected sections
  const section = useMemo(() => {
    // First check engine sections (fetched via useSectionDetail)
    if (!isCustomId && engineSection) {
      return engineSection;
    }

    // Check if it's a custom section and convert to FrequentSection shape
    if (customSection) {
      // Include source activity if not already in matches
      const matchActivityIds = customSection.matches.map((m) => m.activityId);
      const includeSourceActivity = !matchActivityIds.includes(customSection.sourceActivityId);

      const activityIds = includeSourceActivity
        ? [customSection.sourceActivityId, ...matchActivityIds]
        : matchActivityIds;

      const activityPortions = [
        // Include source activity portion if not in matches
        ...(includeSourceActivity
          ? [
              {
                activityId: customSection.sourceActivityId,
                startIndex: customSection.startIndex,
                endIndex: customSection.endIndex,
                distanceMeters: customSection.distanceMeters,
                direction: 'same' as const,
              },
            ]
          : []),
        // Include all match portions
        ...customSection.matches.map((m) => ({
          activityId: m.activityId,
          startIndex: m.startIndex,
          endIndex: m.endIndex,
          distanceMeters: m.distanceMeters ?? customSection.distanceMeters,
          direction: m.direction,
        })),
      ];

      // Compute routeIds by finding which routes contain this section's activities
      // Note: activityToRouteIds is empty since we use lightweight group summaries
      const routeIdSet = new Set<string>();
      for (const activityId of activityIds) {
        const routes = activityToRouteIds.get(activityId);
        if (routes) {
          for (const routeId of routes) {
            routeIdSet.add(routeId);
          }
        }
      }

      return {
        id: customSection.id,
        sportType: customSection.sportType,
        polyline: customSection.polyline,
        activityIds,
        activityPortions,
        routeIds: Array.from(routeIdSet),
        visitCount: activityIds.length,
        distanceMeters: customSection.distanceMeters,
        name: customSection.name,
      } as FrequentSection;
    }

    return null;
  }, [id, engineSection, customSection, isCustomId, activityToRouteIds]);

  // Merge computed activity traces into the section
  // Always use computedActivityTraces when available, as they use extractSectionTrace
  // which correctly extracts points near the section polyline (avoiding straight-line artifacts)
  const sectionWithTraces = useMemo(() => {
    if (!section) return null;

    // Always prefer computed traces (from extractSectionTrace) over pre-computed ones
    // Pre-computed activityTraces from Rust may use simple index slicing which creates
    // straight lines when the activity takes a different path between section entry/exit
    if (Object.keys(computedActivityTraces).length > 0) {
      return {
        ...section,
        activityTraces: computedActivityTraces,
      };
    }

    // Fall back to engine's activityTraces if we haven't computed our own yet
    if (section.activityTraces && Object.keys(section.activityTraces).length > 0) {
      return section;
    }

    return section;
  }, [section, computedActivityTraces]);

  // Compute activity traces using Rust engine's extractSectionTrace in background batches
  // This extracts points from each activity that are within proximity of the section polyline,
  // correctly handling cases where activities take different paths between entry/exit points
  // Works for both custom sections AND engine-detected sections
  // Runs in batches to avoid blocking the main thread
  useEffect(() => {
    if (!section || !section.activityIds.length) {
      setComputedActivityTraces({});
      return;
    }

    const engine = getRouteEngine();
    if (!engine) {
      setComputedActivityTraces({});
      return;
    }

    // Convert polyline to JSON string for Rust engine (do this once)
    const polylineJson = JSON.stringify(
      section.polyline.map((p) => ({
        latitude: p.lat,
        longitude: p.lng,
      }))
    );

    const activityIds = [...section.activityIds];
    let cancelled = false;
    const traces: Record<string, RoutePoint[]> = {};

    // Load ALL traces synchronously in one batch for fast availability
    // This ensures lapPoints is available when user selects a chart point
    // The FFI calls are fast (~10ms each) and we need them ready immediately
    const loadAllTraces = () => {
      if (cancelled) return;

      for (const activityId of activityIds) {
        if (cancelled) break;
        const extractedTrace = engine.extractSectionTrace(activityId, polylineJson);
        if (extractedTrace.length > 0) {
          traces[activityId] = extractedTrace.map((p) => ({
            lat: p.latitude,
            lng: p.longitude,
          }));
        }
      }

      if (!cancelled) {
        setComputedActivityTraces({ ...traces });
      }
    };

    // Run immediately - traces are needed for chart interaction
    loadAllTraces();

    return () => {
      cancelled = true;
    };
  }, [section]);

  // Load custom section name from Rust engine on mount
  useEffect(() => {
    if (id) {
      const engine = getRouteEngine();
      const name = engine?.getSectionName(id);
      if (name) {
        setCustomName(name);
      }
    }
  }, [id]);

  // Handle starting to edit the section name
  const handleStartEditing = useCallback(() => {
    const currentName = customName || section?.name || '';
    setEditName(currentName);
    setIsEditing(true);
    setTimeout(() => {
      nameInputRef.current?.focus();
    }, 100);
  }, [customName, section?.name]);

  // Handle saving the edited section name
  // Uses renameSection hook which invalidates React Query cache for consistent UI updates
  const handleSaveName = useCallback(() => {
    // Dismiss keyboard and close edit UI immediately for responsive feel
    Keyboard.dismiss();
    setIsEditing(false);

    const trimmedName = editName.trim();
    if (!trimmedName || !id) {
      return;
    }

    // Check uniqueness against ALL section names (custom + auto-generated)
    const allDisplayNames = getAllSectionDisplayNames();
    const isDuplicate = Object.entries(allDisplayNames).some(
      ([existingId, name]) => existingId !== id && name === trimmedName
    );

    if (isDuplicate) {
      Alert.alert(t('sections.duplicateNameTitle'), t('sections.duplicateNameMessage'));
      return;
    }

    // Update local state immediately for instant feedback
    setCustomName(trimmedName);

    // Fire rename in background - don't await, cache invalidation happens async
    renameSection(id, trimmedName).catch((error) => {
      console.error('Failed to save section name:', error);
    });
  }, [editName, id, renameSection, t]);

  // Handle canceling the edit
  const handleCancelEdit = useCallback(() => {
    setIsEditing(false);
    setEditName('');
    Keyboard.dismiss();
  }, []);

  // Handle deleting a custom section
  const handleDeleteSection = useCallback(() => {
    if (!id || !isCustomId) return;

    Alert.alert(t('sections.deleteSection'), t('sections.deleteSectionConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: async () => {
          try {
            await removeSection(id);
            router.back();
          } catch (error) {
            console.error('Failed to delete section:', error);
          }
        },
      },
    ]);
  }, [id, isCustomId, removeSection, t]);

  // Handle disabling/enabling an auto-detected section
  const handleToggleDisable = useCallback(() => {
    if (!id || isCustomId) return;

    if (isSectionDisabled) {
      // Re-enable
      enable(id);
    } else {
      // Disable with confirmation
      Alert.alert(t('sections.disableSection'), t('sections.disableSectionConfirm'), [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.disable'),
          onPress: () => disable(id),
        },
      ]);
    }
  }, [id, isCustomId, isSectionDisabled, enable, disable, t]);

  // Pre-cache all GPS tracks for activities in this section (for fast scrubbing)
  // Runs in background when section loads, populates gpsTrackCacheRef
  useEffect(() => {
    if (!section?.activityIds?.length) {
      gpsTrackCacheRef.current.clear();
      setCacheReady(false);
      return;
    }

    const engine = getRouteEngine();
    if (!engine) {
      setCacheReady(false);
      return;
    }

    // Clear previous cache
    gpsTrackCacheRef.current.clear();
    setCacheReady(false);

    // Load ALL GPS tracks synchronously for immediate availability
    // This ensures shadowTrack doesn't need FFI fallback when user selects a point
    const activityIds = section.activityIds;
    for (const activityId of activityIds) {
      const gpsPoints = engine.getGpsTrack(activityId);
      if (gpsPoints && gpsPoints.length > 0) {
        const track: [number, number][] = gpsPoints.map((p) => [p.latitude, p.longitude]);
        gpsTrackCacheRef.current.set(activityId, track);
      }
    }
    setCacheReady(true);

    return () => {
      gpsTrackCacheRef.current.clear();
      setCacheReady(false);
    };
  }, [section?.activityIds]);

  // Douglas-Peucker line simplification for fast map rendering
  // Reduces point count while preserving shape (tolerance ~5m at equator)
  const simplifyTrack = useCallback(
    (points: [number, number][], tolerance = 0.00005): [number, number][] => {
      if (points.length <= 2) return points;

      // Find the point with the maximum distance from the line between first and last
      let maxDist = 0;
      let maxIndex = 0;
      const [startLat, startLng] = points[0];
      const [endLat, endLng] = points[points.length - 1];

      for (let i = 1; i < points.length - 1; i++) {
        const [lat, lng] = points[i];
        // Perpendicular distance from point to line
        const dist =
          Math.abs(
            (endLng - startLng) * (startLat - lat) - (startLng - lng) * (endLat - startLat)
          ) / Math.sqrt((endLng - startLng) ** 2 + (endLat - startLat) ** 2);

        if (dist > maxDist) {
          maxDist = dist;
          maxIndex = i;
        }
      }

      // If max distance is greater than tolerance, recursively simplify
      if (maxDist > tolerance) {
        const left = simplifyTrack(points.slice(0, maxIndex + 1), tolerance);
        const right = simplifyTrack(points.slice(maxIndex), tolerance);
        return [...left.slice(0, -1), ...right];
      }

      // Otherwise, return just the endpoints
      return [points[0], points[points.length - 1]];
    },
    []
  );

  // Cache for simplified tracks (separate from full tracks)
  const simplifiedTrackCacheRef = useRef<Map<string, [number, number][]>>(new Map());

  // Compute shadow track directly from cache (no useEffect, no extra render)
  // Uses simplified geometry for fast MapLibre rendering
  const shadowTrack = useMemo(() => {
    if (!highlightedActivityId) return undefined;

    // Check simplified cache first
    const simplifiedCached = simplifiedTrackCacheRef.current.get(highlightedActivityId);
    if (simplifiedCached) {
      return simplifiedCached;
    }

    // Get full track from cache
    const cachedTrack = gpsTrackCacheRef.current.get(highlightedActivityId);
    if (cachedTrack) {
      const simplified = simplifyTrack(cachedTrack);
      simplifiedTrackCacheRef.current.set(highlightedActivityId, simplified);
      return simplified;
    }

    // Fallback: fetch from Rust if not cached yet
    const engine = getRouteEngine();
    if (!engine) return undefined;

    const gpsPoints = engine.getGpsTrack(highlightedActivityId);
    if (gpsPoints && gpsPoints.length > 0) {
      const track: [number, number][] = gpsPoints.map((p) => [p.latitude, p.longitude]);
      gpsTrackCacheRef.current.set(highlightedActivityId, track);
      const simplified = simplifyTrack(track);
      simplifiedTrackCacheRef.current.set(highlightedActivityId, simplified);
      return simplified;
    }

    return undefined;
  }, [highlightedActivityId, simplifyTrack]);

  // Track scrubbing state in ref for use in callbacks (avoids stale closure)
  const isScrubbingRef = useRef(false);

  const handleActivitySelect = useCallback(
    (activityId: string | null, activityPoints?: RoutePoint[]) => {
      highlightedActivityIdRef.current = activityId;
      setHighlightedActivityId(activityId);
      setHighlightedActivityPoints(activityPoints);
    },
    []
  );

  // Handle scrubbing state changes
  const handleScrubChange = useCallback((scrubbing: boolean) => {
    isScrubbingRef.current = scrubbing;
    setIsScrubbing(scrubbing);
    if (!scrubbing) {
      // Scrubbing stopped - commit the activity for the activities list highlight
      setCommittedActivityId(highlightedActivityIdRef.current);
    }
  }, []);

  // Map props for section trace - updates during scrubbing (fast, small polyline)
  // Shadow track still uses committedActivityId (stable during scrubbing) to avoid expensive updates
  const mapHighlightedActivityId = highlightedActivityId;
  const mapHighlightedLapPoints = highlightedActivityPoints;

  // Memoize activities list highlighted ID - only updates when NOT scrubbing
  // This prevents the activities list from re-rendering during scrubbing
  const listHighlightedActivityId = useMemo(() => {
    return isScrubbing ? committedActivityId : highlightedActivityId;
  }, [isScrubbing, committedActivityId, highlightedActivityId]);

  // Stable callback for ActivityRow highlight changes
  // This callback is memoized and won't change between renders, so it doesn't break ActivityRow's memo
  const handleRowHighlightChange = useCallback((activityId: string | null) => {
    setHighlightedActivityId(activityId);
  }, []);

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

  // Fetch actual section performance times from activity streams
  // This loads in the background - we show estimated times first, then update when ready
  const { records: performanceRecords, isLoading: isLoadingRecords } = useSectionPerformances(
    section,
    sectionActivities
  );

  // Show loading indicator while fetching performance data (but don't block the UI)
  const hasPerformanceData = performanceRecords && performanceRecords.length > 0;

  // Map of activity portions for direction lookup
  const portionMap = useMemo(() => {
    if (!section?.activityPortions) return new Map();
    return new Map(section.activityPortions.map((p) => [p.activityId, p]));
  }, [section?.activityPortions]);

  // Map of performance records for fast lookup (avoid .find() in render loop)
  const performanceRecordMap = useMemo(() => {
    if (!performanceRecords) return new Map<string, ActivitySectionRecord>();
    return new Map(performanceRecords.map((r) => [r.activityId, r]));
  }, [performanceRecords]);

  // Prepare chart data for UnifiedPerformanceChart
  // Uses actual section times from records when available, otherwise proportional estimate
  const { chartData, minSpeed, maxSpeed, bestIndex, hasReverseRuns } = useMemo(() => {
    if (!section)
      return {
        chartData: [],
        minSpeed: 0,
        maxSpeed: 1,
        bestIndex: 0,
        hasReverseRuns: false,
      };

    const dataPoints: (PerformanceDataPoint & { x: number })[] = [];

    // Create a map of records by activity ID for quick lookup
    const recordMap = new Map(performanceRecords?.map((r) => [r.activityId, r]) || []);

    // Sort activities by date
    const sortedActivities = [...sectionActivities].sort(
      (a, b) => new Date(a.start_date_local).getTime() - new Date(b.start_date_local).getTime()
    );

    let hasAnyReverse = false;

    for (const activity of sortedActivities) {
      const portion = portionMap.get(activity.id);
      const tracePoints = sectionWithTraces?.activityTraces?.[activity.id];
      const record = recordMap.get(activity.id);

      // Use actual data from record if available, otherwise use proportional estimate
      const sectionDistance =
        record?.sectionDistance || portion?.distanceMeters || section.distanceMeters;

      // If we have multiple laps from performance records, create a data point for each
      if (record && record.laps && record.laps.length > 0) {
        for (let lapIdx = 0; lapIdx < record.laps.length; lapIdx++) {
          const lap = record.laps[lapIdx];
          const direction = lap.direction || 'same';
          if (direction === 'reverse') hasAnyReverse = true;

          dataPoints.push({
            x: 0,
            id: `${activity.id}_lap${lapIdx}`,
            activityId: activity.id,
            speed: lap.pace,
            date: new Date(activity.start_date_local),
            activityName: activity.name,
            direction,
            lapPoints: tracePoints, // Use same trace for all laps (shows section portion)
            sectionTime: Math.round(lap.time),
            sectionDistance: lap.distance || sectionDistance,
            lapCount: record.laps.length,
            lapNumber: lapIdx + 1,
            totalLaps: record.laps.length,
          });
        }
      } else {
        // Fall back to single data point (no lap data or proportional estimate)
        const direction = record?.direction || (portion?.direction as 'same' | 'reverse') || 'same';

        if (direction === 'reverse') hasAnyReverse = true;

        let sectionSpeed: number;
        let sectionTime: number;

        if (record) {
          sectionSpeed = record.bestPace;
          sectionTime = Math.round(record.bestTime);
        } else {
          sectionSpeed = activity.moving_time > 0 ? activity.distance / activity.moving_time : 0;
          sectionTime =
            activity.distance > 0
              ? Math.round(activity.moving_time * (sectionDistance / activity.distance))
              : 0;
        }

        dataPoints.push({
          x: 0,
          id: activity.id,
          activityId: activity.id,
          speed: sectionSpeed,
          date: new Date(activity.start_date_local),
          activityName: activity.name,
          direction,
          lapPoints: tracePoints,
          sectionTime,
          sectionDistance,
          lapCount: 1,
        });
      }
    }

    // Filter out invalid speed values (NaN would crash SVG renderer)
    const validDataPoints = dataPoints.filter((d) => Number.isFinite(d.speed));
    const indexed = validDataPoints.map((d, idx) => ({ ...d, x: idx }));

    const speeds = indexed.map((d) => d.speed);
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
  }, [section, sectionWithTraces, sectionActivities, performanceRecords, portionMap]);

  // Compute performance rankings by speed (higher speed = better = rank 1)
  // Also compute summary statistics
  const { rankMap, bestActivityId, bestTimeValue, averageTime, lastActivityDate } = useMemo(() => {
    if (chartData.length === 0) {
      return {
        rankMap: new Map<string, number>(),
        bestActivityId: null as string | null,
        bestTimeValue: undefined as number | undefined,
        averageTime: undefined as number | undefined,
        lastActivityDate: undefined as string | undefined,
      };
    }

    // Sort by speed descending (fastest first)
    const sorted = [...chartData].sort((a, b) => b.speed - a.speed);
    const map = new Map<string, number>();
    sorted.forEach((item, idx) => {
      map.set(item.activityId, idx + 1);
    });

    // Best is rank 1
    const bestId = sorted.length > 0 ? sorted[0].activityId : null;
    const bestTime = sorted.length > 0 ? sorted[0].sectionTime : undefined;

    // Calculate average time
    const times = chartData
      .map((d) => d.sectionTime)
      .filter((t): t is number => t !== undefined && t > 0);
    const avgTime =
      times.length > 0 ? times.reduce((sum, t) => sum + t, 0) / times.length : undefined;

    // Get last activity date
    const dates = chartData.map((d) => d.date.getTime());
    const lastDate = dates.length > 0 ? new Date(Math.max(...dates)).toISOString() : undefined;

    return {
      rankMap: map,
      bestActivityId: bestId,
      bestTimeValue: bestTime,
      averageTime: avgTime,
      lastActivityDate: lastDate,
    };
  }, [chartData]);

  if (!section) {
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
            {t('sections.sectionNotFound')}
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
        keyboardShouldPersistTaps="handled"
      >
        {/* Hero Map Section */}
        <View style={styles.heroSection}>
          <View style={styles.mapContainer}>
            {mapReady ? (
              <SectionMapView
                section={section}
                height={MAP_HEIGHT}
                interactive={true}
                enableFullscreen={true}
                shadowTrack={shadowTrack}
                highlightedActivityId={mapHighlightedActivityId}
                highlightedLapPoints={mapHighlightedLapPoints}
                allActivityTraces={sectionWithTraces?.activityTraces}
                isScrubbing={isScrubbing}
              />
            ) : (
              <View style={[styles.mapPlaceholder, { height: MAP_HEIGHT }]}>
                <ActivityIndicator size="large" color={colors.primary} />
              </View>
            )}
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
              <MaterialCommunityIcons name="arrow-left" size={24} color={colors.textOnDark} />
            </TouchableOpacity>
            <View style={styles.headerSpacer} />
            {isCustomId ? (
              <TouchableOpacity
                style={styles.deleteButton}
                onPress={handleDeleteSection}
                activeOpacity={0.7}
              >
                <MaterialCommunityIcons name="delete-outline" size={24} color={colors.textOnDark} />
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={[styles.deleteButton, isSectionDisabled && styles.disabledButtonActive]}
                onPress={handleToggleDisable}
                activeOpacity={0.7}
              >
                <MaterialCommunityIcons
                  name={isSectionDisabled ? 'eye-off' : 'eye-off-outline'}
                  size={24}
                  color={isSectionDisabled ? colors.error : colors.textOnDark}
                />
              </TouchableOpacity>
            )}
          </View>

          <View style={styles.infoOverlay}>
            <View style={styles.sectionNameRow}>
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
                    placeholder={t('sections.sectionNamePlaceholder')}
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
                  <Text style={styles.heroSectionName} numberOfLines={1}>
                    {customName ||
                      section.name ||
                      t('sections.defaultName', { number: section.id.split('_').pop() })}
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

            <View style={styles.heroStatsRow}>
              <Text style={styles.heroStat}>{formatDistance(section.distanceMeters)}</Text>
              <Text style={styles.heroStatDivider}>·</Text>
              <Text style={styles.heroStat}>
                {chartData.length} {t('sections.traversals')}
              </Text>
              <Text style={styles.heroStatDivider}>·</Text>
              <Text style={styles.heroStat}>
                {section.routeIds.length} {t('sections.routesCount')}
              </Text>
            </View>
          </View>
        </View>

        {/* Content below hero */}
        <View style={styles.contentSection}>
          {/* Disabled banner */}
          {isSectionDisabled && (
            <TouchableOpacity
              style={[styles.disabledBanner, isDark && styles.disabledBannerDark]}
              onPress={handleToggleDisable}
              activeOpacity={0.8}
            >
              <MaterialCommunityIcons name="eye-off" size={18} color={colors.warning} />
              <Text style={styles.disabledBannerText}>
                {t('sections.disabled')} — {t('common.enable')}
              </Text>
            </TouchableOpacity>
          )}

          {/* Summary Stats Card */}
          {chartData.length > 0 && (
            <View style={[styles.summaryCard, isDark && styles.summaryCardDark]}>
              <View style={styles.summaryRow}>
                <View style={styles.summaryItem}>
                  <Text style={[styles.summaryLabel, isDark && styles.textMuted]}>
                    {t('sections.bestTime')}
                  </Text>
                  <View style={styles.summaryValueRow}>
                    <MaterialCommunityIcons name="trophy" size={14} color={colors.primary} />
                    <Text style={[styles.summaryValue, isDark && styles.textLight]}>
                      {bestTimeValue !== undefined ? formatDuration(bestTimeValue) : '--:--'}
                    </Text>
                  </View>
                </View>
                <View style={styles.summaryItem}>
                  <Text style={[styles.summaryLabel, isDark && styles.textMuted]}>
                    {t('sections.averageTime')}
                  </Text>
                  <Text style={[styles.summaryValue, isDark && styles.textLight]}>
                    {averageTime !== undefined ? formatDuration(averageTime) : '--:--'}
                  </Text>
                </View>
              </View>
              <View style={styles.summaryRow}>
                <View style={styles.summaryItem}>
                  <Text style={[styles.summaryLabel, isDark && styles.textMuted]}>
                    {t('sections.totalTraversals')}
                  </Text>
                  <Text style={[styles.summaryValue, isDark && styles.textLight]}>
                    {chartData.length}
                  </Text>
                </View>
                <View style={styles.summaryItem}>
                  <Text style={[styles.summaryLabel, isDark && styles.textMuted]}>
                    {t('sections.lastActivity')}
                  </Text>
                  <Text style={[styles.summaryValue, isDark && styles.textLight]}>
                    {lastActivityDate ? formatRelativeDate(lastActivityDate) : '-'}
                  </Text>
                </View>
              </View>
            </View>
          )}

          {/* Performance chart */}
          {chartData.length >= 1 && (
            <View style={styles.chartSection}>
              <UnifiedPerformanceChart
                chartData={chartData}
                activityType={section.sportType as ActivityType}
                isDark={isDark}
                minSpeed={minSpeed}
                maxSpeed={maxSpeed}
                bestIndex={bestIndex}
                hasReverseRuns={hasReverseRuns}
                tooltipBadgeType="time"
                onActivitySelect={handleActivitySelect}
                onScrubChange={handleScrubChange}
                selectedActivityId={highlightedActivityId}
              />
            </View>
          )}

          {/* Activities list */}
          <View style={styles.activitiesSection}>
            <Text style={[styles.sectionTitle, isDark && styles.textLight]}>
              {t('sections.activities')}
            </Text>
          </View>

          {/* Activity rows */}
          {isLoading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="small" color={colors.primary} />
            </View>
          ) : sectionActivities.length === 0 ? (
            <Text style={[styles.emptyActivities, isDark && styles.textMuted]}>
              {t('sections.noActivitiesFound')}
            </Text>
          ) : (
            <View style={[styles.activitiesCard, isDark && styles.activitiesCardDark]}>
              {sectionActivities.map((activity, index) => {
                const portion = portionMap.get(activity.id);
                const record = performanceRecordMap.get(activity.id);
                const isHighlighted = listHighlightedActivityId === activity.id;
                const isBest = bestActivityId === activity.id;
                const rank = rankMap.get(activity.id);
                const activityTracePoints = sectionWithTraces?.activityTraces?.[activity.id];

                return (
                  <React.Fragment key={activity.id}>
                    {index > 0 && <View style={[styles.divider, isDark && styles.dividerDark]} />}
                    <ActivityRow
                      activity={activity}
                      isDark={isDark}
                      direction={record?.direction || portion?.direction}
                      activityPoints={activityTracePoints}
                      sectionPoints={section.polyline}
                      isHighlighted={isHighlighted}
                      sectionDistance={record?.sectionDistance || portion?.distanceMeters}
                      lapCount={record?.lapCount}
                      actualSectionTime={record?.bestTime}
                      actualSectionPace={record?.bestPace}
                      isBest={isBest}
                      rank={rank}
                      bestTime={bestTimeValue}
                      onHighlightChange={handleRowHighlightChange}
                    />
                  </React.Fragment>
                );
              })}
            </View>
          )}

          {/* Footer */}
          <View style={styles.listFooterContainer}>
            <DataRangeFooter days={cacheDays} isDark={isDark} />
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
  flatListContent: {
    paddingBottom: spacing.xl,
  },
  activitiesCardWrapper: {
    marginHorizontal: spacing.md,
  },
  activitiesCardContent: {
    backgroundColor: colors.surface,
    marginHorizontal: spacing.md,
  },
  activitiesCardContentDark: {
    backgroundColor: darkColors.surface,
  },
  firstActivityCell: {
    borderTopLeftRadius: layout.borderRadius,
    borderTopRightRadius: layout.borderRadius,
    overflow: 'hidden',
  },
  lastActivityCell: {
    borderBottomLeftRadius: layout.borderRadius,
    borderBottomRightRadius: layout.borderRadius,
    overflow: 'hidden',
  },
  listFooterContainer: {
    marginTop: spacing.md,
  },
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
    backgroundColor: darkColors.background,
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
  headerSpacer: {
    flex: 1,
  },
  deleteButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  disabledButtonActive: {
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
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
  contentSection: {
    padding: layout.screenPadding,
    paddingTop: spacing.lg,
  },
  disabledBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.warning + '15',
    borderWidth: 1,
    borderColor: colors.warning + '30',
    borderRadius: layout.borderRadius,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  disabledBannerDark: {
    backgroundColor: colors.warning + '20',
    borderColor: colors.warning + '40',
  },
  disabledBannerText: {
    flex: 1,
    fontSize: typography.bodySmall.fontSize,
    fontWeight: '500',
    color: colors.warning,
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
  summaryValueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
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
    backgroundColor: colors.surface,
    marginHorizontal: spacing.md,
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
  lapBadge: {
    backgroundColor: colors.primary + '15',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: layout.borderRadiusSm,
    marginLeft: 4,
  },
  lapBadgeDark: {
    backgroundColor: colors.primary + '25',
  },
  lapBadgeText: {
    fontSize: 10,
    fontWeight: '600',
    color: colors.primary,
  },
  lapBadgeTextDark: {
    color: colors.primaryLight,
  },
  activityMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 1,
  },
  activityDate: {
    fontSize: typography.caption.fontSize,
    color: colors.textSecondary,
  },
  traversalCount: {
    fontSize: typography.caption.fontSize,
    color: colors.textSecondary,
  },
  deltaText: {
    fontSize: typography.caption.fontSize,
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

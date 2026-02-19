/**
 * Section detail page.
 * Shows a frequently-traveled section with all activities that traverse it.
 */

import React, { useMemo, useCallback, useState, useEffect, useRef, memo } from 'react';
import {
  View,
  FlatList,
  StyleSheet,
  Pressable,
  Dimensions,
  StatusBar,
  TouchableOpacity,
  TextInput,
  Keyboard,
  Alert,
  InteractionManager,
  Modal,
} from 'react-native';
import { Text, ActivityIndicator, IconButton } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, router } from 'expo-router';
import { logScreenRender } from '@/lib/debug/renderTimer';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { LinearGradient } from 'expo-linear-gradient';
import {
  useSectionPerformances,
  useCustomSections,
  useTheme,
  useMetricSystem,
  useCacheDays,
  useGpxExport,
  type ActivitySectionRecord,
} from '@/hooks';
import { useSectionDetail } from '@/hooks/routes/useRouteEngine';
import { getAllSectionDisplayNames } from '@/hooks/routes/useUnifiedSections';
import { createSharedStyles } from '@/styles';
import { useDisabledSections } from '@/providers';
import {
  SectionMapView,
  MiniTraceView,
  DataRangeFooter,
  DebugInfoPanel,
  DebugWarningBanner,
} from '@/components/routes';
import { useDebugStore } from '@/providers';
import { useFFITimer } from '@/hooks/debug/useFFITimer';
import { TAB_BAR_SAFE_PADDING, CollapsibleSection } from '@/components/ui';
import {
  UnifiedPerformanceChart,
  type ChartSummaryStats,
  type DirectionSummaryStats,
} from '@/components/routes/performance';
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
import { fromUnixSeconds } from '@/lib/utils/ffiConversions';
import { colors, darkColors, spacing, layout, typography, opacity } from '@/theme';
import { CHART_CONFIG } from '@/constants';
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

// Time range selector for bucketed chart
type SectionTimeRange = '1m' | '3m' | '6m' | '1y' | 'all';
const SECTION_TIME_RANGES: { id: SectionTimeRange; label: string }[] = [
  { id: '1m', label: '1M' },
  { id: '3m', label: '3M' },
  { id: '6m', label: '6M' },
  { id: '1y', label: '1Y' },
  { id: 'all', label: 'All' },
];
const RANGE_DAYS: Record<SectionTimeRange, number> = {
  '1m': 30,
  '3m': 90,
  '6m': 180,
  '1y': 365,
  all: 0,
};
const BUCKET_THRESHOLD = 100;

type BucketType = 'weekly' | 'monthly' | 'quarterly' | 'yearly';
const BUCKET_TYPES: {
  id: BucketType;
  labelKey:
    | 'sections.bestPerWeek'
    | 'sections.bestPerMonth'
    | 'sections.bestPerQuarter'
    | 'sections.bestPerYear';
}[] = [
  { id: 'weekly', labelKey: 'sections.bestPerWeek' },
  { id: 'monthly', labelKey: 'sections.bestPerMonth' },
  { id: 'quarterly', labelKey: 'sections.bestPerQuarter' },
  { id: 'yearly', labelKey: 'sections.bestPerYear' },
];
const DEFAULT_BUCKET_TYPE: Record<SectionTimeRange, BucketType> = {
  '1m': 'weekly',
  '3m': 'monthly',
  '6m': 'monthly',
  '1y': 'quarterly',
  all: 'yearly',
};

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
  /** Best pace in m/s (for pace delta calculation) */
  bestPace?: number;
  /** Is this the reference (medoid) activity for the section? */
  isReference?: boolean;
  /** Stable callback for highlight - receives activity ID, pass null to clear */
  onHighlightChange?: (activityId: string | null) => void;
  /** Callback for long-press to set as reference */
  onSetAsReference?: (activityId: string) => void;
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
  bestPace,
  isReference = false,
  onHighlightChange,
  onSetAsReference,
}: ActivityRowProps) {
  const { t } = useTranslation();
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

  const handleLongPress = useCallback(() => {
    onSetAsReference?.(activity.id);
  }, [onSetAsReference, activity.id]);

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

  // Calculate delta from best - use pace for running, time for others
  const { deltaDisplay, deltaColor } = useMemo(() => {
    if (isBest) return { deltaDisplay: null, deltaColor: colors.textSecondary };

    // For running: calculate pace delta (seconds per km difference)
    if (showPace && sectionSpeed > 0 && bestPace && bestPace > 0) {
      const currentPacePerKm = 1000 / sectionSpeed; // seconds per km
      const bestPacePerKm = 1000 / bestPace; // seconds per km
      const paceDelta = currentPacePerKm - bestPacePerKm; // positive = slower

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

    // Fall back to time delta for non-running
    if (bestTime === undefined || sectionTime === undefined || sectionTime <= 0) {
      return { deltaDisplay: null, deltaColor: colors.textSecondary };
    }

    const diff = sectionTime - bestTime;
    if (Math.abs(diff) < 1) return { deltaDisplay: null, deltaColor: colors.textSecondary };

    const absDelta = Math.abs(diff);
    const minutes = Math.floor(absDelta / 60);
    const seconds = Math.round(absDelta % 60);
    const sign = diff > 0 ? '+' : '-';
    const formatted =
      minutes > 0
        ? `${sign}${minutes}:${seconds.toString().padStart(2, '0')}`
        : `${sign}${Math.floor(absDelta)}s`;

    return {
      deltaDisplay: formatted,
      deltaColor: diff <= 0 ? colors.success : colors.error,
    };
  }, [isBest, showPace, sectionSpeed, bestPace, bestTime, sectionTime]);

  return (
    <Pressable
      onPress={handlePress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      onLongPress={handleLongPress}
      delayLongPress={CHART_CONFIG.LONG_PRESS_DURATION}
      style={({ pressed }) => [
        styles.activityRow,
        isDark && styles.activityRowDark,
        isHighlighted && styles.activityRowHighlighted,
        pressed && styles.activityRowPressed,
        isBest && styles.activityRowBest,
        isReference && styles.activityRowReference,
      ]}
    >
      {activityPoints && activityPoints.length > 1 ? (
        <MiniTraceView
          primaryPoints={activityPoints}
          referencePoints={sectionPoints}
          primaryColor={traceColor}
          referenceColor={colors.consensusRoute}
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
          {/* Reference indicator - small star icon (cyan) - show even if also PR */}
          {isReference && (
            <MaterialCommunityIcons
              name="star"
              size={14}
              color={colors.chartCyan}
              style={{ marginLeft: 4 }}
            />
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
              · {t('sections.traversalsCount', { count: lapCount })}
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
        {/* Pace/time delta - on right under time */}
        {deltaDisplay && !isBest && (
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

export default function SectionDetailScreen() {
  // Performance timing
  const perfEndRef = useRef<(() => void) | null>(null);
  perfEndRef.current = logScreenRender('SectionDetailScreen');
  useEffect(() => {
    perfEndRef.current?.();
  });

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
  const isMetric = useMetricSystem();
  const shared = createSharedStyles(isDark);
  const insets = useSafeAreaInsets();

  // Get cached date range from sync store (consolidated calculation)
  const cacheDays = useCacheDays();
  const debugEnabled = useDebugStore((s) => s.enabled);
  const { getPageMetrics } = useFFITimer();
  const { exportGpx, exporting: gpxExporting } = useGpxExport();

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

  // Time range for bucketed performance chart
  const [sectionTimeRange, setSectionTimeRange] = useState<SectionTimeRange>('1y');
  const [bucketType, setBucketType] = useState<BucketType>(DEFAULT_BUCKET_TYPE['1y']);
  const [showBucketModal, setShowBucketModal] = useState(false);

  // Auto-update bucket type when time range changes
  useEffect(() => {
    setBucketType(DEFAULT_BUCKET_TYPE[sectionTimeRange]);
  }, [sectionTimeRange]);

  // State for section renaming
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [customName, setCustomName] = useState<string | null>(null);
  const nameInputRef = useRef<TextInput>(null);

  // State for overriding the reference activity (for immediate UI update)
  const [overrideReferenceId, setOverrideReferenceId] = useState<string | null>(null);
  // Key to force section data refresh after reference change
  const [sectionRefreshKey, setSectionRefreshKey] = useState(0);

  // Custom section IDs start with "custom_" (e.g., "custom_1767268142052_qyfoos8")
  const isCustomId = id?.startsWith('custom_');

  // Use useSectionDetail for ALL sections (both auto and custom).
  // Rust get_section_by_id() handles both types via the unified sections table.
  const sectionIdWithRefresh = id ? `${id}#${sectionRefreshKey}` : null;
  const { section: rawEngineSection } = useSectionDetail(id ?? null);

  // Force re-computation when refresh key changes by including it in the memo
  const section = useMemo(() => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const _forceRefresh = sectionIdWithRefresh;
    if (!rawEngineSection) return null;

    // Re-fetch fresh data from engine when refresh key changes
    // IMPORTANT: Use ALL fresh data, not just polyline - activityIds may have changed
    if (sectionRefreshKey > 0) {
      const engine = getRouteEngine();
      if (engine && id) {
        const fresh = engine.getSectionById(id);
        if (fresh && fresh.polyline && fresh.polyline.length > 0) {
          const freshAny = fresh as unknown as Record<string, unknown>;
          const sectionType: 'auto' | 'custom' =
            typeof freshAny.sectionType === 'string' && freshAny.sectionType === 'custom'
              ? 'custom'
              : 'auto';
          const createdAt =
            typeof freshAny.createdAt === 'string' ? freshAny.createdAt : new Date().toISOString();
          return {
            ...fresh,
            sectionType,
            polyline: fresh.polyline.map((p: { latitude: number; longitude: number }) => ({
              lat: p.latitude,
              lng: p.longitude,
            })),
            activityPortions: fresh.activityPortions?.map((p) => ({
              ...p,
              direction: (p.direction === 'reverse' ? 'reverse' : 'same') as 'same' | 'reverse',
            })),
            createdAt,
          } as FrequentSection;
        }
        // If fresh data is invalid/empty, keep using rawEngineSection to avoid map flicker
      }
    }
    return rawEngineSection;
  }, [rawEngineSection, sectionIdWithRefresh, sectionRefreshKey, id]);

  const { removeSection, renameSection } = useCustomSections();
  const queryClient = useQueryClient();

  // Disabled sections state
  const { isDisabled, disable, enable } = useDisabledSections();
  const isSectionDisabled = id ? isDisabled(id) : false;

  // Merge computed activity traces into the section
  // Always use computedActivityTraces when available, as they use extractSectionTrace
  // which correctly extracts points near the section polyline (avoiding straight-line artifacts)
  const sectionWithTraces = useMemo(() => {
    if (!section) return null;

    // Cast to access optional activityTraces property (may not exist on all section types)
    const sectionAny = section as unknown as {
      activityTraces?: Record<string, RoutePoint[]>;
    };

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
    if (sectionAny.activityTraces && Object.keys(sectionAny.activityTraces).length > 0) {
      return {
        ...section,
        activityTraces: sectionAny.activityTraces,
      };
    }

    return section;
  }, [section, computedActivityTraces]);

  // Compute activity traces using batch FFI call (single R-tree build, sequential track loading).
  // Replaces N individual extractSectionTrace calls with 1 batch call.
  // Correctly handles cases where activities take different paths between entry/exit points.
  useEffect(() => {
    if (!section || !section.activityIds.length || !section.polyline?.length) {
      return;
    }

    const engine = getRouteEngine();
    if (!engine) {
      return;
    }

    // Convert polyline to JSON string for Rust engine (done once)
    const polylineJson = JSON.stringify(
      section.polyline.map((p: { lat: number; lng: number }) => ({
        latitude: p.lat,
        longitude: p.lng,
      }))
    );

    // Single batch FFI call — builds R-tree once, loads tracks sequentially
    const traces = engine.extractSectionTracesBatch(section.activityIds, polylineJson);

    if (Object.keys(traces).length > 0) {
      setComputedActivityTraces(traces);
    }
  }, [section]);

  // Load custom section name from section data on mount
  // Section names are now stored directly in the section.name field
  useEffect(() => {
    if (section?.name) {
      setCustomName(section.name);
    }
  }, [section?.name]);

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

  // Get the effective reference activity ID (override takes precedence)
  const effectiveReferenceId = overrideReferenceId ?? section?.representativeActivityId;

  // Handle setting an activity as the reference (medoid) for this section
  const handleSetAsReference = useCallback(
    (activityId: string) => {
      if (!id) return;

      const engine = getRouteEngine();
      if (!engine) return;

      // Check if this activity is already the reference
      const currentRef = effectiveReferenceId;
      const isUserDefinedRef = engine.isSectionReferenceUserDefined(id);

      if (currentRef === activityId && isUserDefinedRef) {
        // Already the user-defined reference - offer to reset
        Alert.alert(t('sections.resetReference'), t('sections.resetReferenceConfirm'), [
          { text: t('common.cancel'), style: 'cancel' },
          {
            text: t('common.reset'),
            onPress: () => {
              const success = engine.resetSectionReference(id);
              if (success) {
                // Reset to automatic - clear override to use section's original
                setOverrideReferenceId(null);
                // Force section data refresh to get recalculated polyline
                setSectionRefreshKey((k) => k + 1);
                // Also invalidate custom sections cache for routes list
                if (isCustomId) {
                  queryClient.invalidateQueries({ queryKey: ['sections'] });
                }
              }
            },
          },
        ]);
      } else {
        // Set as new reference
        Alert.alert(t('sections.setAsReference'), t('sections.setAsReferenceConfirm'), [
          { text: t('common.cancel'), style: 'cancel' },
          {
            text: t('common.confirm'),
            onPress: () => {
              if (__DEV__) {
                console.log(
                  '[SetReference] Attempting to set reference:',
                  'sectionId=',
                  id,
                  'activityId=',
                  activityId
                );
              }
              const success = engine.setSectionReference(id, activityId);
              if (__DEV__) console.log('[SetReference] Result:', success);
              if (success) {
                // Update local state immediately for responsive UI
                setOverrideReferenceId(activityId);
                // Force section data refresh to get updated polyline
                setSectionRefreshKey((k) => k + 1);
                // Also invalidate custom sections cache for routes list
                if (isCustomId) {
                  queryClient.invalidateQueries({ queryKey: ['sections'] });
                }
              } else {
                // Show error if operation failed
                Alert.alert(
                  t('common.error'),
                  t('sections.setReferenceError', 'Failed to set reference. Please try again.')
                );
              }
            },
          },
        ]);
      }
    },
    [id, t, effectiveReferenceId, isCustomId, queryClient]
  );

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

  // GPS tracks are loaded on-demand when user selects an activity (via shadowTrack).
  // No eager loading — prevents 237+ FFI calls and ~12-19MB heap spike on section open.
  // Clear cache when section changes to avoid stale data.
  useEffect(() => {
    gpsTrackCacheRef.current.clear();
    setCacheReady(true); // Always "ready" — tracks load on demand
    return () => {
      gpsTrackCacheRef.current.clear();
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

  // Use highlightedActivityId directly for immediate row highlighting during scrubbing
  // (like route detail page does)
  const listHighlightedActivityId = highlightedActivityId;

  // Stable callback for ActivityRow highlight changes
  // This callback is memoized and won't change between renders, so it doesn't break ActivityRow's memo
  const handleRowHighlightChange = useCallback((activityId: string | null) => {
    setHighlightedActivityId(activityId);
  }, []);

  // Get section activities from engine metrics (no API call needed).
  // Activities are already cached in the Rust engine's in-memory HashMap.
  const isLoading = false; // Engine lookup is synchronous
  const sectionActivitiesUnsorted = useMemo(() => {
    if (!section?.activityIds?.length) return [];
    const engine = getRouteEngine();
    if (!engine) return [];
    return engine.getActivityMetricsForIds(section.activityIds).map(
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
  }, [section?.activityIds]);

  // Fetch actual section performance times from activity streams
  // This loads in the background - we show estimated times first, then update when ready
  const {
    records: performanceRecords,
    isLoading: isLoadingRecords,
    bestForwardRecord,
    bestReverseRecord,
    forwardStats,
    reverseStats,
  } = useSectionPerformances(section);

  // Show loading indicator while fetching performance data (but don't block the UI)
  const hasPerformanceData = performanceRecords && performanceRecords.length > 0;

  // Map of activity portions for direction lookup
  const portionMap = useMemo(() => {
    if (!section?.activityPortions) return new Map();
    return new Map(section.activityPortions.map((p: { activityId: string }) => [p.activityId, p]));
  }, [section?.activityPortions]);

  // Determine if this section has enough traversals to use bucketed chart
  const activityCount = section?.activityIds?.length ?? 0;
  const useBucketedChart = activityCount >= BUCKET_THRESHOLD;

  // Client-side bucketing function (moved from Rust FFI for 20ms savings)
  const bucketResult = useMemo(() => {
    if (!useBucketedChart || !performanceRecords || performanceRecords.length === 0) return null;

    const t0 = performance.now();
    const rangeDays = RANGE_DAYS[sectionTimeRange];
    const now = Date.now() / 1000; // Unix timestamp in seconds
    const cutoff = rangeDays === 0 ? 0 : now - rangeDays * 86400;

    interface DirPerf {
      activityId: string;
      activityName: string;
      activityDate: number; // Unix timestamp
      bestTime: number;
      bestPace: number;
      isReverse: boolean;
      sectionDistance: number;
    }

    // Flatten records into per-activity, per-direction best laps
    const allPerfs: DirPerf[] = [];
    for (const record of performanceRecords) {
      let fwdBestTime = Infinity;
      let fwdBestPace = 0;
      let revBestTime = Infinity;
      let revBestPace = 0;
      let hasFwd = false;
      let hasRev = false;

      for (const lap of record.laps) {
        if (lap.direction === 'reverse') {
          hasRev = true;
          if (lap.time < revBestTime) {
            revBestTime = lap.time;
            revBestPace = lap.pace;
          }
        } else {
          hasFwd = true;
          if (lap.time < fwdBestTime) {
            fwdBestTime = lap.time;
            fwdBestPace = lap.pace;
          }
        }
      }

      const activityDate = Math.floor(record.activityDate.getTime() / 1000);

      if (hasFwd) {
        allPerfs.push({
          activityId: record.activityId,
          activityName: record.activityName,
          activityDate,
          bestTime: fwdBestTime,
          bestPace: fwdBestPace,
          isReverse: false,
          sectionDistance: record.sectionDistance,
        });
      }
      if (hasRev) {
        allPerfs.push({
          activityId: record.activityId,
          activityName: record.activityName,
          activityDate,
          bestTime: revBestTime,
          bestPace: revBestPace,
          isReverse: true,
          sectionDistance: record.sectionDistance,
        });
      }
    }

    // Filter by date range
    const inRange = allPerfs.filter((p) => p.activityDate >= cutoff);

    // Find overall PR (fastest across ALL time)
    const overallPr = allPerfs.reduce(
      (best, p) => (!best || p.bestTime < best.bestTime ? p : best),
      null as DirPerf | null
    );

    // Calendar bucketing helper
    const getCalendarBucket = (timestamp: number): number => {
      const date = new Date(timestamp * 1000);
      if (bucketType === 'weekly') {
        // Week number: days since epoch / 7
        return Math.floor(timestamp / (86400 * 7));
      } else if (bucketType === 'monthly') {
        return date.getFullYear() * 12 + date.getMonth();
      } else if (bucketType === 'quarterly') {
        return date.getFullYear() * 4 + Math.floor(date.getMonth() / 3);
      } else {
        // yearly
        return date.getFullYear();
      }
    };

    // Group into buckets, keeping best per bucket per direction
    const bucketMap = new Map<string, { perf: DirPerf; count: number }>();
    for (const perf of inRange) {
      const bucketKey = getCalendarBucket(perf.activityDate);
      const dirKey = perf.isReverse ? 'reverse' : 'same';
      const key = `${bucketKey}_${dirKey}`;

      const existing = bucketMap.get(key);
      if (!existing || perf.bestTime < existing.perf.bestTime) {
        bucketMap.set(key, {
          perf: { ...perf },
          count: existing ? existing.count + 1 : 1,
        });
      } else {
        bucketMap.set(key, {
          ...existing,
          count: existing.count + 1,
        });
      }
    }

    // Convert to sorted array
    const buckets = Array.from(bucketMap.values())
      .map(({ perf, count }) => ({
        activityId: perf.activityId,
        activityName: perf.activityName,
        activityDate: perf.activityDate,
        bestTime: perf.bestTime,
        bestPace: perf.bestPace,
        direction: perf.isReverse ? 'reverse' : 'same',
        sectionDistance: perf.sectionDistance,
        isEstimated: false,
        bucketCount: count,
      }))
      .sort((a, b) => a.activityDate - b.activityDate);

    // Direction stats
    const fwdInRange = inRange.filter((p) => !p.isReverse);
    const revInRange = inRange.filter((p) => p.isReverse);

    const forwardStats =
      fwdInRange.length > 0
        ? {
            avgTime: fwdInRange.reduce((sum, p) => sum + p.bestTime, 0) / fwdInRange.length,
            lastActivity: Math.max(...fwdInRange.map((p) => p.activityDate)),
            count: fwdInRange.length,
          }
        : null;

    const reverseStats =
      revInRange.length > 0
        ? {
            avgTime: revInRange.reduce((sum, p) => sum + p.bestTime, 0) / revInRange.length,
            lastActivity: Math.max(...revInRange.map((p) => p.activityDate)),
            count: revInRange.length,
          }
        : null;

    if (__DEV__)
      console.log(`[PERF] client-side bucketing: ${(performance.now() - t0).toFixed(1)}ms`);

    return {
      buckets,
      totalTraversals: inRange.length,
      prBucket: overallPr
        ? {
            activityId: overallPr.activityId,
            activityName: overallPr.activityName,
            activityDate: overallPr.activityDate,
            bestTime: overallPr.bestTime,
            bestPace: overallPr.bestPace,
            direction: overallPr.isReverse ? 'reverse' : 'same',
            sectionDistance: overallPr.sectionDistance,
            isEstimated: false,
            bucketCount: 1,
          }
        : null,
      forwardStats,
      reverseStats,
    };
  }, [useBucketedChart, performanceRecords, sectionTimeRange, bucketType]);

  // Build chart data from buckets (for sections with many traversals)
  const { bucketChartData, bucketMinSpeed, bucketMaxSpeed, bucketBestIndex, bucketHasReverseRuns } =
    useMemo(() => {
      if (!bucketResult || bucketResult.buckets.length === 0) {
        return {
          bucketChartData: [] as (PerformanceDataPoint & { x: number })[],
          bucketMinSpeed: 0,
          bucketMaxSpeed: 1,
          bucketBestIndex: 0,
          bucketHasReverseRuns: false,
        };
      }

      let hasAnyReverse = false;
      const dataPoints = bucketResult.buckets.map((b, idx) => {
        if (b.direction === 'reverse') hasAnyReverse = true;
        return {
          x: idx,
          id: b.activityId,
          activityId: b.activityId,
          speed: b.bestPace,
          date: fromUnixSeconds(b.activityDate) ?? new Date(),
          activityName: b.activityName,
          direction: b.direction as 'same' | 'reverse',
          sectionTime: Math.round(b.bestTime),
          sectionDistance: b.sectionDistance,
          lapCount: b.bucketCount,
        };
      });

      const speeds = dataPoints.map((d) => d.speed);
      const min = Math.min(...speeds);
      const max = Math.max(...speeds);
      const padding = (max - min) * 0.15 || 0.5;

      let bestIdx = 0;
      for (let i = 1; i < dataPoints.length; i++) {
        if (dataPoints[i].speed > dataPoints[bestIdx].speed) bestIdx = i;
      }

      return {
        bucketChartData: dataPoints,
        bucketMinSpeed: Math.max(0, min - padding),
        bucketMaxSpeed: max + padding,
        bucketBestIndex: bestIdx,
        bucketHasReverseRuns: hasAnyReverse,
      };
    }, [bucketResult]);

  // Bucketed chart summary stats
  const bucketSummaryStats = useMemo((): ChartSummaryStats | null => {
    if (!bucketResult) return null;
    const pr = bucketResult.prBucket;
    const allTimes = bucketResult.buckets.map((b) => b.bestTime).filter((t) => t > 0);
    const avgTime =
      allTimes.length > 0 ? allTimes.reduce((a, b) => a + b, 0) / allTimes.length : null;
    const lastDate =
      bucketResult.buckets.length > 0
        ? fromUnixSeconds(bucketResult.buckets[bucketResult.buckets.length - 1].activityDate)
        : null;
    return {
      bestTime: pr?.bestTime ?? null,
      avgTime,
      totalActivities: bucketResult.totalTraversals,
      lastActivity: lastDate,
    };
  }, [bucketResult]);

  // Bucketed direction stats
  const bucketForwardStats = useMemo((): DirectionSummaryStats | null => {
    if (!bucketResult?.forwardStats) return null;
    const s = bucketResult.forwardStats;
    return {
      avgTime: s.avgTime ?? null,
      lastActivity: s.lastActivity ? fromUnixSeconds(s.lastActivity) : null,
      count: s.count,
    };
  }, [bucketResult?.forwardStats]);

  const bucketReverseStats = useMemo((): DirectionSummaryStats | null => {
    if (!bucketResult?.reverseStats) return null;
    const s = bucketResult.reverseStats;
    return {
      avgTime: s.avgTime ?? null,
      lastActivity: s.lastActivity ? fromUnixSeconds(s.lastActivity) : null,
      count: s.count,
    };
  }, [bucketResult?.reverseStats]);

  // Best records per direction from bucket data
  const { bucketBestForward, bucketBestReverse } = useMemo(() => {
    if (!bucketResult?.buckets) return { bucketBestForward: null, bucketBestReverse: null };
    let bestFwd: (typeof bucketResult.buckets)[0] | null = null;
    let bestRev: (typeof bucketResult.buckets)[0] | null = null;
    for (const b of bucketResult.buckets) {
      if (b.bestTime <= 0) continue;
      if (b.direction === 'same' || b.direction === 'forward') {
        if (!bestFwd || b.bestPace > bestFwd.bestPace) bestFwd = b;
      } else if (b.direction === 'reverse' || b.direction === 'backward') {
        if (!bestRev || b.bestPace > bestRev.bestPace) bestRev = b;
      }
    }
    const toRecord = (b: (typeof bucketResult.buckets)[0]) => {
      const date = fromUnixSeconds(b.activityDate);
      if (!date) return null;
      return {
        bestTime: b.bestTime,
        bestPace: b.bestPace,
        activityName: b.activityName,
        activityDate: date,
      };
    };
    return {
      bucketBestForward: bestFwd ? toRecord(bestFwd) : null,
      bucketBestReverse: bestRev ? toRecord(bestRev) : null,
    };
  }, [bucketResult?.buckets]);

  // Calendar summary: Year > Month performance history
  const [showHistory, setShowHistory] = useState(false);
  const [expandedYears, setExpandedYears] = useState<Set<number>>(new Set());

  const calendarSummary = useMemo(() => {
    if (!section?.id) return null;
    try {
      const engine = getRouteEngine();
      if (!engine) return null;
      const t0 = performance.now();
      const result = engine.getSectionCalendarSummary(section.id);
      if (__DEV__)
        console.log(`[PERF] getSectionCalendarSummary: ${(performance.now() - t0).toFixed(1)}ms`);
      if (result && result.years.length > 0 && expandedYears.size === 0) {
        // Auto-expand the most recent year on first load
        setExpandedYears(new Set([result.years[0].year]));
      }
      return result;
    } catch {
      return null;
    }
  }, [section?.id]);

  const isRunning = section ? isRunningActivity(section.sportType as ActivityType) : false;

  const toggleYear = useCallback((year: number) => {
    setExpandedYears((prev) => {
      const next = new Set(prev);
      if (next.has(year)) {
        next.delete(year);
      } else {
        next.add(year);
      }
      return next;
    });
  }, []);

  // Month names for display
  const monthNames = useMemo(() => {
    const formatter = new Intl.DateTimeFormat(undefined, { month: 'short' });
    return Array.from({ length: 12 }, (_, i) => formatter.format(new Date(2024, i, 1)));
  }, []);

  // Map of performance records for fast lookup (avoid .find() in render loop)
  const performanceRecordMap = useMemo(() => {
    if (!performanceRecords) return new Map<string, ActivitySectionRecord>();
    return new Map(performanceRecords.map((r) => [r.activityId, r]));
  }, [performanceRecords]);

  // Sort activities by pace (fastest first) - uses records if available, else estimates
  const sectionActivities = useMemo(() => {
    if (sectionActivitiesUnsorted.length === 0) return [];

    // Sort by best pace (higher pace = faster = first)
    return [...sectionActivitiesUnsorted].sort((a, b) => {
      const recordA = performanceRecordMap.get(a.id);
      const recordB = performanceRecordMap.get(b.id);

      // Get pace from record if available, otherwise calculate from activity data
      const paceA = recordA?.bestPace ?? (a.moving_time > 0 ? a.distance / a.moving_time : 0);
      const paceB = recordB?.bestPace ?? (b.moving_time > 0 ? b.distance / b.moving_time : 0);

      return paceB - paceA; // Descending (fastest first = highest pace)
    });
  }, [sectionActivitiesUnsorted, performanceRecordMap]);

  // Prepare chart data for UnifiedPerformanceChart
  // Uses actual section times from records when available, otherwise proportional estimate
  const { chartData, minSpeed, maxSpeed, bestIndex, hasReverseRuns } = useMemo(() => {
    if (__DEV__) {
      console.log('[SectionDetail] chartData recompute:', {
        isLoadingRecords,
        hasSection: !!section,
        sectionActivitiesCount: sectionActivities.length,
        performanceRecordsCount: performanceRecords?.length ?? 0,
      });
    }

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

      // Use fastest lap only (one entry per activity)
      if (record && record.laps && record.laps.length > 0) {
        // Find fastest lap (highest pace/speed)
        const fastestLap = record.laps.reduce((best, lap) => (lap.pace > best.pace ? lap : best));
        const direction = fastestLap.direction || 'same';
        if (direction === 'reverse') hasAnyReverse = true;

        dataPoints.push({
          x: 0,
          id: activity.id,
          activityId: activity.id,
          speed: fastestLap.pace,
          date: new Date(activity.start_date_local),
          activityName: activity.name,
          direction,
          lapPoints: tracePoints,
          sectionTime: Math.round(fastestLap.time),
          sectionDistance, // Use canonical section distance, not lap distance
          lapCount: record.laps.length,
        });
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
  const { rankMap, bestActivityId, bestTimeValue, bestPaceValue, averageTime, lastActivityDate } =
    useMemo(() => {
      if (__DEV__) {
        console.log('[SectionDetail] stats recompute:', {
          chartDataLength: chartData.length,
          firstEntry: chartData[0]
            ? { time: chartData[0].sectionTime, speed: chartData[0].speed }
            : null,
        });
      }

      if (chartData.length === 0) {
        return {
          rankMap: new Map<string, number>(),
          bestActivityId: null as string | null,
          bestTimeValue: undefined as number | undefined,
          bestPaceValue: undefined as number | undefined,
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

      // Best is rank 1 (highest speed = best pace)
      const bestId = sorted.length > 0 ? sorted[0].activityId : null;
      const bestTime = sorted.length > 0 ? sorted[0].sectionTime : undefined;
      const bestPace = sorted.length > 0 ? sorted[0].speed : undefined;

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
        bestPaceValue: bestPace,
        averageTime: avgTime,
        lastActivityDate: lastDate,
      };
    }, [chartData]);

  // Summary stats for the chart header
  const summaryStats = useMemo((): ChartSummaryStats => {
    return {
      bestTime: bestTimeValue ?? null,
      avgTime: averageTime ?? null,
      totalActivities: chartData.length,
      lastActivity: lastActivityDate ? new Date(lastActivityDate) : null,
    };
  }, [bestTimeValue, averageTime, chartData.length, lastActivityDate]);

  const computedForwardStats: DirectionSummaryStats | null = forwardStats;
  const computedReverseStats: DirectionSummaryStats | null = reverseStats;
  const computedBestForward: { bestTime: number; activityDate: Date } | null =
    bestForwardRecord ?? null;
  const computedBestReverse: { bestTime: number; activityDate: Date } | null =
    bestReverseRecord ?? null;

  const keyExtractor = useCallback((item: Activity) => item.id, []);

  const renderActivityRow = useCallback(
    ({ item: activity }: { item: Activity }) => {
      const portion = portionMap.get(activity.id);
      const record = performanceRecordMap.get(activity.id);
      const isHighlighted = listHighlightedActivityId === activity.id;
      const isBest = bestActivityId === activity.id;
      const rank = rankMap.get(activity.id);
      const activityTracePoints = sectionWithTraces?.activityTraces?.[activity.id];
      const isReference = effectiveReferenceId === activity.id;

      return (
        <ActivityRow
          activity={activity}
          isDark={isDark}
          direction={record?.direction || portion?.direction}
          activityPoints={activityTracePoints}
          sectionPoints={section?.polyline}
          isHighlighted={isHighlighted}
          sectionDistance={record?.sectionDistance || portion?.distanceMeters}
          lapCount={record?.lapCount}
          actualSectionTime={record?.bestTime}
          actualSectionPace={record?.bestPace}
          isBest={isBest}
          rank={rank}
          bestTime={bestTimeValue}
          bestPace={bestPaceValue}
          isReference={isReference}
          onHighlightChange={handleRowHighlightChange}
          onSetAsReference={handleSetAsReference}
        />
      );
    },
    [
      portionMap,
      performanceRecordMap,
      listHighlightedActivityId,
      bestActivityId,
      rankMap,
      sectionWithTraces?.activityTraces,
      effectiveReferenceId,
      isDark,
      section?.polyline,
      bestTimeValue,
      bestPaceValue,
      handleRowHighlightChange,
      handleSetAsReference,
    ]
  );

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
    <View testID="section-detail-screen" style={[styles.container, isDark && styles.containerDark]}>
      <StatusBar barStyle="light-content" />
      <FlatList
        data={isLoading ? [] : sectionActivities}
        keyExtractor={keyExtractor}
        renderItem={renderActivityRow}
        style={styles.scrollView}
        contentContainerStyle={styles.flatListContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        initialNumToRender={10}
        maxToRenderPerBatch={10}
        windowSize={5}
        ListHeaderComponent={
          <>
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
                    <MaterialCommunityIcons
                      name="delete-outline"
                      size={24}
                      color={colors.textOnDark}
                    />
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
                        testID="section-rename-input"
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
                      <TouchableOpacity
                        testID="section-rename-save"
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
                      testID="section-rename-button"
                      onPress={handleStartEditing}
                      style={styles.nameEditTouchable}
                      activeOpacity={0.7}
                    >
                      {/* Names are stored in Rust (user-set or auto-generated on creation/migration) */}
                      <Text style={styles.heroSectionName} numberOfLines={1}>
                        {customName ?? section.name ?? section.id}
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
                  <Text style={styles.heroStat}>
                    {formatDistance(section.distanceMeters, isMetric)}
                  </Text>
                  <Text style={styles.heroStatDivider}>·</Text>
                  <Text style={styles.heroStat}>
                    {activityCount} {t('sections.traversals')}
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

              {/* Performance chart - bucketed for large sections, full for small */}
              {useBucketedChart && bucketChartData.length >= 1 && (
                <View style={styles.chartSection}>
                  {/* Time range selector with grouping config */}
                  <View style={styles.timeRangeRow}>
                    <View style={styles.timeRangeWithButton}>
                      <View style={styles.timeRangeContainer}>
                        {SECTION_TIME_RANGES.map((range) => (
                          <TouchableOpacity
                            key={range.id}
                            style={[
                              styles.timeRangeButton,
                              isDark && styles.timeRangeButtonDark,
                              sectionTimeRange === range.id && styles.timeRangeButtonActive,
                            ]}
                            onPress={() => setSectionTimeRange(range.id)}
                            activeOpacity={0.7}
                          >
                            <Text
                              style={[
                                styles.timeRangeText,
                                isDark && styles.timeRangeTextDark,
                                sectionTimeRange === range.id && styles.timeRangeTextActive,
                              ]}
                            >
                              {range.label}
                            </Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                      <TouchableOpacity
                        style={[styles.groupingButton, isDark && styles.groupingButtonDark]}
                        onPress={() => setShowBucketModal(true)}
                        activeOpacity={0.7}
                      >
                        <IconButton
                          icon="chart-timeline-variant"
                          iconColor={
                            bucketType !== DEFAULT_BUCKET_TYPE[sectionTimeRange]
                              ? colors.primary
                              : isDark
                                ? darkColors.textSecondary
                                : colors.textSecondary
                          }
                          size={18}
                          style={{ margin: 0 }}
                        />
                      </TouchableOpacity>
                    </View>
                    <Text style={[styles.bucketSubtitle, isDark && styles.textMuted]}>
                      {t(BUCKET_TYPES.find((bt) => bt.id === bucketType)!.labelKey)}
                      {' · '}
                      {t('sections.traversalsCount', { count: bucketResult?.totalTraversals ?? 0 })}
                    </Text>
                  </View>
                  <UnifiedPerformanceChart
                    chartData={bucketChartData}
                    activityType={section.sportType as ActivityType}
                    isDark={isDark}
                    minSpeed={bucketMinSpeed}
                    maxSpeed={bucketMaxSpeed}
                    bestIndex={bucketBestIndex}
                    hasReverseRuns={bucketHasReverseRuns}
                    tooltipBadgeType="time"
                    onActivitySelect={handleActivitySelect}
                    onScrubChange={handleScrubChange}
                    selectedActivityId={highlightedActivityId}
                    summaryStats={bucketSummaryStats ?? summaryStats}
                    bestForwardRecord={bucketBestForward ?? computedBestForward}
                    bestReverseRecord={bucketBestReverse ?? computedBestReverse}
                    forwardStats={bucketForwardStats ?? computedForwardStats}
                    reverseStats={bucketReverseStats ?? computedReverseStats}
                    linearTimeAxis
                  />
                </View>
              )}
              {!useBucketedChart && chartData.length >= 1 && (
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
                    summaryStats={summaryStats}
                    bestForwardRecord={computedBestForward}
                    bestReverseRecord={computedBestReverse}
                    forwardStats={computedForwardStats}
                    reverseStats={computedReverseStats}
                  />
                </View>
              )}

              {/* Calendar performance history */}
              {calendarSummary && calendarSummary.years.length >= 1 && (
                <CollapsibleSection
                  title={t('sections.performanceHistory')}
                  icon="calendar-clock"
                  expanded={showHistory}
                  onToggle={setShowHistory}
                  estimatedHeight={calendarSummary.years.length * 200}
                  style={styles.calendarSection}
                >
                  {calendarSummary.years.map((yearData) => {
                    const isYearExpanded = expandedYears.has(yearData.year);
                    // Show best from either direction for the year subtitle
                    const yearFwd = yearData.forward;
                    const yearRev = yearData.reverse;
                    const yearBest =
                      yearFwd && yearRev
                        ? yearFwd.bestTime <= yearRev.bestTime
                          ? yearFwd
                          : yearRev
                        : (yearFwd ?? yearRev);
                    const yearBestDisplay = yearBest
                      ? isRunning
                        ? formatPace(yearBest.bestPace)
                        : formatDuration(yearBest.bestTime)
                      : '';
                    const isYearFwdPr =
                      yearFwd &&
                      calendarSummary.forwardPr &&
                      yearFwd.bestActivityId === calendarSummary.forwardPr.bestActivityId;
                    const isYearRevPr =
                      yearRev &&
                      calendarSummary.reversePr &&
                      yearRev.bestActivityId === calendarSummary.reversePr.bestActivityId;

                    return (
                      <View key={yearData.year}>
                        <Pressable
                          style={[styles.calendarYearRow, isDark && styles.calendarYearRowDark]}
                          onPress={() => toggleYear(yearData.year)}
                        >
                          <MaterialCommunityIcons
                            name={isYearExpanded ? 'chevron-down' : 'chevron-right'}
                            size={20}
                            color={isDark ? darkColors.textSecondary : colors.textSecondary}
                          />
                          <Text style={[styles.calendarYearText, isDark && styles.textLight]}>
                            {yearData.year}
                          </Text>
                          <Text style={[styles.calendarYearSubtitle, isDark && styles.textMuted]}>
                            {t('sections.traversalsSummary', {
                              count: yearData.traversalCount,
                              time: yearBestDisplay,
                            })}
                          </Text>
                          {isYearFwdPr && (
                            <MaterialCommunityIcons
                              name="trophy"
                              size={14}
                              color={activityColor}
                              style={styles.calendarTrophy}
                            />
                          )}
                          {isYearRevPr && (
                            <MaterialCommunityIcons
                              name="trophy"
                              size={14}
                              color={REVERSE_COLOR}
                              style={styles.calendarTrophy}
                            />
                          )}
                        </Pressable>
                        {isYearExpanded &&
                          yearData.months.map((monthData) => {
                            const fwd = monthData.forward;
                            const rev = monthData.reverse;
                            // Is this month's forward best the year's forward best?
                            const isMonthFwdYearBest =
                              fwd && yearFwd && fwd.bestActivityId === yearFwd.bestActivityId;
                            // Is this month's reverse best the year's reverse best?
                            const isMonthRevYearBest =
                              rev && yearRev && rev.bestActivityId === yearRev.bestActivityId;
                            // Is this the overall PR in either direction?
                            const isMonthFwdOverallPr =
                              fwd &&
                              calendarSummary.forwardPr &&
                              fwd.bestActivityId === calendarSummary.forwardPr.bestActivityId;
                            const isMonthRevOverallPr =
                              rev &&
                              calendarSummary.reversePr &&
                              rev.bestActivityId === calendarSummary.reversePr.bestActivityId;

                            return (
                              <View
                                key={monthData.month}
                                style={[
                                  styles.calendarMonthRow,
                                  isDark && styles.calendarMonthRowDark,
                                ]}
                              >
                                <Text
                                  style={[styles.calendarMonthName, isDark && styles.textMuted]}
                                >
                                  {monthNames[monthData.month - 1]}
                                </Text>
                                <Text
                                  style={[styles.calendarMonthCount, isDark && styles.textMuted]}
                                >
                                  {monthData.traversalCount}
                                </Text>
                                <View style={styles.calendarMonthEntries}>
                                  {fwd && (
                                    <Pressable
                                      style={styles.calendarMonthEntry}
                                      onPress={() => router.push(`/activity/${fwd.bestActivityId}`)}
                                    >
                                      <View
                                        style={[
                                          styles.calendarDirDot,
                                          { backgroundColor: activityColor },
                                        ]}
                                      />
                                      <Text
                                        style={[
                                          styles.calendarMonthTime,
                                          isDark && styles.textLight,
                                          isMonthFwdYearBest && { fontWeight: '700' },
                                        ]}
                                      >
                                        {isRunning
                                          ? formatPace(fwd.bestPace)
                                          : formatDuration(fwd.bestTime)}
                                      </Text>
                                      {(isMonthFwdYearBest || isMonthFwdOverallPr) && (
                                        <MaterialCommunityIcons
                                          name="trophy"
                                          size={12}
                                          color={
                                            isMonthFwdOverallPr ? colors.chartGold : activityColor
                                          }
                                        />
                                      )}
                                    </Pressable>
                                  )}
                                  {rev && (
                                    <Pressable
                                      style={styles.calendarMonthEntry}
                                      onPress={() => router.push(`/activity/${rev.bestActivityId}`)}
                                    >
                                      <View
                                        style={[
                                          styles.calendarDirDot,
                                          { backgroundColor: REVERSE_COLOR },
                                        ]}
                                      />
                                      <Text
                                        style={[
                                          styles.calendarMonthTime,
                                          isDark && styles.textLight,
                                          isMonthRevYearBest && { fontWeight: '700' },
                                        ]}
                                      >
                                        {isRunning
                                          ? formatPace(rev.bestPace)
                                          : formatDuration(rev.bestTime)}
                                      </Text>
                                      {(isMonthRevYearBest || isMonthRevOverallPr) && (
                                        <MaterialCommunityIcons
                                          name="trophy"
                                          size={12}
                                          color={
                                            isMonthRevOverallPr ? colors.chartGold : REVERSE_COLOR
                                          }
                                        />
                                      )}
                                    </Pressable>
                                  )}
                                </View>
                              </View>
                            );
                          })}
                      </View>
                    );
                  })}
                </CollapsibleSection>
              )}

              {/* Activities header */}
              <View style={styles.activitiesSection}>
                <View style={styles.activitiesHeader}>
                  <Text style={[styles.sectionTitle, isDark && styles.textLight]}>
                    {t('sections.activities')}
                  </Text>
                  {/* Legend */}
                  <View style={styles.legend}>
                    <View style={styles.legendItem}>
                      <View
                        style={[styles.legendIndicator, { backgroundColor: colors.chartGold }]}
                      />
                      <MaterialCommunityIcons name="trophy" size={12} color={colors.chartGold} />
                      <Text style={[styles.legendText, isDark && styles.textMuted]}>
                        {t('routes.pr')}
                      </Text>
                    </View>
                    <View style={styles.legendItem}>
                      <View
                        style={[styles.legendIndicator, { backgroundColor: colors.chartCyan }]}
                      />
                      <MaterialCommunityIcons name="star" size={12} color={colors.chartCyan} />
                      <Text style={[styles.legendText, isDark && styles.textMuted]}>
                        {t('sections.reference')}
                      </Text>
                    </View>
                  </View>
                </View>
              </View>
            </View>
          </>
        }
        ListEmptyComponent={
          isLoading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="small" color={colors.primary} />
            </View>
          ) : (
            <Text style={[styles.emptyActivities, isDark && styles.textMuted]}>
              {t('sections.noActivitiesFound')}
            </Text>
          )
        }
        ListFooterComponent={
          <View style={styles.listFooterContainer}>
            {section?.polyline?.length > 0 && (
              <TouchableOpacity
                testID="section-export-gpx"
                style={[styles.exportGpxButton, isDark && styles.exportGpxButtonDark]}
                onPress={() =>
                  exportGpx({
                    name: section.name || 'Section',
                    points: section.polyline.map((p: RoutePoint) => ({
                      latitude: p.lat,
                      longitude: p.lng,
                    })),
                    sport: section.sportType,
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
            <DataRangeFooter days={cacheDays} isDark={isDark} />
            {debugEnabled &&
              section &&
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
                const actCount = section.activityIds.length;
                if (actCount > 500)
                  warnings.push({ level: 'error', message: `${actCount} activities (>500)` });
                else if (actCount > 100)
                  warnings.push({ level: 'warn', message: `${actCount} activities (>100)` });
                if (section.polyline.length > 2000)
                  warnings.push({
                    level: 'warn',
                    message: `${section.polyline.length} polyline points (>2000)`,
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
                            section.id.length > 20 ? section.id.slice(0, 20) + '...' : section.id,
                        },
                        { label: 'Type', value: section.sectionType },
                        {
                          label: 'Stability',
                          value: section.stability != null ? section.stability.toFixed(3) : '-',
                        },
                        {
                          label: 'Version',
                          value: section.version != null ? String(section.version) : '-',
                        },
                        {
                          label: 'Updated',
                          value: section.updatedAt ? formatRelativeDate(section.updatedAt) : '-',
                        },
                        {
                          label: 'Created',
                          value: section.createdAt ? formatRelativeDate(section.createdAt) : '-',
                        },
                        {
                          label: 'Confidence',
                          value: section.confidence != null ? section.confidence.toFixed(2) : '-',
                        },
                        {
                          label: 'Observations',
                          value:
                            section.observationCount != null
                              ? String(section.observationCount)
                              : '-',
                        },
                        {
                          label: 'Avg Spread',
                          value:
                            section.averageSpread != null
                              ? section.averageSpread.toFixed(1) + 'm'
                              : '-',
                        },
                        {
                          label: 'Reference',
                          value: section.representativeActivityId
                            ? section.representativeActivityId.slice(0, 20) + '...'
                            : '-',
                        },
                        { label: 'User Defined', value: section.isUserDefined ? 'Yes' : 'No' },
                        { label: 'Activities', value: String(actCount) },
                        { label: 'Points', value: String(section.polyline.length) },
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
        }
      />

      {/* Bucket grouping modal */}
      {showBucketModal && (
        <Modal
          visible
          transparent
          animationType="fade"
          onRequestClose={() => setShowBucketModal(false)}
        >
          <Pressable style={styles.modalOverlay} onPress={() => setShowBucketModal(false)}>
            <View style={[styles.modalContent, isDark && styles.modalContentDark]}>
              <Text style={[styles.modalTitle, isDark && styles.modalTitleDark]}>
                {t('sections.groupingTitle')}
              </Text>
              <Text style={[styles.modalDescription, isDark && styles.modalDescriptionDark]}>
                {t('sections.groupingDescription')}
              </Text>
              <View style={styles.groupingOptions}>
                {BUCKET_TYPES.map((bt) => (
                  <TouchableOpacity
                    key={bt.id}
                    style={[
                      styles.groupingOption,
                      isDark && styles.groupingOptionDark,
                      bucketType === bt.id && styles.groupingOptionActive,
                    ]}
                    onPress={() => {
                      setBucketType(bt.id);
                      setShowBucketModal(false);
                    }}
                    activeOpacity={0.7}
                  >
                    <Text
                      style={[
                        styles.groupingOptionText,
                        isDark && styles.groupingOptionTextDark,
                        bucketType === bt.id && styles.groupingOptionTextActive,
                      ]}
                    >
                      {t(bt.labelKey)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          </Pressable>
        </Modal>
      )}
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
  flatListContent: {
    paddingBottom: spacing.xl + TAB_BAR_SAFE_PADDING,
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
  exportGpxButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
    borderRadius: 24,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    marginHorizontal: spacing.md,
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
  chartSection: {
    marginBottom: spacing.lg,
  },
  timeRangeRow: {
    marginBottom: spacing.sm,
  },
  timeRangeContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: spacing.xs,
    marginBottom: spacing.xs,
  },
  timeRangeButton: {
    paddingHorizontal: spacing.sm + 4,
    paddingVertical: spacing.xs,
    borderRadius: 14,
    backgroundColor: opacity.overlay.light,
  },
  timeRangeButtonDark: {
    backgroundColor: opacity.overlayDark.medium,
  },
  timeRangeButtonActive: {
    backgroundColor: colors.primary,
  },
  timeRangeText: {
    ...typography.caption,
    fontWeight: '500',
    color: colors.textSecondary,
  },
  timeRangeTextDark: {
    color: darkColors.textSecondary,
  },
  timeRangeTextActive: {
    color: colors.textOnDark,
  },
  bucketSubtitle: {
    ...typography.caption,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  timeRangeWithButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    marginBottom: spacing.xs,
  },
  groupingButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: opacity.overlay.light,
    justifyContent: 'center',
    alignItems: 'center',
  },
  groupingButtonDark: {
    backgroundColor: opacity.overlayDark.medium,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: opacity.overlay.full,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.lg,
  },
  modalContent: {
    backgroundColor: colors.surface,
    borderRadius: layout.borderRadius + 4,
    padding: spacing.lg,
    width: '100%',
    maxWidth: 320,
  },
  modalContentDark: {
    backgroundColor: darkColors.surface,
  },
  modalTitle: {
    ...typography.cardTitle,
    color: colors.textPrimary,
    textAlign: 'center',
    marginBottom: spacing.xs,
  },
  modalTitleDark: {
    color: darkColors.textPrimary,
  },
  modalDescription: {
    ...typography.bodySmall,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.md,
  },
  modalDescriptionDark: {
    color: darkColors.textSecondary,
  },
  groupingOptions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  groupingOption: {
    paddingHorizontal: spacing.sm + 4,
    paddingVertical: spacing.xs + 2,
    borderRadius: 14,
    backgroundColor: opacity.overlay.light,
  },
  groupingOptionDark: {
    backgroundColor: opacity.overlayDark.medium,
  },
  groupingOptionActive: {
    backgroundColor: colors.primary,
  },
  groupingOptionText: {
    ...typography.caption,
    fontWeight: '500',
    color: colors.textSecondary,
  },
  groupingOptionTextDark: {
    color: darkColors.textSecondary,
  },
  groupingOptionTextActive: {
    color: colors.textOnDark,
  },
  calendarSection: {
    marginBottom: spacing.md,
  },
  calendarYearRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    gap: spacing.xs,
  },
  calendarYearRowDark: {
    // handled by isDark prop
  },
  calendarYearText: {
    fontSize: typography.body.fontSize,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  calendarYearSubtitle: {
    fontSize: typography.caption.fontSize,
    color: colors.textSecondary,
    flex: 1,
  },
  calendarTrophy: {
    marginLeft: spacing.xs,
  },
  calendarMonthRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.xs,
    paddingLeft: spacing.md + 20 + spacing.xs,
    paddingRight: spacing.md,
    gap: spacing.sm,
  },
  calendarMonthRowDark: {
    // handled by isDark prop
  },
  calendarMonthName: {
    fontSize: typography.bodySmall.fontSize,
    color: colors.textSecondary,
    width: 36,
  },
  calendarMonthCount: {
    fontSize: typography.caption.fontSize,
    color: colors.textSecondary,
    width: 24,
    textAlign: 'center',
  },
  calendarMonthEntries: {
    flex: 1,
    gap: 2,
  },
  calendarMonthEntry: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  calendarDirDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  calendarMonthTime: {
    fontSize: typography.bodySmall.fontSize,
    fontWeight: '500',
    color: colors.textPrimary,
    flex: 1,
  },
  activitiesSection: {
    marginBottom: spacing.xl,
  },
  activitiesHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  sectionTitle: {
    fontSize: typography.body.fontSize,
    fontWeight: '600',
    color: colors.textPrimary,
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
  activityRowReference: {
    borderLeftWidth: 3,
    borderLeftColor: colors.chartCyan,
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
  referenceBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: layout.borderRadiusSm,
    backgroundColor: colors.chartCyan + '20',
    gap: 2,
  },
  referenceBadgeDark: {
    backgroundColor: colors.chartCyan + '30',
  },
  referenceText: {
    fontSize: typography.label.fontSize,
    fontWeight: '600',
    color: colors.chartCyan,
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

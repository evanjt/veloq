/**
 * Section detail page.
 * Shows a frequently-traveled section with all activities that traverse it.
 */

import React, { useMemo, useCallback, useState, useEffect, useRef } from 'react';
import {
  View,
  FlatList,
  StyleSheet,
  StatusBar,
  TouchableOpacity,
  TextInput,
  Keyboard,
  Alert,
  InteractionManager,
} from 'react-native';
import { Text, ActivityIndicator } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, router } from 'expo-router';
import { logScreenRender } from '@/lib/debug/renderTimer';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import {
  useSectionPerformances,
  useCustomSections,
  useTheme,
  useCacheDays,
  useGpxExport,
  useSectionChartData,
} from '@/hooks';
import { useSectionDetail } from '@/hooks/routes/useRouteEngine';
import { useSectionTrim } from '@/hooks/routes/useSectionTrim';
import { getAllSectionDisplayNames } from '@/hooks/routes/useUnifiedSections';
import { useDisabledSections } from '@/providers';
import { DataRangeFooter, DebugInfoPanel, DebugWarningBanner } from '@/components/routes';
import { useDebugStore } from '@/providers';
import { useFFITimer } from '@/hooks/debug/useFFITimer';
import { TAB_BAR_SAFE_PADDING, ScreenErrorBoundary } from '@/components/ui';
import {
  SectionHeader,
  SectionPerformanceSection,
  SectionStatsCards,
  ActivityRow,
  TraversalListHeader,
} from '@/components/section';
import { getRouteEngine } from '@/lib/native/routeEngine';
import { formatRelativeDate, getActivityIcon, getActivityColor, isRunningActivity } from '@/lib';
import { fromUnixSeconds } from '@/lib/utils/ffiConversions';
import { colors, darkColors, spacing, layout, typography } from '@/theme';
import type { SectionTimeRange, BucketType } from '@/constants';
import type { Activity, ActivityType, RoutePoint, FrequentSection } from '@/types';

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
  const { isDark } = useTheme();
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

  // Time range for chart data (passed to useSectionChartData)
  const [sectionTimeRange] = useState<SectionTimeRange>('1y');
  const [bucketType] = useState<BucketType>('monthly');

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

  // Section bounds trimming
  const handleTrimRefresh = useCallback(() => {
    setSectionRefreshKey((k) => k + 1);
  }, []);
  const {
    isTrimming,
    trimStart,
    trimEnd,
    isSaving: isTrimSaving,
    trimmedDistance,
    canReset: canResetBounds,
    startTrim,
    cancelTrim,
    confirmTrim,
    resetBounds,
    setTrimStart,
    setTrimEnd,
  } = useSectionTrim(section, handleTrimRefresh);

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
      if (__DEV__) console.error('Failed to save section name:', error);
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
            if (__DEV__) console.error('Failed to delete section:', error);
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
      const isUserDefinedRef = engine.getSectionReferenceInfo(id).isUserDefined;

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

  // Handle removing/restoring an auto-detected section
  const handleToggleDisable = useCallback(() => {
    if (!id || isCustomId) return;

    if (isSectionDisabled) {
      // Restore
      enable(id);
    } else {
      // Remove with confirmation, navigate back after
      Alert.alert(t('sections.removeSection'), t('sections.removeSectionConfirm'), [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.remove'),
          style: 'destructive',
          onPress: () => {
            disable(id);
            router.back();
          },
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

  const {
    portionMap,
    performanceRecordMap,
    sectionActivities,
    chartData,
    rankMap,
    bestActivityId,
    bestTimeValue,
    bestPaceValue,
  } = useSectionChartData({
    section,
    performanceRecords,
    sectionActivitiesUnsorted,
    sectionWithTraces,
    sectionTimeRange,
    bucketType,
  });

  const activityCount = section?.activityIds?.length ?? 0;

  // Calendar summary: Year > Month performance history
  const calendarSummary = useMemo(() => {
    if (!section?.id) return null;
    try {
      const engine = getRouteEngine();
      if (!engine) return null;
      const t0 = performance.now();
      const result = engine.getSectionCalendarSummary(section.id);
      if (__DEV__)
        console.log(`[PERF] getSectionCalendarSummary: ${(performance.now() - t0).toFixed(1)}ms`);
      return result ?? null;
    } catch {
      return null;
    }
  }, [section?.id]);

  const isRunning = section ? isRunningActivity(section.sportType as ActivityType) : false;

  const computedForwardStats = forwardStats;
  const computedReverseStats = reverseStats;
  const computedBestForward = bestForwardRecord ?? null;
  const computedBestReverse = bestReverseRecord ?? null;

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
    <ScreenErrorBoundary screenName="Section Detail">
      <View
        testID="section-detail-screen"
        style={[styles.container, isDark && styles.containerDark]}
      >
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
              <SectionHeader
                section={section}
                isDark={isDark}
                insetTop={insets.top}
                activityColor={activityColor}
                iconName={iconName}
                activityCount={activityCount}
                mapReady={mapReady}
                isCustomId={!!isCustomId}
                isSectionDisabled={isSectionDisabled}
                isEditing={isEditing}
                editName={editName}
                customName={customName}
                nameInputRef={nameInputRef}
                canResetBounds={canResetBounds}
                isTrimming={isTrimming}
                trimStart={trimStart}
                trimEnd={trimEnd}
                isTrimSaving={isTrimSaving}
                trimmedDistance={trimmedDistance}
                shadowTrack={shadowTrack}
                highlightedActivityId={mapHighlightedActivityId}
                highlightedLapPoints={mapHighlightedLapPoints}
                allActivityTraces={sectionWithTraces?.activityTraces}
                isScrubbing={isScrubbing}
                onBack={() => router.back()}
                onStartTrim={startTrim}
                onDeleteSection={handleDeleteSection}
                onToggleDisable={handleToggleDisable}
                onStartEditing={handleStartEditing}
                onSaveName={handleSaveName}
                onCancelEdit={handleCancelEdit}
                onEditNameChange={setEditName}
                onTrimStartChange={setTrimStart}
                onTrimEndChange={setTrimEnd}
                onConfirmTrim={confirmTrim}
                onCancelTrim={cancelTrim}
                onResetBounds={resetBounds}
              />

              {/* Content below hero */}
              <View style={styles.contentSection}>
                {/* Disabled banner */}
                {isSectionDisabled && (
                  <TouchableOpacity
                    style={[styles.disabledBanner, isDark && styles.disabledBannerDark]}
                    onPress={handleToggleDisable}
                    activeOpacity={0.8}
                  >
                    <MaterialCommunityIcons
                      name="delete-outline"
                      size={18}
                      color={colors.warning}
                    />
                    <Text style={styles.disabledBannerText}>
                      {t('sections.removed')} — {t('sections.restoreSection')}
                    </Text>
                  </TouchableOpacity>
                )}

                {/* Performance chart */}
                <SectionPerformanceSection
                  isDark={isDark}
                  section={section}
                  chartData={chartData}
                  forwardStats={computedForwardStats}
                  reverseStats={computedReverseStats}
                  bestForwardRecord={computedBestForward}
                  bestReverseRecord={computedBestReverse}
                  onActivitySelect={handleActivitySelect}
                  onScrubChange={handleScrubChange}
                />

                {/* Calendar performance history */}
                {calendarSummary && (
                  <SectionStatsCards
                    calendarSummary={calendarSummary}
                    isDark={isDark}
                    isRunning={isRunning}
                    activityColor={activityColor}
                  />
                )}

                {/* Activities header */}
                <TraversalListHeader isDark={isDark} />
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
                  const warnings: Array<{
                    level: 'warn' | 'error';
                    message: string;
                  }> = [];
                  const actCount = section.activityIds.length;
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
                          {
                            label: 'User Defined',
                            value: section.isUserDefined ? 'Yes' : 'No',
                          },
                          { label: 'Activities', value: String(actCount) },
                          {
                            label: 'Points',
                            value: String(section.polyline.length),
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
          }
        />
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
  flatListContent: {
    paddingBottom: spacing.xl + TAB_BAR_SAFE_PADDING,
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
});

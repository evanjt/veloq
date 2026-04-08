/**
 * Section detail page.
 * Shows a frequently-traveled section with all activities that traverse it.
 */

import React, { useMemo, useCallback, useState, useEffect, useRef } from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  StatusBar,
  TouchableOpacity,
  TextInput,
  Keyboard,
  Alert,
  InteractionManager,
} from 'react-native';
import { Text, SegmentedButtons } from 'react-native-paper';
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
  useNearbySections,
  useMergeSections,
  useSectionRescan,
} from '@/hooks';
import { useSectionDetail } from '@/hooks/routes/useRouteEngine';
import { useSectionTrim } from '@/hooks/routes/useSectionTrim';
import { getAllSectionDisplayNames } from '@/hooks/routes/useUnifiedSections';
import { DataRangeFooter, DebugInfoPanel, DebugWarningBanner } from '@/components/routes';
import { useDebugStore } from '@/providers';
import { useFFITimer } from '@/hooks/debug/useFFITimer';
import { TAB_BAR_SAFE_PADDING, ScreenErrorBoundary } from '@/components/ui';
import {
  SectionHeader,
  SectionPerformanceSection,
  SectionStatsCards,
  SectionInfoCard,
  MergeConfirmDialog,
} from '@/components/section';
import { getRouteEngine } from '@/lib/native/routeEngine';
import {
  formatRelativeDate,
  getActivityIcon,
  getActivityColor,
  isRunningActivity,
  type MaterialIconName,
} from '@/lib';
import { fromUnixSeconds } from '@/lib/utils/ffiConversions';
import { colors, darkColors, spacing, layout, typography } from '@/theme';
import {
  SECTION_TIME_RANGES,
  DEFAULT_BUCKET_TYPE,
  type SectionTimeRange,
  type BucketType,
} from '@/constants';
import type {
  Activity,
  ActivityType,
  RoutePoint,
  FrequentSection,
  PerformanceDataPoint,
} from '@/types';

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

  // Nearby sections and merge candidates
  const { nearby } = useNearbySections(id);
  const { candidates: mergeCandidates, merge: mergeSections, isMerging } = useMergeSections(id);
  const { rescan, isScanning: isRematching } = useSectionRescan();

  const [highlightedActivityId, setHighlightedActivityId] = useState<string | null>(null);
  const [highlightedActivityPoints, setHighlightedActivityPoints] = useState<
    RoutePoint[] | undefined
  >(undefined);
  // Track if user is actively scrubbing - used to defer expensive map updates
  const [isScrubbing, setIsScrubbing] = useState(false);
  // Defer map loading until after first paint for faster perceived load
  const [mapReady, setMapReady] = useState(false);
  // Merge dialog state
  const [mergeTarget, setMergeTarget] = useState<(typeof mergeCandidates)[number] | null>(null);

  // Time range for chart data (passed to useSectionChartData)
  const [sectionTimeRange, setSectionTimeRange] = useState<SectionTimeRange>('1y');
  const [bucketType, setBucketType] = useState<BucketType>('monthly');

  // State for section renaming
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [customName, setCustomName] = useState<string | null>(null);
  const nameInputRef = useRef<TextInput>(null);

  // State for overriding the reference activity (for immediate UI update)
  const [overrideReferenceId, setOverrideReferenceId] = useState<string | null>(null);
  // Key to force section data refresh after reference change
  const [sectionRefreshKey, setSectionRefreshKey] = useState(0);

  // Excluded activities state
  const [showExcluded, setShowExcluded] = useState(false);
  const [excludedActivityIds, setExcludedActivityIds] = useState<Set<string>>(new Set());

  // Sport type filter for cross-sport sections
  const [selectedSportType, setSelectedSportType] = useState<string | undefined>(undefined);

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

  // Disabled state from section data
  const isSectionDisabled = !!(section?.disabled || section?.supersededBy);

  // Section bounds trimming
  const handleTrimRefresh = useCallback(() => {
    setSectionRefreshKey((k) => k + 1);
  }, []);
  const {
    isTrimming,
    isExpanded: isExpandMode,
    trimStart,
    trimEnd,
    isSaving: isTrimSaving,
    trimmedDistance,
    canReset: canResetBounds,
    effectivePointCount,
    sectionStartInWindow,
    sectionEndInWindow,
    expandContextPoints,
    startTrim,
    cancelTrim,
    confirmTrim,
    resetBounds,
    toggleExpand,
    setTrimStart,
    setTrimEnd,
  } = useSectionTrim(section, handleTrimRefresh);

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
    if (!id || !isCustomId) {
      if (__DEV__) console.warn('[SectionDetail] Delete blocked:', { id, isCustomId });
      return;
    }

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
            Alert.alert(t('common.error'), String(error));
          }
        },
      },
    ]);
  }, [id, isCustomId, removeSection, t]);

  // Get the effective reference activity ID (override takes precedence)
  const effectiveReferenceId = overrideReferenceId ?? section?.representativeActivityId;

  // Derive reference activity name and whether it's user-defined (for info card)
  const isReferenceUserDefined = useMemo(() => {
    if (!id) return false;
    const engine = getRouteEngine();
    if (!engine) return false;
    return engine.getSectionReferenceInfo(id).isUserDefined;
  }, [id, sectionRefreshKey]);

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
      getRouteEngine()?.enableSection(id);
    } else {
      // Remove with confirmation, navigate back after
      Alert.alert(t('sections.removeSection'), t('sections.removeSectionConfirm'), [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.remove'),
          style: 'destructive',
          onPress: () => {
            getRouteEngine()?.disableSection(id);
            router.back();
          },
        },
      ]);
    }
  }, [id, isCustomId, isSectionDisabled, t]);

  const handleActivitySelect = useCallback(
    (activityId: string | null, activityPoints?: RoutePoint[]) => {
      setHighlightedActivityId(activityId);
      setHighlightedActivityPoints(activityPoints);
    },
    []
  );

  const handleScrubChange = useCallback((scrubbing: boolean) => {
    setIsScrubbing(scrubbing);
  }, []);

  const handleRematchActivities = useCallback(() => {
    if (!section?.sportType) return;
    rescan(section.sportType);
  }, [section?.sportType, rescan]);

  // Load excluded activity IDs for this section
  useEffect(() => {
    if (!id) return;
    const engine = getRouteEngine();
    if (!engine) return;
    const ids = engine.getExcludedActivityIds(id);
    setExcludedActivityIds(new Set(ids));
  }, [id, sectionRefreshKey]);

  const handleExcludeActivity = useCallback(
    (activityId: string) => {
      if (!id) return;
      const engine = getRouteEngine();
      if (!engine) return;
      engine.excludeActivityFromSection(id, activityId);
      setExcludedActivityIds((prev) => new Set([...prev, activityId]));
      setSectionRefreshKey((k) => k + 1);
    },
    [id]
  );

  const handleIncludeActivity = useCallback(
    (activityId: string) => {
      if (!id) return;
      const engine = getRouteEngine();
      if (!engine) return;
      engine.includeActivityInSection(id, activityId);
      setExcludedActivityIds((prev) => {
        const next = new Set(prev);
        next.delete(activityId);
        return next;
      });
      setSectionRefreshKey((k) => k + 1);
    },
    [id]
  );

  const handleToggleShowExcluded = useCallback(() => {
    setShowExcluded((v) => !v);
  }, []);

  // Get section activities from engine metrics (no API call needed).
  // Activities are already cached in the Rust engine's in-memory HashMap.
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

  // Load simplified GPS signatures for activity trace display during chart scrubbing
  const allActivityTraces = useMemo((): Record<string, RoutePoint[]> | undefined => {
    if (!section?.activityIds?.length) return undefined;
    try {
      const engine = getRouteEngine();
      if (!engine) return undefined;
      const activityIdSet = new Set(section.activityIds);
      const allSigs = engine.getAllMapSignatures();
      const result: Record<string, RoutePoint[]> = {};
      for (const sig of allSigs) {
        if (!activityIdSet.has(sig.activityId) || sig.coords.length < 4) continue;
        const points: RoutePoint[] = [];
        for (let i = 0; i < sig.coords.length - 1; i += 2) {
          points.push({ lat: sig.coords[i], lng: sig.coords[i + 1] });
        }
        result[sig.activityId] = points;
      }
      return Object.keys(result).length > 0 ? result : undefined;
    } catch {
      return undefined;
    }
  }, [section?.activityIds]);

  // Compute available sport types with activity counts for cross-sport sections
  const sportTypeCounts = useMemo(() => {
    if (!section?.activityIds?.length) return [];
    const engine = getRouteEngine();
    if (!engine) return [];
    try {
      const metrics = engine.getActivityMetricsForIds(section.activityIds);
      const counts = new Map<string, number>();
      for (const m of metrics) {
        if (m.sportType) counts.set(m.sportType, (counts.get(m.sportType) ?? 0) + 1);
      }
      return Array.from(counts.entries())
        .map(([type, count]) => ({ type, count }))
        .sort((a, b) => b.count - a.count);
    } catch {
      return [{ type: section.sportType, count: section.activityIds?.length ?? 0 }];
    }
  }, [section?.id, section?.sportType, section?.activityIds]);

  const availableSportTypes = useMemo(() => sportTypeCounts.map((s) => s.type), [sportTypeCounts]);

  // Effective sport type: matches the visually-selected pill.
  // When selectedSportType is undefined (initial state), default to section's own sport type
  // so the chart data matches the highlighted pill.
  const effectiveSportType = useMemo(() => {
    if (selectedSportType) return selectedSportType;
    if (availableSportTypes.length > 1 && section?.sportType) return section.sportType;
    return undefined;
  }, [selectedSportType, availableSportTypes.length, section?.sportType]);

  // Fetch actual section performance times from activity streams
  // This loads in the background - we show estimated times first, then update when ready
  const {
    records: performanceRecords,
    bestForwardRecord,
    bestReverseRecord,
    forwardStats,
    reverseStats,
  } = useSectionPerformances(section, effectiveSportType);

  // Filter activities by selected sport type for chart data
  const filteredActivities = useMemo(() => {
    if (!effectiveSportType) return sectionActivitiesUnsorted;
    return sectionActivitiesUnsorted.filter((a) => a.type === effectiveSportType);
  }, [sectionActivitiesUnsorted, effectiveSportType]);

  const { chartData } = useSectionChartData({
    section,
    performanceRecords,
    sectionActivitiesUnsorted: filteredActivities,
    sectionWithTraces: null,
    sectionTimeRange,
    bucketType,
  });

  // Build chart data points for excluded activities (shown dimmed on scatter chart)
  const excludedChartData = useMemo((): (PerformanceDataPoint & { x: number })[] => {
    if (!showExcluded || excludedActivityIds.size === 0 || !id) return [];
    try {
      const engine = getRouteEngine();
      if (!engine) return [];
      const result = engine.getExcludedSectionPerformances(id);
      if (!result?.records?.length) return [];

      const points: (PerformanceDataPoint & { x: number })[] = [];
      for (const r of result.records) {
        const date = fromUnixSeconds(r.activityDate);
        if (!date) continue;
        if (r.laps?.length) {
          for (const lap of r.laps) {
            if (lap.pace > 0) {
              points.push({
                x: 0,
                id: lap.id,
                activityId: r.activityId,
                speed: lap.pace,
                date,
                activityName: r.activityName,
                direction: (lap.direction === 'reverse' ? 'reverse' : 'same') as 'same' | 'reverse',
                sectionTime: Math.round(lap.time),
                sectionDistance: lap.distance || r.sectionDistance,
                lapCount: 1,
                isExcluded: true,
              });
            }
          }
        } else if (r.bestPace > 0) {
          points.push({
            x: 0,
            id: r.activityId,
            activityId: r.activityId,
            speed: r.bestPace,
            date,
            activityName: r.activityName,
            direction: (r.direction === 'reverse' ? 'reverse' : 'same') as 'same' | 'reverse',
            sectionTime: Math.round(r.bestTime),
            sectionDistance: r.sectionDistance,
            lapCount: 1,
            isExcluded: true,
          });
        }
      }
      return points;
    } catch (e) {
      if (__DEV__) console.warn('[SectionDetail] getExcludedSectionPerformances failed:', e);
      return [];
    }
  }, [showExcluded, excludedActivityIds, id]);

  const activityCount = section?.visitCount ?? 0;

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

  // Prepare nearby polylines for map overlay (includes metadata for preview popup)
  const nearbyPolylines = useMemo(() => {
    if (!nearby || nearby.length === 0) return undefined;
    const displayNames = getAllSectionDisplayNames();
    return nearby
      .filter((n) => n.polylineCoords && n.polylineCoords.length >= 4)
      .map((n) => ({
        id: n.id,
        name: displayNames[n.id] || n.name,
        sportType: n.sportType,
        distanceMeters: n.distanceMeters,
        visitCount: n.visitCount,
        polylineCoords: n.polylineCoords,
      }));
  }, [nearby]);

  const isRunning = effectiveSportType
    ? isRunningActivity(effectiveSportType as ActivityType)
    : section
      ? isRunningActivity(section.sportType as ActivityType)
      : false;

  const computedForwardStats = forwardStats;
  const computedReverseStats = reverseStats;
  const computedBestForward = bestForwardRecord ?? null;
  const computedBestReverse = bestReverseRecord ?? null;

  // Enrich chart data with PR info for tooltip display
  const enrichedChartData = useMemo(() => {
    if (chartData.length === 0) return chartData;

    // Find best time/speed per direction from non-excluded points
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
      return { ...p, bestTime: dirBestTime, bestSpeed: dirBestSpeed, isBest };
    });
  }, [chartData]);

  // Merge excluded points into chart data when showing excluded
  const combinedChartData = useMemo(() => {
    if (excludedChartData.length === 0) return enrichedChartData;
    return [...enrichedChartData, ...excludedChartData];
  }, [enrichedChartData, excludedChartData]);

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

  const activityColor = colors.primary;
  const iconName: MaterialIconName = 'road-variant';

  return (
    <ScreenErrorBoundary screenName="Section Detail">
      <View
        testID="section-detail-screen"
        style={[styles.container, isDark && styles.containerDark]}
      >
        <StatusBar barStyle="light-content" />
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
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
            isExpandMode={isExpandMode}
            trimStart={trimStart}
            trimEnd={trimEnd}
            isTrimSaving={isTrimSaving}
            trimmedDistance={trimmedDistance}
            effectivePointCount={effectivePointCount}
            sectionStartInWindow={sectionStartInWindow}
            sectionEndInWindow={sectionEndInWindow}
            expandContextPoints={expandContextPoints}
            shadowTrack={undefined}
            highlightedActivityId={highlightedActivityId}
            highlightedLapPoints={highlightedActivityPoints}
            allActivityTraces={allActivityTraces}
            isScrubbing={isScrubbing}
            nearbyPolylines={nearbyPolylines}
            onNearbyPress={(sectionId) => router.push(`/section/${sectionId}`)}
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
            onToggleExpand={toggleExpand}
            onRematchActivities={handleRematchActivities}
            isRematching={isRematching}
          />

          {/* Sport type pills for cross-sport sections */}
          {sportTypeCounts.length > 1 && (
            <View style={styles.sportTypePills}>
              {sportTypeCounts.map(({ type: st, count }) => {
                const isSelected =
                  selectedSportType === st || (!selectedSportType && st === section?.sportType);
                const sportColor = getActivityColor(st as ActivityType);
                return (
                  <TouchableOpacity
                    key={st}
                    onPress={() =>
                      setSelectedSportType(isSelected && selectedSportType ? undefined : st)
                    }
                    style={[
                      styles.sportPill,
                      isSelected && { backgroundColor: sportColor + '20', borderColor: sportColor },
                      isDark && styles.sportPillDark,
                    ]}
                  >
                    <MaterialCommunityIcons
                      name={getActivityIcon(st as ActivityType)}
                      size={14}
                      color={
                        isSelected
                          ? sportColor
                          : isDark
                            ? darkColors.textSecondary
                            : colors.textSecondary
                      }
                    />
                    <Text
                      style={[
                        styles.sportPillText,
                        isSelected && { color: sportColor },
                        isDark && styles.sportPillTextDark,
                      ]}
                    >
                      {t(`activityTypes.${st}`, st)} {count}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}

          {/* Content below hero */}
          <View style={styles.contentSection}>
            {/* Disabled banner */}
            {isSectionDisabled && (
              <TouchableOpacity
                style={[styles.disabledBanner, isDark && styles.disabledBannerDark]}
                onPress={handleToggleDisable}
                activeOpacity={0.8}
              >
                <MaterialCommunityIcons name="delete-outline" size={18} color={colors.warning} />
                <Text style={styles.disabledBannerText}>
                  {t('sections.removed')} — {t('sections.restoreSection')}
                </Text>
              </TouchableOpacity>
            )}

            {/* Merge candidates banner */}
            {mergeCandidates.length > 0 && (
              <TouchableOpacity
                style={[styles.mergeBanner, isDark && styles.mergeBannerDark]}
                onPress={() => setMergeTarget(mergeCandidates[0])}
                activeOpacity={0.8}
              >
                <MaterialCommunityIcons name="call-merge" size={18} color={colors.info} />
                <Text style={[styles.mergeBannerText, isDark && styles.mergeBannerTextDark]}>
                  {t('sections.similarNearbyCount', { count: mergeCandidates.length })}
                </Text>
                <MaterialCommunityIcons
                  name="chevron-right"
                  size={18}
                  color={isDark ? darkColors.textSecondary : colors.textSecondary}
                />
              </TouchableOpacity>
            )}

            {/* Time range selector */}
            <View style={styles.timeRangeContainer}>
              <SegmentedButtons
                value={sectionTimeRange}
                onValueChange={(value) => {
                  const range = value as SectionTimeRange;
                  setSectionTimeRange(range);
                  setBucketType(DEFAULT_BUCKET_TYPE[range]);
                }}
                buttons={SECTION_TIME_RANGES.map((r) => ({
                  value: r.id,
                  label: r.label,
                }))}
                density="small"
              />
            </View>

            {/* Performance chart with eye toggle */}
            <SectionPerformanceSection
              isDark={isDark}
              section={section}
              chartData={combinedChartData}
              forwardStats={computedForwardStats}
              reverseStats={computedReverseStats}
              bestForwardRecord={computedBestForward}
              bestReverseRecord={computedBestReverse}
              onActivitySelect={handleActivitySelect}
              onScrubChange={handleScrubChange}
              onExcludeActivity={handleExcludeActivity}
              onIncludeActivity={handleIncludeActivity}
              onSetAsReference={handleSetAsReference}
              referenceActivityId={effectiveReferenceId}
              showExcluded={showExcluded}
              hasExcluded={excludedActivityIds.size > 0}
              onToggleShowExcluded={handleToggleShowExcluded}
            />

            {/* Section info card */}
            <SectionInfoCard
              chartData={combinedChartData}
              referenceActivityId={effectiveReferenceId}
              referenceActivityName={
                sectionActivitiesUnsorted.find((a) => a.id === effectiveReferenceId)?.name
              }
              isReferenceUserDefined={isReferenceUserDefined}
              isDark={isDark}
            />

            {/* Calendar performance history */}
            {calendarSummary && (
              <SectionStatsCards
                calendarSummary={calendarSummary}
                isDark={isDark}
                isRunning={isRunning}
                activityColor={activityColor}
                onSetAsReference={handleSetAsReference}
                referenceActivityId={effectiveReferenceId}
              />
            )}
          </View>

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
                          value: Number.isFinite(section.stability)
                            ? section.stability!.toFixed(3)
                            : '-',
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
                          value: Number.isFinite(section.confidence)
                            ? section.confidence!.toFixed(2)
                            : '-',
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
                          value: Number.isFinite(section.averageSpread)
                            ? section.averageSpread!.toFixed(1) + 'm'
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
        </ScrollView>
      </View>
      {mergeTarget && section && (
        <MergeConfirmDialog
          visible={!!mergeTarget}
          primary={{
            id: section.id,
            name: section.name ?? section.id,
            sportType: section.sportType,
            visitCount: section.visitCount,
            distanceMeters: section.distanceMeters,
          }}
          secondary={{
            id: mergeTarget.sectionId,
            name: mergeTarget.name ?? mergeTarget.sectionId,
            sportType: mergeTarget.sportType,
            visitCount: mergeTarget.visitCount,
            distanceMeters: mergeTarget.distanceMeters,
          }}
          onConfirm={(primaryId, secondaryId) => {
            const result = mergeSections(primaryId, secondaryId);
            setMergeTarget(null);
            if (result && result !== id) {
              router.replace(`/section/${result}`);
            }
          }}
          onCancel={() => setMergeTarget(null)}
          loading={isMerging}
        />
      )}
    </ScreenErrorBoundary>
  );
}

const styles = StyleSheet.create({
  timeRangeContainer: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
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
  sportTypePills: {
    flexDirection: 'row',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    gap: spacing.xs,
  },
  sportPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 4,
  },
  sportPillDark: {
    borderColor: darkColors.border,
  },
  sportPillText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  sportPillTextDark: {
    color: darkColors.textSecondary,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
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
  mergeBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.info + '10',
    borderWidth: 1,
    borderColor: colors.info + '25',
    borderRadius: layout.borderRadius,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  mergeBannerDark: {
    backgroundColor: colors.info + '15',
    borderColor: colors.info + '30',
  },
  mergeBannerText: {
    flex: 1,
    fontSize: typography.bodySmall.fontSize,
    fontWeight: '500',
    color: colors.info,
  },
  mergeBannerTextDark: {
    color: colors.infoLight,
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
});

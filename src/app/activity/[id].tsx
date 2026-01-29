import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  Dimensions,
  Modal,
  StatusBar,
  useWindowDimensions,
  Alert,
  Animated,
} from 'react-native';
import { Text, IconButton, ActivityIndicator } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ScreenSafeAreaView, TAB_BAR_SAFE_PADDING } from '@/components/ui';
import { logScreenRender } from '@/lib/debug/renderTimer';
import { useLocalSearchParams, router, type Href } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useTranslation } from 'react-i18next';
import * as ScreenOrientation from 'expo-screen-orientation';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import Swipeable from 'react-native-gesture-handler/Swipeable';
import { RectButton } from 'react-native-gesture-handler';
import * as Haptics from 'expo-haptics';
import {
  useActivity,
  useActivityStreams,
  useWellnessForDate,
  useTheme,
  useMetricSystem,
  useCacheDays,
} from '@/hooks';
import { useDisabledSections } from '@/providers';
import { createSharedStyles } from '@/styles';
import { useCustomSections } from '@/hooks/routes/useCustomSections';
import { useRouteMatch } from '@/hooks/routes/useRouteMatch';
import { useSectionMatches, type SectionMatch } from '@/hooks/routes/useSectionMatches';
import { routeEngine } from 'veloqrs';
import { intervalsApi } from '@/api';
import {
  ActivityMapView,
  CombinedPlot,
  ChartTypeSelector,
  HRZonesChart,
  InsightfulStats,
  RoutePerformanceSection,
  MiniTraceView,
} from '@/components';
import { DataRangeFooter, SectionMiniPreview } from '@/components/routes';
import type { SectionOverlay } from '@/components/maps/ActivityMapView';
import { SwipeableTabs, type SwipeableTab } from '@/components/ui';
import type {
  SectionCreationResult,
  SectionCreationError,
} from '@/components/maps/ActivityMapView';
import type { CreationState } from '@/components/maps/SectionCreationOverlay';
import {
  formatDistance,
  formatDuration,
  formatElevation,
  formatHeartRate,
  formatPower,
  formatSpeed,
  formatPace,
  formatDateTime,
  getActivityColor,
  isRunningActivity,
  decodePolyline,
  convertLatLngTuples,
  getAvailableCharts,
  CHART_CONFIGS,
  getSectionStyle,
} from '@/lib';
import { colors, darkColors, spacing, typography, layout, opacity } from '@/theme';
import { DeviceAttribution, ComponentErrorBoundary } from '@/components/ui';
import type { ChartTypeId } from '@/lib';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const MAP_HEIGHT = Math.round(SCREEN_HEIGHT * 0.42); // 42% of screen - better data visibility

// Default chart by activity type - single most useful metric
// Power for cycling (objective training metric), HR for running (consistent across terrain), pace for swimming
const DEFAULT_CHART: Record<string, ChartTypeId> = {
  Ride: 'power',
  VirtualRide: 'power',
  MountainBikeRide: 'power',
  GravelRide: 'power',
  EBikeRide: 'power',
  Run: 'heartrate',
  VirtualRun: 'heartrate',
  TrailRun: 'heartrate',
  Swim: 'pace',
  OpenWaterSwim: 'pace',
  Walk: 'heartrate',
  Hike: 'heartrate',
  Workout: 'heartrate',
  WeightTraining: 'heartrate',
  Yoga: 'heartrate',
  Rowing: 'power',
  Kayaking: 'heartrate',
  Canoeing: 'heartrate',
};

export default function ActivityDetailScreen() {
  // Performance timing
  const perfEndRef = useRef<(() => void) | null>(null);
  perfEndRef.current = logScreenRender('ActivityDetailScreen');
  useEffect(() => {
    perfEndRef.current?.();
  });

  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { isDark, colors: themeColors } = useTheme();
  const isMetric = useMetricSystem();
  const shared = createSharedStyles(isDark);
  const insets = useSafeAreaInsets();
  // Use dynamic dimensions for fullscreen chart (updates after rotation)
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();

  const { data: activity, isLoading, error } = useActivity(id || '');
  const { data: streams } = useActivityStreams(id || '');

  // Get the activity date for wellness lookup
  const activityDate = activity?.start_date_local?.split('T')[0];
  const { data: activityWellness } = useWellnessForDate(activityDate);

  // Track the selected point index from charts for map highlight
  const [highlightIndex, setHighlightIndex] = useState<number | null>(null);
  // Track whether any chart is being interacted with to disable ScrollView
  const [chartInteracting, setChartInteracting] = useState(false);
  // Track whether 3D map mode is active to disable ScrollView
  const [is3DMapActive, setIs3DMapActive] = useState(false);
  // Track which chart types are selected (multi-select)
  const [selectedCharts, setSelectedCharts] = useState<ChartTypeId[]>([]);
  // Track if charts are expanded (stacked) or combined (overlay)
  const [chartsExpanded, setChartsExpanded] = useState(false);
  // Track which metric is being previewed (long-press on chip shows its Y-axis)
  const [previewMetricId, setPreviewMetricId] = useState<ChartTypeId | null>(null);
  // Track if we've initialized the default chart selection
  const [chartsInitialized, setChartsInitialized] = useState(false);
  // Track fullscreen chart mode
  const [isChartFullscreen, setIsChartFullscreen] = useState(false);
  // Track current map style for attribution

  // Section creation mode
  const [sectionCreationMode, setSectionCreationMode] = useState(false);
  const [sectionCreationState, setSectionCreationState] = useState<CreationState | undefined>(
    undefined
  );
  const [sectionCreationError, setSectionCreationError] = useState<SectionCreationError | null>(
    null
  );
  const { createSection, removeSection, sections } = useCustomSections();
  const { disable: disableSection, enable: enableSection } = useDisabledSections();
  // Highlighted section ID for map (when user holds a section row)
  const [highlightedSectionId, setHighlightedSectionId] = useState<string | null>(null);
  // Track whether section scroll should be disabled (during scrubbing)
  const [sectionScrollDisabled, setSectionScrollDisabled] = useState(false);
  // Track press timing and timeout for long-press detection
  // Track section row layouts for drag-to-highlight feature
  const sectionRowLayoutsRef = useRef<Map<string, { y: number; height: number }>>(new Map());
  // Track open swipeable refs to close them when another opens
  const swipeableRefs = useRef<Map<string, Swipeable | null>>(new Map());
  const openSwipeableRef = useRef<string | null>(null);
  const sectionsScrollOffsetRef = useRef(0);
  const sectionsContainerYRef = useRef(0);
  const sectionsContainerRef = useRef<View>(null);
  const isDraggingRef = useRef(false);

  // Get cached date range from sync store (consolidated calculation)
  const cacheDays = useCacheDays();

  // Long press threshold for section highlighting (in ms)
  const LONG_PRESS_THRESHOLD = 200;

  // Track the last highlighted section to detect changes for haptic feedback
  const lastHighlightedIdRef = useRef<string | null>(null);

  // Find section at Y position helper
  const findSectionAtPosition = useCallback((absoluteY: number): string | null => {
    const relativeY = absoluteY - sectionsContainerYRef.current + sectionsScrollOffsetRef.current;
    for (const [sectionId, layout] of sectionRowLayoutsRef.current.entries()) {
      if (relativeY >= layout.y && relativeY < layout.y + layout.height) {
        return sectionId;
      }
    }
    return null;
  }, []);

  // Handle long press on individual section cards
  const handleSectionLongPress = useCallback((sectionId: string) => {
    isDraggingRef.current = true;
    lastHighlightedIdRef.current = sectionId;
    setSectionScrollDisabled(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setHighlightedSectionId(sectionId);
  }, []);

  // Handle touch move on sections container for scrubbing
  const handleSectionsTouchMove = useCallback(
    (event: { nativeEvent: { pageY: number } }) => {
      if (!isDraggingRef.current) return;
      const absoluteY = event.nativeEvent.pageY;
      const sectionAtY = findSectionAtPosition(absoluteY);
      if (sectionAtY && sectionAtY !== lastHighlightedIdRef.current) {
        lastHighlightedIdRef.current = sectionAtY;
        Haptics.selectionAsync();
        setHighlightedSectionId(sectionAtY);
      }
    },
    [findSectionAtPosition]
  );

  // Handle touch end on sections container
  const handleSectionsTouchEnd = useCallback(() => {
    if (isDraggingRef.current) {
      isDraggingRef.current = false;
      lastHighlightedIdRef.current = null;
      setSectionScrollDisabled(false);
      setHighlightedSectionId(null);
    }
  }, []);

  // Close any open swipeable when another opens
  const handleSwipeableOpen = useCallback((sectionId: string) => {
    if (openSwipeableRef.current && openSwipeableRef.current !== sectionId) {
      const previousSwipeable = swipeableRefs.current.get(openSwipeableRef.current);
      previousSwipeable?.close();
    }
    openSwipeableRef.current = sectionId;
  }, []);

  // Handle disable/enable action for auto-detected sections
  const handleToggleDisable = useCallback(
    async (sectionId: string, isCurrentlyDisabled: boolean) => {
      const swipeable = swipeableRefs.current.get(sectionId);
      swipeable?.close();

      if (isCurrentlyDisabled) {
        await enableSection(sectionId);
      } else {
        await disableSection(sectionId);
      }
    },
    [disableSection, enableSection]
  );

  // Handle delete action for custom sections
  const handleDeleteSection = useCallback(
    (sectionId: string) => {
      const swipeable = swipeableRefs.current.get(sectionId);
      swipeable?.close();

      Alert.alert(t('sections.deleteSection'), t('sections.deleteSectionConfirm'), [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: async () => {
            try {
              await removeSection(sectionId);
            } catch (error) {
              console.error('Failed to delete section:', error);
            }
          },
        },
      ]);
    },
    [removeSection, t]
  );

  // Render swipe actions for section cards
  const renderSectionSwipeActions = useCallback(
    (
      sectionId: string,
      isCustom: boolean,
      isDisabled: boolean,
      _progress: Animated.AnimatedInterpolation<number>,
      dragX: Animated.AnimatedInterpolation<number>
    ) => {
      // Animate opacity based on drag distance
      const opacity = dragX.interpolate({
        inputRange: [-80, -40, 0],
        outputRange: [1, 0.8, 0],
        extrapolate: 'clamp',
      });

      if (isCustom) {
        // Delete action for custom sections
        return (
          <Animated.View style={[styles.swipeAction, styles.deleteSwipeAction, { opacity }]}>
            <RectButton
              style={styles.swipeActionButton}
              onPress={() => handleDeleteSection(sectionId)}
            >
              <MaterialCommunityIcons name="delete" size={24} color={colors.textOnDark} />
              <Text style={styles.swipeActionText}>{t('common.delete')}</Text>
            </RectButton>
          </Animated.View>
        );
      }

      // Disable/Enable action for auto-detected sections
      return (
        <Animated.View
          style={[
            styles.swipeAction,
            isDisabled ? styles.enableSwipeAction : styles.disableSwipeAction,
            { opacity },
          ]}
        >
          <RectButton
            style={styles.swipeActionButton}
            onPress={() => handleToggleDisable(sectionId, isDisabled)}
          >
            <MaterialCommunityIcons
              name={isDisabled ? 'eye' : 'eye-off'}
              size={24}
              color={colors.textOnDark}
            />
            <Text style={styles.swipeActionText}>
              {isDisabled ? t('common.show') : t('common.hide')}
            </Text>
          </RectButton>
        </Animated.View>
      );
    },
    [handleDeleteSection, handleToggleDisable, t]
  );

  // Tab state for swipeable tabs
  type TabType = 'charts' | 'routes' | 'sections';
  const [activeTab, setActiveTab] = useState<TabType>('charts');

  // Get matched route for this activity
  const { routeGroup: matchedRoute, representativeActivityId } = useRouteMatch(id);
  const matchedRouteCount = matchedRoute ? 1 : 0;

  // Fetch representative activity streams for route overlay (only when on Routes tab)
  const { data: representativeStreams } = useActivityStreams(
    activeTab === 'routes' && representativeActivityId ? representativeActivityId : ''
  );

  // Convert representative activity latlng to coordinates for route overlay
  const routeOverlayCoordinates = useMemo(() => {
    if (activeTab !== 'routes' || !representativeStreams?.latlng) return null;
    return convertLatLngTuples(representativeStreams.latlng);
  }, [activeTab, representativeStreams]);

  // Get coordinates from streams or polyline (defined early for section overlays)
  const coordinates = useMemo(() => {
    if (streams?.latlng) {
      return convertLatLngTuples(streams.latlng);
    }
    if (activity?.polyline) {
      return decodePolyline(activity.polyline);
    }
    return [];
  }, [streams?.latlng, activity?.polyline]);

  // Get auto-detected sections from engine that include this activity
  const { sections: engineSectionMatches, count: engineSectionCount } = useSectionMatches(id);

  // Filter custom sections that match this activity
  // Include sections where this is the source activity OR where matches include this activity
  // IMPORTANT: Exclude sections already in engineSectionMatches (unified table now contains both)
  const customMatchedSections = useMemo(() => {
    if (!id) return [];
    // Get IDs from engine sections to avoid duplicates
    const engineSectionIds = new Set(engineSectionMatches.map((m) => m.section.id));
    return sections.filter(
      (section) =>
        // Must not already be in engine sections (avoid duplicates)
        !engineSectionIds.has(section.id) &&
        // And must match this activity
        (section.sourceActivityId === id ||
          section.activityIds?.includes(id) ||
          section.matches?.some((match) => match.activityId === id))
    );
  }, [sections, id, engineSectionMatches]);

  // Total section count (auto-detected + custom, deduplicated)
  const totalSectionCount = engineSectionCount + customMatchedSections.length;

  // Computed activity traces for this activity on each section
  // Uses engine's extractSectionTrace for accurate trace extraction
  const [computedActivityTraces, setComputedActivityTraces] = useState<
    Record<string, { latitude: number; longitude: number }[]>
  >({});

  // Create stable section IDs string to avoid infinite loops
  const engineSectionIds = useMemo(
    () =>
      engineSectionMatches
        .map((m) => m.section.id)
        .sort()
        .join(','),
    [engineSectionMatches]
  );
  const customSectionIds = useMemo(
    () =>
      customMatchedSections
        .map((s) => s.id)
        .sort()
        .join(','),
    [customMatchedSections]
  );

  // Compute activity traces using Rust engine's extractSectionTrace
  useEffect(() => {
    if (activeTab !== 'sections' || !id) {
      return;
    }

    // Deduplicate sections by ID (custom sections might appear in both lists)
    const seenIds = new Set<string>();
    const combinedSections = [
      ...engineSectionMatches.map((m) => m.section),
      ...customMatchedSections,
    ].filter((section) => {
      if (seenIds.has(section.id)) return false;
      seenIds.add(section.id);
      return true;
    });
    if (combinedSections.length === 0) {
      setComputedActivityTraces({});
      return;
    }

    const traces: Record<string, { latitude: number; longitude: number }[]> = {};

    for (const section of combinedSections) {
      // Use section polyline directly (already has data from engine)
      const polyline = section.polyline || [];

      if (polyline.length < 2) continue;

      // Convert polyline to JSON for Rust engine (expects latitude/longitude)
      const polylineJson = JSON.stringify(
        polyline.map(
          (p: { lat?: number; lng?: number; latitude?: number; longitude?: number }) => ({
            latitude: p.lat ?? p.latitude ?? 0,
            longitude: p.lng ?? p.longitude ?? 0,
          })
        )
      );

      // Use Rust engine's extractSectionTrace
      const extractedTrace = routeEngine.extractSectionTrace(id, polylineJson);

      if (extractedTrace && extractedTrace.length > 0) {
        // Convert GpsPoint[] to LatLng format
        traces[section.id] = extractedTrace.map((p) => ({
          latitude: p.latitude,
          longitude: p.longitude,
        }));
      }
    }

    setComputedActivityTraces(traces);
    // Use stable string IDs instead of array references to prevent infinite loops
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, id, engineSectionIds, customSectionIds]);

  // Build section overlays when on Sections tab
  const sectionOverlays = useMemo((): SectionOverlay[] | null => {
    if (activeTab !== 'sections') return null;
    if (!engineSectionMatches.length && !customMatchedSections.length) return null;
    if (coordinates.length === 0) return null;

    const overlays: SectionOverlay[] = [];
    const processedIds = new Set<string>();

    // Process engine-detected sections
    for (const match of engineSectionMatches) {
      // Skip if already processed (deduplication)
      if (processedIds.has(match.section.id)) continue;
      processedIds.add(match.section.id);

      // Use section polyline directly (already has data from engine)
      const polylineSource = match.section.polyline || [];

      // Handle both RoutePoint ({lat, lng}) and GpsPoint ({latitude, longitude}) formats
      const sectionPolyline = polylineSource.map(
        (p: { lat?: number; lng?: number; latitude?: number; longitude?: number }) => ({
          latitude: p.lat ?? p.latitude ?? 0,
          longitude: p.lng ?? p.longitude ?? 0,
        })
      );

      // Try to get activity's portion from multiple sources (in order of preference):
      // 1. computedActivityTraces (extracted via engine.extractSectionTrace - most accurate)
      // 2. activityTraces from section data (pre-computed by engine)
      // 3. portion indices (slice from coordinates - least accurate)
      let activityPortion;

      // First try computed traces - these use extractSectionTrace for accuracy
      const computedTrace = computedActivityTraces[match.section.id];
      if (computedTrace && computedTrace.length > 0) {
        activityPortion = computedTrace;
      } else {
        // Try activityTraces from section data
        const activityTrace = match.section.activityTraces?.[id!];
        if (activityTrace && activityTrace.length > 0) {
          // Convert RoutePoint to LatLng format
          activityPortion = activityTrace.map(
            (p: { lat?: number; lng?: number; latitude?: number; longitude?: number }) => ({
              latitude: p.lat ?? p.latitude ?? 0,
              longitude: p.lng ?? p.longitude ?? 0,
            })
          );
        } else if (match.portion?.startIndex != null && match.portion?.endIndex != null) {
          // Fall back to using portion indices
          const start = Math.max(0, match.portion.startIndex);
          const end = Math.min(coordinates.length - 1, match.portion.endIndex);
          if (end > start) {
            activityPortion = coordinates.slice(start, end + 1);
          }
        }
      }

      overlays.push({
        id: match.section.id,
        sectionPolyline,
        activityPortion,
      });
    }

    // Process custom sections
    for (const section of customMatchedSections) {
      // Skip if already processed (deduplication - custom sections may appear in engine results)
      if (processedIds.has(section.id)) continue;
      processedIds.add(section.id);

      const sectionPolyline = section.polyline.map((p) => ({
        latitude: p.lat,
        longitude: p.lng,
      }));

      // Try computed traces first (from extractSectionTrace)
      let activityPortion;
      const computedTrace = computedActivityTraces[section.id];
      if (computedTrace && computedTrace.length > 0) {
        activityPortion = computedTrace;
      } else {
        // Fall back to using indices
        const activityMatch = section.matches?.find((m) => m.activityId === id);
        if (activityMatch?.startIndex != null && activityMatch?.endIndex != null) {
          // Use match indices
          const start = Math.max(0, activityMatch.startIndex);
          const end = Math.min(coordinates.length - 1, activityMatch.endIndex);
          if (end > start) {
            activityPortion = coordinates.slice(start, end + 1);
          }
        } else if (
          section.sourceActivityId === id &&
          section.startIndex != null &&
          section.endIndex != null
        ) {
          // This is the source activity - use the section's original indices
          const start = Math.max(0, section.startIndex);
          const end = Math.min(coordinates.length - 1, section.endIndex);
          if (end > start) {
            activityPortion = coordinates.slice(start, end + 1);
          }
        }
      }

      overlays.push({
        id: section.id,
        sectionPolyline,
        activityPortion,
      });
    }

    return overlays;
  }, [
    activeTab,
    engineSectionMatches,
    customMatchedSections,
    coordinates,
    id,
    computedActivityTraces,
  ]);

  // Helper to get activity portion as RoutePoint[] for MiniTraceView
  // Uses computed traces when available, falls back to portion indices
  const getActivityPortion = useCallback(
    (sectionId: string, portion?: { startIndex?: number; endIndex?: number }) => {
      // First try computed traces
      const computedTrace = computedActivityTraces[sectionId];
      if (computedTrace && computedTrace.length > 0) {
        return computedTrace.map((c) => ({ lat: c.latitude, lng: c.longitude }));
      }
      // Fall back to portion indices
      if (portion?.startIndex == null || portion?.endIndex == null) return undefined;
      const start = Math.max(0, portion.startIndex);
      const end = Math.min(coordinates.length - 1, portion.endIndex);
      if (end <= start || coordinates.length === 0) return undefined;
      return coordinates.slice(start, end + 1).map((c) => ({ lat: c.latitude, lng: c.longitude }));
    },
    [coordinates, computedActivityTraces]
  );

  // Helper to calculate section elapsed time from streams
  const getSectionTime = useCallback(
    (portion?: { startIndex?: number; endIndex?: number }): number | undefined => {
      if (!streams?.time || portion?.startIndex == null || portion?.endIndex == null) {
        return undefined;
      }
      const timeArray = streams.time;
      const start = Math.max(0, portion.startIndex);
      const end = Math.min(timeArray.length - 1, portion.endIndex);
      if (end <= start) return undefined;
      // Time array contains cumulative seconds from activity start
      return timeArray[end] - timeArray[start];
    },
    [streams?.time]
  );

  // Format time in mm:ss or h:mm:ss
  const formatSectionTime = (seconds: number): string => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) {
      return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  // Calculate pace (min/km or min/mi) from time and distance
  const formatSectionPace = (seconds: number, meters: number): string => {
    if (meters <= 0 || seconds <= 0) return '--';
    const distance = isMetric ? meters / 1000 : meters / 1609.344; // km or mi
    const minPer = seconds / 60 / distance;
    const paceMin = Math.floor(minPer);
    const paceSec = Math.round((minPer - paceMin) * 60);
    return `${paceMin}:${paceSec.toString().padStart(2, '0')}${isMetric ? '/km' : '/mi'}`;
  };

  // Collect all activity IDs from matched sections for performance data
  const sectionActivityIds = useMemo(() => {
    const ids = new Set<string>();
    for (const match of engineSectionMatches) {
      for (const actId of match.section.activityIds) {
        ids.add(actId);
      }
    }
    for (const section of customMatchedSections) {
      // Include source activity
      if (section.sourceActivityId) {
        ids.add(section.sourceActivityId);
      }
      // Include matched activities
      for (const m of section.matches ?? []) {
        ids.add(m.activityId);
      }
      // Include activity IDs from the section
      for (const activityId of section.activityIds ?? []) {
        ids.add(activityId);
      }
    }
    return Array.from(ids);
  }, [engineSectionMatches, customMatchedSections]);

  // Fetch and sync time streams to Rust engine for section performance calculations
  const [performanceDataReady, setPerformanceDataReady] = useState(false);
  useEffect(() => {
    if (activeTab !== 'sections' || sectionActivityIds.length === 0) {
      return;
    }

    let cancelled = false;
    const fetchTimeStreams = async () => {
      try {
        const streamsToSync: Array<{ activityId: string; times: number[] }> = [];

        // Fetch in batches of 5 to avoid overwhelming the API
        const batchSize = 5;
        for (let i = 0; i < sectionActivityIds.length && !cancelled; i += batchSize) {
          const batch = sectionActivityIds.slice(i, i + batchSize);
          const results = await Promise.all(
            batch.map(async (activityId) => {
              try {
                const apiStreams = await intervalsApi.getActivityStreams(activityId, ['time']);
                return { activityId, times: apiStreams.time || [] };
              } catch {
                return { activityId, times: [] as number[] };
              }
            })
          );

          for (const result of results) {
            if (result.times.length > 0) {
              streamsToSync.push(result);
            }
          }
        }

        if (!cancelled && streamsToSync.length > 0) {
          // Sync time streams to Rust engine
          routeEngine.setTimeStreams(streamsToSync);
          setPerformanceDataReady(true);
        }
      } catch {
        // Ignore errors
      }
    };

    fetchTimeStreams();
    return () => {
      cancelled = true;
    };
  }, [activeTab, sectionActivityIds]);

  // Get best time for a section from Rust engine (uses synced time streams)
  const getSectionBestTime = useCallback(
    (sectionId: string): number | undefined => {
      if (!performanceDataReady) return undefined;
      try {
        const resultJson = routeEngine.getSectionPerformances(sectionId);
        if (!resultJson) return undefined;
        const result = JSON.parse(resultJson);
        return result?.bestRecord?.bestTime;
      } catch {
        return undefined;
      }
    },
    [performanceDataReady]
  );

  // Format time delta with +/- sign
  const formatTimeDelta = (
    currentTime: number,
    bestTime: number
  ): { text: string; isAhead: boolean } => {
    const delta = currentTime - bestTime;
    const absDelta = Math.abs(delta);
    const m = Math.floor(absDelta / 60);
    const s = Math.floor(absDelta % 60);
    const timeStr = m > 0 ? `${m}:${s.toString().padStart(2, '0')}` : `${s}s`;
    if (delta <= 0) {
      return { text: delta === 0 ? 'PR' : `-${timeStr}`, isAhead: true };
    }
    return { text: `+${timeStr}`, isAhead: false };
  };

  // Tabs configuration
  const tabs = useMemo<SwipeableTab[]>(
    () => [
      {
        key: 'charts',
        label: t('activityDetail.tabs.charts'),
        icon: 'chart-line',
      },
      {
        key: 'routes',
        label: t('activityDetail.tabs.route'),
        icon: 'map-marker-path',
      },
      {
        key: 'sections',
        label: t('activityDetail.tabs.sections'),
        icon: 'road-variant',
        count: totalSectionCount,
      },
    ],
    [t, matchedRouteCount, totalSectionCount]
  );

  // Get available chart types based on stream data
  const availableCharts = useMemo(() => {
    return getAvailableCharts(streams || {});
  }, [streams]);

  // Initialize with single default chart when data loads
  useEffect(() => {
    if (!chartsInitialized && availableCharts.length > 0 && activity) {
      // Get default chart for this activity type
      const defaultChart = DEFAULT_CHART[activity.type];
      const isDefaultAvailable = defaultChart && availableCharts.some((c) => c.id === defaultChart);
      // Use default if available, otherwise first available chart
      const initialChart = isDefaultAvailable ? defaultChart : availableCharts[0].id;
      setSelectedCharts([initialChart]);
      setChartsInitialized(true);
    }
  }, [availableCharts, chartsInitialized, activity]);

  // Toggle a chart type on/off
  const handleChartToggle = useCallback((chartId: string) => {
    setSelectedCharts((prev) => {
      if (prev.includes(chartId as ChartTypeId)) {
        if (prev.length === 1) return prev;
        return prev.filter((cid) => cid !== chartId);
      }
      return [...prev, chartId as ChartTypeId];
    });
  }, []);

  // Handle chart point selection
  const handlePointSelect = useCallback((index: number | null) => {
    setHighlightIndex(index);
  }, []);

  // Handle chart interaction state changes
  const handleInteractionChange = useCallback((isInteracting: boolean) => {
    setChartInteracting(isInteracting);
  }, []);

  // Handle 3D map mode changes
  const handle3DModeChange = useCallback((is3D: boolean) => {
    setIs3DMapActive(is3D);
  }, []);

  // Open fullscreen chart with landscape orientation
  const openChartFullscreen = useCallback(async () => {
    // Lock orientation BEFORE showing modal to avoid iOS orientation conflict
    await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE);
    setIsChartFullscreen(true);
  }, []);

  // Close fullscreen chart and restore portrait orientation
  const closeChartFullscreen = useCallback(async () => {
    // Hide modal BEFORE unlocking orientation to avoid iOS orientation conflict
    setIsChartFullscreen(false);
    await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
  }, []);

  // Handle section creation completion
  const handleSectionCreated = useCallback(
    async (result: SectionCreationResult) => {
      if (!activity) return;

      // Show creating state in overlay
      setSectionCreationState('creating');
      setSectionCreationError(null);

      try {
        // Index-based creation - Rust loads GPS track from SQLite (no coordinate transfer)
        await createSection({
          startIndex: result.startIndex,
          endIndex: result.endIndex,
          sourceActivityId: activity.id,
          sportType: activity.type,
        });

        // Success - exit creation mode (no alert - user will see it in the list)
        setSectionCreationMode(false);
        setSectionCreationState(undefined);
      } catch (error) {
        // Build user-friendly message
        let message = t('routes.sectionCreationFailed');
        let technicalDetails: string | undefined;

        if (error instanceof Error) {
          technicalDetails = error.message;

          // Check for specific error types from Rust engine
          if (error.message.includes('GPS track not found')) {
            message = t('routes.gpsTrackNotSynced');
          } else if (error.message.includes('Invalid indices')) {
            message = t('routes.invalidSectionRange');
          } else if (error.message.startsWith('Payload size exceeded')) {
            const parts = error.message.split('|');
            const reductionMeters = parseInt(parts[3], 10);

            if (reductionMeters > 0) {
              const reductionKm = Math.ceil(reductionMeters / 1000);
              const reductionDisplay =
                reductionKm > 1 ? `${reductionKm} km` : `${reductionMeters} m`;
              message = t('routes.sectionTooLargeWithHint', { reduction: reductionDisplay });
            } else {
              message = t('routes.sectionTooLarge');
            }
          }
        }

        // Show error in overlay instead of alert
        setSectionCreationState('error');
        setSectionCreationError({
          message,
          technicalDetails,
          activityId: activity.id,
          indices: { start: result.startIndex, end: result.endIndex },
        });
      }
    },
    [activity, createSection, t]
  );

  // Handle section creation cancellation
  const handleSectionCreationCancelled = useCallback(() => {
    setSectionCreationMode(false);
    setSectionCreationState(undefined);
    setSectionCreationError(null);
  }, []);

  // Handle dismissing error to retry
  const handleSectionCreationErrorDismiss = useCallback(() => {
    setSectionCreationState(undefined);
    setSectionCreationError(null);
  }, []);

  if (isLoading) {
    return (
      <ScreenSafeAreaView
        testID="activity-detail-screen"
        style={[styles.container, isDark && styles.containerDark]}
      >
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </ScreenSafeAreaView>
    );
  }

  if (error || !activity) {
    return (
      <ScreenSafeAreaView
        testID="activity-detail-screen"
        style={[styles.container, isDark && styles.containerDark]}
      >
        <View style={[styles.floatingHeader, { paddingTop: insets.top }]}>
          <IconButton
            icon="arrow-left"
            iconColor={colors.textOnDark}
            onPress={() => router.back()}
          />
        </View>
        <View style={styles.loadingContainer}>
          <Text style={styles.errorText}>{t('activityDetail.failedToLoad')}</Text>
        </View>
      </ScreenSafeAreaView>
    );
  }

  const activityColor = getActivityColor(activity.type);
  const showPace = isRunningActivity(activity.type);

  return (
    <View
      testID="activity-detail-screen"
      style={[styles.container, isDark && styles.containerDark]}
    >
      {/* Hero Map Section - fixed at top */}
      <View testID="activity-detail-content" style={styles.heroSection}>
        {/* Map - full bleed */}
        <View style={styles.mapContainer}>
          <ActivityMapView
            coordinates={coordinates}
            polyline={activity.polyline}
            activityType={activity.type}
            height={MAP_HEIGHT}
            showStyleToggle={!sectionCreationMode}
            showAttribution={true}
            highlightIndex={highlightIndex}
            enableFullscreen={!sectionCreationMode}
            on3DModeChange={handle3DModeChange}
            creationMode={sectionCreationMode}
            creationState={sectionCreationState}
            creationError={sectionCreationError}
            onSectionCreated={handleSectionCreated}
            onCreationCancelled={handleSectionCreationCancelled}
            onCreationErrorDismiss={handleSectionCreationErrorDismiss}
            routeOverlay={activeTab === 'routes' ? routeOverlayCoordinates : null}
            sectionOverlays={activeTab === 'sections' ? sectionOverlays : null}
            highlightedSectionId={activeTab === 'sections' ? highlightedSectionId : null}
          />
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
            testID="activity-detail-back"
            style={styles.backButton}
            onPress={() => router.back()}
            activeOpacity={0.7}
          >
            <MaterialCommunityIcons name="arrow-left" size={24} color={colors.textOnDark} />
          </TouchableOpacity>
        </View>

        {/* Activity info overlay at bottom */}
        <View style={styles.infoOverlay}>
          <Text style={styles.activityName} numberOfLines={1}>
            {activity.name}
          </Text>

          {/* Date and inline stats */}
          <View style={styles.metaRow}>
            <Text style={styles.activityDate}>{formatDateTime(activity.start_date_local)}</Text>
            <View style={styles.inlineStats}>
              <Text style={styles.inlineStat}>{formatDistance(activity.distance, isMetric)}</Text>
              <Text style={styles.inlineStatDivider}>·</Text>
              <Text style={styles.inlineStat}>{formatDuration(activity.moving_time)}</Text>
              <Text style={styles.inlineStatDivider}>·</Text>
              <Text style={styles.inlineStat}>
                {formatElevation(activity.total_elevation_gain, isMetric)}
              </Text>
            </View>
          </View>
        </View>
      </View>

      {/* Swipeable Tabs: Charts, Routes, Sections */}
      <SwipeableTabs
        tabs={tabs}
        activeTab={activeTab}
        onTabChange={(key) => setActiveTab(key as TabType)}
        isDark={isDark}
        gestureEnabled={!sectionScrollDisabled}
      >
        {/* Tab 1: Charts */}
        <ScrollView
          testID="activity-charts-scrollview"
          style={styles.tabScrollView}
          contentContainerStyle={styles.tabScrollContent}
          showsVerticalScrollIndicator={false}
          scrollEnabled={!chartInteracting}
        >
          {availableCharts.length > 0 && (
            <View style={styles.chartSection}>
              <View style={styles.chartControls}>
                <TouchableOpacity
                  style={[styles.expandButton, isDark && styles.expandButtonDark]}
                  onPress={() => setChartsExpanded(!chartsExpanded)}
                  activeOpacity={0.7}
                  accessibilityLabel="Chart display options"
                  accessibilityRole="button"
                >
                  <MaterialCommunityIcons
                    name="cog"
                    size={16}
                    color={isDark ? colors.textOnDark : colors.textPrimary}
                  />
                </TouchableOpacity>
                <View style={styles.chartSelectorContainer}>
                  <ChartTypeSelector
                    available={availableCharts}
                    selected={selectedCharts}
                    onToggle={handleChartToggle}
                    onPreviewStart={(id) => setPreviewMetricId(id as ChartTypeId)}
                    onPreviewEnd={() => setPreviewMetricId(null)}
                  />
                </View>
                <TouchableOpacity
                  style={[styles.fullscreenButton, isDark && styles.expandButtonDark]}
                  onPress={openChartFullscreen}
                  activeOpacity={0.7}
                  accessibilityLabel="Fullscreen chart"
                  accessibilityRole="button"
                >
                  <MaterialCommunityIcons
                    name="fullscreen"
                    size={16}
                    color={isDark ? colors.textOnDark : colors.textPrimary}
                  />
                </TouchableOpacity>
              </View>

              {/* Charts - consistent height for both views */}
              {streams &&
                selectedCharts.length > 0 &&
                (chartsExpanded ? (
                  // Expanded view - stacked individual charts
                  selectedCharts.map((chartId) => {
                    const config = CHART_CONFIGS[chartId];
                    if (!config) return null;
                    const chartData = config.getStream?.(streams);
                    if (!chartData || chartData.length === 0) return null;

                    return (
                      <View key={chartId} style={[styles.chartCard, isDark && styles.cardDark]}>
                        <CombinedPlot
                          streams={streams}
                          selectedCharts={[chartId]}
                          chartConfigs={CHART_CONFIGS}
                          height={180}
                          onPointSelect={handlePointSelect}
                          onInteractionChange={handleInteractionChange}
                          previewMetricId={previewMetricId}
                        />
                      </View>
                    );
                  })
                ) : (
                  // Combined view - overlay chart
                  <View style={[styles.chartCard, isDark && styles.cardDark]}>
                    <CombinedPlot
                      streams={streams}
                      selectedCharts={selectedCharts}
                      chartConfigs={CHART_CONFIGS}
                      height={180}
                      onPointSelect={handlePointSelect}
                      onInteractionChange={handleInteractionChange}
                      previewMetricId={previewMetricId}
                    />
                  </View>
                ))}

              {/* Compact Stats Row - averages */}
              <View style={[styles.compactStats, isDark && styles.cardDark]}>
                {showPace ? (
                  <CompactStat
                    label={t('activityDetail.avgPace')}
                    value={formatPace(activity.average_speed, isMetric)}
                    isDark={isDark}
                  />
                ) : (
                  <CompactStat
                    label={t('activityDetail.avgSpeed')}
                    value={formatSpeed(activity.average_speed, isMetric)}
                    isDark={isDark}
                  />
                )}
                {(activity.average_heartrate || activity.icu_average_hr) && (
                  <CompactStat
                    label={t('activityDetail.avgHR')}
                    value={formatHeartRate(activity.average_heartrate || activity.icu_average_hr!)}
                    isDark={isDark}
                    color={colors.chartPink}
                  />
                )}
                {(activity.average_watts || activity.icu_average_watts) && (
                  <CompactStat
                    label={t('activityDetail.avgPower')}
                    value={formatPower(activity.average_watts || activity.icu_average_watts!)}
                    isDark={isDark}
                    color={colors.chartPurple}
                  />
                )}
                {activity.average_cadence && (
                  <CompactStat
                    label={t('activity.cadence')}
                    value={`${Math.round(activity.average_cadence)}`}
                    isDark={isDark}
                  />
                )}
              </View>

              {/* HR Zones Chart - show if heart rate data available */}
              {streams?.heartrate && streams.heartrate.length > 0 && (
                <View style={[styles.chartCard, isDark && styles.cardDark]}>
                  <HRZonesChart
                    streams={streams}
                    activityType={activity.type}
                    activity={activity}
                  />
                </View>
              )}
            </View>
          )}

          {/* Insightful Stats - Interactive stats with context and explanations */}
          <InsightfulStats activity={activity} wellness={activityWellness} />

          {/* Device attribution with Garmin branding when applicable */}
          {activity.device_name && (
            <View style={styles.deviceAttributionContainer}>
              <DeviceAttribution deviceName={activity.device_name} />
            </View>
          )}
        </ScrollView>

        {/* Tab 2: Routes */}
        <ScrollView
          style={styles.tabScrollView}
          contentContainerStyle={styles.tabScrollContent}
          showsVerticalScrollIndicator={false}
        >
          {matchedRoute ? (
            <ComponentErrorBoundary componentName="Route Performance">
              <RoutePerformanceSection activityId={activity.id} activityType={activity.type} />
            </ComponentErrorBoundary>
          ) : (
            <View style={styles.noMatchContainer}>
              <MaterialCommunityIcons
                name="map-marker-question"
                size={48}
                color={isDark ? '#555' : '#CCC'}
              />
              <Text style={[styles.noMatchTitle, isDark && styles.textLight]}>
                {t('activityDetail.noRouteMatch')}
              </Text>
              <Text style={[styles.noMatchDescription, isDark && styles.textMuted]}>
                {t('activityDetail.noRouteMatchDescription')}
              </Text>
            </View>
          )}

          {/* Data range footer */}
          <DataRangeFooter days={cacheDays} isDark={isDark} />
        </ScrollView>

        {/* Tab 3: Sections */}
        <View
          ref={sectionsContainerRef}
          style={styles.tabScrollView}
          onLayout={() => {
            sectionsContainerRef.current?.measureInWindow((_x, y) => {
              sectionsContainerYRef.current = y;
            });
          }}
          onTouchMove={handleSectionsTouchMove}
          onTouchEnd={handleSectionsTouchEnd}
          onTouchCancel={handleSectionsTouchEnd}
        >
          <ScrollView
            contentContainerStyle={styles.tabScrollContent}
            showsVerticalScrollIndicator={false}
            scrollEnabled={!sectionScrollDisabled}
            onScroll={(e) => {
              sectionsScrollOffsetRef.current = e.nativeEvent.contentOffset.y;
            }}
            scrollEventThrottle={16}
          >
            {totalSectionCount > 0 ? (
              <View>
                {/* Auto-detected sections from engine */}
                {engineSectionMatches.map((match, index) => {
                  const style = getSectionStyle(index);
                  return (
                    <View
                      key={`engine-${match.section.id}-${performanceDataReady}`}
                      onLayout={(e) => {
                        sectionRowLayoutsRef.current.set(match.section.id, {
                          y: e.nativeEvent.layout.y,
                          height: e.nativeEvent.layout.height,
                        });
                      }}
                    >
                      <Swipeable
                        ref={(ref) => {
                          swipeableRefs.current.set(match.section.id, ref);
                        }}
                        renderRightActions={(progress, dragX) =>
                          renderSectionSwipeActions(match.section.id, false, false, progress, dragX)
                        }
                        onSwipeableOpen={() => handleSwipeableOpen(match.section.id)}
                        overshootRight={false}
                        friction={2}
                        enabled={!sectionScrollDisabled}
                        containerStyle={
                          sectionScrollDisabled ? styles.swipeableDisabled : undefined
                        }
                      >
                        <TouchableOpacity
                          style={[styles.sectionCard, isDark && styles.cardDark]}
                          onPress={() => {
                            // Navigate on tap (long press highlights on map)
                            if (!isDraggingRef.current) {
                              router.push(`/section/${match.section.id}` as Href);
                            }
                          }}
                          onLongPress={() => handleSectionLongPress(match.section.id)}
                          delayLongPress={LONG_PRESS_THRESHOLD}
                          activeOpacity={0.7}
                        >
                          <View style={styles.sectionCardContent}>
                            {/* Number badge matching map marker */}
                            <View style={[styles.sectionNumberBadge, { borderColor: style.color }]}>
                              <Text style={styles.sectionNumberBadgeText}>{index + 1}</Text>
                            </View>
                            {/* Mini trace preview - shows section's canonical polyline */}
                            <View
                              style={[styles.sectionPreview, isDark && styles.sectionPreviewDark]}
                            >
                              <SectionMiniPreview
                                sectionId={match.section.id}
                                color={style.color}
                                size={48}
                                isDark={isDark}
                              />
                            </View>

                            {/* Section info */}
                            <View style={styles.sectionInfo}>
                              <View style={styles.sectionHeader}>
                                <Text
                                  style={[styles.sectionName, isDark && styles.textLight]}
                                  numberOfLines={1}
                                >
                                  {match.section.name || t('routes.autoDetected')}
                                </Text>
                                <View
                                  style={[
                                    match.section.sectionType === 'custom'
                                      ? styles.customBadge
                                      : styles.autoDetectedBadge,
                                    isDark &&
                                      (match.section.sectionType === 'custom'
                                        ? styles.customBadgeDark
                                        : styles.autoDetectedBadgeDark),
                                  ]}
                                >
                                  <Text
                                    style={
                                      match.section.sectionType === 'custom'
                                        ? styles.customBadgeText
                                        : styles.autoDetectedText
                                    }
                                  >
                                    {match.section.sectionType === 'custom'
                                      ? t('routes.custom')
                                      : t('routes.autoDetected')}
                                  </Text>
                                </View>
                              </View>
                              {(() => {
                                const sectionTime = getSectionTime(match.portion);
                                const bestTime = getSectionBestTime(match.section.id);
                                const delta =
                                  sectionTime != null && bestTime != null
                                    ? formatTimeDelta(sectionTime, bestTime)
                                    : null;
                                return (
                                  <>
                                    <Text style={[styles.sectionMeta, isDark && styles.textMuted]}>
                                      {formatDistance(match.distance, isMetric)} ·{' '}
                                      {match.section.visitCount} {t('routes.visits')}
                                    </Text>
                                    {sectionTime != null && (
                                      <View style={styles.sectionTimeRow}>
                                        <Text
                                          style={[styles.sectionTime, isDark && styles.textLight]}
                                        >
                                          {formatSectionTime(sectionTime)} ·{' '}
                                          {formatSectionPace(sectionTime, match.distance)}
                                        </Text>
                                        {delta && (
                                          <Text
                                            style={[
                                              styles.sectionDelta,
                                              delta.isAhead
                                                ? styles.deltaAhead
                                                : styles.deltaBehind,
                                            ]}
                                          >
                                            {delta.text}
                                          </Text>
                                        )}
                                      </View>
                                    )}
                                  </>
                                );
                              })()}
                            </View>
                          </View>
                        </TouchableOpacity>
                      </Swipeable>
                    </View>
                  );
                })}

                {/* Custom sections */}
                {customMatchedSections.map((section, customIndex) => {
                  const sectionIndex = engineSectionMatches.length + customIndex;
                  const style = getSectionStyle(sectionIndex);
                  return (
                    <View
                      key={`custom-${section.id}`}
                      onLayout={(e) => {
                        sectionRowLayoutsRef.current.set(section.id, {
                          y: e.nativeEvent.layout.y,
                          height: e.nativeEvent.layout.height,
                        });
                      }}
                    >
                      <Swipeable
                        ref={(ref) => {
                          swipeableRefs.current.set(section.id, ref);
                        }}
                        renderRightActions={(progress, dragX) =>
                          renderSectionSwipeActions(section.id, true, false, progress, dragX)
                        }
                        onSwipeableOpen={() => handleSwipeableOpen(section.id)}
                        overshootRight={false}
                        friction={2}
                        enabled={!sectionScrollDisabled}
                        containerStyle={
                          sectionScrollDisabled ? styles.swipeableDisabled : undefined
                        }
                      >
                        <TouchableOpacity
                          style={[styles.sectionCard, isDark && styles.cardDark]}
                          onPress={() => {
                            // Navigate on tap (long press highlights on map)
                            if (!isDraggingRef.current) {
                              router.push(`/section/${section.id}` as Href);
                            }
                          }}
                          onLongPress={() => handleSectionLongPress(section.id)}
                          delayLongPress={LONG_PRESS_THRESHOLD}
                          activeOpacity={0.7}
                        >
                          <View style={styles.sectionCardContent}>
                            {/* Number badge matching map marker */}
                            <View style={[styles.sectionNumberBadge, { borderColor: style.color }]}>
                              <Text style={styles.sectionNumberBadgeText}>{sectionIndex + 1}</Text>
                            </View>
                            {/* Mini trace preview - shows section's canonical polyline */}
                            <View
                              style={[styles.sectionPreview, isDark && styles.sectionPreviewDark]}
                            >
                              <SectionMiniPreview
                                sectionId={section.id}
                                polyline={section.polyline}
                                color={style.color}
                                size={48}
                                isDark={isDark}
                              />
                            </View>

                            {/* Section info */}
                            <View style={styles.sectionInfo}>
                              <View style={styles.sectionHeader}>
                                <Text
                                  style={[styles.sectionName, isDark && styles.textLight]}
                                  numberOfLines={1}
                                >
                                  {section.name}
                                </Text>
                                <View
                                  style={[styles.customBadge, isDark && styles.customBadgeDark]}
                                >
                                  <Text style={styles.customBadgeText}>{t('routes.custom')}</Text>
                                </View>
                              </View>
                              {(() => {
                                const activityMatch = section.matches?.find(
                                  (m) => m.activityId === id
                                );
                                // Use match or section's original indices for source activity
                                const portionIndices =
                                  activityMatch ??
                                  (section.sourceActivityId === id ? section : undefined);
                                const sectionTime = getSectionTime(portionIndices);
                                const bestTime = getSectionBestTime(section.id);
                                const delta =
                                  sectionTime != null && bestTime != null
                                    ? formatTimeDelta(sectionTime, bestTime)
                                    : null;
                                // Count visits: matches + activityIds + 1 if this is the source activity
                                const visitCount =
                                  (section.matches?.length ?? 0) +
                                  (section.activityIds?.length ?? 0) +
                                  (section.sourceActivityId === id && !activityMatch ? 1 : 0);
                                return (
                                  <>
                                    <Text style={[styles.sectionMeta, isDark && styles.textMuted]}>
                                      {formatDistance(section.distanceMeters, isMetric)} ·{' '}
                                      {visitCount} {t('routes.visits')}
                                    </Text>
                                    {sectionTime != null && (
                                      <View style={styles.sectionTimeRow}>
                                        <Text
                                          style={[styles.sectionTime, isDark && styles.textLight]}
                                        >
                                          {formatSectionTime(sectionTime)} ·{' '}
                                          {formatSectionPace(sectionTime, section.distanceMeters)}
                                        </Text>
                                        {delta && (
                                          <Text
                                            style={[
                                              styles.sectionDelta,
                                              delta.isAhead
                                                ? styles.deltaAhead
                                                : styles.deltaBehind,
                                            ]}
                                          >
                                            {delta.text}
                                          </Text>
                                        )}
                                      </View>
                                    )}
                                  </>
                                );
                              })()}
                            </View>
                          </View>
                        </TouchableOpacity>
                      </Swipeable>
                    </View>
                  );
                })}
              </View>
            ) : (
              <View style={styles.emptyStateContainer}>
                <MaterialCommunityIcons
                  name="road-variant"
                  size={48}
                  color={isDark ? darkColors.border : colors.divider}
                />
                <Text style={[styles.emptyStateTitle, isDark && styles.textLight]}>
                  {t('activityDetail.noMatchedSections')}
                </Text>
                <Text style={[styles.emptyStateDescription, isDark && styles.textMuted]}>
                  {t('activityDetail.noMatchedSectionsDescription')}
                </Text>
              </View>
            )}

            {/* Create Section Button */}
            {coordinates.length > 0 && !sectionCreationMode && (
              <TouchableOpacity
                style={[styles.createSectionButton, isDark && styles.createSectionButtonDark]}
                onPress={() => setSectionCreationMode(true)}
                activeOpacity={0.7}
              >
                <MaterialCommunityIcons name="plus" size={20} color={colors.textOnPrimary} />
                <Text style={styles.createSectionButtonText}>{t('routes.createSection')}</Text>
              </TouchableOpacity>
            )}

            {/* Data range footer */}
            <DataRangeFooter days={cacheDays} isDark={isDark} />
          </ScrollView>
        </View>
      </SwipeableTabs>

      {/* Fullscreen Chart Modal - Landscape */}
      <Modal
        visible={isChartFullscreen}
        animationType="fade"
        statusBarTranslucent
        supportedOrientations={['landscape-left', 'landscape-right']}
        onRequestClose={closeChartFullscreen}
      >
        <GestureHandlerRootView style={{ flex: 1 }}>
          <StatusBar hidden />
          <View style={[styles.fullscreenContainer, isDark && styles.fullscreenContainerDark]}>
            {/* Close button - positioned with safe area insets for landscape */}
            <TouchableOpacity
              style={[
                styles.fullscreenCloseButton,
                { top: Math.max(insets.top, insets.left, 16) + 8 },
              ]}
              onPress={closeChartFullscreen}
              activeOpacity={0.7}
            >
              <MaterialCommunityIcons
                name="close"
                size={24}
                color={isDark ? colors.textOnDark : colors.textPrimary}
              />
            </TouchableOpacity>

            {/* Chart type selector in fullscreen - centered, no config button needed */}
            <View
              style={[
                styles.fullscreenControls,
                { paddingTop: Math.max(insets.top, insets.left, 16) + 8 },
              ]}
            >
              <ChartTypeSelector
                available={availableCharts}
                selected={selectedCharts}
                onToggle={handleChartToggle}
                onPreviewStart={(id) => setPreviewMetricId(id as ChartTypeId)}
                onPreviewEnd={() => setPreviewMetricId(null)}
              />
            </View>

            {/* Chart area - proper landscape sizing */}
            {streams && selectedCharts.length > 0 && (
              <View style={styles.fullscreenChartWrapper}>
                <CombinedPlot
                  streams={streams}
                  selectedCharts={selectedCharts}
                  chartConfigs={CHART_CONFIGS}
                  height={windowHeight - 100}
                  onPointSelect={handlePointSelect}
                  onInteractionChange={handleInteractionChange}
                  previewMetricId={previewMetricId}
                />
              </View>
            )}
          </View>
        </GestureHandlerRootView>
      </Modal>
    </View>
  );
}

// Compact inline stat
function CompactStat({
  label,
  value,
  isDark,
  color,
}: {
  label: string;
  value: string;
  isDark: boolean;
  color?: string;
}) {
  return (
    <View style={styles.compactStatItem}>
      <Text style={[styles.compactStatValue, isDark && styles.textLight, color && { color }]}>
        {value}
      </Text>
      <Text style={styles.compactStatLabel}>{label}</Text>
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
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: spacing.xl,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorText: {
    ...typography.body,
    color: colors.error,
  },

  // Hero section
  heroSection: {
    height: MAP_HEIGHT,
    position: 'relative',
  },
  mapContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  mapGradient: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 160,
  },

  // Floating header
  floatingHeader: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    zIndex: 10,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },

  // Info overlay at bottom of map
  infoOverlay: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    bottom: spacing.md + spacing.sm,
    zIndex: 5,
  },
  activityName: {
    fontSize: typography.statsValue.fontSize,
    fontWeight: '700',
    color: colors.textOnDark,
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.xs,
  },
  activityDate: {
    fontSize: typography.bodyCompact.fontSize,
    color: 'rgba(255,255,255,0.85)',
  },
  inlineStats: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  inlineStat: {
    fontSize: typography.bodyCompact.fontSize,
    fontWeight: '600',
    color: colors.textOnDark,
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  inlineStatDivider: {
    fontSize: typography.bodyCompact.fontSize,
    color: 'rgba(255,255,255,0.5)',
    marginHorizontal: 6,
  },
  // Chart section
  chartSection: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },
  chartControls: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  chartSelectorContainer: {
    flex: 1,
    marginHorizontal: spacing.xs,
  },
  expandButton: {
    width: 28,
    height: 28,
    borderRadius: layout.borderRadius,
    backgroundColor: opacity.overlay.light,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 6,
  },
  expandButtonDark: {
    backgroundColor: opacity.overlayDark.heavy,
  },
  chartCard: {
    backgroundColor: colors.surface,
    borderRadius: layout.cardPadding,
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.xs,
    paddingBottom: spacing.sm,
    marginBottom: spacing.sm,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: spacing.sm,
    elevation: 2,
  },
  cardDark: {
    backgroundColor: darkColors.surface,
  },
  textLight: {
    color: colors.textOnDark,
  },

  // Compact stats
  compactStats: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    backgroundColor: colors.surface,
    marginBottom: spacing.sm,
    borderRadius: layout.cardPadding,
    paddingVertical: spacing.md,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: spacing.sm,
    elevation: 2,
  },
  compactStatItem: {
    alignItems: 'center',
    flex: 1,
  },
  compactStatValue: {
    fontSize: typography.cardTitle.fontSize,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  compactStatLabel: {
    fontSize: typography.label.fontSize,
    color: colors.textSecondary,
    marginTop: 2,
  },

  // Device attribution container
  deviceAttributionContainer: {
    alignItems: 'center',
    marginTop: spacing.lg,
    paddingVertical: spacing.sm,
  },

  // Fullscreen button
  fullscreenButton: {
    width: 28,
    height: 28,
    borderRadius: layout.borderRadius,
    backgroundColor: opacity.overlay.light,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 'auto',
  },

  // Fullscreen chart modal
  fullscreenContainer: {
    flex: 1,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
  },
  fullscreenContainerDark: {
    backgroundColor: darkColors.surface,
  },
  fullscreenCloseButton: {
    position: 'absolute',
    left: spacing.md,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: opacity.overlay.medium,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
  },
  fullscreenControls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: spacing.xs,
  },
  fullscreenExpandButton: {
    width: 28,
    height: 28,
    borderRadius: layout.borderRadius,
    backgroundColor: opacity.overlay.light,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 6,
  },
  fullscreenChartWrapper: {
    flex: 1,
    justifyContent: 'center',
    paddingBottom: spacing.md,
  },
  // Tab content styles
  tabScrollView: {
    flex: 1,
  },
  tabScrollContent: {
    paddingBottom: spacing.xl + TAB_BAR_SAFE_PADDING,
  },

  // No route match styles
  noMatchContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xl * 2,
    paddingHorizontal: spacing.lg,
  },
  noMatchTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textPrimary,
    marginTop: spacing.md,
    textAlign: 'center',
  },
  noMatchDescription: {
    fontSize: 14,
    color: colors.textSecondary,
    marginTop: spacing.sm,
    textAlign: 'center',
    lineHeight: 20,
  },

  // Section card styles
  sectionCard: {
    backgroundColor: colors.surface,
    borderRadius: layout.cardPadding,
    padding: spacing.md,
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: spacing.sm,
    elevation: 2,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  sectionName: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textPrimary,
    flex: 1,
  },
  sectionMeta: {
    fontSize: 14,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  sectionTimeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
    gap: spacing.sm,
  },
  sectionTime: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  sectionDelta: {
    fontSize: typography.caption.fontSize,
    fontWeight: '600',
  },
  deltaAhead: {
    color: colors.success,
  },
  deltaBehind: {
    color: colors.error,
  },
  sectionCardContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  sectionNumberBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#1A1A1A',
    borderWidth: 2.5,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: spacing.md,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.3,
    shadowRadius: 2,
    elevation: 3,
  },
  sectionNumberBadgeText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
    textAlign: 'center',
  },
  sectionPreview: {
    width: 48,
    height: 48,
    borderRadius: 8,
    backgroundColor: 'rgba(0, 0, 0, 0.03)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  sectionPreviewDark: {
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
  },
  sectionInfo: {
    flex: 1,
  },
  textMuted: {
    color: darkColors.textSecondary,
  },

  // Empty state styles
  emptyStateContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: spacing.xl * 2,
    paddingHorizontal: spacing.lg,
  },
  emptyStateTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.textPrimary,
    marginTop: spacing.md,
    textAlign: 'center',
  },
  emptyStateDescription: {
    fontSize: 14,
    color: colors.textSecondary,
    marginTop: spacing.sm,
    textAlign: 'center',
    lineHeight: 20,
  },

  // Create Section button styles
  createSectionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
    borderRadius: 24,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    marginHorizontal: spacing.md,
    marginTop: spacing.lg,
    marginBottom: spacing.md,
    gap: spacing.xs,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 3,
  },
  createSectionButtonDark: {
    backgroundColor: colors.primary,
  },
  createSectionButtonText: {
    color: colors.textOnPrimary,
    fontSize: 15,
    fontWeight: '600',
  },

  // Badge styles for section types
  autoDetectedBadge: {
    backgroundColor: 'rgba(76, 175, 80, 0.15)',
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
    borderRadius: 4,
  },
  autoDetectedBadgeDark: {
    backgroundColor: 'rgba(76, 175, 80, 0.25)',
  },
  autoDetectedText: {
    fontSize: 10,
    fontWeight: '600',
    color: colors.success,
  },
  customBadge: {
    backgroundColor: 'rgba(156, 39, 176, 0.15)',
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
    borderRadius: 4,
  },
  customBadgeDark: {
    backgroundColor: 'rgba(156, 39, 176, 0.25)',
  },
  customBadgeText: {
    fontSize: 10,
    fontWeight: '600',
    color: colors.chartPurple,
  },
  // Swipe action styles
  swipeAction: {
    width: 80,
    justifyContent: 'center',
    alignItems: 'center',
  },
  swipeActionButton: {
    flex: 1,
    width: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.xs,
  },
  swipeActionText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textOnDark,
  },
  deleteSwipeAction: {
    backgroundColor: colors.error,
  },
  disableSwipeAction: {
    backgroundColor: colors.warning,
  },
  enableSwipeAction: {
    backgroundColor: colors.success,
  },
  swipeableDisabled: {
    pointerEvents: 'box-none' as const,
  },
});

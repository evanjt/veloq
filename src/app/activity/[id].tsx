import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import {
  View,
  ScrollView,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  Pressable,
  Dimensions,
  Modal,
  StatusBar,
  useWindowDimensions,
  Alert,
  Animated,
  Platform,
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
  useActivityIntervals,
  useWellnessForDate,
  useTheme,
  useMetricSystem,
  useCacheDays,
  useGpxExport,
  useSectionOverlays,
  useSectionTimeStreams,
  POWER_ZONE_COLORS,
  HR_ZONE_COLORS,
} from '@/hooks';
import { useDisabledSections } from '@/providers';
import { createSharedStyles } from '@/styles';
import { useCustomSections } from '@/hooks/routes/useCustomSections';
import { useRouteMatch } from '@/hooks/routes/useRouteMatch';
import { useSectionMatches, type SectionMatch } from '@/hooks/routes/useSectionMatches';
import { routeEngine } from 'veloqrs';
import {
  ActivityMapView,
  CombinedPlot,
  type ChartMetricValue,
  ChartTypeSelector,
  HRZonesChart,
  PowerZonesChart,
  IntervalsTable,
  InsightfulStats,
  RoutePerformanceSection,
  MiniTraceView,
} from '@/components';
import { SectionListItem } from '@/components/activity/SectionListItem';
import {
  DataRangeFooter,
  SectionMiniPreview,
  DebugInfoPanel,
  DebugWarningBanner,
} from '@/components/routes';
import { useDebugStore } from '@/providers';
import { useFFITimer } from '@/hooks/debug/useFFITimer';
import { SwipeableTabs, type SwipeableTab } from '@/components/ui';
import type {
  SectionCreationResult,
  SectionCreationError,
} from '@/components/maps/ActivityMapView';
import type { CreationState } from '@/components/maps/SectionCreationOverlay';
import {
  formatDistance,
  formatDuration,
  formatDurationHuman,
  formatElevation,
  formatPace,
  formatDateTime,
  getActivityColor,
  isRunningActivity,
  isCyclingActivity,
  decodePolyline,
  convertLatLngTuples,
  getAvailableCharts,
  CHART_CONFIGS,
  getSectionStyle,
} from '@/lib';
import { colors, darkColors, spacing, typography, layout, opacity } from '@/theme';
import { CHART_CONFIG } from '@/constants';
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
  const debugEnabled = useDebugStore((s) => s.enabled);
  const { getPageMetrics } = useFFITimer();
  const shared = createSharedStyles(isDark);
  const insets = useSafeAreaInsets();
  // Use dynamic dimensions for fullscreen chart (updates after rotation)
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();

  const { data: activity, isLoading, error } = useActivity(id || '');
  const { data: streams } = useActivityStreams(id || '');
  const { exportGpx, exporting: gpxExporting } = useGpxExport();

  // Get the activity date for wellness lookup
  const activityDate = activity?.start_date_local?.split('T')[0];
  const { data: activityWellness } = useWellnessForDate(activityDate);

  // Tab state for swipeable tabs (defined early for conditional hook)
  type TabType = 'charts' | 'routes' | 'sections';
  const [activeTab, setActiveTab] = useState<TabType>('charts');

  // Fetch intervals data (used for both charts tab overlay and intervals tab)
  const { data: intervalsData } = useActivityIntervals(id || '');

  // Track the selected point index from charts for map highlight
  const [highlightIndex, setHighlightIndex] = useState<number | null>(null);
  // Track whether any chart is being interacted with to disable ScrollView
  const [chartInteracting, setChartInteracting] = useState(false);
  // Track whether 3D map mode is active to disable ScrollView
  const [is3DMapActive, setIs3DMapActive] = useState(false);
  // Track which chart types are selected (multi-select)
  const [selectedCharts, setSelectedCharts] = useState<ChartTypeId[]>([]);
  // Track which metric is being previewed (long-press on chip shows its Y-axis)
  const [previewMetricId, setPreviewMetricId] = useState<ChartTypeId | null>(null);
  // Track if we've initialized the default chart selection
  const [chartsInitialized, setChartsInitialized] = useState(false);
  // Track fullscreen chart mode
  const [isChartFullscreen, setIsChartFullscreen] = useState(false);
  // Track chart x-axis mode (distance vs time)
  const [xAxisMode, setXAxisMode] = useState<'distance' | 'time'>('distance');
  // Chart metric values (avg or scrub) for display in selector chips
  const [chartMetrics, setChartMetrics] = useState<ChartMetricValue[]>([]);
  // Intervals collapsible section
  const [intervalsExpanded, setIntervalsExpanded] = useState(false);

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
  const disabledSectionIds = useDisabledSections((state) => state.disabledIds);
  // Highlighted section ID for map (when user long-presses a section row)
  const [highlightedSectionId, setHighlightedSectionId] = useState<string | null>(null);
  // Track open swipeable refs to close them when another opens
  const swipeableRefs = useRef<Map<string, Swipeable | null>>(new Map());
  const openSwipeableRef = useRef<string | null>(null);

  // Get cached date range from sync store (consolidated calculation)
  const cacheDays = useCacheDays();

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

  // Handle section long press to highlight on map
  const handleSectionLongPress = useCallback((sectionId: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setHighlightedSectionId(sectionId);
  }, []);

  // Handle touch end to clear highlight
  const handleSectionsTouchEnd = useCallback(() => {
    setHighlightedSectionId(null);
  }, []);

  // Handle section press navigation
  const handleSectionPress = useCallback((sectionId: string) => {
    router.push(`/section/${sectionId}` as Href);
  }, []);

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
        (section.sourceActivityId === id || section.activityIds?.includes(id))
    );
  }, [sections, id, engineSectionMatches]);

  // Total section count (auto-detected + custom, deduplicated)
  const totalSectionCount = engineSectionCount + customMatchedSections.length;

  // Unified section list for rendering — single array so scrubbing/highlighting
  // works seamlessly across engine and custom sections
  type UnifiedSectionItem =
    | { type: 'engine'; match: SectionMatch; index: number }
    | { type: 'custom'; section: (typeof customMatchedSections)[0]; index: number };

  const unifiedSections = useMemo((): UnifiedSectionItem[] => {
    const items: UnifiedSectionItem[] = [];
    engineSectionMatches.forEach((match, i) => {
      items.push({ type: 'engine', match, index: i });
    });
    customMatchedSections.forEach((section, i) => {
      items.push({
        type: 'custom',
        section,
        index: engineSectionMatches.length + i,
      });
    });
    return items;
  }, [engineSectionMatches, customMatchedSections]);

  // Section overlay computation (traces + map overlays)
  const { sectionOverlays, getActivityPortion } = useSectionOverlays(
    activeTab,
    id,
    engineSectionMatches,
    customMatchedSections,
    coordinates
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

  const formatSectionPace = useCallback(
    (seconds: number, meters: number): string => {
      if (meters <= 0 || seconds <= 0) return '--';
      return formatPace(meters / seconds, isMetric);
    },
    [isMetric]
  );

  // Time stream syncing + performance data for section best times
  const { getSectionBestTime } = useSectionTimeStreams(
    activeTab,
    engineSectionMatches,
    customMatchedSections
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
      return {
        text: delta === 0 ? t('routes.pr') : `-${timeStr}`,
        isAhead: true,
      };
    }
    return { text: `+${timeStr}`, isAhead: false };
  };

  // FlatList key extractor
  const keyExtractor = useCallback((item: UnifiedSectionItem) => {
    return item.type === 'engine' ? item.match.section.id : item.section.id;
  }, []);

  // FlatList render item
  const renderSectionItem = useCallback(
    ({ item }: { item: UnifiedSectionItem }) => {
      const style = getSectionStyle(item.index);
      const sectionId = item.type === 'engine' ? item.match.section.id : item.section.id;
      const isCustom = item.type === 'custom';
      const sectionType = item.type === 'engine' ? item.match.section.sectionType : 'custom';
      const sectionName =
        item.type === 'engine'
          ? item.match.section.name || t('routes.autoDetected')
          : item.section.name || t('routes.custom');

      let sectionTime: number | undefined;
      let distance: number;
      let visitCount: number;

      if (item.type === 'engine') {
        sectionTime = undefined;
        distance = item.match.distance;
        visitCount = item.match.section.visitCount;
      } else {
        const portionRecord = item.section.activityPortions?.find((p: any) => p.activityId === id);
        const portionIndices =
          portionRecord ?? (item.section.sourceActivityId === id ? item.section : undefined);
        sectionTime = getSectionTime(portionIndices);
        distance = item.section.distanceMeters;
        visitCount = item.section.activityIds?.length ?? item.section.visitCount;
      }

      const bestTime = getSectionBestTime(sectionId);
      const delta =
        sectionTime != null && bestTime != null ? formatTimeDelta(sectionTime, bestTime) : null;

      const isDisabled = disabledSectionIds.has(sectionId);

      return (
        <SectionListItem
          item={item}
          sectionId={sectionId}
          isCustom={isCustom}
          sectionType={sectionType}
          sectionName={sectionName}
          sectionTime={sectionTime}
          distance={distance}
          visitCount={visitCount}
          bestTime={bestTime}
          delta={delta}
          style={style}
          index={item.index}
          isHighlighted={highlightedSectionId === sectionId}
          isDark={isDark}
          isMetric={isMetric}
          onLongPress={handleSectionLongPress}
          onPress={handleSectionPress}
          onSwipeableOpen={handleSwipeableOpen}
          renderRightActions={(progress, dragX) =>
            renderSectionSwipeActions(sectionId, isCustom, isDisabled, progress, dragX)
          }
          swipeableRefs={swipeableRefs}
          formatSectionTime={formatDuration}
          formatSectionPace={formatSectionPace}
        />
      );
    },
    [
      highlightedSectionId,
      isDark,
      isMetric,
      disabledSectionIds,
      id,
      t,
      handleSectionLongPress,
      handleSectionPress,
      handleSwipeableOpen,
      renderSectionSwipeActions,
      getSectionTime,
      getSectionBestTime,
      formatTimeDelta,
      formatDuration,
      formatSectionPace,
      swipeableRefs,
    ]
  );

  // Render empty state for section list
  const renderSectionsListEmpty = useCallback(() => {
    return (
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
    );
  }, [isDark, t]);

  // Render footer for section list
  const renderSectionsListFooter = useCallback(() => {
    return (
      <>
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
      </>
    );
  }, [coordinates.length, sectionCreationMode, isDark, cacheDays, t]);

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

  // Determine effective x-axis mode and whether toggle is available
  const hasDistance = (streams?.distance?.length ?? 0) > 0;
  const hasTime = (streams?.time?.length ?? 0) > 0;
  const effectiveXAxisMode = !hasDistance ? 'time' : xAxisMode;
  const canToggleXAxis = hasDistance && hasTime;

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

  // Toggle x-axis between distance and time
  const handleXAxisToggle = useCallback(() => {
    setXAxisMode((m) => (m === 'distance' ? 'time' : 'distance'));
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

  // Handle chart metrics updates (avg values or scrub position values)
  const handleMetricsChange = useCallback((metrics: ChartMetricValue[]) => {
    setChartMetrics(metrics);
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
              message = t('routes.sectionTooLargeWithHint', {
                reduction: reductionDisplay,
              });
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

  // Zone summary for intervals bar (colored chips showing all interval types)
  const intervalZoneSummary = useMemo(() => {
    if (!intervalsData?.icu_intervals || !activity) return [];
    const isCycling = isCyclingActivity(activity.type);
    const zoneColors = isCycling ? POWER_ZONE_COLORS : HR_ZONE_COLORS;

    // Group all intervals by type+zone, maintain order of first appearance
    type ChipInfo = { label: string; color: string; count: number; totalTime: number };
    const chips: ChipInfo[] = [];
    const chipMap = new Map<string, number>(); // key -> index in chips array

    for (const interval of intervalsData.icu_intervals) {
      const isWork = interval.type === 'WORK';
      const isRecovery = interval.type === 'RECOVERY' || interval.type === 'REST';
      const isWarmup = interval.type === 'WARMUP';
      const isCooldown = interval.type === 'COOLDOWN';

      let label: string;
      let color: string;
      let key: string;

      if (isWork && interval.zone != null && interval.zone >= 1) {
        key = `Z${interval.zone}`;
        label = `Z${interval.zone}`;
        color = zoneColors[Math.min(interval.zone - 1, zoneColors.length - 1)];
      } else if (isWork) {
        key = 'WORK';
        label = 'W';
        color = colors.primary;
      } else if (isRecovery) {
        key = 'REC';
        label = 'Rec';
        color = '#4CAF50';
      } else if (isWarmup) {
        key = 'WU';
        label = 'WU';
        color = '#22C55E';
      } else if (isCooldown) {
        key = 'CD';
        label = 'CD';
        color = '#8B5CF6';
      } else {
        key = interval.type;
        label = interval.type.slice(0, 3);
        color = '#808080';
      }

      if (chipMap.has(key)) {
        const idx = chipMap.get(key)!;
        chips[idx].count++;
        chips[idx].totalTime += interval.moving_time;
      } else {
        chipMap.set(key, chips.length);
        chips.push({ label, color, count: 1, totalTime: interval.moving_time });
      }
    }
    return chips;
  }, [intervalsData, activity]);

  // Summary text for collapsed intervals section
  const intervalsWorkSummary = useMemo(() => {
    if (!intervalsData?.icu_intervals) return '';
    const total = intervalsData.icu_intervals.length;
    const totalTime = intervalsData.icu_intervals.reduce((s, i) => s + i.moving_time, 0);
    return `${total} × ${formatDurationHuman(totalTime)}`;
  }, [intervalsData]);

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
          <ComponentErrorBoundary componentName="Activity Map">
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
          </ComponentErrorBoundary>
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
            testID="activity-detail-back"
            style={styles.backButton}
            onPress={() => router.back()}
            activeOpacity={0.7}
          >
            <MaterialCommunityIcons name="arrow-left" size={24} color={colors.textOnDark} />
          </TouchableOpacity>
          <View style={{ flex: 1 }} />
        </View>

        {/* Activity info overlay at bottom */}
        <View style={styles.infoOverlay}>
          <Pressable
            onLongPress={
              debugEnabled
                ? () => {
                    const doClone = (n: number) => {
                      const created = routeEngine.debugCloneActivity(id, n);
                      Alert.alert('Done', `Created ${created} clones`);
                    };
                    Alert.alert(
                      'Clone for Testing',
                      `Clone "${activity.name}" to stress test sections and routes.`,
                      [
                        { text: 'Cancel', style: 'cancel' },
                        { text: '10 clones', onPress: () => doClone(10) },
                        {
                          text: 'More...',
                          onPress: () => {
                            Alert.alert('Clone Amount', 'Choose number of clones:', [
                              { text: 'Cancel', style: 'cancel' },
                              { text: '50 clones', onPress: () => doClone(50) },
                              { text: '100 clones', onPress: () => doClone(100) },
                            ]);
                          },
                        },
                      ]
                    );
                  }
                : undefined
            }
          >
            <Text style={styles.activityName} numberOfLines={1}>
              {activity.name}
            </Text>
          </Pressable>

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

          {/* Location */}
          {(activity.locality || activity.country) && (
            <Text style={styles.locationText}>
              {[activity.locality, activity.country].filter(Boolean).join(', ')}
            </Text>
          )}
        </View>
      </View>

      {/* Activity description */}
      {activity.description ? (
        <View style={[styles.descriptionContainer, isDark && styles.descriptionContainerDark]}>
          <Text
            numberOfLines={3}
            style={[styles.descriptionText, isDark && styles.descriptionTextDark]}
          >
            {activity.description}
          </Text>
        </View>
      ) : null}

      {/* Swipeable Tabs: Charts, Routes, Sections */}
      <SwipeableTabs
        tabs={tabs}
        activeTab={activeTab}
        onTabChange={(key) => setActiveTab(key as TabType)}
        isDark={isDark}
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
                <View style={styles.chartSelectorContainer}>
                  <ChartTypeSelector
                    available={availableCharts}
                    selected={selectedCharts}
                    onToggle={handleChartToggle}
                    onPreviewStart={(id) => setPreviewMetricId(id as ChartTypeId)}
                    onPreviewEnd={() => setPreviewMetricId(null)}
                    metricValues={chartMetrics}
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

              {/* Chart */}
              {streams && selectedCharts.length > 0 && (
                <View style={[styles.chartCard, isDark && styles.cardDark]}>
                  <CombinedPlot
                    key={selectedCharts.join(',')}
                    streams={streams}
                    selectedCharts={selectedCharts}
                    chartConfigs={CHART_CONFIGS}
                    height={180}
                    onPointSelect={handlePointSelect}
                    onInteractionChange={handleInteractionChange}
                    previewMetricId={previewMetricId}
                    xAxisMode={effectiveXAxisMode}
                    onXAxisModeToggle={handleXAxisToggle}
                    canToggleXAxis={canToggleXAxis}
                    intervals={intervalsExpanded ? intervalsData?.icu_intervals : undefined}
                    activityType={activity.type}
                    onMetricsChange={handleMetricsChange}
                  />

                  {/* Intervals zone bar — thin expandable strip directly under chart */}
                  {intervalsData?.icu_intervals && intervalsData.icu_intervals.length > 0 && (
                    <>
                      <TouchableOpacity
                        style={[styles.intervalsBar, isDark && styles.intervalsBarDark]}
                        onPress={() => setIntervalsExpanded((v) => !v)}
                        activeOpacity={0.7}
                      >
                        <View style={styles.intervalsBarLeft}>
                          {intervalZoneSummary.map((z, i) => (
                            <View
                              key={i}
                              style={[styles.zoneChip, { backgroundColor: z.color + '25' }]}
                            >
                              <View style={[styles.zoneDot, { backgroundColor: z.color }]} />
                              <Text style={[styles.zoneChipText, { color: z.color }]}>
                                {z.label} ×{z.count}
                              </Text>
                            </View>
                          ))}
                          {intervalsWorkSummary ? (
                            <Text style={[styles.intervalsSummaryText, isDark && styles.textMuted]}>
                              {intervalsWorkSummary}
                            </Text>
                          ) : null}
                        </View>
                        <MaterialCommunityIcons
                          name={intervalsExpanded ? 'chevron-up' : 'chevron-down'}
                          size={18}
                          color={isDark ? darkColors.textSecondary : colors.textSecondary}
                        />
                      </TouchableOpacity>
                      {intervalsExpanded && (
                        <IntervalsTable
                          intervals={intervalsData.icu_intervals}
                          activityType={activity.type}
                          isMetric={isMetric}
                          isDark={isDark}
                        />
                      )}
                    </>
                  )}
                </View>
              )}

              {/* HR Zones Chart - show if heart rate data available */}
              {streams?.heartrate && streams.heartrate.length > 0 && (
                <View style={[styles.chartCard, isDark && styles.cardDark]}>
                  <ComponentErrorBoundary componentName="HR Zones Chart">
                    <HRZonesChart
                      streams={streams}
                      activityType={activity.type}
                      activity={activity}
                    />
                  </ComponentErrorBoundary>
                </View>
              )}

              {/* Power Zones Chart - show if power zone data available */}
              {activity.icu_zone_times && activity.icu_zone_times.length > 0 && (
                <View style={[styles.chartCard, isDark && styles.cardDark]}>
                  <ComponentErrorBoundary componentName="Power Zones Chart">
                    <PowerZonesChart activity={activity} />
                  </ComponentErrorBoundary>
                </View>
              )}
            </View>
          )}

          {/* Insightful Stats - Interactive stats with context and explanations */}
          <ComponentErrorBoundary componentName="Activity Stats">
            <InsightfulStats activity={activity} wellness={activityWellness} />
          </ComponentErrorBoundary>

          {/* Export GPX button */}
          {coordinates.length > 0 && (
            <TouchableOpacity
              testID="activity-export-gpx"
              style={[styles.exportGpxButton, isDark && styles.exportGpxButtonDark]}
              onPress={() =>
                exportGpx({
                  name: activity?.name || 'Activity',
                  points: coordinates,
                  time: activity?.start_date_local,
                  sport: activity?.type,
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

          {/* Device attribution with Garmin branding when applicable */}
          {activity.device_name && (
            <View style={styles.deviceAttributionContainer}>
              <DeviceAttribution deviceName={activity.device_name} />
            </View>
          )}

          {debugEnabled &&
            activity &&
            (() => {
              const pageMetrics = getPageMetrics();
              const ffiEntries =
                pageMetrics.length > 0
                  ? pageMetrics.reduce<
                      Record<string, { calls: number; totalMs: number; maxMs: number }>
                    >((acc, m) => {
                      if (!acc[m.name]) acc[m.name] = { calls: 0, totalMs: 0, maxMs: 0 };
                      acc[m.name].calls++;
                      acc[m.name].totalMs += m.durationMs;
                      acc[m.name].maxMs = Math.max(acc[m.name].maxMs, m.durationMs);
                      return acc;
                    }, {})
                  : {};
              const warnings: Array<{
                level: 'warn' | 'error';
                message: string;
              }> = [];
              if (streams?.latlng && streams.latlng.length > 2000) {
                warnings.push({
                  level: 'warn',
                  message: `Polyline points: ${streams.latlng.length}`,
                });
              }
              for (const [name, m] of Object.entries(ffiEntries)) {
                if (m.maxMs > 200) {
                  warnings.push({
                    level: 'error',
                    message: `${name}: ${m.maxMs.toFixed(0)}ms (max)`,
                  });
                }
              }
              return (
                <>
                  {warnings.length > 0 && <DebugWarningBanner warnings={warnings} />}
                  <DebugInfoPanel
                    isDark={isDark}
                    entries={[
                      { label: 'Activity ID', value: id?.slice(0, 24) ?? '-' },
                      { label: 'Sport', value: activity.type ?? '-' },
                      {
                        label: 'GPS Points',
                        value: streams?.latlng ? String(streams.latlng.length) : '-',
                      },
                      {
                        label: 'HR Samples',
                        value: streams?.heartrate ? String(streams.heartrate.length) : '-',
                      },
                      {
                        label: 'Power Samples',
                        value: streams?.watts ? String(streams.watts.length) : '-',
                      },
                      {
                        label: 'Cadence Samples',
                        value: streams?.cadence ? String(streams.cadence.length) : '-',
                      },
                      {
                        label: 'Sections Matched',
                        value: String(engineSectionCount),
                      },
                      {
                        label: 'Custom Sections',
                        value: String(customMatchedSections.length),
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
        <View style={styles.tabScrollView} onTouchEnd={handleSectionsTouchEnd}>
          <FlatList
            data={unifiedSections}
            keyExtractor={keyExtractor}
            renderItem={renderSectionItem}
            ListEmptyComponent={renderSectionsListEmpty}
            ListFooterComponent={renderSectionsListFooter}
            contentContainerStyle={
              unifiedSections.length === 0 ? styles.tabScrollContentEmpty : styles.tabScrollContent
            }
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            // Performance optimizations
            initialNumToRender={8}
            maxToRenderPerBatch={10}
            windowSize={5}
            removeClippedSubviews={Platform.OS === 'ios'}
          />
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

            {/* Chart type selector in fullscreen - centered */}
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
                metricValues={chartMetrics}
              />
            </View>

            {/* Chart area - proper landscape sizing */}
            {streams && selectedCharts.length > 0 && (
              <View style={styles.fullscreenChartWrapper}>
                <CombinedPlot
                  key={selectedCharts.join(',')}
                  streams={streams}
                  selectedCharts={selectedCharts}
                  chartConfigs={CHART_CONFIGS}
                  height={windowHeight - 100}
                  onPointSelect={handlePointSelect}
                  onInteractionChange={handleInteractionChange}
                  previewMetricId={previewMetricId}
                  xAxisMode={effectiveXAxisMode}
                  onXAxisModeToggle={handleXAxisToggle}
                  canToggleXAxis={canToggleXAxis}
                  intervals={intervalsExpanded ? intervalsData?.icu_intervals : undefined}
                  activityType={activity.type}
                  onMetricsChange={handleMetricsChange}
                />
              </View>
            )}
          </View>
        </GestureHandlerRootView>
      </Modal>
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
  locationText: {
    fontSize: typography.label.fontSize,
    color: 'rgba(255,255,255,0.7)',
    marginTop: 2,
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },

  // Description
  descriptionContainer: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  descriptionContainerDark: {
    backgroundColor: darkColors.surface,
    borderBottomColor: darkColors.border,
  },
  descriptionText: {
    fontSize: typography.bodyCompact.fontSize,
    color: colors.textSecondary,
    lineHeight: 20,
  },
  descriptionTextDark: {
    color: darkColors.textSecondary,
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

  // Intervals zone bar
  intervalsBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.divider,
  },
  intervalsBarDark: {
    borderTopColor: darkColors.border,
  },
  intervalsBarLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    flex: 1,
    gap: 4,
  },
  zoneChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 4,
    gap: 3,
  },
  zoneDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  zoneChipText: {
    fontSize: 10,
    fontWeight: '600',
  },
  intervalsSummaryText: {
    fontSize: typography.pillLabel.fontSize,
    color: colors.textSecondary,
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
  tabScrollContentEmpty: {
    flexGrow: 1,
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

  // Section list content wrapper
  // Section card styles - matches SectionRow for consistency
  sectionCard: {
    backgroundColor: colors.surface,
    borderRadius: 10,
    padding: spacing.sm,
    marginHorizontal: spacing.md,
    marginBottom: spacing.xs,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 2,
    elevation: 1,
  },
  sectionCardHighlighted: {
    backgroundColor: '#FFAB00' + '15', // Golden highlight with low opacity
    borderWidth: 2,
    borderColor: '#FFAB00',
    shadowColor: '#FFAB00',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 4,
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
  sectionPreviewBox: {
    width: 56,
    height: 40,
    borderRadius: 6,
    overflow: 'hidden',
    marginRight: spacing.sm,
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

  // Export GPX button styles
  exportGpxButton: {
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
  exportGpxButtonDark: {
    backgroundColor: colors.primary,
  },
  exportGpxButtonText: {
    color: colors.textOnPrimary,
    fontSize: 15,
    fontWeight: '600',
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
});

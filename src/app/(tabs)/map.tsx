import { useTabFirstFrame } from '@/shared/debug/tabSwitchTiming';
import React, { useState, useMemo, useEffect, useRef, useDeferredValue, useCallback } from 'react';
import {
  View,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  type LayoutChangeEvent,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useLocalSearchParams } from 'expo-router';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { FadeIn, FadeOut, LinearTransition } from 'react-native-reanimated';
import {
  AttributionOverlay,
  type AttributionOverlayRef,
  FILTER_CHIP,
  DEFAULT_MAP_PERIOD,
  filterSheetExpandedAfterDrag,
  getPeriodStart,
  MapEmptyState,
  MapNameSearch,
  type MapPeriod,
  PERIOD_OPTIONS,
  RegionalMapView,
  SyncProgressBanner,
  useEngineMapActivities,
  useHeatmapPreference,
} from '@/features/maps';
import {
  ComponentErrorBoundary,
  ErrorState,
  useBottomClearance,
  Shimmer,
  Button,
  pressable,
  pressRipple,
} from '@/shared/ui';
import { logScreenRender } from '@/shared/debug/renderTimer';
import { useActivityBoundsCache } from '@/features/activity';
import { useRouteSettings } from '@/features/routes';
import { useTheme, useMetricSystem } from '@/shared/app';
import { MapDistanceBand } from 'veloqrs';
import {
  colors,
  colorWithOpacity,
  controlHeight,
  darkColors,
  ink,
  layout,
  slopToMinTapTarget,
  spacing,
  typography,
} from '@/theme';
import { ToggleButton } from '@/shared/ui/Button';
import { SportChipRow } from '@/shared/ui/SportChipRow';
import { ACTIVITY_CATEGORIES, groupTypesByCategory } from '@/shared/activity/sportCategories';
import { withScreenBoundary } from '@/shared/ui/withScreenBoundary';
import { formatMonthYear } from '@/shared/format/format';
import { tapTo } from '@/shared/app/navigation';

// Stable date references - creating new Date() in the component body triggers
// useEngineMapActivities useMemo on every render, causing cascading re-renders
// that make Android MapLibre snap the camera back.
const ALL_TIME_END = new Date('2099-12-31');

const MAX_SEARCH_RESULTS = 5;

// A vertical drag this far claims the gesture; a horizontal one this far leaves
// it to the chip rows, which scroll sideways.
const SHEET_DRAG_ACTIVATION = 12;
const SHEET_FADE_MS = 150;

// Distance thresholds in meters (metric) and labels for both systems
function getDistanceOptions(
  isMetric: boolean,
  anyLabel: string
): { key: MapDistanceBand; label: string }[] {
  return isMetric
    ? [
        { key: MapDistanceBand.All, label: anyLabel },
        { key: MapDistanceBand.XShort, label: '<5km' },
        { key: MapDistanceBand.Short, label: '5–10km' },
        { key: MapDistanceBand.Medium, label: '10–50km' },
        { key: MapDistanceBand.Long, label: '50km+' },
      ]
    : [
        { key: MapDistanceBand.All, label: anyLabel },
        { key: MapDistanceBand.XShort, label: '<3mi' },
        { key: MapDistanceBand.Short, label: '3–6mi' },
        { key: MapDistanceBand.Medium, label: '6–30mi' },
        { key: MapDistanceBand.Long, label: '30mi+' },
      ];
}

/** One row of single-choice filter chips, the chosen one filled. */
function FilterChipRow<K extends string | number>({
  options,
  selected,
  onSelect,
}: {
  options: { key: K; label: string }[];
  selected: K;
  onSelect: (key: K) => void;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.chipRow}
    >
      {options.map(({ key, label }) => (
        <ToggleButton
          key={key}
          label={label}
          selected={selected === key}
          onPress={() => onSelect(key)}
          fill={FILTER_CHIP.fill}
          ink={FILTER_CHIP.ink}
        />
      ))}
    </ScrollView>
  );
}

function MapScreenContent() {
  useTabFirstFrame('/map');
  // Performance timing
  const perfEndRef = useRef<(() => void) | null>(null);
  perfEndRef.current = logScreenRender('MapScreen');
  useEffect(() => {
    perfEndRef.current?.();
  });

  const { t } = useTranslation();
  const { isDark } = useTheme();
  const bottomClearance = useBottomClearance();
  const isMetric = useMetricSystem();

  // The map reports its credit as the style and viewport change. It goes to the
  // overlay through its ref, so a new credit does not re-render the map.
  const attributionRef = useRef<AttributionOverlayRef>(null);
  const [isDarkBasemap, setIsDarkBasemap] = useState(false);
  const handleAttributionChange = useCallback((text: string, isDark: boolean) => {
    attributionRef.current?.setAttribution(text);
    setIsDarkBasemap(isDark);
  }, []);
  // The sheet grows with the filters it shows, so the credit sits on its measured edge.
  const [sheetHeight, setSheetHeight] = useState(0);
  const handleSheetLayout = useCallback((event: LayoutChangeEvent) => {
    setSheetHeight(event.nativeEvent.layout.height);
  }, []);

  // Get sync state from engine cache
  const { isReady, cacheStats } = useActivityBoundsCache();
  const oldestSyncedDate = cacheStats.oldestDate;
  const newestSyncedDate = cacheStats.newestDate;

  // Filter state
  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(new Set());
  const [period, setPeriod] = useState<MapPeriod>(DEFAULT_MAP_PERIOD);
  const [distanceFilter, setDistanceFilter] = useState<MapDistanceBand>(MapDistanceBand.All);
  const [nameNeedle, setNameNeedle] = useState('');
  // The field shows each keystroke at once. The map reads the needle in a render React
  // defers behind it, and a keystroke that lands first replaces that render.
  const searchedNeedle = useDeferredValue(nameNeedle);
  const [focusActivityId, setFocusActivityId] = useState<string | undefined>(undefined);
  const [resultsOpen, setResultsOpen] = useState(false);
  // The filter sheet opens lowered, the period chips alone over the map.
  const [sheetExpanded, setSheetExpanded] = useState(false);

  // Memoize period start date to keep reference stable across renders
  const periodStart = useMemo(() => getPeriodStart(period), [period]);

  const showRoutes = useHeatmapPreference((s) => s.routesVisible);
  const showSections = useHeatmapPreference((s) => s.sectionsVisible);
  const sectionsEnabled = useRouteSettings((s) => s.settings.enabled);

  const selectedTypes = useMemo(
    () =>
      new Set(
        [...selectedCategories].flatMap((category) => ACTIVITY_CATEGORIES[category]?.types ?? [])
      ),
    [selectedCategories]
  );

  const {
    activities: displayActivities,
    availableTypes,
    categoryCounts,
    totalCount,
    routeCount,
    routeLines,
    sectionCount,
    sections,
    sectionsGeoJSON,
    emptyReason,
    isError: isMapReadError,
    error: mapReadError,
    refetch: refetchMapRead,
  } = useEngineMapActivities({
    startDate: periodStart,
    endDate: ALL_TIME_END,
    selectedTypes,
    distanceBand: distanceFilter,
    isMetric,
    nameNeedle: searchedNeedle,
    showRoutes,
    showSections,
    sectionsEnabled,
    enabled: isReady,
  });

  const { activity: selectActivityId, section: selectSectionId } = useLocalSearchParams<{
    activity?: string;
    section?: string;
  }>();

  // Format synced date range for display
  const dateRangeLabel = useMemo(() => {
    if (!oldestSyncedDate || !newestSyncedDate) return '';
    return `${formatMonthYear(oldestSyncedDate)} – ${formatMonthYear(newestSyncedDate)}`;
  }, [oldestSyncedDate, newestSyncedDate]);

  // The engine counts chips before sport and distance filters, so they stay put.
  const categorySorted = useMemo(() => {
    const groups = groupTypesByCategory(availableTypes);
    const counts = new Map(categoryCounts.map(({ category, count }) => [category, count]));
    return Array.from(groups.entries())
      .map(([category]) => ({
        category,
        count: counts.get(category) ?? 0,
      }))
      .sort((a, b) => b.count - a.count);
  }, [availableTypes, categoryCounts]);

  // The sports the map draws: those in the window, narrowed to the chosen ones.
  const keyCategories = useMemo(
    () =>
      categorySorted
        .filter(
          ({ category, count }) =>
            count > 0 && (selectedCategories.size === 0 || selectedCategories.has(category))
        )
        .map(({ category }) => category),
    [categorySorted, selectedCategories]
  );

  const changeNeedle = (text: string) => {
    setNameNeedle(text);
    setFocusActivityId(undefined);
    setResultsOpen(text.trim().length > 0);
  };

  const chooseResult = (id: string) => {
    setResultsOpen(false);
    setFocusActivityId(id);
  };

  const results = resultsOpen ? displayActivities.slice(0, MAX_SEARCH_RESULTS) : [];

  // The filters narrowing the matches, named as their chips draw them.
  const activeFilterNames = [
    ...PERIOD_OPTIONS.filter(({ id }) => id === period && id !== DEFAULT_MAP_PERIOD).map(
      ({ labelKey }) => t(labelKey as never)
    ),
    ...getDistanceOptions(isMetric, '')
      .filter(({ key }) => key === distanceFilter && key !== MapDistanceBand.All)
      .map(({ label }) => label),
    ...[...selectedCategories].map((category) =>
      t(`maps.activityTypes.${ACTIVITY_CATEGORIES[category]?.labelKey ?? 'other'}` as never)
    ),
  ];

  const clearFilters = () => {
    setSelectedCategories(new Set());
    setDistanceFilter(MapDistanceBand.All);
    changeNeedle('');
  };

  const toggleCategory = (category: string) => {
    setSelectedCategories((previous) => {
      const next = new Set(previous);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  };

  const sheetDrag = Gesture.Pan()
    .runOnJS(true)
    .activeOffsetY([-SHEET_DRAG_ACTIVATION, SHEET_DRAG_ACTIVATION])
    .failOffsetX([-SHEET_DRAG_ACTIVATION, SHEET_DRAG_ACTIVATION])
    .onEnd((event) => {
      setSheetExpanded(
        filterSheetExpandedAfterDrag(sheetExpanded, event.translationY, event.velocityY)
      );
    });

  // A failed map read is named over the map and its sheet rather than taking
  // the tab away, so the period and filters stay to retry from.
  const mapReadFailure = isMapReadError ? (
    <ErrorState
      variant="inline"
      error={mapReadError}
      onRetry={refetchMapRead}
      testID="map-activities-failed"
    />
  ) : null;

  // Show loading state if not ready
  if (!isReady) {
    return (
      <View
        testID="map-screen"
        style={[styles.loadingContainer, isDark && styles.loadingContainerDark]}
      >
        <Shimmer width="100%" height={220} style={styles.loadingShimmer} />
        <Text style={[styles.loadingText, isDark && styles.loadingTextDark]}>
          {t('mapScreen.loadingActivities')}
        </Text>
        {mapReadFailure}
        <View style={styles.loadingBannerContainer}>
          <SyncProgressBanner />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container} testID="map-screen">
      {/* Main map view */}
      <ComponentErrorBoundary part="map" debugName="Map">
        <RegionalMapView
          activities={displayActivities}
          routeCount={routeCount}
          routeLines={routeLines}
          sectionCount={sectionCount}
          sections={sections}
          sectionsGeoJSON={sectionsGeoJSON}
          onAttributionChange={handleAttributionChange}
          selectActivityId={selectActivityId}
          focusActivityId={focusActivityId}
          sectionsEnabled={sectionsEnabled}
          selectSectionId={sectionsEnabled ? selectSectionId : undefined}
          keyCategories={keyCategories}
        />
      </ComponentErrorBoundary>

      <View
        testID="map-attribution-lane"
        style={[styles.attributionLane, { bottom: sheetHeight }]}
        pointerEvents="box-none"
      >
        <AttributionOverlay ref={attributionRef} initialAttribution="" isDark={isDarkBasemap} />
      </View>

      {emptyReason && !isMapReadError ? (
        <MapEmptyState
          reason={emptyReason}
          allTime={period === DEFAULT_MAP_PERIOD}
          onShowAllTime={() => setPeriod(DEFAULT_MAP_PERIOD)}
          onExpandRange={() => tapTo('/sync-settings')}
          onClearFilters={clearFilters}
        />
      ) : null}

      {/* Filter sheet: lowered it shows the period chips, raised every filter */}
      <GestureDetector gesture={sheetDrag}>
        <Animated.View
          layout={LinearTransition.duration(SHEET_FADE_MS)}
          testID="map-filter-sheet"
          onLayout={handleSheetLayout}
          style={[
            styles.infoBar,
            { paddingBottom: bottomClearance + spacing.md },
            isDark && styles.infoBarDark,
          ]}
        >
          <Pressable
            testID="map-filter-handle"
            onPress={() => setSheetExpanded((expanded) => !expanded)}
            accessibilityRole="button"
            accessibilityLabel={
              sheetExpanded ? t('mapScreen.hideFilters') : t('mapScreen.showFilters')
            }
            accessibilityState={{ expanded: sheetExpanded }}
            hitSlop={HANDLE_SLOP}
            style={pressable(styles.handleRow)}
            android_ripple={pressRipple}
          >
            <View style={[styles.handle, isDark && styles.handleDark]} />
          </Pressable>

          {mapReadFailure}

          {sheetExpanded ? (
            <Animated.View
              entering={FadeIn.duration(SHEET_FADE_MS)}
              exiting={FadeOut.duration(SHEET_FADE_MS)}
            >
              <MapNameSearch
                needle={nameNeedle}
                onChangeNeedle={changeNeedle}
                results={results}
                total={displayActivities.length}
                filters={activeFilterNames}
                onChoose={chooseResult}
              />
            </Animated.View>
          ) : null}

          {/* Time period chips */}
          <FilterChipRow
            options={PERIOD_OPTIONS.map(({ id, labelKey }) => ({
              key: id,
              label: t(labelKey as never),
            }))}
            selected={period}
            onSelect={setPeriod}
          />

          {sheetExpanded ? (
            <Animated.View
              entering={FadeIn.duration(SHEET_FADE_MS)}
              exiting={FadeOut.duration(SHEET_FADE_MS)}
            >
              {/* Distance chips */}
              <FilterChipRow
                options={getDistanceOptions(isMetric, t('mapScreen.distanceAny'))}
                selected={distanceFilter}
                onSelect={setDistanceFilter}
              />

              {/* Sport type filter chips */}
              <SportChipRow
                chips={categorySorted.map(({ category, count }) => ({
                  key: category,
                  label: `maps.activityTypes.${ACTIVITY_CATEGORIES[category]?.labelKey ?? 'other'}`,
                  count,
                }))}
                selected={selectedCategories}
                onToggle={toggleCategory}
              />
            </Animated.View>
          ) : null}

          {/* Activity count and date range, in either position of the sheet */}
          <View style={styles.infoRow}>
            <Text style={[styles.infoText, isDark && styles.infoTextDark]}>
              {t('mapScreen.activitySummary', {
                count: totalCount,
                mapped: displayActivities.length,
                defaultValue: '{{count}} activities · {{mapped}} on the map',
              })}
              {dateRangeLabel ? ` · ${dateRangeLabel}` : ''}
            </Text>
            <Button
              label={t('mapScreen.expandRange', 'Expand range')}
              variant="ghost"
              size="sm"
              onPress={() => tapTo('/sync-settings')}
            />
          </View>
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

const HANDLE_HEIGHT = spacing.xs;
const HANDLE_ROW_PADDING = spacing.sm;
const HANDLE_ROW_HEIGHT = HANDLE_HEIGHT + 2 * HANDLE_ROW_PADDING;
// The handle's target reaches the floor mostly upward, over the sheet's edge,
// and only a little downward, where the filter chips start.
const HANDLE_SLOP = {
  top: layout.minTapTarget - HANDLE_ROW_HEIGHT - spacing.xs,
  bottom: spacing.xs,
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: darkColors.background,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.background,
  },
  loadingContainerDark: {
    backgroundColor: darkColors.background,
  },
  loadingShimmer: {
    alignSelf: 'stretch',
    marginHorizontal: spacing.md,
    marginBottom: spacing.md,
  },
  loadingText: {
    marginTop: spacing.md,
    fontSize: typography.body.fontSize,
    color: colors.textSecondary,
  },
  loadingTextDark: {
    color: darkColors.textSecondary,
  },
  loadingBannerContainer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
  },
  infoBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 10,
    backgroundColor: colorWithOpacity(ink.white, 0.92),
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
  },
  handleRow: {
    alignItems: 'center',
    paddingVertical: HANDLE_ROW_PADDING,
  },
  handle: {
    width: spacing.xl,
    height: HANDLE_HEIGHT,
    borderRadius: layout.borderRadiusFull,
    backgroundColor: colorWithOpacity(ink.black, 0.25),
  },
  handleDark: {
    backgroundColor: colorWithOpacity(ink.white, 0.35),
  },
  infoBarDark: {
    backgroundColor: colorWithOpacity(darkColors.backgroundAlt, 0.92),
  },
  // A horizontal scroller clips its children, so the row is as tall as the
  // chips' tap targets or the slop above and below would take no touch.
  chipRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingVertical: Math.max(spacing.xs, slopToMinTapTarget(controlHeight.chip).top),
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
  },
  infoText: {
    fontSize: typography.bodyCompact.fontSize,
    color: colors.textSecondary,
  },
  infoTextDark: {
    color: darkColors.textSecondary,
  },
  attributionLane: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
  },
});

export default withScreenBoundary(MapScreenContent, 'Map');

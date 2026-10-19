import { useTabFirstFrame } from '@/shared/debug/tabSwitchTiming';
import React, { useState, useMemo, useEffect, useRef, useDeferredValue, useCallback } from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  Text,
  type LayoutChangeEvent,
  type ScrollViewInstance,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useIsFocused, useLocalSearchParams } from 'expo-router';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import {
  ATTRIBUTION_CLEARANCE,
  AttributionOverlay,
  type AttributionOverlayRef,
  FILTER_CHIP,
  DEFAULT_MAP_PERIOD,
  filterSheetDragHeight,
  filterSheetFootCover,
  filterSheetMaxHeight,
  filterSheetSettleHeight,
  filterSheetStops,
  getPeriodStart,
  MapEmptyState,
  MapNameSearch,
  type MapPeriod,
  PERIOD_OPTIONS,
  periodSelectLabelKey,
  RegionalMapView,
  sportChipOrder,
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
  PressTarget,
  SelectButton,
  TextLink,
} from '@/shared/ui';
import { useFootCover } from '@/shared/ui/bottomPills';
import { useGestureCallback } from '@/shared/ui/useGestureCallback';
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
  duration,
  easing,
  ink,
  layers,
  layout,
  slopToMinTapTarget,
  spacing,
  typography,
  opacity,
} from '@/theme';
import { ToggleButton } from '@/shared/ui/Button';
import { SportChipRow } from '@/shared/ui/SportChipRow';
import {
  groupTypesByCategory,
  isSportFamily,
  SPORT_FAMILY_LABELS,
  SPORT_FAMILY_MEMBERS,
  type SportFamily,
} from '@/shared/activity/sportCategories';
import { withScreenBoundary } from '@/shared/ui/withScreenBoundary';
import { StagedPage } from '@/shared/ui/StagedPage';
import { formatMonthYear } from '@/shared/format/format';
import { navigateTo } from '@/shared/app/navigation';

// Stable date references - creating new Date() in the component body triggers
// useEngineMapActivities useMemo on every render, causing cascading re-renders
// that make Android MapLibre snap the camera back.
const ALL_TIME_END = new Date('2099-12-31');

const MAX_SEARCH_RESULTS = 5;

/**
 * The frame the map page mounts on. The first visit commits the screen and its
 * sheet over the map's background, and the map with its WebView a frame later.
 */
const MAP_STAGE = 1;

// A vertical drag this far claims the gesture; a horizontal one this far leaves
// it to the chip rows, which scroll sideways.
const SHEET_DRAG_ACTIVATION = 12;
const SHEET_SETTLE = { duration: duration.standard, easing: easing.standard };

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
          accent={FILTER_CHIP}
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
  const handleAttributionChange = useCallback((text: string) => {
    attributionRef.current?.setAttribution(text);
  }, []);
  // The sheet's height moves on the UI thread with the finger and its settling, and the credit
  // rides its edge every frame. The height it last settled on is React state, which the bottom
  // pills and the map's popups read, so they move when the sheet settles.
  const sheetHeight = useSharedValue(0);
  const sheetTarget = useSharedValue(0);
  const sheetDragStart = useSharedValue(0);
  const sheetDragging = useSharedValue(false);
  const [settledHeight, setSettledHeight] = useState(0);
  const settleOnJS = useGestureCallback(setSettledHeight);
  const [handleRowHeight, setHandleRowHeight] = useState(0);
  const [loweredRows, setLoweredRows] = useState(0);
  const [raisedRows, setRaisedRows] = useState(0);
  const [detailHeight, setDetailHeight] = useState(0);
  const [attributionClearance, setAttributionClearance] = useState(ATTRIBUTION_CLEARANCE);
  // The bottom pills rise over the sheet and its credit while the tab is in front.
  const pillClearance = useBottomClearance({ insetTaken: false });
  const focused = useIsFocused();
  useFootCover(
    'mapSheet',
    focused ? filterSheetFootCover(settledHeight, attributionClearance, pillClearance) : null
  );
  // The raised sheet stops under the map's top controls and its filters scroll past that.
  const insetTop = useSafeAreaInsets().top;
  const [screenHeight, setScreenHeight] = useState(0);
  const handleScreenLayout = useCallback((event: LayoutChangeEvent) => {
    setScreenHeight(event.nativeEvent.layout.height);
  }, []);
  const sheetMaxHeight = filterSheetMaxHeight(screenHeight, insetTop);

  // Get sync state from engine cache
  const { isReady, cacheStats } = useActivityBoundsCache();
  const oldestSyncedDate = cacheStats.oldestDate;
  const newestSyncedDate = cacheStats.newestDate;

  // Filter state. The chosen sports keep the order they were chosen in, which their chips lead with.
  const [selectedCategories, setSelectedCategories] = useState<SportFamily[]>([]);
  const [period, setPeriod] = useState<MapPeriod>(DEFAULT_MAP_PERIOD);
  const [distanceFilter, setDistanceFilter] = useState<MapDistanceBand>(MapDistanceBand.All);
  const [nameNeedle, setNameNeedle] = useState('');
  // The field shows each keystroke at once. The map reads the needle in a render React
  // defers behind it, and a keystroke that lands first replaces that render.
  const searchedNeedle = useDeferredValue(nameNeedle);
  const [focusActivityId, setFocusActivityId] = useState<string | undefined>(undefined);
  const [resultsOpen, setResultsOpen] = useState(false);
  // The filter sheet opens lowered, the sport chips and the period alone over the map.
  const [sheetExpanded, setSheetExpanded] = useState(false);
  const expandOnJS = useGestureCallback(setSheetExpanded);

  // Lowered the sheet shows the handle, the rows under it and the foot line, raised it adds the
  // rows below the first ones. Nothing is placed before the lowered rows are measured.
  const sheetPadding = bottomClearance + spacing.md;
  const sheetMeasured = loweredRows > 0;
  const { lowered: loweredHeight, raised: raisedHeight } = filterSheetStops(
    handleRowHeight + loweredRows + detailHeight + sheetPadding,
    raisedRows,
    sheetMaxHeight
  );
  // At the raised stop under the top controls a vertical drag over the filters scrolls them, and
  // only the handle moves the sheet.
  const filtersScroll = sheetExpanded && raisedHeight < loweredHeight + raisedRows;
  const filtersRef = useRef<ScrollViewInstance>(null);

  // A tap on the handle, or rows changing height while no finger holds the sheet, takes it to
  // its state's stop. A drag that has just settled is already on its way there.
  const sheetStop = sheetExpanded ? raisedHeight : loweredHeight;
  const sheetPlaced = useRef(false);
  useEffect(() => {
    if (!sheetMeasured || sheetDragging.value || sheetTarget.value === sheetStop) return;
    sheetTarget.value = sheetStop;
    if (!sheetPlaced.current) {
      sheetPlaced.current = true;
      sheetHeight.value = sheetStop;
      setSettledHeight(sheetStop);
      return;
    }
    sheetHeight.value = withTiming(sheetStop, SHEET_SETTLE, (finished) => {
      if (finished) runOnJS(settleOnJS)(sheetStop);
    });
  }, [sheetMeasured, sheetStop, sheetHeight, sheetTarget, sheetDragging, settleOnJS]);

  // A lowered sheet shows its first rows, so filters scrolled at the raised stop go back to the top.
  useEffect(() => {
    if (!sheetExpanded) filtersRef.current?.scrollTo({ y: 0, animated: true });
  }, [sheetExpanded]);

  const sheetStyle = useAnimatedStyle(() =>
    sheetHeight.value > 0 ? { height: sheetHeight.value } : {}
  );
  const attributionLaneStyle = useAnimatedStyle(() => ({ bottom: sheetHeight.value }));

  // Memoize period start date to keep reference stable across renders
  const periodStart = useMemo(() => getPeriodStart(period), [period]);

  const showRoutes = useHeatmapPreference((s) => s.routesVisible);
  const showSections = useHeatmapPreference((s) => s.sectionsVisible);
  const sectionsEnabled = useRouteSettings((s) => s.settings.enabled);

  const selectedTypes = useMemo(
    () => new Set(selectedCategories.flatMap((category) => SPORT_FAMILY_MEMBERS[category])),
    [selectedCategories]
  );
  const selectedCategorySet = useMemo(() => new Set(selectedCategories), [selectedCategories]);

  const {
    activities: displayActivities,
    availableTypes,
    categoryCounts,
    totalCount,
    unmapped,
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

  // The line under the sport chips and the period, which also names the map for a screen reader.
  // It names why the rest of the window is not drawn, each cause only when it holds an activity.
  const activitySummary = [
    t('mapScreen.activitySummary', {
      count: totalCount,
      mapped: displayActivities.length,
      defaultValue: '{{count}} activities · {{mapped}} on the map',
    }),
    unmapped.withoutGps > 0 &&
      t('mapScreen.unmappedWithoutGps', {
        count: unmapped.withoutGps,
        defaultValue: '{{count}} without GPS',
      }),
    unmapped.downloading > 0 &&
      t('mapScreen.unmappedDownloading', {
        count: unmapped.downloading,
        defaultValue: '{{count}} downloading',
      }),
    dateRangeLabel,
  ]
    .filter(Boolean)
    .join(' · ');

  // The engine counts chips before sport and distance filters, so they stay put.
  const categorySorted = useMemo(() => {
    const groups = groupTypesByCategory(availableTypes);
    const counts = new Map(categoryCounts.map(({ category, count }) => [category, count]));
    return sportChipOrder(
      Array.from(groups.keys()).map((category) => ({
        category,
        count: counts.get(category) ?? 0,
      })),
      selectedCategories
    );
  }, [availableTypes, categoryCounts, selectedCategories]);

  // The sports the map draws: those in the window, narrowed to the chosen ones.
  const keyCategories = useMemo(
    () =>
      categorySorted
        .filter(
          ({ category, count }) =>
            count > 0 && (selectedCategorySet.size === 0 || selectedCategorySet.has(category))
        )
        .map(({ category }) => category),
    [categorySorted, selectedCategorySet]
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
  const periodFilterNames = PERIOD_OPTIONS.filter(
    ({ id }) => id === period && id !== DEFAULT_MAP_PERIOD
  ).map(({ labelKey }) => t(labelKey as never));
  const distanceFilterNames = getDistanceOptions(isMetric, '')
    .filter(({ key }) => key === distanceFilter && key !== MapDistanceBand.All)
    .map(({ label }) => label);
  const activeFilterNames = [
    ...periodFilterNames,
    ...distanceFilterNames,
    ...selectedCategories.map((category) => t(SPORT_FAMILY_LABELS[category])),
  ];
  // The lowered sheet shows the sport chips and the period, so it names the distance and the
  // typed name it hides.
  const typedNeedle = nameNeedle.trim();
  const hiddenFilterNames = typedNeedle
    ? [...distanceFilterNames, typedNeedle]
    : distanceFilterNames;

  const clearHiddenFilters = () => {
    setDistanceFilter(MapDistanceBand.All);
    changeNeedle('');
  };

  const clearFilters = () => {
    setSelectedCategories([]);
    clearHiddenFilters();
  };

  const toggleCategory = (key: string) => {
    if (!isSportFamily(key)) return;
    const category = key;
    setSelectedCategories((previous) =>
      previous.includes(category)
        ? previous.filter((chosen) => chosen !== category)
        : [...previous, category]
    );
  };

  // The drag runs on the UI thread: the sheet follows the finger between its stops and settles
  // on the one the drag rule picks, and only then does React hear of it.
  const sheetDrag = (testID: string) =>
    Gesture.Pan()
      .withTestId(testID)
      .enabled(sheetMeasured)
      .activeOffsetY([-SHEET_DRAG_ACTIVATION, SHEET_DRAG_ACTIVATION])
      .failOffsetX([-SHEET_DRAG_ACTIVATION, SHEET_DRAG_ACTIVATION])
      .onBegin(() => {
        sheetDragStart.value = sheetHeight.value;
      })
      .onStart(() => {
        sheetDragging.value = true;
      })
      .onUpdate((event) => {
        sheetHeight.value = filterSheetDragHeight(
          sheetDragStart.value,
          event.translationY,
          loweredHeight,
          raisedHeight
        );
      })
      .onEnd((event) => {
        const stop = filterSheetSettleHeight(
          sheetExpanded,
          event.translationY,
          event.velocityY,
          loweredHeight,
          raisedHeight
        );
        sheetTarget.value = stop;
        sheetHeight.value = withTiming(stop, SHEET_SETTLE, (finished) => {
          if (finished) runOnJS(settleOnJS)(stop);
        });
        runOnJS(expandOnJS)(stop === raisedHeight && stop !== loweredHeight);
      })
      .onFinalize(() => {
        sheetDragging.value = false;
      });
  const handleDrag = sheetDrag('map-filter-handle-drag');
  // Once the filters scroll, a vertical drag over them scrolls and only the handle moves the sheet.
  const filtersDrag = sheetDrag('map-filter-drag').enabled(sheetMeasured && !filtersScroll);

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
    <View style={styles.container} testID="map-screen" onLayout={handleScreenLayout}>
      {/* Main map view, a frame after the screen and its sheet on the first visit */}
      <StagedPage last={MAP_STAGE}>
        {(stage) =>
          stage < MAP_STAGE ? null : (
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
                bottomClearance={settledHeight + attributionClearance}
                mapLabel={activitySummary}
              />
            </ComponentErrorBoundary>
          )
        }
      </StagedPage>

      <Animated.View
        testID="map-attribution-lane"
        style={[styles.attributionLane, attributionLaneStyle]}
        pointerEvents="box-none"
      >
        <AttributionOverlay
          ref={attributionRef}
          initialAttribution=""
          onClearanceChange={setAttributionClearance}
        />
      </Animated.View>

      {emptyReason && !isMapReadError ? (
        <MapEmptyState
          reason={emptyReason}
          allTime={period === DEFAULT_MAP_PERIOD}
          onShowAllTime={() => setPeriod(DEFAULT_MAP_PERIOD)}
          onExpandRange={() => navigateTo('/sync-settings')}
          onClearFilters={clearFilters}
        />
      ) : null}

      {/* Filter sheet: lowered it shows the sport chips and the period, raised every filter */}
      <Animated.View
        testID="map-filter-sheet"
        style={[
          styles.infoBar,
          { paddingBottom: sheetPadding },
          sheetMaxHeight !== undefined && { maxHeight: sheetMaxHeight },
          isDark && styles.infoBarDark,
          sheetStyle,
        ]}
      >
        <GestureDetector gesture={handleDrag}>
          <PressTarget
            testID="map-filter-handle"
            onPress={() => setSheetExpanded((expanded) => !expanded)}
            onLayout={(event) => setHandleRowHeight(event.nativeEvent.layout.height)}
            accessibilityRole="button"
            accessibilityLabel={
              sheetExpanded ? t('mapScreen.hideFilters') : t('mapScreen.showFilters')
            }
            accessibilityState={{ expanded: sheetExpanded }}
            hitSlop={HANDLE_SLOP}
            style={styles.handleRow}
          >
            <View style={[styles.handle, isDark && styles.handleDark]} />
          </PressTarget>
        </GestureDetector>

        <GestureDetector gesture={filtersDrag}>
          <ScrollView
            ref={filtersRef}
            testID="map-filter-scroll"
            style={styles.filterScroll}
            scrollEnabled={filtersScroll}
            showsVerticalScrollIndicator={filtersScroll}
            bounces={false}
            keyboardShouldPersistTaps="handled"
          >
            {/* The rows the lowered sheet shows, directly under the handle */}
            <View
              testID="map-filter-lowered"
              onLayout={(event) => setLoweredRows(event.nativeEvent.layout.height)}
            >
              {mapReadFailure}

              {/* Sport chips taking the free width, the period pinned at the row's end */}
              <View testID="map-filter-controls" style={styles.filterControls}>
                <SportChipRow
                  chips={categorySorted.map(({ category, count }) => ({
                    key: category,
                    label: SPORT_FAMILY_LABELS[category],
                    count,
                    testID: `map-sport-${category}`,
                  }))}
                  selected={selectedCategorySet}
                  onToggle={toggleCategory}
                  style={styles.sportChips}
                />
                <SelectButton
                  testID="map-period-select"
                  style={styles.periodSelect}
                  accessibilityLabel={t('settings.dateRange')}
                  options={PERIOD_OPTIONS.map(({ id }) => ({
                    value: id,
                    label: t(periodSelectLabelKey(id) as never),
                  }))}
                  value={period}
                  onChange={setPeriod}
                />
              </View>

              {!sheetExpanded && hiddenFilterNames.length > 0 ? (
                <View style={styles.infoRow}>
                  <Text
                    testID="map-filter-summary"
                    style={[styles.infoText, styles.filterSummary, isDark && styles.infoTextDark]}
                  >
                    {t('mapScreen.searchFilteredBy', { filters: hiddenFilterNames.join(', ') })}
                  </Text>
                  <Button
                    label={t('mapScreen.emptyClearFilters')}
                    variant="ghost"
                    size="sm"
                    onPress={clearHiddenFilters}
                  />
                </View>
              ) : null}
            </View>

            {/* The rows rising reveals. Lowered they sit under the sheet's edge, out of reach of
                touch and of the screen reader. */}
            <View
              testID="map-filter-raised"
              onLayout={(event) => setRaisedRows(event.nativeEvent.layout.height)}
              pointerEvents={sheetExpanded ? 'auto' : 'none'}
              accessibilityElementsHidden={!sheetExpanded}
              importantForAccessibility={sheetExpanded ? 'auto' : 'no-hide-descendants'}
            >
              <MapNameSearch
                needle={nameNeedle}
                onChangeNeedle={changeNeedle}
                results={results}
                total={displayActivities.length}
                filters={activeFilterNames}
                onChoose={chooseResult}
              />

              {/* Distance chips */}
              <FilterChipRow
                options={getDistanceOptions(isMetric, t('mapScreen.distanceAny'))}
                selected={distanceFilter}
                onSelect={setDistanceFilter}
              />
            </View>
          </ScrollView>
        </GestureDetector>

        {/* The foot line: the count and the synced span, then the details that join them, last
            in the sheet at either stop with the rows rising above it */}
        <View
          testID="map-sheet-detail"
          style={styles.sheetDetail}
          onLayout={(event) => setDetailHeight(event.nativeEvent.layout.height)}
        >
          <Text style={[styles.detailText, isDark && styles.infoTextDark]}>{activitySummary}</Text>
          <TextLink
            label={t('mapScreen.expandRange', 'Expand range')}
            size="caption"
            onPress={() => navigateTo('/sync-settings')}
          />
        </View>
      </Animated.View>
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

// The filter sheet covers the map, its credit lane and its empty state, which
// stack at the base. The layer scale has no row for a sheet over a map.
const FILTER_SHEET_LAYER = layers.raised;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: darkColors.surfacePage,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.surfacePage,
  },
  loadingContainerDark: {
    backgroundColor: darkColors.surfacePage,
  },
  loadingShimmer: {
    alignSelf: 'stretch',
    marginHorizontal: spacing.md,
    marginBottom: spacing.md,
  },
  loadingText: {
    ...typography.body,
    marginTop: spacing.md,
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
    zIndex: FILTER_SHEET_LAYER,
    backgroundColor: colorWithOpacity(ink.white, 0.92),
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
    // The sheet clips to its height, so rising reveals the rows under those already showing.
    overflow: 'hidden',
  },
  // The filters keep their own height until the sheet's bound squeezes them.
  filterScroll: {
    flexGrow: 0,
    flexShrink: 1,
  },
  handleRow: {
    alignItems: 'center',
    paddingVertical: HANDLE_ROW_PADDING,
  },
  handle: {
    width: spacing.xl,
    height: HANDLE_HEIGHT,
    borderRadius: layout.borderRadiusFull,
    backgroundColor: colorWithOpacity(ink.black, opacity.tint4),
  },
  handleDark: {
    backgroundColor: colorWithOpacity(ink.white, opacity.tint4),
  },
  infoBarDark: {
    backgroundColor: colorWithOpacity(darkColors.surfaceInput, 0.92),
  },
  // A horizontal scroller clips its children, so the row is as tall as the
  // chips' tap targets or the slop above and below would take no touch.
  chipRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingVertical: Math.max(spacing.xs, slopToMinTapTarget(controlHeight.chip).top),
  },
  filterControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  // The scroller's own style holds it at its content's width, so the grow is stated in full.
  sportChips: {
    flexGrow: 1,
    flexShrink: 1,
  },
  periodSelect: {
    flexShrink: 0,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
  },
  infoText: {
    ...typography.bodyCompact,
    color: colors.textSecondary,
  },
  infoTextDark: {
    color: darkColors.textSecondary,
  },
  filterSummary: {
    flexShrink: 1,
  },
  // The foot line wraps, so a long span or a later detail takes a second line rather than an
  // ellipsis.
  sheetDetail: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: spacing.sm,
    paddingTop: spacing.xs,
  },
  detailText: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  attributionLane: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
  },
});

export default withScreenBoundary(MapScreenContent, 'Map');

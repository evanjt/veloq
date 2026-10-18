import { useTabFirstFrame } from '@/shared/debug/tabSwitchTiming';
import React, { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { View, StyleSheet, type ScrollViewInstance } from 'react-native';
import type { MaterialCommunityIcons } from '@expo/vector-icons';
import { ScreenRefreshControl } from '@/shared/ui/ScreenRefreshControl';
import { ScrollView } from 'react-native-gesture-handler';
import {
  Card,
  ChartSkeleton,
  screenListInsets,
  readableColumn,
  ScreenSafeAreaView,
  Spinner,
  useScrollEndInset,
} from '@/shared/ui';
import { logScreenRender, logMemory } from '@/shared/debug/renderTimer';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import {
  FitnessChartCard,
  PerformanceCurveSection,
  FitnessTrendSections,
  FitnessDefinitionsCard,
  TimeRangeSelector,
  SportToggleSelector,
  BestEffortsHeaderButton,
  WellnessTrendsCard,
  resolveThresholdPace,
  useFitnessRefresh,
  useFitnessComputations,
  useFitnessScreenData,
  useFitnessWindow,
  useSportPreference,
  type PrimarySport,
} from '@/features/fitness';
import { timeRangeToDays } from '@/features/wellness';
import { ActivityHeatmap, SeasonComparison, WeeklySummary } from '@/features/stats';
import { useTheme, useCollapsibleSections } from '@/shared/app';
import { spacing, layout } from '@/theme';
import { createSharedStyles } from '@/styles';

import {
  FITNESS_CHART_PLACEMENT,
  FITNESS_PLACES,
  fitnessChartAnchor,
  fitnessEntryFromParams,
  fitnessPlaceOf,
  type FitnessAnchor,
  type FitnessChart,
  type FitnessPlace,
} from '@/shared/app/fitnessEntry';
import { useRevealChart } from '@/shared/app/useRevealChart';
import { withScreenBoundary } from '@/shared/ui/withScreenBoundary';
import { useScrollToTopOnReselect } from '@/shared/ui/tabReselect';
import { SwipeableTabs, type SwipeableTab } from '@/shared/ui/SwipeableTabs';
import { StagedPage } from '@/shared/ui/StagedPage';

const NO_WELLNESS: NonNullable<ReturnType<typeof useFitnessScreenData>['wellness']> = [];

/**
 * The frames the fitness page mounts across after the first: the fitness chart
 * on the second, the cards below it on the third and the wellness canvas on the
 * fourth.
 */
const CHART_STAGE = 2;
const BELOW_FOLD_STAGE = 3;
const WELLNESS_STAGE = 4;

/**
 * The frames the calendar page mounts across after its first visit, one card
 * or canvas per frame: the week, the calendar's canvas, the year comparison.
 */
const WEEK_STAGE = 1;
const CALENDAR_STAGE = 2;
const YEAR_STAGE = 3;

/** The performance and trends pages paint their controls first and their sections a frame later. */
const SECTION_STAGE = 1;

/** A page's pinned header is its scroll's first child. */
const PINNED_HEADER = [0];

/** Each page's tab: its label and its glyph. */
const PLACE_TABS = {
  fitness: { label: 'fitnessScreen.places.fitness', icon: 'chart-line' },
  calendar: { label: 'fitnessScreen.places.calendar', icon: 'calendar-month' },
  performance: { label: 'fitnessScreen.places.performance', icon: 'lightning-bolt' },
  trends: { label: 'fitnessScreen.places.trends', icon: 'trending-up' },
} as const satisfies Record<
  FitnessPlace,
  { label: string; icon: keyof typeof MaterialCommunityIcons.glyphMap }
>;

type PageReveal = ReturnType<typeof useRevealChart<FitnessChart, FitnessAnchor>>;

/** The chart a link named, if `place` is the page that draws it. */
function chartOnPlace(chart: FitnessChart | null, place: FitnessPlace): FitnessChart | null {
  return chart && fitnessPlaceOf({ chart }) === place ? chart : null;
}

function FitnessScreenContent() {
  useTabFirstFrame('/fitness');
  const { t } = useTranslation();
  // Performance timing
  const perfEndRef = useRef<(() => void) | null>(null);
  // Deliberately during render: the timer has to start where the render does,
  // and an effect would measure from after paint instead.
  // eslint-disable-next-line react-hooks/refs
  perfEndRef.current = logScreenRender('FitnessScreen');
  useEffect(() => {
    perfEndRef.current?.();
  });

  const { isDark } = useTheme();
  const scrollEndInset = useScrollEndInset({ insetTaken: true });
  const shared = createSharedStyles(isDark);
  // A card that summarised a window links here with it, so the screen opens on
  // that window rather than on its own default, mounted or not. A metric
  // names a chart as well, which `useRevealChart` takes and clears below, and
  // a link may name a page.
  const params = useLocalSearchParams<{
    range?: string;
    date?: string;
    chart?: string;
    tab?: string;
  }>();
  const entry = fitnessEntryFromParams(params);
  const entryChart = entry.chart ?? null;
  const entryPlace = entry.place ?? null;
  const [place, setPlace] = useState<FitnessPlace>(() => fitnessPlaceOf(entry));

  // A link that names a page while the screen is mounted moves to it, taken
  // while rendering so no frame shows the page it left. The param is cleared
  // once applied, so a later link to the same page moves the screen again
  // after the athlete has swiped elsewhere.
  const [placeLink, setPlaceLink] = useState(entryPlace);
  if (entryPlace !== placeLink) {
    setPlaceLink(entryPlace);
    if (entryPlace) setPlace(fitnessPlaceOf({ chart: entryChart, place: entryPlace }));
  }
  useEffect(() => {
    if (entryPlace) router.setParams({ tab: undefined });
  }, [entryPlace]);
  const clearEntry = useCallback(() => router.setParams({ range: undefined, date: undefined }), []);
  const {
    timeRange,
    changeTimeRange,
    sharedSelectedIdx,
    chartInteracting,
    selectedDate,
    handleInteractionChange,
    handleDateSelect,
  } = useFitnessWindow(entry, clearEntry);

  useEffect(() => {
    logMemory('FitnessScreen:mount');
  }, []);

  // Collapsible section state - all collapsed by default to reduce initial render load
  const sections = useCollapsibleSections({
    performance: false,
    bests: false,
    zones: false,
    trends: false,
    efficiency: false,
  });

  const { primarySport, isLoaded: sportLoaded, adoptLibrarySport } = useSportPreference();

  // Sport mode state - defaults to primary sport, can be toggled
  const [sportMode, setSportMode] = useState<PrimarySport>(() => primarySport);
  const [sportModeFor, setSportModeFor] = useState(primarySport);

  // Follow the preference when it changes. Taking it while rendering means the
  // screen never commits a frame still showing the old sport.
  if (primarySport !== sportModeFor) {
    setSportModeFor(primarySport);
    setSportMode(primarySport);
  }

  // A metric linked here names its chart: bring its page to the front, open
  // the section that holds it, on the sport that draws it, and scroll that
  // page to it. Each page holds its own scroll and anchors, and the chart goes
  // only to the page that draws it.
  const { setExpanded } = sections;
  const prepareChart = useCallback(
    (chart: FitnessChart) => {
      const { place: chartPlace, section, sport } = FITNESS_CHART_PLACEMENT[chart];
      setPlace(chartPlace);
      if (sport) setSportMode(sport);
      if (section) setExpanded(section, true);
    },
    [setExpanded, setPlace, setSportMode]
  );
  const reveals: Record<FitnessPlace, PageReveal> = {
    fitness: useRevealChart(chartOnPlace(entryChart, 'fitness'), fitnessChartAnchor, prepareChart),
    calendar: useRevealChart(
      chartOnPlace(entryChart, 'calendar'),
      fitnessChartAnchor,
      prepareChart
    ),
    performance: useRevealChart(
      chartOnPlace(entryChart, 'performance'),
      fitnessChartAnchor,
      prepareChart
    ),
    trends: useRevealChart(chartOnPlace(entryChart, 'trends'), fitnessChartAnchor, prepareChart),
  };

  // A reselect of the tab scrolls the page in front, read at the press.
  const placeRef = useRef(place);
  useEffect(() => {
    placeRef.current = place;
  });
  const fitnessScroll = reveals.fitness.scrollRef;
  const calendarScroll = reveals.calendar.scrollRef;
  const performanceScroll = reveals.performance.scrollRef;
  const trendsScroll = reveals.trends.scrollRef;
  const frontPageRef = useMemo(() => {
    const scrolls: Record<FitnessPlace, { current: ScrollViewInstance | null }> = {
      fitness: fitnessScroll,
      calendar: calendarScroll,
      performance: performanceScroll,
      trends: trendsScroll,
    };
    return {
      current: {
        scrollTo: (target: { y: number; animated?: boolean }) =>
          scrolls[placeRef.current].current?.scrollTo(target),
      },
    };
  }, [fitnessScroll, calendarScroll, performanceScroll, trendsScroll]);
  useScrollToTopOnReselect('/fitness', frontPageRef);

  // Gather all screen data via consolidated hook (wellness, load dots, zones, curves, bests)
  const {
    wellness,
    wellnessCoverage,
    wellnessHeld,
    loadDots,
    dailyLoads,
    powerZones,
    hrZones,
    periodCoverage,
    eftpTrend,
    eftpCoverage,
    eftpChanges,
    storedRunPace,
    storedSwimPace,
    librarySport,
    fitnessDays,
    fatigueDays,
    currentFTP,
    runLthr,
    runPaceCurve,
    swimPaceCurve,
    bestsEfforts,
    bestsClimbing,
    bestsClimbingStatus,
    loadingBests,
    bestsHeader,
    decouplingSource,
    training,
    isLoading,
    isFetching,
    isError,
    error,
    refetch,
  } = useFitnessScreenData({ timeRange, sportMode });

  // Until the athlete picks a sport, it follows what the library is mostly
  // made of. Taken before paint, so the tab never shows the old sport's cards.
  useLayoutEffect(() => {
    if (sportLoaded) void adoptLibrarySport(librarySport);
  }, [adoptLibrarySport, librarySport, sportLoaded]);

  // The curve is a download, so offline it is absent and the stored critical
  // speed behind it is the only reading the screen has.
  const thresholdPace =
    resolveThresholdPace(runPaceCurve?.criticalSpeed, storedRunPace) ?? undefined;
  const swimThresholdPace =
    resolveThresholdPace(swimPaceCurve?.criticalSpeed, storedSwimPace) ?? undefined;

  // Memory profiling for crash investigation
  useEffect(() => {
    if (wellness) logMemory('FitnessScreen:wellnessLoaded');
  }, [wellness]);
  // Handle pull-to-refresh - invalidate all fitness-related queries
  const { isRefreshing, onRefresh } = useFitnessRefresh(refetch, training.retry);

  // Memoized derivations (FTP trend, dominant zone)
  const { ftpTrend, dominantZone } = useFitnessComputations({
    sportMode,
    powerZones,
    hrZones,
    eftpTrend,
  });

  const days = timeRangeToDays(timeRange);
  const retryWellness = useCallback(() => {
    void refetch();
  }, [refetch]);

  // The title is the native header's. Its trailing items are the best-efforts link and, while a
  // background fetch runs outside a pull-to-refresh, a spinner beside it.
  const fetchingInBackground = isFetching && !isRefreshing;
  const headerOptions = useMemo(
    () => ({
      headerRight: () => (
        <View style={styles.headerActions}>
          {fetchingInBackground ? <Spinner label={t('common.loading')} /> : null}
          <BestEffortsHeaderButton period={timeRange} />
        </View>
      ),
    }),
    [fetchingInBackground, timeRange, t]
  );

  const tabs = useMemo<SwipeableTab[]>(
    () =>
      FITNESS_PLACES.map((key) => ({
        key,
        label: t(PLACE_TABS[key].label),
        icon: PLACE_TABS[key].icon,
      })),
    [t]
  );
  const changePlace = useCallback((key: string) => setPlace(key as FitnessPlace), [setPlace]);

  // Only show full loading on initial load (no data yet)
  if (isLoading && !wellness) {
    return (
      <ScreenSafeAreaView style={shared.container}>
        <Stack.Screen options={headerOptions} />
        <View style={styles.skeletonContainer}>
          <ChartSkeleton height={180} />
          <ChartSkeleton height={120} />
        </View>
      </ScreenSafeAreaView>
    );
  }

  // Every page scrolls on its own and refreshes the whole screen from a pull.
  // A page whose cards read the range pins it, with the sport row where the
  // page has one, as the scroll's first child, so it stays in view and a linked
  // chart lands below it. The staged content stays the second child, whose
  // fragment keeps each anchor's offset relative to the content container.
  const page = (
    key: FitnessPlace,
    scrubs: boolean,
    header: React.ReactNode | null,
    content: React.ReactNode
  ) => (
    <ScrollView
      {...screenListInsets}
      ref={reveals[key].scrollRef}
      onScrollBeginDrag={reveals[key].onScrollBeginDrag}
      style={styles.scrollView}
      contentContainerStyle={[
        readableColumn,
        styles.scrollContent,
        { paddingBottom: layout.screenPadding + scrollEndInset },
      ]}
      showsVerticalScrollIndicator={false}
      scrollEnabled={!(scrubs && chartInteracting)}
      stickyHeaderIndices={header ? PINNED_HEADER : undefined}
      refreshControl={<ScreenRefreshControl refreshing={isRefreshing} onRefresh={onRefresh} />}
    >
      {header ? (
        <View
          testID="fitness-pinned-header"
          onLayout={reveals[key].onHeaderLayout}
          style={shared.pinnedRow}
        >
          {header}
        </View>
      ) : null}
      {content}
    </ScrollView>
  );

  // The range is one choice for the screen, so a range picked on one page is
  // the range on every page that reads one.
  const rangeSelector = (
    <TimeRangeSelector timeRange={timeRange} onTimeRangeChange={changeTimeRange} isDark={isDark} />
  );
  const sportToggle = (
    <SportToggleSelector sportMode={sportMode} onSportModeChange={setSportMode} />
  );
  const rangeAndSport = (
    <>
      {rangeSelector}
      {sportToggle}
    </>
  );
  const anchorOn = reveals.fitness.onAnchorLayout;

  // Let the header paint before mounting the chart canvas, then mount the
  // cards below the chart and their canvases on the frames that follow.
  const fitnessPage = page(
    'fitness',
    true,
    rangeSelector,
    <StagedPage last={WELLNESS_STAGE}>
      {(stage) => (
        <>
          <View onLayout={(event) => anchorOn('chart', event)}>
            {stage >= CHART_STAGE ? (
              // The curves, bests, zones and decoupling are reads of their own, so a
              // failed wellness read is named in this card and leaves them standing.
              <FitnessChartCard
                wellness={wellness ?? NO_WELLNESS}
                wellnessCoverage={wellnessCoverage}
                loadDots={loadDots}
                dailyLoads={dailyLoads}
                eftpChanges={eftpChanges}
                selectedDate={selectedDate}
                sharedSelectedIdx={sharedSelectedIdx}
                onDateSelect={handleDateSelect}
                onInteractionChange={handleInteractionChange}
                readError={isError ? error : undefined}
                onRetry={retryWellness}
                held={wellnessHeld}
              />
            ) : (
              <View style={styles.chartPlaceholder}>
                <Card variant="flat" padding="none">
                  <View testID="fitness-chart-placeholder" style={styles.chartPlaceholderBody} />
                </Card>
              </View>
            )}
          </View>

          {stage >= BELOW_FOLD_STAGE ? (
            <>
              {/* Wellness follows the screen's one range. */}
              <View
                testID="wellness-trends-chart"
                onLayout={(event) => anchorOn('wellness', event)}
                style={styles.frame}
              >
                <WellnessTrendsCard
                  wellness={wellness}
                  coverage={wellnessCoverage}
                  timeRange={timeRange}
                  drawn={stage >= WELLNESS_STAGE}
                  isLoading={isLoading}
                  held={wellnessHeld}
                  readError={isError ? error : undefined}
                  onRetry={retryWellness}
                />
              </View>

              <FitnessDefinitionsCard fitnessDays={fitnessDays} fatigueDays={fatigueDays} />
            </>
          ) : null}
        </>
      )}
    </StagedPage>
  );

  // The calendar-span cards paint their own periods, whatever the range, from
  // the screen read, so this page carries no control.
  const calendarPage = page(
    'calendar',
    false,
    null,
    <StagedPage last={YEAR_STAGE}>
      {(stage) => (
        <>
          {stage >= WEEK_STAGE ? (
            <View
              onLayout={(event) => reveals.calendar.onAnchorLayout('week', event)}
              style={styles.frame}
            >
              <Card variant="flat">
                <WeeklySummary training={training} />
              </Card>
            </View>
          ) : null}

          <View
            onLayout={(event) => reveals.calendar.onAnchorLayout('calendar', event)}
            style={styles.frame}
          >
            <Card variant="flat">
              <ActivityHeatmap training={training} drawn={stage >= CALENDAR_STAGE} />
            </Card>
          </View>

          {stage >= YEAR_STAGE ? (
            <View style={styles.frame}>
              <Card variant="flat">
                <SeasonComparison training={training} height={180} />
              </Card>
            </View>
          ) : null}
        </>
      )}
    </StagedPage>
  );

  // Performance curves and season bests.
  const performancePage = page(
    'performance',
    true,
    rangeAndSport,
    <StagedPage last={SECTION_STAGE}>
      {(stage) => (
        <>
          {stage >= SECTION_STAGE ? (
            <View onLayout={(event) => reveals.performance.onAnchorLayout('performance', event)}>
              <PerformanceCurveSection
                sportMode={sportMode}
                timeRange={timeRange}
                days={days}
                currentFTP={currentFTP}
                thresholdPace={thresholdPace}
                swimThresholdPace={swimThresholdPace}
                performanceExpanded={sections.expanded('performance')}
                onPerformanceToggle={sections.onToggle('performance')}
                bestsExpanded={sections.expanded('bests')}
                onBestsToggle={sections.onToggle('bests')}
                bestsEfforts={bestsEfforts}
                bestsClimbing={bestsClimbing}
                bestsClimbingStatus={bestsClimbingStatus}
                loadingBests={loadingBests}
                bestsHeader={bestsHeader}
              />
            </View>
          ) : null}
        </>
      )}
    </StagedPage>
  );

  // Zones, the eFTP trend, thresholds and decoupling.
  const trendsPage = page(
    'trends',
    true,
    rangeAndSport,
    <StagedPage last={SECTION_STAGE}>
      {(stage) => (
        <>
          {stage >= SECTION_STAGE ? (
            <View onLayout={(event) => reveals.trends.onAnchorLayout('trends', event)}>
              <FitnessTrendSections
                sportMode={sportMode}
                timeRange={timeRange}
                powerZones={powerZones}
                hrZones={hrZones}
                periodCoverage={periodCoverage}
                dominantZone={dominantZone}
                zonesExpanded={sections.expanded('zones')}
                onZonesToggle={sections.onToggle('zones')}
                eftpTrend={eftpTrend}
                eftpCoverage={eftpCoverage}
                ftpTrend={ftpTrend}
                trendsExpanded={sections.expanded('trends')}
                onTrendsToggle={sections.onToggle('trends')}
                thresholdPace={thresholdPace}
                runLthr={runLthr ?? undefined}
                decouplingSource={decouplingSource}
                efficiencyExpanded={sections.expanded('efficiency')}
                onEfficiencyToggle={sections.onToggle('efficiency')}
              />
            </View>
          ) : null}
        </>
      )}
    </StagedPage>
  );

  return (
    <ScreenSafeAreaView style={shared.container} testID="fitness-screen">
      <Stack.Screen options={headerOptions} />
      <SwipeableTabs
        tabs={tabs}
        activeTab={place}
        onTabChange={changePlace}
        isDark={isDark}
        gestureEnabled={!chartInteracting}
        lazy
      >
        {[fitnessPage, calendarPage, performancePage, trendsPage]}
      </SwipeableTabs>
    </ScreenSafeAreaView>
  );
}

const styles = StyleSheet.create({
  // Note: container and loadingContainer use shared styles
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: layout.screenPadding,
    paddingTop: spacing.sm,
  },
  chartPlaceholder: {
    marginBottom: spacing.md,
  },
  frame: {
    marginBottom: spacing.md,
  },
  chartPlaceholderBody: {
    height: 500,
  },
  skeletonContainer: {
    flex: 1,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    gap: spacing.md,
  },
});

export default withScreenBoundary(FitnessScreenContent, 'Fitness');

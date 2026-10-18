import { useTabFirstFrame } from '@/shared/debug/tabSwitchTiming';
import React, { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { View, StyleSheet } from 'react-native';
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
import type { ActivityHeatmapHandle } from '@/features/stats';
import { useTheme, useCollapsibleSections } from '@/shared/app';
import { spacing, layout } from '@/theme';
import { createSharedStyles } from '@/styles';

import {
  FITNESS_CHART_PLACEMENT,
  fitnessChartAnchor,
  fitnessEntryFromParams,
  type FitnessChart,
} from '@/shared/app/fitnessEntry';
import { useRevealChart } from '@/shared/app/useRevealChart';
import { withScreenBoundary } from '@/shared/ui/withScreenBoundary';
import { useScrollToTopOnReselect } from '@/shared/ui/tabReselect';

const NO_WELLNESS: NonNullable<ReturnType<typeof useFitnessScreenData>['wellness']> = [];

/**
 * The frames the screen mounts across after the first: the fitness chart on
 * the second, the cards below it on the third, then one canvas or card per
 * frame for the wellness chart, the calendar, the week and the year comparison.
 */
const CHART_STAGE = 2;
const BELOW_FOLD_STAGE = 3;
const WELLNESS_STAGE = 4;
const CALENDAR_STAGE = 5;
const WEEK_STAGE = 6;
const YEAR_STAGE = 7;

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

  // Let the header paint before mounting the chart canvases, then mount the
  // sections below the chart and their canvases on the frames that follow.
  const [stage, setStage] = useState(0);
  useEffect(() => {
    if (stage >= YEAR_STAGE) return undefined;
    const id = requestAnimationFrame(() => setStage(stage + 1));
    return () => cancelAnimationFrame(id);
  }, [stage]);
  const chartReady = stage >= CHART_STAGE;
  const belowFoldReady = stage >= BELOW_FOLD_STAGE;

  // Cross-chart scrubbing: the wellness scrub highlights its day in the
  // calendar, which holds the highlight itself so the screen does not
  // re-render per day the gesture crosses.
  const heatmap = useRef<ActivityHeatmapHandle>(null);
  const highlightCalendarDay = useCallback((date: string | null) => {
    heatmap.current?.setHighlight(date);
  }, []);

  const { isDark } = useTheme();
  const scrollEndInset = useScrollEndInset({ insetTaken: true });
  const shared = createSharedStyles(isDark);
  // A card that summarised a window links here with it, so the screen opens on
  // that window rather than on its own default, mounted or not. A metric
  // names a chart as well, which `useRevealChart` takes and clears below.
  const params = useLocalSearchParams<{ range?: string; date?: string; chart?: string }>();
  const entry = fitnessEntryFromParams(params);
  const entryChart = entry.chart ?? null;
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

  // A metric linked here names its chart: open the section that holds it, on
  // the sport that draws it, and scroll to it.
  const { setExpanded } = sections;
  const prepareChart = useCallback(
    (chart: FitnessChart) => {
      const { section, sport } = FITNESS_CHART_PLACEMENT[chart];
      if (sport) setSportMode(sport);
      if (section) setExpanded(section, true);
    },
    [setExpanded]
  );
  const { scrollRef, onAnchorLayout, onScrollBeginDrag } = useRevealChart(
    entryChart,
    fitnessChartAnchor,
    prepareChart
  );
  useScrollToTopOnReselect('/fitness', scrollRef);

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
  const { isRefreshing, onRefresh } = useFitnessRefresh(refetch);

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

  return (
    <ScreenSafeAreaView style={shared.container} testID="fitness-screen">
      <Stack.Screen options={headerOptions} />
      <ScrollView
        {...screenListInsets}
        ref={scrollRef}
        onScrollBeginDrag={onScrollBeginDrag}
        style={styles.scrollView}
        contentContainerStyle={[
          readableColumn,
          styles.scrollContent,
          { paddingBottom: layout.screenPadding + scrollEndInset },
        ]}
        showsVerticalScrollIndicator={false}
        scrollEnabled={!chartInteracting}
        refreshControl={<ScreenRefreshControl refreshing={isRefreshing} onRefresh={onRefresh} />}
      >
        {/* Time range selector */}
        <TimeRangeSelector
          timeRange={timeRange}
          onTimeRangeChange={changeTimeRange}
          isDark={isDark}
        />

        {/* Combined fitness charts card */}
        <View onLayout={(event) => onAnchorLayout('chart', event)}>
          {chartReady ? (
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

        {belowFoldReady ? (
          <>
            {/* Wellness follows the screen's one range. */}
            <View
              testID="wellness-trends-chart"
              onLayout={(event) => onAnchorLayout('wellness', event)}
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
                onDateSelect={highlightCalendarDay}
              />
            </View>

            {/* The calendar-span cards read their own periods, whatever the range. */}
            {stage >= WEEK_STAGE ? (
              <View onLayout={(event) => onAnchorLayout('week', event)} style={styles.frame}>
                <Card variant="flat">
                  <WeeklySummary />
                </Card>
              </View>
            ) : null}

            <View onLayout={(event) => onAnchorLayout('calendar', event)} style={styles.frame}>
              <Card variant="flat">
                <ActivityHeatmap ref={heatmap} drawn={stage >= CALENDAR_STAGE} />
              </Card>
            </View>

            {stage >= YEAR_STAGE ? (
              <View style={styles.frame}>
                <Card variant="flat">
                  <SeasonComparison height={180} />
                </Card>
              </View>
            ) : null}

            {/* Sport toggle */}
            <SportToggleSelector sportMode={sportMode} onSportModeChange={setSportMode} />

            {/* Performance curves + season bests */}
            <View onLayout={(event) => onAnchorLayout('performance', event)}>
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

            {/* Zones, trends, thresholds, decoupling */}
            <View onLayout={(event) => onAnchorLayout('trends', event)}>
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

            <FitnessDefinitionsCard fitnessDays={fitnessDays} fatigueDays={fatigueDays} />
          </>
        ) : null}
      </ScrollView>
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

import { useTabFirstFrame } from '@/shared/debug/tabSwitchTiming';
import React, { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo } from 'react';
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
  resolveThresholdPace,
  useFitnessRefresh,
  useFitnessComputations,
  useFitnessScreenData,
  useFitnessWindow,
  useSportPreference,
  type PrimarySport,
} from '@/features/fitness';
import { timeRangeToDays } from '@/features/wellness';
import { useTheme, useCollapsibleSections } from '@/shared/app';
import { spacing, layout } from '@/theme';
import { createSharedStyles } from '@/styles';

import {
  FITNESS_CHART_PLACEMENT,
  fitnessEntryFromParams,
  type FitnessChart,
} from '@/shared/app/fitnessEntry';
import { useRevealChart } from '@/shared/app/useRevealChart';
import { withScreenBoundary } from '@/shared/ui/withScreenBoundary';
import { useScrollToTopOnReselect } from '@/shared/ui/tabReselect';

const NO_ACTIVITIES: NonNullable<ReturnType<typeof useFitnessScreenData>['activities']> = [];
const NO_WELLNESS: NonNullable<ReturnType<typeof useFitnessScreenData>['wellness']> = [];

/** The fitness and form charts sit in the card at the top; the rest in their section. */
function fitnessChartAnchor(chart: FitnessChart): 'chart' | 'performance' | 'trends' {
  return FITNESS_CHART_PLACEMENT[chart].section ?? 'chart';
}

function FitnessScreenContent() {
  useTabFirstFrame('/fitness');
  // Performance timing
  const perfEndRef = useRef<(() => void) | null>(null);
  // Deliberately during render: the timer has to start where the render does,
  // and an effect would measure from after paint instead.
  // eslint-disable-next-line react-hooks/refs
  perfEndRef.current = logScreenRender('FitnessScreen');
  useEffect(() => {
    perfEndRef.current?.();
  });

  // Let the header paint before mounting the chart canvases, then
  // mount the sections below the chart on a later frame.
  const [chartReady, setChartReady] = useState(false);
  const [belowFoldReady, setBelowFoldReady] = useState(false);
  useEffect(() => {
    let chartFrame = 0;
    let belowFoldFrame = 0;
    const firstFrame = requestAnimationFrame(() => {
      chartFrame = requestAnimationFrame(() => {
        setChartReady(true);
        belowFoldFrame = requestAnimationFrame(() => setBelowFoldReady(true));
      });
    });
    return () => {
      cancelAnimationFrame(firstFrame);
      cancelAnimationFrame(chartFrame);
      cancelAnimationFrame(belowFoldFrame);
    };
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

  // Gather all screen data via consolidated hook (wellness, activities, zones, curves, bests)
  const {
    wellness,
    wellnessCoverage,
    wellnessHeld,
    activities,
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
    runSettings,
    runPaceCurve,
    swimPaceCurve,
    bestsEfforts,
    bestsClimbing,
    bestsClimbingStatus,
    loadingActivities,
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

  const runLthr = runSettings?.lthr;
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
          {fetchingInBackground ? <Spinner /> : null}
          <BestEffortsHeaderButton period={timeRange} />
        </View>
      ),
    }),
    [fetchingInBackground, timeRange]
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
              activities={activities ?? NO_ACTIVITIES}
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
                loadingActivities={loadingActivities}
                hasActivities={!!activities}
                dominantZone={dominantZone}
                zonesExpanded={sections.expanded('zones')}
                onZonesToggle={sections.onToggle('zones')}
                eftpTrend={eftpTrend}
                eftpCoverage={eftpCoverage}
                ftpTrend={ftpTrend}
                trendsExpanded={sections.expanded('trends')}
                onTrendsToggle={sections.onToggle('trends')}
                thresholdPace={thresholdPace}
                runLthr={runLthr}
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

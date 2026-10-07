import { useTabFirstFrame } from '@/shared/debug/tabSwitchTiming';
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { View, StyleSheet, TouchableOpacity, RefreshControl } from 'react-native';
import { ScrollView } from 'react-native-gesture-handler';
import { Text, ActivityIndicator } from 'react-native-paper';
import {
  ScreenSafeAreaView,
  TAB_BAR_SAFE_PADDING,
  ChartSkeleton,
  StatsPillSkeleton,
  ErrorStatePreset,
} from '@/shared/ui';
import { logScreenRender, logMemory } from '@/shared/debug/renderTimer';
import * as WebBrowser from 'expo-web-browser';
import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import {
  FitnessChartCard,
  PerformanceCurveSection,
  FitnessTrendSections,
  TimeRangeSelector,
  SportToggleSelector,
  FitnessHeaderStats,
  BestEffortsHeaderButton,
  resolveThresholdPace,
  useFitnessRefresh,
  useFitnessComputations,
  useFitnessScreenData,
  useFitnessWindow,
  FORM_ZONE_COLORS,
  useSportPreference,
  type PrimarySport,
} from '@/features/fitness';
import { timeRangeToDays } from '@/features/wellness';
import { useTheme, useCollapsibleSections } from '@/shared/app';
import { colors, darkColors, spacing, layout, typography, opacity } from '@/theme';
import { createSharedStyles } from '@/styles';

import {
  FITNESS_CHART_PLACEMENT,
  fitnessEntryFromParams,
  type FitnessChart,
} from '@/shared/app/fitnessEntry';
import { useRevealChart } from '@/shared/app/useRevealChart';
import { withScreenBoundary } from '@/shared/ui/withScreenBoundary';

const NO_ACTIVITIES: NonNullable<ReturnType<typeof useFitnessScreenData>['activities']> = [];

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

  const { t } = useTranslation();
  const { isDark } = useTheme();
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
    selectedValues,
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

  const { primarySport } = useSportPreference();

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

  // Gather all screen data via consolidated hook (wellness, activities, zones, curves, bests)
  const {
    wellness,
    activities,
    dailyLoads,
    powerZones,
    hrZones,
    zoneCoverage,
    eftpTrend,
    eftpChanges,
    storedRunPace,
    storedSwimPace,
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
    refetch,
  } = useFitnessScreenData({ timeRange, sportMode });

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

  // Memoized derivations (FTP trend, dominant zone, form zone, display values)
  const { ftpTrend, dominantZone, displayValues, displayDate, formZone, rampRate } =
    useFitnessComputations({
      wellness,
      sportMode,
      powerZones,
      hrZones,
      eftpTrend,
      selectedDate,
      selectedValues,
    });

  const days = timeRangeToDays(timeRange);

  // Only show full loading on initial load (no data yet)
  if (isLoading && !wellness) {
    return (
      <ScreenSafeAreaView style={shared.container}>
        <View style={styles.header}>
          <Text style={shared.screenTitle}>{t('fitnessScreen.title')}</Text>
          <BestEffortsHeaderButton />
        </View>
        <View style={styles.skeletonContainer}>
          <StatsPillSkeleton />
          <ChartSkeleton height={180} />
          <ChartSkeleton height={120} />
        </View>
      </ScreenSafeAreaView>
    );
  }

  if (isError || !wellness) {
    return (
      <ScreenSafeAreaView style={shared.container}>
        <View style={styles.header}>
          <Text style={shared.screenTitle}>{t('fitnessScreen.title')}</Text>
          <BestEffortsHeaderButton />
        </View>
        <View style={shared.loadingContainer}>
          <ErrorStatePreset message={t('fitnessScreen.failedToLoad')} onRetry={() => refetch()} />
        </View>
      </ScreenSafeAreaView>
    );
  }

  return (
    <ScreenSafeAreaView style={shared.container} testID="fitness-screen">
      {/* Header */}
      <View style={styles.header}>
        <Text style={shared.screenTitle}>{t('fitnessScreen.title')}</Text>
        {/* Subtle loading indicator in header when fetching in background (not during pull-to-refresh) */}
        {isFetching && !isRefreshing && (
          <ActivityIndicator size="small" color={colors.primary} style={styles.headerSpinner} />
        )}
        <BestEffortsHeaderButton />
      </View>

      <ScrollView
        ref={scrollRef}
        onScrollBeginDrag={onScrollBeginDrag}
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        scrollEnabled={!chartInteracting}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
      >
        {/* Current stats card */}
        <FitnessHeaderStats
          displayDate={displayDate}
          displayValues={displayValues}
          formZone={formZone}
          isDark={isDark}
          rampRate={rampRate}
        />

        {/* Time range selector */}
        <TimeRangeSelector
          timeRange={timeRange}
          onTimeRangeChange={changeTimeRange}
          isDark={isDark}
        />

        {/* Combined fitness charts card */}
        <View onLayout={(event) => onAnchorLayout('chart', event)}>
          <FitnessChartCard
            wellness={wellness}
            activities={activities ?? NO_ACTIVITIES}
            dailyLoads={dailyLoads}
            eftpChanges={eftpChanges}
            selectedDate={selectedDate}
            sharedSelectedIdx={sharedSelectedIdx}
            onDateSelect={handleDateSelect}
            onInteractionChange={handleInteractionChange}
          />
        </View>

        {/* Sport Toggle - compact pill selector */}
        <SportToggleSelector
          sportMode={sportMode}
          onSportModeChange={setSportMode}
          isDark={isDark}
        />

        {/* Performance curves + season bests */}
        <View onLayout={(event) => onAnchorLayout('performance', event)}>
          <PerformanceCurveSection
            sportMode={sportMode}
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
            zoneCoverage={zoneCoverage}
            loadingActivities={loadingActivities}
            hasActivities={!!activities}
            dominantZone={dominantZone}
            zonesExpanded={sections.expanded('zones')}
            onZonesToggle={sections.onToggle('zones')}
            eftpTrend={eftpTrend}
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

        {/* Info section */}
        <View style={[styles.infoCard, isDark && styles.infoCardDark]}>
          <Text style={[styles.infoTitle, isDark && styles.infoTitleDark]}>
            {t('fitnessScreen.understandingMetrics')}
          </Text>

          <View style={styles.infoRow}>
            <View style={[styles.infoDot, { backgroundColor: colors.fitnessBlue }]} />
            <Text style={[styles.infoText, isDark && styles.infoTextDark]}>
              <Text style={[styles.infoHighlight, isDark && styles.infoHighlightDark]}>
                {t('metrics.fitness')}
              </Text>{' '}
              {t('fitnessScreen.fitnessDescription')}
            </Text>
          </View>

          <View style={styles.infoRow}>
            <View style={[styles.infoDot, { backgroundColor: colors.fatiguePurple }]} />
            <Text style={[styles.infoText, isDark && styles.infoTextDark]}>
              <Text style={[styles.infoHighlight, isDark && styles.infoHighlightDark]}>
                {t('metrics.fatigue')}
              </Text>{' '}
              {t('fitnessScreen.fatigueDescription')}
            </Text>
          </View>

          <View style={styles.infoRow}>
            <View style={[styles.infoDot, { backgroundColor: FORM_ZONE_COLORS.optimal }]} />
            <Text style={[styles.infoText, isDark && styles.infoTextDark]}>
              <Text style={[styles.infoHighlight, isDark && styles.infoHighlightDark]}>
                {t('metrics.form')}
              </Text>{' '}
              {t('fitnessScreen.formDescription')}
            </Text>
          </View>

          <View style={[styles.referencesSection, isDark && styles.referencesSectionDark]}>
            <Text style={[styles.referencesLabel, isDark && styles.referencesLabelDark]}>
              {t('fitnessScreen.learnMore')}
            </Text>
            <TouchableOpacity
              onPress={() => WebBrowser.openBrowserAsync('https://intervals.icu/fitness')}
              activeOpacity={0.7}
            >
              <Text style={[styles.infoLink, isDark && { color: darkColors.linkTeal }]}>
                {t('fitnessScreen.linkFitnessPage')}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() =>
                WebBrowser.openBrowserAsync(
                  'https://www.sciencetosport.com/monitoring-training-load/'
                )
              }
              activeOpacity={0.7}
            >
              <Text style={[styles.infoLink, isDark && { color: darkColors.linkTeal }]}>
                {t('fitnessScreen.linkTrainingLoad')}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() =>
                WebBrowser.openBrowserAsync(
                  'https://www.joefrielsblog.com/2015/12/managing-training-using-tsb.html'
                )
              }
              activeOpacity={0.7}
            >
              <Text style={[styles.infoLink, isDark && { color: darkColors.linkTeal }]}>
                {t('fitnessScreen.linkTSBManagement')}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>
    </ScreenSafeAreaView>
  );
}

const styles = StyleSheet.create({
  // Note: container, headerTitle, loadingContainer now use shared styles
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: layout.screenPadding,
    paddingVertical: spacing.sm,
  },
  headerSpinner: {
    marginLeft: spacing.sm,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: layout.screenPadding,
    paddingTop: spacing.sm,
    paddingBottom: layout.screenPadding + TAB_BAR_SAFE_PADDING,
  },
  infoCard: {
    backgroundColor: colors.surface,
    borderRadius: layout.borderRadius,
    padding: layout.cardPadding,
    marginBottom: spacing.md,
  },
  infoCardDark: {
    backgroundColor: darkColors.surface,
  },
  infoTitle: {
    ...typography.bodySmall,
    fontWeight: '600',
    color: colors.textPrimary,
    marginBottom: spacing.md,
  },
  infoTitleDark: {
    color: darkColors.textPrimary,
  },
  infoRow: {
    flexDirection: 'row',
    marginBottom: spacing.sm,
  },
  infoDot: {
    width: spacing.sm,
    height: spacing.sm,
    borderRadius: layout.borderRadiusXs,
    marginTop: spacing.xs,
    marginRight: spacing.xs,
  },
  infoText: {
    flex: 1,
    ...typography.caption,
    color: colors.textSecondary,
    lineHeight: 18,
  },
  infoTextDark: {
    color: darkColors.textSecondary,
  },
  infoHighlight: {
    fontWeight: '600',
  },
  infoHighlightDark: {
    color: darkColors.textPrimary,
  },
  referencesSection: {
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: opacity.overlay.light,
  },
  referencesSectionDark: {
    borderTopColor: opacity.overlayDark.medium,
  },
  referencesLabel: {
    ...typography.label,
    fontWeight: '600',
    color: colors.textSecondary,
    marginBottom: spacing.xs,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  referencesLabelDark: {
    color: darkColors.textSecondary,
  },
  infoLink: {
    ...typography.caption,
    color: colors.linkTeal,
    paddingVertical: spacing.xs,
  },
  skeletonContainer: {
    flex: 1,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    gap: spacing.md,
  },
});

export default withScreenBoundary(FitnessScreenContent, 'Fitness');

import React, { useState, useEffect, useRef } from 'react';
import { View, StyleSheet, TouchableOpacity, RefreshControl } from 'react-native';
import { ScrollView } from 'react-native-gesture-handler';
import { Text, ActivityIndicator } from 'react-native-paper';
import {
  ScreenSafeAreaView,
  TAB_BAR_SAFE_PADDING,
  ChartSkeleton,
  StatsPillSkeleton,
  ErrorStatePreset,
  ScreenErrorBoundary,
} from '@/shared/ui';
import { logScreenRender, logMemory } from '@/shared/debug/renderTimer';
import * as WebBrowser from 'expo-web-browser';
import { router, useLocalSearchParams } from 'expo-router';
import { useSharedValue } from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';
import {
  FitnessChartCard,
  PerformanceCurveSection,
  FitnessTrendSections,
  TimeRangeSelector,
  SportToggleSelector,
  FitnessHeaderStats,
  resolveThresholdPace,
} from '@/features/fitness';
import {
  useFitnessRefresh,
  useFitnessComputations,
  useFitnessScreenData,
  useStoredPaceTrend,
} from '@/features/fitness/hooks';
import { FORM_ZONE_COLORS, formZoneTextColor } from '@/features/fitness/lib/fitness';
import { timeRangeToDays, type TimeRange } from '@/features/wellness';
import { useTheme, useCollapsibleSections } from '@/shared/app';
import { useChartInteraction } from '@/shared/charts/useChartInteraction';
import { useSportPreference, type PrimarySport } from '@/features/fitness/stores';
import { colors, darkColors, spacing, layout, typography, opacity } from '@/theme';
import { createSharedStyles } from '@/styles';

import { DEFAULT_PERIOD } from '@/shared/app/period';
import { fitnessEntryFromParams } from '@/shared/app/fitnessEntry';

export default function FitnessScreen() {
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
  // that window rather than on its own default.
  const params = useLocalSearchParams<{ range?: string; date?: string }>();
  const { range: entryRange, date: entryDate } = fitnessEntryFromParams(params);
  const [timeRange, setTimeRange] = useState<TimeRange>(entryRange ?? DEFAULT_PERIOD);

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
  const {
    chartInteracting,
    selectedDate,
    selectedValues,
    setSelectedDate,
    setSelectedValues,
    handleInteractionChange,
    handleDateSelect,
  } = useChartInteraction(entryDate);

  // Shared value for instant crosshair sync between charts
  const sharedSelectedIdx = useSharedValue(-1);

  // The entry params are consumed once and cleared, the way the insights tab
  // clears `insightId`, so going back does not re-apply them.
  useEffect(() => {
    if (!entryRange && !entryDate) return;
    router.setParams({ range: undefined, date: undefined });
  }, [entryRange, entryDate]);

  // Reset selection when time range changes, but not on the first run when the
  // entry params pinned a day: that selection is the day the card was about.
  const entryApplied = useRef(false);
  React.useEffect(() => {
    if (entryDate && !entryApplied.current) {
      entryApplied.current = true;
      return;
    }
    sharedSelectedIdx.value = -1;
    setSelectedDate(null);
    setSelectedValues(null);
    // sharedSelectedIdx is a Reanimated SharedValue, whose identity never
    // changes, so listing it re-runs nothing that was not re-running already.
  }, [timeRange, entryDate, setSelectedDate, setSelectedValues, sharedSelectedIdx]);

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

  // Gather all screen data via consolidated hook (wellness, activities, zones, curves, bests)
  const {
    wellness,
    activities,
    powerZones,
    hrZones,
    eftpHistory,
    currentFTP,
    runSettings,
    runPaceCurve,
    swimPaceCurve,
    bestsEfforts,
    loadingActivities,
    loadingBests,
    bestsHeader,
    decouplingStreams,
    loadingStreams,
    isLoading,
    isFetching,
    isError,
    refetch,
  } = useFitnessScreenData({ timeRange, sportMode });

  const runLthr = runSettings?.lthr;
  // The curve is a download, so offline it is absent and the stored critical
  // speed behind it is the only reading the screen has.
  const storedRunPace = useStoredPaceTrend('Run');
  const storedSwimPace = useStoredPaceTrend('Swim');
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

  // Memoized derivations (FTP trend, dominant zone, decoupling, form zone, display values)
  const {
    ftpTrend,
    dominantZone,
    decouplingValue,
    displayValues,
    displayDate,
    formZone,
    rampRate,
  } = useFitnessComputations({
    wellness,
    sportMode,
    powerZones,
    hrZones,
    eftpHistory,
    decouplingStreams,
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
        </View>
        <View style={shared.loadingContainer}>
          <ErrorStatePreset message={t('fitnessScreen.failedToLoad')} onRetry={() => refetch()} />
        </View>
      </ScreenSafeAreaView>
    );
  }

  return (
    <ScreenErrorBoundary screenName="Fitness">
      <ScreenSafeAreaView style={shared.container} testID="fitness-screen">
        {/* Header */}
        <View style={styles.header}>
          <Text style={shared.screenTitle}>{t('fitnessScreen.title')}</Text>
          {/* Subtle loading indicator in header when fetching in background (not during pull-to-refresh) */}
          {isFetching && !isRefreshing && (
            <ActivityIndicator size="small" color={colors.primary} style={styles.headerSpinner} />
          )}
        </View>

        <ScrollView
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
            onTimeRangeChange={setTimeRange}
            isDark={isDark}
          />

          {/* Combined fitness charts card */}
          <FitnessChartCard
            wellness={wellness}
            activities={activities || []}
            selectedDate={selectedDate}
            sharedSelectedIdx={sharedSelectedIdx}
            onDateSelect={handleDateSelect}
            onInteractionChange={handleInteractionChange}
          />

          {/* Sport Toggle - compact pill selector */}
          <SportToggleSelector
            sportMode={sportMode}
            onSportModeChange={setSportMode}
            isDark={isDark}
          />

          {/* Performance curves + season bests */}
          <PerformanceCurveSection
            sportMode={sportMode}
            days={days}
            currentFTP={currentFTP}
            thresholdPace={thresholdPace}
            swimThresholdPace={swimThresholdPace}
            performanceExpanded={sections.expanded('performance')}
            onPerformanceToggle={(v) => sections.setExpanded('performance', v)}
            bestsExpanded={sections.expanded('bests')}
            onBestsToggle={(v) => sections.setExpanded('bests', v)}
            bestsEfforts={bestsEfforts}
            loadingBests={loadingBests}
            bestsHeader={bestsHeader}
          />

          {/* Zones, trends, thresholds, decoupling */}
          <FitnessTrendSections
            sportMode={sportMode}
            timeRange={timeRange}
            powerZones={powerZones}
            hrZones={hrZones}
            loadingActivities={loadingActivities}
            hasActivities={!!activities}
            dominantZone={dominantZone}
            zonesExpanded={sections.expanded('zones')}
            onZonesToggle={(v) => sections.setExpanded('zones', v)}
            eftpHistory={eftpHistory}
            currentFTP={currentFTP}
            ftpTrend={ftpTrend}
            trendsExpanded={sections.expanded('trends')}
            onTrendsToggle={(v) => sections.setExpanded('trends', v)}
            thresholdPace={thresholdPace}
            runLthr={runLthr}
            decouplingStreams={decouplingStreams}
            decouplingValue={decouplingValue}
            loadingStreams={loadingStreams}
            efficiencyExpanded={sections.expanded('efficiency')}
            onEfficiencyToggle={(v) => sections.setExpanded('efficiency', v)}
          />

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
                {t('fitnessScreen.formDescription')}{' '}
                <Text style={{ color: formZoneTextColor('optimal', isDark) }}>
                  {t('fitnessScreen.optimalZone')}
                </Text>{' '}
                {t('fitnessScreen.toBuildFitness')}{' '}
                <Text style={{ color: formZoneTextColor('fresh', isDark) }}>
                  {t('fitnessScreen.fresh')}
                </Text>{' '}
                {t('fitnessScreen.forRaces')}{' '}
                <Text style={{ color: formZoneTextColor('highRisk', isDark) }}>
                  {t('fitnessScreen.highRiskZone')}
                </Text>{' '}
                {t('fitnessScreen.toPreventOvertraining')}
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
                <Text style={styles.infoLink}>{t('fitnessScreen.linkFitnessPage')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() =>
                  WebBrowser.openBrowserAsync(
                    'https://www.sciencetosport.com/monitoring-training-load/'
                  )
                }
                activeOpacity={0.7}
              >
                <Text style={styles.infoLink}>{t('fitnessScreen.linkTrainingLoad')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() =>
                  WebBrowser.openBrowserAsync(
                    'https://www.joefrielsblog.com/2015/12/managing-training-using-tsb.html'
                  )
                }
                activeOpacity={0.7}
              >
                <Text style={styles.infoLink}>{t('fitnessScreen.linkTSBManagement')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </ScrollView>
      </ScreenSafeAreaView>
    </ScreenErrorBoundary>
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
    borderRadius: spacing.xs,
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
    color: colors.primary,
    paddingVertical: spacing.xs,
  },
  skeletonContainer: {
    flex: 1,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    gap: spacing.md,
  },
  loadingText: {
    ...typography.bodySmall,
    color: colors.textSecondary,
    marginTop: spacing.md,
  },
  loadingTextDark: {
    color: darkColors.textSecondary,
  },
});

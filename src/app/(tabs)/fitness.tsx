import React, { useState, useEffect, useRef } from 'react';
import { View, StyleSheet, TouchableOpacity, RefreshControl } from 'react-native';
import { ScrollView } from 'react-native-gesture-handler';
import { Text, ActivityIndicator } from 'react-native-paper';
import { ScreenSafeAreaView, TAB_BAR_SAFE_PADDING } from '@/components/ui';
import { logScreenRender, logMemory } from '@/lib/debug/renderTimer';
import * as WebBrowser from 'expo-web-browser';
import { useSharedValue } from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';
import { NetworkErrorState, ErrorStatePreset, ScreenErrorBoundary } from '@/components/ui';
import {
  FitnessChartCard,
  PerformanceCurveSection,
  FitnessTrendSections,
} from '@/components/fitness/sections';
import { TimeRangeSelector, SportToggleSelector, FitnessHeaderStats } from '@/components/fitness';
import {
  useTheme,
  useChartInteraction,
  useCollapsibleSections,
  useFitnessRefresh,
  useFitnessComputations,
  useFitnessScreenData,
  timeRangeToDays,
  FORM_ZONE_COLORS,
  FORM_ZONE_LABELS,
  type TimeRange,
} from '@/hooks';
import { useSportPreference, type PrimarySport } from '@/providers';
import { colors, darkColors, spacing, layout, typography, opacity } from '@/theme';
import { createSharedStyles } from '@/styles';

import { isNetworkError } from '@/lib/utils/errorHandler';

export default function FitnessScreen() {
  // Performance timing
  const perfEndRef = useRef<(() => void) | null>(null);
  perfEndRef.current = logScreenRender('FitnessScreen');
  useEffect(() => {
    perfEndRef.current?.();
  });

  const { t } = useTranslation();
  const { isDark } = useTheme();
  const shared = createSharedStyles(isDark);
  const [timeRange, setTimeRange] = useState<TimeRange>('3m');

  // Defer secondary charts by one frame to reduce simultaneous Metal shader compilation
  const [chartsReady, setChartsReady] = useState(false);
  useEffect(() => {
    logMemory('FitnessScreen:mount');
    requestAnimationFrame(() => setChartsReady(true));
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
  } = useChartInteraction();

  // Shared value for instant crosshair sync between charts
  const sharedSelectedIdx = useSharedValue(-1);

  // Reset selection when time range changes
  React.useEffect(() => {
    sharedSelectedIdx.value = -1;
    setSelectedDate(null);
    setSelectedValues(null);
    // Note: sharedSelectedIdx is a Reanimated SharedValue and should NOT be in deps
    // (it's intentionally outside the React render cycle)
  }, [timeRange, setSelectedDate, setSelectedValues]);

  const { primarySport } = useSportPreference();

  // Sport mode state - defaults to primary sport, can be toggled
  const [sportMode, setSportMode] = useState<PrimarySport>(() => primarySport);

  // Update sport mode when primary sport preference changes
  useEffect(() => {
    setSportMode(primarySport);
  }, [primarySport]);

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
    error,
    refetch,
  } = useFitnessScreenData({ timeRange, sportMode });

  const runLthr = runSettings?.lthr;
  const runMaxHr = runSettings?.max_hr;
  const thresholdPace = runPaceCurve?.criticalSpeed;
  const swimThresholdPace = swimPaceCurve?.criticalSpeed;

  // Memory profiling for crash investigation
  useEffect(() => {
    if (wellness) logMemory('FitnessScreen:wellnessLoaded');
  }, [wellness]);
  useEffect(() => {
    if (chartsReady) logMemory('FitnessScreen:chartsReady');
  }, [chartsReady]);

  // Handle pull-to-refresh — invalidate all fitness-related queries
  const { isRefreshing, onRefresh } = useFitnessRefresh(refetch);

  // Memoized derivations (FTP trend, dominant zone, decoupling, form zone, display values)
  const { ftpTrend, dominantZone, decouplingValue, displayValues, displayDate, formZone } =
    useFitnessComputations({
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
          <Text style={shared.headerTitle}>{t('fitnessScreen.title')}</Text>
        </View>
        <View style={shared.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={[styles.loadingText, isDark && styles.loadingTextDark]}>
            {t('fitnessScreen.loadingData')}
          </Text>
        </View>
      </ScreenSafeAreaView>
    );
  }

  if (isError || !wellness) {
    const networkError = isNetworkError(error);

    return (
      <ScreenSafeAreaView style={shared.container}>
        <View style={styles.header}>
          <Text style={shared.headerTitle}>{t('fitnessScreen.title')}</Text>
        </View>
        <View style={shared.loadingContainer}>
          {networkError ? (
            <NetworkErrorState onRetry={() => refetch()} />
          ) : (
            <ErrorStatePreset message={t('fitnessScreen.failedToLoad')} onRetry={() => refetch()} />
          )}
        </View>
      </ScreenSafeAreaView>
    );
  }

  return (
    <ScreenErrorBoundary screenName="Fitness">
      <ScreenSafeAreaView style={shared.container} testID="fitness-screen">
        {/* Header */}
        <View style={styles.header}>
          <Text style={shared.headerTitle}>{t('fitnessScreen.title')}</Text>
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
            chartsReady={chartsReady}
            selectedDate={selectedDate}
            sharedSelectedIdx={sharedSelectedIdx}
            formZone={formZone}
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
            runMaxHr={runMaxHr}
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
                <Text style={{ color: FORM_ZONE_COLORS.optimal }}>
                  {t('fitnessScreen.optimalZone')}
                </Text>{' '}
                {t('fitnessScreen.toBuildFitness')}{' '}
                <Text style={{ color: FORM_ZONE_COLORS.fresh }}>{t('fitnessScreen.fresh')}</Text>{' '}
                {t('fitnessScreen.forRaces')}{' '}
                <Text style={{ color: FORM_ZONE_COLORS.highRisk }}>
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
    marginTop: 5,
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
  loadingText: {
    ...typography.bodySmall,
    color: colors.textSecondary,
    marginTop: spacing.md,
  },
  loadingTextDark: {
    color: darkColors.textSecondary,
  },
});

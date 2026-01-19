import React, { useState, useCallback } from 'react';
import { View, ScrollView, StyleSheet, TouchableOpacity, RefreshControl } from 'react-native';
import { Text, IconButton, ActivityIndicator } from 'react-native-paper';
import { ScreenSafeAreaView } from '@/components/ui';
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useSharedValue } from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';
import { FitnessChart, FormZoneChart, ActivityDotsChart } from '@/components/fitness';
import { NetworkErrorState, ErrorStatePreset } from '@/components/ui';
import {
  useWellness,
  useActivities,
  useTheme,
  getFormZone,
  FORM_ZONE_COLORS,
  FORM_ZONE_LABELS,
  type TimeRange,
} from '@/hooks';
import { useNetwork } from '@/providers';
import { formatLocalDate, formatShortDateWithWeekday } from '@/lib';
import { colors, darkColors, spacing, layout, typography, opacity } from '@/theme';
import { createSharedStyles } from '@/styles';

const TIME_RANGES: { id: TimeRange; label: string }[] = [
  { id: '7d', label: '1W' },
  { id: '1m', label: '1M' },
  { id: '3m', label: '3M' },
  { id: '6m', label: '6M' },
  { id: '1y', label: '1Y' },
];

// Convert TimeRange to days for activity fetching
const timeRangeToDays = (range: TimeRange): number => {
  switch (range) {
    case '7d':
      return 7;
    case '1m':
      return 30;
    case '3m':
      return 90;
    case '6m':
      return 180;
    case '1y':
      return 365;
    default:
      return 90;
  }
};

export default function FitnessScreen() {
  const { t } = useTranslation();
  const { isDark, colors: themeColors } = useTheme();
  const shared = createSharedStyles(isDark);
  const [timeRange, setTimeRange] = useState<TimeRange>('3m');
  const [chartInteracting, setChartInteracting] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedValues, setSelectedValues] = useState<{
    fitness: number;
    fatigue: number;
    form: number;
  } | null>(null);

  // Shared value for instant crosshair sync between charts
  const sharedSelectedIdx = useSharedValue(-1);

  // Reset selection when time range changes
  React.useEffect(() => {
    sharedSelectedIdx.value = -1;
    setSelectedDate(null);
    setSelectedValues(null);
    // Note: sharedSelectedIdx is a Reanimated SharedValue and should NOT be in deps
    // (it's intentionally outside the React render cycle)
  }, [timeRange]);

  const { data: wellness, isLoading, isFetching, isError, error, refetch } = useWellness(timeRange);
  const { isOnline } = useNetwork();

  // Fetch activities for the selected time range
  const { data: activities } = useActivities({
    days: timeRangeToDays(timeRange),
  });

  // Background sync: prefetch 1 year of activities on first load for cache
  useActivities({ days: 365 });

  // Handle chart interaction state changes
  const handleInteractionChange = useCallback((isInteracting: boolean) => {
    setChartInteracting(isInteracting);
  }, []);

  // Handle date selection from charts
  const handleDateSelect = useCallback(
    (date: string | null, values: { fitness: number; fatigue: number; form: number } | null) => {
      setSelectedDate(date);
      setSelectedValues(values);
    },
    []
  );

  // Handle pull-to-refresh
  const onRefresh = useCallback(async () => {
    setIsRefreshing(true);
    await refetch();
    setIsRefreshing(false);
  }, [refetch]);

  // Get current (latest) values for display when not selecting
  const getCurrentValues = () => {
    if (!wellness || wellness.length === 0) return null;
    const sorted = [...wellness].sort((a, b) => b.id.localeCompare(a.id));
    const latest = sorted[0];
    const fitnessRaw = latest.ctl ?? latest.ctlLoad ?? 0;
    const fatigueRaw = latest.atl ?? latest.atlLoad ?? 0;
    // Use rounded values for form calculation to match intervals.icu display
    const fitness = Math.round(fitnessRaw);
    const fatigue = Math.round(fatigueRaw);
    return { fitness, fatigue, form: fitness - fatigue, date: latest.id };
  };

  const currentValues = getCurrentValues();
  const displayValues = selectedValues || currentValues;
  const displayDate = selectedDate || currentValues?.date;
  const formZone = displayValues ? getFormZone(displayValues.form) : null;

  // Only show full loading on initial load (no data yet)
  if (isLoading && !wellness) {
    return (
      <ScreenSafeAreaView style={shared.container}>
        <View style={styles.header}>
          <IconButton
            icon="arrow-left"
            iconColor={themeColors.text}
            onPress={() => router.back()}
          />
          <Text style={shared.headerTitle}>{t('fitnessScreen.title')}</Text>
          <View style={{ width: 48 }} />
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
    // Check if this is a network error
    const axiosError = error as { code?: string };
    const isNetworkError =
      axiosError?.code === 'ERR_NETWORK' ||
      axiosError?.code === 'ECONNABORTED' ||
      axiosError?.code === 'ETIMEDOUT';

    return (
      <ScreenSafeAreaView style={shared.container}>
        <View style={styles.header}>
          <IconButton
            icon="arrow-left"
            iconColor={themeColors.text}
            onPress={() => router.back()}
          />
          <Text style={shared.headerTitle}>{t('fitnessScreen.title')}</Text>
          <View style={{ width: 48 }} />
        </View>
        <View style={shared.loadingContainer}>
          {isNetworkError ? (
            <NetworkErrorState onRetry={() => refetch()} />
          ) : (
            <ErrorStatePreset message={t('fitnessScreen.failedToLoad')} onRetry={() => refetch()} />
          )}
        </View>
      </ScreenSafeAreaView>
    );
  }

  return (
    <ScreenSafeAreaView style={shared.container} testID="fitness-screen">
      {/* Header */}
      <View style={styles.header}>
        <IconButton icon="arrow-left" iconColor={themeColors.text} onPress={() => router.back()} />
        <View style={styles.headerTitleRow}>
          <Text style={shared.headerTitle}>{t('fitnessScreen.title')}</Text>
        </View>
        {/* Subtle loading indicator in header when fetching in background (not during pull-to-refresh) */}
        <View style={{ width: 48, alignItems: 'center' }}>
          {isFetching && !isRefreshing && <ActivityIndicator size="small" color={colors.primary} />}
        </View>
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        scrollEnabled={!chartInteracting}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={isOnline ? onRefresh : undefined}
            enabled={isOnline}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
      >
        {/* Current stats card */}
        <View style={[styles.statsCard, isDark && styles.statsCardDark]}>
          <Text style={[styles.statsDate, isDark && styles.statsDateDark]}>
            {displayDate ? formatDisplayDate(displayDate) : t('fitnessScreen.current')}
          </Text>
          <View style={styles.statsRow}>
            <View style={styles.statItem}>
              <Text style={[styles.statLabel, isDark && styles.statLabelDark]}>
                {t('metrics.fitness')}
              </Text>
              <Text style={[styles.statValue, { color: colors.fitnessBlue }]}>
                {displayValues ? Math.round(displayValues.fitness) : '-'}
              </Text>
              <Text style={[styles.statSubtext, isDark && styles.statSubtextDark]}>
                {t('fitnessScreen.ctl')}
              </Text>
            </View>
            <View style={styles.statItem}>
              <Text style={[styles.statLabel, isDark && styles.statLabelDark]}>
                {t('metrics.fatigue')}
              </Text>
              <Text style={[styles.statValue, { color: colors.fatiguePurple }]}>
                {displayValues ? Math.round(displayValues.fatigue) : '-'}
              </Text>
              <Text style={[styles.statSubtext, isDark && styles.statSubtextDark]}>
                {t('fitnessScreen.atl')}
              </Text>
            </View>
            <View style={styles.statItem}>
              <Text style={[styles.statLabel, isDark && styles.statLabelDark]}>
                {t('metrics.form')}
              </Text>
              <Text
                style={[
                  styles.statValue,
                  {
                    color: formZone ? FORM_ZONE_COLORS[formZone] : themeColors.text,
                  },
                ]}
              >
                {displayValues
                  ? `${displayValues.form > 0 ? '+' : ''}${Math.round(displayValues.form)}`
                  : '-'}
              </Text>
              <Text
                style={[
                  styles.statSubtext,
                  {
                    color: formZone ? FORM_ZONE_COLORS[formZone] : themeColors.textSecondary,
                  },
                ]}
              >
                {formZone ? FORM_ZONE_LABELS[formZone] : t('fitnessScreen.tsb')}
              </Text>
            </View>
          </View>
        </View>

        {/* Time range selector */}
        <View style={styles.timeRangeContainer}>
          {TIME_RANGES.map((range) => (
            <TouchableOpacity
              key={range.id}
              style={[
                styles.timeRangeButton,
                isDark && styles.timeRangeButtonDark,
                timeRange === range.id && styles.timeRangeButtonActive,
              ]}
              onPress={() => setTimeRange(range.id)}
              activeOpacity={0.7}
            >
              <Text
                style={[
                  styles.timeRangeText,
                  isDark && styles.timeRangeTextDark,
                  timeRange === range.id && styles.timeRangeTextActive,
                ]}
              >
                {range.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Combined fitness charts card */}
        <View style={[styles.chartCard, isDark && styles.chartCardDark]}>
          {/* Fitness/Fatigue chart */}
          <Text style={[styles.chartTitle, isDark && styles.chartTitleDark]}>
            {t('fitnessScreen.fitnessAndFatigue')}
          </Text>
          <FitnessChart
            data={wellness}
            height={220}
            selectedDate={selectedDate}
            sharedSelectedIdx={sharedSelectedIdx}
            onDateSelect={handleDateSelect}
            onInteractionChange={handleInteractionChange}
          />

          {/* Activity dots chart */}
          <View style={[styles.dotsSection, isDark && styles.dotsSectionDark]}>
            <ActivityDotsChart
              data={wellness}
              activities={activities || []}
              height={32}
              selectedDate={selectedDate}
              sharedSelectedIdx={sharedSelectedIdx}
              onDateSelect={handleDateSelect}
              onInteractionChange={handleInteractionChange}
            />
          </View>

          {/* Form zone chart */}
          <View style={[styles.formSection, isDark && styles.formSectionDark]}>
            <Text style={[styles.chartTitle, isDark && styles.chartTitleDark]}>
              {t('metrics.form')}
            </Text>
            <FormZoneChart
              data={wellness}
              height={140}
              selectedDate={selectedDate}
              sharedSelectedIdx={sharedSelectedIdx}
              onDateSelect={handleDateSelect}
              onInteractionChange={handleInteractionChange}
            />
          </View>
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
              <Text style={styles.infoLink}>intervals.icu Fitness Page</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() =>
                WebBrowser.openBrowserAsync(
                  'https://www.sciencetosport.com/monitoring-training-load/'
                )
              }
              activeOpacity={0.7}
            >
              <Text style={styles.infoLink}>Monitoring Training Load (Science2Sport)</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() =>
                WebBrowser.openBrowserAsync(
                  'https://www.joefrielsblog.com/2015/12/managing-training-using-tsb.html'
                )
              }
              activeOpacity={0.7}
            >
              <Text style={styles.infoLink}>Managing Training Using TSB (Joe Friel)</Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>
    </ScreenSafeAreaView>
  );
}

function formatDisplayDate(dateStr: string): string {
  return formatShortDateWithWeekday(dateStr);
}

const styles = StyleSheet.create({
  // Note: container, headerTitle, loadingContainer now use shared styles
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerTitleRow: {
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
  statsCard: {
    backgroundColor: colors.surface,
    borderRadius: layout.borderRadius,
    padding: layout.cardPadding,
    marginBottom: spacing.md,
  },
  statsCardDark: {
    backgroundColor: darkColors.surface,
  },
  statsDate: {
    ...typography.caption,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  statsDateDark: {
    color: darkColors.textSecondary,
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  statItem: {
    alignItems: 'center',
  },
  statLabel: {
    ...typography.label,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  statLabelDark: {
    color: darkColors.textSecondary,
  },
  statValue: {
    fontSize: 28,
    fontWeight: '700',
  },
  statSubtext: {
    ...typography.micro,
    color: colors.textSecondary,
    marginTop: 2,
  },
  statSubtextDark: {
    color: darkColors.textSecondary,
  },
  timeRangeContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: spacing.xs,
    marginBottom: spacing.md,
  },
  timeRangeButton: {
    paddingHorizontal: spacing.sm + 4,
    paddingVertical: spacing.xs,
    borderRadius: 14,
    backgroundColor: opacity.overlay.light,
  },
  timeRangeButtonDark: {
    backgroundColor: opacity.overlayDark.medium,
  },
  timeRangeButtonActive: {
    backgroundColor: colors.primary,
  },
  timeRangeText: {
    ...typography.caption,
    fontWeight: '500',
    color: colors.textSecondary,
  },
  timeRangeTextDark: {
    color: darkColors.textSecondary,
  },
  timeRangeTextActive: {
    color: colors.textOnDark,
  },
  chartCard: {
    backgroundColor: colors.surface,
    borderRadius: layout.borderRadius,
    padding: layout.cardPadding,
    marginBottom: spacing.md,
  },
  chartCardDark: {
    backgroundColor: darkColors.surface,
  },
  dotsSection: {
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: opacity.overlay.medium,
  },
  dotsSectionDark: {
    borderTopColor: opacity.overlayDark.medium,
  },
  formSection: {
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: opacity.overlay.medium,
  },
  formSectionDark: {
    borderTopColor: opacity.overlayDark.medium,
  },
  chartTitle: {
    ...typography.bodySmall,
    fontWeight: '600',
    color: colors.textPrimary,
    marginBottom: spacing.sm,
  },
  chartTitleDark: {
    color: darkColors.textPrimary,
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

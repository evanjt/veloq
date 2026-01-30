import React, { useMemo, useState, useCallback, useRef, useEffect } from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  RefreshControl,
  Modal,
  Pressable,
} from 'react-native';
import { Text, IconButton, ActivityIndicator } from 'react-native-paper';
import { ScreenSafeAreaView, TAB_BAR_SAFE_PADDING } from '@/components/ui';
import { logScreenRender } from '@/lib/debug/renderTimer';
import { useTranslation } from 'react-i18next';
import { WeeklySummary, ActivityHeatmap, SeasonComparison } from '@/components/stats';
import { WellnessDashboard, WellnessTrendsChart } from '@/components/wellness';
import { useActivities, useWellness, useTheme, type TimeRange } from '@/hooks';
import { colors, darkColors, spacing, layout, typography, opacity } from '@/theme';
import { createSharedStyles } from '@/styles';
import { SMOOTHING_PRESETS, getSmoothingDescription, type SmoothingWindow } from '@/lib';

const TIME_RANGES: { id: TimeRange; label: string }[] = [
  { id: '7d', label: '1W' },
  { id: '1m', label: '1M' },
  { id: '3m', label: '3M' },
  { id: '6m', label: '6M' },
  { id: '1y', label: '1Y' },
];

export default function HealthScreen() {
  // Performance timing
  const perfEndRef = useRef<(() => void) | null>(null);
  perfEndRef.current = logScreenRender('HealthScreen');
  useEffect(() => {
    perfEndRef.current?.();
  });

  const { t } = useTranslation();
  const { isDark, colors: themeColors } = useTheme();
  const shared = createSharedStyles(isDark);

  // Refresh state for pull-to-refresh
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Wellness state
  const [timeRange, setTimeRange] = useState<TimeRange>('1m');
  const [smoothingWindow, setSmoothingWindow] = useState<SmoothingWindow>('auto');
  const [showSmoothingModal, setShowSmoothingModal] = useState(false);

  // Fetch activities for rolling year comparison (last 24 months)
  const today = new Date();
  const twoYearsAgo = new Date(today);
  twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);
  const {
    data: activities,
    isLoading: activitiesLoading,
    isFetching: activitiesFetching,
    refetch: refetchActivities,
  } = useActivities({
    oldest: twoYearsAgo.toISOString().split('T')[0],
    newest: today.toISOString().split('T')[0],
    includeStats: true,
  });

  // Fetch wellness data
  const {
    data: wellness,
    isLoading: wellnessLoading,
    isFetching: wellnessFetching,
    refetch: refetchWellness,
  } = useWellness(timeRange);

  // Combined loading states
  const isLoading = activitiesLoading || wellnessLoading;
  const isFetching = activitiesFetching || wellnessFetching;

  // Handle pull-to-refresh
  const onRefresh = useCallback(async () => {
    setIsRefreshing(true);
    await Promise.all([refetchActivities(), refetchWellness()]);
    setIsRefreshing(false);
  }, [refetchActivities, refetchWellness]);

  // Split activities by rolling year for season comparison
  const { currentYearActivities, previousYearActivities } = useMemo(() => {
    if (!activities) return { currentYearActivities: [], previousYearActivities: [] };

    const now = new Date();
    const oneYearAgo = new Date(now);
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
    const twoYearsAgoDate = new Date(now);
    twoYearsAgoDate.setFullYear(twoYearsAgoDate.getFullYear() - 2);

    const current: typeof activities = [];
    const previous: typeof activities = [];

    for (const activity of activities) {
      const activityDate = new Date(activity.start_date_local);
      if (activityDate >= oneYearAgo && activityDate <= now) {
        current.push(activity);
      } else if (activityDate >= twoYearsAgoDate && activityDate < oneYearAgo) {
        previous.push(activity);
      }
    }

    return { currentYearActivities: current, previousYearActivities: previous };
  }, [activities]);

  return (
    <ScreenSafeAreaView style={shared.container} testID="health-screen">
      <View style={styles.header}>
        <View style={{ width: 48 }} />
        <Text style={shared.headerTitle}>{t('healthScreen.title')}</Text>
        {/* Subtle loading indicator in header when fetching in background */}
        <View style={{ width: 48, alignItems: 'center' }}>
          {isFetching && !isRefreshing && <ActivityIndicator size="small" color={colors.primary} />}
        </View>
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
      >
        {/* Wellness Dashboard - Today's trends */}
        <View style={[styles.card, isDark && styles.cardDark]}>
          {wellnessLoading && !wellness ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="small" color={colors.primary} />
            </View>
          ) : (
            <WellnessDashboard data={wellness} />
          )}
        </View>

        {/* Time range selector with smoothing config */}
        <View style={styles.timeRangeRow}>
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
          <TouchableOpacity
            style={[styles.smoothingButton, isDark && styles.smoothingButtonDark]}
            onPress={() => setShowSmoothingModal(true)}
            activeOpacity={0.7}
          >
            <IconButton
              icon="chart-bell-curve-cumulative"
              iconColor={smoothingWindow !== 'auto' ? colors.primary : themeColors.textSecondary}
              size={18}
              style={{ margin: 0 }}
            />
          </TouchableOpacity>
        </View>

        {/* Wellness Trends Chart */}
        <View style={[styles.card, isDark && styles.cardDark]}>
          <View style={styles.chartHeader}>
            <Text style={[styles.sectionTitle, isDark && styles.sectionTitleDark]}>
              {t('wellnessScreen.trends')}
            </Text>
            <Text style={[styles.smoothingLabel, isDark && styles.smoothingLabelDark]}>
              {getSmoothingDescription(smoothingWindow, timeRange)}
            </Text>
          </View>
          {wellnessLoading && !wellness ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="small" color={colors.primary} />
            </View>
          ) : (
            <WellnessTrendsChart
              data={wellness}
              height={200}
              timeRange={timeRange}
              smoothingWindow={smoothingWindow}
            />
          )}
        </View>

        {/* Summary with time range selector */}
        <View style={[styles.card, isDark && styles.cardDark]}>
          {activitiesLoading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="small" color={colors.primary} />
            </View>
          ) : (
            <WeeklySummary activities={activities} />
          )}
        </View>

        {/* Activity Heatmap - using real activities data */}
        <View style={[styles.card, isDark && styles.cardDark]}>
          {activitiesLoading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="small" color={colors.primary} />
            </View>
          ) : (
            <ActivityHeatmap activities={activities} />
          )}
        </View>

        {/* Season Comparison */}
        <View style={[styles.card, isDark && styles.cardDark]}>
          {activitiesLoading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="small" color={colors.primary} />
            </View>
          ) : (
            <SeasonComparison
              height={180}
              currentYearActivities={currentYearActivities}
              previousYearActivities={previousYearActivities}
            />
          )}
        </View>
      </ScrollView>

      {/* Smoothing Config Modal */}
      <Modal
        visible={showSmoothingModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowSmoothingModal(false)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setShowSmoothingModal(false)}>
          <View style={[styles.modalContent, isDark && styles.modalContentDark]}>
            <Text style={[styles.modalTitle, isDark && styles.modalTitleDark]}>
              {t('wellness.smoothingTitle' as never)}
            </Text>
            <Text style={[styles.modalDescription, isDark && styles.modalDescriptionDark]}>
              {t('wellness.smoothingDescription' as never)}
            </Text>
            <View style={styles.smoothingOptions}>
              {SMOOTHING_PRESETS.map((preset) => (
                <TouchableOpacity
                  key={String(preset.value)}
                  style={[
                    styles.smoothingOption,
                    isDark && styles.smoothingOptionDark,
                    smoothingWindow === preset.value && styles.smoothingOptionActive,
                  ]}
                  onPress={() => {
                    setSmoothingWindow(preset.value);
                    setShowSmoothingModal(false);
                  }}
                  activeOpacity={0.7}
                >
                  <Text
                    style={[
                      styles.smoothingOptionText,
                      isDark && styles.smoothingOptionTextDark,
                      smoothingWindow === preset.value && styles.smoothingOptionTextActive,
                    ]}
                  >
                    {preset.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={[styles.modalHint, isDark && styles.modalHintDark]}>
              {t('wellness.smoothingHint' as never)}
            </Text>
          </View>
        </Pressable>
      </Modal>
    </ScreenSafeAreaView>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: layout.screenPadding,
    paddingTop: spacing.sm,
    paddingBottom: layout.screenPadding + TAB_BAR_SAFE_PADDING,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: layout.borderRadius,
    padding: layout.cardPadding,
    marginBottom: spacing.md,
  },
  cardDark: {
    backgroundColor: darkColors.surface,
  },
  loadingContainer: {
    padding: spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionTitle: {
    ...typography.body,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  sectionTitleDark: {
    color: darkColors.textPrimary,
  },
  chartHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  smoothingLabel: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  smoothingLabelDark: {
    color: darkColors.textSecondary,
  },
  timeRangeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
    gap: spacing.sm,
  },
  timeRangeContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.xs,
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
  smoothingButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: opacity.overlay.light,
    justifyContent: 'center',
    alignItems: 'center',
  },
  smoothingButtonDark: {
    backgroundColor: opacity.overlayDark.medium,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: opacity.overlay.full,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.lg,
  },
  modalContent: {
    backgroundColor: colors.surface,
    borderRadius: layout.borderRadius + 4,
    padding: spacing.lg,
    width: '100%',
    maxWidth: 320,
  },
  modalContentDark: {
    backgroundColor: darkColors.surface,
  },
  modalTitle: {
    ...typography.cardTitle,
    color: colors.textPrimary,
    textAlign: 'center',
    marginBottom: spacing.xs,
  },
  modalTitleDark: {
    color: darkColors.textPrimary,
  },
  modalDescription: {
    ...typography.bodySmall,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.md,
  },
  modalDescriptionDark: {
    color: darkColors.textSecondary,
  },
  smoothingOptions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: spacing.xs,
    marginBottom: spacing.md,
  },
  smoothingOption: {
    paddingHorizontal: spacing.sm + 4,
    paddingVertical: spacing.xs + 2,
    borderRadius: 14,
    backgroundColor: opacity.overlay.light,
  },
  smoothingOptionDark: {
    backgroundColor: opacity.overlayDark.medium,
  },
  smoothingOptionActive: {
    backgroundColor: colors.primary,
  },
  smoothingOptionText: {
    ...typography.caption,
    fontWeight: '500',
    color: colors.textSecondary,
  },
  smoothingOptionTextDark: {
    color: darkColors.textSecondary,
  },
  smoothingOptionTextActive: {
    color: colors.textOnDark,
  },
  modalHint: {
    ...typography.caption,
    color: colors.textSecondary,
    textAlign: 'center',
    fontStyle: 'italic',
  },
  modalHintDark: {
    color: darkColors.textSecondary,
  },
});

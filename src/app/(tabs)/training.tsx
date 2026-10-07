import { useTabFirstFrame } from '@/shared/debug/tabSwitchTiming';
import React, { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  RefreshControl,
  Modal,
  Pressable,
} from 'react-native';
import { Text, ActivityIndicator } from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import {
  ScreenSafeAreaView,
  ErrorStatePreset,
  TAB_BAR_SAFE_PADDING,
  pressable,
  pressRipple,
  Shimmer,
} from '@/shared/ui';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { WeeklySummary, ActivityHeatmap, SeasonComparison } from '@/features/stats';
import type { ActivityHeatmapHandle } from '@/features/stats';
import { WellnessTrendsChart } from '@/features/wellness';
import { useAthleteSummary } from '@/features/fitness';
import { useWellness, type TimeRange } from '@/features/wellness';
import { useTheme } from '@/shared/app';
import { colors, darkColors, spacing, layout, typography, opacity } from '@/theme';
import { createSharedStyles } from '@/styles';
import {
  SMOOTHING_PRESETS,
  getSmoothingDescription,
  getSmoothingPresetLabel,
  type SmoothingWindow,
} from '@/shared/math/smoothing';
import { logScreenRender } from '@/shared/debug/renderTimer';

import { queryKeys } from '@/shared/query/queryKeys';
import { requestSyncRefresh } from '@/shared/native/syncRefresh';
import { TIME_RANGES } from '@/shared/app/constants';
import { DEFAULT_PERIOD } from '@/shared/app/period';
import { useLocalSearchParams } from 'expo-router';
import {
  TRAINING_CHART_CARD,
  trainingEntryFromParams,
  type TrainingChart,
} from '@/shared/app/trainingEntry';
import { useRevealChart } from '@/shared/app/useRevealChart';
import { withScreenBoundary } from '@/shared/ui/withScreenBoundary';

const trainingChartCard = (chart: TrainingChart) => TRAINING_CHART_CARD[chart];

function HealthScreenContent() {
  useTabFirstFrame('/training');
  const perfEnd = logScreenRender('HealthScreen');
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { isDark, colors: themeColors } = useTheme();
  const shared = useMemo(() => createSharedStyles(isDark), [isDark]);

  // Log render time (JS phase only)

  useEffect(() => {
    perfEnd();
  });

  // Defer below-fold cards across two frames to spread Skia canvas initialisation.
  // Frame 0: ActivityHeatmap (Skia Picture, single draw call) + WellnessTrendsChart (Skia).
  // Frame 1: WeeklySummary (pure RN, cheap).
  // Frame 2: SeasonComparison (Skia canvas).
  const [belowFoldReady, setBelowFoldReady] = useState(false);
  const [chartsReady, setChartsReady] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      setBelowFoldReady(true);
      requestAnimationFrame(() => setChartsReady(true));
    });
    return () => cancelAnimationFrame(id);
  }, []);

  // A metric linked here names its chart. The weekly card mounts a frame late,
  // so the scroll waits for its layout rather than for this screen's.
  const { chart: entryChart } = trainingEntryFromParams(useLocalSearchParams<{ chart?: string }>());
  const { scrollRef, onAnchorLayout, onScrollBeginDrag } = useRevealChart(
    entryChart,
    trainingChartCard
  );

  // Refresh state for pull-to-refresh
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Wellness state
  const [timeRange, setTimeRange] = useState<TimeRange>(DEFAULT_PERIOD);
  const [smoothingWindow, setSmoothingWindow] = useState<SmoothingWindow>('auto');
  const [showSmoothingModal, setShowSmoothingModal] = useState(false);

  // Cross-chart scrubbing: the scrubbed day lives in the heatmap that draws it.
  // Held here it re-rendered the whole tab per day the gesture crossed, up to
  // 365 of them in one swipe.
  const heatmap = useRef<ActivityHeatmapHandle>(null);
  const handleDateSelect = useCallback((date: string | null) => {
    heatmap.current?.setHighlight(date);
  }, []);

  // Fetch wellness data
  const {
    data: wellness,
    isLoading: wellnessLoading,
    isFetching: wellnessFetching,
    isError: isWellnessError,
    refetch: refetchWellness,
  } = useWellness(timeRange);

  // Fetch athlete summary for WeeklySummary (lifted from child component)
  const {
    data: summaryData,
    isLoading: summaryLoading,
    error: summaryError,
  } = useAthleteSummary(4);

  // Combined loading states. Every card on this tab now reads its own engine
  // aggregate, so the tab's own fetching state is the wellness one.
  const isFetching = wellnessFetching;

  // Handle pull-to-refresh - invalidate all training-related queries
  const onRefresh = useCallback(async () => {
    setIsRefreshing(true);
    requestSyncRefresh();
    await Promise.all([
      refetchWellness(),
      queryClient.invalidateQueries({ queryKey: queryKeys.athleteSummary.all }),
      queryClient.invalidateQueries({ queryKey: queryKeys.stats.all }),
    ]);
    setIsRefreshing(false);
  }, [refetchWellness, queryClient]);

  // Wellness is the one read that replaces the tab. The engine aggregates name
  // their own failure inside the card that reads them.
  if (isWellnessError) {
    return (
      <ScreenSafeAreaView style={shared.container} testID="training-screen">
        <ErrorStatePreset onRetry={refetchWellness} />
      </ScreenSafeAreaView>
    );
  }

  return (
    <ScreenSafeAreaView style={shared.container} testID="training-screen">
      <View style={styles.header} testID="training-header">
        <Text style={shared.screenTitle}>{t('healthScreen.title')}</Text>
        {isFetching && !isRefreshing && (
          <ActivityIndicator size="small" color={colors.primary} style={styles.headerSpinner} />
        )}
      </View>

      <ScrollView
        ref={scrollRef}
        onScrollBeginDrag={onScrollBeginDrag}
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
        {/* Activity Heatmap - promoted to top (Skia Picture, lightweight) */}
        <View style={[styles.card, isDark && styles.cardDark]}>
          <ActivityHeatmap ref={heatmap} />
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
                  {t(range.labelKey as never)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <TouchableOpacity
            style={[
              styles.smoothingButton,
              isDark && styles.smoothingButtonDark,
              smoothingWindow !== 'auto' && styles.smoothingButtonActive,
            ]}
            onPress={() => setShowSmoothingModal(true)}
            activeOpacity={0.7}
          >
            <MaterialCommunityIcons
              name="chart-bell-curve-cumulative"
              size={18}
              color={smoothingWindow !== 'auto' ? colors.textOnPrimary : themeColors.textSecondary}
            />
          </TouchableOpacity>
        </View>

        {/* Wellness Trends Chart */}
        <View
          testID="wellness-trends-chart"
          onLayout={(event) => onAnchorLayout('wellness', event)}
          style={[styles.card, isDark && styles.cardDark]}
        >
          <View style={styles.chartHeader}>
            <Text style={[styles.sectionTitle, isDark && styles.sectionTitleDark]}>
              {t('wellnessScreen.trends')}
            </Text>
            <Text style={[styles.smoothingLabel, isDark && styles.smoothingLabelDark]}>
              {getSmoothingDescription(smoothingWindow, timeRange, t as never)}
            </Text>
          </View>
          {wellnessLoading && !wellness ? (
            <Shimmer width="100%" height={200} borderRadius={layout.borderRadius} />
          ) : (
            <WellnessTrendsChart
              data={wellness}
              height={200}
              timeRange={timeRange}
              smoothingWindow={smoothingWindow}
              onDateSelect={handleDateSelect}
            />
          )}
        </View>

        {/* Below-fold cards - frame 1: WeeklySummary (pure RN).
              Always mount once belowFoldReady - the component renders its own
              empty/loading states and the testID must be present for automated
              tests to find the widget during data load. */}
        {belowFoldReady && (
          <View
            onLayout={(event) => onAnchorLayout('week', event)}
            style={[styles.card, isDark && styles.cardDark]}
          >
            <WeeklySummary
              summaryData={summaryData}
              summaryLoading={summaryLoading}
              summaryError={summaryError}
            />
          </View>
        )}

        {/* Below-fold Skia card - frame 2: SeasonComparison */}
        {chartsReady && (
          <View style={[styles.card, isDark && styles.cardDark]}>
            <SeasonComparison height={180} />
          </View>
        )}
      </ScrollView>

      {/* Smoothing Config Modal - only mount children when visible */}
      {showSmoothingModal && (
        <Modal
          visible
          transparent
          animationType="fade"
          onRequestClose={() => setShowSmoothingModal(false)}
        >
          <Pressable
            style={pressable(styles.modalOverlay)}
            android_ripple={pressRipple}
            onPress={() => setShowSmoothingModal(false)}
          >
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
                      {getSmoothingPresetLabel(preset.value, t as never)}
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
      )}
    </ScreenSafeAreaView>
  );
}

const styles = StyleSheet.create({
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
  card: {
    backgroundColor: colors.surface,
    borderRadius: layout.borderRadius,
    padding: layout.cardPadding,
    marginBottom: spacing.md,
  },
  cardDark: {
    backgroundColor: darkColors.surface,
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
    paddingHorizontal: spacing.smPlus,
    paddingVertical: spacing.xs,
    borderRadius: layout.borderRadius,
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
    color: colors.textOnPrimary,
  },
  smoothingButton: {
    paddingHorizontal: spacing.smPlus,
    paddingVertical: spacing.xs,
    borderRadius: layout.borderRadius,
    backgroundColor: opacity.overlay.light,
    justifyContent: 'center',
    alignItems: 'center',
  },
  smoothingButtonDark: {
    backgroundColor: opacity.overlayDark.medium,
  },
  smoothingButtonActive: {
    backgroundColor: colors.primary,
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
    paddingHorizontal: spacing.smPlus,
    paddingVertical: spacing.xsPlus,
    borderRadius: layout.borderRadius,
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
    color: colors.textOnPrimary,
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

export default withScreenBoundary(HealthScreenContent, 'Training');

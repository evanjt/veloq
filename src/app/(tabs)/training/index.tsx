import { useTabFirstFrame } from '@/shared/debug/tabSwitchTiming';
import React, { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import {
  Card,
  CardHeader,
  ErrorState,
  IconButton,
  ScreenSafeAreaView,
  ScreenScrollView,
  Shimmer,
  Spinner,
  ToggleButton,
} from '@/shared/ui';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { WeeklySummary, ActivityHeatmap, SeasonComparison } from '@/features/stats';
import type { ActivityHeatmapHandle } from '@/features/stats';
import { WellnessTrendsChart } from '@/features/wellness';
import { useWellness, useWellnessCoverage, type TimeRange } from '@/features/wellness';
import { useTheme } from '@/shared/app';
import { colors, darkColors, iconSize, layout, spacing, typography } from '@/theme';
import { createSharedStyles } from '@/styles';
import { getSmoothingDescription, type SmoothingWindow } from '@/shared/math/smoothing';
import { logScreenRender } from '@/shared/debug/renderTimer';

import { queryKeys } from '@/shared/query/queryKeys';
import { useSyncRefreshNotice } from '@/shared/native/useSyncRefreshNotice';
import { TIME_RANGES } from '@/shared/app/constants';
import { DEFAULT_PERIOD } from '@/shared/app/period';
import { Stack, useLocalSearchParams } from 'expo-router';
import {
  TRAINING_CHART_CARD,
  trainingEntryFromParams,
  type TrainingChart,
} from '@/shared/app/trainingEntry';
import { useRevealChart } from '@/shared/app/useRevealChart';
import { useSheetOpener } from '@/shared/app/sheetRequest';
import type { SmoothingSheetInput } from '@/app/sheets/smoothing';
import { withScreenBoundary } from '@/shared/ui/withScreenBoundary';
import { useScrollToTopOnReselect } from '@/shared/ui/tabReselect';
import { ScreenRefreshControl } from '@/shared/ui/ScreenRefreshControl';

const trainingChartCard = (chart: TrainingChart) => TRAINING_CHART_CARD[chart];

/** The frames the screen mounts its cards across after the first. */
const MOUNT_STAGES = 3;

function HealthScreenContent() {
  useTabFirstFrame('/training');
  const perfEnd = logScreenRender('HealthScreen');
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { requestRefresh } = useSyncRefreshNotice();
  const { isDark, colors: themeColors } = useTheme();
  const shared = useMemo(() => createSharedStyles(isDark), [isDark]);

  // Log render time (JS phase only)

  useEffect(() => {
    perfEnd();
  });

  // The first frame carries no Skia canvas, even when every read is cached:
  // the header, the heatmap's frame and the chart placeholders paint first.
  // Stage 1: the heatmap picture and WellnessTrendsChart (Skia).
  // Stage 2: WeeklySummary (pure RN).
  // Stage 3: SeasonComparison (Skia).
  const [stage, setStage] = useState(0);
  useEffect(() => {
    if (stage >= MOUNT_STAGES) return undefined;
    const id = requestAnimationFrame(() => setStage(stage + 1));
    return () => cancelAnimationFrame(id);
  }, [stage]);
  const skiaReady = stage >= 1;
  const belowFoldReady = stage >= 2;
  const chartsReady = stage >= 3;

  // A metric linked here names its chart. The weekly card mounts a frame late,
  // so the scroll waits for its layout rather than for this screen's.
  const { chart: entryChart } = trainingEntryFromParams(useLocalSearchParams<{ chart?: string }>());
  const { scrollRef, onAnchorLayout, onScrollBeginDrag } = useRevealChart(
    entryChart,
    trainingChartCard
  );
  useScrollToTopOnReselect('/training', scrollRef);

  // Refresh state for pull-to-refresh
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Wellness state
  const [timeRange, setTimeRange] = useState<TimeRange>(DEFAULT_PERIOD);
  const [smoothingWindow, setSmoothingWindow] = useState<SmoothingWindow>('auto');
  const openSheet = useSheetOpener();
  const pickSmoothing = useCallback(async () => {
    const result = await openSheet<SmoothingSheetInput, SmoothingWindow>('sheets/smoothing', {
      window: smoothingWindow,
    });
    if (result.kind === 'selected') setSmoothingWindow(result.value);
  }, [openSheet, smoothingWindow]);

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
    isPlaceholderData: wellnessHeld,
    isError: isWellnessError,
    error: wellnessError,
    refetch: refetchWellness,
  } = useWellness(timeRange);
  const wellnessCoverage = useWellnessCoverage(timeRange);

  // Combined loading states. Every card on this tab now reads its own engine
  // aggregate, so the tab's own fetching state is the wellness one.
  const isFetching = wellnessFetching;

  // Handle pull-to-refresh - invalidate all training-related queries
  const onRefresh = useCallback(async () => {
    setIsRefreshing(true);
    requestRefresh();
    await Promise.all([
      refetchWellness(),
      queryClient.invalidateQueries({ queryKey: queryKeys.stats.all }),
    ]);
    setIsRefreshing(false);
  }, [refetchWellness, queryClient, requestRefresh]);

  const retryWellness = useCallback(() => {
    void refetchWellness();
  }, [refetchWellness]);

  // The title is the native header's. While a background fetch runs outside a pull-to-refresh, a
  // spinner is its trailing item.
  const fetchingInBackground = isFetching && !isRefreshing;
  const headerOptions = useMemo(
    () => ({
      // Always a function: the stack merges options, so a key left out keeps the last spinner.
      headerRight: () =>
        fetchingInBackground ? <Spinner testID="training-fetch-spinner" /> : null,
    }),
    [fetchingInBackground]
  );

  return (
    <ScreenSafeAreaView style={shared.container} testID="training-screen">
      <Stack.Screen options={headerOptions} />
      <ScreenScrollView
        ref={scrollRef}
        onScrollBeginDrag={onScrollBeginDrag}
        style={styles.scrollView}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: layout.screenPadding }]}
        showsVerticalScrollIndicator={false}
        refreshControl={<ScreenRefreshControl refreshing={isRefreshing} onRefresh={onRefresh} />}
      >
        {/* Activity Heatmap - promoted to top (Skia Picture, lightweight) */}
        <View style={styles.frame}>
          <Card variant="flat">
            <ActivityHeatmap ref={heatmap} drawn={skiaReady} />
          </Card>
        </View>

        {/* Wellness Trends Chart */}
        <View
          testID="wellness-trends-chart"
          onLayout={(event) => onAnchorLayout('wellness', event)}
          style={styles.frame}
        >
          <Card variant="flat">
            <CardHeader
              title={t('wellnessScreen.trends')}
              accessory={
                <Text style={[styles.smoothingLabel, isDark && styles.smoothingLabelDark]}>
                  {getSmoothingDescription(smoothingWindow, timeRange, t as never)}
                </Text>
              }
            />
            {/* The range and smoothing drive only this chart, so they sit in its card. */}
            <View style={styles.timeRangeRow}>
              <View style={styles.timeRangeContainer}>
                {TIME_RANGES.map((range) => (
                  <ToggleButton
                    key={range.id}
                    label={t(range.labelKey as never)}
                    selected={timeRange === range.id}
                    onPress={() => setTimeRange(range.id)}
                  />
                ))}
              </View>
              <IconButton
                accessibilityLabel={t('wellness.smoothingTitle' as never)}
                variant={smoothingWindow !== 'auto' ? 'primary' : 'secondary'}
                onPress={pickSmoothing}
                testID="training-smoothing-button"
              >
                <MaterialCommunityIcons
                  name="chart-bell-curve-cumulative"
                  size={iconSize.md}
                  color={
                    smoothingWindow !== 'auto' ? colors.textOnPrimary : themeColors.textSecondary
                  }
                />
              </IconButton>
            </View>
            {/* Each card names its own failed read, so a wellness failure leaves the
              title, the range pills and the other cards standing. */}
            {isWellnessError ? (
              <ErrorState
                variant="inline"
                error={wellnessError}
                onRetry={retryWellness}
                testID="wellness-trends-failed"
              />
            ) : !skiaReady || (wellnessLoading && !wellness) ? (
              <Shimmer width="100%" height={200} borderRadius={layout.borderRadius} />
            ) : (
              <WellnessTrendsChart
                data={wellness}
                coverage={wellnessCoverage}
                height={200}
                timeRange={timeRange}
                smoothingWindow={smoothingWindow}
                onDateSelect={handleDateSelect}
                held={wellnessHeld}
              />
            )}
          </Card>
        </View>

        {/* Below-fold cards - stage 2: WeeklySummary (pure RN).
              Always mount once belowFoldReady - the component renders its own
              empty/loading states and the testID must be present for automated
              tests to find the widget during data load. */}
        {belowFoldReady ? (
          <View onLayout={(event) => onAnchorLayout('week', event)} style={styles.frame}>
            <Card variant="flat">
              <WeeklySummary />
            </Card>
          </View>
        ) : null}

        {/* Below-fold Skia card - stage 3: SeasonComparison */}
        {chartsReady ? (
          <View style={styles.frame}>
            <Card variant="flat">
              <SeasonComparison height={180} />
            </Card>
          </View>
        ) : null}
      </ScreenScrollView>
    </ScreenSafeAreaView>
  );
}

const styles = StyleSheet.create({
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: layout.screenPadding,
    paddingTop: spacing.sm,
  },
  frame: {
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
});

export default withScreenBoundary(HealthScreenContent, 'Training');

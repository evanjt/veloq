import React, { useMemo, useState } from 'react';
import { View, StyleSheet, TouchableOpacity, Text as RNText } from 'react-native';
import {
  useAthleteSummary,
  getISOWeekNumber,
  formatWeekRange,
  type WeeklySummaryData,
} from '@/features/fitness/hooks';
import { useTheme, useMetricSystem } from '@/shared/app';
import { Text, ActivityIndicator } from 'react-native-paper';
import type { ParseKeys, TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { colors, darkColors, opacity, typography, spacing, layout, verdictColor } from '@/theme';
import { weeklyTrend, type WeeklyStat } from '@/features/stats/lib/weeklyTrend';
import { formatDistance, getMonday, getSunday, formatDurationHuman } from '@/shared/format/format';
import {
  localDayEnd,
  localDayStart,
  usePeriodStats,
  type PeriodTotals,
} from '@/features/stats/hooks/useEngineStats';

type TimeRange = 'week' | 'month' | '3m' | '6m' | 'year';

interface WeeklySummaryProps {
  /** Pre-fetched athlete summary data (lifted from parent for data call visibility) */
  summaryData?: WeeklySummaryData;
  /** Whether summary data is loading */
  summaryLoading?: boolean;
}

const TIME_RANGE_IDS: TimeRange[] = ['week', 'month', '3m', '6m', 'year'];

const RANGE_LABEL_KEYS: Record<TimeRange, { current: ParseKeys; previous: ParseKeys }> = {
  week: { current: 'stats.thisWeek', previous: 'stats.vsLastWeek' },
  month: { current: 'stats.thisMonth', previous: 'stats.vsLastMonth' },
  '3m': { current: 'stats.last3Months', previous: 'stats.vsPrevious3Months' },
  '6m': { current: 'stats.last6Months', previous: 'stats.vsPrevious6Months' },
  year: { current: 'stats.thisYear', previous: 'stats.vsLastYear' },
};

const RANGE_BUTTON_KEYS: Record<TimeRange, ParseKeys> = {
  week: 'stats.week',
  month: 'stats.month',
  '3m': 'stats.threeMonths',
  '6m': 'stats.sixMonths',
  year: 'stats.year',
};

function getTimeRangeLabel(
  range: TimeRange,
  t: TFunction,
  weekNumber?: number,
  weekRange?: string
): { current: string; previous: string } {
  const keys = RANGE_LABEL_KEYS[range];
  const current =
    range === 'week' && weekNumber && weekRange
      ? `${t(keys.current)}: #${weekNumber} (${weekRange})`
      : t(keys.current);
  return { current, previous: t(keys.previous) };
}

function getTimeRangeButtonLabel(range: TimeRange, t: TFunction): string {
  return t(RANGE_BUTTON_KEYS[range]);
}

interface DateRanges {
  currentStart: Date;
  currentEnd: Date;
  previousStart: Date;
  previousEnd: Date;
}

const DATE_RANGES: Record<TimeRange, (now: Date, today: Date) => DateRanges> = {
  // Calendar week (Monday-Sunday) - matches intervals.icu
  week: (_now, today) => {
    const currentStart = getMonday(today);
    const currentEnd = getSunday(today);
    const previousStart = new Date(currentStart);
    previousStart.setDate(previousStart.getDate() - 7);
    const previousEnd = new Date(currentStart);
    previousEnd.setDate(previousEnd.getDate() - 1);
    return { currentStart, currentEnd, previousStart, previousEnd };
  },
  month: (now, today) => ({
    currentStart: new Date(now.getFullYear(), now.getMonth(), 1),
    currentEnd: today,
    previousStart: new Date(now.getFullYear(), now.getMonth() - 1, 1),
    previousEnd: new Date(now.getFullYear(), now.getMonth(), 0),
  }),
  '3m': (now, today) => ({
    currentStart: new Date(now.getFullYear(), now.getMonth() - 2, 1),
    currentEnd: today,
    previousStart: new Date(now.getFullYear(), now.getMonth() - 5, 1),
    previousEnd: new Date(now.getFullYear(), now.getMonth() - 2, 0),
  }),
  '6m': (now, today) => ({
    currentStart: new Date(now.getFullYear(), now.getMonth() - 5, 1),
    currentEnd: today,
    previousStart: new Date(now.getFullYear(), now.getMonth() - 11, 1),
    previousEnd: new Date(now.getFullYear(), now.getMonth() - 5, 0),
  }),
  year: (now, today) => ({
    currentStart: new Date(now.getFullYear(), 0, 1),
    currentEnd: today,
    previousStart: new Date(now.getFullYear() - 1, 0, 1),
    previousEnd: new Date(now.getFullYear() - 1, 11, 31),
  }),
};

function getDateRanges(range: TimeRange): DateRanges {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return DATE_RANGES[range](now, today);
}

/** The engine's totals, with TSS rounded as the cells display it. */
function rounded(totals: PeriodTotals) {
  return {
    count: totals.count,
    duration: totals.duration,
    distance: totals.distance,
    tss: Math.round(totals.tss),
  };
}

function TrendCell({
  stat,
  current,
  previous,
  isDark,
}: {
  stat: WeeklyStat;
  current: number;
  previous: number;
  isDark: boolean;
}) {
  const cell = weeklyTrend(stat, current, previous);
  if (!cell) return null;
  return (
    <Text style={[styles.trendArrow, { color: verdictColor(cell.rung, isDark) }]}>
      {cell.glyph}
      {cell.pct && <RNText style={styles.trendPct}> {cell.pct}</RNText>}
    </Text>
  );
}

export function WeeklySummary({
  summaryData: externalSummaryData,
  summaryLoading: externalSummaryLoading,
}: WeeklySummaryProps) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const isMetric = useMetricSystem();
  const [timeRange, setTimeRange] = useState<TimeRange>('week');

  // Use externally-provided summary data if available, otherwise fetch internally.
  // When parent provides data, the internal hook still runs but TanStack Query
  // deduplicates - same queryKey means zero extra network requests.
  const { data: internalSummaryData, isLoading: internalSummaryLoading } = useAthleteSummary(4);
  const summaryData = externalSummaryData ?? internalSummaryData;
  const isLoadingSummary = externalSummaryLoading ?? internalSummaryLoading;

  // The two windows the selected range compares, as the epoch seconds the
  // engine stores. The calendar week takes the athlete-summary endpoint when it
  // has one, because that is what intervals.icu's own week is, so the reads are
  // turned off rather than run and discarded.
  const ranges = useMemo(() => getDateRanges(timeRange), [timeRange]);
  const readsEngine = !(timeRange === 'week' && !!summaryData);
  const current = usePeriodStats(
    localDayStart(ranges.currentStart),
    localDayEnd(ranges.currentEnd),
    readsEngine
  );
  const previous = usePeriodStats(
    localDayStart(ranges.previousStart),
    localDayEnd(ranges.previousEnd),
    readsEngine
  );

  // Compute stats based on time range
  const { currentStats, previousStats, labels } = useMemo(() => {
    const today = new Date();
    const currentMonday = getMonday(today);
    const weekNum = getISOWeekNumber(today);
    const weekRangeStr = formatWeekRange(currentMonday);

    // For 'week' range, use API data (matches intervals.icu calendar weeks)
    if (timeRange === 'week' && summaryData) {
      const current = summaryData.currentWeek;
      const previous = summaryData.previousWeek;

      return {
        currentStats: {
          count: current?.count ?? 0,
          duration: current?.moving_time ?? 0,
          distance: current?.distance ?? 0,
          tss: Math.round(current?.training_load ?? 0),
        },
        previousStats: {
          count: previous?.count ?? 0,
          duration: previous?.moving_time ?? 0,
          distance: previous?.distance ?? 0,
          tss: Math.round(previous?.training_load ?? 0),
        },
        labels: getTimeRangeLabel(timeRange, t, weekNum, weekRangeStr),
      };
    }

    return {
      currentStats: rounded(current.totals),
      previousStats: rounded(previous.totals),
      labels: getTimeRangeLabel(timeRange, t, weekNum, weekRangeStr),
    };
  }, [current.totals, previous.totals, timeRange, summaryData, t]);

  // Show loading state: for 'week' the summary endpoint is authoritative. For
  // other ranges it is the engine read, which settles in a tick; once it has,
  // the empty-state branch handles a period with nothing in it rather than
  // spinning indefinitely.
  const isLoading = timeRange === 'week' ? isLoadingSummary : current.isPending;

  // Show empty state if no activities in current period
  if (!isLoading && currentStats.count === 0) {
    return (
      <View style={styles.container} testID="weekly-summary">
        <View style={styles.header}>
          <Text style={[styles.title, isDark && styles.textLight]}>{labels.current}</Text>
          <View style={styles.timeRangeSelector}>
            {TIME_RANGE_IDS.map((rangeId) => (
              <TouchableOpacity
                key={rangeId}
                testID={`weekly-summary-range-${rangeId}`}
                style={[
                  styles.timeRangeButton,
                  isDark && styles.timeRangeButtonDark,
                  timeRange === rangeId && styles.timeRangeButtonActive,
                ]}
                onPress={() => setTimeRange(rangeId)}
              >
                <Text
                  style={[
                    styles.timeRangeText,
                    isDark && styles.textDark,
                    timeRange === rangeId && styles.timeRangeTextActive,
                  ]}
                >
                  {getTimeRangeButtonLabel(rangeId, t)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
        <View style={styles.emptyState} testID="weekly-summary-empty">
          <Text style={[styles.emptyText, isDark && styles.textDark]}>
            {t('stats.noActivitiesInPeriod')}
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container} testID="weekly-summary">
      {/* Header with title and time range selector */}
      <View style={styles.header}>
        <Text style={[styles.title, isDark && styles.textLight]}>{labels.current}</Text>
        <View style={styles.timeRangeSelector}>
          {TIME_RANGE_IDS.map((rangeId) => (
            <TouchableOpacity
              key={rangeId}
              testID={`weekly-summary-range-${rangeId}`}
              style={[
                styles.timeRangeButton,
                isDark && styles.timeRangeButtonDark,
                timeRange === rangeId && styles.timeRangeButtonActive,
              ]}
              onPress={() => setTimeRange(rangeId)}
            >
              <Text
                style={[
                  styles.timeRangeText,
                  isDark && styles.textDark,
                  timeRange === rangeId && styles.timeRangeTextActive,
                ]}
              >
                {getTimeRangeButtonLabel(rangeId, t)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* Loading indicator */}
      {isLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="small" color={colors.primary} />
        </View>
      ) : (
        <>
          {/* Stats grid */}
          <View style={styles.statsGrid}>
            <View style={styles.statItem}>
              <View style={styles.statValueRow}>
                <Text
                  testID="weekly-summary-count"
                  style={[styles.statValue, isDark && styles.textLight]}
                >
                  {currentStats.count}
                </Text>
                <TrendCell
                  stat="count"
                  current={currentStats.count}
                  previous={previousStats.count}
                  isDark={isDark}
                />
              </View>
              <Text style={[styles.statLabel, isDark && styles.textDark]}>
                {t('stats.activities')}
              </Text>
            </View>

            <View style={styles.statItem}>
              <View style={styles.statValueRow}>
                <Text
                  testID="weekly-summary-duration"
                  style={[styles.statValue, isDark && styles.textLight]}
                >
                  {formatDurationHuman(currentStats.duration)}
                </Text>
                <TrendCell
                  stat="duration"
                  current={currentStats.duration}
                  previous={previousStats.duration}
                  isDark={isDark}
                />
              </View>
              <Text style={[styles.statLabel, isDark && styles.textDark]}>
                {t('activity.duration')}
              </Text>
            </View>

            <View style={styles.statItem}>
              <View style={styles.statValueRow}>
                <Text
                  testID="weekly-summary-distance"
                  style={[styles.statValue, isDark && styles.textLight]}
                >
                  {formatDistance(currentStats.distance, isMetric)}
                </Text>
                <TrendCell
                  stat="distance"
                  current={currentStats.distance}
                  previous={previousStats.distance}
                  isDark={isDark}
                />
              </View>
              <Text style={[styles.statLabel, isDark && styles.textDark]}>
                {t('activity.distance')}
              </Text>
            </View>

            <View style={styles.statItem}>
              <View style={styles.statValueRow}>
                <Text
                  testID="weekly-summary-tss"
                  style={[styles.statValue, isDark && styles.textLight]}
                >
                  {currentStats.tss}
                </Text>
                <TrendCell
                  stat="tss"
                  current={currentStats.tss}
                  previous={previousStats.tss}
                  isDark={isDark}
                />
              </View>
              <Text style={[styles.statLabel, isDark && styles.textDark]}>
                {t('stats.loadTss')}
              </Text>
            </View>
          </View>

          {/* Period comparison label */}
          <Text style={[styles.comparisonLabel, isDark && styles.textDark]}>{labels.previous}</Text>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {},
  header: {
    marginBottom: spacing.md,
  },
  title: {
    fontSize: typography.body.fontSize,
    fontWeight: '700',
    color: colors.textPrimary,
    marginBottom: spacing.sm,
  },
  textLight: {
    color: colors.textOnDark,
  },
  textDark: {
    color: darkColors.textSecondary,
  },
  timeRangeSelector: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  timeRangeButton: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: layout.borderRadiusSm,
    backgroundColor: opacity.overlay.light,
  },
  timeRangeButtonDark: {
    backgroundColor: opacity.overlayDark.medium,
  },
  timeRangeButtonActive: {
    backgroundColor: colors.primary,
  },
  timeRangeText: {
    fontSize: typography.micro.fontSize,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  timeRangeTextActive: {
    color: colors.textOnDark,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginHorizontal: -spacing.xs,
  },
  statItem: {
    width: '50%',
    paddingHorizontal: spacing.xs,
    marginBottom: spacing.md,
  },
  statValueRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: spacing.xs,
  },
  statValue: {
    fontSize: typography.statsValueLarge.fontSize,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  trendArrow: {
    fontSize: typography.bodySmall.fontSize,
    fontWeight: '600',
  },
  trendPct: {
    fontSize: typography.micro.fontSize,
    fontWeight: '400',
  },
  statLabel: {
    fontSize: typography.caption.fontSize,
    color: colors.textSecondary,
    marginTop: spacing.xxs,
  },
  comparisonLabel: {
    fontSize: typography.micro.fontSize,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: spacing.xl,
  },
  emptyText: {
    fontSize: typography.bodySmall.fontSize,
    color: colors.textSecondary,
  },
  loadingContainer: {
    padding: spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

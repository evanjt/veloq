import React, { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { View, StyleSheet, Text as RNText } from 'react-native';
import { getISOWeekNumber, formatWeekRange } from '@/features/fitness';
import { useTheme, useMetricSystem } from '@/shared/app';
import { Text } from 'react-native-paper';
import type { ParseKeys, TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { colors, darkColors, layout, typography, spacing, verdictColor } from '@/theme';
import { glyphMove, verdictRung, type TrendMetric } from '@/shared/format/trend';
import { spokenVerdict } from '@/shared/format/spoken';
import { RangeCoverage } from 'veloqrs';
import {
  formatDistance,
  formatFullDate,
  formatLocalDate,
  getMonday,
  formatDurationHuman,
} from '@/shared/format/format';
import { useWindowCoverage } from '@/shared/native/useRangeCoverage';
import {
  useTrainingScreenData,
  type PeriodTotals,
  type StatMove,
  type SummaryRange,
  type SummaryStat,
} from '@/features/stats/hooks/useEngineStats';
import {
  CardHeader,
  EmptyState,
  ErrorState,
  Shimmer,
  SkeletonFrame,
  ToggleButton,
} from '@/shared/ui';
import { queryKeys } from '@/shared/query/queryKeys';

type TimeRange = SummaryRange;

const TIME_RANGE_IDS: TimeRange[] = ['week', 'month', '3m', '6m', 'year'];

const RANGE_LABEL_KEYS: Record<TimeRange, { current: ParseKeys; previous: ParseKeys }> = {
  week: { current: 'stats.thisWeek', previous: 'stats.vsLastWeek' },
  month: { current: 'stats.thisMonth', previous: 'stats.vsLastMonth' },
  '3m': { current: 'stats.monthAndTwoBefore', previous: 'stats.vsPrevious3Months' },
  '6m': { current: 'stats.monthAndFiveBefore', previous: 'stats.vsPrevious6Months' },
  year: { current: 'stats.thisYear', previous: 'stats.vsLastYear' },
};

// The 3M and 6M of the other pickers are trailing spans of 90 and 180 days. These
// two start on the first of a calendar month, so they carry labels of their own.
const RANGE_BUTTON_KEYS: Record<TimeRange, ParseKeys> = {
  week: 'stats.week',
  month: 'stats.month',
  '3m': 'stats.threeCalendarMonths',
  '6m': 'stats.sixCalendarMonths',
  year: 'stats.year',
};

/** The trend metric the engine judged each total as, whose polarity reads its glyph back. */
const STAT_METRIC: Record<SummaryStat, TrendMetric> = {
  count: 'weekCount',
  duration: 'weekHours',
  distance: 'weekDistance',
  tss: 'weekTss',
};

const NO_TOTALS: PeriodTotals = { count: 0, duration: 0, distance: 0, tss: 0 };

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

/** The engine's move for one total, drawn as it was judged. */
function TrendCell({
  stat,
  move,
  isDark,
}: {
  stat: SummaryStat;
  move: StatMove | null;
  isDark: boolean;
}) {
  if (!move) return null;
  const { verdict, direction } = glyphMove(STAT_METRIC[stat], move.glyph);
  const pct = move.percent == null ? null : `${move.percent}%`;
  const spoken = spokenVerdict(verdict, direction);
  return (
    <Text
      testID={`weekly-summary-${stat}-trend`}
      accessibilityLabel={pct ? `${spoken}, ${pct}` : spoken}
      style={[styles.trendArrow, { color: verdictColor(verdictRung(verdict), isDark) }]}
    >
      {move.glyph}
      {pct ? <RNText style={styles.trendPct}> {pct}</RNText> : null}
    </Text>
  );
}

/** The four-cell stats grid while its totals load, each cell the size of the stat it becomes. */
function StatsGridSkeleton() {
  return (
    <SkeletonFrame testID="weekly-summary-skeleton">
      <View style={styles.statsGrid}>
        {[0, 1, 2, 3].map((cell) => (
          <View key={cell} testID="weekly-summary-skeleton-cell" style={styles.statItem}>
            <Shimmer
              width="60%"
              height={typography.statsValueLarge.lineHeight}
              borderRadius={layout.borderRadiusXs}
            />
            <Shimmer
              width="40%"
              height={typography.caption.lineHeight}
              borderRadius={layout.borderRadiusXs}
              style={styles.statLabelPlaceholder}
            />
          </View>
        ))}
      </View>
    </SkeletonFrame>
  );
}

export function WeeklySummary() {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const isMetric = useMetricSystem();
  const [timeRange, setTimeRange] = useState<TimeRange>('week');
  const queryClient = useQueryClient();

  // Every range's two windows, totals and moves come from the training read,
  // judged once by the engine, so a tap between ranges reads nothing and the
  // week says what the home card says.
  const { data, isPending, error: readError } = useTrainingScreenData();
  const comparison = data.comparisons?.[timeRange] ?? null;
  const currentStats = comparison?.current ?? NO_TOTALS;
  const rangeTexts = useMemo(
    () =>
      comparison
        ? {
            current: t('stats.calendarRange', {
              start: formatFullDate(comparison.currentStart),
              end: formatFullDate(comparison.currentEnd),
            }),
            previous: t('stats.calendarRange', {
              start: formatFullDate(comparison.previousStart),
              end: formatFullDate(comparison.previousEnd),
            }),
          }
        : { current: undefined, previous: undefined },
    [comparison, t]
  );

  // Whether each period was downloaded, by the census over its own days.
  const days = (start?: Date, end?: Date): [string, string] =>
    start && end ? [formatLocalDate(start), formatLocalDate(end)] : ['', ''];
  const [currentOldest, currentNewest] = days(comparison?.currentStart, comparison?.currentEnd);
  const [previousOldest, previousNewest] = days(comparison?.previousStart, comparison?.previousEnd);
  const currentCoverage = useWindowCoverage(currentOldest, currentNewest, !!comparison);
  const previousCoverage = useWindowCoverage(previousOldest, previousNewest, !!comparison);
  const currentNotDownloaded = currentCoverage === RangeCoverage.NotFetched;
  const partlyNotDownloaded = currentNotDownloaded || previousCoverage === RangeCoverage.NotFetched;

  const labels = useMemo(() => {
    const today = new Date();
    return getTimeRangeLabel(
      timeRange,
      t,
      getISOWeekNumber(today),
      formatWeekRange(getMonday(today))
    );
  }, [timeRange, t]);

  // The engine read settles in a tick; once it has, the empty-state branch
  // handles a period with nothing in it rather than spinning indefinitely.
  const isLoading = isPending;

  const retry = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.stats.training.all });
  };

  // Show empty state if no activities in current period
  if (readError != null || (!isLoading && currentStats.count === 0)) {
    return (
      <View style={styles.container} testID="weekly-summary">
        <View style={styles.header}>
          <CardHeader
            title={labels.current}
            subtitle={rangeTexts.current}
            testID="weekly-summary-header"
          />
          <View style={styles.timeRangeSelector}>
            {TIME_RANGE_IDS.map((rangeId) => (
              <ToggleButton
                key={rangeId}
                testID={`weekly-summary-range-${rangeId}`}
                label={getTimeRangeButtonLabel(rangeId, t)}
                selected={timeRange === rangeId}
                onPress={() => setTimeRange(rangeId)}
              />
            ))}
          </View>
        </View>
        {readError != null ? (
          <ErrorState
            variant="inline"
            error={readError}
            onRetry={retry}
            testID="weekly-summary-failed"
          />
        ) : (
          <EmptyState
            variant="inline"
            testID="weekly-summary-empty"
            title={
              currentNotDownloaded ? t('stats.rangeNotDownloaded') : t('stats.noActivitiesInPeriod')
            }
          />
        )}
      </View>
    );
  }

  return (
    <View style={styles.container} testID="weekly-summary">
      {/* Header with title and time range selector */}
      <View style={styles.header}>
        <CardHeader
          title={labels.current}
          subtitle={rangeTexts.current}
          testID="weekly-summary-header"
        />
        <View style={styles.timeRangeSelector}>
          {TIME_RANGE_IDS.map((rangeId) => (
            <ToggleButton
              key={rangeId}
              testID={`weekly-summary-range-${rangeId}`}
              label={getTimeRangeButtonLabel(rangeId, t)}
              selected={timeRange === rangeId}
              onPress={() => setTimeRange(rangeId)}
            />
          ))}
        </View>
      </View>

      {isLoading ? (
        <StatsGridSkeleton />
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
                <TrendCell stat="count" move={comparison?.moves.count ?? null} isDark={isDark} />
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
                  move={comparison?.moves.duration ?? null}
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
                  move={comparison?.moves.distance ?? null}
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
                  {Math.round(currentStats.tss)}
                </Text>
                <TrendCell stat="tss" move={comparison?.moves.tss ?? null} isDark={isDark} />
              </View>
              <Text style={[styles.statLabel, isDark && styles.textDark]}>{t('metrics.load')}</Text>
            </View>
          </View>

          {/* Period comparison label */}
          <Text style={[styles.comparisonLabel, isDark && styles.textDark]}>{labels.previous}</Text>
          <Text
            testID="weekly-summary-previous-range"
            style={[styles.comparisonLabel, isDark && styles.textDark]}
          >
            {rangeTexts.previous}
          </Text>
          {partlyNotDownloaded ? (
            <Text
              testID="weekly-summary-partial"
              style={[styles.comparisonLabel, isDark && styles.textDark]}
            >
              {t('stats.rangePartlyDownloaded')}
            </Text>
          ) : null}
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
    ...typography.statsValueLarge,
    color: colors.textPrimary,
  },
  trendArrow: {
    ...typography.bodySmallBold,
  },
  trendPct: {
    ...typography.micro,
  },
  statLabel: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: spacing.xxs,
  },
  comparisonLabel: {
    ...typography.micro,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  statLabelPlaceholder: {
    marginTop: spacing.xxs,
  },
});

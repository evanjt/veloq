import React, { useMemo, useState } from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import {
  useTheme,
  useMetricSystem,
  useAthleteSummary,
  getISOWeekNumber,
  type WeeklySummaryData,
} from '@/hooks';
import { Text, ActivityIndicator } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { colors, darkColors, opacity } from '@/theme/colors';
import { typography } from '@/theme/typography';
import { spacing, layout } from '@/theme/spacing';
import { formatDistance } from '@/lib';
import type { Activity } from '@/types';

type TimeRange = 'week' | 'month' | '3m' | '6m' | 'year';

interface WeeklySummaryProps {
  /** All activities (component will filter based on selected time range) */
  activities?: Activity[];
  /** Pre-fetched athlete summary data (lifted from parent for data call visibility) */
  summaryData?: WeeklySummaryData;
  /** Whether summary data is loading */
  summaryLoading?: boolean;
}

const TIME_RANGE_IDS: TimeRange[] = ['week', 'month', '3m', '6m', 'year'];

function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (hours > 0) {
    return `${hours}h ${mins}m`;
  }
  return `${mins}m`;
}

/**
 * Get the Monday of the week for a given date (ISO week: Monday-Sunday)
 */
function getMonday(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Get the Sunday of the week for a given date
 */
function getSunday(date: Date): Date {
  const monday = getMonday(date);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return sunday;
}

/**
 * Format week range for display (e.g., "Jan 20-26")
 */
function formatWeekRange(monday: Date): string {
  const sunday = getSunday(monday);
  const mondayMonth = monday.toLocaleString('en-US', { month: 'short' });
  const sundayMonth = sunday.toLocaleString('en-US', { month: 'short' });

  if (mondayMonth === sundayMonth) {
    return `${mondayMonth} ${monday.getDate()}-${sunday.getDate()}`;
  }
  return `${mondayMonth} ${monday.getDate()} - ${sundayMonth} ${sunday.getDate()}`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getTimeRangeLabel(
  range: TimeRange,
  t: (key: string) => any,
  weekNumber?: number,
  weekRange?: string
): { current: string; previous: string } {
  switch (range) {
    case 'week':
      if (weekNumber && weekRange) {
        return {
          current: `${t('stats.thisWeek')}: #${weekNumber} (${weekRange})`,
          previous: t('stats.vsLastWeek') as string,
        };
      }
      return {
        current: t('stats.thisWeek') as string,
        previous: t('stats.vsLastWeek') as string,
      };
    case 'month':
      return {
        current: t('stats.thisMonth') as string,
        previous: t('stats.vsLastMonth') as string,
      };
    case '3m':
      return {
        current: t('stats.last3Months') as string,
        previous: t('stats.vsPrevious3Months') as string,
      };
    case '6m':
      return {
        current: t('stats.last6Months') as string,
        previous: t('stats.vsPrevious6Months') as string,
      };
    case 'year':
      return {
        current: t('stats.thisYear') as string,
        previous: t('stats.vsLastYear') as string,
      };
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getTimeRangeButtonLabel(range: TimeRange, t: (key: string) => any): string {
  switch (range) {
    case 'week':
      return t('stats.week') as string;
    case 'month':
      return t('stats.month') as string;
    case '3m':
      return t('stats.threeMonths') as string;
    case '6m':
      return t('stats.sixMonths') as string;
    case 'year':
      return t('stats.year') as string;
  }
}

function getDateRanges(range: TimeRange): {
  currentStart: Date;
  currentEnd: Date;
  previousStart: Date;
  previousEnd: Date;
} {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  switch (range) {
    case 'week': {
      // Calendar week (Monday-Sunday) - matches intervals.icu
      const currentStart = getMonday(today);
      const currentEnd = getSunday(today);
      const previousStart = new Date(currentStart);
      previousStart.setDate(previousStart.getDate() - 7);
      const previousEnd = new Date(currentStart);
      previousEnd.setDate(previousEnd.getDate() - 1);
      return { currentStart, currentEnd, previousStart, previousEnd };
    }
    case 'month': {
      const currentStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const currentEnd = today;
      const previousStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const previousEnd = new Date(now.getFullYear(), now.getMonth(), 0);
      return { currentStart, currentEnd, previousStart, previousEnd };
    }
    case '3m': {
      const currentStart = new Date(now.getFullYear(), now.getMonth() - 2, 1);
      const currentEnd = today;
      const previousStart = new Date(now.getFullYear(), now.getMonth() - 5, 1);
      const previousEnd = new Date(now.getFullYear(), now.getMonth() - 2, 0);
      return { currentStart, currentEnd, previousStart, previousEnd };
    }
    case '6m': {
      const currentStart = new Date(now.getFullYear(), now.getMonth() - 5, 1);
      const currentEnd = today;
      const previousStart = new Date(now.getFullYear(), now.getMonth() - 11, 1);
      const previousEnd = new Date(now.getFullYear(), now.getMonth() - 5, 0);
      return { currentStart, currentEnd, previousStart, previousEnd };
    }
    case 'year': {
      const currentStart = new Date(now.getFullYear(), 0, 1);
      const currentEnd = today;
      const previousStart = new Date(now.getFullYear() - 1, 0, 1);
      const previousEnd = new Date(now.getFullYear() - 1, 11, 31);
      return { currentStart, currentEnd, previousStart, previousEnd };
    }
  }
}

// Optimized: Single-pass computation of stats for both periods
function computeStatsForPeriods(
  activities: Activity[],
  currentStart: Date,
  currentEnd: Date,
  previousStart: Date,
  previousEnd: Date
) {
  const currentStartTs = currentStart.getTime();
  const currentEndTs = currentEnd.getTime() + 24 * 60 * 60 * 1000 - 1; // End of day
  const previousStartTs = previousStart.getTime();
  const previousEndTs = previousEnd.getTime() + 24 * 60 * 60 * 1000 - 1;

  let currentCount = 0,
    currentDuration = 0,
    currentDistance = 0,
    currentTss = 0;
  let previousCount = 0,
    previousDuration = 0,
    previousDistance = 0,
    previousTss = 0;

  for (const activity of activities) {
    const activityTs = new Date(activity.start_date_local).getTime();

    if (activityTs >= currentStartTs && activityTs <= currentEndTs) {
      currentCount++;
      currentDuration += activity.moving_time || 0;
      currentDistance += activity.distance || 0;
      currentTss += activity.icu_training_load || 0;
    } else if (activityTs >= previousStartTs && activityTs <= previousEndTs) {
      previousCount++;
      previousDuration += activity.moving_time || 0;
      previousDistance += activity.distance || 0;
      previousTss += activity.icu_training_load || 0;
    }
  }

  return {
    currentStats: {
      count: currentCount,
      duration: currentDuration,
      distance: currentDistance,
      tss: Math.round(currentTss),
    },
    previousStats: {
      count: previousCount,
      duration: previousDuration,
      distance: previousDistance,
      tss: Math.round(previousTss),
    },
  };
}

function pctChange(current: number, previous: number): string {
  if (previous === 0) return '';
  const pct = Math.round(Math.abs(((current - previous) / previous) * 100));
  return ` ${pct}%`;
}

export function WeeklySummary({
  activities,
  summaryData: externalSummaryData,
  summaryLoading: externalSummaryLoading,
}: WeeklySummaryProps) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const isMetric = useMetricSystem();
  const [timeRange, setTimeRange] = useState<TimeRange>('week');

  // Use externally-provided summary data if available, otherwise fetch internally.
  // When parent provides data, the internal hook still runs but TanStack Query
  // deduplicates — same queryKey means zero extra network requests.
  const { data: internalSummaryData, isLoading: internalSummaryLoading } = useAthleteSummary(4);
  const summaryData = externalSummaryData ?? internalSummaryData;
  const isLoadingSummary = externalSummaryLoading ?? internalSummaryLoading;

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
        labels: getTimeRangeLabel(timeRange, t as (key: string) => any, weekNum, weekRangeStr),
      };
    }

    // For other time ranges, use client-side calculation
    if (!activities || activities.length === 0) {
      return {
        currentStats: { count: 0, duration: 0, distance: 0, tss: 0 },
        previousStats: { count: 0, duration: 0, distance: 0, tss: 0 },
        labels: getTimeRangeLabel(timeRange, t as (key: string) => any, weekNum, weekRangeStr),
      };
    }

    const ranges = getDateRanges(timeRange);
    const stats = computeStatsForPeriods(
      activities,
      ranges.currentStart,
      ranges.currentEnd,
      ranges.previousStart,
      ranges.previousEnd
    );

    return {
      ...stats,
      labels: getTimeRangeLabel(timeRange, t as (key: string) => any, weekNum, weekRangeStr),
    };
  }, [activities, timeRange, summaryData, t]);

  // Show loading state while fetching calendar data
  const isLoading = timeRange === 'week' && isLoadingSummary;

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
                  {getTimeRangeButtonLabel(rangeId, t as (key: string) => any)}
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
                {getTimeRangeButtonLabel(rangeId, t as (key: string) => any)}
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
                {previousStats.count > 0 && currentStats.count !== previousStats.count && (
                  <Text
                    style={[
                      styles.trendArrow,
                      {
                        color:
                          currentStats.count > previousStats.count
                            ? colors.success
                            : colors.warning,
                      },
                    ]}
                  >
                    {currentStats.count > previousStats.count ? '↑' : '↓'}
                    {pctChange(currentStats.count, previousStats.count)}
                  </Text>
                )}
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
                  {formatDuration(currentStats.duration)}
                </Text>
                {previousStats.duration > 0 &&
                  Math.abs(currentStats.duration - previousStats.duration) > 300 && (
                    <Text
                      style={[
                        styles.trendArrow,
                        {
                          color:
                            currentStats.duration > previousStats.duration
                              ? colors.success
                              : colors.warning,
                        },
                      ]}
                    >
                      {currentStats.duration > previousStats.duration ? '↑' : '↓'}
                      {pctChange(currentStats.duration, previousStats.duration)}
                    </Text>
                  )}
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
                {previousStats.distance > 0 &&
                  Math.abs(currentStats.distance - previousStats.distance) > 1000 && (
                    <Text
                      style={[
                        styles.trendArrow,
                        {
                          color:
                            currentStats.distance > previousStats.distance
                              ? colors.success
                              : colors.warning,
                        },
                      ]}
                    >
                      {currentStats.distance > previousStats.distance ? '↑' : '↓'}
                      {pctChange(currentStats.distance, previousStats.distance)}
                    </Text>
                  )}
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
                {previousStats.tss > 0 && Math.abs(currentStats.tss - previousStats.tss) > 5 && (
                  <Text
                    style={[
                      styles.trendArrow,
                      {
                        color:
                          currentStats.tss > previousStats.tss ? colors.warning : colors.success,
                      },
                    ]}
                  >
                    {currentStats.tss > previousStats.tss ? '↑' : '↓'}
                    {pctChange(currentStats.tss, previousStats.tss)}
                  </Text>
                )}
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
    fontSize: 24,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  trendArrow: {
    fontSize: 16,
    fontWeight: '600',
  },
  statLabel: {
    fontSize: typography.caption.fontSize,
    color: colors.textSecondary,
    marginTop: 2,
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

import React, { useMemo, useState } from 'react';
import { View, StyleSheet, useColorScheme, TouchableOpacity } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { colors, darkColors, opacity } from '@/theme/colors';
import { typography } from '@/theme/typography';
import { spacing, layout } from '@/theme/spacing';
import type { Activity } from '@/types';

type TimeRange = 'week' | 'month' | '3m' | '6m' | 'year';

interface WeeklySummaryProps {
  /** All activities (component will filter based on selected time range) */
  activities?: Activity[];
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

function formatDistance(meters: number): string {
  const km = meters / 1000;
  return `${km.toFixed(1)} km`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getTimeRangeLabel(
  range: TimeRange,
  t: (key: string) => any
): { current: string; previous: string } {
  switch (range) {
    case 'week':
      return { current: t('stats.thisWeek') as string, previous: t('stats.vsLastWeek') as string };
    case 'month':
      return { current: t('stats.thisMonth') as string, previous: t('stats.vsLastMonth') as string };
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
      return { current: t('stats.thisYear') as string, previous: t('stats.vsLastYear') as string };
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getTimeRangeButtonLabel(
  range: TimeRange,
  t: (key: string) => any
): string {
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
      // Current week (last 7 days)
      const currentStart = new Date(today);
      currentStart.setDate(currentStart.getDate() - 6);
      const currentEnd = today;
      // Previous week (7-14 days ago)
      const previousStart = new Date(currentStart);
      previousStart.setDate(previousStart.getDate() - 7);
      const previousEnd = new Date(currentStart);
      previousEnd.setDate(previousEnd.getDate() - 1);
      return { currentStart, currentEnd, previousStart, previousEnd };
    }
    case 'month': {
      // Current month
      const currentStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const currentEnd = today;
      // Previous month
      const previousStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const previousEnd = new Date(now.getFullYear(), now.getMonth(), 0);
      return { currentStart, currentEnd, previousStart, previousEnd };
    }
    case '3m': {
      // Last 3 months
      const currentStart = new Date(now.getFullYear(), now.getMonth() - 2, 1);
      const currentEnd = today;
      // Previous 3 months
      const previousStart = new Date(now.getFullYear(), now.getMonth() - 5, 1);
      const previousEnd = new Date(now.getFullYear(), now.getMonth() - 2, 0);
      return { currentStart, currentEnd, previousStart, previousEnd };
    }
    case '6m': {
      // Last 6 months
      const currentStart = new Date(now.getFullYear(), now.getMonth() - 5, 1);
      const currentEnd = today;
      // Previous 6 months
      const previousStart = new Date(now.getFullYear(), now.getMonth() - 11, 1);
      const previousEnd = new Date(now.getFullYear(), now.getMonth() - 5, 0);
      return { currentStart, currentEnd, previousStart, previousEnd };
    }
    case 'year': {
      // This year
      const currentStart = new Date(now.getFullYear(), 0, 1);
      const currentEnd = today;
      // Last year
      const previousStart = new Date(now.getFullYear() - 1, 0, 1);
      const previousEnd = new Date(now.getFullYear() - 1, 11, 31);
      return { currentStart, currentEnd, previousStart, previousEnd };
    }
  }
}

function filterActivities(activities: Activity[], start: Date, end: Date): Activity[] {
  return activities.filter((a) => {
    const date = new Date(a.start_date_local);
    return date >= start && date <= end;
  });
}

function calculateStats(activities: Activity[]) {
  const count = activities.length;
  const duration = activities.reduce((sum, a) => sum + (a.moving_time || 0), 0);
  const distance = activities.reduce((sum, a) => sum + (a.distance || 0), 0);
  const tss = Math.round(activities.reduce((sum, a) => sum + (a.icu_training_load || 0), 0));
  return { count, duration, distance, tss };
}

export function WeeklySummary({ activities }: WeeklySummaryProps) {
  const { t } = useTranslation();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const [timeRange, setTimeRange] = useState<TimeRange>('week');

  const { currentStats, previousStats, labels } = useMemo(() => {
    if (!activities || activities.length === 0) {
      return {
        currentStats: { count: 0, duration: 0, distance: 0, tss: 0 },
        previousStats: { count: 0, duration: 0, distance: 0, tss: 0 },
        labels: getTimeRangeLabel(timeRange, t as (key: string) => any),
      };
    }

    const ranges = getDateRanges(timeRange);
    const currentActivities = filterActivities(activities, ranges.currentStart, ranges.currentEnd);
    const previousActivities = filterActivities(
      activities,
      ranges.previousStart,
      ranges.previousEnd
    );

    return {
      currentStats: calculateStats(currentActivities),
      previousStats: calculateStats(previousActivities),
      labels: getTimeRangeLabel(timeRange, t as (key: string) => any),
    };
  }, [activities, timeRange, t]);

  const tssChange =
    previousStats.tss > 0 ? ((currentStats.tss - previousStats.tss) / previousStats.tss) * 100 : 0;

  const isLoadIncreasing = tssChange > 0;

  // Show empty state if no activities in current period
  if (currentStats.count === 0) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={[styles.title, isDark && styles.textLight]}>{labels.current}</Text>
          <View style={styles.timeRangeSelector}>
            {TIME_RANGE_IDS.map((rangeId) => (
              <TouchableOpacity
                key={rangeId}
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
        <View style={styles.emptyState}>
          <Text style={[styles.emptyText, isDark && styles.textDark]}>
            {t('stats.noActivitiesInPeriod')}
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header with time range selector */}
      <View style={styles.header}>
        <Text style={[styles.title, isDark && styles.textLight]}>{labels.current}</Text>
        <View style={styles.timeRangeSelector}>
          {TIME_RANGE_IDS.map((rangeId) => (
            <TouchableOpacity
              key={rangeId}
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

      {/* Stats grid */}
      <View style={styles.statsGrid}>
        <View style={styles.statItem}>
          <Text style={[styles.statValue, isDark && styles.textLight]}>{currentStats.count}</Text>
          <Text style={[styles.statLabel, isDark && styles.textDark]}>{t('stats.activities')}</Text>
        </View>

        <View style={styles.statItem}>
          <Text style={[styles.statValue, isDark && styles.textLight]}>
            {formatDuration(currentStats.duration)}
          </Text>
          <Text style={[styles.statLabel, isDark && styles.textDark]}>
            {t('activity.duration')}
          </Text>
        </View>

        <View style={styles.statItem}>
          <Text style={[styles.statValue, isDark && styles.textLight]}>
            {formatDistance(currentStats.distance)}
          </Text>
          <Text style={[styles.statLabel, isDark && styles.textDark]}>
            {t('activity.distance')}
          </Text>
        </View>

        <View style={styles.statItem}>
          <Text style={[styles.statValue, isDark && styles.textLight]}>{currentStats.tss}</Text>
          <Text style={[styles.statLabel, isDark && styles.textDark]}>{t('stats.loadTss')}</Text>
        </View>
      </View>

      {/* Comparison with previous period */}
      {previousStats.tss > 0 && (
        <View style={styles.comparisonRow}>
          <Text style={[styles.comparisonLabel, isDark && styles.textDark]}>{labels.previous}</Text>
          <Text
            style={[
              styles.comparisonValue,
              { color: isLoadIncreasing ? colors.warning : colors.success },
            ]}
          >
            {isLoadIncreasing ? '▲' : '▼'} {Math.abs(tssChange).toFixed(0)}%
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {},
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  title: {
    fontSize: typography.body.fontSize,
    fontWeight: '700',
    color: colors.textPrimary,
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
  statValue: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  statLabel: {
    fontSize: typography.caption.fontSize,
    color: colors.textSecondary,
    marginTop: 2,
  },
  comparisonRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  comparisonLabel: {
    fontSize: typography.caption.fontSize,
    color: colors.textSecondary,
  },
  comparisonValue: {
    fontSize: typography.bodySmall.fontSize,
    fontWeight: '600',
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: spacing.xl,
  },
  emptyText: {
    fontSize: typography.bodySmall.fontSize,
    color: colors.textSecondary,
  },
});

import React, { useMemo, useState } from 'react';
import { View, StyleSheet, useColorScheme, TouchableOpacity } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { colors, darkColors } from '@/theme/colors';
import { typography } from '@/theme/typography';
import { spacing, layout } from '@/theme/spacing';
import type { Activity } from '@/types';

interface SeasonComparisonProps {
  /** Height of the chart */
  height?: number;
  /** Activities from current year */
  currentYearActivities?: Activity[];
  /** Activities from previous year */
  previousYearActivities?: Activity[];
}

interface MonthData {
  month: string;
  current: number;
  previous: number;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Aggregate activities by month
function aggregateByMonth(
  activities: Activity[] | undefined,
  metric: 'hours' | 'distance' | 'tss'
): number[] {
  const monthlyTotals = new Array(12).fill(0);

  if (!activities) return monthlyTotals;

  for (const activity of activities) {
    const date = new Date(activity.start_date_local);
    const month = date.getMonth();

    switch (metric) {
      case 'hours':
        monthlyTotals[month] += (activity.moving_time || 0) / 3600;
        break;
      case 'distance':
        monthlyTotals[month] += (activity.distance || 0) / 1000;
        break;
      case 'tss':
        monthlyTotals[month] += activity.icu_training_load || 0;
        break;
    }
  }

  return monthlyTotals.map((v) => Math.round(v * 10) / 10);
}

export function SeasonComparison({
  height = 200,
  currentYearActivities,
  previousYearActivities,
}: SeasonComparisonProps) {
  const { t } = useTranslation();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const [metric, setMetric] = useState<'hours' | 'distance' | 'tss'>('hours');

  // Show empty state if no activities
  const hasData =
    (currentYearActivities && currentYearActivities.length > 0) ||
    (previousYearActivities && previousYearActivities.length > 0);

  const data = useMemo(() => {
    const currentTotals = aggregateByMonth(currentYearActivities, metric);
    const previousTotals = aggregateByMonth(previousYearActivities, metric);

    return MONTHS.map((month, idx) => ({
      month,
      current: currentTotals[idx],
      previous: previousTotals[idx],
    }));
  }, [currentYearActivities, previousYearActivities, metric]);

  if (!hasData) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={[styles.title, isDark && styles.textLight]}>
            {t('stats.seasonComparison')}
          </Text>
        </View>
        <View style={[styles.emptyState, { height }]}>
          <Text style={[styles.emptyText, isDark && styles.textDark]}>
            {t('stats.noActivityData')}
          </Text>
          <Text style={[styles.emptyHint, isDark && styles.textDark]}>
            {t('stats.completeActivitiesYearComparison')}
          </Text>
        </View>
      </View>
    );
  }

  const maxValue = useMemo(() => {
    return Math.max(...data.flatMap((d) => [d.current, d.previous]));
  }, [data]);

  // Labels for rolling 12-month periods
  const now = new Date();
  const oneYearAgo = new Date(now);
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
  const twoYearsAgo = new Date(now);
  twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);

  // Format as "Jan '25 - Jan '26" style labels
  const formatPeriodLabel = (start: Date, end: Date) => {
    const startMonth = start.toLocaleDateString('en-US', { month: 'short' });
    const startYear = start.getFullYear().toString().slice(-2);
    const endMonth = end.toLocaleDateString('en-US', { month: 'short' });
    const endYear = end.getFullYear().toString().slice(-2);
    return `${startMonth} '${startYear}-${endMonth} '${endYear}`;
  };

  const currentPeriodLabel = formatPeriodLabel(oneYearAgo, now);
  const previousPeriodLabel = formatPeriodLabel(twoYearsAgo, oneYearAgo);

  // Calculate totals - round to 1 decimal place
  const totals = useMemo(() => {
    const currentTotal = Math.round(data.reduce((sum, d) => sum + d.current, 0) * 10) / 10;
    const previousTotal = Math.round(data.reduce((sum, d) => sum + d.previous, 0) * 10) / 10;
    const diff = Math.round((currentTotal - previousTotal) * 10) / 10;
    const pctChange = previousTotal > 0 ? ((diff / previousTotal) * 100).toFixed(0) : 0;
    return { currentTotal, previousTotal, diff, pctChange };
  }, [data]);

  const barWidth = 8;
  const barGap = 2;

  const metricLabels = {
    hours: { label: t('stats.hours'), unit: 'h' },
    distance: { label: t('activity.distance'), unit: 'km' },
    tss: { label: t('stats.tss'), unit: '' },
  };

  // Current month for highlighting
  const currentMonth = now.getMonth();

  // Determine bar colors based on which calendar year the month falls in
  // For rolling periods, months after currentMonth are from the "older" year
  // Months up to currentMonth are from the "newer" year
  const getBarColor = (monthIdx: number, isPrevious: boolean) => {
    const isNewerYear = monthIdx <= currentMonth;

    if (isPrevious) {
      // Previous period: use blue tones
      // Newer year (e.g., 2025 portion) = brighter blue
      // Older year (e.g., 2024 portion) = muted blue
      return isNewerYear
        ? isDark ? 'rgba(100, 149, 237, 0.8)' : 'rgba(70, 130, 220, 0.7)'
        : isDark ? 'rgba(100, 149, 237, 0.4)' : 'rgba(70, 130, 220, 0.35)';
    } else {
      // Current period: use orange/primary tones
      // Newer year (e.g., 2026 portion) = full primary
      // Older year (e.g., 2025 portion) = muted primary
      return isNewerYear
        ? colors.primary
        : isDark ? 'rgba(252, 76, 2, 0.5)' : 'rgba(252, 76, 2, 0.6)';
    }
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={[styles.title, isDark && styles.textLight]}>
          {t('stats.seasonComparison')}
        </Text>
        <View style={styles.metricSelector}>
          {(['hours', 'distance', 'tss'] as const).map((m) => (
            <TouchableOpacity
              key={m}
              onPress={() => setMetric(m)}
              style={[styles.metricButton, metric === m && styles.metricButtonActive]}
            >
              <Text
                style={[
                  styles.metricButtonText,
                  isDark && styles.textDark,
                  metric === m && styles.metricButtonTextActive,
                ]}
              >
                {metricLabels[m].label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* Summary */}
      <View style={styles.summary}>
        <View style={styles.summaryItem}>
          <View style={[styles.legendDot, { backgroundColor: colors.primary }]} />
          <Text style={[styles.summaryLabel, isDark && styles.textDark]}>{currentPeriodLabel}</Text>
          <Text style={[styles.summaryValue, isDark && styles.textLight]}>
            {totals.currentTotal}
            {metricLabels[metric].unit}
          </Text>
        </View>
        <View style={styles.summaryItem}>
          <View style={[styles.legendDot, { backgroundColor: isDark ? 'rgba(100, 149, 237, 0.8)' : 'rgba(70, 130, 220, 0.7)' }]} />
          <Text style={[styles.summaryLabel, isDark && styles.textDark]}>{previousPeriodLabel}</Text>
          <Text style={[styles.summaryValue, isDark && styles.textLight]}>
            {totals.previousTotal}
            {metricLabels[metric].unit}
          </Text>
        </View>
        <View style={styles.summaryItem}>
          <Text style={[styles.summaryLabel, isDark && styles.textDark]}>vs</Text>
          <Text
            style={[
              styles.summaryValue,
              { color: totals.diff >= 0 ? colors.success : colors.warning },
            ]}
          >
            {totals.diff >= 0 ? '+' : ''}
            {totals.pctChange}%
          </Text>
        </View>
      </View>

      {/* Chart */}
      <View style={[styles.chartContainer, { height }]}>
        <View style={styles.chart}>
          {data.map((d, idx) => {
            const currentHeight = maxValue > 0 ? (d.current / maxValue) * (height - 30) : 0;
            const previousHeight = maxValue > 0 ? (d.previous / maxValue) * (height - 30) : 0;
            const isCurrentMonth = idx === currentMonth;

            return (
              <View key={idx} style={styles.barGroup}>
                {/* Current month highlight background */}
                {isCurrentMonth && (
                  <View
                    style={[
                      styles.currentMonthHighlight,
                      {
                        backgroundColor: isDark
                          ? 'rgba(255, 255, 255, 0.08)'
                          : 'rgba(252, 76, 2, 0.08)',
                      },
                    ]}
                  />
                )}
                {/* Current period bar */}
                <View
                  style={[
                    styles.bar,
                    {
                      width: barWidth,
                      height: currentHeight,
                      backgroundColor: getBarColor(idx, false),
                      marginRight: barGap,
                    },
                  ]}
                />
                {/* Previous period bar */}
                <View
                  style={[
                    styles.bar,
                    {
                      width: barWidth,
                      height: previousHeight,
                      backgroundColor: getBarColor(idx, true),
                    },
                  ]}
                />
                {/* Month label */}
                <Text
                  style={[
                    styles.monthLabel,
                    isDark && styles.textDark,
                    isCurrentMonth && styles.currentMonthLabel,
                  ]}
                >
                  {d.month.charAt(0)}
                </Text>
                {/* Current month indicator dot */}
                {isCurrentMonth && (
                  <View
                    style={[
                      styles.currentMonthDot,
                      { backgroundColor: colors.primary },
                    ]}
                  />
                )}
              </View>
            );
          })}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {},
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  title: {
    fontSize: typography.cardTitle.fontSize,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  textLight: {
    color: colors.textOnDark,
  },
  textDark: {
    color: darkColors.textSecondary,
  },
  metricSelector: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  metricButton: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: layout.borderRadiusSm,
  },
  metricButtonActive: {
    backgroundColor: colors.primary,
  },
  metricButtonText: {
    fontSize: typography.label.fontSize,
    color: colors.textSecondary,
  },
  metricButtonTextActive: {
    color: colors.textOnDark,
  },
  summary: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: layout.borderRadiusSm,
    backgroundColor: 'rgba(0, 0, 0, 0.02)',
  },
  summaryItem: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  legendDot: {
    width: spacing.sm,
    height: spacing.sm,
    borderRadius: spacing.xs,
  },
  summaryLabel: {
    fontSize: typography.label.fontSize,
    color: colors.textSecondary,
  },
  summaryValue: {
    fontSize: typography.bodySmall.fontSize,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  chartContainer: {
    justifyContent: 'flex-end',
  },
  chart: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    paddingBottom: 20,
  },
  barGroup: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    flex: 1,
  },
  bar: {
    borderRadius: spacing.xs,
  },
  monthLabel: {
    position: 'absolute',
    bottom: -16,
    fontSize: typography.pillLabel.fontSize,
    color: colors.textSecondary,
  },
  currentMonthLabel: {
    fontWeight: '700',
    color: colors.primary,
  },
  currentMonthHighlight: {
    position: 'absolute',
    top: -8,
    bottom: -24,
    left: -4,
    right: -4,
    borderRadius: layout.borderRadiusSm,
  },
  currentMonthDot: {
    position: 'absolute',
    bottom: -24,
    width: 4,
    height: 4,
    borderRadius: 2,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    fontSize: typography.bodySmall.fontSize,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  emptyHint: {
    fontSize: typography.caption.fontSize,
    color: colors.textSecondary,
    textAlign: 'center',
  },
});

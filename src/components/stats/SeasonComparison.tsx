import React, { useMemo, useState } from 'react';
import { View, StyleSheet, useColorScheme, TouchableOpacity } from 'react-native';
import { Text } from 'react-native-paper';
import { colors, spacing } from '@/theme';
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

  return monthlyTotals.map(v => Math.round(v * 10) / 10);
}

export function SeasonComparison({
  height = 200,
  currentYearActivities,
  previousYearActivities,
}: SeasonComparisonProps) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const [metric, setMetric] = useState<'hours' | 'distance' | 'tss'>('hours');

  // Show empty state if no activities
  const hasData = (currentYearActivities && currentYearActivities.length > 0) ||
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
          <Text style={[styles.title, isDark && styles.textLight]}>Season Comparison</Text>
        </View>
        <View style={[styles.emptyState, { height }]}>
          <Text style={[styles.emptyText, isDark && styles.textDark]}>
            No activity data available
          </Text>
          <Text style={[styles.emptyHint, isDark && styles.textDark]}>
            Complete activities to see year-over-year comparison
          </Text>
        </View>
      </View>
    );
  }

  const maxValue = useMemo(() => {
    return Math.max(...data.flatMap(d => [d.current, d.previous]));
  }, [data]);

  const currentYear = new Date().getFullYear();
  const previousYear = currentYear - 1;

  // Calculate totals
  const totals = useMemo(() => {
    const currentTotal = data.reduce((sum, d) => sum + d.current, 0);
    const previousTotal = data.reduce((sum, d) => sum + d.previous, 0);
    const diff = currentTotal - previousTotal;
    const pctChange = previousTotal > 0 ? ((diff / previousTotal) * 100).toFixed(0) : 0;
    return { currentTotal, previousTotal, diff, pctChange };
  }, [data]);

  const barWidth = 8;
  const barGap = 2;
  const groupGap = 4;

  const metricLabels = {
    hours: { label: 'Hours', unit: 'h' },
    distance: { label: 'Distance', unit: 'km' },
    tss: { label: 'TSS', unit: '' },
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={[styles.title, isDark && styles.textLight]}>Season Comparison</Text>
        <View style={styles.metricSelector}>
          {(['hours', 'distance', 'tss'] as const).map((m) => (
            <TouchableOpacity
              key={m}
              onPress={() => setMetric(m)}
              style={[
                styles.metricButton,
                metric === m && styles.metricButtonActive,
              ]}
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
          <Text style={[styles.summaryLabel, isDark && styles.textDark]}>
            {currentYear}
          </Text>
          <Text style={[styles.summaryValue, isDark && styles.textLight]}>
            {totals.currentTotal}{metricLabels[metric].unit}
          </Text>
        </View>
        <View style={styles.summaryItem}>
          <View style={[styles.legendDot, { backgroundColor: 'rgba(150, 150, 150, 0.5)' }]} />
          <Text style={[styles.summaryLabel, isDark && styles.textDark]}>
            {previousYear}
          </Text>
          <Text style={[styles.summaryValue, isDark && styles.textLight]}>
            {totals.previousTotal}{metricLabels[metric].unit}
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
            {totals.diff >= 0 ? '+' : ''}{totals.pctChange}%
          </Text>
        </View>
      </View>

      {/* Chart */}
      <View style={[styles.chartContainer, { height }]}>
        <View style={styles.chart}>
          {data.map((d, idx) => {
            const currentHeight = maxValue > 0 ? (d.current / maxValue) * (height - 30) : 0;
            const previousHeight = maxValue > 0 ? (d.previous / maxValue) * (height - 30) : 0;

            return (
              <View key={idx} style={styles.barGroup}>
                {/* Current year bar */}
                <View
                  style={[
                    styles.bar,
                    {
                      width: barWidth,
                      height: currentHeight,
                      backgroundColor: colors.primary,
                      marginRight: barGap,
                    },
                  ]}
                />
                {/* Previous year bar */}
                <View
                  style={[
                    styles.bar,
                    {
                      width: barWidth,
                      height: previousHeight,
                      backgroundColor: isDark ? 'rgba(150, 150, 150, 0.5)' : 'rgba(100, 100, 100, 0.3)',
                    },
                  ]}
                />
                {/* Month label */}
                <Text style={[styles.monthLabel, isDark && styles.textDark]}>
                  {d.month.charAt(0)}
                </Text>
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
    fontSize: 18,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  textLight: {
    color: '#FFFFFF',
  },
  textDark: {
    color: '#AAA',
  },
  metricSelector: {
    flexDirection: 'row',
    gap: 4,
  },
  metricButton: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  metricButtonActive: {
    backgroundColor: colors.primary,
  },
  metricButtonText: {
    fontSize: 11,
    color: colors.textSecondary,
  },
  metricButtonTextActive: {
    color: '#FFFFFF',
  },
  summary: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: 8,
    backgroundColor: 'rgba(0, 0, 0, 0.02)',
  },
  summaryItem: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  summaryLabel: {
    fontSize: 11,
    color: colors.textSecondary,
  },
  summaryValue: {
    fontSize: 14,
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
    borderRadius: 4,
  },
  monthLabel: {
    position: 'absolute',
    bottom: -16,
    fontSize: 9,
    color: colors.textSecondary,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    fontSize: 14,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  emptyHint: {
    fontSize: 12,
    color: colors.textSecondary,
    textAlign: 'center',
  },
});

import React, { useMemo, useState, useRef, useCallback } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  PanResponder,
  LayoutChangeEvent,
  findNodeHandle,
  UIManager,
} from 'react-native';
import { useTheme } from '@/hooks';
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
  const { isDark } = useTheme();
  const [metric, setMetric] = useState<'hours' | 'distance' | 'tss'>('hours');
  const [selectedMonth, setSelectedMonth] = useState<number | null>(null);
  const chartWidth = useRef(0);
  const chartPageX = useRef(0);
  const chartRef = useRef<View>(null);

  // Handle chart layout to get width and absolute position for touch calculations
  const onChartLayout = useCallback((event: LayoutChangeEvent) => {
    chartWidth.current = event.nativeEvent.layout.width;
    // Measure absolute position after layout
    if (chartRef.current) {
      const nodeHandle = findNodeHandle(chartRef.current);
      if (nodeHandle) {
        UIManager.measure(nodeHandle, (_x, _y, _width, _height, pageX) => {
          chartPageX.current = pageX;
        });
      }
    }
  }, []);

  // Calculate month index from x position relative to chart
  const getMonthFromX = useCallback((x: number) => {
    if (chartWidth.current === 0) return 0;
    const monthIndex = Math.floor((x / chartWidth.current) * 12);
    return Math.max(0, Math.min(11, monthIndex));
  }, []);

  // Pan responder for scrubbing
  // Uses pageX (absolute screen coordinates) to avoid issues with touch target
  // being a child element (bars) where locationX would be relative to that child
  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        // Prevent parent ScrollView from stealing the gesture while scrubbing
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: (evt) => {
          // Use pageX (absolute) and subtract chart's absolute position
          // This avoids issues where locationX is relative to a child element
          const relativeX = evt.nativeEvent.pageX - chartPageX.current;
          const monthIndex = getMonthFromX(relativeX);
          setSelectedMonth(monthIndex);
        },
        onPanResponderMove: (evt) => {
          // Use pageX for consistent coordinate calculation
          const relativeX = evt.nativeEvent.pageX - chartPageX.current;
          const monthIndex = getMonthFromX(relativeX);
          setSelectedMonth(monthIndex);
        },
        onPanResponderRelease: () => {
          setSelectedMonth(null);
        },
        onPanResponderTerminate: () => {
          setSelectedMonth(null);
        },
      }),
    [getMonthFromX]
  );

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
  const currentYear = now.getFullYear();
  const oneYearAgo = new Date(now);
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
  const twoYearsAgo = new Date(now);
  twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);

  // Year labels for legend
  const newerCurrentYear = currentYear; // e.g., 2026
  const olderCurrentYear = currentYear - 1; // e.g., 2025
  const newerPreviousYear = currentYear - 1; // e.g., 2025
  const olderPreviousYear = currentYear - 2; // e.g., 2024

  // Color constants for legend
  const colorCurrentNewer = colors.primary;
  const colorCurrentOlder = isDark ? 'rgba(252, 76, 2, 0.5)' : 'rgba(252, 76, 2, 0.6)';
  const colorPreviousNewer = isDark ? 'rgba(100, 149, 237, 0.8)' : 'rgba(70, 130, 220, 0.7)';
  const colorPreviousOlder = isDark ? 'rgba(100, 149, 237, 0.4)' : 'rgba(70, 130, 220, 0.35)';

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
      return isNewerYear ? colorPreviousNewer : colorPreviousOlder;
    } else {
      return isNewerYear ? colorCurrentNewer : colorCurrentOlder;
    }
  };

  // Get selected month data for tooltip
  const selectedMonthData = selectedMonth !== null ? data[selectedMonth] : null;
  const selectedMonthDiff =
    selectedMonthData && selectedMonthData.previous > 0
      ? ((selectedMonthData.current - selectedMonthData.previous) / selectedMonthData.previous) *
        100
      : 0;

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

      {/* Legend */}
      <View style={styles.legend}>
        <View style={styles.legendRow}>
          <Text style={[styles.legendTitle, isDark && styles.textLight]}>{t('stats.current')}</Text>
          <View style={styles.legendItems}>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: colorCurrentNewer }]} />
              <Text style={[styles.legendLabel, isDark && styles.textDark]}>
                {newerCurrentYear}
              </Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: colorCurrentOlder }]} />
              <Text style={[styles.legendLabel, isDark && styles.textDark]}>
                {olderCurrentYear}
              </Text>
            </View>
          </View>
        </View>
        <View style={styles.legendRow}>
          <Text style={[styles.legendTitle, isDark && styles.textLight]}>
            {t('stats.previous')}
          </Text>
          <View style={styles.legendItems}>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: colorPreviousNewer }]} />
              <Text style={[styles.legendLabel, isDark && styles.textDark]}>
                {newerPreviousYear}
              </Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: colorPreviousOlder }]} />
              <Text style={[styles.legendLabel, isDark && styles.textDark]}>
                {olderPreviousYear}
              </Text>
            </View>
          </View>
        </View>
      </View>

      {/* Summary / Tooltip */}
      <View style={[styles.summary, selectedMonth !== null && styles.summaryActive]}>
        {selectedMonth !== null && selectedMonthData ? (
          <>
            <Text style={[styles.tooltipMonth, isDark && styles.textLight]}>
              {selectedMonthData.month}
            </Text>
            <View style={styles.tooltipValues}>
              <View style={styles.tooltipItem}>
                <View
                  style={[styles.legendDot, { backgroundColor: getBarColor(selectedMonth, false) }]}
                />
                <Text style={[styles.tooltipValue, isDark && styles.textLight]}>
                  {selectedMonthData.current}
                  {metricLabels[metric].unit}
                </Text>
              </View>
              <View style={styles.tooltipItem}>
                <View
                  style={[styles.legendDot, { backgroundColor: getBarColor(selectedMonth, true) }]}
                />
                <Text style={[styles.tooltipValue, isDark && styles.textLight]}>
                  {selectedMonthData.previous}
                  {metricLabels[metric].unit}
                </Text>
              </View>
              <Text
                style={[
                  styles.tooltipDiff,
                  {
                    color: selectedMonthDiff >= 0 ? colors.success : colors.warning,
                  },
                ]}
              >
                {selectedMonthDiff >= 0 ? '+' : ''}
                {selectedMonthDiff.toFixed(0)}%
              </Text>
            </View>
          </>
        ) : (
          <>
            <View style={styles.summaryItem}>
              <Text style={[styles.summaryLabel, isDark && styles.textDark]}>
                {t('stats.current')}
              </Text>
              <Text style={[styles.summaryValue, isDark && styles.textLight]}>
                {totals.currentTotal}
                {metricLabels[metric].unit}
              </Text>
            </View>
            <View style={styles.summaryItem}>
              <Text style={[styles.summaryLabel, isDark && styles.textDark]}>
                {t('stats.previous')}
              </Text>
              <Text style={[styles.summaryValue, isDark && styles.textLight]}>
                {totals.previousTotal}
                {metricLabels[metric].unit}
              </Text>
            </View>
            <View style={styles.summaryItem}>
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
          </>
        )}
      </View>

      {/* Chart */}
      <View
        ref={chartRef}
        style={[styles.chartContainer, { height }]}
        onLayout={onChartLayout}
        {...panResponder.panHandlers}
      >
        <View style={styles.chart}>
          {data.map((d, idx) => {
            const currentHeight = maxValue > 0 ? (d.current / maxValue) * (height - 30) : 0;
            const previousHeight = maxValue > 0 ? (d.previous / maxValue) * (height - 30) : 0;
            const isCurrentMonth = idx === currentMonth;
            const isSelected = idx === selectedMonth;

            return (
              <View key={idx} style={styles.barGroup}>
                {/* Current month or selected highlight background */}
                {(isCurrentMonth || isSelected) && (
                  <View
                    style={[
                      styles.currentMonthHighlight,
                      {
                        backgroundColor: isSelected
                          ? isDark
                            ? 'rgba(255, 255, 255, 0.15)'
                            : 'rgba(0, 0, 0, 0.08)'
                          : isDark
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
                      opacity: selectedMonth !== null && !isSelected ? 0.4 : 1,
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
                      opacity: selectedMonth !== null && !isSelected ? 0.4 : 1,
                    },
                  ]}
                />
                {/* Month label */}
                <Text
                  style={[
                    styles.monthLabel,
                    isDark && styles.textDark,
                    isCurrentMonth && styles.currentMonthLabel,
                    isSelected && styles.selectedMonthLabel,
                  ]}
                >
                  {d.month.charAt(0)}
                </Text>
                {/* Current month indicator dot */}
                {isCurrentMonth && !isSelected && (
                  <View style={[styles.currentMonthDot, { backgroundColor: colors.primary }]} />
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
  legend: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: spacing.sm,
    paddingVertical: spacing.xs,
  },
  legendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  legendTitle: {
    fontSize: typography.label.fontSize,
    fontWeight: '600',
    color: colors.textPrimary,
    minWidth: 55,
  },
  legendItems: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  legendLabel: {
    fontSize: typography.caption.fontSize,
    color: colors.textSecondary,
  },
  summary: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    marginBottom: spacing.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: layout.borderRadiusSm,
    backgroundColor: 'rgba(0, 0, 0, 0.02)',
    minHeight: 44,
  },
  summaryActive: {
    backgroundColor: 'rgba(0, 0, 0, 0.05)',
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
    marginRight: 4,
  },
  summaryValue: {
    fontSize: typography.bodySmall.fontSize,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  tooltipMonth: {
    fontSize: typography.body.fontSize,
    fontWeight: '700',
    color: colors.textPrimary,
    minWidth: 40,
  },
  tooltipValues: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  tooltipItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  tooltipValue: {
    fontSize: typography.bodySmall.fontSize,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  tooltipDiff: {
    fontSize: typography.bodySmall.fontSize,
    fontWeight: '700',
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
  selectedMonthLabel: {
    fontWeight: '700',
    color: colors.textPrimary,
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
